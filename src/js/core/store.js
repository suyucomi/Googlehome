/**
 * core/store.js — 唯一运行时状态源 + 单向数据流。
 *
 * 结构：
 *   事件/用户操作 → store action → 更新 state → 写队列持久化 → 通知订阅者渲染
 *
 * 约定：
 * - UI 只能通过本模块 actions 改业务数据，禁止直接写 chrome.storage；
 * - 订阅者收到 (state, changedKeys)；同一轮同步调用里的多次变更合并为一次通知（微任务）；
 * - 所有按 key 的持久化走串行写队列，同 key 只落最后一次值。
 *
 * state = {
 *   pages: [{id,name,createdAt,bookmarkCount,subfolders}],
 *   currentPageId, currentFolder,
 *   squaresByPage: Map<pageId, Square[]>,
 *   settings, smartSettings, searchEngine,
 *   ui: { sidebarOpen, settingsOpen, perfMode, ready }
 * }
 */

import { CONFIG, DEFAULT_SETTINGS, DEFAULT_SMART, MOBILE_BREAKPOINT } from './config.js';
import {
  STORAGE_KEYS,
  createWriteQueue,
  loadAppState,
  loadSquares,
  mergeSettings,
  mergeSmartSettings,
  sanitizePages,
  sanitizeSquares,
  storage
} from './storage.js';
import { isHttpUrl, titleFromUrl, uid } from './utils.js';

const writes = createWriteQueue();
const listeners = new Set();

const state = {
  pages: [],
  currentPageId: null,
  currentFolder: '',
  squaresByPage: new Map(),
  settings: mergeSettings(null),
  smartSettings: mergeSmartSettings(null),
  searchEngine: 'google',
  ui: {
    sidebarOpen: false,
    settingsOpen: false,
    perfMode: true,
    ready: false
  }
};

let pendingKeys = new Set();
let notifyScheduled = false;
let storageUnsubscribe = null;

/* ------------------------------ 通知 ------------------------------ */

function scheduleNotify(keys) {
  for (const key of keys) pendingKeys.add(key);
  if (notifyScheduled) return;
  notifyScheduled = true;
  const flush = () => {
    notifyScheduled = false;
    const changed = pendingKeys;
    pendingKeys = new Set();
    if (!changed.size) return;
    for (const listener of Array.from(listeners)) {
      try {
        listener(state, changed);
      } catch (error) {
        console.error('[store] 订阅者执行失败:', error);
      }
    }
  };
  if (typeof queueMicrotask === 'function') queueMicrotask(flush);
  else Promise.resolve().then(flush);
}

/** 同步执行挂起通知（测试或页面卸载前用） */
export function flushNotifications() {
  if (!notifyScheduled) return;
  const changed = pendingKeys;
  pendingKeys = new Set();
  notifyScheduled = false;
  if (!changed.size) return;
  for (const listener of Array.from(listeners)) {
    try {
      listener(state, changed);
    } catch (error) {
      console.error('[store] 订阅者执行失败:', error);
    }
  }
}

/* ------------------------------ 持久化 ------------------------------ */

function pageSnapshot() {
  return state.pages.map((page) => ({
    id: page.id,
    name: page.name,
    createdAt: page.createdAt,
    bookmarkCount: page.bookmarkCount || 0,
    subfolders: Array.isArray(page.subfolders) ? [...page.subfolders] : []
  }));
}

function squaresSnapshot(pageId) {
  return (state.squaresByPage.get(pageId) || []).map((item) => ({ ...item }));
}

function persistPages(immediate = false) {
  return writes.enqueue(STORAGE_KEYS.pageList, pageSnapshot, { immediate });
}

function persistCurrentPage() {
  return writes.enqueue(STORAGE_KEYS.currentPage, () => state.currentPageId, { immediate: true });
}

function persistSquares(pageId, immediate = false) {
  if (!pageId) return Promise.resolve();
  return writes.enqueue(STORAGE_KEYS.squares(pageId), () => squaresSnapshot(pageId), { immediate });
}

function persistSettings(immediate = true) {
  return writes.enqueue(STORAGE_KEYS.settings, () => state.settings, { immediate });
}

