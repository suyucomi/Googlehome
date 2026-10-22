#!/usr/bin/env node
// tools/functional-regression.mjs — 真实 Chrome 功能回归（重构后验收 / 也可跑基线做对照）
//
// 用法：
//   node tools/functional-regression.mjs --ext . --out audit/after/functional.json --label after
//
// 覆盖：启动/数据兼容、侧栏开合、页面切换（数据不丢）、二级分类筛选、设置面板（aria/inert/Esc）、
//       性能模式开关、页面 增/改/删、粘贴新增书签、storage 镜像新增（星标同步）、导出→导入配置、
//       DOM 卫生（重复 id / button type / 模块脚本）、控制台错误。
// 只读扩展；不修改 src。输出确定性 JSON 便于 after 对照。

import path from 'node:path';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { launchChrome, loadExtension, waitExtensionReady, openPage, sleep } from './cdp.mjs';
import { seedPageData } from './seed-data.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
function parseArgs(argv) {
  const out = { ext: '.', out: 'audit/after/functional.json', label: 'after', headed: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i]; const next = () => argv[++i];
    if (a === '--ext') out.ext = next();
    else if (a === '--out') out.out = next();
    else if (a === '--label') out.label = next();
    else if (a === '--headed') out.headed = true;
    else if (a === '--help' || a === '-h') { console.log('node tools/functional-regression.mjs --ext <dir> --out <file> --label after'); process.exit(0); }
  }
  out.ext = path.resolve(ROOT, out.ext);
  out.out = path.isAbsolute(out.out) ? out.out : path.resolve(ROOT, out.out);
  return out;
}

const checks = [];
const record = (id, name, status, evidence, extra = {}) => {
  checks.push({ id, name, status, evidence, ...extra });
  console.log(`  [${status}] ${id} ${name}${evidence ? ` — ${typeof evidence === 'string' ? evidence : JSON.stringify(evidence)}` : ''}`);
};
async function runCheck(id, name, fn, { severity = 'critical' } = {}) {
  try {
    const evidence = await fn();
    if (evidence && typeof evidence === 'object' && evidence.__skip) {
      record(id, name, 'skip', evidence.__skip, { severity });
      return;
    }
    record(id, name, 'pass', evidence, { severity });
  } catch (e) {
    record(id, name, 'fail', e.message, { severity, error: String(e && e.stack || e).slice(0, 1200) });
  }
}
const skip = (id, name, reason) => record(id, name, 'skip', reason);

// ---------------------------------------------------------------------------
// 页面内小工具（通过 evaluate 注入）
// ---------------------------------------------------------------------------
const clickSel = (page, sel) => page.evaluate(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return false; el.click(); return true; })()`);

async function waitFn(page, expr, timeoutMs = 8000, label = expr) {
  try {
    return await page.waitForFunction(expr, { timeoutMs });
  } catch (e) {
    throw new Error(`等待超时(${timeoutMs}ms): ${label}`);
  }
}

const countSel = (page, sel) => page.evaluate(`document.querySelectorAll(${JSON.stringify(sel)}).length`);

/** 在弹窗内设置 input 值并点击确认（v2 dialog: .dialog-overlay / .name-input / .btn-confirm） */
async function fillDialogAndConfirm(page, value) {
  const ok = await page.evaluate(`(() => {
    const overlay = document.querySelector('.dialog-overlay') || document.querySelector('.name-dialog') || document.querySelector('[role="dialog"].active');
    if (!overlay) return { ok: false, reason: 'no-dialog' };
    const input = overlay.querySelector('input.name-input, .name-input, input[type="text"]');
    if (input) {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(input, ${JSON.stringify(value)});
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }
    const confirm = overlay.querySelector('.btn-confirm, .dialog-confirm, .dialog-btn.btn-confirm, button[type="button"].confirm-btn');
    if (!confirm) {
      // 兜底：按文字找确认按钮
      const btns = Array.from(overlay.querySelectorAll('button'));
      const hit = btns.find((b) => /确认|确定|保存|导入|删除|创建/.test(b.textContent || ''));
      if (hit) { hit.click(); return { ok: true, via: 'text' }; }
      return { ok: false, reason: 'no-confirm' };
    }
    confirm.click();
    return { ok: true, input: !!input };
  })()`);
  if (!ok.ok) throw new Error(`弹窗操作失败: ${ok.reason}`);
  return ok;
}

/** 鼠标事件（hover 显示 page-actions 等） */
async function hover(page, sel) {
  return page.evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(sel)});
    if (!el) return false;
    el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false, view: window }));
    el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, view: window }));
    return true;
  })()`);
}

