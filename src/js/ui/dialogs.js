/**
 * ui/dialogs.js — 命名弹窗 / 输入弹窗 / 确认弹窗 / Toast。
 *
 * 行为对齐旧实现（paste.js 的 createNameDialog + ConfigManager.showToast），但命名弹窗
 * 标题改为**纯本地推断**（不发任何网络请求、不等待网络，弹窗即时打开）：
 *   - 已知站点：CONFIG.websiteTitles 按 hostname 匹配（如 github.com → GitHub）；
 *   - 其他站点：core/utils.titleFromUrl 的域名友好标题（如 foo.example.com → Foo）；
 *   - 标题始终可编辑，确认返回 {url,name}，取消返回 null；
 * - 全部用 DOM API 构建（无 innerHTML 注入）；
 * - 同一时刻只有一个弹窗；Esc 取消、Enter 确认、Tab 焦点陷阱、点击遮罩取消；
 * - Toast 单例复用，showToast(text, type) 替代旧的 ConfigManager.showToast。
 *
 * 依赖：core/dom、core/utils、core/config。不依赖 store。
 */

import { el, on } from '../core/dom.js';
import { CONFIG } from '../core/config.js';
import { faviconUrl, titleFromUrl } from '../core/utils.js';

const CLOSE_MS = 300;

let activeDialog = null;
let toastNode = null;
let toastTimer = 0;

/* ------------------------------ 标题推断（纯本地） ------------------------------ */

/** 已知站点标题（CONFIG.websiteTitles 命中，按 hostname 匹配） */
function knownTitle(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    for (const [domain, title] of Object.entries(CONFIG.websiteTitles || {})) {
      if (host.includes(domain)) return title;
    }
  } catch (error) {
    /* URL 非法时忽略 */
  }
  return '';
}

/** 弹窗初始标题：已知站点 → 域名友好标题（无网络请求） */
export function guessTitle(url) {
  return knownTitle(url) || titleFromUrl(url) || '网站';
}

/* ------------------------------ 通用弹窗 ------------------------------ */

/**
 * @param {object} options
 * @param {string} [options.title]            标题（有则渲染 header）
 * @param {Node[]} [options.headerNodes]      header 内除标题外的节点（命名弹窗的图标/URL）
 * @param {string} [options.message]          正文说明
 * @param {(content: HTMLElement) => {getValue?: () => string, focusEl?: HTMLElement, select?: boolean}} [options.build]
 * @param {string} [options.confirmText]
 * @param {string} [options.cancelText]
 * @param {boolean} [options.danger]
 * @returns {Promise<{confirmed: boolean, value: string}>}
 */
function openModal(options = {}) {
  const {
    title = '',
    headerNodes = [],
    message = '',
    build = null,
    confirmText = '确认',
    cancelText = '取消',
    danger = false
  } = options;

  if (activeDialog) closeActiveDialogNow();

  const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;

  const overlay = el('div', { className: 'dialog-overlay' });
  const card = el('div', { className: 'name-dialog', attrs: { role: 'dialog', 'aria-modal': 'true' } });

  const titleId = 'dialog-title-' + Math.random().toString(36).slice(2, 8);
  if (title || headerNodes.length) {
    const header = el('div', { className: 'name-dialog-header' });
    for (const node of headerNodes) header.appendChild(node);
    if (title) header.appendChild(el('h3', { className: 'dialog-title', text: title, attrs: { id: titleId } }));
    card.appendChild(header);
    if (title) card.setAttribute('aria-labelledby', titleId);
  }

  const content = el('div', { className: 'name-dialog-content' });
  if (message) content.appendChild(el('p', { className: 'dialog-message', text: message }));
  let controller = null;
  if (typeof build === 'function') controller = build(content) || null;
  card.appendChild(content);

  const footer = el('div', { className: 'name-dialog-footer' });
  const cancelBtn = el('button', {
    className: 'dialog-btn btn-cancel',
    type: 'button',
    text: cancelText
  });
  const confirmBtn = el('button', {
    className: 'dialog-btn btn-confirm' + (danger ? ' btn-danger' : ''),
    type: 'button',
    text: confirmText
  });
  footer.appendChild(cancelBtn);
  footer.appendChild(confirmBtn);
  card.appendChild(footer);
  overlay.appendChild(card);
  document.body.appendChild(overlay);

  return new Promise((resolve) => {
    let settled = false;
    const disposers = [];
    let closeTimer = 0;

    function cleanup() {
      for (const dispose of disposers.splice(0)) {
        try {
          dispose();
        } catch (error) {
          /* 忽略 */
        }
      }
    }

    function finish(confirmed) {
      if (settled) return;
      settled = true;
      cleanup();
      const value = confirmed && controller && typeof controller.getValue === 'function'
        ? String(controller.getValue() == null ? '' : controller.getValue())
        : '';
      if (activeDialog && activeDialog.overlay === overlay) activeDialog = null;

      overlay.classList.add('closing');
      card.classList.add('closing');
      closeTimer = setTimeout(() => {
        overlay.remove();
        if (!activeDialog && previousFocus && previousFocus.isConnected && typeof previousFocus.focus === 'function') {
          try {
            previousFocus.focus({ preventScroll: true });
          } catch (error) {
            /* 忽略 */
          }
        }
      }, CLOSE_MS);

      resolve({ confirmed, value });
    }

    function cancel() {
      finish(false);
    }

    function confirm() {
      finish(true);
    }

    // 按钮 / 遮罩
    disposers.push(on(cancelBtn, 'click', cancel));
    disposers.push(on(confirmBtn, 'click', confirm));
    disposers.push(on(overlay, 'click', (event) => {
      if (event.target === overlay) cancel();
    }));

    // 键盘：Esc 取消、Enter 确认、Tab 循环（capture：优先于页面级 Esc 处理）
    disposers.push(on(document, 'keydown', (event) => {
      if (event.isComposing) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        cancel();
        return;
      }
      if (event.key === 'Tab') {
        const focusables = Array.from(card.querySelectorAll('button, input, [tabindex]:not([tabindex="-1"])'))
          .filter((node) => node.getClientRects().length > 0);
        if (!focusables.length) {
          event.preventDefault();
          return;
        }
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
        return;
      }
      if (event.key === 'Enter' && !event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey) {
        const active = document.activeElement;
        if (active === cancelBtn) {
          event.preventDefault();
          cancel();
          return;
        }
        if (active && active.tagName === 'TEXTAREA') return;
        event.preventDefault();
        confirm();
      }
    }, { capture: true }));

    activeDialog = {
      overlay,
      card,
      close: () => {
        if (!settled) finish(false);
        else if (closeTimer) clearTimeout(closeTimer);
        overlay.remove();
      }
    };

    // 初始焦点
    const focusTarget = (controller && controller.focusEl) || confirmBtn;
    try {
      focusTarget.focus({ preventScroll: true });
      if (controller && controller.select && typeof focusTarget.select === 'function') focusTarget.select();
    } catch (error) {
      /* 忽略 */
    }
  });
}

