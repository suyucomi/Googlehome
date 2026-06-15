# Googlehome 插件剩余修复与交付 Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** 完成当前 Chrome 新标签页插件剩余的高优先级修复、验证与清理，交付一个结构统一、核心功能稳定、可在真实扩展环境中验证的成品。

**Architecture:** 以“单一职责 + 单一路径”为原则收敛现有实现：拖拽只保留 `src/js/utils/storage.js` 的实现，搜索只保留 `src/js/main.js` 的实现，所有书签创建路径统一生成 `.square-list-item` 结构。优先修复会产生运行时错误的问题，再统一状态来源和初始化时序，最后做真实扩展环境回归验证。

**Tech Stack:** Chrome Extension Manifest V3、原生 HTML/CSS/JavaScript、`chrome.storage.local`、DOM API、FileReader、Canvas、localStorage。

---

## Current context / assumptions

- 当前仓库根目录：`D:\代码\Googlehome`
- 已完成的一项真实修改：`src/js/components/squares.js` 已被收敛为兼容占位模块，不再参与第二套拖拽实现。
- 当前正式拖拽入口是 `src/js/utils/storage.js` 中的 `window.addDragEvents(listItem)`。
- 已确认的代码级问题包括：
  - `src/js/utils/utils.js` 中全局错误处理器引用了未定义函数。
  - `src/js/utils/worker.js` 是未完成/损坏代码。
  - `src/js/utils/drag.js` 创建的 DOM 结构与主渲染结构不一致。
  - `src/js/components/search.js` 与 `src/js/main.js` 存在重复搜索逻辑。
  - 搜索引擎状态分散在 `localStorage` 与 `chrome.storage.local` 两个来源中。
  - 初始化链存在隐式依赖与延迟重试。
- 当前没有现成测试目录；验证主要依赖真实扩展环境交互回归。
- 本计划是“只规划，不执行”。除计划文件外，不应编辑业务代码。

---

## Proposed approach

1. **先修运行时错误**：消除未定义函数、坏模块、明显错误数据结构。
2. **再统一单一路径**：搜索、拖拽、外部拖放、状态持久化各只保留一套正式实现。
3. **最后做扩展环境回归**：必须在真实 Chrome 扩展上下文里验证，而不是 `file://` 页面。
4. **交付标准**：核心用户路径全部通过——新建页面、粘贴添加、拖拽排序、右键修改/删除、切换页面、导入导出配置、搜索引擎切换与搜索。

---

## Files likely to change

### Core JS
- Modify: `src/js/utils/utils.js`
- Modify: `src/js/utils/storage.js`
- Modify: `src/js/utils/page-manager.js`
- Modify: `src/js/utils/drag.js`
- Modify: `src/js/utils/worker.js`
- Modify: `src/js/main.js`
- Modify: `src/js/components/search.js`
- Possibly modify: `src/js/utils/config-manager.js`
- Possibly modify: `src/js/utils/settings-manager.js`
- Possibly modify: `src/js/utils/background-manager.js`

### HTML / wiring
- Possibly modify: `src/index.html`

### Documentation
- Modify: `README.md`

---

## Validation targets

### Manual runtime validation in real extension context
- Load unpacked extension from repo root in Chrome.
- Open a new tab and verify the extension page renders.
- Confirm DevTools console has no startup exceptions.
- Verify all user-critical flows below.

### Suggested validation checklist
- 新建页面
- 重命名页面
- 删除页面（保留至少一个页面）
- 粘贴 URL 添加书签
- 外部拖入 URL 添加书签
- 书签拖拽排序
- 页面切换后顺序与数据持久化
- 搜索引擎切换（点击与 `Alt+数字`）
- 搜索执行
- 导出配置
- 导入配置
- 背景图片上传、预览、保存、刷新恢复

---

## Step-by-step plan

### Task 1: 清点并收紧当前拖拽唯一实现

**Objective:** 确认拖拽只剩 `storage.js` 一套正式路径，并为后续修复建立稳定基线。

**Files:**
- Review: `src/js/utils/storage.js`
- Review: `src/js/utils/page-manager.js:206-339`
- Review: `src/js/utils/drag.js`
- Review: `src/js/components/squares.js`
- Note: `src/index.html`

