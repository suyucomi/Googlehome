/**
 * ui/frame.js — UI 层公共小工具（无业务状态）：
 *
 * 1. createRenderQueue(render)：把渲染合并到同一帧（复用 core/dom 的 batch），
 *    订阅 store 的模块用它避免「一次状态变化触发多次重绘」；
 * 2. 浮层定位：flyout / 右键菜单 / 下拉统一 clamp 到 visualViewport，
 *    保证左右下边界不越界（布局审计要求）；
 * 3. 焦点工具：focusableWithin / trapTab，供设置面板与弹窗复用。
 */

import { batch } from '../core/dom.js';
import { clamp } from '../core/utils.js';

/** 可聚焦元素选择器（排除 disabled / 隐藏 input） */
export const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])'
].join(', ');

/**
 * 渲染队列：schedule() 在同一帧只执行一次 render；runNow() 立即执行（挂载/打开浮层时用）。
 * @param {() => void} render
 * @returns {{ schedule: () => void, runNow: () => void, dispose: () => void }}
 */
export function createRenderQueue(render) {
  let destroyed = false;
  function run() {
    if (destroyed) return;
    try {
      render();
    } catch (error) {
      console.error('[ui] 渲染失败:', error);
    }
  }
  return {
    schedule() {
      if (destroyed) return;
      batch(run);
    },
    runNow() {
      run();
    },
    dispose() {
      destroyed = true;
    }
  };
}

/** 当前可见视口矩形（考虑 visualViewport 偏移，桌面无缩放时等于 innerWidth/Height） */
export function viewportRect() {
  const vv = typeof window !== 'undefined' ? window.visualViewport : null;
  if (vv) {
    return {
      left: vv.offsetLeft,
      top: vv.offsetTop,
      right: vv.offsetLeft + vv.width,
      bottom: vv.offsetTop + vv.height,
      width: vv.width,
      height: vv.height
    };
  }
  const width = window.innerWidth;
  const height = window.innerHeight;
  return { left: 0, top: 0, right: width, bottom: height, width, height };
}

function sizeOf(node) {
  return {
    width: node.offsetWidth || node.getBoundingClientRect().width || 0,
    height: node.offsetHeight || node.getBoundingClientRect().height || 0
  };
}

/** 把浮层摆到锚点右侧；右边放不下就翻到左侧；四边 clamp 到视口内 */
export function placeBeside(node, anchor, { gap = 10, margin = 8 } = {}) {
  const view = viewportRect();
  const rect = anchor.getBoundingClientRect();
  const { width, height } = sizeOf(node);

  let left = rect.right + gap;
  if (left + width > view.right - margin) left = rect.left - width - gap;
  left = clamp(left, view.left + margin, Math.max(view.left + margin, view.right - width - margin));

  const top = clamp(
    rect.top,
    view.top + margin,
    Math.max(view.top + margin, view.bottom - height - margin)
  );

  node.style.left = Math.round(left) + 'px';
  node.style.top = Math.round(top) + 'px';
  return { left, top, width, height };
}

/** 把浮层摆到指针位置（右键菜单）；右下越界时回翻并 clamp */
export function placeAt(node, x, y, { margin = 8 } = {}) {
  const view = viewportRect();
  const { width, height } = sizeOf(node);

  let left = x;
  let top = y;
  if (left + width > view.right - margin) left = view.right - width - margin;
  if (top + height > view.bottom - margin) top = view.bottom - height - margin;
  left = Math.max(view.left + margin, left);
  top = Math.max(view.top + margin, top);

  node.style.left = Math.round(left) + 'px';
  node.style.top = Math.round(top) + 'px';
  return { left, top, width, height };
}

/** 浮层是否已超出可视区（滚动/resize 时需要收起） */
export function isOutOfViewport(node) {
  if (!node || !node.isConnected) return true;
  const view = viewportRect();
  const rect = node.getBoundingClientRect();
  return (
    rect.bottom < view.top ||
    rect.right < view.left ||
    rect.top > view.bottom ||
    rect.left > view.right
  );
}

/** 容器内真实可见、可聚焦的元素列表（按 DOM 顺序） */
export function focusableWithin(container) {
  if (!container) return [];
  return Array.from(container.querySelectorAll(FOCUSABLE_SELECTOR)).filter((node) => {
    if (node.hasAttribute('inert') || node.closest('[inert]')) return false;
    return node.getClientRects().length > 0;
  });
}

/**
 * Tab 焦点陷阱：在 container 内循环；返回是否已处理（调用方据此 preventDefault）。
 * @param {KeyboardEvent} event
 * @param {HTMLElement} container
 */
export function trapTab(event, container) {
  if (!event || event.key !== 'Tab' || !container) return false;
  const focusables = focusableWithin(container);
  if (!focusables.length) return true;
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  const active = document.activeElement;
  const inside = container.contains(active);

  if (event.shiftKey) {
    if (!inside || active === first) {
      event.preventDefault();
      last.focus();
      return true;
    }
    return false;
  }
  if (!inside || active === last) {
    event.preventDefault();
    first.focus();
    return true;
  }
  return false;
}
