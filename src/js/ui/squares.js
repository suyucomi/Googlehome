/**
 * ui/squares.js — 书签网格：渲染 / keyed 增量 patch / 拖拽排序 / 右键菜单 / 分类提示条。
 *
 * 性能约定：
 * - 页面切换、分类筛选：DocumentFragment 一次性渲染 + rAF 交错淡入（≤220ms），不做每项 setTimeout；
 * - 单条新增/删除/改名/星标镜像：按 data-url 定位，纯追加/纯删除复用现有 DOM；
 *   只有中间段超过 1 项的非连续变化才全量重建（不是每次状态变化都重建 300 个节点）；
 * - 事件全部委托到 #squaresContainer（click/keydown/contextmenu/drag*），单条书签零监听器；
 * - 拖拽用占位符预览，drop 时整理 DOM 后只调用一次 store.reorderSquares(orderedUrls)，
 *   订阅回流时因 DOM 顺序已一致而不会重建/闪烁。
 */

import { el, on, setAttr, setText } from '../core/dom.js';
import { store } from '../core/store.js';
import { CONFIG } from '../core/config.js';
import { faviconUrl, prefersReducedMotion } from '../core/utils.js';
import { createRenderQueue, placeAt } from './frame.js';
import { promptDialog, showToast } from './dialogs.js';

const FADE_STAGGER_MAX = Number(CONFIG.constants && CONFIG.constants.FADE_STAGGER_MAX) || 220;
const FADE_DURATION = 450;

const ITEM_SELECTOR = '.square-list-item';
const SQUARE_SELECTOR = '.square-container';

/** 页面内是否正在拖拽排序（paste.js 据此忽略内部拖拽的 drop） */
let internalDrag = false;
export function isInternalDrag() {
  return internalDrag;
}

function closest(target, selector) {
  return target instanceof Element ? target.closest(selector) : null;
}

