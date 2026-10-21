#!/usr/bin/env node
// tools/perf-audit.mjs — 真实 Chrome + CDP 性能基线（重构前后可复跑、可对比）
//
// 用法：
//   node tools/perf-audit.mjs --ext audit/baseline-ext --out audit/before/perf.json --label before
//   node tools/perf-audit.mjs --ext . --out audit/after/perf.json --label after
//
// 测点（1600x900，10 页面 / 当前页 300 条书签）：
//   1. 首屏：navigation timing + 首个 .square-list-item / .square-container 出现时刻 + 首屏长任务 + DOM 节点数/文档大小
//   2. 页面切换：点击第 2 个页面 → 新页面网格首项出现在 DOM 的耗时
//   3. 单条更新：chrome.storage.local.set 新增 1 条书签（模拟浏览器星标镜像）→ 对应 URL 出现在 DOM 的耗时
//   4. 滚动：CDP mouseWheel 连续滚动 2s，rAF 帧间隔 avg/p95/max、>33ms/>50ms 帧数、长任务数
// 仅使用 Node 标准库 + 本目录 cdp.mjs / seed-data.mjs。

import path from 'node:path';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { launchChrome, loadExtension, waitExtensionReady, openPage, sleep } from './cdp.mjs';
import { seedPageData } from './seed-data.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');

function parseArgs(argv) {
  const out = { ext: 'audit/baseline-ext', out: 'audit/before/perf.json', label: 'before', repeats: 3, headless: true };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--ext') out.ext = next();
    else if (a === '--out') out.out = next();
    else if (a === '--label') out.label = next();
    else if (a === '--repeats') out.repeats = Math.max(1, Number(next()) || 3);
    else if (a === '--headed') out.headless = false;
    else if (a === '--help' || a === '-h') { console.log('node tools/perf-audit.mjs --ext <dir> --out <file> --label before [--repeats 3]'); process.exit(0); }
    else throw new Error(`unknown arg: ${a}`);
  }
  out.ext = path.resolve(ROOT, out.ext);
  out.out = path.isAbsolute(out.out) ? out.out : path.resolve(ROOT, out.out);
  return out;
}

const PERF_INIT_SCRIPT = `(() => {
  const P = window.__PERF = {
    t0: performance.now(),
    firstItemMs: null, firstSquareMs: null, dclMs: null, loadMs: null,
    longtasks: [], cls: 0, shifts: [], mo: 0,
  };
  const mark = () => {
    if (P.firstItemMs == null && document.querySelector('.square-list-item')) P.firstItemMs = Math.round(performance.now() * 10) / 10;
    if (P.firstSquareMs == null && document.querySelector('.square-container')) P.firstSquareMs = Math.round(performance.now() * 10) / 10;
    if (P.firstItemMs != null && P.firstSquareMs != null) { try { obs.disconnect(); } catch (e) {} }
  };
  const obs = new MutationObserver(() => { P.mo++; mark(); });
  try { obs.observe(document, { childList: true, subtree: true }); } catch (e) {}
  document.addEventListener('DOMContentLoaded', () => { P.dclMs = Math.round(performance.now() * 10) / 10; mark(); });
  window.addEventListener('load', () => { P.loadMs = Math.round(performance.now() * 10) / 10; mark(); });
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        if (e.hadRecentInput) continue;
        P.cls += e.value;
        if (P.shifts.length < 20) P.shifts.push({ value: Math.round(e.value * 10000) / 10000, start: Math.round(e.startTime) });
      }
    }).observe({ type: 'layout-shift', buffered: true });
  } catch (e) {}
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        if (P.longtasks.length < 300) P.longtasks.push({ start: Math.round(e.startTime), dur: Math.round(e.duration) });
      }
    }).observe({ type: 'longtask', buffered: true });
  } catch (e) {}
  const iv = setInterval(() => { mark(); if (document.querySelector('.square-list-item')) clearInterval(iv); }, 40);
})();`;

