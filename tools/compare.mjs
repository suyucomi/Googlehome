#!/usr/bin/env node
// tools/compare.mjs — 对比 before/after 的布局审计与性能基线，输出 markdown + JSON
//
// 用法：
//   node tools/compare.mjs --before audit/before --after audit/after --out audit/compare.json
//   可选 --markdown audit/compare.md（默认同目录 compare.md）
//
// 输入：<before>/layout.json、<after>/layout.json、<before>/perf.json、<after>/perf.json（存在才对比）

import path from 'node:path';
import fs from 'node:fs';
import fsp from 'node:fs/promises';

const ROOT = path.resolve(import.meta.dirname, '..');
const args = { before: 'audit/before', after: 'audit/after', out: null, markdown: null };
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  const next = () => process.argv[++i];
  if (a === '--before') args.before = next();
  else if (a === '--after') args.after = next();
  else if (a === '--out') args.out = next();
  else if (a === '--markdown') args.markdown = next();
  else if (a === '--help' || a === '-h') { console.log('node tools/compare.mjs --before audit/before --after audit/after [--out audit/compare.json] [--markdown audit/compare.md]'); process.exit(0); }
}
const beforeDir = path.resolve(ROOT, args.before);
const afterDir = path.resolve(ROOT, args.after);
const outJson = args.out ? path.resolve(ROOT, args.out) : path.join(afterDir, 'compare.json');
const outMd = args.markdown ? path.resolve(ROOT, args.markdown) : outJson.replace(/\.json$/, '.md');

const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } };
const round = (n) => (typeof n === 'number' && Number.isFinite(n) ? Math.round(n * 100) / 100 : n);
const pct = (before, after) => (typeof before === 'number' && typeof after === 'number' && before !== 0 ? round(((after - before) / before) * 100) : null);

const beforeLayout = readJson(path.join(beforeDir, 'layout.json'));
const afterLayout = readJson(path.join(afterDir, 'layout.json'));
const beforePerf = readJson(path.join(beforeDir, 'perf.json')) || readJson(path.join(beforeDir, 'perf/perf.json'));
const afterPerf = readJson(path.join(afterDir, 'perf.json')) || readJson(path.join(afterDir, 'perf/perf.json'));

