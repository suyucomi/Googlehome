# Googlehome 架构 v2（重构目标与契约）

> 本次重构目标：**性能** + **排版稳定性**。行为（功能、存储数据、UI 观感）保持不变，
> 但代码结构按「单一数据源 / 单向数据流 / 模块分层 / 单层 CSS」重建。
>
> 基线版本：v1.9（git commit `d4edbca`）。重构后版本：v2.0。

## 1. 总体原则

1. **单一数据源**：`core/store.js` 是唯一运行时状态；**DOM 不再作为保存来源**（删除 `window.saveData` 读 DOM 的做法）。
2. **单向数据流**：事件/动作 → `store` action → 持久化（串行队列）→ 订阅者渲染（按区域 diff）。
3. **ES Modules**：`index.html` 只引一个 `<script type="module" src="js/main.js">`；禁止全局脚本顺序依赖，禁止 `window.xxx` 互相调用。
4. **按区域渲染**：侧边栏列表、书签网格、二级分类条、设置面板各自订阅/渲染；一次状态变化每帧每区域最多渲染一次（`ui/frame.js` 或 `core/dom.js` 的 `batch()`）。
5. **CSS 单层化**：每个组件一个文件；禁止「文件末尾追加一段覆盖前面的样式」；`!important` 仅允许在 `perf.css` 与 `@media (prefers-reduced-motion)` 中使用。
6. **保持数据兼容**：storage key 不变：`bookmarkPages`、`currentPageId`、`squares_<pageId>`、`settings`、`smartSettings`、`smartCache`、`smartImport`、`searchEngine`；`localStorage.sidebarState` 不变。老数据必须能直接读。
7. **可回滚**：每个任务完成时保证 `node tests/run-tests.mjs` 通过；集成后在真实 Chrome 用 CDP 验证。

## 2. 目录结构（目标）

```
src/
  index.html
  css/
    base.css        变量(:root)、reset、html/body、滚动条、z-index 变量、字体
    layout.css      应用外壳 .app/.container/主内容区/标题/背景层/桌面-移动断点布局
    search.css      搜索框 + 搜索引擎下拉
    sidebar.css     侧栏、页面列表、页面操作、二级分类浮层、文件夹提示条、移动抽屉
    squares.css     书签网格、方块、标题、空状态、拖拽/占位状态、新增按钮
    settings.css    设置面板（固定头 + 可滚动 body）及所有表单控件
    overlays.css    右键菜单、命名弹窗、确认弹窗、预览遮罩、Toast、loading
    perf.css        body.perf-mode 全部性能开关 + prefers-reduced-motion 降级
  js/
    main.js                 启动器：load state → mount ui → 绑定全局事件
    core/
      config.js             CONFIG、MOBILE_BREAKPOINT、DEFAULT_SETTINGS、DEFAULT_SMART
      utils.js              escapeHtml/debounce/throttle/favicon/domain/uid/clamp/stringToColor
      dom.js                $/$$/el/delegate/on/batch/setText/setAttr
      events.js             app 内事件名常量 + 轻量 emitter（可选）
      storage.js            chrome.storage 封装、串行写队列、loadAppState、onChanged
      store.js              状态 + actions + subscribe（唯一写入口）
    features/
      classifier.js         原 js/lib/classifier.js（纯逻辑，ESM export）
      bookmark-sync.js      原 js/lib/bookmark-sync.js（ESM；页面与 background 共用）
      settings.js           背景/性能/智能设置的读取、保存、应用（原 settings-manager + animation + background-manager 的合并）
      import-export.js      配置导入导出（原 config-manager）
      page-actions.js       页面 CRUD 的书签数据副作用（删除 squares_*、计数、建页）
    ui/
      sidebar.js            侧栏开合/响应式/焦点/aria + 页面列表渲染（含重命名/删除菜单）
      flyout.js             二级分类浮层（定位 clamp 到视口）
      squares.js            书签网格渲染/diff/拖拽排序/右键菜单/新增/文件夹过滤条
      search.js             搜索引擎 UI + 搜索提交（原 main.js 的搜索部分 + components/search.js）
      settings-panel.js     设置面板开合/滚动锁定/焦点陷阱/Esc/inert；绑定设置表单
      dialogs.js            命名弹窗、确认弹窗、Toast（原 paste.js 的弹窗部分 + ConfigManager.showToast）
      paste.js              粘贴/拖入 URL → store.addBookmark
    background.js           module service worker（manifest 加 "type": "module"）
```

