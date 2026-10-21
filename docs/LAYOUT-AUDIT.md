# Googlehome 布局审计报告（基线 v1.9 · before）

> 审计对象：v1.9 冻结副本 `audit/baseline-ext`（manifest `version: "1.9"`，git commit `d4edbca`，在重构开始前复制）
> 审计方式：真实 Chrome 155 + CDP（`tools/audit.mjs`），非 jsdom/截图猜测；每一条问题都有 `Runtime.evaluate` 返回的数值证据
> 审计时间：2026-10-22 · 样本：**73 个**（12 档视口 × 状态矩阵）· 截图：`audit/before/screens/`（73 张）· 原始数据：`audit/before/layout.json`
> 汇总：**194 条问题记录（P0 103 / P1 75 / P2 16）**；其中「标题被压扁」与「隐藏按钮可点击」是同一问题在多视口/多状态下的重复记录，去重后为 **7 类问题**（见 §4）。
> 控制台：**73/73 样本 0 error / 0 uncaught / 0 资源加载失败**

---

## 0. TL;DR —— 审计结论 + 根因

**用户说的「页面排版错乱」在实测中可复现，且可精确定位为 4 个 CSS 修复点：**

0. **300 条书签时，标题被 flex 布局压扁成一条细缝（P0，最容易感知）**
   `.container` 是 `display:flex; flex-direction:column; height:100vh; overflow-y:auto`（`ui.css:12-27`），标题是 `.container::before` 伪元素（`ui.css:2155`）→ 成为 column flex 的 flex item，**默认 `flex-shrink:1`**。当 300 条书签让内容高度溢出（1600×900 下 `container.scrollHeight=3848 > 900`）时，伪元素被纵向压缩：
   - 桌面：`::before` 计算高度 **28.59px → 4.64px**（line-height 应 28.6px，font-size 26px）
   - 390×844 移动端：**22px → 1.17px**
   再叠加自身 `overflow:hidden`，标题文字几乎完全不可见（只剩一条 1–5px 的细缝 + 光标点），实测截图中 1600×900 的标题就是「消失」的。空页面（0 条书签）时标题高度正常 28.59px，所以该 bug 只在有书签时暴露。
   **修复（v2）**：标题改为真实 `<h1 class="page-title">` 且 `flex-shrink:0`（或放在滚动容器之外）；after 断言 `title.h ≥ 0.8 × font-size`。

1. **桌面侧栏展开时内容宽度算错（P0，根因）**
   `audit/baseline-ext/src/css/ui.css:3178` 在 `@media (min-width:769px)` 下给 `.container.sidebar-open` 加了 **固定 `padding-left:320px`**；
   而 `ui.css:2320-2321/2331` 又给 `.squares-container` 和 `#squaresContainer` 加了 **固定宽度 `width:min(720px, calc(100vw - 48px)) !important`**。
   于是内容盒可用宽度 = `100vw − 320px − 20px`，在 **769–1060px 视口**下小于 720px，网格被 flex 居中后：
   - 向左 **侵入 300px 侧栏**（侧栏右边界 = 14+286 = 300px）；
   - 向右 **越出视口**（被 `body{overflow:hidden}` 裁切，无法滚动查看）。

   | 视口（侧栏开） | 内容盒宽 | 网格 x / 右边界 | 越出视口 | 与侧栏重叠 | container 内部横向溢出 |
   | --- | --- | --- | --- | --- | --- |
   | 834×1112 | 494px | 207 / **927** | **93px** | 93×831 = **77,293px²**（占网格 13%） | **113px** |
   | 900×800 | 560px | 240 / **960** | **60px** | 60×527 = **31,607px²**（占网格 8%） | **80px** |
   | 1024×768 | 684px | 302 / 1022 | 0 | 0（距侧栏仅 2px） | **18px** |
   | 1100 / 1180 / 1280 / 1440 / 1600 | ≥760px | − | 0 | 0 | 0 |

   注意：**网格本身的列算法没有错**。所有桌面视口都是 6 列、列中心间距恒为 120.33px、列 gap 一致（见 `layout.json → grid.colXStep`）；移动端 390→2 列 / 600→4 列 / 768→6 列。所谓「整列错位」是外层容器宽度算错导致的**整体居中偏移**，修外层即可，不要动 grid 模板。