**Step 1: 记录拖拽当前真实入口**

确认：
- `window.addDragEvents(listItem)` 定义于 `src/js/utils/storage.js`
- `src/js/utils/page-manager.js:310-318` 在书签渲染时调用该函数
- `src/js/components/squares.js` 不再参与拖拽行为

**Step 2: 明确 `drag.js` 与正式拖拽的冲突点**

记录以下不一致：
- `src/js/utils/drag.js` 直接创建 `.square-container`
- 正式结构要求：

```html
<div class="square-list-item">
  <div class="square-container" data-url="..." data-title="..."></div>
  <span class="square-title">标题</span>
</div>
```

**Step 3: 写下验收标准**

拖拽系统验收标准：
- 所有书签创建路径都产生 `.square-list-item`
- 所有排序都作用于 `.square-list-item`
- 所有保存都只经过 `window.saveData()`

**Step 4: Commit**

```bash
git add src/js/components/squares.js
# 如果只是前置基线整理可略过提交，实际实现后再提交
```

---

### Task 2: 修复 `utils.js` 中的坏错误处理器

**Objective:** 消除会在真实异常发生时二次崩溃的全局错误处理逻辑。

**Files:**
- Modify: `src/js/utils/utils.js:227-253`
- Test: 浏览器 DevTools console

**Step 1: 写 failing 验证场景**

在浏览器控制台中触发一个测试异常，当前预期会因为未定义函数而报二次错误：

```js
setTimeout(() => { throw new Error('test-runtime-error'); }, 0);
```

**Step 2: Run to verify failure**

在真实扩展页面 DevTools 中执行上面的代码。

Expected: FAIL — 控制台出现与 `determineErrorType` 或 `handleNetworkError` 等未定义符号相关的异常。

**Step 3: Write minimal implementation**

将当前错误处理器改为保守实现：
- 删除对未定义分类器/处理器的依赖。
- 统一退化为安全日志输出。
- 如果保留分类，必须在同文件内提供完整实现。

建议最小实现方向：

```js
window.addEventListener('error', function(e) {
  const err = e?.error || e?.message || e;
  console.error('未处理的错误:', err);
});

window.addEventListener('unhandledrejection', function(e) {
  console.error('未处理的 Promise 拒绝:', e?.reason || e);
});
```

**Step 4: Run to verify pass**

重新执行：

```js
setTimeout(() => { throw new Error('test-runtime-error'); }, 0);
Promise.reject(new Error('test-rejection'));
```

Expected: PASS — 控制台只看到稳定的错误日志，不再有未定义函数异常。

**Step 5: Commit**

```bash
git add src/js/utils/utils.js
git commit -m "fix: simplify broken global error handling"
```

---

### Task 3: 处理损坏的 `worker.js`

**Objective:** 移除或隔离不可用的 Worker 草稿，防止未来被误接入后直接报错。

**Files:**
- Modify: `src/js/utils/worker.js`
- Search/Review: `src/index.html`
- Search/Review: `src/js/**/*.js`

**Step 1: 确认引用情况**

检查 `worker.js` 是否被任何脚本实际引用。

Run（只读）:

```bash
# 用搜索工具而不是 shell grep
search for: worker.js / new Worker / compressImage
```

Expected: 若无正式调用，说明它是死模块。

**Step 2: Write failing expectation**

当前坏代码：

```js
const worker = new Worker('worker.js');
worker.postMessage({ type: 'compressImage', imageData: imageData });
worker.onmessage = (e) => updateUI(e.data);
```

它依赖未定义的：
- `imageData`
- `updateUI`

**Step 3: Write minimal implementation**

二选一，优先推荐 A：

A. 如果项目当前没有使用 Worker：
- 将 `worker.js` 改成注释明确的占位文件，说明当前未启用 Worker 版本的图片压缩。

B. 如果项目后续要启用 Worker：
- 把它改成真正的 Worker 脚本，只保留 `self.onmessage = ...` 逻辑，不含主线程代码。

**Step 4: Run to verify pass**

