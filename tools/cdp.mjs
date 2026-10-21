// tools/cdp.mjs — 极简 Chrome DevTools Protocol 客户端 + Chrome 启动器
// 仅用 Node 标准库（Node 22+ 自带 WebSocket/fetch）。
// 提供给 tools/audit.mjs（布局审计）与 tools/perf-audit.mjs（性能基线）复用。

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const DEFAULT_CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

// ---------------------------------------------------------------------------
// CDP 客户端（浏览器级 + flatten session）
// ---------------------------------------------------------------------------
export class CDP {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map(); // method -> Set<fn(params, sessionId, method)>
    this.closed = false;
    ws.addEventListener('message', (ev) => this._onMessage(ev));
    ws.addEventListener('close', () => {
      this.closed = true;
      for (const { reject, timer } of this.pending.values()) {
        clearTimeout(timer);
        reject(new Error('CDP websocket closed'));
      }
      this.pending.clear();
    });
  }

  static async connect(wsUrl, { timeoutMs = 20000 } = {}) {
    const ws = new WebSocket(wsUrl);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`CDP connect timeout: ${wsUrl}`)), timeoutMs);
      ws.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
      ws.addEventListener('error', (e) => { clearTimeout(timer); reject(new Error(`CDP connect error: ${e?.message || 'unknown'}`)); }, { once: true });
    });
    return new CDP(ws);
  }

  _onMessage(ev) {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    if (msg.id != null) {
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      clearTimeout(p.timer);
      if (msg.error) {
        const err = new Error(`${p.method} failed: ${msg.error.message} (code ${msg.error.code})`);
        err.cdpError = msg.error;
        p.reject(err);
      } else {
        p.resolve(msg.result ?? {});
      }
      return;
    }
    if (msg.method) {
      const set = this.listeners.get(msg.method);
      if (set) for (const fn of set) { try { fn(msg.params ?? {}, msg.sessionId, msg.method); } catch (e) { /* ignore listener errors */ } }
      const any = this.listeners.get('*');
      if (any) for (const fn of any) { try { fn(msg.params ?? {}, msg.sessionId, msg.method); } catch { /* ignore */ } }
    }
  }

  on(method, fn) {
    if (!this.listeners.has(method)) this.listeners.set(method, new Set());
    this.listeners.get(method).add(fn);
    return () => this.listeners.get(method)?.delete(fn);
  }

  send(method, params = {}, sessionId = undefined, timeoutMs = 30000) {
    if (this.closed) return Promise.reject(new Error(`send after close: ${method}`));
    const id = this.nextId++;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timeout after ${timeoutMs}ms`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer, method });
      try { this.ws.send(JSON.stringify(payload)); } catch (e) { clearTimeout(timer); this.pending.delete(id); reject(e); }
    });
  }

  waitForEvent(method, predicate = () => true, timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
      const off = this.on(method, (params, sessionId, m) => {
        if (!predicate(params, sessionId)) return;
        clearTimeout(timer);
        off();
        resolve({ params, sessionId });
      });
      const timer = setTimeout(() => { off(); reject(new Error(`waitForEvent ${method} timeout`)); }, timeoutMs);
    });
  }

  async close() {
    try { this.ws.close(); } catch { /* ignore */ }
  }
}

// ---------------------------------------------------------------------------
// Chrome 启动 / 关闭
// ---------------------------------------------------------------------------
export async function launchChrome({
  chromePath = DEFAULT_CHROME,
  profileDir,
  extraArgs = [],
  timeoutMs = 40000,
  freshProfile = true,
  headless = true, // 用户指令：浏览器调试一律后台/无窗口模式
} = {}) {
  if (!profileDir) throw new Error('launchChrome: profileDir required');
  profileDir = path.resolve(profileDir);
  if (freshProfile) {
    await fsp.rm(profileDir, { recursive: true, force: true });
  }
  await fsp.mkdir(profileDir, { recursive: true });

  const args = [
    ...(headless && !extraArgs.includes('--headless=new') ? ['--headless=new'] : []),
    `--user-data-dir=${profileDir}`,
    '--remote-debugging-port=0',
    '--no-sandbox',
    '--disable-gpu',
    '--disable-dev-shm-usage',
    '--use-mock-keychain',
    '--no-first-run',
    '--no-default-browser-check',
    '--enable-unsafe-extension-debugging',
    '--disable-crash-reporter',
    '--disable-breakpad',
    '--disable-background-networking',
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--disable-ipc-flooding-protection',
    '--disable-features=CalculateNativeWinOcclusion',
    '--disable-sync',
    '--disable-component-update',
    '--metrics-recording-only',
    '--mute-audio',
    'about:blank',
    ...extraArgs,
  ];

  const stderrPath = path.join(profileDir, 'chrome.stderr.log');
  const out = fs.openSync(stderrPath, 'a');
  const child = spawn(chromePath, args, { stdio: ['ignore', 'ignore', out], detached: false });
  fs.closeSync(out);

  const portFile = path.join(profileDir, 'DevToolsActivePort');
  const deadline = Date.now() + timeoutMs;
  let port = null;
  while (Date.now() < deadline) {
    if (child.exitCode != null) throw new Error(`Chrome exited early (${child.exitCode}); see ${stderrPath}`);
    try {
      const raw = await fsp.readFile(portFile, 'utf8');
      const line = raw.split('\n')[0].trim();
      if (line) { port = Number(line); break; }
    } catch { /* not yet */ }
    await sleep(100);
  }
  if (!port) {
    try { child.kill('SIGKILL'); } catch { /* ignore */ }
    throw new Error(`Chrome DevTools port not found in ${portFile}`);
  }

  let browserWsUrl = null;
  for (let i = 0; i < 100 && !browserWsUrl; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`);
      const j = await res.json();
      browserWsUrl = j.webSocketDebuggerUrl;
    } catch { await sleep(100); }
  }
  if (!browserWsUrl) {
    try { child.kill('SIGKILL'); } catch { /* ignore */ }
    throw new Error('Chrome /json/version unavailable');
  }

  const browser = await CDP.connect(browserWsUrl);
  return {
    child,
    port,
    browser,
    profileDir,
    wsUrl: browserWsUrl,
    async kill() {
      try { await browser.close(); } catch { /* ignore */ }
      try { child.kill('SIGTERM'); } catch { /* ignore */ }
      await sleep(400);
      try { if (child.exitCode == null) child.kill('SIGKILL'); } catch { /* ignore */ }
    },
  };
}