2. **侧栏宽度三处不一致（P1，根因）**
   同一文件里 `.sidebar` 被写了 3 次宽度：`ui.css:1781` `280px` → `ui.css:2417` `300px` → `ui.css:2593` `286px !important`；移动端 `ui.css:2732` 又限制 `max-width:320px`；而 `.container.sidebar-open` 按 `320px` 预留。实测侧栏 right=300、内容从 320 开始 → **20px 悬空缝隙**；v2 应统一 `--sidebar-w:300px` 并让容器用同一变量计算。

3. **`ui.css` 末尾三层「覆盖式补丁」是排版问题的结构性来源**
   3241 行的 `ui.css` 内含 4 个叠加层：`Premium Dark UI Refresh`（:2085 起）、`Sidebar Layout Polish`（:2588 起）、`Settings Panel Polish`（:2743 起）、以及文件末尾「移动端 z-index/设置滚动/padding-left 修复」。同一选择器被反复覆盖 + 大量 `!important`（如 `.squares-container` 的 `!important` 宽度）导致真实布局由「最后一个补丁」决定，这正是 v2 拆分为 8 个单层 CSS 文件要解决的问题。

**其它已确认问题（P1/P2，非「错乱」但需修）：**

- `ui.css:1945` `.page-action-btn { opacity: 0 }`：hover 才显示的操作按钮**不可见但仍可点击**——53/73 个样本中 `elementFromPoint(按钮中心)` 命中按钮自身，用户会误触重命名/删除。
- `ui.css:2289` 搜索下拉固定 `width:210px` + `left:50%; translateX(-50%)`：移动端 4 档视口全部 **x=-60，左侧被裁 60px**。
- 设置面板打开时 `aria-hidden` 仍为 `"true"`（v1.9 的 `main.js` 完全不更新 aria），且背景没有 `inert` → 屏幕阅读器读不到设置内容；`#sidebarTrigger` 的 `aria-expanded` 也始终是 HTML 里的初值。
- CLS 实测来源**不是**标题打字动画（见 §5）：设置面板用 `right`、侧栏开合用 `padding-left` 做过渡，每帧触发 layout；标题伪元素宽度动画本身 CLS≈0（flex 居中项宽度变化不移动其它元素），但有持续的单行回流成本、文本不可选中/复制（v2 改真实 `<h1>` 正确）。
- z-index 魔法数字散落：`flyout:10050`（`ui.css:2972`）、dropdown/settings/dialog `1000`、搜索容器 `200`、侧栏 `99`；移动端末尾补丁再改成 `250/300/310`（实测工作正常，但后续任何新增层都会再次错乱）。

---

## 1. 审计环境与可复现方法

| 项目 | 值 |
| --- | --- |
| 浏览器 | Google Chrome **155.0.8059.85**（headed，CDP `--remote-debugging-port=0`，flatten session） |
| 扩展 | 未打包加载 `audit/baseline-ext`（v1.9 冻结副本，`Extensions.loadUnpacked`） |
| 扩展 ID | `aebmgfcbjfeapbcnhaodakohikgaddec`（每次全新 profile 可能变化，脚本自动发现） |
| 运行环境 | macOS · Node 24.21.0（标准库 fetch/WebSocket，无第三方依赖） |
| 数据种子 | 10 页；当前页 `p1` **300 条**书签、`p2–p9` 各 50 条、`p10` **空页面**；每页 4 个二级分类；URL/标题确定（`p<N>-site<M>.example.com`） |
| 布局审计动效 | `prefers-reduced-motion: reduce` 仿真（消除过渡被窗口遮挡节流造成的非确定性；v2 也要求 reduced-motion 降级）；另有 1 个 `desktop-motion-title` 正常动效样本专测标题动画/CLS |
| 截图 | `Page.captureScreenshot`（视口截图，PNG，deviceScaleFactor=1） |
| 断言方式 | 页面内 `Runtime.evaluate` 返回：`getBoundingClientRect`、`scrollWidth/clientWidth`、`elementFromPoint` 命中、`getComputedStyle` z-index/opacity、`PerformanceObserver`（layout-shift/longtask）等数值，Node 侧规则判级 |

