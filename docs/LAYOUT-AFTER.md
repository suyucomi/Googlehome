# Googlehome 布局审计报告（重构后 v2.0 · after）

> 注：v2.0.1 已按需求移除搜索框上方的页面标题行（`.page-title` / `<h1>`）；本报告中标题相关指标为 v2.0 验收时状态，其余结论不变。

> 审计对象：`src/`（manifest `version: "2.0"`，8 层 CSS + ESM 单入口，CSS 总行数 2406、`!important` 仅 32 处且只在 `perf.css`）
> 审计方式：真实 Chrome **155.0.8059.85**（**headless=new 后台模式**，按用户指令）+ CDP（`tools/audit.mjs`），headless 下扩展加载/截图/布局测量均正常
> 审计时间：2026-10-22 · 样本：**73 个**（12 档视口 × 12 状态，与基线 `docs/LAYOUT-AUDIT.md` 完全同矩阵）· 截图：`audit/after/screens/`（73 张）· 原始数据：`audit/after/layout.json`
> 控制台：**73/73 样本 0 error / 0 uncaught / 0 资源加载失败**（基线同样为 0）

---

## 0. TL;DR —— 基线问题全部关闭，仅剩「交互触发」的 P2

| 指标 | before（v1.9） | after（v2.0） | 结论 |
| --- | --- | --- | --- |
| 问题记录总数 | 194 | **8** | **-95.9%** |
| **P0（排版错乱）** | **103** | **0** | ✅ 全部关闭 |
| **P1（体验/可用性）** | **75** | **0** | ✅ 全部关闭 |
| P2（细节） | 16 | 8 | 剩余 8 条全部是「点击收起侧栏」的交互触发 CLS（P2/info，见 §4） |
| 控制台错误样本 | 0 | 0 | ✅ 无回归 |
| 横向溢出视口/容器 | 18 样本 | **0** | ✅ |
| 元素越界/侧栏重叠/网格越界 | 34 样本 | **0** | ✅ |
| 点击穿透（方块中心被遮挡） | 10 样本 | **0** | ✅ |
| 隐藏操作按钮可点击 | 53 样本 | **0** | ✅ |
| 搜索下拉越界（移动端被裁 60px） | 4 样本 | **0** | ✅ |
| 标题被 flex 压扁 | 59 样本 | **0**（h1 高度 21.59–31.19px 正常） | ✅ |
| CLS（boot / 非交互） | 0.025（首屏） | **≤0.0048**（全部 base/motion/empty 状态，远低于 0.1） | ✅ |
| CLS（设置面板打开） | 0.11–0.78 | **≤0.0048** | ✅ |
| 功能回归（真实 Chrome） | — | **12/12 通过 + 1 项合成拖拽限制标注 skip**，0 console error | ✅ |

**唯一残留（P2/info）：点击侧栏收起按钮时，主内容区瞬时右移一次（CLS 0.19–0.74）。** 这是「文档流布局真实变化」，不是动画/异步造成的错位：真实用户点击属于 user input，浏览器 CLS 计算会通过 `hadRecentInput` 排除；本审计用合成 click 触发才被计入。按 Lead 约定归为 P2/info，不计入 P0/P1。

## 1. 审计环境与复跑

```bash
# AFTER（headless 后台模式；输出 audit/after/）
node tools/audit.mjs --ext . --out audit/after --label after
node tools/perf-audit.mjs --ext . --out audit/after/perf.json --label after
node tools/functional-regression.mjs --ext . --out audit/after/functional.json --label after
node tools/compare.mjs --before audit/before --after audit/after   # → audit/after/compare.json / compare.md
```