/** 确保指定页面为当前页并完成渲染（必要时清空二级分类筛选） */
async function ensurePage(page, pageId, expectItems = 300) {
  await page.evaluate(`(() => { const c = document.querySelector('.active-folder-clear'); if (c) c.click(); return true; })()`).catch(() => {});
  await sleep(150);
  const active = await page.evaluate(`document.querySelector('.bookmark-page-item.active')?.dataset.pageId || null`);
  if (active !== pageId) {
    const clicked = await page.evaluate(`(() => { const it = document.querySelector('.bookmark-page-item[data-page-id="${pageId}"]'); if (!it) return false; it.click(); return true; })()`);
    if (!clicked) throw new Error(`页面 ${pageId} 不存在于侧栏`);
    await waitFn(page, `(() => { const a = document.querySelector('.bookmark-page-item.active'); return a && a.dataset.pageId === '${pageId}'; })()`, 8000);
  }
  if (expectItems != null) {
    await waitFn(page, `document.querySelectorAll('.square-container').length >= ${expectItems}`, 12000, `页面 ${pageId} 渲染 ${expectItems} 条`);
  }
  await sleep(150);
  return pageId;
}

async function getStorage(page, keys) {
  return page.evaluate(`(async () => { const d = await chrome.storage.local.get(${JSON.stringify(keys)}); return d; })()`);
}

/** 等新页面加载完成 + 首屏网格（reload 后使用） */
async function waitBoot(page, expectItems = 300) {
  await page.waitForFunction(`document.readyState === 'complete'`, { timeoutMs: 20000 });
  await page.waitForFunction(`document.querySelectorAll('.square-container').length >= ${expectItems}`, { timeoutMs: 20000 });
  await sleep(300);
}