function persistSmartSettings(immediate = true) {
  return writes.enqueue(STORAGE_KEYS.smartSettings, () => state.smartSettings, { immediate });
}

/* ------------------------------ 辅助 ------------------------------ */

function getPage(pageId = state.currentPageId) {
  return state.pages.find((page) => page.id === pageId) || null;
}

function readSidebarState() {
  try {
    if (typeof localStorage !== 'undefined') return localStorage.getItem('sidebarState');
  } catch (error) {
    /* 隐私模式等忽略 */
  }
  return null;
}

function writeSidebarState(open) {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('sidebarState', open ? 'open' : 'closed');
    }
  } catch (error) {
    /* 忽略 */
  }
}

function isMobileViewport() {
  try {
    return typeof window !== 'undefined' && window.innerWidth <= MOBILE_BREAKPOINT;
  } catch (error) {
    return false;
  }
}

function sameSquareList(a, b) {
  if (a === b) return true;
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].url !== b[i].url || a[i].title !== b[i].title || (a[i].folder || '') !== (b[i].folder || '')) {
      return false;
    }
  }
  return true;
}

function samePagesMeta(a, b) {
  if (a === b) return true;
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const left = a[i] || {};
    const right = b[i] || {};
    if (left.id !== right.id || left.name !== right.name) return false;
    if ((left.bookmarkCount || 0) !== (right.bookmarkCount || 0)) return false;
    const leftFolders = Array.isArray(left.subfolders) ? left.subfolders : [];
    const rightFolders = Array.isArray(right.subfolders) ? right.subfolders : [];
    if (leftFolders.length !== rightFolders.length) return false;
    for (let j = 0; j < leftFolders.length; j++) {
      if (leftFolders[j] !== rightFolders[j]) return false;
    }
  }
  return true;
}

function uniquePageName(desired) {
  const base = (desired && String(desired).trim()) || `页面 ${state.pages.length + 1}`;
  let name = base;
  let counter = 1;
  while (state.pages.some((page) => page.name === name)) {
    name = `${base} ${counter}`;
    counter += 1;
  }
  return name;
}

function syncCountFromSquares(page) {
  if (!page) return;
  const squares = state.squaresByPage.get(page.id);
  if (!Array.isArray(squares)) return;
  if ((page.bookmarkCount || 0) !== squares.length) {
    page.bookmarkCount = squares.length;
    persistPages();
  }
}

/* ------------------------------ 初始化 ------------------------------ */

async function createPageInternal(name, { select = true, silent = false } = {}) {
  const page = {
    id: uid('p_'),
    name: uniquePageName(name),
    createdAt: new Date().toISOString(),
    bookmarkCount: 0,
    subfolders: []
  };
  state.pages.push(page);
  state.squaresByPage.set(page.id, []);
  if (select) {
    state.currentPageId = page.id;
    state.currentFolder = '';
  }
  await Promise.all([persistPages(true), persistCurrentPage()]);
  if (!silent) scheduleNotify(['pages', 'currentPageId', 'currentFolder', 'squares']);
  return page;
}

/** 向 background 请求首次导入；带超时保护，绝不阻塞首屏渲染 */
async function requestBackgroundImport(timeoutMs = 2000) {
  if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.sendMessage) return null;
  try {
    const request = chrome.runtime.sendMessage({ type: 'smart:import' });
    const timeout = new Promise((resolve) => setTimeout(() => resolve({ ok: false, timeout: true }), timeoutMs));
    return await Promise.race([request, timeout]);
  } catch (error) {
    console.warn('[store] 导入浏览器书签失败:', error);
    return null;
  }
}