// ---------------------------------------------------------------------------
// 扩展加载
// ---------------------------------------------------------------------------
async function enableDeveloperMode(browser, chromeVersion = '') {
  // 打开 chrome://extensions 并点击开发者模式开关，供 Extensions.loadUnpacked 使用。
  const { targetId } = await browser.send('Target.createTarget', { url: 'chrome://extensions/' });
  const { sessionId } = await browser.send('Target.attachToTarget', { targetId, flatten: true });
  const send = (m, p) => browser.send(m, p, sessionId);
  await send('Runtime.enable');
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try {
      const r = await send('Runtime.evaluate', {
        expression: `(() => {
          const mgr = document.querySelector('extensions-manager');
          const tb = mgr && mgr.shadowRoot && mgr.shadowRoot.querySelector('extensions-toolbar');
          const toggle = tb && tb.shadowRoot && tb.shadowRoot.getElementById('devMode');
          if (!toggle) return { ok: false, reason: 'toggle-not-found' };
          if (toggle.checked) return { ok: true, already: true };
          toggle.click();
          return { ok: true, clicked: true };
        })()`,
        returnByValue: true,
      });
      const v = r?.result?.value;
      if (v?.ok) return v;
    } catch { /* retry */ }
    await sleep(300);
  }
  throw new Error('failed to enable developer mode on chrome://extensions');
}

/** 加载未打包扩展，返回 { id, enabled, via } */
export async function loadExtension(browser, extPath) {
  extPath = path.resolve(extPath);
  const manifest = JSON.parse(await fsp.readFile(path.join(extPath, 'manifest.json'), 'utf8'));

  let result = null;
  let lastErr = null;
  try {
    result = await browser.send('Extensions.loadUnpacked', { path: extPath }, undefined, 20000);
  } catch (e) { lastErr = e; }

  let enabled = result?.enabled !== false;
  let via = 'Extensions.loadUnpacked';
  if (!result || !enabled) {
    // 开发者模式未开启时按配方打开 chrome://extensions 点击 devMode 后重试
    try {
      await enableDeveloperMode(browser);
      result = await browser.send('Extensions.loadUnpacked', { path: extPath }, undefined, 20000);
      enabled = result?.enabled !== false;
      via = 'loadUnpacked(after devMode)';
    } catch (e) { lastErr = e; }
  }

  let id = result?.id || null;
  // 从 Extensions.getExtensions 或 targets 里兜底找扩展 id
  if (!id) {
    try {
      const list = await browser.send('Extensions.getExtensions', {}, undefined, 10000);
      const ext = (list.extensions || []).find((e) => e.path === extPath || e.name === manifest.name);
      if (ext) { id = ext.id; enabled = ext.state ? ext.state !== 'disabled' : enabled; }
    } catch { /* ignore */ }
  }
  if (!id) {
    try {
      const { targetInfos } = await browser.send('Target.getTargets');
      const hit = targetInfos.find((t) => t.url?.startsWith('chrome-extension://'));
      if (hit) id = new URL(hit.url).host;
    } catch { /* ignore */ }
  }
  if (!id) throw new Error(`extension load failed: ${lastErr?.message || 'no id'}`);
  return { id, enabled, via, result };
}

