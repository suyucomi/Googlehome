# Googlehome 性能基线对比（v2.0 · after）

> 审计对象：`src/`（manifest 2.0，ESM 单入口 + 8 层 CSS）· 真实 Chrome 155（**headless=new** 后台模式）+ CDP（`tools/perf-audit.mjs`）
> 数据规模与基线完全一致：**10 个页面，当前页 300 条书签，其余 8 页各 50 条、1 页空**；视口 1600×900
> 原始数据：`audit/after/perf.json`（与 `audit/before/perf.json` 同结构）· 对比表：`audit/after/compare.md` / `compare.json`
> 说明：本轮 perf 采集时**本机没有其它 Chrome 实例**（采集前已确认并清理残留探针；采集期间未运行其它浏览器任务）。CLS 一栏以最后一次布局全量审计（boot 修复后）为准，见 §6。

---

## 0. TL;DR —— 三项预算达标、首屏仍超预算（唯一未达标项）

| 指标 | before（v1.9） | after（v2.0） | 变化 | v2 预算 | 判定 |
| --- | --- | --- | --- | --- | --- |
| **单条书签更新 → DOM 出现** | 65.3ms | **23.3ms** | **-64.3%** | < 50ms | ✅ 达标 |
| **页面切换 → 新页首项** | 28.6ms（但含 196ms 离群） | **67.8ms**（58/101/68） | 中位数 +137%，但无 >120ms 离群 | < 120ms | ✅ 达标 |
| **滚动 2s：long task 数 / >50ms 帧** | 1 个（96ms）/ 19 帧 | **0 个 / 2 帧** | -100% / -89% | 无 >50ms 长任务 | ✅ 达标 |
| **滚动 rAF p95 帧间隔** | 171.5ms | **18.9ms** | **-89.0%** | < 33ms | ✅ 达标 |
| **CLS（非交互：boot / 首屏 / 设置打开）** | 0.025（首屏）| **≤0.0048**（boot）/ **0**（motion） | — | < 0.1 | ✅ 达标 |
| **首屏：boot:start → render:first** | 无该埋点（DCL→首项 ≈254ms） | **231.7ms**（153/232/279） | — | < 120ms | ❌ 未达标（1.93×） |
| 首屏首个方块出现在 DOM | 642ms | **483.6ms** | -24.7% | — | 改善但含页面加载 |
| DOMContentLoaded | 387.8ms | **252.1ms** | -35.0% | — | 改善 |
| load | 565.3ms | **252.2ms** | -55.4% | — | 改善 |
| DOM 节点数 | 1,208 | 1,225 | +1.4% | 下降 | 基本持平（结构更规范） |
| JS 事件监听器数 | 202 | **51** | **-74.8%** | 下降 | 显著改善 |
| LayoutObjects | 4,626 | **2,230** | **-51.8%** | 下降 | 显著改善 |
| CSS 规则数 / `<script>` 标签 | 385 / 13 | **231 / 2** | -40% / -84.6% | 下降 | 显著改善 |
| JS Heap（CDP） | ~1.19MB | ~1.43MB | +20% | — | 需观察（见 §7） |

**结论：v2 的「单一数据源 + 增量渲染 + ESM」在单条更新（-64%）、滚动（长任务归零、p95 -89%）、监听器/布局对象（-75%/-52%）、脚本/规则规模（-85%/-40%）上收益明确；页面切换中位数变慢但方差大幅收敛（无 196ms 离群）且远低于 120ms 预算。唯一没达标的是首屏 boot→首渲染 232ms（预算 120ms），成本主要在 ESM 模块图 + `store.init()` 的 storage 往返 + 300 个方块全量 DOM 构建，属于 v2.1 优化项，不是本次重构的回归。**

## 1. 性能对比明细（同 harness、同数据、同视口）

| 指标 | before | after | 变化 |
| --- | --- | --- | --- |
| 首屏首个书签项（DOM 出现，3 次 median） | 642ms | **483.6ms** | -24.7% |
| run 明细 | 642 / 1311.9 / 629.9 | 342 / 483.6 / 550.8 | 方差仍大（headless 环境） |
| DOMContentLoaded（median） | 387.8ms | **252.1ms** | -35.0% |
| load（median） | 565.3ms | **252.2ms** | -55.4% |
| 首屏首次绘制（FCP，三次） | 752 / 1116 / 304ms | **264 / 308 / 320ms** | 冷启动显著改善 |
| `boot:start → render:first` | 无埋点 | **153.1 / 231.7 / 279.4ms** | v2 新增的精确口径 |
| 首屏长任务 | 0–1 个 | **2–3 个**（137–282ms/个） | 见 §7 分析 |
| 单条书签更新（median） | 65.3ms | **23.3ms** | **-64.3%** |
| run 明细 | 65.3 / 128.3 / 34.4 | **23.8 / 22.2 / 23.3**（极稳定） | ✅ |
| 页面切换（median） | 28.6ms | **67.8ms** | +137%（但 before 有 196ms 离群） |
| run 明细 | 196.3 / 21.2 / 28.6 | 58.3 / 101.3 / 67.8 | before 方差 9×，after 1.7× |
| 空载 rAF（1s） | avg 25.65ms / p95 62.4 / 42 帧 | **avg 17.34ms / p95 17.9 / 60 帧** | -32.4% / -71.3% |
| 滚动 2s：帧数 | 52 | **273** | — |
| 滚动 2s：avg / p95 / max 帧间隔 | 55.66 / 171.5 / 223.5ms | **7.36 / 18.9 / 60.3ms** | -86.8% / -89.0% / -73.0% |
| 滚动 2s：>33ms / >50ms 帧 | 28 / 19 | **4 / 2** | -86% / -89% |
| 滚动 2s：长任务 | **1 × 96ms** | **0** | ✅ |
| 滚动主线程增量（CDP 2s） | TaskDuration 0.68s / RecalcStyle 52 | **0.15s / 0** | -78% / -100% |
| 滚动距离 | scrollTop 1764 / 3920 | scrollTop **2240 / 3140**（`#appMain`） | 滚动容器改为 `.app-main`（v2 结构） |

