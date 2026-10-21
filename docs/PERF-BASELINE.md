# Googlehome 性能基线（v1.9 · before）

> 审计对象：v1.9 冻结副本 `audit/baseline-ext`（重构开始前复制）· 真实 Chrome 155 + CDP（`tools/perf-audit.mjs`）
> 数据规模：**10 个页面，当前页 300 条书签，其余 8 页各 50 条、1 页空**；视口 1600×900（与架构 v2 性能预算同口径）
> 原始数据：`audit/before/perf.json`（确定性 JSON，after 直接同结构对比）· 运行日志：`audit/before/perf.log`
> 运行时间：2026-10-22 · 总耗时 45.2s

---

## 0. TL;DR —— 基线数字与 v2 预算的差距

| 指标 | 基线测量值（median） | v2 预算（ARCHITECTURE §6） | 结论 |
| --- | --- | --- | --- |
| 首屏 → 首个书签方块出现在 DOM | **642ms**（冷启动 642 / warm 630–1312） | < 120ms | **超预算 5.3×**（含页面加载，见 §2 口径说明） |
| DOMContentLoaded | **388ms** | — | 13 个阻塞 `<script>` 顺序加载 |
| FCP | **752ms**（runs: 752 / 1116 / 304） | — | 首屏有约 0.4–0.7s 空白 |
| 页面切换 → 新页首项出现在 DOM | **28.6ms**（runs: 196 / 21 / 29） | < 120ms | 中位数达标，但出现 **196ms 离群值**（见 §4 原因） |
| 单条书签更新（storage 写入 → DOM 出现） | **65.3ms**（runs: 65 / 128 / 34） | < 50ms | **超预算**，且波动 4× |
| 滚动 2s：rAF 帧间隔 p95 / max | **171.5ms / 223.5ms**（52 帧；avg 55.7ms） | 无 >50ms 长任务 | 环境受限（见 §5），但有 **1 个 96ms 长任务**、19 帧 >50ms |
| 首屏长任务 | 0–1 个（warm 样本 1 个） | 无 | 基线基本无长任务 |
| CLS（首屏） | **0.025–0.028** | < 0.1 | 首屏达标（详见 `docs/LAYOUT-AUDIT.md`：交互态 CLS 0.11–0.78 来自 settings/sidebar 的 layout 过渡） |
| DOM 节点数 | **1,199**（首屏 300 方块）/ 1,208（+3 条更新后） | 下降 | 300 方块 × 4 节点 ≈ 1,200 |
| 文档 HTML（序列化后） | **205.5 KB** | 下降 | 300 方块 + 侧栏 |
| CSS | **1 个文件 / 3,241 行 / 385 条顶层规则** | 拆分 8 层、≤2400 行、无重复覆盖 | |
| `<script>` 标签 | **13 个全局脚本**（无 module） | 1 个 `<script type="module">` | |

**结论：** v1.9 的瓶颈首先在**首屏串行加载 + 300 方块全量 DOM 构建**（DOMContentLoaded 388ms、FCP 752ms、首项 642ms）；其次是**单条更新与页面切换的"读回 DOM"路径**（`window.saveData()` 把 300 条 DOM 读回再写 storage，`chrome.storage.onChanged` 里 O(n) 读 DOM 比对），导致更新/切换出现 65–196ms 的离群值。v2 的「单一数据源 + 按区域增量渲染 + ESM 单入口」直接针对这两点。

## 1. 测试方法（可复现）

```bash
# v1.9 基线（已归档）
node tools/perf-audit.mjs --ext audit/baseline-ext --out audit/before/perf.json --label before

# 重构后（对 src/ 原样复跑，同参数、同数据、同视口）
node tools/perf-audit.mjs --ext . --out audit/after/perf.json --label after

# 前后对比（输出 audit/after/compare.json + compare.md 表格）
node tools/compare.mjs --before audit/before --after audit/after
```

测点实现（`tools/perf-audit.mjs`）：

