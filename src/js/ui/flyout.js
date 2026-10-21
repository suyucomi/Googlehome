/**
 * ui/flyout.js — 二级分类浮层（侧栏页面项 hover / 键盘打开）。
 *
 * 行为：
 * - hover 有 subfolders 的页面项 → 显示；离开延迟隐藏（180ms，方便移到浮层上）；
 * - 固定定位 fixed，位置 clamp 到 visualViewport（左右下不越界）；页面滚动 / resize / 设置打开时收起；
 * - 「全部 / 某分类」→ store.selectPage + store.setFolder；
 * - Esc 关闭；ArrowUp/Down/Home/End 导航；Tab 移出即收起；
 * - 计数来自 store（非当前页会 ensureSquares 懒加载后刷新）。
 *
 * 模块级单例：sidebar 通过 getFlyout() 使用，main.js 先 mountFlyout() 以确定 Esc 优先级。
 */

import { el, on } from '../core/dom.js';
import { store } from '../core/store.js';
import { createRenderQueue, placeBeside } from './frame.js';

let singleton = null;

export function getFlyout() {
  if (!singleton) singleton = createFlyout();
  return singleton;
}

/** 挂载（幂等）；返回 { destroy } */
export function mountFlyout() {
  const instance = getFlyout();
  return {
    destroy() {
      instance.destroy();
      if (singleton === instance) singleton = null;
    }
  };
}

