/**
 * core/dom.js — DOM 小工具：查询、创建、事件委托、按帧合并渲染。
 *
 * 约定：
 * - 事件监听必须用 on()/delegate()，返回 dispose()，便于组件卸载；
 * - delegate 的 handler 收到 (event, matchedElement)，不要在子项上逐个绑监听；
 * - 所有渲染任务用 batch(fn) 合并到同一帧，避免同一状态变化触发多次重排。
 */

export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

function appendChild(node, child) {
  if (child == null || child === false) return;
  if (Array.isArray(child)) {
    child.forEach((item) => appendChild(node, item));
    return;
  }
  node.appendChild(child instanceof Node ? child : document.createTextNode(String(child)));
}

/**
 * 创建元素。
 * props 支持：className/class、text/textContent、dataset、style、attrs、on* 事件，其余直接赋属性。
 * 只接受文本子节点/元素，不提供 innerHTML，天然防 XSS。
 */
export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (value == null || value === false) continue;
    if (key === 'className' || key === 'class') {
      node.className = value;
    } else if (key === 'text' || key === 'textContent') {
      node.textContent = String(value);
    } else if (key === 'dataset') {
      Object.assign(node.dataset, value);
    } else if (key === 'style') {
      Object.assign(node.style, value);
    } else if (key === 'attrs') {
      for (const [attr, attrValue] of Object.entries(value)) {
        if (attrValue == null || attrValue === false) continue;
        node.setAttribute(attr, attrValue === true ? '' : String(attrValue));
      }
    } else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key === 'type' || key === 'value' || key === 'checked' || key === 'disabled') {
      node[key] = value;
    } else if (key in node) {
      node[key] = value;
    } else {
      node.setAttribute(key, String(value));
    }
  }
  children.forEach((child) => appendChild(node, child));
  return node;
}

/** 绑定事件，返回 dispose() */
export function on(target, type, handler, options = {}) {
  if (!target || typeof target.addEventListener !== 'function') return () => {};
  const controller = new AbortController();
  target.addEventListener(type, handler, { ...options, signal: controller.signal });
  return () => controller.abort();
}

/** 事件委托：handler(event, matchedElement)；返回 dispose() */
export function delegate(root, type, selector, handler, options = {}) {
  if (!root || typeof root.addEventListener !== 'function') return () => {};
  const controller = new AbortController();
  root.addEventListener(
    type,
    (event) => {
      const target = event.target instanceof Element ? event.target.closest(selector) : null;
      if (!target || !root.contains(target)) return;
      handler(event, target);
    },
    { ...options, signal: controller.signal }
  );
  return () => controller.abort();
}

/* ---------- 按帧合并渲染 ---------- */

const pending = new Set();
let rafId = 0;
let scheduleFrame = null;

function schedule(fn) {
  if (typeof requestAnimationFrame === 'function') {
    if (!rafId) rafId = requestAnimationFrame(runFrame);
  } else if (!scheduleFrame) {
    scheduleFrame = setTimeout(runFrame, 0);
  }
  pending.add(fn);
}

function runFrame() {
  rafId = 0;
  scheduleFrame = null;
  const tasks = Array.from(pending);
  pending.clear();
  for (const task of tasks) {
    try {
      task();
    } catch (error) {
      console.error('[dom] 渲染任务失败:', error);
    }
  }
}

/**
 * 同一帧内多次调用只执行一次；重复注册同一个 fn 会被去重。
 * 返回取消函数。
 */
export function batch(fn) {
  if (typeof fn !== 'function') return () => {};
  schedule(fn);
  return () => {
    pending.delete(fn);
    if (!pending.size) {
      if (rafId && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(rafId);
      if (scheduleFrame) clearTimeout(scheduleFrame);
      rafId = 0;
      scheduleFrame = null;
    }
  };
}

/** 立即执行所有挂起任务（测试/页面隐藏前刷新用） */
export function flushBatch() {
  if (!pending.size) return;
  const tasks = Array.from(pending);
  pending.clear();
  if (rafId && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(rafId);
  if (scheduleFrame) clearTimeout(scheduleFrame);
  rafId = 0;
  scheduleFrame = null;
  for (const task of tasks) {
    try {
      task();
    } catch (error) {
      console.error('[dom] 渲染任务失败:', error);
    }
  }
}

/* ---------- 属性/文本小工具 ---------- */

export function setText(node, text) {
  if (!node) return;
  const next = String(text == null ? '' : text);
  if (node.textContent !== next) node.textContent = next;
}

export function setAttr(node, name, value) {
  if (!node) return;
  if (value == null || value === false) {
    if (node.hasAttribute(name)) node.removeAttribute(name);
    return;
  }
  const next = value === true ? '' : String(value);
  if (node.getAttribute(name) !== next) node.setAttribute(name, next);
}

export function toggleClass(node, className, force) {
  if (!node) return;
  if (force === undefined) node.classList.toggle(className);
  else node.classList.toggle(className, Boolean(force));
}

/** 元素是否真实可见（有尺寸且未被 hidden/display:none） */
export function isVisible(node) {
  if (!node) return false;
  const rect = node.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}