/** 等扩展的 service worker / targets 就绪 */
export async function waitExtensionReady(browser, extId, timeoutMs = 12000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const { targetInfos } = await browser.send('Target.getTargets');
      const hit = targetInfos.find((t) => t.url?.startsWith(`chrome-extension://${extId}/`));
      if (hit) return hit;
    } catch { /* ignore */ }
    await sleep(200);
  }
  return null;
}

// ---------------------------------------------------------------------------
// 页面 session 辅助
// ---------------------------------------------------------------------------
export async function openPage(browser, url, { width = 1600, height = 900, mobile = false, deviceScaleFactor = 1 } = {}) {
  const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await browser.send('Target.attachToTarget', { targetId, flatten: true });
  const send = (m, p, t) => browser.send(m, p, sessionId, t);
  const page = new PageSession({ browser, sessionId, targetId, send, width, height, mobile, deviceScaleFactor });
  await page.init();
  // 强制目标页面处于「前台/可见」状态，避免 macOS 窗口遮挡导致 CSS 动画/过渡被 Chrome 暂停
  try { await browser.send('Page.bringToFront', {}, sessionId); } catch { /* ignore */ }
  try { await browser.send('Emulation.setFocusEmulationEnabled', { enabled: true }, sessionId); } catch { /* ignore */ }
  await page.setViewport({ width, height, mobile, deviceScaleFactor });
  await page.navigate(url);
  return page;
}

export class PageSession {
  constructor({ browser, sessionId, targetId, send, width, height, mobile, deviceScaleFactor }) {
    this.browser = browser;
    this.sessionId = sessionId;
    this.targetId = targetId;
    this._send = send;
    this.width = width;
    this.height = height;
    this.mobile = mobile;
    this.deviceScaleFactor = deviceScaleFactor;
    this.console = [];
    this.exceptions = [];
    this.logEntries = [];
    this._navCount = 0;
    this._loadWaiter = null;
    this.framePump = false; // true 时在 waitForFunction 轮询中周期性强制渲染一帧（headless/rAF 批处理场景）
    this.lastNetworkRequests = [];
  }

  async init() {
    const b = this.browser;
    const s = this.sessionId;
    this.offNav = b.on('Page.frameNavigated', (p, sid) => {
      if (sid === s && p.frame && !p.frame.parentId) { this._navCount++; if (this._loadWaiter) this._loadWaiter(); }
    });
    await this._send('Page.enable');
    await this._send('Runtime.enable');
    try { await this._send('Log.enable'); } catch { /* ignore */ }
    try { await this._send('Network.enable', { maxTotalBufferSize: 10 * 1024 * 1024 }); } catch { /* ignore */ }
    b.on('Runtime.consoleAPICalled', (p, sid) => { if (sid === s) this.console.push(normalizeConsole(p)); });
    b.on('Runtime.exceptionThrown', (p, sid) => { if (sid === s) this.exceptions.push(normalizeException(p)); });
    b.on('Log.entryAdded', (p, sid) => { if (sid === s) this.logEntries.push(p.entry); });
    b.on('Network.responseReceived', (p, sid) => {
      if (sid !== s) return;
      const r = p.response || {};
      this.lastNetworkRequests.push({ url: r.url, status: r.status, mime: r.mimeType, type: p.type });
      if (this.lastNetworkRequests.length > 400) this.lastNetworkRequests.shift();
    });
  }

  send(method, params, timeoutMs) { return this._send(method, params, timeoutMs); }

  async setViewport({ width, height, mobile = false, deviceScaleFactor = 1 }) {
    this.width = width; this.height = height; this.mobile = mobile; this.deviceScaleFactor = deviceScaleFactor;
    await this._send('Emulation.setDeviceMetricsOverride', {
      width, height, deviceScaleFactor, mobile,
      screenWidth: width, screenHeight: height,
    });
    // 让页面感知 resize（setDeviceMetricsOverride 会触发 resize 事件）
    await sleep(60);
  }

  async navigate(url, { timeoutMs = 20000 } = {}) {
    const before = this._navCount;
    const wait = this.waitNav(before + 1, timeoutMs);
    await this._send('Page.navigate', { url });
    await wait.catch(() => { /* about:blank 等场景不一定触发 */ });
    await sleep(80);
  }

