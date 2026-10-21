/**
 * main.js — 应用启动器（唯一入口，由 index.html 的 <script type="module"> 加载）。
 *
 * 启动顺序：
 *   1. store.init()：读 storage / 迁移缺失数据 / 预载当前页书签（唯一状态源）；
 *   2. 应用性能模式与背景（首屏一次；之后订阅 settings/smartSettings 兜底）；
 *   3. mount 各 UI 区域（顺序 = Esc 优先级：设置面板 > 搜索 > 浮层 > 书签网格 > 侧栏 > 粘贴）；
 *      每个模块首屏自行同步渲染一次，之后由 store.subscribe + 按帧 batch 增量更新；
 *   4. 打点 boot:start / render:first，供性能审计；
 *   5. pagehide 时 flush 未落盘写入并销毁监听。
 *
 * 不存在任何 window.* 跨模块调用，也不存在全局脚本顺序依赖。
 */

import { store } from './core/store.js';
import { flushBatch } from './core/dom.js';
import { applyBackground, applyPerfMode } from './features/settings.js';
import { mountSettingsPanel } from './ui/settings-panel.js';
import { mountSearch } from './ui/search.js';
import { mountFlyout } from './ui/flyout.js';
import { mountSquares } from './ui/squares.js';
import { mountSidebar } from './ui/sidebar.js';
import { mountPaste } from './ui/paste.js';
import { destroyDialogs } from './ui/dialogs.js';

const mounted = [];
let settingsUnsubscribe = null;
let hadBackgroundImage = false;

// 启动状态标记（审计脚本/排障用：start → ready / error）
document.documentElement.dataset.boot = 'start';

if (typeof performance !== 'undefined' && typeof performance.mark === 'function') {
  performance.mark('boot:start');
}

function mountSafely(name, factory) {
  try {
    const instance = factory();
    if (instance && typeof instance.destroy === 'function') mounted.push(instance);
    return instance;
  } catch (error) {
    console.error(`[main] 挂载 ${name} 失败:`, error);
    return null;
  }
}

function hasBackgroundImage(settings) {
  const background = settings && settings.background;
  return Boolean(background && background.type === 'image' && background.value);
}

/**
 * 应用背景：只有配置了图片才创建背景层。
 * features/settings.applyBackground 在 type='none' 时会把 .container 底色写成 #202124；
 * 新主题的底色是 body 渐变（layout.css 让 .container 透明），因此无背景时清掉内联底色，
 * 避免默认主题被一整块纯色盖住（视觉回归）。已有背景层仍由 features 负责清理。
 */
function applyThemeBackground(settings) {
  const hasImage = hasBackgroundImage(settings);
  if (!hasImage && !hadBackgroundImage) return;
  try {
    applyBackground(settings);
  } catch (error) {
    console.error('[main] 应用背景失败:', error);
  }
  if (!hasImage) {
    const container = document.querySelector('.container');
    if (container) container.style.backgroundColor = '';
  }
  hadBackgroundImage = hasImage;
}

function applyTheme(state) {
  try {
    applyPerfMode(state.smartSettings.perfMode !== false);
  } catch (error) {
    console.error('[main] 应用性能模式失败:', error);
  }
  hadBackgroundImage = hasBackgroundImage(state.settings);
  applyThemeBackground(state.settings);
}

async function boot() {
  try {
    await store.init();
  } catch (error) {
    console.error('[main] store 初始化失败:', error);
  }

  // 首屏主题（在 mount 之前，避免第一帧闪烁）
  applyTheme(store.state);

  // mount 顺序即 Esc / 浮层优先级（先注册先处理；后注册的检查 defaultPrevented）
  mountSafely('settingsPanel', () => mountSettingsPanel());
  mountSafely('search', () => mountSearch());
  mountSafely('flyout', () => mountFlyout());
  mountSafely('squares', () => mountSquares());
  mountSafely('sidebar', () => mountSidebar());
  mountSafely('paste', () => mountPaste());

  // 设置变化兜底：设置面板打开时由面板自己应用（避免双写/双重淡入），其余场景（其他标签页/background 改动）在此应用
  settingsUnsubscribe = store.subscribe((state, changed) => {
    if (changed.has('settings')) {
      if (state.ui.settingsOpen) {
        // 设置面板打开时由面板自己应用（避免双重交叉淡入），这里只同步标记
        hadBackgroundImage = hasBackgroundImage(state.settings);
      } else {
        applyThemeBackground(state.settings);
      }
    }
    if (changed.has('smartSettings')) {
      try {
        applyPerfMode(state.smartSettings.perfMode !== false);
      } catch (error) {
        console.error('[main] 应用性能模式失败:', error);
      }
    }
  });

  if (typeof performance !== 'undefined' && typeof performance.mark === 'function') {
    performance.mark('render:first');
    try {
      performance.measure('boot', 'boot:start', 'render:first');
    } catch (error) {
      /* 忽略：无 start mark 时不可测 */
    }
  }

  // 供审计脚本/调试判断首屏已就绪（唯一写入的根标记，非全局 API）
  document.documentElement.dataset.boot = 'ready';
  document.documentElement.dataset.appReady = 'true';
}

function teardown() {
  if (settingsUnsubscribe) {
    settingsUnsubscribe();
    settingsUnsubscribe = null;
  }
  for (const instance of mounted.splice(0)) {
    try {
      instance.destroy();
    } catch (error) {
      console.error('[main] 销毁 UI 失败:', error);
    }
  }
  destroyDialogs();
  try {
    flushBatch();
  } catch (error) {
    /* 忽略 */
  }
  try {
    Promise.resolve(store.flush()).catch(() => {});
  } catch (error) {
    /* 忽略 */
  }
}

window.addEventListener('pagehide', teardown, { once: true });

boot().catch((error) => {
  console.error('[main] 启动失败:', error);
  document.documentElement.dataset.boot = 'error';
  document.documentElement.dataset.appReady = 'error';
});
