class ConfigManager {
  static #instance = null;
  
  static getInstance() {
    if (!this.#instance) {
      this.#instance = new ConfigManager();
    }
    return this.#instance;
  }
  
  // 使用私有字段
  #config = {};
  
  static async exportConfig() {
    try {
      const currentEngine = localStorage.getItem('currentSearchEngine');

      let settings = { settings: {} };
      let legacySquares = { squares: [] };
      let searchEngineStored = { searchEngine: undefined };
      let pagesMeta = { bookmarkPages: [], currentPageId: null };
      let perPage = {};

      if (window.chrome && chrome.storage && chrome.storage.local) {
        try {
          const meta = await chrome.storage.local.get(['settings', 'squares', 'searchEngine', 'bookmarkPages', 'currentPageId']);
          settings = { settings: meta.settings || {} };
          legacySquares = { squares: meta.squares || [] };
          searchEngineStored = { searchEngine: meta.searchEngine };
          pagesMeta = { bookmarkPages: meta.bookmarkPages || [], currentPageId: meta.currentPageId || null };
          if (pagesMeta.bookmarkPages && pagesMeta.bookmarkPages.length > 0) {
            const ids = pagesMeta.bookmarkPages.map(p => p.id);
            const results = await Promise.all(ids.map(id => chrome.storage.local.get(`squares_${id}`)));
            ids.forEach((id, idx) => {
              perPage[id] = results[idx][`squares_${id}`] || [];
            });
          }
        } catch (e) {
        }
      } else {
        try {
          const lsSettings = localStorage.getItem('settings');
          if (lsSettings) settings = { settings: JSON.parse(lsSettings) };
          const lsSquares = localStorage.getItem('squares');
          if (lsSquares) legacySquares = { squares: JSON.parse(lsSquares) };
        } catch (e) {}
        const listItems = document.querySelectorAll('.square-list-item');
        if ((!legacySquares.squares || legacySquares.squares.length === 0) && listItems.length > 0) {
          const rebuilt = Array.from(listItems).map(item => {
            const square = item.querySelector('.square-container');
            const title = item.querySelector('.square-title');
            return {
              url: square?.dataset?.url || '',
              title: title?.textContent || ''
            };
          });
          legacySquares = { squares: rebuilt };
        }
      }

      const data = {
        version: '1.1',
        timestamp: new Date().toISOString(),
        settings: settings.settings || {},
        searchEngine: currentEngine || searchEngineStored.searchEngine || 'google',
        bookmarkPages: pagesMeta.bookmarkPages || [],
        currentPageId: pagesMeta.currentPageId || null,
        pages: perPage,
        legacySquares: legacySquares.squares || []
      };
      
      // 创建 Blob
      const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: 'application/json'
      });
      
      // 创建下载链接
      const url = URL.createObjectURL(blob);
      const date = new Date().toISOString().split('T')[0];
      const filename = `search-config-${date}.json`;
      
      // 创建并触发下载
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      
      // 清理
      setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }, 0);
      
      this.showToast('配置已导出');
    } catch (error) {
      console.error('导出配置失败:', error);
      throw error;
    }
  }
  
  static async importConfig(file) {
    try {
      const text = await file.text();
      const config = JSON.parse(text);
      
      // 验证配置格式
      if (!this.validateConfig(config)) {
        throw new Error('配置文件格式无效');
      }
      
      // 确认导入
      if (!confirm('导入将覆盖现有配置，是否继续？')) {
        return;
      }
      
      // 显示导入进度
      this.showToast('正在导入配置...', 'info');
      
      if (window.chrome && chrome.storage && chrome.storage.local) {
        try {
          await chrome.storage.local.clear();
        } catch (e) {}
      }
      
      // 导入新配置
      if (config.settings) {
        if (window.chrome && chrome.storage && chrome.storage.local) {
          await chrome.storage.local.set({ settings: config.settings });
        } else {
          try { localStorage.setItem('settings', JSON.stringify(config.settings)); } catch (e) {}
        }
      }
      // 书签数据导入到本地存储
      if (config.squares) {
        if (window.chrome && chrome.storage && chrome.storage.local) {
          await chrome.storage.local.set({ squares: config.squares });
        } else {
          try { localStorage.setItem('squares', JSON.stringify(config.squares)); } catch (e) {}
        }
      }
      if (config.searchEngine) {
        if (window.chrome && chrome.storage && chrome.storage.local) {
          await chrome.storage.local.set({ searchEngine: config.searchEngine });
        }
        try { localStorage.setItem('currentSearchEngine', config.searchEngine); } catch (e) {}
      }

      if (config.bookmarkPages && Array.isArray(config.bookmarkPages)) {
        if (window.chrome && chrome.storage && chrome.storage.local) {
          await chrome.storage.local.set({ bookmarkPages: config.bookmarkPages });
          await chrome.storage.local.set({ currentPageId: config.currentPageId || null });
          const ids = config.bookmarkPages.map(p => p.id);
          await Promise.all(ids.map(id => chrome.storage.local.set({ [`squares_${id}`]: (config.pages && config.pages[id]) || [] })));
        } else {
          try {
            localStorage.setItem('bookmarkPages', JSON.stringify(config.bookmarkPages));
            if (config.currentPageId) localStorage.setItem('currentPageId', config.currentPageId);
          } catch (e) {}
        }
      } else if (config.legacySquares && Array.isArray(config.legacySquares)) {
        if (window.chrome && chrome.storage && chrome.storage.local) {
          await chrome.storage.local.set({ squares: config.legacySquares });
        } else {
          try { localStorage.setItem('squares', JSON.stringify(config.legacySquares)); } catch (e) {}
        }
      }
      
      // 显示成功消息
      this.showToast('配置导入成功，即将刷新页面');
      
      // 延迟刷新页面
      setTimeout(() => {
        window.location.reload();
      }, 1500);
      
    } catch (error) {
      console.error('导入配置失败:', error);
      this.showToast('导入配置失败: ' + error.message, 'error');
    }
  }
  
  static validateConfig(config) {
    if (!config || typeof config !== 'object') {
      return false;
    }
    if (!config.version) {
      return false;
    }
    const checkSquaresArr = (arr) => Array.isArray(arr) && arr.every(s => s && typeof s.url === 'string' && typeof s.title === 'string');
    if (config.squares && !checkSquaresArr(config.squares)) {
      return false;
    }
    if (config.legacySquares && !checkSquaresArr(config.legacySquares)) {
      return false;
    }
    if (config.bookmarkPages) {
      if (!Array.isArray(config.bookmarkPages)) return false;
      if (!config.bookmarkPages.every(p => p && typeof p.id === 'string' && typeof p.name === 'string')) return false;
      if (config.pages) {
        const ids = Object.keys(config.pages);
        for (const id of ids) {
          if (!checkSquaresArr(config.pages[id])) return false;
        }
      }
    }
    return true;
  }
  
  static showToast(message, type = 'success') {
    const existingToast = document.querySelector('.toast');
    if (existingToast) {
      existingToast.remove();
    }
    
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    
    document.body.appendChild(toast);
    toast.offsetHeight; // 触发重排以启动动画
    toast.classList.add('show');
    
    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => {
        if (toast.parentNode) {
          document.body.removeChild(toast);
        }
      }, 300);
    }, 3000);
  }
  
}

window.ConfigManager = ConfigManager; 