const median = (arr) => {
  const a = arr.filter((x) => typeof x === 'number' && Number.isFinite(x)).sort((x, y) => x - y);
  if (!a.length) return null;
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid] : Math.round(((a[mid - 1] + a[mid]) / 2) * 100) / 100;
};
const round = (n) => (typeof n === 'number' && Number.isFinite(n) ? Math.round(n * 100) / 100 : n);

async function waitBoot(page) {
  await page.waitForFunction(`document.readyState === 'complete'`, { timeoutMs: 20000 });
  await page.waitForFunction(`document.querySelectorAll('.square-container').length >= 300`, { timeoutMs: 20000 });
}

/** 1) 首屏：页面内补齐 navigation timing / paint / longtask / DOM 大小 */
async function collectFirstScreen(page) {
  return page.evaluate(`(() => {
    const P = window.__PERF || {};
    const nav = (performance.getEntriesByType('navigation')[0] || {});
    const paint = {};
    for (const e of performance.getEntriesByType('paint')) paint[e.name] = Math.round(e.startTime * 10) / 10;
    return {
      nav: {
        type: nav.type || null,
        responseEnd: Math.round((nav.responseEnd || 0) * 10) / 10,
        domContentLoaded: Math.round((nav.domContentLoadedEventEnd || 0) * 10) / 10,
        load: Math.round((nav.loadEventEnd || 0) * 10) / 10,
        transferSize: nav.transferSize ?? null,
        encodedBodySize: nav.encodedBodySize ?? null,
      },
      paint,
      firstItemMs: P.firstItemMs ?? null,
      firstSquareMs: P.firstSquareMs ?? null,
      dclMs: P.dclMs ?? null,
      loadMs: P.loadMs ?? null,
      t0Ms: Math.round((P.t0 || 0) * 10) / 10,
      longTasks: (P.longtasks || []).slice(0, 30),
      longTaskCount: (P.longtasks || []).length,
      longTaskMaxMs: (P.longtasks || []).reduce((m, t) => Math.max(m, t.dur), 0),
      cls: Math.round((P.cls || 0) * 10000) / 10000,
      mutationCallbacks: P.mo ?? null,
      marks: performance.getEntriesByType('mark').map((m) => ({ name: m.name, start: Math.round(m.startTime * 10) / 10 })),
      bootToFirstRenderMs: (() => {
        const marks = performance.getEntriesByType('mark');
        const start = marks.find((m) => m.name === 'boot:start');
        const first = marks.find((m) => m.name === 'render:first');
        return start && first ? Math.round((first.startTime - start.startTime) * 100) / 100 : null;
      })(),
      domNodes: document.getElementsByTagName('*').length,
      squareItemCount: document.querySelectorAll('.square-list-item').length,
      listeners: null, // 真实监听器数取 CDP Performance.getMetrics 的 JSEventListeners（result.cdpMetrics）
      docHtmlBytes: new Blob([document.documentElement.outerHTML]).size,
      styleSheets: document.styleSheets.length,
      scriptTags: document.scripts.length,
      viewport: { w: innerWidth, h: innerHeight },
    };
  })()`, { timeoutMs: 30000 });
}

/** 2) 页面切换：点击第 2 个页面 → 新页面首项进入 DOM */
async function measurePageSwitch(page, targetIndex = 1) {
  return page.evaluate(`(async () => {
    const items = Array.from(document.querySelectorAll('.bookmark-page-item'));
    const target = items[${targetIndex}];
    if (!target) return { error: 'no-target-page', pageCount: items.length };
    const targetId = target.dataset.pageId;
    const prefix = 'https://' + targetId + '-site';
    const container = document.getElementById('squaresContainer');
    const t0 = performance.now();
    const waitFirst = new Promise((resolve) => {
      let done = false;
      const finish = (ms) => { if (!done) { done = true; try { mo.disconnect(); } catch (e) {} resolve(ms); } };
      const check = () => {
        const first = container && container.querySelector('.square-container');
        if (first && (first.dataset.url || '').startsWith(prefix)) return finish(performance.now() - t0);
        if (performance.now() - t0 > 8000) return finish(null);
        requestAnimationFrame(check);
      };
      const mo = new MutationObserver(check);
      if (container) mo.observe(container, { childList: true, subtree: true });
      check();
    });
    target.click();
    const ms = await waitFirst;
    return {
      targetPageId: targetId,
      switchMs: ms == null ? null : Math.round(ms * 100) / 100,
      itemCount: document.querySelectorAll('.square-container').length,
      activePageId: document.querySelector('.bookmark-page-item.active')?.dataset.pageId || null,
    };
  })()`, { timeoutMs: 20000 });
}