**一键复跑：**

```bash
# before（重构前，已归档）
node tools/audit.mjs --ext audit/baseline-ext --out audit/before --label before
node tools/perf-audit.mjs --ext audit/baseline-ext --out audit/before/perf.json --label before

# after（重构后对 src/ 原样复跑；输出 audit/after/）
node tools/audit.mjs --ext . --out audit/after --label after
node tools/perf-audit.mjs --ext . --out audit/after/perf.json --label after

# 前后对比（生成 audit/after/compare.json + compare.md）
node tools/compare.mjs --before audit/before --after audit/after

# 子集快速验证（例如只跑 3 档视口 × 2 状态）
node tools/audit.mjs --ext . --out audit/after-smoke --label after \
  --viewports 1600x900,1024x768,390x844 --states desktop-base-open,mobile-base
```

## 2. 状态矩阵（每个视口）

| 视口 | 类型 | 状态 |
| --- | --- | --- |
| 1600×900 / 1440×900 / 1280×800 / 1180×800 / 1100×800 / 1024×768 / 900×800 / 834×1112 | 桌面（>768px） | base（侧栏展开 + 300 条）/ sidebar-closed / settings-open / search-dropdown / flyout（二级分类浮层）/ filtered（筛选「开发」60 条）/ empty-page（0 条） |
| 768×1024 / 600×900 / 430×932 / 390×844 | 移动（≤768px） | mobile-base（抽屉关）/ drawer-open / settings-open / search-dropdown |
| 1600×900 | 桌面 | + `desktop-motion-title`（正常动效，标题动画/CLS 证据） |

## 3. 问题总览（按视口）

| 视口 | 样本数 | P0 | P1 | P2 | 主要问题类别 |
| --- | --- | --- | --- | --- | --- |
| 1600×900 | 8 | 6 | 7 | 1 | 标题被压扁×6；隐藏按钮可点击×7；标题宽度动画×1 |
| 1440×900 | 7 | 5 | 6 | 1 | 标题被压扁×5；隐藏按钮可点击×6；CLS×1 |
| 1280×800 | 7 | 5 | 6 | 1 | 标题被压扁×5；隐藏按钮可点击×6；CLS×1 |
| 1180×800 | 7 | 5 | 6 | 1 | 标题被压扁×5；隐藏按钮可点击×6；CLS×1 |
| 1100×800 | 7 | 5 | 6 | 1 | 标题被压扁×5；隐藏按钮可点击×6；CLS×1 |
| **1024×768** | 7 | 6 | 12 | 2 | 标题被压扁×6；**横向溢出×6**；隐藏按钮×6；CLS×2 |
| **900×800** | 7 | **28** | 12 | 3 | **网格越界×5、侧栏重叠×6、越出视口×6、点击穿透×5**；标题被压扁×6；横向溢出×6；隐藏按钮×6；CLS×3 |
| **834×1112** | 7 | **27** | 12 | 2 | 同上（越界 93px / 重叠 77,293px²；标题被压扁×5） |
| 768×1024 | 4 | 4 | 2 | 1 | 标题被压扁×4；隐藏按钮×1；**搜索下拉越界×1**；CLS×1 |
| 600×900 | 4 | 4 | 2 | 1 | 标题被压扁×4；隐藏按钮×1；搜索下拉越界×1；CLS×1 |
| 430×932 | 4 | 4 | 2 | 1 | 标题被压扁×4；隐藏按钮×1；搜索下拉越界×1；CLS×1 |
| 390×844 | 4 | 4 | 2 | 1 | 标题被压扁×4；隐藏按钮×1；搜索下拉越界×1；CLS×1 |

