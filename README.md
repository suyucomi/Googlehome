<div align="center">
  <img src="src/assets/images/icon128.png" alt="logo" width="128px"/>
  <h1>Chrome 优雅新标签页</h1>
  <p>一个简洁、优雅且功能强大的 Chrome 新标签页扩展</p>
</div>

<p align="center">
  <img src="https://img.shields.io/badge/Manifest-V3-blue" alt="manifest version"/>
  <img src="https://img.shields.io/badge/License-MIT-green" alt="license"/>
  <img src="https://img.shields.io/badge/Platform-Chrome-yellow" alt="platform"/>
</p>

## ✨ 特性

- 🔍 支持多个主流搜索引擎,一键切换
- 🎯 智能网站收藏,自动获取图标
- 🎨 自定义背景,支持模糊与亮度调节
- 🚀 流畑的动画效果与交互体验
- 💾 支持配置导入导出与数据备份
- ⌨️ 便捷的键盘快捷操作

## 🖥 预览

<div align="center">
  <img src="preview.png" alt="preview" width="800px"/>
</div>

## 🚀 快速开始

1. 在 Chrome 商店搜索安装本扩展
2. 打开新标签页即可使用
3. 点击左上角设置图标进行个性化配置
4. 复制网址并粘贴到页面任意位置添加网站
5. 拖拽图标可以调整顺序
6. 右键图标可以编辑或删除

## 🎯 主要功能

### 搜索引擎支持
- Google
- 百度
- 必应
- DuckDuckGo
- Yahoo
- Ecosia
- GitHub
- 哔哩哔哩

### 快捷键
- `Alt + 数字键`: 快速切换搜索引擎
- `Enter`: 执行搜索
- `Tab`: 焦点切换

### 网站管理
- 拖拽排序
- 自动获取图标
- 右键菜单编辑
- 复制粘贴添加

### 个性化设置
- 自定义背景图片
- 模糊度调节
- 亮度调节
- 数据备份恢复

## 🛠 技术实现

### 核心功能
- 异步存储队列
- 本地缓存优化
- Web Worker 处理
- GPU 加速动画
- 智能重试机制

### 性能优化
- 图标懒加载
- 节流防抖
- 减少重绘重排
- 资源预加载
- 内存管理

## 📦 项目结构
src/
├── assets/ # 静态资源
├── css/ # 样式文件
├── js/ # JavaScript 文件
│ ├── components/ # 功能组件
│ ├── utils/ # 工具模块
│ ├── config.js # 全局配置
│ ├── main.js # 主入口
│ └── paste.js # 粘贴处理
└── index.html # 主页面

## 🎯 开发计划

- [ ] 添加更多搜索引擎支持
- [ ] 支持文件夹分组管理
- [ ] 添加标签分类功能
- [ ] 优化移动端适配
- [ ] 添加云端同步功能
- [ ] 支持快捷键定制
- [ ] 优化图标缓存机制
- [ ] 添加深色模式支持

## 🤝 贡献指南

1. Fork 本仓库
2. 创建特性分支
3. 提交代码
4. 创建 Pull Request

欢迎提交 Issue 和 Pull Request 来帮助改进项目。

## 📄 开源协议

本项目基于 [MIT](LICENSE) 协议开源。

## 🙏 鸣谢

感谢所有贡献者对本项目的支持!

<p align="center">
  <img src="https://contrib.rocks/image?repo=your-username/repo-name" />
</p>