  waitNav(navCount, timeoutMs = 20000) {
    if (this._navCount >= navCount) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this._loadWaiter = null; reject(new Error('navigation timeout')); }, timeoutMs);
      this._loadWaiter = () => {
        if (this._navCount >= navCount) {
          clearTimeout(timer);
          this._loadWaiter = null;
          resolve();
        }
      };
    });
  }

  async reload() {
    const before = this._navCount;
    const wait = this.waitNav(before + 1, 20000);
    await this._send('Page.reload', { ignoreCache: true });
    await wait.catch(() => {});
    await sleep(50);
  }

  async evaluate(expression, { awaitPromise = true, returnByValue = true, timeoutMs = 30000, userGesture = false } = {}) {
    const r = await this._send('Runtime.evaluate', {
      expression, awaitPromise, returnByValue, userGesture,
      includeCommandLineAPI: false,
    }, timeoutMs);
    if (r.exceptionDetails) {
      const msg = r.exceptionDetails.exception?.description || r.exceptionDetails.text || 'evaluate exception';
      const err = new Error(`page evaluate error: ${msg}`);
      err.exceptionDetails = r.exceptionDetails;
      throw err;
    }
    return r.result?.value;
  }

  /** 注入在每个新文档之前执行的脚本（记录 window.__AUDIT_T0 / MutationObserver） */
  async addInitScript(source) {
    return this._send('Page.addScriptToEvaluateOnNewDocument', { source });
  }

  async screenshot({ format = 'png', quality } = {}) {
    const r = await this._send('Page.captureScreenshot', { format, quality, fromSurface: true });
    return Buffer.from(r.data, 'base64');
  }

  async screenshotTo(filePath) {
    const buf = await this.screenshot();
    await fsp.mkdir(path.dirname(filePath), { recursive: true });
    await fsp.writeFile(filePath, buf);
    return filePath;
  }

  async waitForFunction(expression, { timeoutMs = 15000, pollMs = 50 } = {}) {
    const deadline = Date.now() + timeoutMs;
    let lastErr = null;
    const wrapped = `(async () => {
      try {
        const x = (${expression});
        const val = typeof x === 'function' ? await x() : await x;
        return { ok: true, val };
      } catch (e) { return { ok: false, err: String(e) }; }
    })()`;
    let polls = 0;
    while (Date.now() < deadline) {
      try {
        const v = await this.evaluate(wrapped);
        if (v && v.ok && v.val) return v.val;
        if (v && !v.ok) lastErr = new Error(v.err);
      } catch (e) { lastErr = e; }
      polls++;
      if (this.framePump && polls % 4 === 1) {
        // 强制渲染一帧：让 rAF 批处理/布局在 headless 或窗口被遮挡时也能推进
        try { await this.screenshot({ format: 'jpeg', quality: 1 }); } catch { /* ignore */ }
      }
      await sleep(pollMs);
    }
    throw new Error(`waitForFunction timeout: ${expression}${lastErr ? ` (${lastErr.message})` : ''}`);
  }

  async click(selector) {
    return this.evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; el.click(); return true; })()`);
  }

  async dispatchMouseEvent(type, x, y, extra = {}) {
    return this._send('Input.dispatchMouseEvent', { type, x, y, button: 'none', clickCount: 0, ...extra });
  }

  async wheelScroll(x, y, deltaX, deltaY) {
    return this._send('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX, deltaY, button: 'none', clickCount: 0 });
  }

  async close() {
    try { await this.browser.send('Target.closeTarget', { targetId: this.targetId }); } catch { /* ignore */ }
  }

  // 控制台错误/警告摘要
  consoleIssues() {
    const errors = [];
    for (const c of this.console) if (c.type === 'error') errors.push(`console.error: ${c.text}`);
    for (const e of this.exceptions) errors.push(`uncaught: ${e.text}`);
    for (const l of this.logEntries) if (l.level === 'error') errors.push(`log[${l.source}]: ${l.text}`);
    const warns = [];
    for (const c of this.console) if (c.type === 'warning') warns.push(`console.warn: ${c.text}`);
    for (const l of this.logEntries) if (l.level === 'warning') warns.push(`log[${l.source}]: ${l.text}`);
    return { errors, warns };
  }

  clearConsole() { this.console = []; this.exceptions = []; this.logEntries = []; this.lastNetworkRequests = []; }
}

function normalizeConsole(p) {
  const args = (p.args || []).map((a) => a.value ?? a.description ?? a.unserializableValue ?? a.type);
  const text = args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
  return { type: p.type, text, args, ts: p.timestamp };
}
function normalizeException(p) {
  const d = p.exceptionDetails || {};
  return {
    text: d.exception?.description || d.text || 'unknown exception',
    url: d.url, line: d.lineNumber, column: d.columnNumber, ts: p.timestamp,
  };
}