删除：`src/js/components/*`、`src/js/utils/{background-manager,worker,animation,drag}.js`、`src/js/lib/*`（移入 features）、`src/js/smart-settings.js`、`src/css/ui.css`。

## 3. 核心 API 契约

> 文件路径与导出名固定，下游模块按此 import；实现细节由所有者决定。

### core/config.js
```js
export const CONFIG = { searchEngines, constants:{...}, websiteTitles, security:{...} };
export const MOBILE_BREAKPOINT = 768;
export const DEFAULT_SETTINGS = { background:{type:'none',value:'',blur:0,brightness:100}, searchEngine:'google' };
export const DEFAULT_SMART = { apiKey:'', baseUrl:'https://api.typesafe.ai', model:'jev-latest',
  autoClassify:true, taxonomy:true, perfMode:true, timeoutMs:15000 };
```

### core/utils.js
```js
export function escapeHtml(s);
export function debounce(fn, wait);
export function throttle(fn, limit);
export function domainOf(url);          // 'github.com' | ''
export function faviconUrl(url);        // chrome-extension://<id>/_favicon/... 同步、按域名缓存
export function letterIcon(url);        // data:image/svg+xml 回退
export function uid(prefix='p');
export function clamp(n, min, max);
export function stringToColor(str);
export function formatCount(n);
```

### core/dom.js
```js
export const $ = (sel, root=document) => root.querySelector(sel);
export const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));
export function el(tag, props={}, ...children);   // props: className/textContent/dataset/attrs/on
export function on(target, type, handler, opts={});     // 返回 dispose()
export function delegate(root, type, selector, handler, opts={}); // 返回 dispose()
export function batch(fn);        // 同一帧合并（rAF），返回 dispose 可选
export function setText(node, text);
```

### core/storage.js
```js
export const storage = {
  async get(keys), async set(obj), async remove(keys),
  onChanged(cb)            // cb(changes) 过滤掉无关 key 后可自行处理；返回 dispose
};
export function createWriteQueue();  // { enqueue(key, producerFn), flush() } 串行、合并同 key
export async function loadAppState();
// → { pages, currentPageId, settings, smartSettings, searchEngine, sidebarState }
export async function loadSquares(pageId);       // 读 squares_<pageId>
export async function saveSquares(pageId, arr);  // 写 squares_<pageId>
export async function savePages(pages, currentPageId);
```

### core/store.js（唯一写入口）
```js
export const store = {
  get state(),   // { pages, currentPageId, currentFolder, squaresByPage:Map<string,Square[]>,
                 //   settings, smartSettings, searchEngine, ui:{ sidebarOpen, settingsOpen, perfMode } }
  subscribe(fn),  // fn(state, changed:Set<string>)，返回 unsubscribe
  async init(),

  // 页面
  async createPage(name?), async deletePage(pageId), async renamePage(pageId, name),
  async selectPage(pageId),

  // 书签
  getSquares(pageId?), getVisibleSquares(),          // 按 currentFolder 过滤
  async addBookmark({url,title,folder?}),            // 去重、持久化、可选镜像浏览器书签
  async removeBookmark(url),
  async reorderSquares(orderedUrls),                 // 只重排当前可见（含分类过滤时保持其他分类位置）
  async ensureSquares(pageId),

  // 分类
  setFolder(folder),

  // 设置
  async updateSmartSettings(patch),
  async updateSettings(patch),
  setUi(patch),            // sidebarOpen/settingsOpen/perfMode 等；会同步 body class
};
```
- 所有按 key 的持久化写入都走 `createWriteQueue()`：串行、同 key 合并、失败只 warn 不崩溃。
- `chrome.storage.onChanged`（background 镜像新书签、其他标签页改动）→ 更新 store → 通知订阅者；**不得整页重建**，只更新对应页面/方块。
- 页面计数 `bookmarkCount` 由 store 在书签变化时维护，侧栏只改文本节点。

### features/settings.js
```js
export async function loadSettings();            // { settings, smartSettings }
export async function saveSmartSettings(patch);
export async function saveBackgroundSettings(settings);
export function applyBackground(settings);       // 背景层交叉淡入（性能模式下降级）
export function applyPerfMode(enabled);          // body.perf-mode
```
`features/bookmark-sync.js` 保持原导出：`importFromBrowser / addToBrowser / mirrorToTheme / isSuppressed / getBarNode`（background 与页面共用）。
`features/classifier.js` 保持原导出：`LinkClassifier`（或具名导出），测试用例不改逻辑。

