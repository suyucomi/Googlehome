/**
 * features/import-export.js — 配置导入导出（原 utils/config-manager.js 的数据层）。
 *
 * 只做数据读写与校验；下载 / toast / confirm / 刷新等 UI 副作用由调用方（ui/dialogs）
 * 通过 hooks 注入，features 层不 import ui、不直接操作 DOM。
 *
 * 导出 JSON 结构与 v1.x 完全一致：
 * { version, timestamp, settings, searchEngine, bookmarkPages, currentPageId, pages, legacySquares }
 * 导入同时兼容旧格式（config.squares / config.legacySquares）。
 *
 * @module features/import-export
 */

import { storage, STORAGE_KEYS } from '../core/storage.js';

const PAGES_KEY = STORAGE_KEYS.pageList;
const CURRENT_PAGE_KEY = STORAGE_KEYS.currentPage;
const SETTINGS_KEY = STORAGE_KEYS.settings;
const SEARCH_ENGINE_KEY = STORAGE_KEYS.searchEngine;
const LEGACY_SQUARES_KEY = 'squares';

/** 导出文件里的 version 字段（保持 v1.x 兼容） */
export const EXPORT_VERSION = '1.1';

/** 默认搜索引号（旧导出的兜底值） */
export const DEFAULT_SEARCH_ENGINE = 'google';

function isSquaresArray(value) {
  return Array.isArray(value) && value.every(
    (s) => s && typeof s.url === 'string' && typeof s.title === 'string'
  );
}

/**
 * 校验配置文件（与旧 ConfigManager.validateConfig 规则一致）。
 * @param {any} config
 * @returns {boolean}
 */
export function validateConfig(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) return false;
  if (!config.version) return false;
  if (config.squares && !isSquaresArray(config.squares)) return false;
  if (config.legacySquares && !isSquaresArray(config.legacySquares)) return false;
  if (config.bookmarkPages) {
    if (!Array.isArray(config.bookmarkPages)) return false;
    if (!config.bookmarkPages.every((p) => p && typeof p.id === 'string' && typeof p.name === 'string')) return false;
    if (config.pages) {
      const ids = Object.keys(config.pages);
      for (const id of ids) {
        if (!isSquaresArray(config.pages[id])) return false;
      }
    }
  }
  return true;
}

/**
 * 收集当前全部配置（只读 storage，不做任何 UI 副作用）。
 * @returns {Promise<object>} 与旧导出一致的 JSON 结构
 */
export async function buildExportConfig() {
  const data = await storage.get([
    SETTINGS_KEY,
    LEGACY_SQUARES_KEY,
    SEARCH_ENGINE_KEY,
    PAGES_KEY,
    CURRENT_PAGE_KEY
  ]);

  const bookmarkPages = Array.isArray(data[PAGES_KEY]) ? data[PAGES_KEY] : [];
  const pages = {};

  const ids = bookmarkPages.map((page) => page && page.id).filter(Boolean);
  if (ids.length) {
    const results = await Promise.all(ids.map((id) => storage.get('squares_' + id)));
    ids.forEach((id, index) => {
      const value = results[index] && results[index]['squares_' + id];
      pages[id] = Array.isArray(value) ? value : [];
    });
  }

  return {
    version: EXPORT_VERSION,
    timestamp: new Date().toISOString(),
    settings: data[SETTINGS_KEY] || {},
    searchEngine: data[SEARCH_ENGINE_KEY] || DEFAULT_SEARCH_ENGINE,
    bookmarkPages,
    currentPageId: data[CURRENT_PAGE_KEY] || null,
    pages,
    legacySquares: Array.isArray(data[LEGACY_SQUARES_KEY]) ? data[LEGACY_SQUARES_KEY] : []
  };
}

/**
 * 导出文件名（search-config-YYYY-MM-DD.json）。
 * @param {Date} [date]
 */
export function exportFilename(date = new Date()) {
  const day = date.toISOString().split('T')[0];
  return 'search-config-' + day + '.json';
}

/**
 * 导出配置。
 * hooks:
 *  - download({ filename, json, data, mime }): 由 ui 落盘（Blob + <a download>）
 *  - notify(message, type): toast 回调
 * @returns {Promise<{ok:boolean, filename?:string, data?:object, json?:string, error?:string}>}
 */