/** 3) 单条更新：写 storage → DOM 出现该 URL */
async function measureSingleUpdate(page, seq) {
  return page.evaluate(`(async () => {
    const active = document.querySelector('.bookmark-page-item.active');
    const pageId = active ? active.dataset.pageId : null;
    const key = 'squares_' + pageId;
    const store = await chrome.storage.local.get(key);
    const cur = store[key] || [];
    const url = 'https://audit-single-update-' + ${seq} + '-' + Date.now() + '.example.com/';
    const item = { url, title: '单条更新测试', folder: '' };
    const container = document.getElementById('squaresContainer');
    const t0 = performance.now();
    const wait = new Promise((resolve) => {
      let done = false;
      const finish = (ms) => { if (!done) { done = true; try { mo.disconnect(); } catch (e) {} resolve(ms); } };
      const check = () => {
        const el = container && container.querySelector('.square-container[data-url="' + url + '"]');
        if (el) return finish(performance.now() - t0);
        if (performance.now() - t0 > 5000) return finish(null);
        requestAnimationFrame(check);
      };
      const mo = new MutationObserver(check);
      if (container) mo.observe(container, { childList: true, subtree: true });
      check();
    });
    await chrome.storage.local.set({ [key]: [...cur, item] });
    const ms = await wait;
    return {
      pageId,
      updateMs: ms == null ? null : Math.round(ms * 100) / 100,
      beforeCount: cur.length,
      afterCount: document.querySelectorAll('.square-container').length,
    };
  })()`, { timeoutMs: 20000 });
}

/** 4) 滚动：CDP 连续滚轮 2s，页面内 rAF 采帧 */
function metricsMap(m) {
  const map = {};
  for (const x of (m && m.metrics) || []) map[x.name] = x.value;
  return map;
}
const metricDelta = (a, b, keys) => Object.fromEntries(keys.map((k) => [k, round((b[k] || 0) - (a[k] || 0))]));

/** rAF 帧率基线（不滚动，1s） */
async function measureIdleRaf(page, durationMs = 1000) {
  await page.evaluate(`(() => { window.__RAF_IDLE = { times: [], stop: false };
    const loop = (t) => { window.__RAF_IDLE.times.push(t); if (!window.__RAF_IDLE.stop) requestAnimationFrame(loop); };
    requestAnimationFrame(loop); return true; })()`);
  await sleep(durationMs);
  return page.evaluate(`(() => {
    window.__RAF_IDLE.stop = true;
    const t = window.__RAF_IDLE.times || [];
    const iv = []; for (let i = 1; i < t.length; i++) iv.push(t[i] - t[i - 1]);
    iv.sort((a, b) => a - b);
    const sum = iv.reduce((a, b) => a + b, 0);
    const pct = (p) => (iv.length ? iv[Math.min(iv.length - 1, Math.floor(iv.length * p))] : null);
    return { frames: t.length, avg: iv.length ? Math.round((sum / iv.length) * 100) / 100 : null,
      p95: pct(0.95) == null ? null : Math.round(pct(0.95) * 100) / 100,
      max: iv.length ? Math.round(iv[iv.length - 1] * 100) / 100 : null,
      over33ms: iv.filter((x) => x > 33).length };
  })()`, { timeoutMs: 15000 });
}

