#!/usr/bin/env node
// tools/audit.mjs — 真实 Chrome + CDP 布局审计（重构前后可复跑）
//
// 用法：
//   node tools/audit.mjs --ext audit/baseline-ext --out audit/before --label before
//   node tools/audit.mjs --ext . --out audit/after --label after            # 重构后对 src/ 原样复跑
//   node tools/audit.mjs --ext audit/baseline-ext --out audit/before --label before \
//        --viewports 1600x900,1024x768 --states desktop-base-open,desktop-settings-open
//
// 产物：<out>/layout.json、<out>/screens/<viewport>/<state>.png
// 仅使用 Node 标准库 + 本目录 cdp.mjs / seed-data.mjs / measure.mjs。

import path from 'node:path';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { launchChrome, loadExtension, waitExtensionReady, openPage, sleep } from './cdp.mjs';
import { seedPageData } from './seed-data.mjs';
import { measureExpr, INIT_SCRIPT } from './measure.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const out = { viewports: null, states: null, ext: 'audit/baseline-ext', out: 'audit/before', label: 'before' };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--ext') out.ext = next();
    else if (a === '--out') out.out = next();
    else if (a === '--label') out.label = next();
    else if (a === '--viewports') out.viewports = next().split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--states') out.states = next().split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--help' || a === '-h') { console.log(fs.readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(1, 20).join('\n')); process.exit(0); }
    else throw new Error(`unknown arg: ${a}`);
  }
  out.ext = path.resolve(ROOT, out.ext);
  out.out = path.resolve(ROOT, out.out);
  return out;
}

// ---------------------------------------------------------------------------
// 视口与状态矩阵
// ---------------------------------------------------------------------------
const ALL_VIEWPORTS = [
  { w: 1600, h: 900 }, { w: 1440, h: 900 }, { w: 1280, h: 800 }, { w: 1180, h: 800 },
  { w: 1100, h: 800 }, { w: 1024, h: 768 }, { w: 900, h: 800 }, { w: 834, h: 1112 },
  { w: 768, h: 1024 }, { w: 600, h: 900 }, { w: 430, h: 932 }, { w: 390, h: 844 },
].map((v) => ({ ...v, name: `${v.w}x${v.h}`, mobile: v.w <= 768, mode: v.w <= 768 ? 'mobile' : 'desktop' }));

const EXPECTED_BASE_ITEMS = 300; // 当前页 p1 种子书签数
const EXPECTED_FILTERED_ITEMS = 60; // 二级分类「开发」下的书签数

/** 桌面状态矩阵 */
const DESKTOP_STATES = [
  {
    name: 'desktop-base-open', desc: '桌面 · 侧栏展开 · 300 条书签', ready: { items: EXPECTED_BASE_ITEMS },
    async setup(page) { /* prepare() 之后即为该状态 */ },
  },
  {
    name: 'desktop-sidebar-closed', desc: '桌面 · 侧栏收起', ready: { items: EXPECTED_BASE_ITEMS },
    async setup(page) {
      await page.evaluate(`(() => { document.getElementById('sidebarToggle').click(); return true; })()`);
      await page.waitForFunction(`document.querySelector('#sidebar').getBoundingClientRect().right <= 1`);
      await waitCssAnimations(page, 2500);
    },
  },
  {
    name: 'desktop-settings-open', desc: '桌面 · 设置面板打开',
    ready: { items: EXPECTED_BASE_ITEMS },
    async setup(page) {
      await page.evaluate(`(() => { document.getElementById('sidebarSettingsBtn').click(); return true; })()`);
      await page.waitForFunction(`(() => { const p = document.getElementById('settingsPanel'); if (!p.classList.contains('active')) return false; const r = p.getBoundingClientRect(); return r.right <= innerWidth + 1 && r.left >= -1; })()`);
      await waitCssAnimations(page, 2500);
    },
  },
  {
    name: 'desktop-search-dropdown', desc: '桌面 · 搜索引擎下拉打开',
    ready: { items: EXPECTED_BASE_ITEMS },
    async setup(page) {
      await page.evaluate(`(() => { document.getElementById('searchEngine').click(); return true; })()`);
      await sleep(400);
    },
  },
  {
    name: 'desktop-flyout', desc: '桌面 · 二级分类浮层展开',
    ready: { items: EXPECTED_BASE_ITEMS },
    async setup(page) {
      await hoverSubfolderPage(page);
      await page.waitForFunction(`!!document.querySelector('.page-subfolder-flyout.show')`);
      await waitCssAnimations(page, 2000);
    },
  },
  {
    name: 'desktop-filtered', desc: '桌面 · 二级分类筛选「开发」',
    ready: { items: EXPECTED_FILTERED_ITEMS },
    async setup(page) {
      await hoverSubfolderPage(page);
      await page.waitForFunction(`!!document.querySelector('.page-subfolder-flyout.show')`);
      await sleep(250);
      const clicked = await page.evaluate(`(() => {
        const items = Array.from(document.querySelectorAll('.page-subfolder-flyout .flyout-item'));
        const hit = items.find((b) => (b.textContent || '').includes('开发')) || items.find((b) => !(b.textContent || '').includes('全部'));
        if (!hit) return false;
        hit.click();
        return true;
      })()`);
      if (!clicked) throw new Error('filtered: no flyout-item to click');
      await page.waitForFunction(`(document.querySelectorAll('.square-container').length <= 100) && !!document.querySelector('.active-folder-bar')`, { timeoutMs: 8000 });
      await sleep(200);
      await waitCssAnimations(page, 2000);
    },
  },
  {
    name: 'desktop-empty-page', desc: '桌面 · 空页面（0 条书签）',
    ready: { emptyPage: true },
    async setup(page) {
      const clicked = await page.evaluate(`(() => { const it = document.querySelector('.bookmark-page-item[data-page-id="p10"]'); if (!it) return false; it.click(); return true; })()`);
      if (!clicked) throw new Error('empty-page: p10 page item not found');
      await page.waitForFunction(`(() => { const a = document.querySelector('.bookmark-page-item.active'); return a && a.dataset.pageId === 'p10' && (document.querySelector('.square-container') ? false : true); })()`, { timeoutMs: 8000 });
      await sleep(200);
      await waitCssAnimations(page, 2000);
    },
  },
];