1. **首屏**：`Page.addScriptToEvaluateOnNewDocument` 注入 init script，记录 `window.__PERF.t0`、`MutationObserver` 首次出现 `.square-list-item` / `.square-container` 的 `performance.now()`、navigation timing、paint entries、首屏长任务（`PerformanceObserver{longtask}`）、CLS；重复 reload 3 次取 median + 冷/热样本。
2. **页面切换**：页面内 `getBoundingClientRect` 无关——先记录 `performance.now()`，`click()` 侧栏第 2 个页面，`MutationObserver` 等待新页面首项（URL 前缀 `p2-`）出现，返回耗时；重复 3 次。
3. **单条更新**：`chrome.storage.local.set('squares_p1', [...old, newItem])` 模拟浏览器星标镜像，`MutationObserver` 等待该 URL 的 `.square-container[data-url]` 出现；重复 3 次。
4. **滚动**：`Page.startScreencast` 不可用场景下，用 CDP `Input.dispatchMouseEvent(mouseWheel)` 在 2s 内批量派发 89 次滚轮（每次 deltaY=42），页面内 rAF 采集帧间隔；同时用 `Performance.getMetrics` 前后差值记录主线程 `TaskDuration / LayoutDuration / RecalcStyleDuration / ScriptDuration / LayoutCount`。
5. **规模指标**：DOM 节点数、序列化 HTML 字节数、样式表/规则数、`<script>` 标签数、`Performance.getMetrics`（Nodes/JSHeapUsedSize/LayoutCount）。

**环境说明（重要）**：CI 环境无物理显示器，布局审计用 headed Chrome（窗口可能被遮挡导致动画节流），性能审计用 **`--headless=new --disable-frame-rate-limit`**（无 vsync，rAF 不受 60Hz 垂直同步约束，帧间隔绝对值偏大且受本机并发负载影响；baseline 采集期间有其它构建/测试进程并发）。因此：

- **绝对帧率数字仅作横向参考**（before/after 用同一 harness，同机同时段）；
- 判断 v2 是否达标应看 **相对降幅 + 长任务数/CDP TaskDuration + 存储与 DOM 规模**；
- 首屏 `firstItemMs` 口径 = `navigationStart → 首个书签方块出现在 DOM`，包含页面加载；v2 若在 `main.js` 打 `boot:start/render:first` 标记，compare 工具会同时给出（未来可扩展读取 `performance.getEntriesByName`）。

## 2. 首屏（3 次 reload 原始值）

| run | 首个方块出现在 DOM | DOMContentLoaded | load | FCP | 首屏长任务 | CLS | DOM 节点 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| #1（冷） | **642.0ms** | 387.8ms | 457.6ms | 752.0ms | 0 | 0.0252 | 1,199 |
| #2（warm，受并发负载） | 1,311.9ms | 871.1ms | 911.4ms | 1,116.0ms | 1 | 0.0276 | 1,199 |
| #3（warm） | 629.9ms | 326.8ms | 565.3ms | 304.0ms | 0 | 0.0252 | 1,199 |
| **median** | **642.0ms** | **387.8ms** | **565.3ms** | — | 0–1 | 0.025 | 1,199 |

关键点：

- 首屏 13 个阻塞 `<script>`（`index.html:177-201`，config→utils→storage→settings-manager→page-manager→animation→drag→squares→search→config-manager→smart-settings→main→paste）串行执行 → DOMContentLoaded 388ms。
- 首个方块出现在 DOM 又比 DCL 晚 **~250ms**：page-manager `init()` 是异步链（`chrome.storage.local.get` × N → renderPages → loadPageBookmarks → 创建 300 个 DOM 节点），期间无首屏占位。
- 300 个方块 ≈ 1,199 DOM 节点、序列化 HTML 205KB。

## 3. 单条更新（模拟浏览器星标镜像）

| run | 写入前条数 | 写入后 DOM 条数 | storage.set → DOM 出现 |
| --- | --- | --- | --- |
| #1 | 300 | 301 | 65.3ms |
| #2 | 301 | 302 | 128.3ms |
| #3 | 302 | 303 | 34.4ms |
| **median** | — | — | **65.3ms**（预算 50ms，超 30%） |

原因（代码证据，v1.9 冻结副本）：

- `src/js/utils/page-manager.js:100-116`：`chrome.storage.onChanged` 对当前页每次变化都 `Array.from(document.querySelectorAll('.square-container')).map(...)` **读回 300 条 DOM 再逐条比较**，复杂度 O(n)，且随后可能走 `loadPageBookmarks` 全量重建。
- 单条更新还伴随 favicon 取图（`_favicon`）与 `saveData` 的 DOM 读回路径，更新延迟随列表长度线性增长。
- v2 目标：store 内 diff → 只新增 1 个节点（< 50ms），且任何路径都不再读 DOM 作为数据源。

## 4. 页面切换（p1 300 条 → p2 50 条）