function createFlyout() {
  const node = el('div', {
    className: 'page-subfolder-flyout',
    attrs: { role: 'menu', 'aria-label': '二级分类' }
  });
  document.body.appendChild(node);

  let pageId = null;
  let anchor = null;
  let visible = false;
  let focusFirstPending = false;
  let hideTimer = 0;
  let destroyed = false;

  const disposers = [];
  const renderQueue = createRenderQueue(() => {
    if (visible) renderItems();
  });

  const unsubscribe = store.subscribe((state) => {
    if (destroyed) return;
    if (state.ui.settingsOpen) {
      hide();
      return;
    }
    if (visible) {
      if (!pageId || !state.pages.some((page) => page.id === pageId)) {
        hide();
        return;
      }
      renderQueue.schedule();
    }
  });

  disposers.push(unsubscribe);

  function currentPage() {
    return pageId ? store.getPage(pageId) : null;
  }

  function folderStats(page) {
    const squares = store.getSquares(page.id);
    const counts = new Map();
    for (const item of squares) {
      const folder = item.folder || '';
      if (!folder) continue;
      counts.set(folder, (counts.get(folder) || 0) + 1);
    }
    return { squares, counts };
  }

  /** 分类列表：page.subfolders 顺序优先，再补书签里出现但未登记的 folder */
  function folderList(page, counts) {
    const folders = [];
    for (const folder of page.subfolders || []) {
      if (folder && !folders.includes(folder)) folders.push(folder);
    }
    for (const folder of counts.keys()) {
      if (folder && !folders.includes(folder)) folders.push(folder);
    }
    return folders;
  }

  function isActiveFolder(folder) {
    const state = store.state;
    return state.currentPageId === pageId && (state.currentFolder || '') === folder;
  }

  function makeItem(label, folder, count) {
    const button = el('button', {
      className: 'flyout-item' + (isActiveFolder(folder) ? ' active' : ''),
      type: 'button',
      attrs: {
        role: 'menuitem',
        'data-folder': folder,
        tabindex: '-1',
        'aria-label': folder ? `${label}，${count} 个书签` : `全部，${count} 个书签`
      }
    });
    button.append(
      el('span', { className: 'flyout-item-name', text: label }),
      el('span', { className: 'flyout-item-count', text: String(count) })
    );
    return button;
  }

  function renderItems() {
    const page = currentPage();
    if (!page) {
      hide();
      return;
    }
    const { squares, counts } = folderStats(page);
    const total = squares.length || Number(page.bookmarkCount) || 0;

    const fragment = document.createDocumentFragment();
    fragment.appendChild(el('div', { className: 'flyout-heading', text: page.name }));
    fragment.appendChild(makeItem('全部', '', total));
    for (const folder of folderList(page, counts)) {
      fragment.appendChild(makeItem(folder, folder, counts.get(folder) || 0));
    }
    node.replaceChildren(fragment);

    position();
    if (focusFirstPending) {
      focusFirstPending = false;
      focusItem(0);
    }
  }

  function position() {
    if (!anchor || !anchor.isConnected || !visible) return;
    placeBeside(node, anchor);
  }

  function items() {
    return Array.from(node.querySelectorAll('.flyout-item'));
  }

  function focusItem(index) {
    const list = items();
    if (!list.length) return;
    const target = list[Math.max(0, Math.min(index, list.length - 1))];
    try {
      target.focus({ preventScroll: true });
    } catch (error) {
      /* 忽略 */
    }
  }

  function showForPage(pageElement, { focusFirst = false } = {}) {
    if (destroyed) return;
    const id = pageElement && pageElement.dataset ? pageElement.dataset.pageId : '';
    const page = id ? store.getPage(id) : null;
    if (!page) return;

    // 先预热该页书签（非当前页也能显示分类计数），不阻塞浮层出现
    const loaded = store.state.squaresByPage instanceof Map && store.state.squaresByPage.has(page.id);
    const hasSubfolders = (page.subfolders || []).length > 0;
    if (!loaded && !hasSubfolders) {
      // 没有 subfolder 元数据且书签未加载：先加载再决定是否显示
      store.ensureSquares(page.id).then(() => {
        const squares = store.getSquares(page.id);
        if (squares.some((item) => item.folder)) showForPage(pageElement, { focusFirst });
      }).catch(() => {});
      hide();
      return;
    }

    pageId = page.id;
    anchor = pageElement;
    focusFirstPending = Boolean(focusFirst);
    if (hideTimer) {
      clearTimeout(hideTimer);
      hideTimer = 0;
    }
    visible = true;
    node.classList.add('show');
    renderItems();

    if (!loaded) {
      store.ensureSquares(page.id).catch(() => {});
    }
  }

  function scheduleHide(delay = 180) {
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      hideTimer = 0;
      hide();
    }, delay);
  }

  function cancelHide() {
    if (hideTimer) {
      clearTimeout(hideTimer);
      hideTimer = 0;
    }
  }

  function hide() {
    cancelHide();
    const focusInside = node.contains(document.activeElement);
    visible = false;
    focusFirstPending = false;
    node.classList.remove('show');
    const previousAnchor = anchor;
    pageId = null;
    anchor = null;
    if (focusInside && previousAnchor && previousAnchor.isConnected && !previousAnchor.closest('[inert]')) {
      try {
        previousAnchor.focus({ preventScroll: true });
      } catch (error) {
        /* 忽略 */
      }
    }
  }

  /* ---------------- 事件 ---------------- */

  disposers.push(on(node, 'mouseenter', cancelHide));
  disposers.push(on(node, 'mouseleave', () => scheduleHide()));
  disposers.push(on(node, 'focusin', cancelHide));
  disposers.push(on(node, 'focusout', (event) => {
    const next = event.relatedTarget;
    if (next instanceof Node && node.contains(next)) return;
    if (next instanceof Node && anchor && anchor.contains(next)) return;
    scheduleHide();
  }));

  disposers.push(on(node, 'click', async (event) => {
    const target = event.target instanceof Element ? event.target.closest('.flyout-item') : null;
    if (!target || !pageId) return;
    const folder = target.dataset.folder || '';
    const targetPageId = pageId;
    hide();
    try {
      if (store.state.currentPageId !== targetPageId) await store.selectPage(targetPageId);
      store.setFolder(folder);
    } catch (error) {
      console.warn('[flyout] 切换分类失败:', error);
    }
  }));

  disposers.push(on(node, 'keydown', (event) => {
    if (!visible) return;
    const list = items();
    const index = list.indexOf(document.activeElement);
    switch (event.key) {
      case 'Escape':
        event.preventDefault();
        event.stopPropagation();
        hide();
        break;
      case 'ArrowDown':
        event.preventDefault();
        focusItem(index < 0 ? 0 : (index + 1) % list.length);
        break;
      case 'ArrowUp':
        event.preventDefault();
        focusItem(index < 0 ? list.length - 1 : (index - 1 + list.length) % list.length);
        break;
      case 'Home':
        event.preventDefault();
        focusItem(0);
        break;
      case 'End':
        event.preventDefault();
        focusItem(list.length - 1);
        break;
      case 'Tab':
        hide();
        break;
      default:
        break;
    }
  }));

  // 点击浮层与页面项之外 → 收起
  disposers.push(on(document, 'click', (event) => {
    if (!visible) return;
    const target = event.target instanceof Node ? event.target : null;
    if (!target) return;
    if (node.contains(target)) return;
    if (anchor && anchor.contains(target)) return;
    hide();
  }));

  // 页面/侧栏滚动、resize、visualViewport 变化 → 收起，避免浮层悬空
  const hideOnScrollOrResize = () => {
    if (visible) hide();
  };
  disposers.push(on(document, 'scroll', hideOnScrollOrResize, { capture: true, passive: true }));
  disposers.push(on(window, 'resize', hideOnScrollOrResize, { passive: true }));
  if (window.visualViewport) {
    disposers.push(on(window.visualViewport, 'resize', hideOnScrollOrResize, { passive: true }));
    disposers.push(on(window.visualViewport, 'scroll', hideOnScrollOrResize, { passive: true }));
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    cancelHide();
    for (const dispose of disposers.splice(0)) {
      try {
        dispose();
      } catch (error) {
        /* 忽略 */
      }
    }
    renderQueue.dispose();
    node.remove();
  }

  return {
    showForPage,
    scheduleHide,
    cancelHide,
    hide,
    isOpen: () => visible,
    destroy
  };
}