async function init() {
  // 先注册外部变化监听：background 首次导入可能晚于本函数超时返回
  subscribeStorage();

  const loaded = await loadAppState();
  state.pages = loaded.pages;
  state.currentPageId = loaded.currentPageId;
  state.settings = loaded.settings;
  state.smartSettings = loaded.smartSettings;
  state.searchEngine = loaded.searchEngine;

  // 首次使用：让 background 把浏览器书签栏导入成主题页面（超时降级为默认页面）
  if (!state.pages.length) {
    await requestBackgroundImport();
    const reimported = await loadAppState();
    if (reimported.pages.length) {
      state.pages = reimported.pages;
      state.currentPageId = reimported.currentPageId || state.currentPageId;
    }
  }

  if (!state.pages.length) {
    await createPageInternal('默认页面', { select: true, silent: true });
  }

  if (!state.pages.some((page) => page.id === state.currentPageId)) {
    state.currentPageId = state.pages[0] ? state.pages[0].id : null;
    if (state.currentPageId) persistCurrentPage();
  }

  const savedSidebar = readSidebarState();
  state.ui.sidebarOpen =
    savedSidebar === 'open' ? true : savedSidebar === 'closed' ? false : !isMobileViewport();
  state.ui.perfMode = state.smartSettings.perfMode !== false;

  if (state.currentPageId) {
    await ensureSquares(state.currentPageId);
    syncCountFromSquares(getPage());
  }

  state.ui.ready = true;
  scheduleNotify([
    'pages',
    'currentPageId',
    'currentFolder',
    'squares',
    'settings',
    'smartSettings',
    'searchEngine',
    'ui',
    'ready'
  ]);
}

/* ------------------------------ storage 订阅 ------------------------------ */

function subscribeStorage() {
  if (storageUnsubscribe) return;
  storageUnsubscribe = storage.onChanged((changes) => {
    const changed = new Set();

    for (const [key, change] of Object.entries(changes)) {
      const next = change && 'newValue' in change ? change.newValue : undefined;

      if (key === STORAGE_KEYS.pageList) {
        const pages = sanitizePages(next);
        if (!samePagesMeta(pages, state.pages)) {
          state.pages = pages;
          if (!pages.some((page) => page.id === state.currentPageId)) {
            state.currentPageId = pages[0] ? pages[0].id : null;
            changed.add('currentPageId');
          }
          changed.add('pages');
        }
        continue;
      }

      if (key === STORAGE_KEYS.currentPage) {
        const pageId = typeof next === 'string' ? next : null;
        if (pageId && pageId !== state.currentPageId && state.pages.some((page) => page.id === pageId)) {
          state.currentPageId = pageId;
          state.currentFolder = '';
          ensureSquares(pageId).then(() => scheduleNotify(['squares', 'currentFolder']));
          changed.add('currentPageId');
          changed.add('currentFolder');
        }
        continue;
      }

      if (key.startsWith('squares_')) {
        const pageId = key.slice('squares_'.length);
        const squares = sanitizeSquares(next);
        const existing = state.squaresByPage.get(pageId);
        if (!sameSquareList(existing, squares)) {
          state.squaresByPage.set(pageId, squares);
          syncCountFromSquares(getPage(pageId));
          changed.add('squares');
          if (pageId === state.currentPageId) changed.add('pages');
        }
        continue;
      }

      if (key === STORAGE_KEYS.settings) {
        const settings = mergeSettings(next);
        if (JSON.stringify(settings) !== JSON.stringify(state.settings)) {
          state.settings = settings;
          changed.add('settings');
        }
        continue;
      }

      if (key === STORAGE_KEYS.smartSettings) {
        const smart = mergeSmartSettings(next);
        if (JSON.stringify(smart) !== JSON.stringify(state.smartSettings)) {
          state.smartSettings = smart;
          state.ui.perfMode = smart.perfMode !== false;
          changed.add('smartSettings');
          changed.add('ui');
        }
        continue;
      }

      if (key === STORAGE_KEYS.searchEngine && CONFIG.searchEngines[next]) {
        if (next !== state.searchEngine) {
          state.searchEngine = next;
          changed.add('searchEngine');
        }
      }
    }

    if (changed.size) scheduleNotify(changed);
  });
}

/* ------------------------------ 书签 ------------------------------ */

async function ensureSquares(pageId) {
  if (!pageId) return [];
  const cached = state.squaresByPage.get(pageId);
  if (Array.isArray(cached)) return cached;
  const squares = await loadSquares(pageId);
  state.squaresByPage.set(pageId, squares);
  syncCountFromSquares(getPage(pageId));
  scheduleNotify(['squares']);
  return squares;
}