- 确认项目中不再存在会直接执行坏 Worker 草稿的路径。
- 页面启动时控制台不出现 `imageData is not defined` / `updateUI is not defined`。

**Step 5: Commit**

```bash
git add src/js/utils/worker.js
git commit -m "fix: remove broken worker stub"
```

---

### Task 4: 统一外部拖入 URL 的书签创建结构

**Objective:** 让外部拖入 URL 与粘贴添加书签走同一数据结构和保存路径。

**Files:**
- Modify: `src/js/utils/drag.js`
- Review: `src/js/paste.js:410-497`
- Review: `src/js/utils/storage.js`
- Review: `src/js/utils/page-manager.js:215-323`

**Step 1: Write failing behavior description**

当前 `src/js/utils/drag.js` 只会创建：

```js
const square = document.createElement('div');
square.className = 'square-container';
```

Expected failure:
- 无标题
- 无 `.square-list-item`
- 不走统一保存结构
- 可能无法正常拖拽/右键/持久化

**Step 2: 设计统一入口**

优先方案：抽取一个统一的书签 DOM 构建函数，例如：

- `src/js/utils/storage.js` 或新建 `src/js/utils/bookmark-factory.js`

签名建议：

```js
function createBookmarkListItem({ url, title, faviconUrl = null }) {
  // 返回完整的 .square-list-item
}
```

**Step 3: Write minimal implementation**

要求：
- `drag.js` 不再直接拼半个 DOM。
- 与 `paste.js`、`page-manager.js` 共用相同结构：

```js
<div class="square-list-item">
  <div class="square-container" data-url="..." data-title="..."></div>
  <span class="square-title">...</span>
</div>
```

- 创建后调用：
  - `window.addDragEvents(listItem)`
  - `window.saveData()`

**Step 4: Run to verify pass**

在真实扩展环境中从页面外拖入一个 URL。

Expected: PASS
- 生成完整书签项
- 显示标题（可先用 URL 或友好标题）
- 可右键
- 可拖拽
- 刷新后仍存在

**Step 5: Commit**

```bash
git add src/js/utils/drag.js src/js/utils/storage.js
git commit -m "fix: unify external drop bookmark creation"
```

---

### Task 5: 合并重复搜索逻辑，仅保留 `main.js`

**Objective:** 搜索只保留一处事件绑定和一套行为定义，避免重复监听和维护分叉。

**Files:**
- Modify: `src/js/main.js:135-141`
- Modify or remove behavior from: `src/js/components/search.js`
- Review: `src/index.html:157-166`

**Step 1: Write failing behavior description**

当前重复监听：
- `src/js/main.js` 监听 `searchInput` 回车
- `src/js/components/search.js` 也监听 `searchInput` 回车

**Step 2: Choose source of truth**

保留：`src/js/main.js`
原因：
- 它已经持有 `currentEngine`
- 已处理 dropdown、图标、快捷键、初始化

**Step 3: Write minimal implementation**

- 从 `src/js/components/search.js` 中删除实际行为，改为兼容占位模块，或直接移除其脚本引用。
- 若保留文件，内容应类似：

```js
document.addEventListener('DOMContentLoaded', function() {
  // 搜索行为已统一到 src/js/main.js
});
```

**Step 4: Run to verify pass**

验证：
- 输入关键词回车只触发一次跳转
- 点击切换搜索引擎后回车按新的引擎搜索
- `Alt+数字` 切换后回车正常

**Step 5: Commit**

```bash
git add src/js/main.js src/js/components/search.js src/index.html
git commit -m "refactor: unify search behavior in main module"
```

---

### Task 6: 统一搜索引擎状态来源

**Objective:** 解决 `localStorage` 与 `chrome.storage.local` 双来源状态漂移问题。

**Files:**
- Modify: `src/js/main.js`
- Modify: `src/js/utils/storage.js`
- Modify: `src/js/utils/config-manager.js`

**Step 1: Define single source of truth**

推荐：
- 运行时 UI 可以读内存变量 `currentEngine`
- 持久化以 `chrome.storage.local.searchEngine` 为主
- `localStorage.currentSearchEngine` 仅作为兼容回退，逐步退出

