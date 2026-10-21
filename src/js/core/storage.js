/**
 * core/storage.js — chrome.storage 封装、串行写队列、应用状态读取。
 *
 * 设计：
 * - 所有按 key 的写入都走 createWriteQueue()：串行、同 key 合并（只写最后一次值）、
 *   失败只 warn 不抛，避免并发读改写互相覆盖；
 * - 页面侧 UI 不得直接调用本模块写业务数据，统一经 core/store.js 的 actions；
 * - storage key 与 v1.x 完全兼容。
 */

import { CONFIG, DEFAULT_SETTINGS, DEFAULT_SMART } from './config.js';
import { isHttpUrl, isPlainObject } from './utils.js';

const PAGE_LIST_KEY = 'bookmarkPages';
const CURRENT_PAGE_KEY = 'currentPageId';
const SETTINGS_KEY = 'settings';
const SMART_SETTINGS_KEY = 'smartSettings';
const SEARCH_ENGINE_KEY = 'searchEngine';

function hasChromeStorage() {
  return typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local;
}

export const storage = {
  async get(keys) {
    if (!hasChromeStorage()) return {};
    try {
      return await chrome.storage.local.get(keys);
    } catch (error) {
      console.warn('[storage] 读取失败:', error);
      return {};
    }
  },

  async set(items) {
    if (!hasChromeStorage()) return;
    try {
      await chrome.storage.local.set(items);
    } catch (error) {
      console.warn('[storage] 写入失败:', error);
    }
  },

  async remove(keys) {
    if (!hasChromeStorage()) return;
    try {
      await chrome.storage.local.remove(keys);
    } catch (error) {
      console.warn('[storage] 删除失败:', error);
    }
  },

  /** 监听 local 区变化，返回 dispose() */
  onChanged(callback) {
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.onChanged) {
      return () => {};
    }
    const listener = (changes, areaName) => {
      if (areaName !== 'local') return;
      callback(changes);
    };
    chrome.storage.onChanged.addListener(listener);
    return () => {
      try {
        chrome.storage.onChanged.removeListener(listener);
      } catch (error) {
        /* 扩展卸载等场景忽略 */
      }
    };
  }
};

/**
 * 串行写队列：同一 key 只保留最后一次 producer；flush() 等待全部落盘。
 * producer 可以是函数（延迟求值，保证写的是最新状态）或直接值。
 */
export function createWriteQueue({ debounceMs = CONFIG.constants.WRITE_DEBOUNCE } = {}) {
  const entries = new Map();
  let timer = null;
  let running = false;
  let rerun = false;

  const schedule = () => {
    if (timer || running) return;
    timer = setTimeout(() => {
      timer = null;
      flush();
    }, debounceMs);
  };

  async function flush() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (running) {
      rerun = true;
      return;
    }
    if (!entries.size) return;

    running = true;
    const batch = Array.from(entries.entries());
    entries.clear();

    for (const [key, entry] of batch) {
      try {
        if (entry.remove) {
          await storage.remove(key);
        } else {
          const value = typeof entry.producer === 'function' ? await entry.producer() : entry.producer;
          await storage.set({ [key]: value });
        }
        entry.resolvers.forEach((resolve) => resolve());
      } catch (error) {
        console.warn('[storage] 队列写入失败:', key, error);
        entry.resolvers.forEach((resolve) => resolve());
      }
    }

    running = false;
    if (rerun) {
      rerun = false;
      schedule();
    }
  }

  function enqueue(key, producer, { immediate = false, remove = false } = {}) {
    const existing = entries.get(key);
    const promise = new Promise((resolve) => {
      if (existing) {
        existing.producer = producer;
        existing.remove = remove;
        existing.resolvers.push(resolve);
      } else {
        entries.set(key, { producer, remove, resolvers: [resolve] });
      }
    });
    if (immediate) flush();
    else schedule();
    return promise;
  }

  return {
    enqueue,
    removeKey(key, { immediate = false } = {}) {
      return enqueue(key, null, { immediate, remove: true });
    },
    flush
  };
}