if (!beforeLayout || !afterLayout) {
  console.error('[compare] 缺少 layout.json，请先分别运行 tools/audit.mjs --label before / --label after');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// 布局对比
// ---------------------------------------------------------------------------
const sampleKey = (s) => `${s.viewport}/${s.stateName}`;
const issueKey = (i) => `${i.category}|${i.viewport}|${i.state}`;
const keyOfSample = new Map();
for (const s of beforeLayout.samples) if (!keyOfSample.has(sampleKey(s))) keyOfSample.set(sampleKey(s), { before: s });
for (const s of afterLayout.samples) {
  const k = sampleKey(s);
  if (!keyOfSample.has(k)) keyOfSample.set(k, {});
  keyOfSample.get(k).after = s;
}

const sampleTable = [];
const resolved = [];
const persisting = [];
const introduced = [];
const missingSamples = [];
for (const [k, pair] of keyOfSample) {
  const b = pair.before;
  const a = pair.after;
  if (!b || !a) { missingSamples.push({ key: k, hasBefore: !!b, hasAfter: !!a }); continue; }
  const bi = b.issues || [];
  const ai = a.issues || [];
  const bSet = new Map(bi.map((i) => [i.category, i]));
  const aSet = new Map(ai.map((i) => [i.category, i]));
  for (const [cat, issue] of bSet) {
    if (!aSet.has(cat)) resolved.push({ key: k, category: cat, severity: issue.severity, title: issue.title, evidence: issue.evidence, beforeScreenshot: b.screenshot, afterScreenshot: a.screenshot });
    else persisting.push({ key: k, category: cat, before: issue, after: aSet.get(cat) });
  }
  for (const [cat, issue] of aSet) {
    if (!bSet.has(cat)) introduced.push({ key: k, category: cat, severity: issue.severity, title: issue.title, evidence: issue.evidence, beforeScreenshot: b.screenshot, afterScreenshot: a.screenshot });
  }
  const bm = b.metrics || {};
  const am = a.metrics || {};
  sampleTable.push({
    key: k,
    viewport: b.viewport, state: b.stateName,
    before: {
      issues: bi.length, P0: bi.filter((i) => i.severity === 'P0').length, P1: bi.filter((i) => i.severity === 'P1').length,
      docOverflowX: bm.doc?.overflowX ?? null,
      containerInnerOverflowX: bm.container?.innerOverflowX ?? null,
      squaresRect: bm.els?.squares ? { x: bm.els.squares.x, right: bm.els.squares.right, w: bm.els.squares.w } : null,
      grid: bm.grid ? { columns: bm.grid.columns, minItemX: bm.grid.minItemX, maxItemRight: bm.grid.maxItemRight, colGapMin: bm.grid.colGapMin, colGapMax: bm.grid.colGapMax } : null,
      clickThrough: (bm.hitTests || []).filter((h) => !h.hitSelf && h.hitIntentional !== true && h.hit != null).length,
      hiddenButtonClickable: (bm.pageActionProbes || []).filter((p) => p.rect && p.hitsSelf && p.btnOpacity < 0.05).length,
      cls: bm.clSamples?.value ?? null,
      itemCount: bm.state?.squareItemCount ?? null,
      domNodes: bm.domNodes ?? null,
      screenshot: b.screenshot,
    },
    after: {
      issues: ai.length, P0: ai.filter((i) => i.severity === 'P0').length, P1: ai.filter((i) => i.severity === 'P1').length,
      docOverflowX: am.doc?.overflowX ?? null,
      containerInnerOverflowX: am.container?.innerOverflowX ?? null,
      squaresRect: am.els?.squares ? { x: am.els.squares.x, right: am.els.squares.right, w: am.els.squares.w } : null,
      grid: am.grid ? { columns: am.grid.columns, minItemX: am.grid.minItemX, maxItemRight: am.grid.maxItemRight, colGapMin: am.grid.colGapMin, colGapMax: am.grid.colGapMax } : null,
      clickThrough: (am.hitTests || []).filter((h) => !h.hitSelf && h.hitIntentional !== true && h.hit != null).length,
      hiddenButtonClickable: (am.pageActionProbes || []).filter((p) => p.rect && p.hitsSelf && p.btnOpacity < 0.05).length,
      cls: am.clSamples?.value ?? null,
      itemCount: am.state?.squareItemCount ?? null,
      domNodes: am.domNodes ?? null,
      screenshot: a.screenshot,
    },
  });
}

const allBeforeIssues = beforeLayout.samples.flatMap((s) => s.issues || []);
const allAfterIssues = afterLayout.samples.flatMap((s) => s.issues || []);
const catCount = (arr, sev) => Object.fromEntries([...new Set(arr.map((i) => i.category))].sort().map((c) => [c, arr.filter((i) => i.category === c && (!sev || i.severity === sev)).length]));

const layoutCompare = {
  sampleCount: { before: beforeLayout.samples.length, after: afterLayout.samples.length },
  summary: {
    before: { issues: allBeforeIssues.length, P0: allBeforeIssues.filter((i) => i.severity === 'P0').length, P1: allBeforeIssues.filter((i) => i.severity === 'P1').length, P2: allBeforeIssues.filter((i) => i.severity === 'P2').length, byCategory: catCount(allBeforeIssues) },
    after: { issues: allAfterIssues.length, P0: allAfterIssues.filter((i) => i.severity === 'P0').length, P1: allAfterIssues.filter((i) => i.severity === 'P1').length, P2: allAfterIssues.filter((i) => i.severity === 'P2').length, byCategory: catCount(allAfterIssues) },
  },
  resolved: resolved.sort((a, b) => (a.severity === b.severity ? a.key.localeCompare(b.key) : a.severity.localeCompare(b.severity))),
  persisting,
  introduced,
  samples: sampleTable.sort((a, b) => a.key.localeCompare(b.key)),
  missingSamples,
  consoleErrors: {
    before: beforeLayout.samples.filter((s) => (s.console?.errors || []).length).length,
    after: afterLayout.samples.filter((s) => (s.console?.errors || []).length).length,
  },
  failedSamples: { before: beforeLayout.samples.filter((s) => s.error).length, after: afterLayout.samples.filter((s) => s.error).length },
};

// ---------------------------------------------------------------------------
// 性能对比
// ---------------------------------------------------------------------------
let perfCompare = null;
if (beforePerf && afterPerf) {
  const pick = (p) => ({
    firstItemMs: p.firstScreen?.medianFirstItemMs ?? null,
    firstSquareMs: p.firstScreen?.medianFirstSquareMs ?? null,
    dclMs: p.firstScreen?.medianDclMs ?? null,
    loadMs: p.firstScreen?.medianLoadMs ?? null,
    firstScreenLongTasks: p.firstScreen?.cold?.longTaskCount ?? null,
    cls: p.firstScreen?.cold?.cls ?? null,
    pageSwitchMs: p.pageSwitch?.medianMs ?? null,
    singleUpdateMs: p.singleUpdate?.medianMs ?? null,
    scrollAvgMs: p.scroll?.avg ?? null,
    scrollP95Ms: p.scroll?.p95 ?? null,
    scrollMaxMs: p.scroll?.max ?? null,
    scrollOver50ms: p.scroll?.over50ms ?? null,
    scrollLongTasks: p.scroll?.longTaskCount ?? null,
    idleRafAvgMs: p.idleRaf?.avg ?? null,
    idleRafP95Ms: p.idleRaf?.p95 ?? null,
    bootToFirstRenderMs: p.firstScreen?.warm?.bootToFirstRenderMs ?? p.firstScreen?.cold?.bootToFirstRenderMs ?? null,
    domNodes: p.dom?.domNodes ?? null,
    listeners: p.cdpMetrics?.JSEventListeners ?? null,
    layoutObjects: p.cdpMetrics?.LayoutObjects ?? null,
    docHtmlBytes: p.dom?.docHtmlBytes ?? null,
    cssRules: p.dom?.cssRules ?? null,
    scriptTags: p.dom?.scriptTags ?? null,
  });
  const b = pick(beforePerf);
  const a = pick(afterPerf);
  const rows = Object.keys(b).map((k) => ({ metric: k, before: b[k], after: a[k], deltaPct: pct(b[k], a[k]) }));
  perfCompare = { before: b, after: a, rows, beforeRaw: beforePerf, afterRaw: afterPerf };
}

const out = { generatedAt: new Date().toISOString(), beforeDir: args.before, afterDir: args.after, layout: layoutCompare, perf: perfCompare };
await fsp.mkdir(path.dirname(outJson), { recursive: true });
await fsp.writeFile(outJson, JSON.stringify(out, null, 2));

// ---------------------------------------------------------------------------
// Markdown 摘要（可直接贴进 AFTER 报告）
// ---------------------------------------------------------------------------
const md = [];
md.push('## 前后对比（自动生成）\n');
md.push(`- 布局样本：before ${layoutCompare.sampleCount.before} / after ${layoutCompare.sampleCount.after}`);
md.push(`- 问题总数：**${layoutCompare.summary.before.issues} → ${layoutCompare.summary.after.issues}**（P0 ${layoutCompare.summary.before.P0} → ${layoutCompare.summary.after.P0}，P1 ${layoutCompare.summary.before.P1} → ${layoutCompare.summary.after.P1}，P2 ${layoutCompare.summary.before.P2} → ${layoutCompare.summary.after.P2}）`);
md.push(`- 已消除问题：${layoutCompare.resolved.length} 项；仍存在：${layoutCompare.persisting.length} 项；新出现：${layoutCompare.introduced.length} 项`);
md.push(`- 控制台报错样本：${layoutCompare.consoleErrors.before} → ${layoutCompare.consoleErrors.after}`);
if (missingSamples.length) md.push(`- ⚠️ 未配对的样本：${missingSamples.length} 个（${missingSamples.slice(0, 6).map((m) => m.key).join(', ')}${missingSamples.length > 6 ? '…' : ''}）——该部分无法做前后对比`);
md.push('');

md.push('### 已消除的布局问题（按类别）\n');
md.push('| 严重级 | 类别 | 视口/状态数 | 示例状态 |');
md.push('| --- | --- | --- | --- |');
const resolvedByCat = {};
for (const r of layoutCompare.resolved) {
  const key = `${r.severity}|${r.category}`;
  if (!resolvedByCat[key]) resolvedByCat[key] = { severity: r.severity, category: r.category, count: 0, keys: [] };
  resolvedByCat[key].count++;
  resolvedByCat[key].keys.push(r.key);
}
for (const c of Object.values(resolvedByCat).sort((x, y) => x.severity.localeCompare(y.severity))) {
  md.push(`| ${c.severity} | ${c.category} | ${c.count} | ${c.keys.slice(0, 3).join('<br>')} |`);
}
if (layoutCompare.persisting.length) {
  md.push('\n### 仍未消除（需复核是否有意保留）\n');
  md.push('| 严重级 | 类别 | 视口/状态 | before 证据 | after 证据 |');
  md.push('| --- | --- | --- | --- | --- |');
  for (const p of layoutCompare.persisting) {
    md.push(`| ${p.before.severity} | ${p.category} | ${p.key} | ${String(p.before.evidence).replace(/\|/g, '/').slice(0, 140)} | ${String(p.after.evidence).replace(/\|/g, '/').slice(0, 140)} |`);
  }
}
if (layoutCompare.introduced.length) {
  md.push('\n### 新出现的问题\n');
  md.push('| 严重级 | 类别 | 视口/状态 | 证据 |');
  md.push('| --- | --- | --- | --- |');
  for (const p of layoutCompare.introduced) md.push(`| ${p.severity} | ${p.category} | ${p.key} | ${String(p.evidence).replace(/\|/g, '/').slice(0, 160)} |`);
}

if (perfCompare) {
  md.push('\n### 性能对比（1600x900，10 页面 / 当前页 300 条书签）\n');
  md.push('| 指标 | before | after | 变化 |');
  md.push('| --- | --- | --- | --- |');
  const labels = {
    firstItemMs: '首屏首个书签项出现 (ms)', firstSquareMs: '首屏首个 .square-container (ms)',
    dclMs: 'DOMContentLoaded (ms)', loadMs: 'load (ms)', firstScreenLongTasks: '首屏长任务数',
    cls: 'CLS', pageSwitchMs: '页面切换 → 新页首项 (ms)', singleUpdateMs: '单条书签更新 → DOM (ms)',
    scrollAvgMs: '滚动 rAF 平均帧间隔 (ms)', scrollP95Ms: '滚动 rAF p95 (ms)', scrollMaxMs: '滚动 rAF 最大帧间隔 (ms)',
    scrollOver50ms: '滚动 >50ms 帧数', scrollLongTasks: '滚动期间长任务数',
    domNodes: 'DOM 节点数', listeners: 'JS 事件监听器数', layoutObjects: 'LayoutObjects 数',
    bootToFirstRenderMs: 'boot:start → render:first (ms)',
    docHtmlBytes: '文档 HTML 字节数', cssRules: 'CSS 规则条数', scriptTags: '<script> 标签数',
  };
  for (const r of perfCompare.rows) {
    md.push(`| ${labels[r.metric] || r.metric} | ${r.before ?? '-'} | ${r.after ?? '-'} | ${r.deltaPct == null ? '-' : `${r.deltaPct > 0 ? '+' : ''}${r.deltaPct}%`} |`);
  }
  md.push(`\n预算：首屏 <120ms、页面切换 <120ms、单条更新 <50ms、滚动 p95 <33ms（架构 v2 验收标准）。`);
}

await fsp.writeFile(outMd, md.join('\n') + '\n');
console.log(`[compare] json: ${outJson}`);
console.log(`[compare] markdown: ${outMd}`);
console.log(`[compare] issues ${layoutCompare.summary.before.issues} → ${layoutCompare.summary.after.issues} | resolved=${layoutCompare.resolved.length} persisting=${layoutCompare.persisting.length} introduced=${layoutCompare.introduced.length}`);
if (perfCompare) console.log(`[compare] perf: firstItem ${perfCompare.before.firstItemMs} → ${perfCompare.after.firstItemMs}ms, pageSwitch ${perfCompare.before.pageSwitchMs} → ${perfCompare.after.pageSwitchMs}ms, singleUpdate ${perfCompare.before.singleUpdateMs} → ${perfCompare.after.singleUpdateMs}ms, scrollP95 ${perfCompare.before.scrollP95Ms} → ${perfCompare.after.scrollP95Ms}ms`);