/** 移动端状态矩阵 */
const MOBILE_STATES = [
  {
    name: 'mobile-base', desc: '移动端 · 抽屉关闭',
    ready: { items: EXPECTED_BASE_ITEMS },
    async setup() {},
  },
  {
    name: 'mobile-drawer-open', desc: '移动端 · 抽屉打开',
    ready: { items: EXPECTED_BASE_ITEMS },
    async setup(page) {
      await page.evaluate(`(() => { document.getElementById('sidebarTrigger').click(); return true; })()`);
      await page.waitForFunction(`(() => { const s = document.querySelector('#sidebar'); return s && !s.classList.contains('collapsed') && s.getBoundingClientRect().x >= 0; })()`, { timeoutMs: 6000 });
      await waitCssAnimations(page, 2500);
    },
  },
  {
    name: 'mobile-settings-open', desc: '移动端 · 抽屉 + 设置面板打开',
    ready: { items: EXPECTED_BASE_ITEMS },
    async setup(page) {
      await page.evaluate(`(() => { document.getElementById('sidebarTrigger').click(); return true; })()`);
      await page.waitForFunction(`(() => { const s = document.querySelector('#sidebar'); return s && !s.classList.contains('collapsed') && s.getBoundingClientRect().x >= 0; })()`, { timeoutMs: 6000 });
      await waitCssAnimations(page, 2500);
      await page.evaluate(`(() => { document.getElementById('sidebarSettingsBtn').click(); return true; })()`);
      await page.waitForFunction(`(() => { const p = document.getElementById('settingsPanel'); if (!p.classList.contains('active')) return false; const r = p.getBoundingClientRect(); return r.right <= innerWidth + 1 && r.left >= -1; })()`, { timeoutMs: 6000 });
      await waitCssAnimations(page, 2500);
    },
  },
  {
    name: 'mobile-search-dropdown', desc: '移动端 · 搜索引擎下拉打开',
    ready: { items: EXPECTED_BASE_ITEMS },
    async setup(page) {
      await page.evaluate(`(() => { document.getElementById('searchEngine').click(); return true; })()`);
      await sleep(400);
    },
  },
];

/** 仅在 1600x900 采样的「正常动效」状态：用于 CLS / 标题宽度动画证据（其余布局样本用 reduced-motion 保证几何确定） */
const MOTION_STATE = {
  name: 'desktop-motion-title', desc: '桌面 · 正常动效（标题打字动画/CLS 证据）',
  ready: { items: EXPECTED_BASE_ITEMS }, motion: true,
  async setup() {},
};

async function hoverSubfolderPage(page) {
  const ok = await page.evaluate(`(() => {
    const el = document.querySelector('.bookmark-page-item.has-subfolders') || document.querySelector('.bookmark-page-item');
    if (!el) return false;
    el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false, view: window }));
    el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, view: window }));
    return true;
  })()`);
  if (!ok) throw new Error('hoverSubfolderPage: no page item');
  await sleep(250);
}

// ---------------------------------------------------------------------------
// 页面准备 / 等待
// ---------------------------------------------------------------------------
async function prepare(page, mode) {
  const sidebarState = mode === 'mobile' ? 'closed' : 'open';
  await page.evaluate(`(async () => {
    try { localStorage.setItem('sidebarState', ${JSON.stringify(sidebarState)}); } catch (e) {}
    try {
      const d = await chrome.storage.local.get('currentPageId');
      if (d.currentPageId !== 'p1') await chrome.storage.local.set({ currentPageId: 'p1' });
    } catch (e) {}
    return true;
  })()`);
  await page.reload();
  await page.waitForFunction(`document.readyState === 'complete'`, { timeoutMs: 20000 });
}

async function waitBaseReady(page) {
  await page.waitForFunction(`document.readyState === 'complete'`, { timeoutMs: 20000 });
  await page.waitForFunction(`document.querySelectorAll('.square-container').length >= ${EXPECTED_BASE_ITEMS}`, { timeoutMs: 20000 });
  await sleep(140);
  await waitCssAnimations(page, 3000);
  await sleep(100);
}

/** 等有限次 CSS 动画/过渡结束（跳过 infinite 的 breathe 类动画）；超时也继续 */
async function waitCssAnimations(page, timeoutMs = 6000) {
  try {
    await page.waitForFunction(`(() => {
      const targets = [
        document.querySelector('.container'),
        document.querySelector('#sidebar'),
        document.querySelector('#settingsPanel'),
        document.querySelector('.page-subfolder-flyout'),
        document.querySelector('.sidebar-overlay'),
      ].filter(Boolean);
      for (const el of targets) {
        const anims = el.getAnimations ? el.getAnimations({ subtree: false }) : [];
        for (const a of anims) {
          let iterations = 1;
          try { iterations = a.effect.getTiming().iterations; } catch (e) {}
          if (a.playState === 'running' && iterations !== Infinity) return false;
        }
      }
      return true;
    })()`, { timeoutMs });
  } catch (e) {
    // 动画未在预期时间内结束（例如打字动画被节流）→ 继续测量，measure 里会记录当前状态
  }
  await page.evaluate(`new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))`).catch(() => {});
}

