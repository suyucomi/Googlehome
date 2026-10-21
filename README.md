<div align="center">
  <img src="src/assets/images/icon.svg" alt="logo" width="128px"/>
  <h1>Chrome 优雅新标签页</h1>
  <p>🌟 一个简洁、优雅且功能强大的 Chrome 新标签页扩展 🌟</p>
  
  <p>Google浏览器主页</p>
</div>

<p align="center">
  <img src="https://img.shields.io/badge/Manifest-V3-blue?style=flat-square" alt="manifest version"/>
  <img src="https://img.shields.io/badge/License-MIT-green?style=flat-square" alt="license"/>
  <img src="https://img.shields.io/badge/Platform-Chrome-yellow?style=flat-square" alt="platform"/>
</p>

<div align="center">

</div>

## 🌈 界面预览

<div align="center">
  <img src="src\assets\images\主页.PNG" width="800px" alt="主界面"/>
  <p align="center">简洁的主界面</p>
</div>

<div align="center">
  <table>
    <tr>
      <td align="center">
        <img src="src\assets\images\设置.PNG" width="400px"/><br/>
        <sub>⚙️ 个性化设置</sub>
      </td>
      <td align="center">
        <img src="src\assets\images\粘贴.PNG" width="400px"/><br/>
        <sub>📋 智能粘贴</sub>
      </td>
    </tr>
  </table>
</div>>

## ✨ 核心特性

- 📚 **多页面书签管理** - 在侧边栏创建、重命名、删除与切换不同书签页，独立管理收藏
  - 页面切换即时响应，图标立即更新
  - 书签优雅淡入动画，错落有致的视觉效果
- 🎯 **智能搜索与快捷键** - 下拉选择搜索引擎，支持 `Alt+数字` 快速切换，一键直达
  - 搜索引擎切换流畅动画，图标平滑过渡
  - 支持 8 种主流搜索引擎，图标显示优化
- 📋 **粘贴即添加** - 在页面直接粘贴网址，自动获取标题与图标，并可编辑名称后保存
- 🧩 **图标本地化** - 使用 Chrome 内置 `_favicon` 接口同步生成站点图标，零公网请求、零网络等待
  - 按域名缓存，失败/非法 URL 回退到字母图标
  - 不再把 base64 塞进 localStorage（旧实现会撑爆 5MB 配额）
- 🧭 **拖拽排序与交互优化** - 平滑拖拽、悬浮与交换动画，支持批量移动与就地保存
- 🎨 **个性化背景** - 上传背景图片，实时预览与模糊/亮度调节，动画过渡更顺滑
- 💾 **配置备份与恢复** - 一键导出/导入包含设置、书签页与书签的数据，便捷迁移
- 🔒 **Manifest V3 与权限控制** - 合理使用 `storage`、`scripting` 等权限，确保安全与性能
- ✨ **流畅动画体验** - GPU 加速动画，优化性能，提供丝滑的用户体验
- 🔮 **玻璃态深色主题** - 毛玻璃质感的暗色 UI，现代化视觉风格

## 🔍 搜索引擎支持

<div align="center">
  <table>
    <tr>
      <td align="center">
        <img src="src/assets/icons/google.svg" width="48px"/><br/>
        <sub><b>Google</b></sub>
      </td>
      <td align="center">
        <img src="src/assets/icons/baidu.svg" width="48px"/><br/>
        <sub><b>百度</b></sub>
      </td>
      <td align="center">
        <img src="src/assets/icons/bilibili.svg" width="48px"/><br/>
        <sub><b>哔哩哔哩</b></sub>
      </td>
      <td align="center">
        <img src="src/assets/icons/bing.svg" width="48px"/><br/>
        <sub><b>必应</b></sub>
      </td>
    </tr>
    <tr>
      <td align="center">
        <img src="src/assets/icons/duckduckgo.svg" width="48px"/><br/>
        <sub><b>DuckDuckGo</b></sub>
      </td>
      <td align="center">
        <img src="src/assets/icons/github.svg" width="48px"/><br/>
        <sub><b>GitHub</b></sub>
      </td>
      <td align="center">
        <img src="src/assets/icons/yahoo.svg" width="48px"/><br/>
        <sub><b>Yahoo</b></sub>
      </td>
      <td align="center">
        <img src="src/assets/icons/ecosia.svg" width="48px"/><br/>
        <sub><b>Ecosia</b></sub>
      </td>
    </tr>
  </table>
