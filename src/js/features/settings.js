/**
 * features/settings.js — 背景 / 性能 / 智能设置的读取、保存、应用。
 *
 * 合并旧 utils/settings-manager.js + utils/animation.js + utils/background-manager.js 的职责：
 * - loadSettings() / saveSmartSettings() / saveBackgroundSettings()：基于 core/storage 的持久化；
 * - applyPerfMode()：切 body.perf-mode；
 * - applyBackground()：背景层交叉淡入（两层 opacity 过渡），性能模式/减少动态时直接切换。
 *
 * 约定：
 * - 只依赖 core，不 import ui；DOM 操作只发生在 apply* 函数内（import 时零副作用）。
 * - 不创建 hover 特效样式（由 CSS 负责），不输出 console 噪音。
 * - 单一写者：页面内持久化优先走 store.updateSmartSettings / store.updateSettings，
 *   之后调 applyPerfMode / applyBackground 做 DOM 应用；本模块的 save* 供非页面场景
 *   或兼容调用，不要与 store 并行写同一个 storage key。
 *
 * @module features/settings
 */

import { DEFAULT_SETTINGS } from '../core/config.js';
import { storage, mergeSettings, mergeSmartSettings, STORAGE_KEYS } from '../core/storage.js';
import { prefersReducedMotion } from '../core/utils.js';

/** 背景交叉淡入时长（与 perf.css / layout.css 中的 transition 保持一致） */
export const FADE_MS = 600;

const SETTINGS_KEY = STORAGE_KEYS.settings;
const SMART_KEY = STORAGE_KEYS.smartSettings;
const LAYER_CLASS = 'background-layer';
const OLD_LAYER_CLASS = 'background-layer-old';
const CONTAINER_SELECTOR = '.container';

function hasDom() {
  return typeof document !== 'undefined' && Boolean(document.body);
}

/** 合并背景/外观默认值（供 store 与设置面板复用） */
export function normalizeSettings(raw) {
  return mergeSettings(raw);
}

/** 合并智能分类默认值（供 store 与设置面板复用） */
export function normalizeSmartSettings(raw) {
  return mergeSmartSettings(raw);
}

/**
 * 读取设置：一次 storage.get 拿全，缺省值与 DEFAULT_SETTINGS / DEFAULT_SMART 合并。
 * @returns {Promise<{ settings: object, smartSettings: object }>}
 */
export async function loadSettings() {
  const data = await storage.get([SETTINGS_KEY, SMART_KEY]);
  return {
    settings: mergeSettings(data[SETTINGS_KEY]),
    smartSettings: mergeSmartSettings(data[SMART_KEY])
  };
}

/**
 * 保存智能分类设置（增量合并；只写 smartSettings 一个 key）。
 * @param {object} patch 例如 { apiKey, model, autoClassify, taxonomy, perfMode }
 * @returns {Promise<object>} 合并后的完整 smartSettings
 */
export async function saveSmartSettings(patch) {
  const data = await storage.get(SMART_KEY);
  const current = data[SMART_KEY];
  const next = mergeSmartSettings({ ...(current && typeof current === 'object' ? current : {}), ...(patch || {}) });
  await storage.set({ [SMART_KEY]: next });
  return next;
}

function isBackgroundObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value) &&
    ('type' in value || 'value' in value || 'blur' in value || 'brightness' in value);
}

/**
 * 保存背景设置。参数既可以是完整 settings（含 background），也可以直接是 background。
 * @param {object} settings
 * @returns {Promise<object>} 合并后的完整 settings
 */
export async function saveBackgroundSettings(settings) {
  const data = await storage.get(SETTINGS_KEY);
  const current = mergeSettings(data[SETTINGS_KEY]);
  const source = settings && typeof settings === 'object' ? settings : {};

  let next;
  if (isBackgroundObject(source)) {
    next = { ...current, background: { ...DEFAULT_SETTINGS.background, ...source } };
  } else {
    next = {
      ...current,
      ...source,
      background: source.background
        ? { ...current.background, ...source.background }
        : current.background
    };
  }

  await storage.set({ [SETTINGS_KEY]: next });
  return next;
}

/** 切换 body.perf-mode（性能模式降级）；返回是否成功操作 DOM */
export function applyPerfMode(enabled) {
  if (!hasDom()) return false;
  document.body.classList.toggle('perf-mode', Boolean(enabled));
  return true;
}

/** 当前是否处于性能模式 */
export function isPerfMode() {
  if (!hasDom()) return false;
  return document.body.classList.contains('perf-mode');
}

/** 提取并补全 background 对象（允许传完整 settings 或 background 本身） */
function extractBackground(settings) {
  const source = settings && typeof settings === 'object' && settings.background ? settings.background : settings;
  return { ...DEFAULT_SETTINGS.background, ...(source && typeof source === 'object' ? source : {}) };
}

function backgroundLayers() {
  if (!hasDom()) return [];
  return Array.from(document.querySelectorAll('.' + LAYER_CLASS + ', .' + OLD_LAYER_CLASS));
}

function detach(node) {
  if (node && node.parentNode) node.parentNode.removeChild(node);
}

function detachLater(node) {
  if (typeof setTimeout === 'function') setTimeout(() => detach(node), FADE_MS);
  else detach(node);
}

function nextFrame(callback) {
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => callback());
  else setTimeout(callback, 16);
}

/**
 * 应用背景（交叉淡入，仅改 opacity/filter，走合成层）。
 * - 性能模式 / prefers-reduced-motion：直接切换，不做过渡；
 * - type === 'none'：淡出并移除背景层，恢复容器底色；
 * - 不再创建任何 hover 特效样式（CSS 已覆盖）。
 *
 * @param {object} settings 完整 settings 或 background 对象
 * @returns {HTMLElement|null} 新建的背景层（无背景/无 DOM 时为 null）
 */
export function applyBackground(settings) {
  if (!hasDom()) return null;

  const background = extractBackground(settings);
  const container = document.querySelector(CONTAINER_SELECTOR);
  const layers = backgroundLayers();
  const hasImage = background.type === 'image' && Boolean(background.value);
  const instant = isPerfMode() || prefersReducedMotion();

  if (!hasImage) {
    if (container) {
      container.style.background = '';
      container.style.backgroundColor = '#202124';
    }
    for (const layer of layers) {
      layer.style.opacity = '0';
      if (instant) detach(layer);
      else detachLater(layer);
    }
    return null;
  }

  const layer = document.createElement('div');
  layer.className = LAYER_CLASS;
  layer.style.backgroundImage = 'url(' + background.value + ')';
  layer.style.filter = 'blur(' + background.blur + 'px) brightness(' + background.brightness + '%)';
  layer.style.opacity = instant ? '1' : '0';
  document.body.insertBefore(layer, document.body.firstChild);

  for (const old of layers) {
    old.classList.remove(LAYER_CLASS);
    old.classList.add(OLD_LAYER_CLASS);
    old.style.opacity = '0';
    if (instant) detach(old);
    else detachLater(old);
  }

  if (container) container.style.background = 'transparent';

  if (!instant) nextFrame(() => { layer.style.opacity = '1'; });
  return layer;
}