- 视口：1600×900、1440×900、1280×800、1180×800、1100×800、1024×768、900×800、834×1112（桌面）；768×1024、600×900、430×932、390×844（移动）
- 状态：桌面 base(侧栏开)/sidebar-closed/settings-open/search-dropdown/flyout/filtered/empty-page + 1600×900 额外 `motion-title`（正常动效，测 CLS/标题动画）；移动 base/drawer-open/settings-open/search-dropdown
- 数据：10 页面（当前页 300 条、8 页各 50 条、1 页空）、4 个二级分类；布局几何用 `prefers-reduced-motion: reduce` 仿真保证确定性（v2 已实现降级）
- 每样本记录：`doc/container` 溢出、所有关键元素 rect、网格列/间距/越界、`elementFromPoint` 命中、`textClipping`、`z-index`、`settingsInfo/flyoutInfo/dropdownInfo`、CLS（含 `previousRect/currentRect/hadRecentInput`）、console error/warn、DOM 节点数

## 2. 基线问题逐项验收（before → after 数值证据）

| 基线问题（P0/P1） | before 证据 | after 证据 | 状态 |
| --- | --- | --- | --- |
| **P0 标题被 flex 压扁**（59 样本） | `.container::before` h=4.64px（桌面）/1.17px（390） | 真实 `<h1 class="page-title">`：1600/1440 h=**31.19px**、1280 h=30.7、1180 h=28.31、1100 h=26.39、1024 h=24.58、900/834 h=21.59、移动 h=26；`animatesWidth=false` | ✅ 关闭 |
| **P0 834×1112 网格越界 + 侧栏重叠** | 网格 x=207→right 927（越界 93px）；与侧栏重叠 77,293px²；container 内部溢出 113px | `doc.overflowX=false`、`container.innerOverflowX=0`；squares right=**814 ≤ 834**；侧栏 right=314 < 内容 x=320（间距 6px，无重叠） | ✅ 关闭 |
| **P0 900×800 同上** | 网格 right 960（越界 60px）；重叠 31,607px²；溢出 80px | squares right=**880 ≤ 900**；无重叠；溢出 0 | ✅ 关闭 |
| **P0 方块中心点击命中的是侧栏**（10 样本） | `hitTests` misses 10/24、10/36 | 全部 73 样本 `hitTests` 非预期 miss = **0** | ✅ 关闭 |
| **P0 空状态越界** | `.empty-state` right=952 > 900/834 | 1600：empty state rect=(598,288,704×116)，在容器内且视口内 | ✅ 关闭 |
| **P1 横向溢出 1024/900/834**（18 样本） | container 内部溢出 18/80/113px | 全部视口 `doc.overflowX=false`、`innerOverflowX=0` | ✅ 关闭 |
| **P1 隐藏操作按钮可点击**（53 样本） | `.page-action-btn` opacity:0 时命中自身 | `sidebar.css:302` `pointer-events:none`，`hover/focus-within/focus` 才 `auto`；`pageActionProbes` hitsSelf=**0** | ✅ 关闭 |
| **P1 移动端搜索下拉左侧被裁 60px**（4 样本） | rect x=-60 | 390×844：dropdown rect x=**24**、w=210、right=**234 ≤ 390**，`withinViewport=true`（`ui/frame.js` clamp 到 visualViewport） | ✅ 关闭 |
| **P1 设置面板 aria-hidden 不更新/无 inert** | 打开后 aria-hidden 仍 "true"，背景可交互 | 打开：`aria-hidden=false`、`.app-main` 与 `#sidebar` `inert=true`、焦点进入面板、Esc 关闭后恢复 `aria-hidden=true`（functional 实测） | ✅ 关闭 |
| **P2 标题宽度打字动画** | animation=premiumTitleTyping，逐帧改 width | `h1` 的 `page-title-in` 只动 opacity/transform（`animatesWidth=false`，motion 样本 CLS=**0**） | ✅ 关闭 |
| **P2 z-index 魔法数字** | flyout 10050 / dropdown 1000 / search 200 / sidebar 99 | 令牌化：`--z-content:1`、`--z-flyout:60`、`--z-overlay:80`、`--z-sidebar:100`、`--z-trigger:110`、`--z-settings:120`、`--z-menu:200`（实测计算值 1/2/60/80/100/110/120/200） | ✅ 关闭 |
| **P2 侧栏宽度三处不一致（280/300/286/320）** | 侧栏 right=300 vs 容器按 320 预留 → 20px 悬空 | `--sidebar-w:300px` 单一来源（`base.css:59`），侧栏 right=314、内容让位 320（14+300+6 inset），布局一致 | ✅ 关闭 |
| **P2 设置面板用 `right` 过渡（layout 动画）** | settings-open CLS 0.11–0.78（source: settingsPanel） | `settings.css` 改用 `transform: translateX(...)`；settings-open 状态 CLS **≤0.0048**，sources 中不再出现 settingsPanel | ✅ 关闭 |
| **P2 移动端抽屉层级** | 实测已正确（基线末尾补丁） | 保持正确：抽屉 right=310、overlay 全屏 opacity=1/visible、层级令牌 80 < 100 < 110；抽屉打开时背景 inert/锁滚动 | ✅ 保持 |