</div>

## 🚀 快速开始

### 安装方式

 **开发者模式安装**
   - 下载本仓库代码
   - 打开 Chrome 扩展程序页面 (`chrome://extensions/`)
   - 开启"开发者模式"
   - 点击"加载已解压的扩展程序"
   - 选择代码目录即可

### 使用说明

1. **打开新标签页** - 自动加载默认页面和书签
2. **管理书签页面** - 点击左侧侧边栏创建、切换或管理多个书签页面
3. **添加书签** - 复制网址并粘贴到页面任意位置，自动获取标题和图标
4. **编辑书签** - 右键图标可以编辑名称或删除
5. **拖拽排序** - 拖拽图标可以调整顺序，支持跨行移动
6. **切换搜索引擎** - 点击搜索框左侧图标选择搜索引擎
7. **个性化设置** - 点击左上角设置图标，可自定义背景、模糊度与亮度
8. **备份恢复** - 在设置面板中导出/导入配置，方便迁移数据

## 🎬 动画特性

- **页面切换动画** - 点击页面图标立即切换，书签优雅淡入显示
- **搜索引擎切换** - 图标平滑淡入淡出，带轻微缩放效果
- **拖拽交互** - 流畅的拖拽动画，实时预览位置
- **悬浮效果** - 图标悬浮时平滑放大，提供视觉反馈
- **GPU 加速** - 使用 `will-change` 和 `transform3d` 优化性能

## 🔧 技术特性（v2.0 架构）

- **ES Modules 分层**：`core`（config/utils/dom/storage/store）→ `features`（分类/同步/设置/导入导出）→ `ui`（侧栏/网格/搜索/设置/弹窗/粘贴）→ `main.js`，只有一个模块入口，无全局脚本顺序依赖
- **单一数据源 + 单向数据流**：`core/store.js` 是唯一运行时状态，DOM 不再作为保存来源；所有写入走串行队列、同 key 合并
- **按区域增量渲染**：侧栏页面列表 keyed diff、书签网格纯增删复用 DOM、事件全部委托到容器
- **CSS 单层化**：`ui.css`（3241 行 / 3 段追加覆盖）拆成 8 个分层文件共 2384 行，`!important` 只保留在 `perf.css`（32 处），z-index 全部令牌化
- **module service worker**：background 与页面共用同一份 features 实现
- **后台无头验证**：`tools/` 内 CDP 审计/性能/功能回归脚本，默认 `--headless=new`，不弹窗

## 📈 浏览量

<div align="center">
  <img src="https://profile-counter.glitch.me/google-search/count.svg" alt="访问量统计"/>
</div>


---

## 🧠 智能书签分类（融合版）

本仓库现在是**「新标签页 + 书签智能分类」二合一扩展**，不再需要单独的「智能书签助手」。

### 首次使用：按浏览器书签建分类

加载扩展后打开新标签页，background 会读取浏览器「书签栏」：

- **一级目录 → 主题左侧分类页**（也就是侧边栏的「书签页面」）
- **二级目录 → 页面内书签的二级分类**（鼠标悬浮一级分类时弹出）
- 书签栏根目录下的零散书签 → 「未分类」页面
- 已导入过不会重复导入；设置里可「重新导入浏览器书签」

### 收藏时双份保存