### ui/*
每个 UI 模块导出一个 `mount`（或类）：
```js
export function mountSidebar({ root=document });   // 返回 { destroy }
export function mountSquares(...);
export function mountSettingsPanel(...);
```
- UI 只读 `store.state`，只通过 store actions 改状态；不直接写 `chrome.storage`（除 features/settings）。
- 事件全部委托到容器（禁止给每个书签绑定独立 click/keydown/contextmenu）。
- 渲染函数必须 **幂等 + 增量化**：相同状态重复调用不得重建 DOM；列表 diff 用 key（`data-url` / `data-page-id`）。
- 浮层（flyout / 右键菜单 / 下拉）定位必须 clamp 到 `visualViewport` 内。

## 4. HTML 结构（Lead 负责）

- 顶部：真实 `<h1 class="page-title">` 替代 `.container::before` 伪元素打字动画（避免宽度动画造成回流/CLS）。
- 内容壳：`.container > .app-main`，`.app-main` 负责居中与滚动；搜索、文件夹条、书签网格都放在其中。
- 设置面板：`<aside class="settings-panel"><header>…</header><div class="settings-body">…</div></aside>`，header 固定、body 自己滚动。
- 所有 `<button>` 显式 `type="button"`；搜索/设置/侧栏补齐 `aria-expanded`、`aria-controls`、`aria-hidden`。
- 脚本只有一个 `<script type="module" src="js/main.js"></script>`；样式按 base→layout→search→sidebar→squares→settings→overlays→perf 顺序 `<link>`。
- manifest：`background.type = "module"`。

## 5. 布局修复规格（针对「排版错乱」）

基线问题（待浏览器审计确认后补充证据）：

1. **宽度用 `100vw` 但父级有 320px 左内边距** → 侧栏展开 + 窗口 1000–1200px 时内容横向溢出/被裁切。统一改为百分比宽度：
   - `.container.sidebar-open` 用 `margin-left: var(--sidebar-w); width: calc(100% - var(--sidebar-w))`（移动端不生效）；
   - 所有内部块 `width/min(…, calc(100vw - 48px))` 一律改为 `width:100%; max-width:min(720px,100%)`。
2. **侧栏宽度三处不一致**（280/300/320）→ 统一 `--sidebar-w: 300px`（桌面），移动端抽屉同值；触发器 `--trigger-size: 46px`。
3. **书签网格**：`grid-template-columns: repeat(auto-fill, minmax(76px, 1fr))`，`gap: 18px 12px`，`justify-items:center`，`.square-list-item{min-width:0}`，`.square-title` 绝对定位不参与网格高度；任何视口下不得横向滚动。
4. **设置面板**：固定头 + body 滚动；宽度 `min(420px, 100vw)`；移动端 `100%`；打开时背景 `inert`；Esc 关闭；焦点进入面板。
5. **浮层 clamp**：二级分类浮层/搜索下拉/右键菜单不得超出视口（左/右/下）。
6. **CLS**：标题打字动画改为透明度/位移（无宽度动画）；首屏布局预留高度；`font-display` 无外部字体（系统字体）。
7. **移动端层级**：内容 < 遮罩 < 抽屉 < 触发器 < 设置面板；`body.sidebar-open-mobile` 时背景不可滚动。
8. **z-index 令牌**：`--z-content:1 --z-flyout:60 --z-overlay:80 --z-sidebar:100 --z-trigger:110 --z-settings:120 --z-menu:200`，禁止散落魔法数字。
9. 页面切换/筛选/空状态/300 条书签/窗口 resize/90% 与 110% 缩放下均不得错位；审计脚本自动检查横向溢出与元素越界。

## 6. 性能预算与验收

- 300 条/页、10 页数据下：
  - 首屏首次渲染（`boot:start`→`render:first`）目标 < 120ms；页面切换 < 120ms；
  - 单条星标/新增 → DOM 出现 < 50ms；保存不再全量读 DOM；
  - 侧栏计数变化只改文本，不重建列表；重复渲染相同状态 DOM 不变；
  - 滚动无 > 50ms 长任务；无每帧都跑的 JS 动画/rAF 循环。