**Step 2: Write failing scenario**

当前可能出现：
- UI 显示 Google
- 导出的配置里是 Bing
- 刷新后恢复为 Baidu

**Step 3: Write minimal implementation**

- 启动时优先从 `chrome.storage.local.searchEngine` 读取。
- 切换时同时更新内存态与 `chrome.storage.local`。
- `localStorage` 只保留兼容迁移逻辑，例如首次迁移后清理。

伪代码：

```js
async function loadCurrentSearchEngine() {
  const stored = await chrome.storage.local.get('searchEngine');
  return stored.searchEngine || localStorage.getItem('currentSearchEngine') || 'google';
}
```

**Step 4: Run to verify pass**

Expected: PASS
- 切换引擎后刷新仍保持一致
- 导出配置中的引擎与 UI 一致
- 导入配置后 UI 与存储一致

**Step 5: Commit**

```bash
git add src/js/main.js src/js/utils/storage.js src/js/utils/config-manager.js
git commit -m "fix: unify search engine persistence"
```

---

### Task 7: 简化初始化时序，去掉脆弱的“等一等再试”链路

**Objective:** 把当前多处 `setTimeout(100)` / 轮询等待的隐式依赖收敛为明确初始化顺序。

**Files:**
- Modify: `src/js/utils/storage.js:336-364`
- Modify: `src/js/utils/page-manager.js:249-280, 310-319`
- Modify: `src/js/paste.js:273-320`
- Review: `src/index.html`

**Step 1: 列出当前脆弱点**

当前存在：
- `storage.js` 轮询等待 `pageManager.initialized`
- `page-manager.js` 如果 `getFavicon` 不存在就等 100ms
- `paste.js` 如果 `getFavicon` 不存在也等 100ms

**Step 2: 设计明确初始化顺序**

建议顺序：
1. `config.js`
2. `utils.js`
3. `storage.js`
4. `settings-manager.js`
5. `page-manager.js`
6. `main.js`
7. `paste.js`

并明确约束：
- `utils.js` 必须先于所有 `getFavicon` 使用者
- `storage.js` 必须先于任何 `window.addDragEvents` 使用者

**Step 3: Write minimal implementation**

- 删除不必要的延迟重试。
- 若需要等待，改用显式 promise / 事件，而不是魔法时间。

**Step 4: Run to verify pass**

Expected: PASS
- 首次打开无偶发空白状态
- 切换页面时书签正常加载
- 图标正常显示，不依赖第二次重试

**Step 5: Commit**

```bash
git add src/js/utils/storage.js src/js/utils/page-manager.js src/js/paste.js src/index.html
git commit -m "refactor: stabilize initialization order"
```

---

### Task 8: 评估并收敛背景模块职责

**Objective:** 明确 `settings-manager.js` 与 `background-manager.js` 的边界，避免同一功能两套实现继续漂移。

**Files:**
- Review/Modify: `src/js/utils/settings-manager.js`
- Review/Modify: `src/js/utils/background-manager.js`
- Review: `src/index.html`

**Step 1: 明确当前真实入口**

当前大概率真实入口是：
- `SettingsManager`

而 `BackgroundManager` 更像辅助/草稿。

**Step 2: Decide ownership**

推荐方案：
- `settings-manager.js` 负责 UI 与用户交互
- `background-manager.js` 负责纯图片处理与效果计算

或者：
- 若 `background-manager.js` 未实际接入，则将其降级为工具模块或删减到最小

**Step 3: Write minimal implementation**

避免重复出现：
- 文件验证逻辑两份
- 背景应用逻辑两份
- 预览滤镜两份

**Step 4: Run to verify pass**

Expected: PASS
- 上传图片预览正常
- 点击保存后背景生效
- 刷新后恢复一致
- 控制台无重复背景处理日志/异常

**Step 5: Commit**

```bash
git add src/js/utils/settings-manager.js src/js/utils/background-manager.js
git commit -m "refactor: clarify background module responsibilities"
```

---

### Task 9: 清理死代码与未使用模块