合计：**194 条问题记录（P0 103 / P1 75 / P2 16）**。P0 中 59 条是「标题被压扁」、P1 中 53 条是「隐藏按钮可点击」，均为同一问题在各视口/状态的重复记录；**去重后共 7 类真问题**：P0 × 5 类（标题压扁 / 网格越界 / 侧栏重叠 / 点击穿透 / 空状态越界）、P1 × 3 类（隐藏按钮 / 横向溢出 / 下拉越界）、P2 × 2 类（CLS / 标题宽度动画）；另含 a11y 问题 1 类（aria-hidden 不更新）。

## 4. 问题清单

### P0 —— 排版错乱（必须清零）

**P0-1 桌面侧栏展开 + 769–1060px：网格整体越出视口右侧（被裁切）**
- 视口/状态：834×1112、900×800 的全部「侧栏展开」状态（base / settings / dropdown / flyout / filtered / empty）
- 现象：网格右半部分被视口右缘裁掉，第 4–6 列方块不可见；`body{overflow:hidden}` 导致无法横向滚动查看
- 期望：任何视口下 `.container` 内容不得横向溢出，网格必须在内容区内居中
- 数值证据：
  - 834：`.squares-container` `rect=(207, 260.89, 720×831.11)`，右边界 **927 > innerWidth 834**；网格项最大右边界 **895.83**；`container.scrollWidth−clientWidth = 113`
  - 900：`rect=(240, 253.21, 720×526.79)`，右边界 **960 > innerWidth 900**；网格项最大右边界 **928.83**；`container.scrollWidth−clientWidth = 80`
- 截图：`../audit/before/screens/834x1112/desktop-base-open.png`、`../audit/before/screens/900x800/desktop-base-open.png`
- 对应 v2 修复：`ARCHITECTURE.md §5.1` `.container.sidebar-open` 改 margin-left+width；内部块 `width:100%; max-width:min(720px,100%)`

**P0-2 网格与侧栏重叠（方块被侧栏盖住）**
- 视口/状态：同上（834/900 侧栏展开的全部状态）
- 数值证据：834 侧栏 `rect=(14,14,286×1084)` 与网格重叠 **93×831.11 = 77,293px²（占网格面积 13%）**；900 重叠 **60×526.79 = 31,607px²（8%）**
- 期望：桌面侧栏展开时内容整体右移（不与侧栏重叠）
- 截图：`../audit/before/screens/834x1112/desktop-base-open.png`

**P0-3 方块中心点击命中侧栏/页面项（点击穿透/被遮挡）**
- 视口/状态：834/900 的 base/settings/dropdown/flyout/filtered
- 现象：网格左列方块的中心点 `elementFromPoint` 返回 `.sidebar` / `.bookmark-page-item` / `.page-name`，点击会切换页面或激活侧栏而不是打开书签
- 数值证据：834 样本 **10/36**、900 样本 **10/24** 采样点未命中自身方块（举例：`i=0` 命中 `div.bookmark-page-item`、`i=6` 命中 `div.page-actions`）
- 期望：每个可见方块中心点 `elementFromPoint` 命中自身
- 截图：`../audit/before/screens/900x800/desktop-flyout.png`

**P0-4 空页面提示在 834/900 同样越界**
- 现象：`.empty-state` 居中后 rect.right=952（900）/ 952（834）> innerWidth
- 期望：空状态整体在视口内 —— 与 P0-1 同根因，修复外层宽度即消失