async function findScroller(page) {
  return page.evaluate(`(() => {
    const candidates = [document.querySelector('.app-main'), document.querySelector('.container'), document.scrollingElement, document.body].filter(Boolean);
    for (const el of candidates) {
      if (el && el.scrollHeight > el.clientHeight + 8 && el.clientHeight > 100) {
        document.querySelectorAll('[data-audit-scroller]').forEach((n) => n.removeAttribute('data-audit-scroller'));
        el.setAttribute('data-audit-scroller', '1');
        el.scrollTop = 0;
        return { selector: el.id ? '#' + el.id : '.' + String(el.className).split(' ')[0], scrollHeight: el.scrollHeight, clientHeight: el.clientHeight, tag: el.tagName };
      }
    }
    return null;
  })()`, { timeoutMs: 15000 });
}

async function measureScroll(page, durationMs = 2000) {
  await page.send('Performance.enable');
  const metricsBefore = metricsMap(await page.send('Performance.getMetrics'));
  await page.evaluate(`(() => {
    window.__RAF = { times: [], stop: false };
    const loop = (t) => { window.__RAF.times.push(t); if (!window.__RAF.stop) requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
    window.__PERF_SCROLL_T0 = performance.now();
    return true;
  })()`);
  const scroller = await findScroller(page);
  const start = Date.now();
  let steps = 0;
  const pending = [];
  // 批量派发滚轮事件（不逐个 await，否则 Node↔Chrome 往返会把 2s 滚动窗口拉长）
  while (Date.now() - start < durationMs) {
    pending.push(page.wheelScroll(800, 450, 0, 120).catch(() => {}));
    steps++;
    await sleep(16);
  }
  await Promise.all(pending);
  const metricsAfter = metricsMap(await page.send('Performance.getMetrics'));
  const result = await page.evaluate(`(() => {
    window.__RAF.stop = true;
    const t = window.__RAF.times;
    const iv = [];
    for (let i = 1; i < t.length; i++) iv.push(t[i] - t[i - 1]);
    iv.sort((a, b) => a - b);
    const sum = iv.reduce((a, b) => a + b, 0);
    const pct = (p) => (iv.length ? iv[Math.min(iv.length - 1, Math.floor(iv.length * p))] : null);
    const elapsed = performance.now() - window.__PERF_SCROLL_T0;
    const lts = (window.__PERF.longtasks || []).filter((lt) => lt.start + lt.dur > (window.__PERF_SCROLL_T0 || 0));
    const c = document.querySelector('[data-audit-scroller]') || document.querySelector('.container');
    return {
      frames: t.length,
      frameIntervals: iv.map((x) => Math.round(x * 100) / 100),
      avg: iv.length ? Math.round((sum / iv.length) * 100) / 100 : null,
      p95: pct(0.95) == null ? null : Math.round(pct(0.95) * 100) / 100,
      max: iv.length ? Math.round(iv[iv.length - 1] * 100) / 100 : null,
      over33ms: iv.filter((x) => x > 33).length,
      over50ms: iv.filter((x) => x > 50).length,
      elapsedMs: Math.round(elapsed),
      longTaskCount: lts.length,
      longTaskMaxMs: lts.reduce((m, x) => Math.max(m, x.dur), 0),
      scrollTop: c ? c.scrollTop : null,
      scrollHeight: c ? c.scrollHeight : null,
    };
  })()`, { timeoutMs: 20000 });
  result.cdpDeltas = metricDelta(metricsBefore, metricsAfter, ['LayoutDuration', 'RecalcStyleDuration', 'ScriptDuration', 'TaskDuration', 'LayoutCount', 'RecalcStyleCount', 'Nodes', 'JSHeapUsedSize']);
  result.scroller = scroller;
  result.scrollEffective = !!(result.scrollTop > 0);
  return { ...result, wheelSteps: steps };
}

async function getCdpMetrics(page) {
  try {
    const m = await page.send('Performance.enable').then(() => page.send('Performance.getMetrics'));
    const map = {};
    for (const x of m.metrics || []) map[x.name] = x.value;
    return map;
  } catch { return null; }
}