**Objective:** 减少误导和维护噪音，让仓库更接近真实运行逻辑。

**Files:**
- Modify or remove behavior from: `src/js/components/eye.js`
- Review: `src/index.html`
- Review: `src/js/components/squares.js`
- Review: `src/js/utils/worker.js`

**Step 1: Confirm dead code**

确认：
- `eye.js` 依赖 `.eye-inner` / `.pupil`
- `index.html` 中无对应 DOM

**Step 2: Write minimal implementation**

选项：
- 若确定不再使用，则移除脚本引用。
- 若暂时保留，则改为清晰注释说明“当前未接入 DOM，不产生行为”。

**Step 3: Run to verify pass**

Expected: PASS
- 页面无功能变化
- 控制台更干净
- 仓库阅读成本下降

**Step 4: Commit**

```bash
git add src/index.html src/js/components/eye.js src/js/utils/worker.js
git commit -m "chore: remove dead and placeholder modules"
```

---

### Task 10: 在真实 Chrome 扩展环境中做完整回归并交付

**Objective:** 在真正的目标运行环境中完成验收，形成最终交付标准。

**Files:**
- Review only: 全项目
- Update docs if needed: `README.md`

**Step 1: Load unpacked extension**

操作：
- 打开 `chrome://extensions/`
- 开启开发者模式
- 选择“加载已解压的扩展程序”
- 指向仓库根目录：`D:\代码\Googlehome`

**Step 2: Verify startup**

打开新标签页。

Expected: PASS
- 页面正常渲染
- 无明显布局错误
- 控制台无启动异常

**Step 3: Run regression checklist**

逐项执行：
1. 新建页面
2. 重命名页面
3. 删除页面
4. 粘贴 URL 添加书签
5. 外部拖入 URL 添加书签
6. 拖拽排序
7. 切换页面后顺序保持
8. 右键修改名称
9. 右键删除书签
10. 搜索引擎切换
11. 回车搜索
12. 导出配置
13. 导入配置
14. 背景上传、保存、刷新恢复

**Step 4: Document remaining edge cases**

如果仍有问题，按以下格式记录到 `README.md` 或 issue 列表：
- 触发步骤
- 预期结果
- 实际结果
- 影响范围
- 建议优先级

**Step 5: Commit**

```bash
git add README.md
git commit -m "docs: update verification notes for extension delivery"
```

---

## Risks, tradeoffs, and open questions

### Risks
- 当前没有自动化测试，回归主要依赖手工验证，容易漏边缘场景。
- 真实扩展环境与 `file://` 页面差异很大，必须用真实扩展上下文验收。
- `chrome.storage.local` 与 `localStorage` 的兼容迁移若处理不慎，可能影响老用户数据。
- 背景与书签功能都有较多异步逻辑，初始化顺序改动需要谨慎。

### Tradeoffs
- **保守方案**：优先收敛实现、减少重复逻辑，不做大重构；好处是风险小。
- **激进方案**：抽象出 `bookmark-factory`、统一全局状态管理；好处是结构更干净，但改动面更大。

### Open questions
- 是否需要保留对旧版 `localStorage` 数据格式的长期兼容，还是只做一次迁移？
- `BackgroundManager` 最终要不要保留为独立模块？
- 是否愿意为该插件补一个最小的端到端检查脚本（哪怕不是完整测试框架）？

---

## Final delivery standard

满足以下条件才算“交付成品”：

- 启动无控制台致命错误
- 书签页面管理正常
- 书签添加/编辑/删除正常
- 拖拽排序正常且能持久化
- 搜索引擎切换与搜索一致
- 导入导出配置可用
- 背景设置可用并能恢复
- 仓库中不再保留会误导维护者的坏模块/重复主逻辑

---

## Suggested execution order summary

1. 修 `utils.js` 错误处理器
2. 处理 `worker.js`
3. 统一 `drag.js` 的书签创建结构
4. 合并重复搜索逻辑
5. 统一搜索引擎状态来源
6. 简化初始化时序
7. 收敛背景模块职责
8. 清理死代码
9. 在真实 Chrome 扩展环境中做完整回归
10. 更新文档并交付