- **主题里粘贴网址**：保存到当前分类页 + 当前二级分类，同时在浏览器书签对应目录创建一条书签
- **浏览器里点星标**（收藏到书签栏根目录）：background 调用 TypeSafe/离线规则分类，移动到对应目录，并同步到主题对应分类页
- 主题自己写入的书签会被抑制，不会被再次分类
- 手动放进子目录的书签保持原样

### 设置

设置面板 →「智能书签分类」：

| 字段 | 说明 |
| --- | --- |
| TypeSafe API Key | `apikey_...`，留空则只用离线规则 |
| 模型 | 默认 `jev-latest` |
| 星标时自动分类并同步到主题 | 关闭后浏览器星标不处理 |
| 允许使用推荐分类 | 选中推荐目录时自动在浏览器创建目录 |

> TypeSafe 对部分网络地区返回 HTTP 451，此时请开启代理；没有 Key 或接口失败时会自动回退内置域名规则。

### 测试

```bash
node tests/run-tests.mjs
```

当前 **64 项全部通过**，覆盖：离线规则、书签树→页面映射、推荐分类、TypeSafe 请求/解析、决策回退、导入/双向同步/去重、本地图标 URL、features 设置/导入导出、background module（含星标端到端分类）、**core/store 12 项**（初始化/默认页/书签增删改/去重/筛选/重排/页面 CRUD/外部 storage 同步/UI 状态持久化）、ESM 语法与静态检查。

### 从旧版迁移

1. `chrome://extensions` 加载本目录（`Googlehome`），开启开发者模式
2. **停用**原来的「智能书签助手」，避免两个扩展同时处理星标事件
3. 打开新标签页 → 首次会自动导入浏览器书签（12 个一级分类 / 403 条书签实测）
4. 设置 →「智能书签分类」里重新填一次 TypeSafe API Key（扩展之间不共享存储），然后保持代理开启
- 分类失败（没配 Key / 规则也没命中）时，书签留在浏览器原处，同时会出现在主题的「未分类」页面

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


### v2.0 架构重构：性能 + 排版修复

这一步不再加功能，只做两件事：**把页面排版错乱修干净**、**把「书签多了变卡」从结构上解决**，同时把原来的全局脚本/CSS 重构成可维护的分层结构。详细设计见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)，浏览器实测报告见 [docs/LAYOUT-AUDIT.md](docs/LAYOUT-AUDIT.md) / [docs/LAYOUT-AFTER.md](docs/LAYOUT-AFTER.md) 与 [docs/PERF-BASELINE.md](docs/PERF-BASELINE.md) / [docs/PERF-AFTER.md](docs/PERF-AFTER.md)。

#### 架构变化

| 维度 | v1.9 | v2.0 |
| --- | --- | --- |
| 脚本加载 | 13 个全局经典脚本，顺序敏感 | 1 个 ESM 入口 + 分层模块（core → features → ui），module service worker |
| 状态 | page-manager / storage / settings-manager 多处各存一份，保存靠读 DOM | `core/store.js` 单一数据源，DOM 只做视图；写入串行队列、同 key 合并 |
| 渲染 | 页面切换/星标时整块重建，逐项绑监听 | 侧栏页面列表 keyed diff、书签网格纯增删复用 DOM、事件全部委托 |
| CSS | `ui.css` 3241 行，3 段「追加覆盖」、!important 泛滥 | 8 个分层文件共 2384 行，`!important` 只在 `perf.css`（32 处），z-index 全令牌化 |
| 启动 | 13 个 script 顺序加载 | 15 个 `<link rel="modulepreload">` 一波并行；`boot-state.js` 首帧前同步预置侧栏布局 |
| 测试 | 23 项 | 64 项（core/store 12 项、background 端到端、静态检查） |
| 死代码 | components/eye/worker/background-manager/重复 drag 实现 | 已全部删除 |

存储 key 与 v1.x 完全一致，`chrome://extensions` 重新加载扩展即可，已有页面/书签/设置原样保留。

#### 排版修复（全部由真实 Chrome 155 + CDP 审计驱动）

