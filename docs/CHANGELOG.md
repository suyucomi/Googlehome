# 版本历史（v1.5 – v2.0.1）

> 本文件由 README 迁移而来，保留 v1.5–v1.9 的详细开发记录；v2.0 与 v2.0.1 摘要见下。
> v2.0 的架构重构与验收结果见 [README](../README.md#-版本历史) 与
> [ARCHITECTURE.md](ARCHITECTURE.md) / [LAYOUT-AFTER.md](LAYOUT-AFTER.md) / [PERF-AFTER.md](PERF-AFTER.md)。

## v2.0.1（2026-10）

- 按需求移除搜索框上方的页面标题行（`<h1 class="page-title">What are you looking for today?</h1>`）
- 清理 `.page-title` 样式 / keyframes / reduced-motion 规则；审计与功能回归脚本改为容忍无标题并断言标题行已移除
- 搜索框自动上移（布局其余不变），README 预览图同步更新

## v2.0（2026-10）

- ESM 分层（`core` → `features` → `ui`）+ 单一数据源 `core/store`，删除 13 个全局脚本的顺序依赖
- CSS `ui.css` 3241 行（3 段追加覆盖）→ 8 个分层文件 2384 行，`!important` 只在 `perf.css`
- 修复排版错乱：侧栏展开越界/重叠、标题被 flex 压扁、隐藏按钮可点击、移动端下拉裁切（实测 P0 103→0、P1 75→0）
- 性能：单条书签更新 65.3→23.3ms、滚动 p95 171.5→18.9ms、长任务归零、监听器 -75%
- 启动：`modulepreload` + `boot-state.js` 首帧预置，CLS 0.19→0；测试 23→64 项

---

### 前端与性能优化（v1.5）

- **图标零网络请求**：用 Chrome 内置 `_favicon`（`chrome-extension://<id>/_favicon/?pageUrl=…`）替代原来的 5 个公网图标服务。旧逻辑每个域名最多串行等 3+3+5+4+3 秒，还会把 base64 写满 localStorage；现在同步生成本地 URL。
- **搜索图标直连扩展资源**：去掉 8 个搜索引擎图标的 `fetch → base64` 转换。
- **首屏动画封顶**：长列表交错淡入延迟从 `i*20ms` 改为封顶 220ms，88 条书签不再等 1.7 秒才显示完。
- **减少重绘**：页面计数没变化时跳过侧边栏全量重建；页面书签走内存缓存，hover 二级分类不再重复读 storage。
- **合成层优化**：去掉每个方块常驻的 `will-change`，只在 hover/拖拽时提升；新增 `prefers-reduced-motion` 降级。
- **域名缓存**：同一站点第二次星标直接复用上次分类（90 天 TTL），省一次模型调用。
- **实时同步**：新标签页监听 `chrome.storage.onChanged`，在别的标签页星标后主题立即出现该书签。
- **切换零写入**：页面内容没变化时 `saveData` 直接返回，切换分类不再重复写 storage；页面书签优先走内存缓存，缓存由 `storage.onChanged` 维护。
- **空状态提示**：分类下没有书签时显示占位文案，而不是一片空白。
- **去掉常驻动画循环**：`animation.js` 原来用 `requestAnimationFrame` 每秒 60 次给搜索框做呼吸动画（空闲也跑），现改为纯 CSS/合成层，空闲时不占主线程。
- **性能模式（默认开启）**：每个书签图标不再用 `backdrop-filter` 毛玻璃，方块改为半透明纯色；呼吸动画关闭。想要毛玻璃质感可在 设置 →「性能」里取消勾选。
- **焦点可见**：键盘操作时侧边栏、二级分类、书签方块有可见焦点环。

### 浏览器实测与修复（v1.6 / v1.7 / v1.8）

用 Chrome 155 + CDP（独立测试 profile，`--enable-unsafe-extension-debugging` + `Extensions.loadUnpacked`）实际加载扩展跑了完整流程，发现并修掉 5 个真实 bug：

1. **页面切换直接报错**：`storage.js` 的 `saveData` 里 `const squaresData` 在二级分类过滤分支被重新赋值，抛 `TypeError: Assignment to constant variable`，导致切换页面/添加页面全部失败 → 改为 `let`。
2. **星标后主题不刷新**：`watchStorage` 先处理 `bookmarkPages` 就 `return`，而 `mirrorToTheme` 同时写 `bookmarkPages` + `squares_*`，当前页面的书签变化永远被跳过 → 调整为先处理 `squares_*`，页面即时应答。
3. **二级分类面板「全部」数量恒为 0**：计数按 folder 统计，`''` 键不存在 → 「全部」改用该页总数。
4. **侧边栏展开时书签被遮住**：内容区按整窗居中，和 300px 侧边栏重叠 → 桌面端 `.container.sidebar-open` 增加 `padding-left: 320px`。
5. **左上角触发按钮压住标题**：桌面端正打开时仍显示 → `.container.sidebar-open .sidebar-trigger { display: none }`。

另外把 `bookmark-sync.js` 的页面读写串行化（`serialize()`）：首次导入和星标镜像并发时会互相覆盖（实测丢过 4 个页面）。

实测结果：首次安装自动导入 4 页/11 条；浏览器星标 → 分类移动 + 主题即时出现；主题添加 → 浏览器书签写入；二级分类过滤/「全部」/空状态/设置面板/性能模式切换均正常；控制台无异常；页面 DCL ~71ms、load ~85ms，图标走本地 `_favicon`（64×64，零网络）。


### 设置面板滚动 + 大量书签性能（v1.8）

**设置面板不能滚动**：后置的 "Settings Panel Polish" 样式把 `.settings-panel` 写成了 `overflow: hidden !important`，内容超过一屏就滚不动。改为 `overflow-y: auto !important` + `overscroll-behavior: contain`，实测滚轮 scrollTop 0 → 659（clientHeight 583 / scrollHeight 1242），粘性标题保持正常。

**大量书签性能**（Chrome 155 CDP，单页 300 条书签，软件渲染环境）：

| 指标 | 优化前 | 优化后 |
| --- | --- | --- |
| 整页渲染 | 7ms | 4–5ms |
| saveData | 6.7ms | 4–5ms |
| 浏览器星标 → 主题出现 | 47ms | 30–33ms |
| 滚动平均帧间隔 | 61ms | 47.8ms |
| 滚动 p95 | 182ms | 118ms |

做法：
- **事件委托**：书签的 click / keydown / contextmenu 统一挂到 `#squaresContainer`，拖拽（dragstart/dragover/drop/dragend）也改为容器委托。300 条书签少建约 **2400 个监听器**（每项 3 个交互 + 5 个拖拽）。
- **差量更新**：星标同步新增书签时只 append 一个新节点，不再 `innerHTML=''` 重建全页；删除时只移除尾部节点，顺序不连续才回退全量渲染。
- **计数不再重绘侧边栏**：`bookmarkPages` 变化若结构未变，只更新 `.page-count` 文本与 aria-label。
- **性能模式**：去掉每个书签方块的 `box-shadow` / 边框，缩短过渡时间，降低重绘成本。

回归验证：拖拽排序后 DOM 顺序与 storage 一致、右键菜单正常、星标同步后侧边栏计数正确（301）、设置面板滚轮可用。


### 移除侧边栏收起后的悬浮页面图标（v1.9）

- `index.html` 删除 `#floatingPageIcons` 容器
- `page-manager.js` 删除 `renderFloatingIcons()` 及全部调用
- `main.js` 删除侧边栏打开/关闭时对悬浮图标的 show/hide 逻辑
- `ui.css` 删除 `.floating-page-icons` / `.floating-page-icon` / `.page-tooltip` 的所有规则（含响应式与设计覆盖块）

侧边栏收起后左侧只剩左上角的展开按钮；Chrome 实测：`#floatingPageIcons` 不存在、`.floating-page-icon` 0 个、样式表里无相关规则，侧边栏开合、页面切换/新建/删除都正常，控制台无报错。