export async function exportConfig(hooks = {}) {
  try {
    const data = await buildExportConfig();
    const filename = exportFilename();
    const json = JSON.stringify(data, null, 2);

    if (typeof hooks.download === 'function') {
      await hooks.download({ filename, json, data, mime: 'application/json' });
    }
    if (typeof hooks.notify === 'function') hooks.notify('配置已导出', 'success');
    return { ok: true, filename, data, json };
  } catch (error) {
    const message = error && error.message ? error.message : String(error);
    if (typeof hooks.notify === 'function') hooks.notify('导出配置失败: ' + message, 'error');
    return { ok: false, error: message };
  }
}

/**
 * 解析导入输入：支持 File/Blob（有 text()）、JSON 字符串、已解析对象。
 * @param {any} input
 * @returns {Promise<object>}
 */
export async function readConfigFile(input) {
  if (input && typeof input.text === 'function') {
    return JSON.parse(await input.text());
  }
  if (typeof input === 'string') {
    return JSON.parse(input);
  }
  if (input && typeof input === 'object') {
    return input;
  }
  throw new Error('配置文件格式无效');
}

/**
 * 把通过校验的配置写入 storage（先清空旧数据，与旧导入逻辑一致）。
 * 兼容旧格式：config.squares / config.legacySquares。
 * @param {object} config
 * @returns {Promise<object>} 实际写入的键值
 */
export async function writeImportedConfig(config) {
  // 清空旧配置（等价于旧 chrome.storage.local.clear()，但通过 core/storage 统一封装）
  const existing = await storage.get(null);
  const existingKeys = existing && typeof existing === 'object' ? Object.keys(existing) : [];
  if (existingKeys.length) await storage.remove(existingKeys);

  const writes = {};

  if (config.settings && typeof config.settings === 'object') {
    writes[SETTINGS_KEY] = config.settings;
  }
  // 旧格式：直接存储 squares（早期版本）
  if (config.squares) {
    writes[LEGACY_SQUARES_KEY] = config.squares;
  }
  if (config.searchEngine) {
    writes[SEARCH_ENGINE_KEY] = config.searchEngine;
  }

  if (Array.isArray(config.bookmarkPages)) {
    writes[PAGES_KEY] = config.bookmarkPages;
    writes[CURRENT_PAGE_KEY] = config.currentPageId || null;
    for (const page of config.bookmarkPages) {
      if (!page || !page.id) continue;
      const list = config.pages && Array.isArray(config.pages[page.id]) ? config.pages[page.id] : [];
      writes['squares_' + page.id] = list;
    }
  } else if (Array.isArray(config.legacySquares)) {
    // 旧格式：只有一组 squares（无页面列表）
    writes[LEGACY_SQUARES_KEY] = config.legacySquares;
  }

  if (Object.keys(writes).length) await storage.set(writes);
  return writes;
}

/**
 * 导入配置。
 * hooks:
 *  - confirm(message) → boolean：是否继续（ui 提供原生 confirm 或自绘弹窗）
 *  - notify(message, type)：toast 回调
 *  - reload()：导入成功后的刷新（ui 决定延迟）
 * @returns {Promise<{ok:boolean, canceled?:boolean, config?:object, written?:object, error?:string}>}
 */
export async function importConfig(input, hooks = {}) {
  try {
    const config = await readConfigFile(input);
    if (!validateConfig(config)) throw new Error('配置文件格式无效');

    if (typeof hooks.confirm === 'function') {
      const proceed = await hooks.confirm('导入将覆盖现有配置，是否继续？');
      if (!proceed) return { ok: false, canceled: true };
    }

    if (typeof hooks.notify === 'function') hooks.notify('正在导入配置...', 'info');
    const written = await writeImportedConfig(config);
    if (typeof hooks.notify === 'function') hooks.notify('配置导入成功，即将刷新页面', 'success');
    if (typeof hooks.reload === 'function') hooks.reload();

    return { ok: true, config, written };
  } catch (error) {
    const message = error && error.message ? error.message : String(error);
    if (typeof hooks.notify === 'function') hooks.notify('导入配置失败: ' + message, 'error');
    return { ok: false, error: message };
  }
}