/* ---------- 数据清洗（容忍历史脏数据） ---------- */

export function sanitizePages(rawPages) {
  if (!Array.isArray(rawPages)) return [];
  const seen = new Set();
  const pages = [];
  for (const item of rawPages) {
    if (!item || typeof item !== 'object') continue;
    const id = String(item.id || '');
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const subfolders = Array.isArray(item.subfolders)
      ? Array.from(new Set(item.subfolders.filter((name) => typeof name === 'string' && name)))
      : [];
    pages.push({
      id,
      name: typeof item.name === 'string' && item.name ? item.name : '未命名页面',
      createdAt: item.createdAt || new Date().toISOString(),
      bookmarkCount: Number.isFinite(item.bookmarkCount) ? item.bookmarkCount : 0,
      subfolders
    });
  }
  return pages;
}

export function sanitizeSquares(rawSquares) {
  if (!Array.isArray(rawSquares)) return [];
  const seen = new Set();
  const squares = [];
  for (const item of rawSquares) {
    if (!item || typeof item !== 'object' || !isHttpUrl(item.url)) continue;
    if (seen.has(item.url)) continue;
    seen.add(item.url);
    squares.push({
      url: item.url,
      title: typeof item.title === 'string' && item.title ? item.title : item.url,
      folder: typeof item.folder === 'string' ? item.folder : ''
    });
  }
  return squares;
}

export function mergeSettings(raw) {
  const source = isPlainObject(raw) ? raw : {};
  return {
    ...DEFAULT_SETTINGS,
    ...source,
    background: {
      ...DEFAULT_SETTINGS.background,
      ...(isPlainObject(source.background) ? source.background : {})
    }
  };
}

export function mergeSmartSettings(raw) {
  const source = isPlainObject(raw) ? raw : {};
  return { ...DEFAULT_SMART, ...source };
}

/**
 * 读取首屏所需全部状态（一次 get，避免多次串行 IPC）。
 * @returns {Promise<{pages:Array, currentPageId:string|null, settings:object,
 *   smartSettings:object, searchEngine:string}>}
 */
export async function loadAppState() {
  const data = hasChromeStorage()
    ? await chrome.storage.local.get([
        PAGE_LIST_KEY,
        CURRENT_PAGE_KEY,
        SETTINGS_KEY,
        SMART_SETTINGS_KEY,
        SEARCH_ENGINE_KEY
      ])
    : {};

  const pages = sanitizePages(data[PAGE_LIST_KEY]);
  const currentPageId = typeof data[CURRENT_PAGE_KEY] === 'string' ? data[CURRENT_PAGE_KEY] : null;

  let searchEngine = data[SEARCH_ENGINE_KEY];
  if (!searchEngine) {
    try {
      if (typeof localStorage !== 'undefined') {
        searchEngine = localStorage.getItem('currentSearchEngine');
      }
    } catch (error) {
      searchEngine = null;
    }
  }

  return {
    pages,
    currentPageId,
    settings: mergeSettings(data[SETTINGS_KEY]),
    smartSettings: mergeSmartSettings(data[SMART_SETTINGS_KEY]),
    searchEngine: CONFIG.searchEngines[searchEngine] ? searchEngine : 'google'
  };
}

/** 读取某页书签 */
export async function loadSquares(pageId) {
  if (!pageId) return [];
  const key = 'squares_' + pageId;
  const data = await storage.get(key);
  return sanitizeSquares(data[key]);
}

/** 直接写某页书签（仅供 store 的写队列 producer 使用） */
export async function saveSquares(pageId, squares) {
  if (!pageId) return;
  await storage.set({ ['squares_' + pageId]: Array.isArray(squares) ? squares : [] });
}

export const STORAGE_KEYS = {
  pageList: PAGE_LIST_KEY,
  currentPage: CURRENT_PAGE_KEY,
  settings: SETTINGS_KEY,
  smartSettings: SMART_SETTINGS_KEY,
  searchEngine: SEARCH_ENGINE_KEY,
  squares: (pageId) => 'squares_' + pageId
};