- **P0 侧栏展开时内容越界/被侧栏盖住**（834/900px 视口：网格越出视口 60–93px、与侧栏重叠 3.1 万–7.7 万 px²、方块中心点击命中侧栏）：改为 `margin-left/width` 让位 + 内部块 `width:100%/max-width:min(720px,100%)`，不再用 `padding-left` + `100vw`。
- **P0 300 条书签时标题被 flex 压扁**（28.6px → 4.6px）：改用真实 `<h1 class="page-title">` + `flex:0 0 auto`，四个主内容子项都不参与压缩。
- **P1 不可见的页面操作按钮仍可点击**（53/73 样本误触风险）：`visibility:hidden + pointer-events:none`，hover/focus-within 才显示。
- **P1 移动端搜索下拉左侧被裁 60px**：去掉居中 `translateX(-50%)`，改为左对齐 + 视口 clamp。
- **P1 设置面板打开时 `aria-hidden` 仍为 true、背景无 inert、焦点不进**：完整 aria/inert/焦点陷阱/Esc 关闭/焦点回归。
- **P2 侧栏宽度 280/300/320 三处不一致** → `--sidebar-w: 300px` 单一来源；**z-index 魔法数字** → 语义令牌；**伪元素标题宽度动画** → 真实 h1 + opacity/translate（无回流）。
- **启动 CLS 0.19 → 0**：首帧前由 `boot-state.js` 写 `html[data-sidebar]`，并去掉主内容列 margin/width 的布局属性过渡（侧栏仍用 transform 滑入）。

#### 性能（300 条/页，同一套 CDP harness）

| 指标（300 条/页，Chrome 155 headless + CDP，同 harness） | v1.9 | v2.0 | 变化 |
| --- | --- | --- | --- |
| 首屏首个书签出现在 DOM | 642ms | **483.6ms** | -24.7% |
| DOMContentLoaded / load | 387.8 / 565.3ms | **252.1 / 252.2ms** | -35% / -55% |
| 单条书签更新 → DOM 出现 | 65.3ms | **23.3ms** | **-64.3%** |
| 页面切换 → 新页首项 | 28.6ms（含 196ms 离群） | 67.8ms（无 >120ms 离群，预算内） | 中位变慢但方差收敛 |
| 滚动 2s：rAF p95 / >50ms 帧 / 长任务 | 171.5ms / 19 帧 / 1 个 | **18.9ms / 2 帧 / 0 个** | **-89% / -89% / -100%** |
| 空载 rAF p95 | 62.4ms | **17.9ms** | -71.3% |
| JS 事件监听器数 | 202 | **51** | **-74.8%** |
| LayoutObjects | 4,626 | **2,230** | -51.8% |
| CSS 规则数 / `<script>` 标签 | 385 / 13 | **231 / 2** | -40% / -85% |
| CLS（非交互：boot / 设置打开） | 0.025 / 0.11–0.78 | **≤0.0048 / 0** | 基本归零 |

首屏从 `boot:start` 到首渲染为 **231.7ms**（预算 120ms，未达标）：成本主要是 ESM 模块图 + `store.init()` 的 storage 往返 + 300 个方块首次全量构建，列为 v2.1 优化项；但相比 v1.9 的首项 642ms 已快 24.7%，且交互/滚动收益远大于此。

> 说明：交互触发的布局变化（如点击开/合侧栏时主内容让位）仍会产生一次瞬时 layout shift；真实用户点击会被浏览器 `hadRecentInput` 排除，不属于异常抖动。

#### 验证方式

```bash
node tests/run-tests.mjs                 # 64 项
node tools/functional-regression.mjs     # 真实 Chrome 功能回归
node tools/audit.mjs --ext . --out audit/after --label after
node tools/perf-audit.mjs --ext . --out audit/after/perf.json --label after
node tools/compare.mjs --before audit/before --after audit/after
```

浏览器验证默认 `--headless=new` 后台运行，不弹窗。