function getSquares(pageId = state.currentPageId) {
  if (!pageId) return [];
  return state.squaresByPage.get(pageId) || [];
}

function getVisibleSquares() {
  const squares = getSquares();
  if (!state.currentFolder) return squares;
  return squares.filter((item) => (item.folder || '') === state.currentFolder);
}

function getCurrentPage() {
  return getPage();
}

async function addBookmark({ url, title, folder } = {}) {
  if (!isHttpUrl(url)) return { ok: false, reason: 'invalid-url' };
  const page = getCurrentPage();
  if (!page) return { ok: false, reason: 'no-page' };

  const squares = await ensureSquares(page.id);
  if (squares.some((item) => item.url === url)) return { ok: false, reason: 'duplicate' };

  const targetFolder = typeof folder === 'string' ? folder : state.currentFolder || '';
  const square = {
    url,
    title: (title && String(title).trim()) || titleFromUrl(url),
    folder: targetFolder
  };

  squares.push(square);
  page.bookmarkCount = squares.length;
  if (targetFolder && !(page.subfolders || []).includes(targetFolder)) {
    page.subfolders = [...(page.subfolders || []), targetFolder];
  }

  await Promise.all([persistSquares(page.id), persistPages()]);
  scheduleNotify(['squares', 'pages']);
  return { ok: true, square, pageId: page.id };
}

async function updateBookmark(url, patch = {}) {
  const page = getCurrentPage();
  if (!page || !url) return { ok: false, reason: 'no-page' };
  const squares = await ensureSquares(page.id);
  const target = squares.find((item) => item.url === url);
  if (!target) return { ok: false, reason: 'not-found' };

  if (typeof patch.title === 'string' && patch.title.trim()) target.title = patch.title.trim();
  if (typeof patch.folder === 'string') {
    target.folder = patch.folder;
    // 改到新分类时同步登记到页面 subfolders，保证侧栏二级分类/筛选条不缺项
    if (patch.folder && !(page.subfolders || []).includes(patch.folder)) {
      page.subfolders = [...(page.subfolders || []), patch.folder];
      await persistPages();
      scheduleNotify(['pages']);
    }
  }

  await persistSquares(page.id);
  scheduleNotify(['squares']);
  return { ok: true, square: target };
}

async function removeBookmark(url) {
  const page = getCurrentPage();
  if (!page || !url) return { ok: false, reason: 'no-page' };
  const squares = await ensureSquares(page.id);
  const index = squares.findIndex((item) => item.url === url);
  if (index < 0) return { ok: false, reason: 'not-found' };

  squares.splice(index, 1);
  page.bookmarkCount = squares.length;
  await Promise.all([persistSquares(page.id), persistPages()]);
  scheduleNotify(['squares', 'pages']);
  return { ok: true };
}

/**
 * 按当前可见顺序重排（支持分类过滤视图）：
 * 只把「可见项」重排回它们原本占据的位置，其余分类的顺序保持不变。
 */
async function reorderSquares(orderedUrls) {
  const page = getCurrentPage();
  if (!page || !Array.isArray(orderedUrls)) return false;

  const full = await ensureSquares(page.id);
  const visible = getVisibleSquares();
  if (visible.length !== orderedUrls.length) return false;

  const byUrl = new Map(visible.map((item) => [item.url, item]));
  const orderedVisible = orderedUrls.map((url) => byUrl.get(url)).filter(Boolean);
  if (orderedVisible.length !== visible.length) return false;

  const visibleSet = new Set(visible.map((item) => item.url));
  let cursor = 0;
  const next = full.map((item) => (visibleSet.has(item.url) ? orderedVisible[cursor++] : item));
  if (sameSquareList(next, full)) return false;

  state.squaresByPage.set(page.id, next);
  await persistSquares(page.id);
  scheduleNotify(['squares']);
  return true;
}

function setFolder(folder) {
  const next = typeof folder === 'string' ? folder : '';
  if (next === state.currentFolder) return;
  state.currentFolder = next;
  scheduleNotify(['currentFolder']);
}

