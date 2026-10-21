// tools/measure.mjs — 在页面上下文执行的布局测量函数（序列化后通过 Runtime.evaluate 注入）
// Node 侧通过 measureExpr(opts) 取得表达式字符串；页面内函数必须自包含。

function pageMeasure(opts) {
  const o = opts || {};
  const squareLimit = o.squareLimit || 400;
  const hitSample = o.hitSample || 150;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const round = (n) => Math.round(n * 100) / 100;

  const rectOf = (el) => {
    if (!el) return null;
    const b = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return {
      x: round(b.x), y: round(b.y), w: round(b.width), h: round(b.height),
      right: round(b.right), bottom: round(b.bottom),
      display: cs.display, visibility: cs.visibility,
      opacity: round(parseFloat(cs.opacity) || 0),
      zIndex: cs.zIndex, pointerEvents: cs.pointerEvents,
      overflowX: cs.overflowX, overflowY: cs.overflowY,
      position: cs.position, class: el.className && String(el.className).slice(0, 120),
      ariaHidden: el.getAttribute && el.getAttribute('aria-hidden'),
    };
  };
  const isVisible = (r) => !!r && r.display !== 'none' && r.visibility !== 'hidden' && r.opacity > 0.01 && r.w > 0 && r.h > 0;
  const describe = (el) => {
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return {
      tag: el.tagName ? el.tagName.toLowerCase() : String(el),
      id: el.id || null,
      cls: el.className && typeof el.className === 'string' ? el.className.slice(0, 100) : null,
      x: round(b.x), y: round(b.y), w: round(b.width), h: round(b.height),
    };
  };
  const q = (sel) => document.querySelector(sel);

  const els = {
    container: rectOf(q('.container')),
    sidebar: rectOf(q('#sidebar')),
    trigger: rectOf(q('#sidebarTrigger')),
    overlay: rectOf(q('#sidebarOverlay')),
    search: rectOf(q('.search-container')),
    squares: rectOf(q('#squaresContainer')),
    settings: rectOf(q('#settingsPanel')),
    folderBar: rectOf(q('.active-folder-bar')),
    flyout: rectOf(q('.page-subfolder-flyout')),
    emptyState: rectOf(q('.empty-state')),
    titleH1: rectOf(q('h1.page-title')),
  };

  // 标题：重构后是真实 <h1 class="page-title">，重构前是 .container::before 伪元素打字动画
  const container = q('.container');
  let title = null;
  if (els.titleH1) {
    const h1el = q('h1.page-title');
    const h1cs = getComputedStyle(h1el);
    title = Object.assign({ kind: 'h1' }, els.titleH1);
    title.text = h1el.textContent.trim();
    title.fontSize = parseFloat(h1cs.fontSize) || 0;
    title.lineHeight = parseFloat(h1cs.lineHeight) || null;
    // 只有 keyframes 里真正改 width/height 的动画才算「宽度动画」（新实现 page-title-in 只动 opacity/transform）
    try {
      const anims = h1el.getAnimations ? h1el.getAnimations() : [];
      title.animatesWidth = anims.some((a) => {
        try {
          const frames = a.effect && a.effect.getKeyframes ? a.effect.getKeyframes() : [];
          return frames.some((k) => Object.prototype.hasOwnProperty.call(k, 'width') || Object.prototype.hasOwnProperty.call(k, 'height') || Object.prototype.hasOwnProperty.call(k, 'inlineSize'));
        } catch (e) { return false; }
      });
    } catch (e) { title.animatesWidth = false; }
  } else if (container) {
    const ps = getComputedStyle(container, '::before');
    const ccs = getComputedStyle(container);
    const c = container.getBoundingClientRect();
    const pl = parseFloat(ccs.paddingLeft) || 0;
    const pr = parseFloat(ccs.paddingRight) || 0;
    const contentX = c.x + pl;
    const contentW = Math.max(0, c.width - pl - pr);
    const w = parseFloat(ps.width) || 0;
    const lh = parseFloat(ps.lineHeight);
    const h = parseFloat(ps.height) || (Number.isFinite(lh) ? lh : 28);
    const titleFontSize = parseFloat(ps.fontSize) || 0;
    const centerX = contentX + contentW / 2;
    title = {
      kind: 'pseudo', x: round(centerX - w / 2), y: round(c.y + (parseFloat(ccs.paddingTop) || 0)),
      w: round(w), h: round(h), right: round(centerX + w / 2),
      bottom: round(c.y + (parseFloat(ccs.paddingTop) || 0) + h),
      text: String(ps.content || '').replace(/^["']|["']$/g, ''),
      animationName: ps.animationName, centerX: round(centerX), contentW: round(contentW),
      display: ps.display, visibility: ps.visibility, opacity: round(parseFloat(ps.opacity) || 0),
      fontSize: titleFontSize, lineHeight: Number.isFinite(lh) ? lh : null,
      animatesWidth: /premiumTitleTyping/.test(String(ps.animationName || '')),
    };
  }
  els.title = title;

  const de = document.documentElement;
  const body = document.body;
  const doc = {
    innerWidth: vw, innerHeight: vh,
    scrollWidth: de.scrollWidth, scrollHeight: de.scrollHeight,
    clientWidth: de.clientWidth, clientHeight: de.clientHeight,
    bodyScrollWidth: body.scrollWidth, bodyScrollHeight: body.scrollHeight,
    overflowX: de.scrollWidth > vw + 1,
    overflowXAmount: de.scrollWidth - vw,
    scrollableX: de.scrollWidth > de.clientWidth + 1,
    scrollableY: de.scrollHeight > de.clientHeight + 1,
  };

  let containerMetrics = null;
  if (container) {
    const cs = getComputedStyle(container);
    containerMetrics = {
      clientWidth: container.clientWidth, clientHeight: container.clientHeight,
      scrollWidth: container.scrollWidth, scrollHeight: container.scrollHeight,
      innerOverflowX: container.scrollWidth - container.clientWidth,
      paddingLeft: parseFloat(cs.paddingLeft) || 0,
      paddingRight: parseFloat(cs.paddingRight) || 0,
      paddingTop: parseFloat(cs.paddingTop) || 0,
      class: container.className,
    };
  }

  // 越出视口的可见关键元素（只检查当前状态下应当可见的元素）
  const outOfViewport = [];
  const checkEl = (name, r) => {
    if (!isVisible(r)) return;
    const sides = [];
    if (r.x < -0.5) sides.push('left');
    if (r.y < -0.5) sides.push('top');
    if (r.right > vw + 0.5) sides.push('right');
    if (r.bottom > vh + 0.5) sides.push('bottom');
    if (sides.length) outOfViewport.push({ name, sides, rect: { x: r.x, y: r.y, w: r.w, h: r.h, right: r.right, bottom: r.bottom } });
  };
  const sidebarEl = q('#sidebar');
  const sidebarIsActive = !!sidebarEl && !sidebarEl.classList.contains('collapsed');
  const settingsEl = q('#settingsPanel');
  const settingsIsActive = !!settingsEl && settingsEl.classList.contains('active');
  const flyoutEl = q('.page-subfolder-flyout');
  const flyoutIsActive = !!flyoutEl && (flyoutEl.classList.contains('show') || isVisible(rectOf(flyoutEl)));
  const triggerEl = q('#sidebarTrigger');
  const triggerIsActive = !!triggerEl && getComputedStyle(triggerEl).display !== 'none';
  const overlayEl = q('#sidebarOverlay');
  const overlayIsActive = !!overlayEl && overlayEl.classList.contains('active');
  for (const [k, r] of Object.entries({
    trigger: triggerIsActive ? els.trigger : null,
    search: els.search,
    squares: els.squares,
    folderBar: els.folderBar,
    title: els.title,
    emptyState: els.emptyState,
  })) checkEl(k, r);
  if (sidebarIsActive) checkEl('sidebar', els.sidebar);
  if (settingsIsActive) checkEl('settings', els.settings);
  if (flyoutIsActive) checkEl('flyout', els.flyout);
  if (overlayIsActive) checkEl('overlay', els.overlay);

  // 网格项几何
  const itemEls = Array.from(document.querySelectorAll('.square-list-item')).slice(0, squareLimit);
  const gridItems = itemEls.map((el, i) => {
    const b = el.getBoundingClientRect();
    const sq = el.querySelector('.square-container');
    const sqb = sq ? sq.getBoundingClientRect() : null;
    return {
      i,
      url: (sq && sq.dataset && sq.dataset.url) || null,
      x: round(b.x), y: round(b.y), w: round(b.width), h: round(b.height),
      sqx: sqb ? round(sqb.x) : null, sqy: sqb ? round(sqb.y) : null,
      sqw: sqb ? round(sqb.width) : null, sqh: sqb ? round(sqb.height) : null,
      sqRight: sqb ? round(sqb.right) : null, sqBottom: sqb ? round(sqb.bottom) : null,
    };
  });

  // elementFromPoint：方块中心是否命中自身
  const hitTests = [];
  const step = Math.max(1, Math.floor(itemEls.length / hitSample));
  for (let i = 0; i < itemEls.length; i += step) {
    const el = itemEls[i];
    const sq = el.querySelector('.square-container');
    if (!sq) continue;
    const b = sq.getBoundingClientRect();
    const cx = b.x + b.width / 2;
    const cy = b.y + b.height / 2;
    if (cx < 2 || cy < 2 || cx > vw - 2 || cy > vh - 2) continue;
    const hit = document.elementFromPoint(cx, cy);
    const isSelf = !!hit && (hit === sq || sq.contains(hit));
    let hitContext = null;
    let hitIntentional = false;
    if (!isSelf && hit) {
      const ctx = hit.closest('#settingsPanel, #sidebar, .sidebar-overlay, .page-subfolder-flyout, .context-menu, .search-select-dropdown, #searchEngineDropdown, .preview-overlay, .name-dialog, .confirm-dialog');
      hitContext = ctx ? (ctx.id || String(ctx.className).split(' ')[0]) : null;
      hitIntentional = !!ctx;
    }
    hitTests.push({ i, x: round(cx), y: round(cy), hitSelf: isSelf, hitContext, hitIntentional, hit: isSelf ? null : describe(hit) });
  }

  // 页面操作按钮（hover 才显示的按钮）：不可见时是否仍可点击
  const pageActionProbes = [];
  const activePageItem = q('.bookmark-page-item.active') || q('.bookmark-page-item');
  if (activePageItem) {
    const actions = activePageItem.querySelector('.page-actions');
    const ar = actions ? rectOf(actions) : null;
    for (const btn of activePageItem.querySelectorAll('.page-action-btn')) {
      const b = btn.getBoundingClientRect();
      const cx = b.x + b.width / 2;
      const cy = b.y + b.height / 2;
      if (b.width === 0 || b.height === 0) { pageActionProbes.push({ cls: btn.className, rect: null, invisibleButHit: false, hiddenBy: 'zero-size' }); continue; }
      const hit = document.elementFromPoint(cx, cy);
      const hitsSelf = !!hit && (hit === btn || btn.contains(hit));
      pageActionProbes.push({
        cls: btn.className, rect: { x: round(b.x), y: round(b.y), w: round(b.width), h: round(b.height) },
        actionsOpacity: ar ? ar.opacity : null, actionsPointerEvents: ar ? ar.pointerEvents : null,
        btnOpacity: round(parseFloat(getComputedStyle(btn).opacity) || 0),
        hitsSelf, hitIfNotSelf: hitsSelf ? null : describe(hit),
      });
    }
  }

  // 文本裁切/溢出
  const clipSelectors = ['.page-name', '.page-count', '.add-page-btn span',
    '.sidebar-settings-btn span', '.flyout-item-name', '.flyout-heading', '.settings-header h2',
    '.setting-item label', '.smart-status', '.active-folder-bar', '.empty-state', '.search-select-option span'];
  const insideInactiveOverlay = (el) => {
    // Lead 要求：隐藏容器（aria-hidden="true"/inert 且不在视口内）内的文本不算越界
    const hiddenAncestor = el.closest('[aria-hidden="true"], [inert]');
    if (hiddenAncestor && !(el.getBoundingClientRect().right > 0.5 && el.getBoundingClientRect().left < vw - 0.5 && el.getBoundingClientRect().bottom > 0.5 && el.getBoundingClientRect().top < vh - 0.5)) return true;
    const sp = el.closest('#settingsPanel');
    if (sp && !sp.classList.contains('active')) return true;
    const sb = el.closest('#sidebar');
    if (sb && sb.classList.contains('collapsed')) return true;
    const fl = el.closest('.page-subfolder-flyout');
    if (fl && !fl.classList.contains('show')) return true;
    const dd = el.closest('.search-select-dropdown');
    if (dd && getComputedStyle(dd).visibility === 'hidden') return true;
    return false;
  };
  const intersectsViewport = (el) => {
    const b = el.getBoundingClientRect();
    return b.width > 0 && b.height > 0 && b.right > 0.5 && b.bottom > 0.5 && b.left < vw - 0.5 && b.top < vh - 0.5;
  };
  const textClipping = [];
  for (const sel of clipSelectors) {
    const nodes = Array.from(document.querySelectorAll(sel)).slice(0, 40);
    for (const el of nodes) {
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || insideInactiveOverlay(el) || !intersectsViewport(el)) continue;
      const clipped = el.scrollWidth > el.clientWidth + 1;
      const b = el.getBoundingClientRect();
      const overflowsViewport = b.right > vw + 0.5 || b.left < -0.5;
      if (clipped || overflowsViewport) {
        textClipping.push({
          sel, text: (el.textContent || '').trim().slice(0, 80),
          clientWidth: el.clientWidth, scrollWidth: el.scrollWidth,
          clipped, overflowsViewport,
          css: { overflow: cs.overflow, textOverflow: cs.textOverflow, whiteSpace: cs.whiteSpace, maxWidth: cs.maxWidth },
        });
      }
    }
  }

  // z-index / 层级
  const zIndexes = {};
  for (const sel of ['.sidebar', '#sidebarTrigger', '.search-container', '#squaresContainer',
    '#settingsPanel', '.sidebar-overlay', '.page-subfolder-flyout', '.search-select-dropdown', '.context-menu']) {
    const el = q(sel);
    if (!el) continue;
    const cs = getComputedStyle(el);
    zIndexes[sel] = { zIndex: cs.zIndex, position: cs.position, display: cs.display, opacity: round(parseFloat(cs.opacity) || 0), visibility: cs.visibility };
  }

  // 设置面板结构
  let settingsInfo = null;
  const settingsPanel = q('#settingsPanel');
  if (settingsPanel && settingsPanel.classList.contains('active')) {
    const sp = settingsPanel;
    const header = sp.querySelector('.settings-header');
    const bar = rectOf(sp);
    settingsInfo = {
      rect: bar,
      scrollHeight: sp.scrollHeight, clientHeight: sp.clientHeight,
      scrollableY: sp.scrollHeight > sp.clientHeight + 1,
      overflowY: getComputedStyle(sp).overflowY,
      header: header ? rectOf(header) : null,
      headerPosition: header ? getComputedStyle(header).position : null,
      headerVisible: header ? rectOf(header).y >= bar.y - 0.5 : null,
      sections: sp.querySelectorAll('.settings-section').length,
      sectionCount: sp.querySelectorAll('.settings-section').length,
      bodyEl: !!sp.querySelector('.settings-body'),
      inertBackground: document.querySelector('.container')?.inert ?? null,
      ariaHidden: sp.getAttribute('aria-hidden'),
    };
  }

  // 浮层/下拉是否在视口内
  let flyoutInfo = null;
  const flyout = q('.page-subfolder-flyout');
  if (flyout && (flyout.classList.contains('show') || isVisible(rectOf(flyout)))) {
    const b = flyout.getBoundingClientRect();
    flyoutInfo = {
      rect: rectOf(flyout),
      withinViewport: b.x >= -0.5 && b.right <= vw + 0.5 && b.y >= -0.5 && b.bottom <= vh + 0.5,
      items: flyout.querySelectorAll('.flyout-item').length,
      class: flyout.className,
    };
  }
  let dropdownInfo = null;
  const dd = q('.search-select-dropdown');
  if (dd) {
    const cs = getComputedStyle(dd);
    const visibleDropdown = cs.visibility !== 'hidden' && parseFloat(cs.opacity) > 0.01;
    if (visibleDropdown) {
      const b = dd.getBoundingClientRect();
      dropdownInfo = { rect: rectOf(dd), withinViewport: b.x >= -0.5 && b.right <= vw + 0.5 && b.bottom <= vh + 0.5, items: dd.querySelectorAll('.search-select-option').length };
    }
  }

  // 网格列分析（用方块中心 x 分组）
  const colXs = [];
  const rowYs = [];
  for (const it of gridItems) {
    if (it.sqx == null) continue;
    const cx = it.sqx + it.sqw / 2;
    const cy = it.sqy + it.sqh / 2;
    let found = false;
    for (const c of colXs) { if (Math.abs(c.x - cx) < 2) { c.count++; c.minX = Math.min(c.minX, it.sqx); c.maxRight = Math.max(c.maxRight, it.sqRight); found = true; break; } }
    if (!found) colXs.push({ x: round(cx), count: 1, minX: it.sqx, maxRight: it.sqRight });
    if (!rowYs.some((y) => Math.abs(y - cy) < 2)) rowYs.push(cy);
  }
  colXs.sort((a, b) => a.x - b.x);
  rowYs.sort((a, b) => a - b);
  const colGaps = [];
  for (let i = 1; i < colXs.length; i++) colGaps.push(round(colXs[i].minX - colXs[i - 1].maxRight));
  const rowGaps = [];
  for (let i = 1; i < rowYs.length; i++) rowGaps.push(round(rowYs[i] - rowYs[i - 1]));
  const colXValues = colXs.map((c) => c.x);
  const colXStep = [];
  for (let i = 1; i < colXValues.length; i++) colXStep.push(round(colXValues[i] - colXValues[i - 1]));
  const grid = {
    itemCount: itemEls.length,
    columns: colXs.length,
    colXValues,
    colXStep,
    colXStepMin: colXStep.length ? Math.min(...colXStep) : null,
    colXStepMax: colXStep.length ? Math.max(...colXStep) : null,
    colGaps,
    colGapMin: colGaps.length ? Math.min(...colGaps) : null,
    colGapMax: colGaps.length ? Math.max(...colGaps) : null,
    rows: rowYs.length,
    rowGaps,
    rowGapMin: rowGaps.length ? Math.min(...rowGaps) : null,
    rowGapMax: rowGaps.length ? Math.max(...rowGaps) : null,
    itemsPerRow: {},
    lastRowCount: 0,
    firstItem: gridItems[0] || null,
    lastItem: gridItems[gridItems.length - 1] || null,
    minItemX: gridItems.length ? Math.min(...gridItems.map((i) => i.sqx ?? Infinity)) : null,
    maxItemRight: gridItems.length ? Math.max(...gridItems.map((i) => i.sqRight ?? -Infinity)) : null,
    minItemY: gridItems.length ? Math.min(...gridItems.map((i) => i.sqy ?? Infinity)) : null,
    maxItemBottom: gridItems.length ? Math.max(...gridItems.map((i) => i.sqBottom ?? -Infinity)) : null,
  };
  const rowMap = new Map();
  for (const it of gridItems) {
    if (it.sqy == null) continue;
    const key = Math.round(it.sqy);
    rowMap.set(key, (rowMap.get(key) || 0) + 1);
  }
  grid.itemsPerRow = Object.fromEntries([...rowMap.entries()].sort((a, b) => a[0] - b[0]).map(([k, v]) => [k, v]));
  const lastRowKey = [...rowMap.keys()].sort((a, b) => a - b).pop();
  grid.lastRowCount = lastRowKey != null ? rowMap.get(lastRowKey) : 0;

  // 当前页/筛选状态
  const activePage = q('.bookmark-page-item.active');
  const folderBarEl = q('.active-folder-bar');
  const state = {
    bodyClass: body.className,
    containerClass: container ? container.className : null,
    sidebarOpen: sidebarIsActive,
    sidebarClass: sidebarEl?.className,
    sidebarInViewport: !!(els.sidebar && isVisible(els.sidebar) && els.sidebar.x > -1),
    settingsOpen: settingsIsActive,
    flyoutOpen: !!(flyoutInfo && flyoutInfo.withinViewport !== false) || !!(flyout && flyout.classList.contains('show')),
    dropdownOpen: !!dropdownInfo,
    activePageName: activePage ? (activePage.querySelector('.page-name')?.textContent || '') : null,
    activePageId: activePage ? activePage.dataset.pageId : null,
    folderFilter: folderBarEl && isVisible(rectOf(folderBarEl)) ? (folderBarEl.textContent || '').trim().slice(0, 60) : null,
    pageItemCount: document.querySelectorAll('.bookmark-page-item').length,
    hasSubfolderPage: !!q('.bookmark-page-item.has-subfolders'),
    emptyStateVisible: isVisible(els.emptyState),
    searchVisible: isVisible(els.search),
    triggerVisible: isVisible(els.trigger),
    overlayVisible: !!(els.overlay && isVisible(els.overlay)),
    squareCount: document.querySelectorAll('.square-container').length,
    squareItemCount: document.querySelectorAll('.square-list-item').length,
  };

  const scrollState = {
    windowY: Math.round((window.scrollY || 0) * 100) / 100,
    docElY: document.scrollingElement ? document.scrollingElement.scrollTop : null,
    containerY: container ? Math.round(container.scrollTop * 100) / 100 : null,
    appMainY: (() => { const m = q('.app-main'); return m ? Math.round(m.scrollTop * 100) / 100 : null; })(),
    bodyScrollHeight: body.scrollHeight,
    docClientHeight: de.clientHeight,
  };

  return {
    ts: Math.round(performance.now() * 100) / 100,
    scrollState,
    readyState: document.readyState,
    viewport: { w: vw, h: vh, dpr: window.devicePixelRatio, matchesMobileMedia: window.matchMedia('(max-width: 768px)').matches },
    doc,
    container: containerMetrics,
    els,
    outOfViewport,
    grid,
    gridItems,
    hitTests,
    pageActionProbes,
    textClipping,
    zIndexes,
    settingsInfo,
    flyoutInfo,
    dropdownInfo,
    state,
    domNodes: document.getElementsByTagName('*').length,
    stylesheets: document.styleSheets.length,
    clSamples: window.__AUDIT_CLS || null,
    longTasks: window.__AUDIT_LONGTASKS || null,
    firstItemMs: window.__AUDIT_FIRST_ITEM_MS ?? null,
    firstSquareContainerMs: window.__AUDIT_FIRST_SQUARE_MS ?? null,
    dclMs: window.__AUDIT_DCL_MS ?? null,
    loadMs: window.__AUDIT_LOAD_MS ?? null,
    titleAnimating: title && title.animationName ? !String(title.animationName).includes('none') : false,
  };
}

export function measureExpr(opts = {}) {
  return `(${pageMeasure.toString()})(${JSON.stringify(opts)})`;
}

/** 初始化脚本：记录首帧时间、首个方块出现、CLS、长任务 */
export const INIT_SCRIPT = `(() => {
  window.__AUDIT_T0 = performance.now();
  window.__AUDIT_CLS = { value: 0, entries: [] };
  window.__AUDIT_LONGTASKS = [];
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        if (e.hadRecentInput) continue;
        window.__AUDIT_CLS.value += e.value;
        if (window.__AUDIT_CLS.entries.length < 40) {
          window.__AUDIT_CLS.entries.push({
            value: Math.round(e.value * 10000) / 10000,
            start: Math.round(e.startTime),
            hadRecentInput: !!e.hadRecentInput,
            sources: (e.sources || []).slice(0, 5).map((s) => ({
              node: s.node ? (s.node.id || String(s.node.className || '').split(' ')[0] || s.node.tagName) : null,
              previousRect: s.previousRect ? { x: Math.round(s.previousRect.x * 10) / 10, y: Math.round(s.previousRect.y * 10) / 10, w: Math.round(s.previousRect.width * 10) / 10, h: Math.round(s.previousRect.height * 10) / 10 } : null,
              currentRect: s.currentRect ? { x: Math.round(s.currentRect.x * 10) / 10, y: Math.round(s.currentRect.y * 10) / 10, w: Math.round(s.currentRect.width * 10) / 10, h: Math.round(s.currentRect.height * 10) / 10 } : null,
            })),
          });
        }
      }
    }).observe({ type: 'layout-shift', buffered: true });
  } catch (e) { window.__AUDIT_CLS.error = String(e); }
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        if (window.__AUDIT_LONGTASKS.length < 200) window.__AUDIT_LONGTASKS.push({ start: Math.round(e.startTime), dur: Math.round(e.duration), name: e.name });
      }
    }).observe({ type: 'longtask', buffered: true });
  } catch (e) { window.__AUDIT_CLS.longtaskError = String(e); }
  window.__AUDIT_FIRST_ITEM_MS = null;
  window.__AUDIT_FIRST_SQUARE_MS = null;
  const mark = () => {
    if (window.__AUDIT_FIRST_ITEM_MS == null && document.querySelector('.square-list-item')) {
      window.__AUDIT_FIRST_ITEM_MS = Math.round(performance.now() * 10) / 10;
    }
    if (window.__AUDIT_FIRST_SQUARE_MS == null && document.querySelector('.square-container')) {
      window.__AUDIT_FIRST_SQUARE_MS = Math.round(performance.now() * 10) / 10;
    }
    if (window.__AUDIT_FIRST_ITEM_MS != null && window.__AUDIT_FIRST_SQUARE_MS != null) { obs.disconnect(); return; }
  };
  const obs = new MutationObserver(mark);
  obs.observe(document, { childList: true, subtree: true });
  document.addEventListener('DOMContentLoaded', () => { window.__AUDIT_DCL_MS = Math.round(performance.now() * 10) / 10; mark(); });
  window.addEventListener('load', () => { window.__AUDIT_LOAD_MS = Math.round(performance.now() * 10) / 10; mark(); });
  // 兜底：header 完成前就开始观察
  const iv = setInterval(() => { mark(); if (document.querySelector('.square-list-item')) clearInterval(iv); }, 50);
})();`;