async function waitStateReady(page, ready) {
  if (ready.emptyPage) {
    await page.waitForFunction(`(() => {
      const a = document.querySelector('.bookmark-page-item.active');
      return !!a && a.dataset.pageId === 'p10' && !!document.querySelector('.empty-state');
    })()`, { timeoutMs: 12000 });
  } else if (ready.items != null) {
    await page.waitForFunction(`document.querySelectorAll('.square-container').length >= ${ready.items}`, { timeoutMs: 15000 });
  }
  await sleep(250);
}

// ---------------------------------------------------------------------------
// Node 侧断言 / 问题推导
// ---------------------------------------------------------------------------
const round = (n) => Math.round(n * 100) / 100;
const SEV_ORDER = { P0: 0, P1: 1, P2: 2 };

function overlap(a, b) {
  if (!a || !b || a.w <= 0 || a.h <= 0 || b.w <= 0 || b.h <= 0) return null;
  const w = Math.min(a.right, b.right) - Math.max(a.x, b.x);
  const h = Math.min(a.bottom, b.bottom) - Math.max(a.y, b.y);
  if (w <= 0.5 || h <= 0.5) return null;
  const area = w * h;
  return { w: round(w), h: round(h), area: round(area), ratioB: b.w * b.h > 0 ? round(area / (b.w * b.h)) : 0 };
}

