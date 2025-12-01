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
- 🧩 **图标智能获取与缓存** - 多源并发获取站点图标、失败回退与本地缓存，稳定快速显示
  - 支持 4 个图标服务备用，提高获取成功率
  - 智能缓存机制，24小时有效期，提升加载速度
- 🧭 **拖拽排序与交互优化** - 平滑拖拽、悬浮与交换动画，支持批量移动与就地保存
- 🎨 **个性化背景** - 上传背景图片，实时预览与模糊/亮度调节，动画过渡更顺滑
- 💾 **配置备份与恢复** - 一键导出/导入包含设置、书签页与书签的数据，便捷迁移
- 🔒 **Manifest V3 与权限控制** - 合理使用 `storage`、`scripting` 等权限，确保安全与性能
- ✨ **流畅动画体验** - GPU 加速动画，优化性能，提供丝滑的用户体验

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
6. **切换搜索引擎** - 点击搜索框左侧图标选择搜索引擎，或使用 `Alt+数字` 快捷键
7. **个性化设置** - 点击左上角设置图标，可自定义背景、模糊度与亮度
8. **备份恢复** - 在设置面板中导出/导入配置，方便迁移数据

### 快捷键

- `Alt + 1-8` - 快速切换搜索引擎
- `Tab` - 从搜索框切换到书签区域
- `Enter` - 在搜索框中执行搜索
- `右键` - 打开书签编辑菜单

## 🎬 动画特性

- **页面切换动画** - 点击页面图标立即切换，书签优雅淡入显示
- **搜索引擎切换** - 图标平滑淡入淡出，带轻微缩放效果
- **拖拽交互** - 流畅的拖拽动画，实时预览位置
- **悬浮效果** - 图标悬浮时平滑放大，提供视觉反馈
- **GPU 加速** - 使用 `will-change` 和 `transform3d` 优化性能

## 🔧 技术特性

- **多图标服务备用** - icon.horse、Google、Yandex、FaviconKit 四个服务依次尝试
- **智能缓存机制** - 本地存储图标缓存，24小时有效期
- **异步加载优化** - 图标异步加载，不阻塞页面渲染
- **错误处理完善** - 图标获取失败时自动生成默认图标
- **性能优化** - 使用 DocumentFragment 批量创建 DOM，减少重排

## 📈 浏览量

<div align="center">
  <img src="https://profile-counter.glitch.me/google-search/count.svg" alt="访问量统计"/>
</div>