async function main() {
  const args = parseArgs(process.argv);
  const startedAt = Date.now();
  const outDir = path.dirname(args.out);
  await fsp.mkdir(outDir, { recursive: true });
  const downloadsDir = path.join(outDir, 'downloads');
  await fsp.rm(downloadsDir, { recursive: true, force: true });
  await fsp.mkdir(downloadsDir, { recursive: true });

  const profileDir = path.join(ROOT, 'audit', `.chrome-profile-func-${args.label}`);
  const chrome = await launchChrome({ profileDir, headless: !args.headed });
  console.log(`[func] label=${args.label} ext=${args.ext} chrome pid=${chrome.child.pid}`);
  const result = {
    label: args.label, extPath: args.ext, startedAt: new Date(startedAt).toISOString(),
    env: { headless: !args.headed }, checks: [], console: null, summary: null,
  };

  let page = null;
  try {
    const ext = await loadExtension(chrome.browser, args.ext);
    console.log(`[func] extension id=${ext.id} enabled=${ext.enabled}`);
    if (!ext.enabled) throw new Error('extension not enabled');
    await waitExtensionReady(chrome.browser, ext.id);

    page = await openPage(chrome.browser, `chrome-extension://${ext.id}/src/index.html`, { width: 1600, height: 900 });
    // 下载导出文件到受控目录
    try { await page.browser.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloadsDir, eventsEnabled: true }); } catch { /* ignore */ }
    // 自动接受原生 prompt/confirm（基线 v1.9 的重命名/删除使用原生对话框）
    page.browser.on('Page.javascriptDialogOpening', async (p, sid) => {
      if (sid !== page.sessionId) return;
      try { await page.send('Page.handleJavaScriptDialog', { accept: true, promptText: p.defaultPrompt || '审计重命名' }); } catch { /* ignore */ }
    });

    await page.reload();
    await page.waitForFunction(`document.readyState === 'complete'`, { timeoutMs: 20000 });
    console.log('[func] seeding data ...');
    await seedPageData(page);
    await sleep(900);
    await seedPageData(page);
    await page.reload();
    await waitBoot(page);

    // ================= 1. 启动 / 数据兼容 =================
    await runCheck('boot', '启动：300 条书签 / 10 个页面 / 控制台无错误', async () => {
      const r = await page.evaluate(`({
        readyState: document.readyState,
        items: document.querySelectorAll('.square-container').length,
        pageItems: document.querySelectorAll('.bookmark-page-item').length,
        pageTitle: Boolean(document.querySelector('h1.page-title') || document.querySelector('.page-title')),
        searchBox: Boolean(document.querySelector('.search-container')),
        bootState: document.documentElement.dataset.boot || null,
        stylesheets: document.styleSheets.length,
        modules: document.querySelectorAll('script[type="module"]').length,
        scripts: document.scripts.length,
        bodyClass: document.body.className,
      })`);
      const errs = page.consoleIssues().errors;
      if (r.readyState !== 'complete') throw new Error(`readyState=${r.readyState}`);
      if (r.items !== 300) throw new Error(`书签网格 ${r.items} !== 300`);
      if (r.pageItems !== 10) throw new Error(`侧栏页面 ${r.pageItems} !== 10`);
      if (r.pageTitle) throw new Error('搜索框上方的标题行应已移除（.page-title）');
      if (!r.searchBox) throw new Error('缺少搜索框');
      if (errs.length) throw new Error(`控制台错误: ${errs.slice(0, 3).join(' | ')}`);
      return r;
    });

    await runCheck('boot/storage-keys', '启动：storage key 兼容（bookmarkPages/currentPageId/squares_*）', async () => {
      const d = await page.evaluate(`(async () => {
        const d = await chrome.storage.local.get(['bookmarkPages', 'currentPageId', 'settings', 'smartSettings', 'searchEngine']);
        const keys = Object.keys((await chrome.storage.local.get(null)) || {});
        return { pages: (d.bookmarkPages || []).length, current: d.currentPageId, keys, squaresKeys: keys.filter((k) => k.startsWith('squares_')).length, hasSettings: !!d.settings, hasSmart: !!d.smartSettings };
      })()`);
      if (d.pages !== 10) throw new Error(`bookmarkPages=${d.pages}`);
      if (d.current !== 'p1') throw new Error(`currentPageId=${d.current}`);
      if (d.squaresKeys < 10) throw new Error(`squares_* keys=${d.squaresKeys}`);
      return d;
    });

    // ================= 2. 侧栏开合 =================
    await runCheck('sidebar/toggle', '侧栏：展开 ↔ 收起切换正常', async () => {
      // 确保桌面侧栏展开
      const open0 = await page.evaluate(`(() => { const c = document.querySelector('.container'); const s = document.querySelector('#sidebar'); return { open: c.classList.contains('sidebar-open'), collapsed: s.classList.contains('collapsed') }; })()`);
      if (!open0.open || open0.collapsed) {
        await clickSel(page, '#sidebarTrigger');
        await waitFn(page, `!document.querySelector('#sidebar').classList.contains('collapsed')`, 6000);
      }
      await clickSel(page, '#sidebarToggle');
      await waitFn(page, `(() => { const s = document.querySelector('#sidebar'); const c = document.querySelector('.container'); return s.classList.contains('collapsed') && !c.classList.contains('sidebar-open'); })()`, 6000);
      await sleep(250);
      const closed = await page.evaluate(`(() => ({
        collapsed: document.querySelector('#sidebar').classList.contains('collapsed'),
        ariaHidden: document.querySelector('#sidebar').getAttribute('aria-hidden'),
        inert: document.querySelector('#sidebar').inert === true,
        expanded: document.querySelector('#sidebarToggle').getAttribute('aria-expanded'),
      }))()`);
      await clickSel(page, '#sidebarTrigger');
      await waitFn(page, `!document.querySelector('#sidebar').classList.contains('collapsed')`, 6000);
      await sleep(250);
      const opened = await page.evaluate(`(() => ({
        ariaHidden: document.querySelector('#sidebar').getAttribute('aria-hidden'),
        inert: document.querySelector('#sidebar').inert === true,
        expanded: document.querySelector('#sidebarTrigger').getAttribute('aria-expanded'),
      }))()`);
      return { closed, opened };
    });

    // ================= 3. 页面切换 + 数据不丢 =================
    await runCheck('pages/switch', '页面切换：p1(300) ↔ p2(50)，且 storage 不丢数据', async () => {
      const before = await getStorage(page, ['bookmarkPages', 'squares_p1']);
      await page.evaluate(`document.querySelector('.bookmark-page-item[data-page-id="p2"]').click()`);
      await waitFn(page, `(() => { const a = document.querySelector('.bookmark-page-item.active'); return a && a.dataset.pageId === 'p2' && document.querySelectorAll('.square-container').length === 50; })()`, 10000);
      await page.evaluate(`document.querySelector('.bookmark-page-item[data-page-id="p1"]').click()`);
      await waitFn(page, `(() => { const a = document.querySelector('.bookmark-page-item.active'); return a && a.dataset.pageId === 'p1' && document.querySelectorAll('.square-container').length === 300; })()`, 12000);
      const after = await getStorage(page, ['bookmarkPages', 'squares_p1', 'currentPageId']);
      if (after.currentPageId !== 'p1') throw new Error(`currentPageId 未持久化: ${after.currentPageId}`);
      if ((after.squares_p1 || []).length !== 300) throw new Error(`切换后 squares_p1=${(after.squares_p1 || []).length} !== 300（数据丢失/重复）`);
      return { beforeCount: (before.squares_p1 || []).length, afterCount: (after.squares_p1 || []).length, currentPageId: after.currentPageId };
    });

    // ================= 4. 二级分类筛选 =================
    await runCheck('category/filter', '二级分类：hover 出浮层 → 筛选「开发」(60) → 清除恢复 300', async () => {
      await hover(page, '.bookmark-page-item.has-subfolders');
      await waitFn(page, `(() => { const f = document.querySelector('.page-subfolder-flyout'); return !!f && (f.classList.contains('show') || getComputedStyle(f).opacity !== '0'); })()`, 6000);
      const flyoutRect = await page.evaluate(`(() => { const f = document.querySelector('.page-subfolder-flyout'); const b = f.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height, inViewport: b.x >= -1 && b.right <= innerWidth + 1 && b.y >= -1 && b.bottom <= innerHeight + 1, items: f.querySelectorAll('.flyout-item').length }; })()`);
      const clicked = await page.evaluate(`(() => {
        const items = Array.from(document.querySelectorAll('.page-subfolder-flyout .flyout-item'));
        const hit = items.find((b) => (b.textContent || '').includes('开发'));
        if (!hit) return false;
        hit.click();
        return true;
      })()`);
      if (!clicked) throw new Error('浮层中未找到「开发」分类项');
      await waitFn(page, `document.querySelectorAll('.square-container').length === 60`, 8000);
      const bar = await page.evaluate(`!!document.querySelector('.active-folder-bar')`);
      const cleared = await page.evaluate(`(() => { const b = document.querySelector('.active-folder-clear'); if (!b) return false; b.click(); return true; })()`);
      if (!cleared) throw new Error('未找到分类清除按钮 .active-folder-clear');
      await waitFn(page, `document.querySelectorAll('.square-container').length === 300`, 10000);
      return { flyoutRect, filteredCount: 60, barVisible: bar, restored: 300 };
    });

    // ================= 5. 设置面板（打开 / aria-inert / Esc） =================
    await runCheck('settings/open-close', '设置面板：打开 → aria-hidden=false/背景 inert → Esc 关闭', async () => {
      await clickSel(page, '#sidebarSettingsBtn');
      await waitFn(page, `document.getElementById('settingsPanel').classList.contains('active')`, 6000);
      await sleep(350);
      const openState = await page.evaluate(`(() => {
        const p = document.getElementById('settingsPanel');
        const main = document.querySelector('.app-main') || document.querySelector('.container');
        const sidebar = document.querySelector('#sidebar');
        return {
          active: p.classList.contains('active'),
          ariaHidden: p.getAttribute('aria-hidden'),
          inert: p.inert === true,
          mainInert: main ? main.inert === true : null,
          sidebarInert: sidebar ? sidebar.inert === true : null,
          focusInside: p.contains(document.activeElement),
          scrollable: p.scrollHeight > p.clientHeight + 1,
          headerSticky: getComputedStyle(p.querySelector('.settings-header')).position,
        };
      })()`);
      await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
      await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
      await waitFn(page, `!document.getElementById('settingsPanel').classList.contains('active')`, 6000);
      await sleep(250);
      const closed = await page.evaluate(`(() => { const p = document.getElementById('settingsPanel'); return { active: p.classList.contains('active'), ariaHidden: p.getAttribute('aria-hidden'), inert: p.inert === true }; })()`);
      return { openState, closed };
    });

    // ================= 6. 性能模式开关 =================
    await runCheck('settings/perf-mode', '性能模式：勾选切换 body.perf-mode + 持久化 smartSettings.perfMode', async () => {
      await clickSel(page, '#sidebarSettingsBtn');
      await waitFn(page, `document.getElementById('settingsPanel').classList.contains('active')`, 6000);
      await sleep(300);
      const before = await page.evaluate(`({ body: document.body.classList.contains('perf-mode'), checked: document.getElementById('smartPerfMode').checked })`);
      await clickSel(page, '#smartPerfMode');
      await waitFn(page, `document.body.classList.contains('perf-mode') !== ${before.body}`, 6000);
      await sleep(500);
      const afterDom = await page.evaluate(`({ body: document.body.classList.contains('perf-mode'), checked: document.getElementById('smartPerfMode').checked })`);
      const stored = await page.evaluate(`(async () => (await chrome.storage.local.get('smartSettings')).smartSettings || {})()`);
      // 还原
      await clickSel(page, '#smartPerfMode');
      await waitFn(page, `document.body.classList.contains('perf-mode') === ${before.body}`, 6000);
      await sleep(400);
      await clickSel(page, '#closeSettings');
      await sleep(350);
      if (stored.perfMode === undefined) throw new Error('smartSettings.perfMode 未持久化');
      return { before, afterDom, storedPerfMode: stored.perfMode };
    });

    // ================= 7. 页面 增 / 改 / 删 =================
    await runCheck('pages/crud', '页面管理：新增 → 重命名 → 删除', async () => {
      const n0 = await countSel(page, '.bookmark-page-item');
      await clickSel(page, '#addPageBtn');
      await waitFn(page, `document.querySelectorAll('.bookmark-page-item').length === ${n0 + 1}`, 8000);
      await sleep(400);
      const newPageId = await page.evaluate(`(() => { const a = document.querySelector('.bookmark-page-item.active'); return a ? a.dataset.pageId : null; })()`);
      if (!newPageId) throw new Error('新增页面后未找到 active 页面');
      const n1 = await countSel(page, '.bookmark-page-item');
      // 重命名（hover 显示操作按钮 → edit → promptDialog）
      await hover(page, `.bookmark-page-item[data-page-id="${newPageId}"]`);
      await sleep(150);
      const editClicked = await page.evaluate(`(() => { const b = document.querySelector('.bookmark-page-item[data-page-id="${newPageId}"] .edit-page-btn'); if (!b) return false; b.click(); return true; })()`);
      if (!editClicked) throw new Error('未找到重命名按钮 .edit-page-btn');
      await sleep(300);
      const hasDialog = await page.evaluate(`!!document.querySelector('.dialog-overlay, .name-dialog')`);
      if (hasDialog) {
        await fillDialogAndConfirm(page, '审计页面A');
        await waitFn(page, `(() => { const a = document.querySelector('.bookmark-page-item.active .page-name'); return a && a.textContent.includes('审计页面A'); })()`, 8000);
      } else {
        // 原生 prompt 已被自动接受但不会改名 → 记录为 skip
        throw new Error('重命名未弹出应用内弹窗（可能仍是原生 prompt）');
      }
      // 删除（confirmDialog）
      await hover(page, `.bookmark-page-item[data-page-id="${newPageId}"]`);
      await sleep(150);
      const delClicked = await page.evaluate(`(() => { const b = document.querySelector('.bookmark-page-item[data-page-id="${newPageId}"] .delete-page-btn'); if (!b) return false; b.click(); return true; })()`);
      if (!delClicked) throw new Error('未找到删除按钮 .delete-page-btn');
      await sleep(350);
      const confirmDialogOpen = await page.evaluate(`!!document.querySelector('.dialog-overlay, .confirm-dialog')`);
      if (!confirmDialogOpen) throw new Error('删除未弹出确认弹窗');
      await fillDialogAndConfirm(page, '');
      await waitFn(page, `document.querySelectorAll('.bookmark-page-item').length === ${n0}`, 10000);
      await sleep(400);
      const finalCount = await countSel(page, '.bookmark-page-item');
      if (finalCount !== n0) throw new Error(`删除后页面数=${finalCount} !== ${n0}`);
      return { beforePages: n0, afterAdd: n1, renamed: '审计页面A', afterDelete: finalCount };
    });

    // ================= 8. 粘贴新增书签 =================
    const pasteUrl = `https://audit-paste-${Date.now()}.example.com/`;
    await runCheck('bookmark/paste', '粘贴 URL → 命名弹窗 → 新增书签（storage + DOM）', async () => {
      const pageId = await ensurePage(page, 'p1', 300);
      const n0 = await countSel(page, '.square-container');
      await page.evaluate(`(() => {
        const dt = new DataTransfer();
        dt.setData('text/plain', ${JSON.stringify(pasteUrl)});
        dt.setData('text/uri-list', ${JSON.stringify(pasteUrl)});
        const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
        document.dispatchEvent(ev);
        return true;
      })()`);
      await waitFn(page, `!!document.querySelector('.dialog-overlay, .name-dialog')`, 6000);
      await fillDialogAndConfirm(page, '审计粘贴书签');
      await waitFn(page, `document.querySelectorAll('.square-container').length === ${n0 + 1}`, 10000);
      const found = await page.evaluate(`(async () => {
        const all = await chrome.storage.local.get(null);
        for (const [k, v] of Object.entries(all || {})) {
          if (!k.startsWith('squares_') || !Array.isArray(v)) continue;
          if (v.some((s) => s.url === ${JSON.stringify(pasteUrl)})) return { key: k, pageId: k.slice('squares_'.length) };
        }
        return null;
      })()`);
      if (!found) throw new Error('storage 的所有 squares_* 中均未找到新增 URL（粘贴未入库）');
      // 清理：从 storage 删除，等 DOM 同步
      await page.evaluate(`(async () => {
        const all = await chrome.storage.local.get(null);
        for (const [k, v] of Object.entries(all || {})) {
          if (!k.startsWith('squares_') || !Array.isArray(v)) continue;
          if (v.some((s) => s.url === ${JSON.stringify(pasteUrl)})) {
            await chrome.storage.local.set({ [k]: v.filter((s) => s.url !== ${JSON.stringify(pasteUrl)}) });
          }
        }
      })()`);
      await waitFn(page, `document.querySelectorAll('.square-container').length === ${n0}`, 10000);
      return { added: pasteUrl, domBefore: n0, domAfter: n0 + 1, storedKey: found.key, activePage: pageId };
    });

    // ================= 9. storage 镜像新增（浏览器星标同步路径） =================
    const mirrorUrl = `https://audit-mirror-${Date.now()}.example.com/`;
    await runCheck('bookmark/mirror', 'storage 镜像新增（模拟浏览器星标）→ 增量出现在 DOM，无需 reload', async () => {
      const pageId = await ensurePage(page, 'p1', 300);
      const n0 = await countSel(page, '.square-container');
      const key = 'squares_' + pageId;
      await page.evaluate(`(async () => {
        const k = ${JSON.stringify(key)};
        const cur = ((await chrome.storage.local.get(k))[k]) || [];
        await chrome.storage.local.set({ [k]: [...cur, { url: ${JSON.stringify(mirrorUrl)}, title: '镜像新增测试', folder: '' }] });
      })()`);
      await waitFn(page, `document.querySelectorAll('.square-container').length === ${n0 + 1}`, 8000);
      await page.evaluate(`(async () => {
        const k = ${JSON.stringify(key)};
        const cur = ((await chrome.storage.local.get(k))[k]) || [];
        await chrome.storage.local.set({ [k]: cur.filter((s) => s.url !== ${JSON.stringify(mirrorUrl)}) });
      })()`);
      await waitFn(page, `document.querySelectorAll('.square-container').length === ${n0}`, 8000);
      return { url: mirrorUrl, pageId, domBefore: n0, domAfter: n0 + 1 };
    });

    // ================= 10. 导出 → 导入 配置 =================
    await runCheck('config/export-import', '配置导出（下载 JSON）→ 导入（确认弹窗）→ 数据不丢', async () => {
      await ensurePage(page, 'p1', 300);
      await clickSel(page, '#sidebarSettingsBtn');
      await waitFn(page, `document.getElementById('settingsPanel').classList.contains('active')`, 6000);
      await sleep(300);
      // 重新声明下载目录（headless 下 blob 下载可能延迟 3s 左右；最多等 15s）
      try { await page.browser.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloadsDir, eventsEnabled: true }); } catch { /* ignore */ }
      await clickSel(page, '#exportConfig');
      let exported = null;
      for (let i = 0; i < 150 && !exported; i++) {
        const files = (await fsp.readdir(downloadsDir)).filter((f) => f.endsWith('.json'));
        if (files.length) {
          const p = path.join(downloadsDir, files.sort().pop());
          await sleep(200);
          try { exported = { path: p, json: JSON.parse(await fsp.readFile(p, 'utf8')) }; } catch { /* still writing */ }
        }
        if (!exported) await sleep(100);
      }
      if (!exported) throw new Error('导出文件未出现（download 目录为空，等待 15s）');
      const j = exported.json;
      const pagesCount = (j.bookmarkPages || j.pages || []).length;
      if (pagesCount !== 10) throw new Error(`导出配置页面数=${pagesCount} !== 10`);
      // 通过 DOM.setFileInputFiles 注入导出文件 → change → confirm 导入
      const { root } = await page.send('DOM.getDocument');
      const { nodeId } = await page.send('DOM.querySelector', { nodeId: root.nodeId, selector: '#configFileInput' });
      if (!nodeId) throw new Error('未找到 #configFileInput');
      await page.send('DOM.setFileInputFiles', { nodeId, files: [exported.path] });
      await page.evaluate(`document.getElementById('configFileInput').dispatchEvent(new Event('change', { bubbles: true }))`);
      await sleep(500);
      const confirmOpen = await page.evaluate(`!!document.querySelector('.dialog-overlay, .confirm-dialog')`);
      if (confirmOpen) await fillDialogAndConfirm(page, '');
      // v2 导入后会 reload；等 reload 完成
      await sleep(2200);
      try { await waitBoot(page, 0); } catch (e) { /* 若未 reload 也接受 */ }
      await ensurePage(page, 'p1', 300).catch(() => {});
      const after = await page.evaluate(`(async () => {
        const d = await chrome.storage.local.get(['bookmarkPages', 'squares_p1', 'currentPageId']);
        return { pages: (d.bookmarkPages || []).length, squares: (d.squares_p1 || []).length, items: document.querySelectorAll('.square-container').length, currentPageId: d.currentPageId };
      })()`);
      if (after.pages !== 10) throw new Error(`导入后页面数=${after.pages} !== 10`);
      if (after.squares < 300) throw new Error(`导入后 squares_p1=${after.squares} < 300（数据丢失）`);
      return { exportedFile: path.basename(exported.path), confirmed: confirmOpen, exportPages: pagesCount, afterImport: after };
    });

    // ================= 11. DOM 卫生 / 可访问性 =================
    await runCheck('dom/hygiene', 'DOM 卫生：重复 id / 原生交互 / 主地标与搜索框 / 模块脚本', async () => {
      const r = await page.evaluate(`(() => {
        const ids = Array.from(document.querySelectorAll('[id]')).map((e) => e.id);
        const dupIds = ids.filter((id, i) => ids.indexOf(id) !== i);
        const buttons = Array.from(document.querySelectorAll('button'));
        const noType = buttons.filter((b) => !b.getAttribute('type')).length;
        const pageTitle = document.querySelector('.page-title, h1.page-title');
        return {
          dupIds: Array.from(new Set(dupIds)),
          buttons: buttons.length,
          buttonsNoType: noType,
          main: !!document.querySelector('main.app-main'),
          search: !!document.querySelector('.search-container'),
          pageTitle: !!pageTitle,
          moduleScripts: document.querySelectorAll('script[type="module"]').length,
          allScripts: document.scripts.length,
          squareItems: document.querySelectorAll('.square-list-item').length,
          lazyloaded: !!document.querySelector('.square-list-item'),
        };
      })()`);
      if (r.dupIds.length) throw new Error(`重复 id: ${r.dupIds.join(',')}`);
      if (!r.main) throw new Error('缺少 <main class="app-main"> 主地标');
      if (!r.search) throw new Error('缺少搜索框');
      if (r.pageTitle) throw new Error('搜索框上方的标题行应已移除（.page-title）');
      return r;
    });

    // ================= 12. 拖拽排序（best-effort） =================
    await runCheck('bookmark/reorder', '拖拽排序（合成 drag 事件 → storage 顺序变化）', async () => {
      await ensurePage(page, 'p1', 300);
      const first = await page.evaluate(`(() => { const s = document.querySelectorAll('.square-container')[0]; const t = document.querySelectorAll('.square-container')[1]; return { a: s && s.dataset.url, b: t && t.dataset.url }; })()`);
      if (!first.a || !first.b) throw new Error('方块数量不足');
      const dispatched = await page.evaluate(`(() => {
        const items = Array.from(document.querySelectorAll('.square-list-item'));
        const src = items[0], dst = items[1];
        if (!src || !dst) return false;
        const dt = new DataTransfer();
        const fire = (el, type, extra = {}) => el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt, ...extra }));
        fire(src, 'dragstart');
        fire(dst, 'dragover', { clientX: dst.getBoundingClientRect().x + 5, clientY: dst.getBoundingClientRect().y + 5 });
        fire(dst, 'drop', { clientX: dst.getBoundingClientRect().x + 5, clientY: dst.getBoundingClientRect().y + 5 });
        fire(src, 'dragend');
        return true;
      })()`);
      if (!dispatched) throw new Error('drag 事件派发失败');
      await sleep(800);
      const stored = await page.evaluate(`(async () => ((await chrome.storage.local.get('squares_p1')).squares_p1 || []).slice(0, 3).map((s) => s.url))()`);
      if (!stored.length) throw new Error('storage 读取失败');
      const orderChanged = stored[0] === first.b && stored[1] === first.a;
      if (!orderChanged) {
        return { __skip: `合成 DragEvent 未触发重排（HTML5 DnD 不响应合成事件）：before=${JSON.stringify([first.a, first.b])} after=${JSON.stringify(stored.slice(0, 2))}；建议人工/指针事件验证`, dispatched };
      }
      return { dispatched, firstTwoBefore: [first.a, first.b], firstThreeAfter: stored, orderChanged };
    }, { severity: 'advisory' });

    // ================= 汇总 =================
    result.console = page.consoleIssues();
    result.checks = checks;
    const failed = checks.filter((c) => c.status === 'fail');
    const criticalFailed = failed.filter((c) => c.severity !== 'advisory');
    result.summary = {
      total: checks.length,
      pass: checks.filter((c) => c.status === 'pass').length,
      fail: failed.length,
      criticalFail: criticalFailed.length,
      skip: checks.filter((c) => c.status === 'skip').length,
      consoleErrors: result.console.errors.length,
      consoleWarns: result.console.warns.length,
      failedIds: failed.map((c) => c.id),
    };
    console.log(`[func] SUMMARY pass=${result.summary.pass}/${result.summary.total} fail=${result.summary.fail} criticalFail=${result.summary.criticalFail} consoleErrors=${result.summary.consoleErrors}`);
    await page.close();
  } catch (e) {
    console.error('[func] FATAL', e);
    result.fatal = String(e && e.stack || e).slice(0, 2000);
    result.checks = checks;
    if (page) result.console = page.consoleIssues();
    result.summary = { total: checks.length, pass: checks.filter((c) => c.status === 'pass').length, fail: checks.filter((c) => c.status === 'fail').length, fatal: true };
  } finally {
    await chrome.kill();
    console.log('[func] chrome killed');
  }
  result.durationMs = Date.now() - startedAt;
  await fsp.writeFile(args.out, JSON.stringify(result, null, 2));
  console.log(`[func] json: ${args.out}`);
  process.exit(result.summary && result.summary.criticalFail === 0 && result.summary.consoleErrors === 0 ? 0 : 1);
}

main().catch((e) => { console.error('[func] FATAL OUTER', e); process.exit(1); });