## 3. 视口 × 状态矩阵（after）

| 视口 | 样本数 | P0 | P1 | P2 | 问题类别 |
| --- | --- | --- | --- | --- | --- |
| 1600×900 | 8 | 0 | 0 | 1 | CLS×1（sidebar-closed 交互） |
| 1440×900 | 7 | 0 | 0 | 1 | CLS×1（sidebar-closed） |
| 1280×800 | 7 | 0 | 0 | 1 | CLS×1（sidebar-closed） |
| 1180×800 | 7 | 0 | 0 | 1 | CLS×1（sidebar-closed） |
| 1100×800 | 7 | 0 | 0 | 1 | CLS×1（sidebar-closed） |
| 1024×768 | 7 | 0 | 0 | 1 | CLS×1（sidebar-closed） |
| 900×800 | 7 | 0 | 0 | 1 | CLS×1（sidebar-closed） |
| 834×1112 | 7 | 0 | 0 | 1 | CLS×1（sidebar-closed） |
| 768×1024 / 600×900 / 430×932 / 390×844 | 4×4 | 0 | 0 | 0 | — |
| **合计** | **73** | **0** | **0** | **8** | CLS×8（全部交互触发） |

**关键几何（base / mobile-base）**：所有视口 `doc.overflowX=false`、`container.innerOverflowX=0`、`squares.right ≤ innerWidth`、`sidebar 与内容无交集`、`grid` 列数自适应（1600→8 列、1024→7、900→6、834→5、768→8、600→6、430/390→4）、300 条网格项全部渲染且无 `elementFromPoint` miss。300 条时标题 h1 高度 21.59–31.19px（font-size 18–26px，比例正常）。

## 4. 残留 / 新增问题说明（全部 P2/info，不阻塞验收）

**P2-1 交互触发 CLS：点击收起侧栏时内容瞬时右移（8 个桌面视口各 1 条）**
- 数值：1600/1440/1280/1180/1100 → CLS 0.1875/0.208/0.236/0.257/0.275；1024/900/834 → 0.741/0.677/0.593（视口越窄，网格宽度在收起后从 684/560/494 → 720，重排幅度更大）
- 证据（layout.json）：`sources: appContainer previousRect{x:300,w:视口-300} → currentRect{x:0,w:视口}`，同时 squares/search 跟随平移
- 定性：这是「侧栏让位」布局本身的真实变化（v2 用 margin-left/width 实现让位，架构要求），不是异步/boot 错位；真实用户点击侧栏按钮属于 user input，浏览器 CLS 会以 `hadRecentInput` 排除（本审计是合成 click 才计入）
- 结论：**P2/info**（按 Lead 约定不计入 P0/P1）。若未来要让程序化 CLS 也归零，可改为「侧栏抽屉式覆盖 + 主内容不位移」，但会改变 v2 既定布局行为，不建议在本次重构内做。