- 代码量：删除死代码（components/*、background-manager、worker、eye、drag 重复实现），JS 有效行数下降；`ui.css` 3241 行 → 拆分后总量 ≤ ~2400 行且无重复覆盖层。
- 真实 Chrome（CDP）验证：4 档视口 × 6 种状态截图 + 布局断言 + 控制台零错误；`node tests/run-tests.mjs` 全绿。

## 7. 分工与写入范围（互不重叠）

| 所有者 | 写入范围 |
| --- | --- |
| Lead | `src/index.html`、`manifest.json`、`src/js/core/**`、`docs/ARCHITECTURE.md`、`README.md`、集成与最终验证 |
| features-dev | `src/js/features/**`、`src/background.js`、`tests/run-tests.mjs`；删除 `src/js/lib/**`、`src/js/utils/{settings-manager,config-manager,animation,background-manager,worker}.js` |
| ui-dev | `src/js/ui/**`、`src/js/main.js`；删除 `src/js/paste.js`、`src/js/components/**`、`src/js/smart-settings.js`、`src/js/utils/{page-manager,storage,drag}.js`、`src/js/utils/utils.js`（如被 core 取代） |
| css-architect | `src/css/**`（新建 8 个文件，删除 `ui.css`） |
| browser-auditor | `tools/**`、`docs/LAYOUT-AUDIT.md`、`docs/PERF-BASELINE.md`、`audit/**`、`*.png`（根目录截图）；**不改 src/** |

依赖：features-dev / ui-dev 依赖 core 契约（本文档）；css-architect 依赖审计结论做布局修复；browser-auditor 的基线审计先行。

---

## 8. 实现落地记录（v2.0，2026-10-22）

### 8.1 实际目录（与目标一致）

```
src/
  index.html                 # 8 个 CSS link + 15 个 modulepreload + boot-state + 单 module 入口
  css/  base / layout / search / sidebar / squares / settings / overlays / perf（8 文件，2384 行）
  js/
    boot-state.js            # 唯一的同步经典脚本：首帧前预置侧栏布局（见 8.3）
    main.js                  # 启动器（166 行）
    core/    config utils dom storage store（1440 行）
    features/ classifier bookmark-sync settings import-export（1005 行）
    ui/      frame dialogs flyout sidebar squares search settings-panel paste（2975 行）
  background.js              # ESM module service worker
```
删除：`js/lib/**`、`js/utils/**`、`js/components/**`、`js/config.js`、`js/paste.js`、`js/smart-settings.js`、`css/ui.css`。

### 8.2 落地时新增的两个决策

1. **`<link rel="modulepreload">` ×15**：ESM 依赖图原本分 3 波请求（每波约 +500ms），
   在冷启动基准里 DCL 4789ms → 2616ms（v1.9 基线同环境 3117ms），24 个资源一波并行。
   以后新增/重命名 ui 模块需同步该列表（在 `index.html` 头部）。
2. **`src/js/boot-state.js`（唯一经典脚本）**：见 8.3。

### 8.3 启动 CLS 归零

- 现象：store.init() 异步完成后才补 `.container.sidebar-open`，桌面主内容列在首帧后右移 300px，
  LayoutShift 实测 0.19（source `.container`）。
- 修复：① `boot-state.js` 在 `<body>` 末尾、module 之前**同步**按 `localStorage.sidebarState`
  预置 `.sidebar-open` / `.collapsed` / inert / aria（仅桌面，规则与 store 一致）；
  ② `layout.css` 把 `.container` 的 margin-left/width 过渡限制在
  `html[data-app-ready="true"] .container` 下，首帧前类名生效不播放动画。
- 结果（真实 Chrome headless）：CLS **0**（打开设置前后都 0）；300 条书签时
  title h=31px / search h=58px / squares 2830px 不被压缩 / 无横向溢出 / 控制台 0 error。

### 8.4 数据兼容

storage key 与 v1.x 完全一致（`bookmarkPages` / `currentPageId` / `squares_<pageId>` /
`settings` / `smartSettings` / `smartCache` / `searchEngine` / `localStorage.sidebarState`）。
升级只需在 `chrome://extensions` 重新加载扩展，已有页面与书签原样可用；首次无数据时
仍会请求 background 导入浏览器书签（`store.init` 对 `smart:import` 加了 2s 超时降级，
background 冷启动/无响应不会卡住首屏）。

### 8.5 验收命令

```bash
node tests/run-tests.mjs                      # 64 项（原 23 项全保留）
node tools/audit.mjs --ext . --out audit/after --label after      # 73 样本布局审计
node tools/perf-audit.mjs --ext . --out audit/after/perf.json --label after
node tools/functional-regression.mjs          # 真实 Chrome 功能回归
node tools/compare.mjs --before audit/before --after audit/after  # 前后对比
```
（浏览器验证默认 `--headless=new` 后台运行，不弹窗。）
