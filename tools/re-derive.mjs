#!/usr/bin/env node
// tools/re-derive.mjs — 不重跑 Chrome，按最新断言规则重算 layout.json 的 issues/summary
// 用法：node tools/re-derive.mjs audit/before/layout.json
import fs from 'node:fs';
import path from 'node:path';
import { deriveIssues } from './audit.mjs';

const file = path.resolve(process.argv[2] || 'audit/before/layout.json');
const data = JSON.parse(fs.readFileSync(file, 'utf8'));

for (const sample of data.samples) {
  if (!sample.metrics) { sample.issues = []; continue; }
  sample.issues = deriveIssues(sample);
}
const all = data.samples.flatMap((s) => s.issues || []);
const bySeverity = { P0: 0, P1: 0, P2: 0 };
for (const i of all) bySeverity[i.severity] = (bySeverity[i.severity] || 0) + 1;
const byCategory = {};
for (const i of all) {
  byCategory[i.category] = byCategory[i.category] || { count: 0, P0: 0, P1: 0, P2: 0, viewports: new Set(), states: new Set() };
  const c = byCategory[i.category];
  c.count++; c[i.severity]++; c.viewports.add(i.viewport); c.states.add(i.state);
}
data.summary = {
  ...data.summary,
  sampleCount: data.samples.length,
  failedSamples: data.samples.filter((s) => s.error).length,
  issueCount: all.length,
  bySeverity,
  byCategory: Object.fromEntries(Object.entries(byCategory)
    .sort((a, b) => (b[1].P0 - a[1].P0) || (b[1].P1 - a[1].P1) || (b[1].count - a[1].count))
    .map(([k, v]) => [k, { count: v.count, P0: v.P0, P1: v.P1, P2: v.P2, viewports: [...v.viewports], states: [...v.states] }])),
  consoleErrorSamples: data.samples.filter((s) => (s.console?.errors || []).length).length,
};
fs.writeFileSync(file, JSON.stringify(data, null, 2));
console.log(`[re-derive] ${file}`);
console.log(`[re-derive] issues=${all.length} P0=${bySeverity.P0} P1=${bySeverity.P1} P2=${bySeverity.P2}`);
for (const [k, v] of Object.entries(data.summary.byCategory)) console.log(`  ${k}: ${v.count} (P0=${v.P0} P1=${v.P1} P2=${v.P2}) viewports=${v.viewports.join(',')}`);