**P2-2 分类筛选时 folder-bar 插入把网格下推 ~46px**
- 数值：filtered 状态 CLS 0.0088–0.0249（低于 0.1 阈值，未计入问题数，仅记录）；`sources: squaresContainer` — 属预期内容变化（交互插入提示条）。

**关于 before 的 CLS 条目**：基线 15 条 CLS（P2）中，设置面板打开 8 条已全部关闭；基线 sidebar-closed 的 3 条（1024/900/834）在本轮是同一交互触发类别（P2）；1440/1280/1180/1100/1600 是「本轮把 boot CLS 修掉后、只剩交互位移」才越过 0.1 被记录（before 因基线布局差异未记录同类）。`compare.mjs` 将其标记为 introduced/persisting，但**类别相同、级别相同（P2）、无新增 P0/P1**。

**历史说明（修复过程）**：v2 第一版 after 曾在 base/motion/empty 状态复现 boot CLS 0.19–0.34，根因定位为「`<body>` 末尾 boot-state.js 与首帧竞态，`.container` 在首帧后才拿到 sidebar-open」；Lead 随后把 boot 状态改为 `<head>` 同步写 `html[data-sidebar="open|closed"]` + CSS 用该属性让位、删除 `.container` 的 margin/width transition。本轮数据是该修复后的结果：**全部非交互状态 CLS ≤0.0048、motion 样本 CLS=0**。

## 5. 真实 Chrome 功能回归（`audit/after/functional.json`）

12 项通过 / 0 失败 / 1 项标注 skip / **0 console error**：

| 检查 | 结果 | 证据摘要 |
| --- | --- | --- |
| 启动：300 条书签 / 10 页面 / 无错误 | PASS | items=300、pages=10、h1 存在、`data-boot=ready`、8 CSS、1 module script |
| storage key 兼容 | PASS | `bookmarkPages/currentPageId/squares_*/settings/smartSettings/searchEngine` 全在 |
| 侧栏开合 + aria/inert 同步 | PASS | 收起→collapsed/aria-hidden=true/inert/expanded=false；展开→全部恢复 |
| 页面切换数据不丢 | PASS | p1↔p2 后 `squares_p1` 仍 300 条、`currentPageId=p1` |
| 二级分类筛选 | PASS | 浮层 inViewport、筛选「开发」=60 条、清除恢复 300 |
| 设置面板打开/Esc/焦点/inert | PASS | aria-hidden=false、main+sidebar inert、focusInside=true、Esc 关闭 |
| 性能模式开关持久化 | PASS | body.perf-mode 切换 + `smartSettings.perfMode` 落盘 |
| 页面 增/改/删 | PASS | 10→11→重命名「审计页面A」→删除→10 |
| 粘贴 URL 新增书签 | PASS | 弹窗确认后 DOM 300→301，storage `squares_p1` 找到 URL |
| storage 镜像新增（星标同步） | PASS | 写入 storage 后 DOM 300→301，无需 reload |
| 导出→导入配置 | PASS | 下载 JSON（10 页）→ 文件输入导入 → 确认弹窗 → reload 后 10 页/300 条不丢 |
| DOM 卫生 | PASS | 无重复 id、无缺失 `type` 的 button、真实 h1（h=31.19/font=26）、1 个 module script |
| 拖拽排序 | SKIP | 合成 `DragEvent` 不触发 HTML5 原生拖拽（Chrome 行为），建议人工指针拖拽复核；非代码失败 |

## 6. 截图与数据索引

```
audit/after/
├── layout.json                 # 73 样本完整数值证据 + issues + summary（P0=0/P1=0/P2=8）
├── screens/<viewport>/<state>.png   # 73 张截图（与基线同矩阵）
├── perf.json / functional.json / compare.json / compare.md
├── run.log / perf.log / functional.log
docs/LAYOUT-AFTER.md（本文件）
docs/PERF-AFTER.md
```

复跑：`node tools/audit.mjs --ext . --out audit/after --label after`（headless 后台模式，约 4 分钟；工具内置 Chrome 崩溃自动重连重试）。