async function main() {
  const args = parseArgs(process.argv);
  const startedAt = Date.now();
  await fsp.mkdir(path.dirname(args.out), { recursive: true });
  const profileDir = path.join(ROOT, 'audit', `.chrome-profile-perf-${args.label}`);
  console.log(`[perf] label=${args.label} ext=${args.ext} out=${args.out}`);

  const chrome = await launchChrome({ profileDir, headless: args.headless, extraArgs: args.headless ? ['--disable-frame-rate-limit'] : [] });
  console.log(`[perf] chrome started pid=${chrome.child.pid} port=${chrome.port}`);
  let chromeVersion = null;
  const result = {
    label: args.label,
    extPath: args.ext,
    startedAt: new Date(startedAt).toISOString(),
    data: { pages: 10, currentPageItems: 300, otherItems: 50, viewport: '1600x900' },
    env: { headless: args.headless, extraArgs: args.headless ? ['--headless=new(default)', '--disable-frame-rate-limit'] : [] },
    budgets: {
      firstSquareMs: 120, pageSwitchMs: 120, singleUpdateMs: 50, longTaskMs: 50,
      scrollP95Ms: 33,
    },
    firstScreen: null, pageSwitch: null, singleUpdate: null, scroll: null, cdpMetrics: null,
  };
  try {
    const ver = await fetch(`http://127.0.0.1:${chrome.port}/json/version`).then((r) => r.json()).catch(() => ({}));
    chromeVersion = ver.Browser || null;
    result.chromeVersion = chromeVersion;

    const ext = await loadExtension(chrome.browser, args.ext);
    console.log(`[perf] extension id=${ext.id} enabled=${ext.enabled}`);
    if (!ext.enabled) throw new Error('extension not enabled');
    await waitExtensionReady(chrome.browser, ext.id);

    const page = await openPage(chrome.browser, `chrome-extension://${ext.id}/src/index.html`, { width: 1600, height: 900 });
    await page.addInitScript(PERF_INIT_SCRIPT);
    await page.reload();
    await page.waitForFunction(`document.readyState === 'complete'`, { timeoutMs: 20000 });
    console.log('[perf] seeding data ...');
    await seedPageData(page);
    // 首屏初始化会异步落盘默认页面，可能与种子写入竞态；等其稳定后再写一次，保证确定性
    await sleep(900);
    await seedPageData(page);
    await sleep(200);

    // ---- 1) 首屏：3 次 reload（记录冷/热各次） ----
    const boots = [];
    for (let i = 0; i < args.repeats; i++) {
      await page.reload();
      await waitBoot(page);
      await sleep(900);
      const fs1 = await collectFirstScreen(page);
      boots.push(fs1);
      console.log(`[perf] boot#${i + 1}: firstItem=${fs1.firstItemMs}ms dcl=${fs1.nav.domContentLoaded}ms load=${fs1.nav.load}ms longTasks=${fs1.longTaskCount} cls=${fs1.cls}`);
    }
    result.firstScreen = {
      runs: boots,
      medianFirstItemMs: median(boots.map((b) => b.firstItemMs)),
      medianFirstSquareMs: median(boots.map((b) => b.firstSquareMs)),
      medianDclMs: median(boots.map((b) => b.nav.domContentLoaded)),
      medianLoadMs: median(boots.map((b) => b.nav.load)),
      cold: boots[0],
      warm: boots[boots.length - 1],
    };

    // ---- 2) 单条更新（当前页 p1，300+ 条）----
    await preparePage(page);
    const updates = [];
    for (let i = 0; i < args.repeats; i++) {
      const r = await measureSingleUpdate(page, i + 1);
      updates.push(r);
      console.log(`[perf] singleUpdate#${i + 1}: ${r.updateMs}ms (count ${r.beforeCount}→${r.afterCount})`);
      await sleep(500);
    }
    result.singleUpdate = { runs: updates, medianMs: median(updates.map((u) => u.updateMs)) };

    // ---- 3) 页面切换（p1 → p2，重复）----
    const switches = [];
    for (let i = 0; i < args.repeats; i++) {
      await preparePage(page); // 回到 p1
      const r = await measurePageSwitch(page, 1);
      switches.push(r);
      console.log(`[perf] pageSwitch#${i + 1}: ${r.switchMs}ms → ${r.targetPageId} items=${r.itemCount}`);
      await sleep(400);
    }
    result.pageSwitch = { runs: switches, medianMs: median(switches.map((s) => s.switchMs)) };

    // ---- 4) 滚动（p1，300 条）----
    await preparePage(page);
    await page.evaluate(`(() => { const c = document.querySelector('.container'); if (c) c.scrollTop = 0; window.scrollTo(0, 0); return true; })()`);
    await sleep(300);
    const idleRaf = await measureIdleRaf(page, 1000);
    result.idleRaf = idleRaf;
    console.log(`[perf] idle rAF: frames=${idleRaf.frames} avg=${idleRaf.avg}ms p95=${idleRaf.p95}ms`);
    const scroll = await measureScroll(page, 2000);
    result.scroll = scroll;
    console.log(`[perf] scroll: frames=${scroll.frames} avg=${scroll.avg}ms p95=${scroll.p95}ms max=${scroll.max}ms >33ms=${scroll.over33ms} longTasks=${scroll.longTaskCount} scrollTop=${scroll.scrollTop}`);

    // ---- 5) CDP 运行时指标 + DOM 规模 ----
    await preparePage(page);
    result.cdpMetrics = await getCdpMetrics(page);
    result.dom = await page.evaluate(`({
      marks: performance.getEntriesByType('mark').map((m) => ({ name: m.name, start: Math.round(m.startTime * 10) / 10 })),
      bootToFirstRenderMs: (() => {
        const marks = performance.getEntriesByType('mark');
        const start = marks.find((m) => m.name === 'boot:start');
        const first = marks.find((m) => m.name === 'render:first');
        return start && first ? Math.round((first.startTime - start.startTime) * 100) / 100 : null;
      })(),
      domNodes: document.getElementsByTagName('*').length,
      squareItemCount: document.querySelectorAll('.square-list-item').length,
      listeners: null, // 真实监听器数取 CDP Performance.getMetrics 的 JSEventListeners（result.cdpMetrics）
      pageItemCount: document.querySelectorAll('.bookmark-page-item').length,
      docHtmlBytes: new Blob([document.documentElement.outerHTML]).size,
      styleSheets: document.styleSheets.length,
      scriptTags: document.scripts.length,
      cssRules: (() => { try { return Array.from(document.styleSheets).reduce((n, s) => n + (s.cssRules ? s.cssRules.length : 0), 0); } catch (e) { return null; } })(),
    })`, { timeoutMs: 20000 });

    await page.close();
  } finally {
    await chrome.kill();
    console.log('[perf] chrome killed');
  }

  result.durationMs = Date.now() - startedAt;
  await fsp.writeFile(args.out, JSON.stringify(result, null, 2));
  console.log(`[perf] json: ${args.out}`);
  console.log(`[perf] SUMMARY firstItem=${result.firstScreen?.medianFirstItemMs}ms (budget ${result.budgets.firstSquareMs}) pageSwitch=${result.pageSwitch?.medianMs}ms singleUpdate=${result.singleUpdate?.medianMs}ms scrollP95=${result.scroll?.p95}ms`);
}

/** 回到 p1（300 条）并等待首屏渲染 */
async function preparePage(page) {
  await page.evaluate(`(async () => {
    try {
      const d = await chrome.storage.local.get('currentPageId');
      if (d.currentPageId !== 'p1') await chrome.storage.local.set({ currentPageId: 'p1' });
    } catch (e) {}
    return true;
  })()`);
  await page.reload();
  await waitBoot(page);
  await sleep(400);
}

main().catch((e) => { console.error('[perf] FATAL', e); process.exit(1); });