**P0-5 300 条书签时标题被 flex 纵向压扁（全视口，最容易感知的「排版错乱」）**
- 视口/状态：所有「有书签」样本（桌面 base / sidebar-closed / settings / dropdown / flyout；移动端 4 状态），过滤 60 条时部分视口仍复现
- 现象：标题文字几乎不可见，只剩 1–5px 高的细缝 + 光标点（见 1600×900 base 截图顶部）
- 数值证据：
  - 1600×900（300 条）：`.container::before` computed `height=4.64px`，`font-size=26px`、`line-height=28.6px`；空页面时为 `28.59px`（正常）
  - 390×844（300 条）：`height=1.17px`，`font-size=20px`、`line-height=22px`
  - 根因：`.container` 为 `column flex`（`ui.css:12-27`）+ `overflow-y:auto`；`.container::before` 是 flex item 且默认 `flex-shrink:1`，内容溢出时被压扁；伪元素自身 `overflow:hidden` 裁掉文字
- 期望（v2）：真实 `<h1 class="page-title">` 且 `flex-shrink:0`；`title.h ≥ 0.8 × fontSize`
- 截图：`../audit/before/screens/1600x900/desktop-base-open.png`（标题区约 y=110 几乎空白）、`../audit/before/screens/390x844/mobile-base.png`

### P1 —— 体验/可用性

**P1-1 页面操作按钮 `opacity:0` 时仍可点击（53/73 样本复现，全视口）**
- 证据：`.page-action-btn`（重命名/删除）hover 才显示，但默认 `opacity:0` 且 `pointer-events` 为 auto；`elementFromPoint` 在按钮中心命中自身。误触删除会直接弹确认/执行，风险高
- 期望（v2）：不可见时 `visibility:hidden` + `pointer-events:none`，`hover`/`focus-within` 时恢复
- 相关 CSS：`audit/baseline-ext/src/css/ui.css:1945`（`.page-action-btn`）+ `:1961`（hover 显示）
- 截图（侧栏页面项）：任一桌面截图左下侧栏

**P1-2 横向溢出（container 内部），1024×768 也中招**
- 视口：1024/900/834（侧栏展开状态）
- 证据：`container.scrollWidth−clientWidth` = **18 / 80 / 113px**（1024 时网格 x=302 距侧栏右边界 300 仅 2px，并侵入容器 20px 右内边距，末列贴边）
- 期望：`container` 无内部横向溢出；`documentElement.scrollWidth === innerWidth`
- 截图：`../audit/before/screens/1024x768/desktop-base-open.png`

**P1-3 移动端搜索下拉左侧被裁 60px（768/600/430/390 全部）**
- 证据：`.search-select-dropdown` `rect=(-60, 156.67, 210×338)`，`innerWidth=390`；`left:50% + translateX(-50%)` 以 42px 圆形按钮为中心，在窄屏必然越左边界
- 期望：浮层 clamp 到视口（`visualViewport`），左右各留 8px
- 相关 CSS：`audit/baseline-ext/src/css/ui.css:2289`（width:210px）、`:2299`（z-index）
- 截图：`../audit/before/screens/390x844/mobile-search-dropdown.png`

**P1-4 设置面板打开时 `aria-hidden="true"` 未更新，背景无 inert（a11y）**
- 证据：`#settingsPanel` 打开（`.active`）后 `aria-hidden` 仍为 `"true"`；`.container` `inert = null`；`#sidebar` 无 `aria-hidden`；`#sidebarTrigger` 的 `aria-expanded` 从 HTML 初值后再未更新（v1.9 JS 中无任何 aria 赋值）
- 期望（v2）：打开时 `aria-hidden=false` + 背景 `inert` + 焦点进入面板 + Esc 关闭
- 截图：`../audit/before/screens/1600x900/desktop-settings-open.png`

**P1-5 移动端抽屉与设置面板：焦点/扫码顺序（a11y，与 P1-4 同源）**
- 抽屉打开时无 `aria-hidden` 更新、无焦点陷阱；触发按钮 `display:none` 后焦点可能丢失（v2 规格 §4 已覆盖）

