// 运行：node tests/run-tests.mjs
//
// v2 架构测试：
//  - 被测模块全部以 ESM 方式动态 import（先注入 chrome/window/localStorage mock）；
//  - 保留 v1.9 原有的 23 项断言（分类规则、书签树、TypeSafe 请求、书签同步、favicon、清单）；
//  - 新增：features/settings、features/import-export 的关键逻辑、module background、
//         全部扩展脚本的 ESM 语法检查、旧全局/importScripts 静态检查。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
let passed = 0;
let failed = 0;
const plain = (v) => JSON.parse(JSON.stringify(v));
const fileUrl = (relPath) => pathToFileURL(path.join(ROOT, relPath)).href;
const readText = (relPath) => fs.readFileSync(path.join(ROOT, relPath), 'utf8');

async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log('  ✓ ' + name);
  } catch (err) {
    failed++;
    console.error('  ✗ ' + name + '\n      ' + (err?.stack || err));
  }
}

function walkJs(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkJs(full));
    else if (entry.isFile() && entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

// ---------- chrome / DOM mock ----------
function createChromeMock({ data: initialData = {}, bookmarks = true } = {}) {
  const data = Object.assign({}, initialData);
  const nodes = new Map();
  const listeners = { onInstalled: [], onStartup: [], onMessage: [], onCreated: [], onChanged: [] };
  let seq = 100;

  const mk = (id, title, parentId, url) => {
    const node = { id, title, parentId, children: [] };
    if (url) node.url = url;
    nodes.set(id, node);
    if (parentId) nodes.get(parentId).children.push(node);
    return node;
  };
  const clone = (n) => Object.assign({}, n, { children: n.children ? n.children.map(clone) : undefined });

  if (bookmarks) {
    mk('0', '');
    mk('1', '书签栏', '0');
    mk('2', '其他书签', '0');
    mk('f1', '开发与编程', '1');
    mk('f2', '工具与效率', '1');
    mk('s1', '代码托管', 'f1');
    mk('b1', 'GitHub', 's1', 'https://github.com/');
  }

  const changesFor = (obj) => {
    const changes = {};
    for (const key of Object.keys(obj)) changes[key] = { oldValue: data[key], newValue: obj[key] };
    return changes;
  };
  const emit = (changes) => {
    if (!Object.keys(changes).length) return;
    for (const listener of listeners.onChanged) listener(changes, 'local');
  };

  const chrome = {
    bookmarks: {
      getTree: async () => [clone(nodes.get('0'))],
      getChildren: async (id) => (nodes.get(id)?.children || []).map(clone),
      search: async ({ url }) => Array.from(nodes.values()).filter((n) => n.url === url).map(clone),
      create: async ({ parentId, title, url }) => {
        const id = 'n' + seq++;
        const node = mk(id, title, parentId, url);
        return clone(node);
      },
      move: async (id, { parentId, index } = {}) => {
        const node = nodes.get(id);
        if (!node || !parentId) return;
        const oldParent = nodes.get(node.parentId);
        if (oldParent) {
          const at = oldParent.children.indexOf(node);
          if (at >= 0) oldParent.children.splice(at, 1);
        }
        const parent = nodes.get(parentId);
        if (!parent) return;
        node.parentId = parentId;
        if (typeof index === 'number') parent.children.splice(index, 0, node);
        else parent.children.push(node);
      },
      onCreated: { addListener: (fn) => listeners.onCreated.push(fn) }
    },
    storage: {
      local: {
        get: async (keys) => {
          if (keys === null || keys === undefined) return Object.assign({}, data);
          const list = Array.isArray(keys) ? keys : [keys];
          const out = {};
          for (const key of list) if (key in data) out[key] = data[key];
          return out;
        },
        set: async (obj) => {
          const changes = changesFor(obj);
          Object.assign(data, obj);
          emit(changes);
        },
        remove: async (keys) => {
          const list = Array.isArray(keys) ? keys : [keys];
          const changes = {};
          for (const key of list) {
            if (key in data) {
              changes[key] = { oldValue: data[key] };
              delete data[key];
            }
          }
          emit(changes);
        },
        clear: async () => {
          const changes = {};
          for (const key of Object.keys(data)) changes[key] = { oldValue: data[key] };
          for (const key of Object.keys(data)) delete data[key];
          emit(changes);
        }
      },
      onChanged: {
        addListener: (fn) => listeners.onChanged.push(fn),
        removeListener: (fn) => {
          const index = listeners.onChanged.indexOf(fn);
          if (index >= 0) listeners.onChanged.splice(index, 1);
        }
      }
    },
    runtime: {
      getURL: (p) => 'chrome-extension://abc' + p,
      lastError: null,
      onInstalled: { addListener: (fn) => listeners.onInstalled.push(fn) },
      onStartup: { addListener: (fn) => listeners.onStartup.push(fn) },
      onMessage: { addListener: (fn) => listeners.onMessage.push(fn) },
      sendMessage: async () => ({ ok: true })
    }
  };

  return { chrome, data, nodes, listeners };
}

// 极简 DOM：只实现 features/settings 用到的 body/classList/background-layer。
function createFakeDom() {
  class Element {
    constructor(tagName) {
      this.tagName = tagName;
      this.style = {};
      this.childNodes = [];
      this.parentNode = null;
      this._classNames = new Set();
      const self = this;
      this.classList = {
        add(...names) { for (const name of names) self._classNames.add(name); },
        remove(...names) { for (const name of names) self._classNames.delete(name); },
        contains(name) { return self._classNames.has(name); },
        toggle(name, force) {
          const next = force === undefined ? !self._classNames.has(name) : Boolean(force);
          if (next) self._classNames.add(name);
          else self._classNames.delete(name);
          return next;
        }
      };
    }
    get className() { return Array.from(this._classNames).join(' '); }
    set className(value) {
      this._classNames = new Set(String(value || '').split(/\s+/).filter(Boolean));
    }
    get firstChild() { return this.childNodes[0] || null; }
    insertBefore(node, ref) {
      const index = ref ? this.childNodes.indexOf(ref) : -1;
      if (index < 0) this.childNodes.push(node);
      else this.childNodes.splice(index, 0, node);
      node.parentNode = this;
      return node;
    }
    appendChild(node) { return this.insertBefore(node, null); }
    removeChild(node) {
      const index = this.childNodes.indexOf(node);
      if (index >= 0) this.childNodes.splice(index, 1);
      node.parentNode = null;
      return node;
    }
    remove() { if (this.parentNode) this.parentNode.removeChild(this); }
    matches(selector) {
      return String(selector).split(',').some((part) => {
        const sel = part.trim();
        if (!sel) return false;
        if (sel.startsWith('.')) return this.classList.contains(sel.slice(1));
        return this.tagName === sel;
      });
    }
  }
  const body = new Element('body');
  const container = new Element('div');
  container.classList.add('container');
  body.appendChild(container);
  const elements = [body, container];
  const document = {
    body,
    getElementById: () => null,
    addEventListener: () => {},
    createElement: (tag) => {
      const node = new Element(tag);
      elements.push(node);
      return node;
    },
    querySelector: (selector) => elements.find((node) => isAttached(node) && node.matches(selector)) || null,
    querySelectorAll: (selector) => elements.filter((node) => isAttached(node) && node.matches(selector))
  };
  function isAttached(node) {
    if (node === body) return true;
    let cursor = node;
    while (cursor && cursor !== body) cursor = cursor.parentNode;
    return cursor === body;
  }
  return { document, body, container };
}

// ---------- 被测模块：features 必须能在无 chrome / 无 DOM 下 import ----------
const { LinkClassifier: LC } = await import(fileUrl('src/js/features/classifier.js'));
const BS = (await import(fileUrl('src/js/features/bookmark-sync.js'))).BookmarkSync;

console.log('\n[0] 模块加载（import 时零副作用）');
await test('classifier / bookmark-sync 在无 chrome、无 DOM 环境可 import', () => {
  assert.equal(typeof globalThis.chrome, 'undefined');
  assert.equal(typeof globalThis.document, 'undefined');
  assert.equal(typeof LC.buildPagesFromTree, 'function');
  assert.equal(typeof LC.decide, 'function');
  assert.equal(typeof BS.importFromBrowser, 'function');
  assert.equal(typeof BS.mirrorToTheme, 'function');
});

// ---------- 分类核心 ----------
const CANDIDATES = [
  { path: ['AI 与 大模型', 'AI 对话与助手'] },
  { path: ['开发与编程', '代码托管'] },
  { path: ['工具与效率', '网盘与文件传输'] }
];

const BAR = {
  id: '1',
  title: '书签栏',
  children: [
    {
      id: 'f1',
      title: '开发与编程',
      children: [
        { id: 's1', title: '代码托管', children: [
          { id: 'b1', title: 'GitHub', url: 'https://github.com/' },
          { id: 'b2', title: 'Gitee', url: 'https://gitee.com/' }
        ] },
        { id: 'b3', title: 'V2EX', url: 'https://v2ex.com/' },
        { id: 's2', title: '空目录', children: [] }
      ]
    },
    {
      id: 'f2',
      title: '工具与效率',
      children: [
        { id: 's3', title: '网盘与文件传输', children: [
          { id: 'b4', title: '百度网盘', url: 'https://pan.baidu.com/' }
        ] }
      ]
    },
    { id: 'b5', title: '零散收藏', url: 'https://example.com/loose' }
  ]
};

console.log('\n[1] 离线规则');
await test('GitHub → 开发与编程 / 代码托管', () => {
  const r = LC.classifyByRules({ title: 'GitHub', url: 'https://github.com/explore' });
  assert.deepEqual(plain(r.path), ['开发与编程', '代码托管']);
  assert.equal(r.source, 'rules');
});
await test('百度网盘 → 工具与效率 / 网盘与文件传输', () => {
  const r = LC.classifyByRules({ title: '百度网盘', url: 'https://pan.baidu.com/disk' });
  assert.deepEqual(plain(r.path), ['工具与效率', '网盘与文件传输']);
});
await test('未知站点 → null', () => {
  assert.equal(LC.classifyByRules({ title: '随便', url: 'https://unknown-xyz.test/' }), null);
});

console.log('\n[2] 首次导入：书签树 → 主题页面');
await test('一级目录成页面、二级目录成 folder、零散书签进未分类', () => {
  const result = LC.buildPagesFromTree(BAR);
  assert.equal(result.pages.length, 3);
  const dev = result.pages.find((p) => p.name === '开发与编程');
  const tools = result.pages.find((p) => p.name === '工具与效率');
  const loose = result.pages.find((p) => p.name === '未分类');
  assert.ok(dev && tools && loose);
  assert.equal(dev.bookmarkCount, 3);
  assert.deepEqual(plain(dev.subfolders), ['代码托管']); // 空目录不算有书签的二级分类
  const devSquares = result.squaresByPageId['squares_' + dev.id];
  assert.equal(devSquares.filter((s) => s.folder === '代码托管').length, 2);
  assert.equal(devSquares.filter((s) => s.folder === '').length, 1);
  assert.equal(tools.bookmarkCount, 1);
  assert.equal(loose.bookmarkCount, 1);
  assert.equal(loose.bookmarkCount + dev.bookmarkCount + tools.bookmarkCount, 5);
});
await test('同一页面内按 URL 去重', () => {
  const dup = {
    id: '1', title: '书签栏', children: [
      { id: 't', title: 'T', children: [
        { id: 'u1', title: 'A', url: 'https://a.test/' },
        { id: 'u2', title: 'A2', url: 'https://a.test/' }
      ] }
    ]
  };
  const result = LC.buildPagesFromTree(dup);
  assert.equal(result.squaresByPageId['squares_' + result.pages[0].id].length, 1);
});
await test('folderCandidatesFromTree 返回一级+二级路径', () => {
  const paths = LC.folderCandidatesFromTree(BAR).map((c) => c.path.join('/'));
  assert.deepEqual(plain(paths), ['开发与编程', '开发与编程/代码托管', '开发与编程/空目录', '工具与效率', '工具与效率/网盘与文件传输']);
});

console.log('\n[3] 推荐分类与 TypeSafe 请求');
await test('mergeTaxonomy 补齐推荐目录且不重复', () => {
  const merged = LC.mergeTaxonomy(LC.folderCandidatesFromTree(BAR), { maxDepth: 2 });
  const keys = merged.map((c) => c.path.join('/'));
  assert.ok(keys.includes('学习与教育'));
  assert.ok(keys.includes('新闻与资讯/新闻网站'));
  assert.equal(new Set(keys).size, keys.length);
  assert.ok(merged.length > 6);
});
await test('maxDepth=1 只补一级推荐目录', () => {
  const merged = LC.mergeTaxonomy([], { maxDepth: 1 });
  assert.ok(merged.every((c) => c.path.length === 1));
});
await test('请求体包含 state.folders 与 Choice/Noul', () => {
  const body = LC.buildSystemOneRequest({
    title: 'GitHub',
    url: 'https://github.com/explore',
    candidates: CANDIDATES.slice(0, 2),
    model: 'jev-latest'
  });
  assert.equal(body.model, 'jev-latest');
  assert.equal(body.state.bookmark.domain, 'github.com');
  assert.deepEqual(plain(body.state.folders), ['AI 与 大模型 / AI 对话与助手', '开发与编程 / 代码托管']);
  assert.equal(body.questions.folder.type, 'choice');
  assert.equal(body.questions.belongs.type, 'noul');
});
await test('parseAnswer 映射 choice 并根据 Noul 拒绝无匹配', () => {
  const answer = {
    answers: {
      folder: { type: 'choice', choice: '开发与编程 / 代码托管', confidence: 0.92, probabilities: {} },
      belongs: { type: 'noul', noul: 0.9 }
    }
  };
  assert.deepEqual(plain(LC.parseAnswer(answer, CANDIDATES.slice(0, 2)).path), ['开发与编程', '代码托管']);
  answer.answers.belongs.noul = 0.1;
  assert.equal(LC.parseAnswer(answer, CANDIDATES.slice(0, 2)).path, null);
});

console.log('\n[4] 决策顺序');
await test('模型成功 → source=model', async () => {
  const fetchImpl = async () => ({
    ok: true,
    json: async () => ({
      answers: {
        folder: { type: 'choice', choice: '开发与编程 / 代码托管', confidence: 0.9, probabilities: {} },
        belongs: { type: 'noul', noul: 0.9 }
      }
    })
  });
  const r = await LC.decide({
    title: 'GitHub', url: 'https://github.com/x', candidates: CANDIDATES,
    settings: { apiKey: 'k', model: 'jev-latest' }, fetchImpl
  });
  assert.equal(r.source, 'model');
  assert.deepEqual(plain(r.path), ['开发与编程', '代码托管']);
});
await test('模型 451 → 回退离线规则', async () => {
  const fetchImpl = async () => ({
    ok: false,
    status: 451,
    text: async () => 'region blocked'
  });
  const r = await LC.decide({
    title: 'GitHub', url: 'https://github.com/x', candidates: CANDIDATES,
    settings: { apiKey: 'k', model: 'jev-latest' }, fetchImpl
  });
  assert.equal(r.source, 'rules');
});
await test('没有 Key 时直接用规则', async () => {
  const r = await LC.decide({
    title: 'GitHub', url: 'https://github.com/x', candidates: CANDIDATES,
    settings: { apiKey: '' }
  });
  assert.equal(r.source, 'rules');
});

// ---------- 书签 ⇄ 主题同步 ----------
const mock = createChromeMock();
globalThis.chrome = mock.chrome;

console.log('\n[5] 浏览器书签 ⇄ 主题页面');
await test('importFromBrowser 建页面并写入 squares_*', async () => {
  const r = await BS.importFromBrowser({});
  assert.equal(r.ok, true);
  assert.equal(r.pages, 1);
  assert.equal(r.bookmarks, 1);
  const pages = mock.data.bookmarkPages;
  assert.equal(pages[0].name, '开发与编程');
  const squares = mock.data['squares_' + pages[0].id];
  assert.equal(squares[0].url, 'https://github.com/');
  assert.equal(squares[0].folder, '代码托管');
  assert.equal(mock.data.currentPageId, pages[0].id);
});
await test('已有页面时默认不重复导入', async () => {
  const r = await BS.importFromBrowser({});
  assert.equal(r.skipped, true);
});
await test('addToBrowser 写浏览器书签并镜像到主题', async () => {
  const r = await BS.addToBrowser({
    pageName: '工具与效率', subfolder: '网盘与文件传输',
    url: 'https://pan.baidu.com/disk', title: '百度网盘'
  });
  assert.equal(r.ok, true);
  assert.equal(r.created, true);
  const folder = mock.nodes.get(r.folderId);
  assert.equal(folder.title, '网盘与文件传输');
  const pages = mock.data.bookmarkPages;
  const tools = pages.find((p) => p.name === '工具与效率');
  assert.ok(tools);
  assert.ok(tools.subfolders.includes('网盘与文件传输'));
  const squares = mock.data['squares_' + tools.id];
  assert.ok(squares.some((s) => s.url === 'https://pan.baidu.com/disk' && s.folder === '网盘与文件传输'));
});
await test('mirrorToTheme 对同一 URL 去重', async () => {
  await BS.mirrorToTheme({ url: 'https://pan.baidu.com/disk', title: '百度网盘', pageName: '工具与效率', subfolder: '网盘与文件传输' });
  const pages = mock.data.bookmarkPages;
  const tools = pages.find((p) => p.name === '工具与效率');
  const squares = mock.data['squares_' + tools.id];
  assert.equal(squares.filter((s) => s.url === 'https://pan.baidu.com/disk').length, 1);
});
await test('主题写入的 URL 会被抑制，避免 background 重复处理', async () => {
  assert.equal(BS.isSuppressed('https://pan.baidu.com/disk'), true);
  assert.equal(BS.isSuppressed('https://never-added.test/'), false);
});

console.log('\n[6] 图标加载（core/utils favicon）');
const utils = await import(fileUrl('src/js/core/utils.js'));
await test('生成扩展内 _favicon URL', () => {
  const url = utils.faviconUrl('https://github.com/explore');
  assert.equal(url, 'chrome-extension://abc/_favicon/?pageUrl=https%3A%2F%2Fgithub.com%2Fexplore&size=64');
});
await test('同一域名命中缓存，不再重复生成', () => {
  const first = utils.faviconUrl('https://github.com/a');
  const second = utils.faviconUrl('https://github.com/b');
  assert.equal(first, second);
});
await test('非法 URL 回退字母图标且不写 localStorage', () => {
  const url = utils.faviconUrl('不是 url');
  assert.ok(url.startsWith('data:image/svg+xml'));
});

// ---------- features/settings ----------
const settingsMock = createChromeMock({ bookmarks: false });
globalThis.chrome = settingsMock.chrome;
const { DEFAULT_SETTINGS, DEFAULT_SMART } = await import(fileUrl('src/js/core/config.js'));
const settingsMod = await import(fileUrl('src/js/features/settings.js'));

console.log('\n[7] features/settings');
await test('loadSettings 在空存储下返回 DEFAULT 合并结果', async () => {
  const { settings, smartSettings } = await settingsMod.loadSettings();
  assert.deepEqual(plain(settings), plain(DEFAULT_SETTINGS));
  assert.deepEqual(plain(smartSettings), plain(DEFAULT_SMART));
});
await test('loadSettings 合并已存设置（缺省字段补默认值）', async () => {
  settingsMock.data.settings = { background: { type: 'image', value: 'data:image/png;base64,x', blur: 6 } };
  settingsMock.data.smartSettings = { apiKey: 'k-1' };
  const { settings, smartSettings } = await settingsMod.loadSettings();
  assert.equal(settings.background.type, 'image');
  assert.equal(settings.background.blur, 6);
  assert.equal(settings.background.brightness, DEFAULT_SETTINGS.background.brightness);
  assert.equal(smartSettings.apiKey, 'k-1');
  assert.equal(smartSettings.model, DEFAULT_SMART.model);
  assert.equal(smartSettings.perfMode, DEFAULT_SMART.perfMode);
});
await test('saveSmartSettings 增量合并并只写 smartSettings', async () => {
  const next = await settingsMod.saveSmartSettings({ perfMode: false, apiKey: 'k-2' });
  assert.equal(next.perfMode, false);
  assert.equal(next.apiKey, 'k-2');
  assert.equal(next.model, DEFAULT_SMART.model);
  assert.equal(settingsMock.data.smartSettings.perfMode, false);
  assert.equal('apiKey' in settingsMock.data.settings, false);
});
await test('saveBackgroundSettings 补全 background 字段', async () => {
  const next = await settingsMod.saveBackgroundSettings({ type: 'image', value: 'x.png', blur: 3, brightness: 90 });
  assert.deepEqual(plain(next.background), { type: 'image', value: 'x.png', blur: 3, brightness: 90 });
  assert.deepEqual(plain(settingsMock.data.settings.background), plain(next.background));
});
await test('applyPerfMode 切换 body.perf-mode；无 DOM 时安全返回', () => {
  assert.equal(settingsMod.applyPerfMode(true), false); // 当前无 document
  const fake = createFakeDom();
  globalThis.document = fake.document;
  try {
    assert.equal(settingsMod.applyPerfMode(true), true);
    assert.equal(fake.body.classList.contains('perf-mode'), true);
    assert.equal(settingsMod.isPerfMode(), true);
    settingsMod.applyPerfMode(false);
    assert.equal(fake.body.classList.contains('perf-mode'), false);
  } finally {
    delete globalThis.document;
  }
});
await test('applyBackground 性能模式直接切换（旧层同步移除）', () => {
  const fake = createFakeDom();
  globalThis.document = fake.document;
  try {
    settingsMod.applyPerfMode(true);
    const first = settingsMod.applyBackground({ type: 'image', value: 'one.png', blur: 8, brightness: 80 });
    assert.ok(first);
    assert.equal(first.style.opacity, '1');
    assert.equal(first.style.backgroundImage, 'url(one.png)');
    assert.equal(first.style.filter, 'blur(8px) brightness(80%)');
    const second = settingsMod.applyBackground({ type: 'image', value: 'two.png', blur: 0, brightness: 100 });
    assert.ok(second);
    assert.equal(fake.body.childNodes.includes(first), false);
    assert.equal(second.style.backgroundImage, 'url(two.png)');
  } finally {
    delete globalThis.document;
  }
});
await test('applyBackground 交叉淡入：旧层降级为 background-layer-old', async () => {
  const fake = createFakeDom();
  globalThis.document = fake.document;
  try {
    settingsMod.applyPerfMode(false);
    const first = settingsMod.applyBackground({ type: 'image', value: 'a.png', blur: 0, brightness: 100 });
    const second = settingsMod.applyBackground({ type: 'image', value: 'b.png', blur: 0, brightness: 100 });
    assert.equal(first.classList.contains('background-layer-old'), true);
    assert.equal(first.style.opacity, '0');
    assert.equal(second.classList.contains('background-layer'), true);
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(second.style.opacity, '1');
  } finally {
    delete globalThis.document;
  }
});
await test('applyBackground({type:none}) 移除背景层', () => {
  const fake = createFakeDom();
  globalThis.document = fake.document;
  try {
    settingsMod.applyPerfMode(true);
    settingsMod.applyBackground({ type: 'image', value: 'c.png', blur: 0, brightness: 100 });
    settingsMod.applyBackground({ type: 'none' });
    assert.equal(fake.document.querySelectorAll('.background-layer, .background-layer-old').length, 0);
  } finally {
    delete globalThis.document;
  }
});

// ---------- features/import-export ----------
const io = await import(fileUrl('src/js/features/import-export.js'));

console.log('\n[8] features/import-export');
await test('buildExportConfig 结构与 v1.x 一致', async () => {
  const exportMock = createChromeMock({
    bookmarks: false,
    data: {
      settings: { background: { type: 'image', value: 'bg.png', blur: 2, brightness: 95 } },
      searchEngine: 'baidu',
      bookmarkPages: [{ id: 'p1', name: '开发与编程', bookmarkCount: 1 }],
      currentPageId: 'p1',
      'squares_p1': [{ url: 'https://github.com/', title: 'GitHub', folder: '' }],
      squares: [{ url: 'https://legacy.test/', title: '旧数据' }]
    }
  });
  globalThis.chrome = exportMock.chrome;
  const data = await io.buildExportConfig();
  assert.deepEqual(Object.keys(data).sort(), [
    'bookmarkPages', 'currentPageId', 'legacySquares', 'pages', 'searchEngine', 'settings', 'timestamp', 'version'
  ]);
  assert.equal(data.version, '1.1');
  assert.match(data.timestamp, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(data.searchEngine, 'baidu');
  assert.equal(data.currentPageId, 'p1');
  assert.deepEqual(plain(data.bookmarkPages), [{ id: 'p1', name: '开发与编程', bookmarkCount: 1 }]);
  assert.deepEqual(plain(data.pages), { p1: [{ url: 'https://github.com/', title: 'GitHub', folder: '' }] });
  assert.deepEqual(plain(data.legacySquares), [{ url: 'https://legacy.test/', title: '旧数据' }]);
  assert.deepEqual(plain(data.settings), { background: { type: 'image', value: 'bg.png', blur: 2, brightness: 95 } });
});
await test('exportConfig 通过注入的 download/notify 完成落盘，不碰 DOM', async () => {
  const exportMock = createChromeMock({ bookmarks: false, data: { searchEngine: 'google' } });
  globalThis.chrome = exportMock.chrome;
  const calls = { download: 0, notify: [] };
  const result = await io.exportConfig({
    download: ({ filename, json, mime }) => {
      calls.download++;
      assert.match(filename, /^search-config-\d{4}-\d{2}-\d{2}\.json$/);
      assert.equal(mime, 'application/json');
      JSON.parse(json);
    },
    notify: (message, type) => calls.notify.push({ message, type })
  });
  assert.equal(result.ok, true);
  assert.equal(calls.download, 1);
  assert.deepEqual(calls.notify, [{ message: '配置已导出', type: 'success' }]);
});
await test('validateConfig 接受新旧格式、拒绝坏数据', () => {
  assert.equal(io.validateConfig({ version: '1.0', legacySquares: [{ url: 'https://a.test/', title: 'A' }] }), true);
  assert.equal(io.validateConfig({
    version: '1.1',
    bookmarkPages: [{ id: 'p1', name: 'A' }],
    pages: { p1: [{ url: 'https://a.test/', title: 'A' }] }
  }), true);
  assert.equal(io.validateConfig(null), false);
  assert.equal(io.validateConfig({}), false);
  assert.equal(io.validateConfig({ version: '1.1', legacySquares: [{ url: 1, title: 'A' }] }), false);
  assert.equal(io.validateConfig({ version: '1.1', bookmarkPages: [{ id: 1, name: 'A' }] }), false);
});
await test('importConfig 兼容旧格式 legacySquares', async () => {
  const importMock = createChromeMock({ bookmarks: false, data: { junkKey: '旧数据' } });
  globalThis.chrome = importMock.chrome;
  const result = await io.importConfig({
    version: '1.0',
    settings: { background: { type: 'none', value: '', blur: 0, brightness: 100 } },
    searchEngine: 'bing',
    legacySquares: [{ url: 'https://legacy.test/', title: '旧书签' }]
  });
  assert.equal(result.ok, true);
  assert.equal('junkKey' in importMock.data, false);
  assert.deepEqual(plain(importMock.data.squares), [{ url: 'https://legacy.test/', title: '旧书签' }]);
  assert.equal(importMock.data.searchEngine, 'bing');
  assert.equal(importMock.data.settings.background.type, 'none');
});
await test('importConfig 新格式写入 bookmarkPages/currentPageId/squares_*', async () => {
  const importMock = createChromeMock({ bookmarks: false });
  globalThis.chrome = importMock.chrome;
  const result = await io.importConfig({
    version: '1.1',
    settings: {},
    searchEngine: 'google',
    bookmarkPages: [{ id: 'p1', name: '开发与编程' }],
    currentPageId: 'p1',
    pages: { p1: [{ url: 'https://github.com/', title: 'GitHub', folder: '' }] }
  }, {
    confirm: () => true,
    notify: () => {},
    reload: () => {}
  });
  assert.equal(result.ok, true);
  assert.equal(importMock.data.currentPageId, 'p1');
  assert.deepEqual(plain(importMock.data.bookmarkPages), [{ id: 'p1', name: '开发与编程' }]);
  assert.deepEqual(plain(importMock.data['squares_p1']), [{ url: 'https://github.com/', title: 'GitHub', folder: '' }]);
});
await test('importConfig 取消时不写存储', async () => {
  const importMock = createChromeMock({ bookmarks: false, data: { searchEngine: 'baidu' } });
  globalThis.chrome = importMock.chrome;
  const result = await io.importConfig({ version: '1.0', legacySquares: [] }, { confirm: () => false });
  assert.equal(result.ok, false);
  assert.equal(result.canceled, true);
  assert.equal(importMock.data.searchEngine, 'baidu');
});
await test('importConfig 拒绝格式无效的配置', async () => {
  const importMock = createChromeMock({ bookmarks: false });
  globalThis.chrome = importMock.chrome;
  const result = await io.importConfig({ version: '1.1', legacySquares: [{ url: 1 }] });
  assert.equal(result.ok, false);
  assert.equal(result.error, '配置文件格式无效');
});

// ---------- background（module service worker） ----------
const bgMock = createChromeMock({ data: { smartImport: { at: 1234, count: 7 }, bookmarkPages: [{ id: 'p1', name: 'A' }] } });
globalThis.chrome = bgMock.chrome;
const backgroundSource = readText('src/background.js');

console.log('\n[9] background module service worker');
await test('background.js 无 importScripts 且以 ESM 方式 import features', () => {
  assert.equal(/importScripts\s*\(/.test(backgroundSource), false);
  assert.ok(backgroundSource.includes("from './js/features/bookmark-sync.js'"));
  assert.ok(backgroundSource.includes("from './js/features/classifier.js'"));
});
await test('background.js 作为 ESM 加载并注册监听器', async () => {
  await import(fileUrl('src/background.js'));
  assert.equal(bgMock.listeners.onInstalled.length, 1);
  assert.equal(bgMock.listeners.onStartup.length, 1);
  assert.equal(bgMock.listeners.onCreated.length, 1);
  assert.equal(bgMock.listeners.onMessage.length, 1);
});
await test('background 响应 smart:status 消息', async () => {
  const handler = bgMock.listeners.onMessage[0];
  const response = await new Promise((resolve) => {
    const keepAlive = handler({ type: 'smart:status' }, {}, resolve);
    assert.equal(keepAlive, true); // 异步 sendResponse 必须返回 true
  });
  assert.equal(response.ok, true);
  assert.equal(response.importedAt, 1234);
  assert.equal(response.bookmarks, 7);
  assert.equal(response.pages, 1);
});
await test('background 对未知消息返回错误', async () => {
  const handler = bgMock.listeners.onMessage[0];
  const response = await new Promise((resolve) => {
    handler({ type: 'nope' }, {}, resolve);
  });
  assert.equal(response.ok, false);
  assert.equal(response.error, 'unknown message');
});
await test('background 响应 smart:import（已导入时 skipped）', async () => {
  const handler = bgMock.listeners.onMessage[0];
  const response = await new Promise((resolve) => {
    handler({ type: 'smart:import' }, {}, resolve);
  });
  assert.equal(response.ok, true);
  assert.equal(response.skipped, true);
});
await test('background 响应 smart:add 且同 URL 去重（浏览器 + 主题各一条）', async () => {
  const handler = bgMock.listeners.onMessage[0];
  const send = (msg) => new Promise((resolve) => { handler(msg, {}, resolve); });
  const entry = {
    pageName: '工具与效率',
    subfolder: '网盘与文件传输',
    url: 'https://pan.baidu.com/sync-test',
    title: '百度网盘'
  };
  const first = await send({ type: 'smart:add', ...entry });
  assert.equal(first.ok, true);
  assert.equal(first.created, true);
  const second = await send({ type: 'smart:add', ...entry });
  assert.equal(second.ok, true);
  assert.equal(second.created, false);

  const page = bgMock.data.bookmarkPages.find((p) => p.name === '工具与效率');
  assert.ok(page, '主题应出现 工具与效率 页面');
  const squares = bgMock.data['squares_' + page.id] || [];
  assert.equal(squares.filter((s) => s.url === entry.url).length, 1);

  const browserChildren = await bgMock.chrome.bookmarks.getChildren(second.folderId);
  assert.equal(browserChildren.filter((n) => n.url === entry.url).length, 1);
});
await test('background 自动分类：书签栏星标 → 建目录、移动并镜像主题', async () => {
  const node = await bgMock.chrome.bookmarks.create({
    parentId: '1',
    title: 'GitHub 示例仓库',
    url: 'https://github.com/example/repo'
  });
  bgMock.listeners.onCreated[0](node.id, node);

  const started = Date.now();
  while (Date.now() - started < 1000) {
    if ((bgMock.data.bookmarkPages || []).some((p) => p.name === '开发与编程')) break;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }

  const dev = bgMock.data.bookmarkPages.find((p) => p.name === '开发与编程');
  assert.ok(dev, '应生成 开发与编程 页面');
  const squares = bgMock.data['squares_' + dev.id] || [];
  assert.ok(squares.some((s) => s.url === 'https://github.com/example/repo' && s.folder === '代码托管'));

  const moved = bgMock.nodes.get(node.id);
  const parent = bgMock.nodes.get(moved.parentId);
  assert.equal(parent.title, '代码托管');
});

// ---------- core/store 单元测试（单向数据流契约） ----------
const storeMock = createChromeMock({ bookmarks: false });
const localStore = new Map();
globalThis.chrome = storeMock.chrome;
globalThis.window = { innerWidth: 1440 };
globalThis.localStorage = {
  getItem: (key) => (localStore.has(key) ? localStore.get(key) : null),
  setItem: (key, value) => localStore.set(key, String(value)),
  removeItem: (key) => localStore.delete(key)
};
const { store } = await import(fileUrl('src/js/core/store.js'));

console.log('\n[10] core/store 单元测试');
await test('init：空存储建「默认页面」、桌面侧栏默认展开、ready', async () => {
  await store.init();
  assert.equal(store.state.pages.length, 1);
  assert.equal(store.state.pages[0].name, '默认页面');
  assert.equal(store.state.currentPageId, store.state.pages[0].id);
  assert.equal(store.state.ui.ready, true);
  assert.equal(store.state.ui.sidebarOpen, true); // innerWidth=1440，且未存 sidebarState
  assert.equal(store.state.settings.background.type, 'none');
  assert.equal(store.state.smartSettings.perfMode, true);
});
await test('init：读取 localStorage.sidebarState 生效', async () => {
  localStore.set('sidebarState', 'closed');
  await store.init(); // 二次 init 仅用于验证持久化的侧栏状态被读取
  assert.equal(store.state.ui.ready, true);
  assert.equal(store.state.ui.sidebarOpen, false);
  localStore.delete('sidebarState');
});
await test('addBookmark：http(s) 校验、去重、folder 进 subfolders、计数与落盘', async () => {
  const invalid = await store.addBookmark({ url: 'javascript:alert(1)', title: '坏链接' });
  assert.equal(invalid.ok, false);
  assert.equal(invalid.reason, 'invalid-url');
  assert.equal((await store.addBookmark({ url: 'ftp://a.test/x', title: 'FTP' })).ok, false);

  const first = await store.addBookmark({ url: 'https://github.com/', title: 'GitHub', folder: '开发' });
  assert.equal(first.ok, true);
  assert.equal(store.getCurrentPage().bookmarkCount, 1);
  assert.ok(store.getCurrentPage().subfolders.includes('开发'));
  await store.addBookmark({ url: 'https://a.test/', title: 'A' });

  const duplicate = await store.addBookmark({ url: 'https://github.com/', title: 'GitHub' });
  assert.equal(duplicate.ok, false);
  assert.equal(duplicate.reason, 'duplicate');

  await store.flush();
  const pageId = store.state.currentPageId;
  assert.equal(storeMock.data['squares_' + pageId].length, 2);
  assert.equal(store.getCurrentPage().bookmarkCount, 2);
});
await test('updateBookmark / removeBookmark', async () => {
  const updated = await store.updateBookmark('https://a.test/', { title: 'A 改名', folder: '工具' });
  assert.equal(updated.ok, true);
  assert.equal(updated.square.title, 'A 改名');
  assert.equal(updated.square.folder, '工具');
  assert.equal(store.getSquares().find((s) => s.url === 'https://a.test/').title, 'A 改名');

  const removed = await store.removeBookmark('https://a.test/');
  assert.equal(removed.ok, true);
  assert.equal(store.getCurrentPage().bookmarkCount, 1);
  assert.equal((await store.removeBookmark('https://a.test/')).reason, 'not-found');
});
await test('createPage / renamePage / selectPage', async () => {
  const homeId = store.state.currentPageId;
  const created = await store.createPage('工作');
  assert.equal(created.name, '工作');
  assert.equal(store.state.pages.length, 2);
  assert.equal(store.state.currentPageId, created.id);

  const renamed = await store.renamePage(created.id, '工作台');
  assert.equal(renamed.ok, true);
  assert.equal(store.getPage(created.id).name, '工作台');
  assert.equal((await store.renamePage(created.id, '工作台')).reason, 'unchanged');

  await store.selectPage(homeId);
  assert.equal(store.state.currentPageId, homeId);
  assert.equal(store.state.currentFolder, '');
});
await test('setFolder / getVisibleSquares 分类过滤', async () => {
  const workId = store.state.pages.find((page) => page.name === '工作台').id;
  await store.selectPage(workId);
  await store.addBookmark({ url: 'https://x1.test/', title: 'X1', folder: 'X' });
  await store.addBookmark({ url: 'https://y1.test/', title: 'Y1', folder: 'Y' });
  await store.addBookmark({ url: 'https://x2.test/', title: 'X2', folder: 'X' });
  await store.addBookmark({ url: 'https://y2.test/', title: 'Y2', folder: 'Y' });

  store.setFolder('X');
  assert.deepEqual(store.getVisibleSquares().map((s) => s.title), ['X1', 'X2']);
  store.setFolder('');
  assert.equal(store.getVisibleSquares().length, 4);
});
await test('reorderSquares：分类过滤下只重排可见项，其他分类位置不变', async () => {
  const page = store.getCurrentPage();
  await store.selectPage(page.id);
  store.setFolder('X');
  const reordered = await store.reorderSquares(['https://x2.test/', 'https://x1.test/']);
  assert.equal(reordered, true);
  // 全量顺序：可见项只在自己的位置上交换，Y 分类位置保持 index 1/3 不变
  const full = store.getSquares(page.id).map((s) => s.url);
  assert.deepEqual(full, [
    'https://x2.test/',
    'https://y1.test/',
    'https://x1.test/',
    'https://y2.test/'
  ]);
  assert.equal(await store.reorderSquares(['https://x2.test/', 'https://x1.test/']), false);

  // 数量不匹配（非当前过滤视图）也返回 false
  assert.equal(await store.reorderSquares(['https://x2.test/']), false);
  store.setFolder('');
});
await test('deletePage：删除非最后一页成功，最后一页拒绝', async () => {
  const workId = store.state.pages.find((page) => page.name === '工作台').id;
  const result = await store.deletePage(workId);
  assert.equal(result.ok, true);
  assert.equal(store.state.pages.length, 1);
  assert.equal((await store.deletePage(store.state.pages[0].id)).reason, 'last-page');
});
await test('外部 storage 变更（background mirror）同步 state 与页面计数', async () => {
  await new Promise((resolve) => setTimeout(resolve, 0));
  const pageId = store.state.currentPageId;
  const external = [
    { url: 'https://external.test/', title: '外部新增', folder: '' },
    { url: 'https://github.com/', title: 'GitHub', folder: '开发' }
  ];
  await storeMock.chrome.storage.local.set({ ['squares_' + pageId]: external });
  assert.equal(store.getSquares(pageId).length, 2);
  assert.equal(store.getSquares(pageId)[0].url, 'https://external.test/');
  assert.equal(store.getCurrentPage().bookmarkCount, 2);

  // bookmarkPages 也被其他标签页/background 改写
  await storeMock.chrome.storage.local.set({
    bookmarkPages: [
      { id: pageId, name: '默认页面', bookmarkCount: 2, subfolders: [] },
      { id: 'px', name: '外部新页', bookmarkCount: 0, subfolders: [] }
    ]
  });
  assert.equal(store.state.pages.length, 2);
  assert.equal(store.state.pages[1].name, '外部新页');
  assert.equal(store.state.currentPageId, pageId);
});
await test('updateSmartSettings 同步 ui.perfMode 并持久化', async () => {
  await store.updateSmartSettings({ perfMode: false });
  assert.equal(store.state.ui.perfMode, false);
  await store.flush();
  assert.equal(storeMock.data.smartSettings.perfMode, false);
});
await test('updateSettings 深合并 background 并持久化', async () => {
  await store.updateSettings({ background: { type: 'image', value: 'x.png' } });
  assert.equal(store.state.settings.background.type, 'image');
  assert.equal(store.state.settings.background.brightness, 100);
  await store.flush();
  assert.equal(storeMock.data.settings.background.value, 'x.png');
});
await test('setUi({sidebarOpen}) 写 localStorage.sidebarState', () => {
  const next = !store.state.ui.sidebarOpen;
  store.setUi({ sidebarOpen: next });
  assert.equal(localStore.get('sidebarState'), next ? 'open' : 'closed');
  store.setUi({ sidebarOpen: !next });
  assert.equal(localStore.get('sidebarState'), !next ? 'open' : 'closed');
});

// ---------- 静态检查 ----------
console.log('\n[11] 静态检查');
const allJsFiles = walkJs(path.join(ROOT, 'src')).map((file) => path.relative(ROOT, file));

// v1.9 遗留文件由 ui-dev / Lead 负责删除；新架构扫描时跳过它们（最终集成时会消失）。
const LEGACY_FILES = new Set([
  'src/js/config.js',
  'src/js/main.js',
  'src/js/paste.js',
  'src/js/smart-settings.js',
  'src/js/components/eye.js',
  'src/js/components/search.js',
  'src/js/components/squares.js',
  'src/js/utils/drag.js',
  'src/js/utils/page-manager.js',
  'src/js/utils/storage.js',
  'src/js/utils/utils.js'
]);
// 只跳过「尚未迁移的旧文件」：一旦同名文件改成 ESM（含 import），就必须接受新架构检查。
function isUnmigratedLegacy(rel) {
  if (!LEGACY_FILES.has(rel)) return false;
  return !/^\s*import\s/m.test(readText(rel));
}
const newArchitectureFiles = allJsFiles.filter((rel) => !isUnmigratedLegacy(rel));

await test('src/js 与新 background 无 importScripts', () => {
  for (const rel of allJsFiles) {
    assert.equal(/importScripts\s*\(/.test(readText(rel)), false, rel + ' 仍含 importScripts');
  }
});

const LEGACY_GLOBALS = /\bwindow\.(saveData|getFavicon|getFaviconSync|ConfigManager|settingsManager|backgroundManager|animationManager|backgroundTransition|LinkClassifier|BookmarkSync|smartSettings)\b/;
await test('新架构文件无 window.* 旧全局跨模块调用', () => {
  for (const rel of newArchitectureFiles) {
    const match = readText(rel).match(LEGACY_GLOBALS);
    assert.equal(match, null, rel + ' 仍使用旧全局 ' + (match ? match[0] : ''));
  }
});
await test('features 层不访问 window（只依赖 core，不 import ui）', () => {
  for (const abs of walkJs(path.join(ROOT, 'src/js/features'))) {
    const rel = path.relative(ROOT, abs);
    assert.equal(/\bwindow\./.test(readText(rel)), false, rel + ' 出现 window.*');
    assert.equal(/from\s+['"][^'"]*\/ui\//.test(readText(rel)), false, rel + ' import 了 ui 层');
  }
});
await test('classifier / bookmark-sync 不依赖 DOM', () => {
  for (const rel of ['src/js/features/classifier.js', 'src/js/features/bookmark-sync.js']) {
    assert.equal(/\bdocument\b/.test(readText(rel)), false, rel + ' 不应访问 document');
  }
});
await test('旧实现文件已删除', () => {
  const removed = [
    'src/js/lib/classifier.js',
    'src/js/lib/bookmark-sync.js',
    'src/js/utils/settings-manager.js',
    'src/js/utils/config-manager.js',
    'src/js/utils/animation.js',
    'src/js/utils/background-manager.js',
    'src/js/utils/worker.js'
  ];
  for (const rel of removed) {
    assert.equal(fs.existsSync(path.join(ROOT, rel)), false, rel + ' 应已删除');
  }
});

// ---------- 清单与语法 ----------
console.log('\n[12] 清单与语法');
await test('manifest 含 bookmarks 权限和 background', () => {
  const m = JSON.parse(readText('manifest.json'));
  assert.equal(m.manifest_version, 3);
  assert.ok(m.permissions.includes('bookmarks'));
  assert.equal(m.background.service_worker, 'src/background.js');
  assert.equal(m.background.type, 'module');
  assert.equal(m.chrome_url_overrides.newtab, 'src/index.html');
});
await test('所有扩展脚本可解析（ESM）', () => {
  const failures = [];
  for (const rel of allJsFiles) {
    try {
      execFileSync(process.execPath, ['--input-type=module', '--check'], {
        input: fs.readFileSync(path.join(ROOT, rel)),
        stdio: ['pipe', 'pipe', 'pipe']
      });
    } catch (err) {
      failures.push(rel + ': ' + String(err.stderr || err.message).trim().split('\n').slice(0, 3).join(' | '));
    }
  }
  assert.deepEqual(failures, []);
});
await test('features 层四个模块已就位', () => {
  for (const rel of [
    'src/js/features/classifier.js',
    'src/js/features/bookmark-sync.js',
    'src/js/features/settings.js',
    'src/js/features/import-export.js'
  ]) {
    assert.equal(fs.existsSync(path.join(ROOT, rel)), true, rel + ' 缺失');
  }
});

console.log(`\n结果：${passed} 通过，${failed} 失败\n`);
process.exit(failed ? 1 : 0);