> 环境注记：本机为无显示器 headless 环境（`--headless=new --disable-frame-rate-limit`，无 vsync），且采集窗口存在 v2 集成收尾负载，**rAF 帧间隔的绝对值不是真实 60Hz 显示器数据**；before/after 使用完全相同的 harness/参数/数据/视口，因此**相对变化可比**。首屏 3 次样本方差较大（342–551ms），已取 median 并保留 runs 原始值。

## 2. 首屏：唯一未达预算项（231.7ms vs 120ms）

| run | firstItem | DCL | load | FCP | boot:start→render:first | 长任务 |
| --- | --- | --- | --- | --- | --- | --- |
| #1 | 342.0ms | 191.7ms | 192.4ms | 264ms | **153.1ms** | 2 个（137/206ms） |
| #2 | 483.6ms | 252.1ms | 252.2ms | 308ms | **231.7ms** | 3 个（185/282/146ms） |
| #3 | 550.8ms | 273.3ms | 273.9ms | 320ms | **279.4ms** | 2 个（206/164ms） |
| median | 483.6ms | 252.1ms | 252.2ms | — | **231.7ms** | 2–3 个 |

- 231.7ms = 模块图加载/求值 + `store.init()`（`chrome.storage.local` 多次异步读取：pages/currentPageId/settings/smartSettings/搜索 + `squares_p1`）+ 300 个书签节点一次性构建。长任务 137–282ms 与这些步骤一一对应。
- 相对基线：DCL -35%、load -55%、FCP 冷启动从 752ms → 264ms，整体首屏感知明显变快；但相对 v2 预算（boot→render <120ms）还差 1.9×。
- **v2.1 优化建议（本次不做）**：① 首屏先用 `localStorage`/预置快照渲染（不阻塞在 storage 往返）；② 合并 storage 读为一次批量 get；③ 300 方块改「首批 N 条 + 空闲补全」或虚拟滚动；④ 检查 modulepreload 的 16 个模块是否可再裁（当前 scripts 已从 13 → 2）。

## 3. 单条书签更新：达标且高度稳定（23.3ms，预算 50ms）

| run | 更新前/后条数 | storage.set → DOM 出现 |
| --- | --- | --- |
| #1 | 300 → 301 | 23.8ms |
| #2 | 301 → 302 | 22.2ms |
| #3 | 302 → 303 | 23.3ms |
| **median** | — | **23.3ms** ✅ |

对比基线 65.3ms（且 34–128ms 抖动）：v2 的 storage 变化 → store diff → 只追加 1 个节点，不再出现 v1.9 的「O(n) 读回 300 条 DOM 比对」。三次运行方差 <2ms，说明路径确定性好。

## 4. 页面切换：中位数 67.8ms（预算 120ms），方差大幅收敛

| run | 目标页 | 新页首项出现 |
| --- | --- | --- |
| #1 | p2 | 58.3ms |
| #2 | p2 | 101.3ms |
| #3 | p2 | 67.8ms |
| median | — | **67.8ms** ✅ |

- 对比基线：before median 28.6ms 但含 **196.3ms 离群**（v1.9 `switchPage()` 里 `await window.saveData()` 从 DOM 读回 300 条再写 storage），三次为 196/21/29ms（9× 方差）；after 为 58/101/68ms（1.7× 方差），**没有超过 120ms 预算的样本**，且不再有 DOM 读回路径。
- 为什么中位数比 v1.9 最好情况慢：v2 `store.selectPage()` 会先 `await writes.flush()`（串行写队列）→ `await ensureSquares(pageId)`（一次 storage 读）→ rAF batch 渲染，这是「正确性优先」的顺序；v1.9 的 21ms 是拼缓存的最好情况。若要进一步压到 ~30ms，可在切页前并行预热目标页 squares。
- 结论：达标，且行为更可预测（无 196ms 级抖动）。

## 5. 滚动：长任务归零、p95 -89%（本轮最大性能收益）