| run | 目标页 | 新页首项出现 |
| --- | --- | --- |
| #1 | p2 | **196.3ms**（离群） |
| #2 | p2 | 21.2ms |
| #3 | p2 | 28.6ms |
| **median** | — | **28.6ms** |

离群值原因（代码证据）：`page-manager.js:232-239` `switchPage()` 切换前执行 `await window.saveData()` —— v1.9 `main.js` 的 `saveData` 从 DOM 读回 300 条书签再写 `chrome.storage.local`；列表越长越慢，且与 storage 写入队列竞争，导致切换偶发 196ms。

## 5. 滚动（1600×900，300 条，连续滚轮 2s）

| 指标 | 值 |
| --- | --- |
| 采集帧数 / 帧间隔样本 | 52 帧 |
| 平均帧间隔 | **55.66ms** |
| p95 帧间隔 | **171.5ms** |
| 最大帧间隔 | **223.5ms** |
| >33ms 帧数 / >50ms 帧数 | 28 / 19 |
| 滚动期间长任务 | **1 个（96ms）** |
| 滚动距离 | scrollTop 0 → 1764 / scrollHeight 3920 |
| CDP 主线程增量（2s 内） | TaskDuration **0.68s**、RecalcStyleCount 52、LayoutCount 0、ScriptDuration 0 |
| 空载 rAF 基线（1s） | 42 帧，avg **25.65ms**，p95 62.4ms |

说明：空载 rAF 已只有 ~39fps（环境无 vsync + 并发负载），滚动帧间隔在此基础上进一步劣化（avg 55.7ms）。其中 **1 个 96ms 长任务**与 19 帧 >50ms 是值得 v2 消除的真实信号（v1.9 滚动时仍有 `premiumTitleCaret` 无限循环动画、`.square-container:hover` 的 transform 合成层、以及每次 storage 变化 O(n) DOM 读取）。v2 的验收：滚动无 >50ms 长任务、无每帧 rAF JS。

## 6. 运行时规模指标

| 指标 | 基线 |
| --- | --- |
| DOM 节点数 | 1,199（300 方块）/ 1,208（303 方块） |
| 序列化文档 HTML | 205,548 B（首屏）/ 207,342 B |
| JS Heap Used（CDP Performance） | ~1.19 MB（`Performance.getMetrics`） |
| CSS | 1 个 `<link>`、3,241 行、385 条顶层规则、`ui.css` 内含 4 层追加覆盖 |
| `<script>` | 13 个（无 `type="module"`，依赖全局顺序） |
| 扩展页面加载（reload，transferSize） | 10,129 B（不含 favicon 请求） |

## 7. 已知测量噪声与判定口径（after 对比时同样适用）

1. 本机无显示器 + 并发负载 → rAF 帧间隔绝对值偏大；**before/after 同 harness 才可比**。
2. `firstItemMs` 含页面加载，不等于"JS boot→首渲染"；v2 若打 `boot:start / render:first` 标记，可在 after 报告补充该口径数值（v2 预算 120ms 应对应该口径）。
3. 页面切换/单条更新各 3 次取 median；离群值同时保留在 `runs` 里，不隐藏。
4. 布局审计（headed）与性能审计（headless）环境不同，两者数字不要混用；布局见 `docs/LAYOUT-AUDIT.md`。
5. after 复跑命令、对比表格由 `tools/compare.mjs` 自动生成（会给出每个指标的 before/after/变化%）。

## 8. 对照 v2 性能预算的验收清单

| 验收项 | 基线 | after 判定 |
| --- | --- | --- |
| 首屏首渲染（boot→first render） | 642ms（含加载） / ~250ms（DCL→首项） | v2 标记口径 < 120ms |
| 页面切换 | median 28.6ms（离群 196ms） | median < 120ms 且无 >120ms 离群 |
| 单条星标 → DOM | median 65.3ms | < 50ms |
| 滚动长任务 | 1 个 96ms；19 帧 >50ms | 0 个 >50ms 长任务 |
| 重复渲染相同状态 DOM 不变 / 计数只改文本 | 未实现（v1.9 读 DOM） | DOM 节点数不变、sidebar 不重建 |
| 无每帧 JS 动画/rAF 循环 | 标题 CSS 动画逐帧 width；无 rAF 循环 | 无 rAF 循环、无 width 动画 |
| DOM / 文档规模 | 1,199 节点 / 205KB / 3,241 行 CSS / 13 scripts | 节点数下降、CSS ≤~2400 行、1 module script |