/** 立即移除当前弹窗（不播放关闭动画；用于页面卸载/打开新弹窗） */
function closeActiveDialogNow() {
  if (!activeDialog) return;
  const current = activeDialog;
  activeDialog = null;
  current.overlay.remove();
}

/* ------------------------------ 对外弹窗 ------------------------------ */

/**
 * 命名弹窗（粘贴/拖入 URL 后使用）。
 * @param {string} url
 * @param {string} [initialName]
 * @returns {Promise<{url: string, name: string} | null>}
 */
export function createNameDialog(url, initialName = '') {
  const fallback = initialName || guessTitle(url);

  const icon = el('div', { className: 'site-icon', style: { backgroundImage: `url("${faviconUrl(url)}")` } });
  const urlText = el('div', { className: 'site-url', text: url });

  return openModal({
    headerNodes: [icon, urlText],
    confirmText: '确认',
    cancelText: '取消',
    build(content) {
      const inputEl = el('input', {
        className: 'name-input',
        type: 'text',
        value: fallback,
        attrs: { placeholder: '输入网站名称', autocomplete: 'off', spellcheck: 'false' }
      });
      content.appendChild(inputEl);
      return {
        getValue: () => inputEl.value.trim() || fallback,
        focusEl: inputEl,
        select: true
      };
    }
  }).then((result) => (result.confirmed ? { url, name: result.value || fallback } : null));
}

/**
 * 输入弹窗（页面重命名 / 书签改标题）。
 * @param {{title?: string, message?: string, value?: string, placeholder?: string, confirmText?: string, cancelText?: string}} options
 * @returns {Promise<string | null>} 确认返回 trim 后的非空字符串，否则 null
 */
export function promptDialog(options = {}) {
  const { title = '', message = '', value = '', placeholder = '', confirmText = '保存', cancelText = '取消' } = options;
  return openModal({
    title,
    message,
    confirmText,
    cancelText,
    build(content) {
      const input = el('input', {
        className: 'name-input',
        type: 'text',
        value,
        attrs: { placeholder, autocomplete: 'off', spellcheck: 'false' }
      });
      content.appendChild(input);
      return {
        getValue: () => input.value.trim(),
        focusEl: input,
        select: true
      };
    }
  }).then((result) => {
    if (!result.confirmed) return null;
    return result.value ? result.value : null;
  });
}

/**
 * 确认弹窗。
 * @param {{title?: string, message?: string, confirmText?: string, cancelText?: string, danger?: boolean}} options
 * @returns {Promise<boolean>}
 */
export function confirmDialog(options = {}) {
  const { title = '确认', message = '', confirmText = '确定', cancelText = '取消', danger = false } = options;
  return openModal({ title, message, confirmText, cancelText, danger }).then((result) => result.confirmed);
}

/* ------------------------------ Toast ------------------------------ */

/**
 * Toast（单例复用，避免频繁创建/销毁节点）。
 * @param {string} text
 * @param {'success'|'error'|'info'|'warning'} [type]
 */
export function showToast(text, type = 'success') {
  if (typeof document === 'undefined' || !document.body) return;
  if (!toastNode) {
    toastNode = el('div', { className: 'toast', attrs: { role: 'status', 'aria-live': 'polite' } });
    document.body.appendChild(toastNode);
  }
  toastNode.className = 'toast ' + (type || 'success');
  toastNode.textContent = String(text == null ? '' : text);
  // 强制回流以重启动画
  void toastNode.offsetWidth;
  toastNode.classList.add('show');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    if (toastNode) toastNode.classList.remove('show');
  }, 2800);
}

/** 当前是否有弹窗打开（粘贴等流程可据此避免叠加） */
export function isDialogOpen() {
  return Boolean(activeDialog);
}

/** 页面卸载清理 */
export function destroyDialogs() {
  closeActiveDialogNow();
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = 0;
  if (toastNode) {
    toastNode.remove();
    toastNode = null;
  }
}