### P2 —— 细节/性能

**P2-1 交互触发的 CLS：用 layout 属性做过渡**
- 证据：`desktop-settings-open` CLS 0.11–0.78（`sources: settingsPanel`），`sidebar-closed` CLS 0.12–0.19（`sources: squaresContainer/search-container`）；根因是 `.settings-panel { transition: right … }`（`ui.css:1307/2758`）与 `.container { transition: padding-left … }`（`ui.css:3174`）每次过渡都引发 layout
- 说明：合成 click 不算 user input，真实用户点击时 CLS 会被 `hadRecentInput` 排除；但 300 个方块每帧重排的回流成本真实存在，v2 应使用 `transform`/`translateX` 过渡 + 内容区 `layout` 属性不变
- 截图：`../audit/before/screens/768x1024/mobile-settings-open.png`（CLS=0.78）

**P2-2 标题是 `.container::before` 伪元素 + 宽度打字动画**
- 证据：`ui.css:2155-2179` `animation: premiumTitleTyping 1.9s steps(31) forwards`，逐帧改 `width`；`desktop-motion-title` 样本采样时宽度 **66.74px**（最终 355.63px）。CLS 实测≈0，但持续触发行回流、文本不可选中/复制/被读屏识别
- 期望（v2）：真实 `<h1 class="page-title">`，用 opacity/translate 做入场，无宽度动画
- 截图：`../audit/before/screens/1600x900/desktop-motion-title.png`

**P2-3 z-index 魔法数字**
- `ui.css:2972` flyout `z-index:10050`；dropdown/settings/dialog `1000`；搜索容器 `200`；侧栏 `99`；移动端补丁 `250/300/310`。实测当前层叠顺序正确（移动抽屉 overlay 250 / 抽屉 300 / 搜索 1；桌面搜索 200 > 侧栏 99 但二者不重叠），但无 tokens 体系，任何新增层都可能再次错乱
- 期望（v2）：`--z-content/flyout/overlay/sidebar/trigger/settings/menu` 令牌

**P2-4 侧栏宽度三处不一致（见 §0.2）**：280/300/286 + 容器固定 320 → 20px 缝隙；移动端 320 上限

## 5. 明确排除的「误报」（审计规则已过滤，避免重构时误修）

| 现象 | 判定 | 依据 |
| --- | --- | --- |
| `.square-title`（hover tooltip）ellipsis 截断 | 设计如此，不计入问题 | 固定 `max-width:76px` + `text-overflow:ellipsis`，只做 tooltip |
| 移动端抽屉打开时与搜索/网格/标题「重叠」 | 抽屉是覆盖式浮层，设计如此 | 断言改为检查 z-index 顺序（实测 search 1 < sidebar 300）与遮罩可见（overlay z=250、opacity=1、visibility=visible） |
| 设置面板/侧栏关闭时其内部文本「越出视口」 | 关闭态在屏幕外，非问题 | 过滤 `closest('[aria-hidden="true"],[inert]')` 且 rect 不在视口内的元素；关闭态面板 rect.x=1200+（1600 视口） |
| 打开的下拉/设置/浮层盖住网格 | 模态覆盖，设计如此 | `elementFromPoint` 命中被遮挡元素时，若遮挡者在 `#settingsPanel/.search-select-dropdown/.page-subfolder-flyout/.context-menu` 内则不计点击穿透 |
| 页面切换/筛选时的淡入动画 | 动效，非布局 | 布局审计统一 reduced-motion；单独 motion 样本只测标题动画/CLS |

## 6. 与 v2 修复规格的对应关系（给 css-architect / ui-dev 的清单）