/* ------------------------------ 页面 ------------------------------ */

async function selectPage(pageId) {
  if (!pageId || pageId === state.currentPageId) return;
  if (!state.pages.some((page) => page.id === pageId)) return;

  await writes.flush();
  state.currentPageId = pageId;
  state.currentFolder = '';
  persistCurrentPage();
  await ensureSquares(pageId);
  scheduleNotify(['currentPageId', 'currentFolder', 'squares', 'pages']);
}

async function createPage(name) {
  return createPageInternal(name, { select: true });
}

async function deletePage(pageId) {
  if (!pageId) return { ok: false, reason: 'no-page' };
  if (state.pages.length <= 1) return { ok: false, reason: 'last-page' };
  const index = state.pages.findIndex((page) => page.id === pageId);
  if (index < 0) return { ok: false, reason: 'not-found' };

  state.pages.splice(index, 1);
  state.squaresByPage.delete(pageId);
  writes.removeKey(STORAGE_KEYS.squares(pageId), { immediate: true });

  if (state.currentPageId === pageId) {
    const fallback = state.pages[Math.min(index, state.pages.length - 1)];
    state.currentPageId = fallback ? fallback.id : null;
    state.currentFolder = '';
    persistCurrentPage();
    if (state.currentPageId) await ensureSquares(state.currentPageId);
  }

  await persistPages(true);
  scheduleNotify(['pages', 'currentPageId', 'currentFolder', 'squares']);
  return { ok: true };
}

async function renamePage(pageId, name) {
  const page = getPage(pageId);
  if (!page) return { ok: false, reason: 'not-found' };
  const next = (name || '').trim();
  if (!next || next === page.name) return { ok: false, reason: 'unchanged' };
  page.name = next;
  await persistPages(true);
  scheduleNotify(['pages']);
  return { ok: true };
}

/* ------------------------------ 设置/UI ------------------------------ */

async function updateSmartSettings(patch = {}) {
  state.smartSettings = mergeSmartSettings({ ...state.smartSettings, ...patch });
  state.ui.perfMode = state.smartSettings.perfMode !== false;
  await persistSmartSettings();
  scheduleNotify(['smartSettings', 'ui']);
  return state.smartSettings;
}

async function updateSettings(patch = {}) {
  const next = { ...state.settings, ...patch };
  if (patch.background) next.background = { ...state.settings.background, ...patch.background };
  state.settings = mergeSettings(next);
  await persistSettings();
  scheduleNotify(['settings']);
  return state.settings;
}

async function setSearchEngine(engineKey) {
  if (!CONFIG.searchEngines[engineKey]) return state.searchEngine;
  state.searchEngine = engineKey;
  writes.enqueue(
    STORAGE_KEYS.searchEngine,
    () => state.searchEngine,
    { immediate: true }
  );
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem('currentSearchEngine', engineKey);
  } catch (error) {
    /* 忽略 */
  }
  scheduleNotify(['searchEngine']);
  return engineKey;
}

function setUi(patch = {}) {
  const next = { ...state.ui, ...patch };
  const sidebarChanged = next.sidebarOpen !== state.ui.sidebarOpen;
  state.ui = next;
  if (sidebarChanged) writeSidebarState(Boolean(next.sidebarOpen));
  scheduleNotify(['ui']);
}

function subscribe(listener) {
  if (typeof listener !== 'function') return () => {};
  listeners.add(listener);
  return () => listeners.delete(listener);
}

async function flush() {
  await writes.flush();
}

/** 供调试/性能标记使用 */
export const store = {
  get state() {
    return state;
  },
  init,
  subscribe,
  flush,
  getPage,
  getCurrentPage,
  getSquares,
  getVisibleSquares,
  ensureSquares,
  addBookmark,
  updateBookmark,
  removeBookmark,
  reorderSquares,
  setFolder,
  selectPage,
  createPage,
  deletePage,
  renamePage,
  updateSettings,
  updateSmartSettings,
  setSearchEngine,
  setUi
};

export { CONFIG, DEFAULT_SETTINGS, DEFAULT_SMART };
export default store;
