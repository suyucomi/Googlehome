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
    duration: 4500,  // 动画持续时间（毫秒）
    timing: 'ease-in-out',  // 动画缓动函数
    glowColor: 'rgba(255, 255, 255, 0.3)',  // 发光颜色
    glowSize: '25px',  // 发光大小
    glowBlur: '2px'  // 发光模糊度
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
  }
};

// 防止配置被修改
Object.freeze(CONFIG); 