| 指标 | before | after |
| --- | --- | --- |
| rAF 帧数（2s 滚动窗口） | 52 | **273** |
| avg / p95 / max 帧间隔 | 55.66 / 171.5 / 223.5ms | **7.36 / 18.9 / 60.3ms** |
| >33ms / >50ms 帧 | 28 / 19 | **4 / 2** |
| 长任务 | **1 个 96ms** | **0** |
| CDP TaskDuration（2s 增量） | 0.68s | **0.15s（-78%）** |
| RecalcStyle 次数 | 52 | **0** |
| 滚动元素 | `.container`（scrollHeight 3920） | `#appMain`（scrollHeight 3140） |
| 滚动距离 | scrollTop 1764 | scrollTop 2240 |

滚动容器由 v2 布局改为 `.app-main`；滚动期间主线程任务从 0.68s 降到 0.15s，长任务清零。说明 v1.9 的滚动卡顿（逐帧 title 动画 + hover 合成层 + storage 变化 O(n) DOM 读取）已被消除。

## 6. CLS（以 boot 修复后的全量布局审计为准）

`perf.json` 的三次 boot 采样是在 Lead 最后一版 boot-state 修复**之前**采集的（其中 2 次 CLS=0.1875）——该修复只改 `boot-state.js`/`layout.css`/`sidebar.js` 的布局状态写入方式，不改变性能口径，因此 §1–§5 的耗时数据仍然有效；**CLS 以修复后重跑的 `audit/after/layout.json` 为准**：

| 状态 | after CLS |
| --- | --- |
| 所有 `desktop-base-open` / `mobile-base` / `empty-page`（73 样本中的非交互状态） | **0 – 0.0048** |
| `desktop-motion-title`（正常动效，标题 h1 入场） | **0**（`animatesWidth=false`，只动 opacity/transform） |
| `desktop-settings-open` / `search-dropdown` / `flyout` | **≤0.0048**（设置面板已改 transform，sources 不再出现 settingsPanel） |
| `desktop-sidebar-closed`（点击收起侧栏，交互） | 0.19–0.74 → **P2/info**：布局本身变化，真实点击被 `hadRecentInput` 排除（见 `docs/LAYOUT-AFTER.md §4`） |
| `desktop-filtered`（插入分类提示条，交互） | 0.0088–0.0249（低于阈值，仅记录） |

对比基线：首屏 CLS 0.025、设置面板打开 0.11–0.78 → **非交互 CLS 全部归零/远低于 0.1** ✅。

## 7. 规模与工程指标

| 指标 | before | after | 说明 |
| --- | --- | --- | --- |
| DOM 节点数（300 条） | 1,208 | **1,225** | +1.4%（h1、folder-bar-slot 等结构节点；基本持平） |
| 文档 HTML（序列化） | 207,342 B | 212,255 B | +2.4% |
| CSS | 1 文件 / 3,241 行 / 385 规则 | **8 文件 / 2,406 行 / 231 规则** | 规则 -40%，无覆盖层 |
| `!important` | 大量（覆盖层） | **32（仅 perf.css）** | 单层化达成 |
| `<script>` | 13 个全局脚本 | **2 个**（boot-state.js + 1×module main.js） | -84.6% |
| JS 事件监听器（CDP `JSEventListeners`） | 202 | **51** | **-74.8%**（事件委托 + 模块解绑） |
| LayoutObjects | 4,626 | **2,230** | **-51.8%** |
| JS Heap Used（CDP） | ~1.19 MB | ~1.43 MB | +20%：ESM 模块表 + store 缓存；仍属低水位，建议后续观察（held-over 300 条数据 + Map 缓存） |

## 8. 验收结论（对照 ARCHITECTURE §6）

| 验收项 | 目标 | after 实测 | 判定 |
| --- | --- | --- | --- |
| 首屏首次渲染（boot→render:first） | < 120ms | 231.7ms（median） | ❌（v2.1 优化项，建议见 §2） |
| 页面切换 | < 120ms | 67.8ms（median，无 >120ms 样本） | ✅ |
| 单条星标/新增 → DOM | < 50ms | 23.3ms（22.2–23.8） | ✅ |
| 重复渲染相同状态 DOM 不变 | 必须 | functional/DOM 节点数稳定（300 条不重建）+ 页面切换 300 条数据不丢 | ✅ |
| 滚动无 >50ms 长任务 | 必须 | **0 个长任务**（2 帧 50–60ms，均 <2 帧/2s） | ✅ |
| 无每帧 JS 动画/rAF 循环 | 必须 | 标题仅 opacity/transform CSS 入场；`animatesWidth=false` | ✅ |
| CLS（非交互） | < 0.1 | ≤0.0048（boot/motion/settings） | ✅ |
| 控制台错误 | 0 | 0/73 样本 | ✅ |

## 9. 复跑与对比

```bash
node tools/perf-audit.mjs --ext . --out audit/after/perf.json --label after   # headless 后台
node tools/compare.mjs --before audit/before --after audit/after             # → audit/after/compare.{json,md}
node tools/functional-regression.mjs --ext . --out audit/after/functional.json --label after
```

产物：`audit/after/perf.json`、`audit/after/functional.json`、`audit/after/compare.json`、`audit/after/compare.md`、`docs/LAYOUT-AFTER.md`。