export function mountSquares({ root = document } = {}) {
  const container = root.querySelector('#squaresContainer');
  if (!container) {
    console.warn('[squares] 缺少 #squaresContainer，跳过挂载');
    return { destroy() {} };
  }
  const folderSlot = root.querySelector('#folderBarSlot');

  const containerRefs = new WeakMap(); // item -> { square, name }
  const disposers = [];
  let destroyed = false;
  let lastPageId = null;
  let lastFolder = null;
  let cleanupTimer = 0;
  let folderBar = null;
  let folderBarLabel = null;

  let menu = null;
  let menuDisposers = [];

  const drag = { item: null, placeholder: null };
  const queue = createRenderQueue(render);

  /* ---------------- 渲染 ---------------- */

  function itemRefs(item) {
    return containerRefs.get(item) || null;
  }

  function currentItems() {
    return Array.from(container.children).filter(
      (node) => node instanceof Element && node.classList.contains('square-list-item')
    );
  }

  function urlOf(item) {
    const refs = itemRefs(item);
    return refs ? refs.square.dataset.url || '' : '';
  }

  function createItem(data) {
    const item = document.createElement('div');
    item.className = 'square-list-item';
    setAttr(item, 'role', 'listitem');
    setAttr(item, 'draggable', 'true');

    const square = document.createElement('div');
    square.className = 'square-container';
    square.dataset.url = data.url;
    square.dataset.title = data.title || '';
    square.dataset.folder = data.folder || '';
    setAttr(square, 'role', 'link');
    setAttr(square, 'tabindex', '0');
    setAttr(square, 'aria-label', `${data.title || data.url} - ${data.url}`);

    // 图标：core/utils.faviconUrl 同步解析（按 host 缓存，无网络请求）
    const iconUrl = faviconUrl(data.url);
    if (iconUrl) {
      square.style.setProperty('--favicon-url', `url("${iconUrl}")`);
      square.style.setProperty('--favicon-size', '32px');
    }

    const name = document.createElement('span');
    name.className = 'square-title';
    name.textContent = data.title || data.url;

    item.append(square, name);
    containerRefs.set(item, { square, name });
    return item;
  }

  function createEmptyState() {
    const folder = store.state.currentFolder || '';
    const text = folder ? `「${folder}」还没有书签` : '这里还没有书签，粘贴一个网址试试';
    return el('div', { className: 'empty-state', text });
  }

  function ensureEmptyState() {
    const empty = container.querySelector('.empty-state');
    if (currentItems().length === 0) {
      if (!empty) container.appendChild(createEmptyState());
    } else if (empty) {
      empty.remove();
    }
  }

  /** rAF 交错淡入（节点已在 DOM 中后调用）：加类 → 强制样式计算 → 下一帧移除类 → 统一清理延迟 */
  function animateIn(items) {
    if (!items.length || prefersReducedMotion()) return;
    items.forEach((item, index) => {
      item.classList.add('fade-in');
      item.style.transitionDelay = Math.min(index * 16, FADE_STAGGER_MAX) + 'ms';
    });
    // 强制一次样式计算，保证下一帧移除类时有过渡起点
    void container.offsetWidth;
    requestAnimationFrame(() => {
      items.forEach((item) => {
        if (item.isConnected) item.classList.remove('fade-in');
      });
    });
    if (cleanupTimer) clearTimeout(cleanupTimer);
    cleanupTimer = setTimeout(() => {
      cleanupTimer = 0;
      items.forEach((item) => {
        if (item.isConnected && !item.classList.contains('fade-in')) item.style.transitionDelay = '';
      });
    }, FADE_STAGGER_MAX + FADE_DURATION);
  }

  function fullRender(list, { animate = true } = {}) {
    const fragment = document.createDocumentFragment();
    const items = [];
    for (const data of list) {
      const node = createItem(data);
      items.push(node);
      fragment.appendChild(node);
    }
    if (!list.length) fragment.appendChild(createEmptyState());
    container.replaceChildren(fragment);
    if (animate) animateIn(items);
  }

  function syncProperties(list) {
    const items = currentItems();
    const length = Math.min(items.length, list.length);
    for (let index = 0; index < length; index++) {
      const item = items[index];
      const refs = itemRefs(item);
      if (!refs) continue;
      const data = list[index] || {};
      const title = data.title || data.url || '';
      const folder = data.folder || '';
      if (refs.square.dataset.title !== title) {
        refs.square.dataset.title = title;
        refs.name.textContent = title;
        setAttr(refs.square, 'aria-label', `${title} - ${data.url}`);
      }
      if (refs.square.dataset.folder !== folder) refs.square.dataset.folder = folder;
    }
  }

  /** 增量更新：纯追加 / 纯删除 / 单条替换复用 DOM，其余非连续变化才全量 */
  function patch(list) {
    const items = currentItems();
    if (!items.length) {
      fullRender(list, { animate: true });
      return;
    }
    const domUrls = items.map(urlOf);

    let prefix = 0;
    while (prefix < domUrls.length && prefix < list.length && domUrls[prefix] === list[prefix].url) prefix++;
    let suffix = 0;
    while (
      suffix < domUrls.length - prefix &&
      suffix < list.length - prefix &&
      domUrls[domUrls.length - 1 - suffix] === list[list.length - 1 - suffix].url
    ) {
      suffix++;
    }

    const domMiddle = items.slice(prefix, domUrls.length - suffix);
    const nextMiddle = list.slice(prefix, list.length - suffix);
    const anchor = suffix > 0 ? items[domUrls.length - suffix] : null;

    // 纯删除
    if (!nextMiddle.length) {
      for (const node of domMiddle) node.remove();
      ensureEmptyState();
      syncProperties(list);
      return;
    }

    // 纯追加（任意数量）：DocumentFragment 一次插入
    if (!domMiddle.length) {
      const fragment = document.createDocumentFragment();
      const added = [];
      for (const data of nextMiddle) {
        const node = createItem(data);
        added.push(node);
        fragment.appendChild(node);
      }
      container.insertBefore(fragment, anchor);
      ensureEmptyState();
      animateIn(added);
      syncProperties(list);
      return;
    }

    // 单条替换：就地替换，不重建整页
    if (domMiddle.length === 1 && nextMiddle.length === 1) {
      const replacement = createItem(nextMiddle[0]);
      container.insertBefore(replacement, domMiddle[0]);
      domMiddle[0].remove();
      animateIn([replacement]);
      syncProperties(list);
      return;
    }

    // 非连续变化：全量重建（不播放交错动画，避免抖动）
    fullRender(list, { animate: false });
  }

  function syncFolderBar(folder) {
    if (folder) {
      if (!folderBar) {
        folderBar = el('div', { className: 'active-folder-bar', attrs: { role: 'status' } });
        folderBarLabel = el('span');
        const clear = el('button', {
          className: 'active-folder-clear',
          type: 'button',
          text: '×',
          attrs: { title: '显示全部', 'aria-label': '显示全部书签' }
        });
        folderBar.append(folderBarLabel, clear);
        disposers.push(on(clear, 'click', () => store.setFolder('')));
        const host = folderSlot || (container.parentNode || container);
        host.appendChild(folderBar);
      }
      setText(folderBarLabel, folder);
    } else if (folderBar) {
      folderBar.remove();
      folderBar = null;
      folderBarLabel = null;
    }
  }

  function render() {
    if (destroyed) return;
    const state = store.state;
    const pageId = state.currentPageId;
    const folder = state.currentFolder || '';
    const next = store.getVisibleSquares();

    syncFolderBar(folder);

    // 页面切换 / 分类筛选：一次性渲染 + 交错淡入
    if (pageId !== lastPageId || folder !== lastFolder) {
      lastPageId = pageId;
      lastFolder = folder;
      fullRender(next, { animate: true });
      return;
    }

    const domUrls = currentItems().map(urlOf);
    if (domUrls.length === next.length && domUrls.every((url, index) => url === next[index].url)) {
      syncProperties(next);
      return;
    }
    patch(next);
  }

  /* ---------------- 打开链接 / 右键菜单 ---------------- */

  function openUrl(url) {
    if (!url) return;
    window.location.href = url;
  }

  function closeContextMenu() {
    if (!menu) return;
    const node = menu;
    menu = null;
    for (const dispose of menuDisposers.splice(0)) {
      try {
        dispose();
      } catch (error) {
        /* 忽略 */
      }
    }
    node.remove();
  }

  function openContextMenu(x, y, square) {
    closeContextMenu();
    const menuNode = el('div', {
      className: 'context-menu',
      attrs: { role: 'menu', 'aria-label': '书签操作' }
    });
    const renameItem = el('button', {
      className: 'context-menu-item',
      type: 'button',
      text: '修改',
      attrs: { role: 'menuitem', tabindex: '-1' }
    });
    const deleteItem = el('button', {
      className: 'context-menu-item',
      type: 'button',
      text: '删除',
      attrs: { role: 'menuitem', tabindex: '-1' }
    });
    menuNode.append(renameItem, deleteItem);
    document.body.appendChild(menuNode);
    placeAt(menuNode, x, y);
    menu = menuNode;

    const menuItems = [renameItem, deleteItem];
    const focusMenuIndex = (index) => {
      const target = menuItems[(index + menuItems.length) % menuItems.length];
      if (target) {
        try {
          target.focus({ preventScroll: true });
        } catch (error) {
          /* 忽略 */
        }
      }
    };

    menuDisposers.push(
      on(renameItem, 'click', () => {
        closeContextMenu();
        renameBookmark(square).catch((error) => console.error('[squares] 修改书签失败:', error));
      }),
      on(deleteItem, 'click', () => {
        closeContextMenu();
        deleteBookmark(square).catch((error) => console.error('[squares] 删除书签失败:', error));
      }),
      on(document, 'click', (event) => {
        const target = event.target instanceof Node ? event.target : null;
        if (!target || !menuNode.contains(target)) closeContextMenu();
      }, { capture: true }),
      on(document, 'contextmenu', (event) => {
        const target = event.target instanceof Node ? event.target : null;
        if (!target || !menuNode.contains(target)) closeContextMenu();
      }, { capture: true }),
      on(document, 'keydown', (event) => {
        const index = menuItems.indexOf(document.activeElement);
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          closeContextMenu();
          return;
        }
        if (event.key === 'ArrowDown') {
          event.preventDefault();
          focusMenuIndex(index < 0 ? 0 : index + 1);
          return;
        }
        if (event.key === 'ArrowUp') {
          event.preventDefault();
          focusMenuIndex(index < 0 ? menuItems.length - 1 : index - 1);
          return;
        }
        if (event.key === 'Tab') closeContextMenu();
      }, { capture: true }),
      on(document, 'scroll', () => closeContextMenu(), { capture: true, passive: true }),
      on(window, 'resize', () => closeContextMenu(), { passive: true })
    );

    focusMenuIndex(0);
  }

  async function renameBookmark(square) {
    const url = square.dataset.url;
    if (!url) return;
    const current = square.dataset.title || url;
    const next = await promptDialog({
      title: '修改书签',
      message: url,
      value: current,
      confirmText: '保存'
    });
    if (!next || next === current) return;
    const result = await store.updateBookmark(url, { title: next });
    if (!result || result.ok === false) showToast('修改失败', 'error');
  }

  async function deleteBookmark(square) {
    const url = square.dataset.url;
    if (!url) return;
    const item = square.closest(ITEM_SELECTOR);
    if (item) item.classList.add('fade-out');
    const result = await store.removeBookmark(url);
    if (!result || result.ok === false) {
      if (item) item.classList.remove('fade-out');
      showToast('删除失败', 'error');
    }
  }

  /* ---------------- 拖拽排序（容器委托） ---------------- */

  function createPlaceholder() {
    const item = document.createElement('div');
    item.className = 'square-list-item drag-placeholder';
    setAttr(item, 'aria-hidden', 'true');
    const square = document.createElement('div');
    square.className = 'square-container placeholder';
    item.appendChild(square);
    return item;
  }

  function removePlaceholder() {
    if (drag.placeholder) {
      drag.placeholder.remove();
      drag.placeholder = null;
    }
  }

  function dropSide(target, x, y) {
    const rect = target.getBoundingClientRect();
    const verticalOverlap = Math.min(rect.bottom, y) - Math.max(rect.top, y);
    if (verticalOverlap > rect.height * 0.3) {
      return x < rect.left + rect.width / 2 ? 'before' : 'after';
    }
    return y < rect.top + rect.height / 2 ? 'before' : 'after';
  }

  function nearestItem(x, y) {
    let best = null;
    let bestDistance = Infinity;
    for (const item of currentItems()) {
      if (item === drag.item || item.classList.contains('drag-placeholder')) continue;
      const rect = item.getBoundingClientRect();
      const dx = x - (rect.left + rect.width / 2);
      const dy = y - (rect.top + rect.height / 2);
      const distance = dx * dx + dy * dy;
      if (distance < bestDistance) {
        bestDistance = distance;
        best = item;
      }
    }
    return best;
  }

  function updatePlaceholder(x, y, targetHint) {
    const candidates = currentItems().filter(
      (item) => item !== drag.item && !item.classList.contains('drag-placeholder')
    );
    if (!candidates.length) {
      removePlaceholder();
      return;
    }
    let target = targetHint;
    if (!target || target === drag.item || target.classList.contains('drag-placeholder')) {
      target = nearestItem(x, y);
    }
    if (!target) return;

    const side = dropSide(target, x, y);
    const reference = side === 'before' ? target : target.nextSibling;

    if (!drag.placeholder) drag.placeholder = createPlaceholder();
    const placeholder = drag.placeholder;
    if (placeholder.parentNode === container && placeholder === reference) return;
    if (placeholder.parentNode === container && placeholder.nextSibling === reference) return;
    container.insertBefore(placeholder, reference);
  }

  function cleanupDrag() {
    removePlaceholder();
    if (drag.item) {
      drag.item.classList.remove('dragging');
      const square = drag.item.querySelector(SQUARE_SELECTOR);
      if (square) square.classList.remove('dragging');
    }
    drag.item = null;
    internalDrag = false;
    container.classList.remove('dragging-in-progress');
    container.querySelectorAll('.drag-end').forEach((node) => node.classList.remove('drag-end'));
  }

  function commitDrag() {
    const item = drag.item;
    if (!item) {
      cleanupDrag();
      return;
    }
    if (drag.placeholder && drag.placeholder.parentNode === container) {
      container.insertBefore(item, drag.placeholder);
    }
    const square = item.querySelector(SQUARE_SELECTOR);
    if (square) {
      square.classList.add('drag-end');
      setTimeout(() => square.classList.remove('drag-end'), 450);
    }
    cleanupDrag();

    const orderedUrls = currentItems().map(urlOf).filter(Boolean);
    if (!orderedUrls.length) return;
    Promise.resolve(store.reorderSquares(orderedUrls)).catch((error) => {
      console.warn('[squares] 排序保存失败:', error);
    });
  }

  /* ---------------- 事件绑定（全部委托到容器） ---------------- */

  disposers.push(on(container, 'click', (event) => {
    const square = closest(event.target, SQUARE_SELECTOR);
    if (!square || !container.contains(square)) return;
    openUrl(square.dataset.url);
  }));

  disposers.push(on(container, 'keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    if (event.defaultPrevented) return;
    const square = closest(event.target, SQUARE_SELECTOR);
    if (!square) return;
    event.preventDefault();
    openUrl(square.dataset.url);
  }));

  disposers.push(on(container, 'contextmenu', (event) => {
    const square = closest(event.target, SQUARE_SELECTOR);
    if (!square) return;
    event.preventDefault();
    openContextMenu(event.clientX, event.clientY, square);
  }));

  disposers.push(on(container, 'dragstart', (event) => {
    const item = closest(event.target, ITEM_SELECTOR);
    if (!item || item.classList.contains('drag-placeholder')) return;
    drag.item = item;
    drag.placeholder = null;
    internalDrag = true;
    item.classList.add('dragging');
    const square = item.querySelector(SQUARE_SELECTOR);
    if (square) square.classList.add('dragging');
    container.classList.add('dragging-in-progress');
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      try {
        event.dataTransfer.setData('text/plain', urlOf(item));
      } catch (error) {
        /* 某些环境限制 setData，忽略 */
      }
    }
  }));

  disposers.push(on(container, 'dragover', (event) => {
    if (!drag.item) return; // 外部拖入交给 paste.js
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    const target = closest(event.target, ITEM_SELECTOR);
    updatePlaceholder(event.clientX, event.clientY, target);
  }));

  disposers.push(on(container, 'dragleave', (event) => {
    if (!drag.item) return;
    const related = event.relatedTarget;
    if (related instanceof Node && container.contains(related)) return;
    removePlaceholder();
  }));

  disposers.push(on(container, 'drop', (event) => {
    if (!drag.item) return;
    event.preventDefault();
    event.stopPropagation();
    const target = closest(event.target, ITEM_SELECTOR);
    updatePlaceholder(event.clientX, event.clientY, target);
    commitDrag();
  }));

  disposers.push(on(container, 'dragend', () => {
    if (!drag.item) return;
    cleanupDrag();
  }));

  const unsubscribe = store.subscribe(() => queue.schedule());
  disposers.push(unsubscribe);

  // 首屏渲染
  render();

  return {
    destroy() {
      if (destroyed) return;
      destroyed = true;
      queue.dispose();
      cleanupDrag();
      closeContextMenu();
      if (cleanupTimer) clearTimeout(cleanupTimer);
      cleanupTimer = 0;
      if (folderBar) {
        folderBar.remove();
        folderBar = null;
        folderBarLabel = null;
      }
      for (const dispose of disposers.splice(0)) {
        try {
          dispose();
        } catch (error) {
          /* 忽略 */
        }
      }
    }
  };
}
