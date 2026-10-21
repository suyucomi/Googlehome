/**
 * core/config.js — 全局配置与默认值（纯数据，无副作用）。
 *
 * 所有模块共享这一份配置；禁止在模块内散落魔法数字。
 * 图标 URL 通过 assetUrl() 生成，Node 测试环境（无 chrome.runtime）下退化为相对路径。
 */

/** 扩展内资源 URL（测试环境无 chrome.api 时返回相对路径） */
export function assetUrl(path) {
  const clean = String(path || '').replace(/^\//, '');
  try {
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL) {
      return chrome.runtime.getURL(clean);
    }
  } catch (error) {
    /* 忽略：回退相对路径 */
  }
  return clean;
}

const SEARCH_ENGINES = {
  google: { name: 'Google', url: 'https://www.google.com/search?q=', icon: assetUrl('src/assets/icons/google.svg') },
  baidu: { name: '百度', url: 'https://www.baidu.com/s?wd=', icon: assetUrl('src/assets/icons/baidu.svg') },
  bing: { name: '必应', url: 'https://www.bing.com/search?q=', icon: assetUrl('src/assets/icons/bing.svg') },
  duckduckgo: { name: 'DuckDuckGo', url: 'https://duckduckgo.com/?q=', icon: assetUrl('src/assets/icons/duckduckgo.svg') },
  yahoo: { name: 'Yahoo', url: 'https://search.yahoo.com/search?p=', icon: assetUrl('src/assets/icons/yahoo.svg') },
  ecosia: { name: 'Ecosia', url: 'https://www.ecosia.org/search?q=', icon: assetUrl('src/assets/icons/ecosia.svg') },
  github: { name: 'GitHub', url: 'https://github.com/search?q=', icon: assetUrl('src/assets/icons/github.svg') },
  bilibili: { name: '哔哩哔哩', url: 'https://search.bilibili.com/all?keyword=', icon: assetUrl('src/assets/icons/bilibili.svg') }
};

export const CONFIG = {
  searchEngines: SEARCH_ENGINES,

  // 预定义网站标题映射（避免为常见站点发网络请求猜标题）
  websiteTitles: {
    'chromewebstore.google.com': 'Chrome 应用商店',
    'chrome.google.com/webstore': 'Chrome 应用商店',
    'mail.google.com': 'Gmail',
    'drive.google.com': 'Google 云端硬盘',
    'docs.google.com': 'Google 文档',
    'translate.google.com': 'Google 翻译',
    'calendar.google.com': 'Google 日历',
    'maps.google.com': 'Google 地图',
    'photos.google.com': 'Google 相册',
    'meet.google.com': 'Google Meet',
    'chat.google.com': 'Google Chat',
    'keep.google.com': 'Google Keep',
    'youtube.com': 'YouTube',
    'github.com': 'GitHub',
    'bilibili.com': '哔哩哔哩',
    'zhihu.com': '知乎',
    'weibo.com': '微博'
  },

  animation: {
    duration: 4500,
    timing: 'ease-in-out',
    glowColor: 'rgba(255, 255, 255, 0.3)',
    glowSize: '25px',
    glowBlur: '2px'
  },

  storageKeys: {
    squares: 'squares',
    searchEngine: 'searchEngine',
    settings: 'settings'
  },

  defaultSettings: {
    defaultSearchEngine: 'google',
    animationEnabled: true,
    darkMode: true
  },

  constants: {
    MOBILE_BREAKPOINT: 768,
    TABLET_BREAKPOINT: 1024,

    ANIMATION_FAST: 150,
    ANIMATION_NORMAL: 300,
    ANIMATION_SLOW: 450,
    ANIMATION_SLIDE: 125,

    DELAY_SHORT: 0,
    DELAY_MEDIUM: 100,
    DELAY_LONG: 300,

    THROTTLE_SAVE: 1000,
    DEBOUNCE_SEARCH: 300,
    WRITE_DEBOUNCE: 120,
    FADE_STAGGER_MAX: 220,

    FAVICON_SIZE: 64,
    MAX_BACKGROUND_FILE_SIZE: 5 * 1024 * 1024,
    BACKGROUND_MAX_WIDTH: 1920,
    BACKGROUND_MAX_HEIGHT: 1080,
    BACKGROUND_QUALITY: 0.85,

    FAVICON_CACHE_EXPIRY: 24 * 60 * 60 * 1000,
    ICON_FETCH_TIMEOUT: 5000,

    DRAG_IMAGE_SIZE: 28
  },

  security: {
    dangerousProtocols: ['javascript:', 'data:', 'vbscript:', 'file:', 'ftp:'],
    allowedProtocols: ['http:', 'https:'],
    maxFileSize: 5 * 1024 * 1024,
    supportedImageFormats: ['image/jpeg', 'image/png', 'image/webp']
  },

  ariaLabels: {
    searchInput: '在搜索引擎上搜索',
    searchEngine: '选择搜索引擎',
    bookmarkItem: '书签',
    editPage: '编辑页面',
    deletePage: '删除页面',
    sidebar: '侧边栏',
    settings: '设置',
    close: '关闭'
  },

  errorMessages: {
    INVALID_URL: '无效的 URL',
    FILE_TOO_LARGE: '文件大小超过限制',
    UNSUPPORTED_FORMAT: '不支持的文件格式',
    SAVE_FAILED: '保存失败',
    LOAD_FAILED: '加载失败'
  }
};

/** 响应式断点（桌面 / 移动抽屉的分界） */
export const MOBILE_BREAKPOINT = CONFIG.constants.MOBILE_BREAKPOINT;

/** 背景设置默认值（storage.settings） */
export const DEFAULT_SETTINGS = {
  background: {
    type: 'none',
    value: '',
    blur: 0,
    brightness: 100
  }
};

/** 智能分类/性能默认值（storage.smartSettings） */
export const DEFAULT_SMART = {
  apiKey: '',
  baseUrl: 'https://api.typesafe.ai',
  model: 'jev-latest',
  autoClassify: true,
  taxonomy: true,
  perfMode: true,
  timeoutMs: 15000
};

export default CONFIG;