export function deriveIssues(sample) {
  const { metrics: m, viewport: vp, stateName, screenshot } = sample;
  const issues = [];
  const add = (category, severity, title, evidence, extra = {}) => {
    issues.push({ id: `L-${category}-${vp}-${stateName}`, category, severity, viewport: vp, state: stateName, title, evidence, screenshot, ...extra });
  };
  const els = m.els || {};
  const st = m.state || {};

  // 1) 文档/容器横向溢出
  if (m.doc.overflowX || (m.container && m.container.innerOverflowX > 1)) {
    add('OVERFLOW-X', m.doc.overflowX ? 'P0' : 'P1', '横向溢出',
      `documentElement.scrollWidth=${m.doc.scrollWidth} > innerWidth=${m.doc.innerWidth}；container.scrollWidth-clientWidth=${m.container?.innerOverflowX ?? 'n/a'}（container 内部溢出）`,
      { doc: m.doc, container: m.container });
  }
  if (m.doc.scrollableX) {
    add('DOC-SCROLL-X', 'P0', '整页可横向滚动', `documentElement scrollWidth=${m.doc.scrollWidth} > clientWidth=${m.doc.clientWidth}`, { doc: m.doc });
  }

  // 2) 关键元素越出视口
  const squaresOutOfViewport = (m.outOfViewport || []).some((o) => o.name === 'squares');
  // 内容型容器（搜索/网格/标题/空状态/分类条）位于滚动区，纵向超出视口是正常滚动内容，只检查横向越界；
  // 固定定位元素（侧栏/触发器/设置面板/浮层）才检查两个方向。
  const HORIZONTAL_ONLY = new Set(['search', 'squares', 'title', 'folderBar', 'emptyState']);
  for (const o of m.outOfViewport || []) {
    if (o.name === 'emptyState' && squaresOutOfViewport) continue; // 根因是网格越界
    const sides = (o.sides || []).filter((side) => (HORIZONTAL_ONLY.has(o.name) ? (side === 'left' || side === 'right') : true));
    if (sides.length === 0) continue;
    o.sides = sides;
    const sev = ['squares', 'sidebar', 'search'].includes(o.name) ? 'P0' : 'P1';
    add('OUT-VIEWPORT', sev, `${o.name} 越出视口（${o.sides.join('/')}）`,
      `rect=(${o.rect.x},${o.rect.y},${o.rect.w}x${o.rect.h}) viewport=${m.doc.innerWidth}x${m.doc.innerHeight}`, { el: o.name, rect: o.rect, sides: o.sides });
  }

  // 3) 关键区域重叠（应互不遮挡的元素对）
  const pairs = [
    ['sidebar', 'search'], ['sidebar', 'squares'], ['sidebar', 'title'],
    ['trigger', 'title'], ['trigger', 'search'], ['trigger', 'squares'],
    ['folderBar', 'squares'], ['title', 'search'], ['search', 'squares'],
  ];
  for (const [a, b] of pairs) {
    const ra = els[a];
    const rb = els[b];
    if (!ra || !rb) continue;
    if (a === 'sidebar' && !st.sidebarOpen) continue;
    if (a === 'trigger' && !st.triggerVisible) continue;
    if (a === 'folderBar' && !st.folderFilter) continue;
    // 移动端抽屉是「覆盖内容」的设计：抽屉与内容的叠放是预期行为，由 z-index 顺序断言代替
    if (sample.mode === 'mobile' && (a === 'sidebar' || b === 'sidebar')) continue;
    const ov = overlap(ra, rb);
    if (!ov) continue;
    // 允许 1px 内的贴边
    if (ov.w <= 1.5 && ov.h <= 1.5) continue;
    // trigger 与标题：轻微贴边（<6px 纵向）不视为缺陷
    if ((a === 'trigger' && b === 'title') || (a === 'title' && b === 'trigger')) {
      if (ov.h < 6) continue;
    }
    const sev = a === 'sidebar' || b === 'squares' || b === 'search' ? 'P0' : 'P1';
    add('OVERLAP', sev, `${a} 与 ${b} 重叠`,
      `${a}=(${ra.x},${ra.y},${ra.w}x${ra.h}) ${b}=(${rb.x},${rb.y},${rb.w}x${rb.h}) 重叠 ${ov.w}x${ov.h}=${ov.area}px²（占 ${b} 面积 ${Math.round(ov.ratioB * 100)}%）`,
      { a, b, overlap: ov, rectA: ra, rectB: rb });
  }

  // 4) 网格几何：列/间距/越界/互相重叠/数量
  const g = m.grid || {};
  if (g.itemCount > 0) {
    if (g.colXStep.length > 1 && g.colXStepMax - g.colXStepMin > 2) {
      add('GRID-COL-DRIFT', 'P1', '网格列间距不均（整列错位）',
        `列中心 x=${JSON.stringify(g.colXValues)}；相邻列间距=${JSON.stringify(g.colXStep)}；差=${round(g.colXStepMax - g.colXStepMin)}px`, { grid: { colXValues: g.colXValues, colXStep: g.colXStep } });
    }
    if (g.colGaps.length > 1 && g.colGapMax - g.colGapMin > 2) {
      add('GRID-GAP-DRIFT', 'P1', '网格列间 gap 不一致',
        `列 gap=${JSON.stringify(g.colGaps)}；min=${g.colGapMin} max=${g.colGapMax}`, { grid: { colGaps: g.colGaps } });
    }
    const squaresRect = els.squares;
    if (squaresRect) {
      if (g.minItemX < squaresRect.x - 1 || g.maxItemRight > squaresRect.right + 1) {
        add('GRID-OUT-OF-CONTAINER', 'P1', '网格项超出 .squares-container 边界',
          `网格项 x=[${g.minItemX}, ${g.maxItemRight}] container=[${squaresRect.x}, ${squaresRect.right}]`, { grid: { minItemX: g.minItemX, maxItemRight: g.maxItemRight, container: squaresRect } });
      }
    }
    if (g.minItemX < 0 || g.maxItemRight > m.doc.innerWidth) {
      add('GRID-OUT-OF-VIEWPORT', 'P0', '网格项超出视口',
        `网格项 x=[${g.minItemX}, ${g.maxItemRight}] innerWidth=${m.doc.innerWidth}`, { grid: { minItemX: g.minItemX, maxItemRight: g.maxItemRight } });
    }
    // 同行方块互相重叠
    const rows = new Map();
    for (const it of m.gridItems || []) {
      if (it.sqy == null) continue;
      const key = Math.round(it.sqy);
      if (!rows.has(key)) rows.set(key, []);
      rows.get(key).push(it);
    }
    let sameRowOverlaps = 0;
    const sameRowSample = [];
    for (const [, arr] of rows) {
      arr.sort((p, q2) => p.sqx - q2.sqx);
      for (let i = 1; i < arr.length; i++) {
        if (arr[i].sqx < arr[i - 1].sqRight - 0.5) {
          sameRowOverlaps++;
          if (sameRowSample.length < 4) sameRowSample.push([arr[i - 1].sqx, arr[i].sqx]);
        }
      }
    }
    if (sameRowOverlaps > 0) {
      add('GRID-ITEM-OVERLAP', 'P0', '同一行方块互相重叠', `重叠对数=${sameRowOverlaps}，示例 ${JSON.stringify(sameRowSample)}`, { sameRowOverlaps });
    }
    if (g.columns === 0) add('GRID-NO-COLUMNS', 'P0', '网格未形成列', `columns=0 itemCount=${g.itemCount}`);
  }
  // 渲染数量不足
  const expected = sample.expectItems;
  if (expected != null && st.squareItemCount < expected) {
    add('GRID-MISSING-ITEMS', 'P0', '网格渲染数量不足', `实际 ${st.squareItemCount}，期望 ${expected}`, { actual: st.squareItemCount, expected });
  }

  // 5) 点击穿透 / 遮挡
  const isMobileDrawer = sample.mode === 'mobile';
  const backgroundHit = (h) => {
    if (!h.hit) return false;
    const cls = String(h.hit.cls || '');
    const id = h.hit.id || '';
    const tag = String(h.hit.tag || '');
    if (id === 'appContainer' || id === 'appMain') return true;
    if (/\bcontainer\b/.test(cls) || /\bapp-main\b/.test(cls)) return true;
    if (tag === 'html' || tag === 'body') return true;
    return false;
  };
  const misses = (m.hitTests || []).filter((h) => {
    if (h.hitSelf || h.hit == null) return false;
    // 命中的是背景/祖先容器（含 inert 子树被跳过后的回退命中），不是真正的「被别的元素遮挡」
    if (backgroundHit(h)) return false;
    // 移动端抽屉/背景遮罩盖住内容是预期行为；桌面端侧栏盖住方块是真 bug（侧栏应推挤内容）
    if (isMobileDrawer && (h.hitContext === 'sidebar' || h.hitContext === 'sidebar-overlay')) return false;
    // 设置面板/下拉/浮层为模态覆盖，盖住内容是预期行为
    if (h.hitIntentional === true && h.hitContext !== 'sidebar' && h.hitContext !== 'sidebar-overlay') return false;
    return true;
  });
  if (misses.length > 0) {
    add('CLICK-THROUGH', 'P0', '方块中心点被其他元素遮挡（点击穿透/被遮挡）',
      `${misses.length}/${m.hitTests.length} 个采样点未命中自身方块；示例 ${JSON.stringify(misses.slice(0, 3).map((x) => ({ i: x.i, hit: x.hit && `${x.hit.tag}.${x.hit.cls || ''}` })))}`,
      { misses: misses.slice(0, 20), sampled: m.hitTests.length });
  }

  // 6) 隐藏的页面操作按钮仍可点击
  const hiddenClickable = (m.pageActionProbes || []).filter((p) => p.rect && p.hitsSelf && p.btnOpacity < 0.05);
  if (hiddenClickable.length > 0) {
    add('INVISIBLE-BUTTON-CLICKABLE', 'P1', '页面操作按钮不可见（opacity:0）时仍可点击',
      `${hiddenClickable.length} 个按钮在 opacity=${hiddenClickable[0].btnOpacity} 时 elementFromPoint 命中自身（${hiddenClickable.map((p) => p.cls).join(', ')}）`,
      { probes: hiddenClickable });
  }

  // 7) 文本裁切/溢出
  const hardClipped = (m.textClipping || []).filter((t) => t.clipped && !(t.css.textOverflow === 'ellipsis') && !(t.css.overflow === 'visible'));
  const clippedEllipsis = (m.textClipping || []).filter((t) => t.clipped && t.css.textOverflow === 'ellipsis');
  const overflowing = (m.textClipping || []).filter((t) => t.overflowsViewport);
  for (const t of hardClipped.slice(0, 6)) {
    add('TEXT-HARD-CLIP', 'P1', `文本被硬裁切：${t.sel}`, `"${t.text}" scrollWidth=${t.scrollWidth} > clientWidth=${t.clientWidth}，overflow=${t.css.overflow} text-overflow=${t.css.textOverflow}`, { text: t });
  }
  if (clippedEllipsis.length) {
    add('TEXT-ELLIPSIS', 'P2', `文本省略号截断（${clippedEllipsis.length} 处）`, `示例 ${JSON.stringify(clippedEllipsis.slice(0, 3).map((t) => ({ sel: t.sel, text: t.text, scroll: t.scrollWidth, client: t.clientWidth })))}`, { texts: clippedEllipsis.slice(0, 10) });
  }
  const gridOutOfViewport = issues.some((i) => i.category === 'OUT-VIEWPORT' && /squares/.test(i.title)) || issues.some((i) => i.category === 'GRID-OUT-OF-VIEWPORT');
  for (const t of overflowing.slice(0, 4)) {
    if (t.sel === '.search-select-option span' && m.dropdownInfo && !m.dropdownInfo.withinViewport) continue; // 根因已由 DROPDOWN-OUT-VIEWPORT 记录
    if (t.sel === '.empty-state' && gridOutOfViewport) continue; // 根因是 .squares-container 越界，已单独记录
    add('TEXT-OVERFLOW-VIEWPORT', 'P1', `文本超出视口：${t.sel}`, `"${t.text}" rect.right/left 越出 innerWidth=${m.doc.innerWidth}`, { text: t });
  }

  // 8) 层级关系
  const z = m.zIndexes || {};
  const searchOverSidebar = overlap(els.search, st.sidebarOpen ? els.sidebar : null);
  if (searchOverSidebar && Number(z['.search-container']?.zIndex) > Number(z['.sidebar']?.zIndex)) {
    add('ZINDEX-SEARCH-OVER-SIDEBAR', 'P0', '搜索框层级高于侧栏且与侧栏重叠（遮挡抽屉/侧栏）',
      `search z-index=${z['.search-container']?.zIndex}, sidebar z-index=${z['.sidebar']?.zIndex}，重叠=${searchOverSidebar.w}x${searchOverSidebar.h}`,
      { zIndexes: z });
  }
  if (st.settingsOpen) {
    const zS = Number(z['#settingsPanel']?.zIndex);
    const zSide = Number(z['.sidebar']?.zIndex);
    if (!Number.isNaN(zS) && !Number.isNaN(zSide) && zS < zSide) {
      add('ZINDEX-SETTINGS-BELOW-SIDEBAR', 'P1', '设置面板层级低于侧栏', `settings z=${zS} < sidebar z=${zSide}`, { zIndexes: z });
    }
  }

  // 8.1) 移动端抽屉：z-index 顺序与遮罩
  if (sample.mode === 'mobile' && st.sidebarOpen) {
    const zSearch = Number(z['.search-container']?.zIndex);
    const zSide = Number(z['.sidebar']?.zIndex);
    if (!Number.isNaN(zSearch) && !Number.isNaN(zSide) && zSearch >= zSide) {
      add('MOBILE-ZINDEX-DRAWER', 'P0', '移动端抽屉层级低于搜索框（搜索框压在抽屉上）',
        `search z-index=${z['.search-container']?.zIndex} >= sidebar z-index=${z['.sidebar']?.zIndex}`, { zIndexes: z });
    }
    if (!st.overlayVisible) {
      add('MOBILE-NO-OVERLAY', 'P1', '移动端抽屉打开时没有遮罩层（背景仍可交互/滚动）', `overlayVisible=${st.overlayVisible}, bodyClass=${st.bodyClass}`, { zIndexes: z });
    }
  }

  // 9) 设置面板结构/滚动
  if (m.settingsInfo) {
    const s = m.settingsInfo;
    if (s.scrollableY && s.headerPosition === 'static') {
      add('SETTINGS-HEADER-SCROLLS', 'P2', '设置面板标题栏不固定，内容滚动后标题/关闭按钮滚出视口',
        `panel scrollHeight=${s.scrollHeight} > clientHeight=${s.clientHeight}，header position=${s.headerPosition}`, { settings: { scrollHeight: s.scrollHeight, clientHeight: s.clientHeight, headerPosition: s.headerPosition } });
    }
    if (s.rect && s.rect.w > m.doc.innerWidth + 0.5) {
      add('SETTINGS-WIDER-THAN-VIEWPORT', 'P1', '设置面板宽于视口', `panel width=${s.rect.w} > innerWidth=${m.doc.innerWidth}`);
    }
    if (s.scrollHeight <= s.clientHeight + 1 && s.sections > 0 && s.sectionCount >= 2) {
      // 面板内容理论上应超过一屏（4 个 section），如果不可滚动但内容被裁掉则另算
    }
    const panelRect = s.rect;
    if (panelRect && (panelRect.x < -0.5 || panelRect.right > m.doc.innerWidth + 0.5)) {
      add('SETTINGS-OUT-VIEWPORT', 'P1', '设置面板越出视口', `panel=(${panelRect.x},${panelRect.y},${panelRect.w}x${panelRect.h}) viewport=${m.doc.innerWidth}x${m.doc.innerHeight}`);
    }
  }

  // 10) 浮层/下拉 clamp
  if (m.flyoutInfo && !m.flyoutInfo.withinViewport) {
    add('FLYOUT-OUT-VIEWPORT', 'P1', '二级分类浮层超出视口（未 clamp）',
      `flyout=(${m.flyoutInfo.rect.x},${m.flyoutInfo.rect.y},${m.flyoutInfo.rect.w}x${m.flyoutInfo.rect.h}) viewport=${m.doc.innerWidth}x${m.doc.innerHeight}`, { flyout: m.flyoutInfo });
  }
  if (m.dropdownInfo && !m.dropdownInfo.withinViewport) {
    add('DROPDOWN-OUT-VIEWPORT', 'P1', '搜索引擎下拉超出视口（未 clamp）',
      `dropdown=(${m.dropdownInfo.rect.x},${m.dropdownInfo.rect.y},${m.dropdownInfo.rect.w}x${m.dropdownInfo.rect.h}) viewport=${m.doc.innerWidth}x${m.doc.innerHeight}`, { dropdown: m.dropdownInfo });
  }

  // 11) 标题动画 / CLS
  const cls = m.clSamples;
  if (cls && cls.value > 0.1) {
    const interactiveState = /settings|drawer|dropdown|flyout|filtered|sidebar/.test(stateName);
    add('CLS', interactiveState ? 'P2' : 'P1', interactiveState ? '交互触发的布局偏移（用 layout 属性做过渡）' : '累计布局偏移（CLS）超标',
      `CLS=${round(cls.value)}（>0.1 为阈值；interaction-triggered=${interactiveState}；合成 click 不算 user input，真实点击会被 hadRecentInput 排除，但每帧 layout 回流成本仍存在）；entries=${JSON.stringify((cls.entries || []).slice(0, 4))}`, { cls });
  }
  // 标题被 flex 压缩/裁切（v1.9 实测：300 条书签时 .container::before 高度 28.59px → 4.65px / 移动端 1.17px）
  const titleEl = m.els.title;
  if (titleEl && (m.state?.squareItemCount || 0) > 0) {
    const expectedH = titleEl.fontSize ? titleEl.fontSize * 1.1 : (titleEl.lineHeight || 28);
    const realH = titleEl.h;
    if (realH > 0 && realH < Math.max(0.5 * expectedH, 10)) {
      add('TITLE-SQUEEZED', 'P0', '标题被 flex 纵向压缩/裁切（文字只剩一条细缝）',
        `::before computed height=${realH}px，期望 line-height≈${round(expectedH)}px（font-size=${titleEl.fontSize}px）；container 为 column flex 且 300 条书签时内容溢出，伪元素作为 flex item 被 flex-shrink 压扁`,
        { title: titleEl });
    }
  }
  const titleWidthAnimated = m.els.title?.animatesWidth === true || (m.els.title?.animatesWidth === undefined && m.els.title?.kind === 'pseudo');
  if (m.titleAnimating && titleWidthAnimated && /motion/.test(stateName)) {
    add('TITLE-WIDTH-ANIM', 'P2', '标题使用宽度打字动画（逐帧改 width，持续触发该行回流/重绘）',
      `title=::before, animation=${JSON.stringify(m.els.title?.animationName)}, 采样时宽度=${m.els.title?.w}px（最终 355.63px）`, { title: m.els.title });
  }

  // 12) 控制台错误
  const appErrors = (sample.console?.errors || []).filter((e) => !/favicon|ERR_|net::/i.test(e) || /console\.error|uncaught/i.test(e));
  if (appErrors.length) {
    add('CONSOLE-ERROR', 'P0', '页面控制台报错 / 未捕获异常', appErrors.slice(0, 5).join(' | '), { errors: appErrors.slice(0, 10) });
  }
  const netErrors = (sample.console?.errors || []).filter((e) => /net::|ERR_/i.test(e));
  if (netErrors.length) {
    add('NETWORK-ERROR', 'P2', '资源加载失败（网络错误）', netErrors.slice(0, 5).join(' | '), { errors: netErrors.slice(0, 10) });
  }

  // 13) 空页面必须有空状态
  if (sample.expectEmpty && !st.emptyStateVisible) {
    add('EMPTY-MISSING-STATE', 'P1', '空页面未显示空状态提示', `squareItemCount=${st.squareItemCount}, emptyStateVisible=${st.emptyStateVisible}`);
  }
  return issues;
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------
async function main() {
  const args = parseArgs(process.argv);
  const startedAt = Date.now();
  let viewports = ALL_VIEWPORTS;
  if (args.viewports) {
    viewports = args.viewports.map((name) => {
      const v = ALL_VIEWPORTS.find((x) => x.name === name);
      if (!v) throw new Error(`unknown viewport: ${name}`);
      return v;
    });
  }
  const stateFilter = args.states ? new Set(args.states) : null;

  const screensDir = path.join(args.out, 'screens');
  await fsp.mkdir(screensDir, { recursive: true });

  console.log(`[audit] label=${args.label} ext=${args.ext}`);
  console.log(`[audit] out=${args.out} viewports=${viewports.length} states=${stateFilter ? [...stateFilter].join(',') : 'all'}`);

  const profileDir = path.join(ROOT, 'audit', `.chrome-profile-${args.label}`);
  const samples = [];
  let chromeVersion = null;
  let chrome = null;
  let page = null;
  const isDisconnect = (e) => /send after close|websocket closed|Target closed|Chrome exited|not connected|disconnected/i.test(String(e && e.message || e));

  /** 启动/重启浏览器会话（headless），并完成定位数据种子；遇到 Chrome 崩溃时自动恢复 */
  async function startSession(tag = '') {
    if (chrome) {
      try { if (page) await page.close(); } catch { /* ignore */ }
      try { await chrome.kill(); } catch { /* ignore */ }
      chrome = null; page = null;
    }
    chrome = await launchChrome({ profileDir, headless: true });
    const ver = await fetch(`http://127.0.0.1:${chrome.port}/json/version`).then((r) => r.json()).catch(() => ({}));
    if (!chromeVersion) chromeVersion = ver.Browser || null;
    const ext = await loadExtension(chrome.browser, args.ext);
    if (!ext.enabled) throw new Error('extension not enabled');
    await waitExtensionReady(chrome.browser, ext.id);
    page = await openPage(chrome.browser, `chrome-extension://${ext.id}/src/index.html`, { width: 1600, height: 900 });
    await page.addInitScript(INIT_SCRIPT);
    // 布局审计使用 prefers-reduced-motion: reduce：消除过渡被窗口遮挡/headless 帧调度造成的非确定性几何
    await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    page.framePump = true;
    await page.reload();
    await page.waitForFunction(`document.readyState === 'complete'`, { timeoutMs: 20000 });
    await seedPageData(page);
    await sleep(900);
    await seedPageData(page); // 防竞态：首次初始化可能异步写回默认页面
    await sleep(200);
    await page.reload();
    await page.waitForFunction(`document.readyState === 'complete'`, { timeoutMs: 20000 });
    await page.waitForFunction(`document.querySelectorAll('.square-container').length >= ${EXPECTED_BASE_ITEMS}`, { timeoutMs: 20000 });
    console.log(`[audit] session ready${tag ? ` (${tag})` : ''} pid=${chrome.child.pid}`);
  }

  await startSession();
  try {
    let seq = 0;
    for (const vp of viewports) {
      let states = (vp.mode === 'desktop' ? DESKTOP_STATES : MOBILE_STATES).filter((s) => !stateFilter || stateFilter.has(s.name));
      if (!stateFilter && vp.name === '1600x900') states = [...states, MOTION_STATE];
      if (!states.length) continue;
      console.log(`\n[audit] ===== viewport ${vp.name} (${vp.mode}) =====`);
      try {
        await page.setViewport({ width: vp.w, height: vp.h, mobile: vp.mobile, deviceScaleFactor: 1 });
      } catch (e) {
        if (!isDisconnect(e)) throw e;
        await startSession(`restart@${vp.name}`);
        await page.setViewport({ width: vp.w, height: vp.h, mobile: vp.mobile, deviceScaleFactor: 1 });
      }
      for (const state of states) {
        seq++;
        let attempt = 0;
        for (;;) {
          const t0 = Date.now();
          page.clearConsole();
          try {
            if (state.motion) {
              await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
            }
            await prepare(page, vp.mode);
            if (state.motion) {
              await page.waitForFunction(`document.querySelectorAll('.square-container').length >= ${EXPECTED_BASE_ITEMS}`, { timeoutMs: 20000 });
              await sleep(1100);
            } else {
              await waitBaseReady(page);
            }
            await state.setup(page);
            await waitStateReady(page, state.ready);
            const metrics = await page.evaluate(measureExpr({ squareLimit: 400, hitSample: 150 }), { timeoutMs: 45000 });
            const shotName = `${state.name}.png`;
            const shotPath = path.join(screensDir, vp.name, shotName);
            await page.screenshotTo(shotPath);
            const consoleIssues = page.consoleIssues();
            const sample = {
              seq, label: args.label, viewport: vp.name, mode: vp.mode, stateName: state.name, stateDesc: state.desc,
              screenshot: path.relative(args.out, shotPath),
              expectItems: state.ready.items ?? (state.ready.emptyPage ? 0 : null),
              expectEmpty: !!state.ready.emptyPage,
              metrics, console: consoleIssues,
              durationMs: Date.now() - t0,
            };
            sample.issues = deriveIssues(sample);
            samples.push(sample);
            if (state.motion) {
              await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] }).catch(() => {});
            }
            const p0 = sample.issues.filter((i) => i.severity === 'P0').length;
            const p1 = sample.issues.filter((i) => i.severity === 'P1').length;
            console.log(`  [${seq}] ${vp.name}/${state.name}: items=${metrics.state.squareItemCount} cols=${metrics.grid.columns} P0=${p0} P1=${p1} errors=${consoleIssues.errors.length} (${Date.now() - t0}ms)`);
            break;
          } catch (e) {
            if (attempt === 0 && isDisconnect(e)) {
              attempt++;
              console.error(`  [${seq}] ${vp.name}/${state.name}: Chrome 断开（${e.message}），自动重启会话后重试…`);
              try {
                await startSession('recovery');
                await page.setViewport({ width: vp.w, height: vp.h, mobile: vp.mobile, deviceScaleFactor: 1 });
              } catch (e2) {
                console.error('  [audit] 会话恢复失败：', e2.message);
              }
              continue;
            }
            console.error(`  [${seq}] ${vp.name}/${state.name}: FAILED ${e.message}`);
            samples.push({
              seq, label: args.label, viewport: vp.name, mode: vp.mode, stateName: state.name,
              stateDesc: state.desc, error: e.message, screenshot: null, metrics: null,
              console: (() => { try { return page ? page.consoleIssues() : { errors: [], warns: [] }; } catch { return { errors: [], warns: [] }; } })(),
              issues: [], durationMs: Date.now() - t0,
            });
            break;
          }
        }
      }
    }
    try { if (page) await page.close(); } catch { /* ignore */ }
  } finally {
    if (chrome) await chrome.kill();
    console.log('[audit] chrome killed');
  }

  // 汇总
  const allIssues = samples.flatMap((s) => s.issues || []);
  const bySeverity = { P0: 0, P1: 0, P2: 0 };
  for (const i of allIssues) bySeverity[i.severity] = (bySeverity[i.severity] || 0) + 1;
  const byCategory = {};
  for (const i of allIssues) {
    byCategory[i.category] = byCategory[i.category] || { count: 0, P0: 0, P1: 0, P2: 0, viewports: new Set(), states: new Set() };
    const c = byCategory[i.category];
    c.count++;
    c[i.severity]++;
    c.viewports.add(i.viewport);
    c.states.add(i.state);
  }
  const byCategoryOut = Object.fromEntries(Object.entries(byCategory).sort((a, b) => (b[1].P0 - a[1].P0) || (b[1].P1 - a[1].P1) || (b[1].count - a[1].count)).map(([k, v]) => [k, {
    count: v.count, P0: v.P0, P1: v.P1, P2: v.P2,
    viewports: [...v.viewports], states: [...v.states],
  }]));

  // 精简落盘的网格项采样（保留首/尾/均匀样本），避免 JSON 过大
  const trimmed = samples.map((s) => {
    if (!s.metrics) return s;
    const gi = s.metrics.gridItems || [];
    const pick = [];
    const idx = new Set();
    for (let i = 0; i < Math.min(6, gi.length); i++) idx.add(i);
    for (let i = Math.max(0, gi.length - 6); i < gi.length; i++) idx.add(i);
    const step = Math.max(1, Math.floor(gi.length / 10));
    for (let i = 0; i < gi.length; i += step) idx.add(i);
    for (const i of [...idx].sort((a, b) => a - b)) pick.push(gi[i]);
    return { ...s, metrics: { ...s.metrics, gridItems: pick, gridItemsSampled: gi.length } };
  });

  const out = {
    label: args.label,
    extPath: args.ext,
    chromeVersion,
    startedAt: new Date(startedAt).toISOString(),
    durationMs: Date.now() - startedAt,
    thresholds: { cls: 0.1, itemCount: EXPECTED_BASE_ITEMS, viewports: viewports.map((v) => v.name) },
    summary: {
      sampleCount: samples.length,
      failedSamples: samples.filter((s) => s.error).length,
      issueCount: allIssues.length,
      bySeverity,
      byCategory: byCategoryOut,
      consoleErrorSamples: samples.filter((s) => (s.console?.errors || []).length).length,
    },
    samples: trimmed,
  };
  const outJson = path.join(args.out, 'layout.json');
  await fsp.writeFile(outJson, JSON.stringify(out, null, 2));

  console.log('\n[audit] ===== SUMMARY =====');
  console.log(`[audit] samples=${samples.length} failed=${out.summary.failedSamples} issues=${allIssues.length} P0=${bySeverity.P0} P1=${bySeverity.P1} P2=${bySeverity.P2}`);
  console.log('[audit] by category:');
  for (const [cat, v] of Object.entries(byCategoryOut)) console.log(`  ${cat}: count=${v.count} P0=${v.P0} P1=${v.P1} P2=${v.P2} viewports=${v.viewports.join(',')}`);
  console.log(`[audit] json: ${outJson}`);
  console.log(`[audit] screenshots: ${screensDir}`);
}

// 允许其它脚本 import deriveIssues 做离线重算（不自动跑审计）
import { fileURLToPath } from 'node:url';
const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) main().catch((e) => { console.error('[audit] FATAL', e); process.exit(1); });