| 审计问题 | ARCHITECTURE.md 修复项 | 验收断言（after 必须 0） |
| --- | --- | --- |
| P0-1/P0-2/P0-3/P1-2/P0-4 | §5.1 `.container.sidebar-open` margin-left+width；内部块 `width:100%;max-width:min(720px,100%)` | `doc.overflowX=false`、`container.innerOverflowX=0`、`squares.right ≤ innerWidth`、`sidebar∩squares` 无重叠、`hitTests` 无 miss |
| P0-5 标题被压扁 | §4 真实 `<h1 class="page-title">` + flex-shrink:0 | `TITLE-SQUEEZED` 0 条（`title.h ≥ 0.8 × fontSize`） |
| 侧栏宽度 320/300/286/280 | §5.2 统一 `--sidebar-w:300px`，`--trigger-size:46px` | `sidebar.right + gutter == container content 左边界`，间距 16–24px |
| P1-1 | 未在规格中，需 ui-dev 改：`pointer-events:none`/`visibility:hidden` | `pageActionProbes` 中 `hitSelf=false`（不可见时） |
| P1-3 | §5.5 浮层 clamp 到 `visualViewport` | `dropdownInfo.withinViewport=true`（所有视口） |
| P1-4 | §4 aria/inert + §5.4 设置面板 | `settings aria-hidden=false`、背景 `inert=true`、Esc 可关 |
| P2-1 | §5.7/§5.8 移动端层级 + 性能 | `settings/drawer` 过渡不再用 layout 属性（人工复核），after CLS 交互态 <0.1 |
| P2-2 | §5.6 h1 替代伪元素，透明度/位移动画 | `h1.page-title` 存在、`titleAnimating=false`、motion 样本 CLS <0.1 |
| P2-3 | §5.8 z-index tokens | `zIndexes` 全部来自 token（人工复核），移动 drawer 顺序不变 |

## 7. 产物索引

```
audit/before/
├── layout.json                 # 73 个样本的完整数值证据 + issues + summary
├── perf.json                   # 性能基线（另见 docs/PERF-BASELINE.md）
├── run.log / perf.log          # 运行日志（含每个样本耗时/问题计数）
└── screens/<viewport>/<state>.png   # 73 张截图（如 834x1112/desktop-base-open.png）
tools/
├── audit.mjs                   # 布局审计（--ext/--out/--label/--viewports/--states）
├── perf-audit.mjs              # 性能基线（--ext/--out/--label/--repeats）
├── compare.mjs                 # before/after 对比 → compare.json + compare.md
├── cdp.mjs                     # CDP 客户端 + Chrome 启动/扩展加载
├── measure.mjs                 # 页面内测量函数 + 首帧/CLS/长任务 init script
├── seed-data.mjs               # 确定性种子数据
└── re-derive.mjs               # 不重跑浏览器、按最新规则重算 issues
```

**关键 JSON 字段（after 对比会用到）：**
`metrics.doc.overflowX`、`metrics.container.innerOverflowX`、`metrics.els.{sidebar,search,squares,settings}.{x,right,w}`、`metrics.grid.{columns,colXValues,colXStep,colGaps,minItemX,maxItemRight}`、`metrics.hitTests[].hitSelf`、`metrics.pageActionProbes[]`、`metrics.clSamples.value`、`metrics.els.title`、`metrics.settingsInfo`、`console.errors/warns`。

---

## 附：本次审计中发现的「非布局但同源」系统性因素

- `ui.css` 3241 行、4 层追加覆盖（见 §0.3）；`main.js` + `utils/*` + `components/*` 14 个全局 `<script>` 顺序依赖；`window.saveData`（从 DOM 读回 300 条再写 storage）等结构性问题使性能与排版互相牵连 —— 这些由 v2 架构（单层 CSS / ESM / store 单一数据源）统一解决，性能量化见 `docs/PERF-BASELINE.md`。

---

> **重构后验收：** v2.0 的修复与前后对比见 `docs/LAYOUT-AFTER.md`（73 样本 P0=0/P1=0，仅 8 条交互触发 P2 CLS）与 `docs/PERF-AFTER.md`。
