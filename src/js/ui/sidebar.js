/**
 * ui/sidebar.js — 侧栏开合 / 响应式 / 无障碍 + 页面列表（keyed diff）。
 *
 * 职责：
 * - 桌面：常驻侧栏，开合状态由 store.state.ui.sidebarOpen 决定（store 持久化 localStorage.sidebarState）；
 *   关闭 = .sidebar.collapsed 视觉滑出 + inert + aria-hidden=true；
 * - 移动端（≤768px）：抽屉 + 遮罩，body.sidebar-open-mobile 锁背景滚动；
 * - 页面列表 keyed diff：按 data-page-id 复用节点，只更新 active/名称/计数/按钮 aria，不整表重建；
 * - 页面项 role=listitem + tabindex=0，Enter/Space 切换，ArrowUp/Down/Home/End 移动焦点，ArrowRight 打开二级分类；
 * - 重命名/删除（内嵌按钮保留 .page-action-btn.edit-page-btn / .delete-page-btn）；
 * - 事件全部委托到 #bookmarkPages / 静态按钮，返回 destroy 统一解绑。
 */

import { el, on, setAttr, setText, toggleClass } from '../core/dom.js';
import { store } from '../core/store.js';
import { MOBILE_BREAKPOINT } from '../core/config.js';
import { createRenderQueue } from './frame.js';
import { getFlyout } from './flyout.js';
import { confirmDialog, promptDialog, showToast } from './dialogs.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

function icon(paths) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('aria-hidden', 'true');
  for (const spec of paths) {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', spec.d);
    path.setAttribute('stroke', 'currentColor');
    path.setAttribute('stroke-width', spec.width || '2');
    if (spec.cap) path.setAttribute('stroke-linecap', spec.cap);
    if (spec.join) path.setAttribute('stroke-linejoin', spec.join);
    svg.appendChild(path);
  }
  return svg;
}

const PAGE_ICON = [
  { d: 'M4 19.5A2.5 2.5 0 0 1 6.5 17H20', cap: 'round', join: 'round' },
  { d: 'M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z', cap: 'round', join: 'round' }
];
const EDIT_ICON = [
  { d: 'M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7' },
  { d: 'M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z' }
];
const DELETE_ICON = [
  { d: 'M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2' }
];

const ITEM_SELECTOR = '.bookmark-page-item';
const ACTION_SELECTOR = '.page-action-btn';

function closest(target, selector) {
  return target instanceof Element ? target.closest(selector) : null;
}

