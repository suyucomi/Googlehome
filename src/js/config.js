const CONFIG = {
  // 搜索引擎配置
  searchEngines: {
    google: {
      name: 'Google',
      url: 'https://www.google.com/search?q=',
      icon: chrome.runtime.getURL('src/assets/icons/google.svg')
    },
    baidu: {
      name: '百度',
      url: 'https://www.baidu.com/s?wd=',
      icon: chrome.runtime.getURL('src/assets/icons/baidu.svg')
    },
    bing: {
      name: '必应',
      url: 'https://www.bing.com/search?q=',
      icon: chrome.runtime.getURL('src/assets/icons/bing.svg')
    },
    duckduckgo: {
      name: 'DuckDuckGo',
      url: 'https://duckduckgo.com/?q=',
      icon: chrome.runtime.getURL('src/assets/icons/duckduckgo.svg')
    },
    yahoo: {
      name: 'Yahoo',
      url: 'https://search.yahoo.com/search?p=',
      icon: chrome.runtime.getURL('src/assets/icons/yahoo.svg')
    },
    ecosia: {
      name: 'Ecosia',
      url: 'https://www.ecosia.org/search?q=',
      icon: chrome.runtime.getURL('src/assets/icons/ecosia.svg')
    },
    github: {
      name: 'GitHub',
      url: 'https://github.com/search?q=',
      icon: chrome.runtime.getURL('src/assets/icons/github.svg')
    },
    bilibili: {
      name: '哔哩哔哩',
      url: 'https://search.bilibili.com/all?keyword=',
      icon: chrome.runtime.getURL('src/assets/icons/bilibili.svg')
    }
  },

  // 预定义网站标题映射
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

  // 动画配置
  animation: {
    duration: 4500,
    timing: 'ease-in-out',
    glowColor: 'rgba(255, 255, 255, 0.3)',
    glowSize: '25px',
    glowBlur: '2px'
  },

  // 存储键名
  storageKeys: {
    squares: 'squares',
    searchEngine: 'searchEngine',
    settings: 'settings'
  },

  // 默认设置
  defaultSettings: {
    defaultSearchEngine: 'google',
    animationEnabled: true,
    darkMode: true
  },

  // 常量配置（替代魔法值）
  constants: {
    // 响应式断点
    MOBILE_BREAKPOINT: 768,
    TABLET_BREAKPOINT: 1024,

    // 动画时长
    ANIMATION_FAST: 150,
    ANIMATION_NORMAL: 300,
    ANIMATION_SLOW: 450,
    ANIMATION_SLIDE: 125, // icon-switching 动画的一半

    // 延迟时间
    DELAY_SHORT: 0,
    DELAY_MEDIUM: 100,
    DELAY_LONG: 300,

    // 节流/防抖时间
    THROTTLE_SAVE: 1000,
    DEBOUNCE_SEARCH: 300,

    // 图片配置
    FAVICON_SIZE: 64,
    MAX_BACKGROUND_FILE_SIZE: 5 * 1024 * 1024, // 5MB
    BACKGROUND_MAX_WIDTH: 1920,
    BACKGROUND_MAX_HEIGHT: 1080,
    BACKGROUND_QUALITY: 0.85,

    // 缓存配置
    FAVICON_CACHE_EXPIRY: 24 * 60 * 60 * 1000, // 24小时
    ICON_FETCH_TIMEOUT: 5000,

    // 拖拽配置
    DRAG_IMAGE_SIZE: 28,

    // 虚拟滚动配置
    VIRTUAL_SCROLL_ITEM_HEIGHT: 80,
    VIRTUAL_SCROLL_BUFFER: 5,
  },

  // 安全配置
  security: {
    // 危险协议列表
    dangerousProtocols: ['javascript:', 'data:', 'vbscript:', 'file:', 'ftp:'],
    // 允许的 URL 协议
    allowedProtocols: ['http:', 'https:'],
    // 最大文件大小
    maxFileSize: 5 * 1024 * 1024, // 5MB
    // 支持的图片格式
    supportedImageFormats: ['image/jpeg', 'image/png', 'image/webp']
  },

  // ARIA 标签配置
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

  // 错误消息
  errorMessages: {
    INVALID_URL: '无效的 URL',
    FILE_TOO_LARGE: '文件大小超过限制',
    UNSUPPORTED_FORMAT: '不支持的文件格式',
    SAVE_FAILED: '保存失败',
    LOAD_FAILED: '加载失败'
  }
};

// 防止配置被修改
Object.freeze(CONFIG);
Object.freeze(CONFIG.searchEngines);
Object.freeze(CONFIG.websiteTitles);
Object.freeze(CONFIG.animation);
Object.freeze(CONFIG.storageKeys);
Object.freeze(CONFIG.defaultSettings);
Object.freeze(CONFIG.constants);
Object.freeze(CONFIG.security);
Object.freeze(CONFIG.ariaLabels);
Object.freeze(CONFIG.errorMessages); 