export function mountSidebar({ root = document } = {}) {
  const sidebar = root.querySelector('#sidebar');
  const pageList = root.querySelector('#bookmarkPages');
  if (!sidebar || !pageList) {
    console.warn('[sidebar] 缺少 #sidebar / #bookmarkPages，跳过挂载');
    return { destroy() {} };
  }

  const container = root.querySelector('#appContainer') || sidebar.closest('.container') || root.body;
  const toggle = root.querySelector('#sidebarToggle');
  const trigger = root.querySelector('#sidebarTrigger');
  const overlay = root.querySelector('#sidebarOverlay');
  const addPageBtn = root.querySelector('#addPageBtn');
  const settingsBtn = root.querySelector('#sidebarSettingsBtn');

  const mql = typeof window.matchMedia === 'function'
    ? window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT}px)`)
    : { matches: window.innerWidth <= MOBILE_BREAKPOINT, addEventListener() {}, removeEventListener() {} };

  const flyout = getFlyout();
  const disposers = [];
  let destroyed = false;

  const queue = createRenderQueue(render);

  /* ---------------- 页面项 ---------------- */

  function createPageItem(page) {
    const item = el('div', {
      className: 'bookmark-page-item',
      attrs: { role: 'listitem', tabindex: '0' }
    });
    item.dataset.pageId = page.id;

    const pageIcon = el('div', { className: 'page-icon' });
    pageIcon.appendChild(icon(PAGE_ICON));

    const info = el('div', { className: 'page-info' });
    const name = el('div', { className: 'page-name' });
    const count = el('div', { className: 'page-count' });
    info.append(name, count);

    const actions = el('div', { className: 'page-actions' });
    const editBtn = el('button', {
      className: 'page-action-btn edit-page-btn',
      type: 'button',
      attrs: { title: '重命名', 'aria-label': '重命名页面' }
    });
    editBtn.dataset.pageId = page.id;
    editBtn.appendChild(icon(EDIT_ICON));

    const deleteBtn = el('button', {
      className: 'page-action-btn delete-page-btn',
      type: 'button',
      attrs: { title: '删除', 'aria-label': '删除页面' }
    });
    deleteBtn.dataset.pageId = page.id;
    deleteBtn.appendChild(icon(DELETE_ICON));

    actions.append(editBtn, deleteBtn);
    item.append(pageIcon, info, actions);
    item._refs = { name, count, editBtn, deleteBtn };
    return item;
  }

  function updatePageItem(item, page, currentPageId) {
    const refs = item._refs;
    const count = Number(page.bookmarkCount) || 0;
    const active = page.id === currentPageId;
    const hasSubfolders = Array.isArray(page.subfolders) && page.subfolders.length > 0;

    toggleClass(item, 'active', active);
    if (active) setAttr(item, 'aria-current', 'page');
    else item.removeAttribute('aria-current');
    setAttr(item, 'aria-label', `${page.name} - ${count} 个书签`);
    toggleClass(item, 'has-subfolders', hasSubfolders);

    setText(refs.name, page.name);
    setText(refs.count, `${count} 个书签`);

    refs.editBtn.dataset.pageId = page.id;
    setAttr(refs.editBtn, 'aria-label', `重命名页面: ${page.name}`);
    refs.deleteBtn.dataset.pageId = page.id;
    setAttr(refs.deleteBtn, 'aria-label', `删除页面: ${page.name}`);
  }

  /** keyed diff：按 data-page-id 复用节点，只增删/移动/改文本 */
  function syncPages() {
    const { pages, currentPageId } = store.state;
    const existing = new Map();
    for (const child of Array.from(pageList.children)) {
      if (child.classList && child.classList.contains('bookmark-page-item') && child.dataset.pageId) {
        existing.set(child.dataset.pageId, child);
      }
    }

    const seen = new Set();
    let previous = null;
    for (const page of pages) {
      let item = existing.get(page.id);
      if (!item) item = createPageItem(page);
      seen.add(page.id);

      const ref = previous ? previous.nextElementSibling : pageList.firstElementChild;
      if (ref !== item) pageList.insertBefore(item, ref || null);
      updatePageItem(item, page, currentPageId);
      previous = item;
    }

    for (const [id, node] of existing) {
      if (!seen.has(id)) node.remove();
    }
  }

  /* ---------------- 侧栏开合 / 响应式 ---------------- */

  function applySidebarState() {
    const open = Boolean(store.state.ui.sidebarOpen);
    const settingsOpen = Boolean(store.state.ui.settingsOpen);
    const mobile = Boolean(mql.matches);

    // 关闭前先把焦点移出侧栏，避免 inert 导致焦点丢失到 body。
    // 设置面板打开时由面板自己管理焦点，侧栏只保持 inert（不能抢焦点）。
    if (!open && !settingsOpen && sidebar.contains(document.activeElement)) {
      try {
        (trigger || toggle).focus({ preventScroll: true });
      } catch (error) {
        /* 忽略 */
      }
    }

    toggleClass(sidebar, 'collapsed', !open);
    // 设置面板打开时侧栏也要 inert（背景不可交互），关闭后由 state 通知恢复
    if (open && !settingsOpen) {
      sidebar.removeAttribute('inert');
      setAttr(sidebar, 'aria-hidden', 'false');
    } else if (!open) {
      sidebar.setAttribute('inert', '');
      setAttr(sidebar, 'aria-hidden', 'true');
    } else {
      // open && settingsOpen：视觉保持展开，但不可交互
      sidebar.setAttribute('inert', '');
      setAttr(sidebar, 'aria-hidden', 'false');
    }

    if (toggle) {
      setAttr(toggle, 'aria-expanded', open ? 'true' : 'false');
      setAttr(toggle, 'aria-label', open ? '收起侧边栏' : '展开侧边栏');
    }
    if (trigger) {
      setAttr(trigger, 'aria-expanded', open ? 'true' : 'false');
      setAttr(trigger, 'aria-label', open ? '关闭侧边栏' : '打开侧边栏');
    }

    // 布局状态写在 <html> 上：CSS 的让位规则与 boot-state.js 共用同一来源
    document.documentElement.dataset.sidebar = open ? 'open' : 'closed';

    if (mobile) {
      if (container) container.classList.remove('sidebar-open');
      if (trigger) trigger.classList.remove('show-on-desktop');
      if (overlay) {
        overlay.hidden = !open;
        toggleClass(overlay, 'active', open);
      }
      document.body.classList.toggle('sidebar-open-mobile', open);
    } else {
      if (container) container.classList.toggle('sidebar-open', open);
      if (trigger) toggleClass(trigger, 'show-on-desktop', !open);
      if (overlay) {
        overlay.hidden = true;
        overlay.classList.remove('active');
      }
      document.body.classList.remove('sidebar-open-mobile');
    }
  }

  function render() {
    if (destroyed) return;
    applySidebarState();
    syncPages();
  }

  function setOpen(open, { focus = true } = {}) {
    store.setUi({ sidebarOpen: Boolean(open) });
    queue.runNow();
    if (!focus) return;
    if (open) focusActivePage();
    else if (trigger) {
      try {
        trigger.focus({ preventScroll: true });
      } catch (error) {
        /* 忽略 */
      }
    }
  }

  function focusActivePage() {
    const active = pageList.querySelector('.bookmark-page-item.active') || pageList.querySelector('.bookmark-page-item');
    if (active) {
      try {
        active.focus({ preventScroll: true });
      } catch (error) {
        /* 忽略 */
      }
    }
  }

  /* ---------------- 页面动作 ---------------- */

  async function selectPage(pageId) {
    if (!pageId || pageId === store.state.currentPageId) {
      if (mql.matches) setOpen(false);
      return;
    }
    flyout.hide();
    await store.selectPage(pageId);
    if (mql.matches) setOpen(false);
  }

  async function renamePage(pageId) {
    const page = store.getPage(pageId);
    if (!page) return;
    const next = await promptDialog({
      title: '重命名页面',
      message: '',
      value: page.name,
      placeholder: '页面名称',
      confirmText: '保存'
    });
    if (!next || next === page.name) return;
    const result = await store.renamePage(pageId, next);
    if (result && result.ok === false) showToast('重命名失败', 'error');
  }

  async function deletePage(pageId) {
    if (store.state.pages.length <= 1) {
      showToast('至少需要保留一个页面', 'error');
      return;
    }
    const page = store.getPage(pageId);
    if (!page) return;
    const ok = await confirmDialog({
      title: '删除页面',
      message: `确定要删除「${page.name}」吗？页面中的所有书签也会被删除。`,
      confirmText: '删除',
      danger: true
    });
    if (!ok) return;
    const result = await store.deletePage(pageId);
    if (result && result.ok === false) showToast('删除失败', 'error');
    else showToast('页面已删除');
  }

  async function addPage() {
    const page = await store.createPage();
    if (!page) return;
    queue.runNow();
    showToast('新页面已创建');
    if (mql.matches) setOpen(false);
    else focusActivePage();
  }

  /* ---------------- 事件（全部委托） ---------------- */

  disposers.push(on(pageList, 'click', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    const action = target.closest(ACTION_SELECTOR);
    if (action) {
      event.stopPropagation();
      const pageId = action.dataset.pageId;
      if (action.classList.contains('edit-page-btn')) renamePage(pageId);
      else if (action.classList.contains('delete-page-btn')) deletePage(pageId);
      return;
    }
    const item = target.closest(ITEM_SELECTOR);
    if (item) selectPage(item.dataset.pageId);
  }));

  disposers.push(on(pageList, 'keydown', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    if (target.closest('button')) return; // 按钮走原生键盘行为
    const item = target.closest(ITEM_SELECTOR);
    if (!item) return;
    const items = Array.from(pageList.querySelectorAll(ITEM_SELECTOR));
    const index = items.indexOf(item);

    switch (event.key) {
      case 'Enter':
      case ' ':
        event.preventDefault();
        selectPage(item.dataset.pageId);
        break;
      case 'ArrowDown':
        event.preventDefault();
        if (items[index + 1]) items[index + 1].focus();
        break;
      case 'ArrowUp':
        event.preventDefault();
        if (items[index - 1]) items[index - 1].focus();
        break;
      case 'Home':
        event.preventDefault();
        if (items[0]) items[0].focus();
        break;
      case 'End':
        event.preventDefault();
        if (items.length) items[items.length - 1].focus();
        break;
      case 'ArrowRight':
        if (item.classList.contains('has-subfolders')) {
          event.preventDefault();
          flyout.showForPage(item, { focusFirst: true });
        }
        break;
      case 'Escape':
        flyout.hide();
        break;
      default:
        break;
    }
  }));

  // hover / 焦点 → 二级分类浮层（委托，避免每项 mouseenter）
  disposers.push(on(pageList, 'mouseover', (event) => {
    const item = closest(event.target, ITEM_SELECTOR);
    if (!item) return;
    const related = event.relatedTarget;
    if (related instanceof Node && item.contains(related)) return;
    if (item.classList.contains('has-subfolders')) flyout.showForPage(item);
    else flyout.scheduleHide();
  }));
  disposers.push(on(pageList, 'mouseout', (event) => {
    const item = closest(event.target, ITEM_SELECTOR);
    if (!item) return;
    const related = event.relatedTarget;
    if (related instanceof Node && item.contains(related)) return;
    flyout.scheduleHide();
  }));
  disposers.push(on(pageList, 'focusin', (event) => {
    const item = closest(event.target, ITEM_SELECTOR);
    if (item && item.classList.contains('has-subfolders')) flyout.showForPage(item);
  }));
  disposers.push(on(pageList, 'focusout', (event) => {
    const item = closest(event.target, ITEM_SELECTOR);
    if (!item) return;
    const related = event.relatedTarget;
    if (related instanceof Node && item.contains(related)) return;
    flyout.scheduleHide();
  }));

  if (toggle) disposers.push(on(toggle, 'click', () => setOpen(!store.state.ui.sidebarOpen)));
  if (trigger) disposers.push(on(trigger, 'click', () => setOpen(true)));
  if (overlay) disposers.push(on(overlay, 'click', () => setOpen(false)));
  if (addPageBtn) disposers.push(on(addPageBtn, 'click', () => addPage().catch((error) => console.error('[sidebar] 新建页面失败:', error))));
  if (settingsBtn) {
    disposers.push(on(settingsBtn, 'click', () => {
      flyout.hide();
      store.setUi({ settingsOpen: true });
    }));
  }

  // Esc 关闭侧栏（弹窗/浮层/设置面板的 handler 会先 preventDefault）
  disposers.push(on(document, 'keydown', (event) => {
    if (event.key !== 'Escape' || event.defaultPrevented) return;
    if (!store.state.ui.sidebarOpen) return;
    event.preventDefault();
    setOpen(false);
  }));

  // 断点切换 & 窗口尺寸变化：重新应用桌面/移动布局
  const handleViewportChange = () => queue.schedule();
  if (typeof mql.addEventListener === 'function') {
    mql.addEventListener('change', handleViewportChange);
    disposers.push(() => mql.removeEventListener('change', handleViewportChange));
  } else if (typeof mql.addListener === 'function') {
    mql.addListener(handleViewportChange);
    disposers.push(() => mql.removeListener(handleViewportChange));
  }
  disposers.push(on(window, 'resize', handleViewportChange, { passive: true }));

  const unsubscribe = store.subscribe(() => queue.schedule());
  disposers.push(unsubscribe);

  // 首屏渲染
  render();

  return {
    destroy() {
      if (destroyed) return;
      destroyed = true;
      queue.dispose();
      for (const dispose of disposers.splice(0)) {
        try {
          dispose();
        } catch (error) {
          /* 忽略 */
        }
      }
      flyout.hide();
    }
  };
}
