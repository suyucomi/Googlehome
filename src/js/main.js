document.addEventListener('DOMContentLoaded', () => {
  const searchInput = document.getElementById('searchInput');
  const searchEngine = document.getElementById('searchEngine');
  const searchEngineDropdown = document.getElementById('searchEngineDropdown');
  const searchSelectContainer = searchEngine?.parentElement;
  const settingsPanel = document.getElementById('settingsPanel');
  const closeSettings = document.getElementById('closeSettings');
  
  let currentEngine = localStorage.getItem('currentSearchEngine') || 'google';

  // 初始化搜索引擎选项
  if (searchEngineDropdown && searchEngine) {
    Object.entries(CONFIG.searchEngines).forEach(([key, engine]) => {
      const option = document.createElement('div');
      option.className = 'search-select-option';
      option.dataset.value = key;
      
      const icon = document.createElement('div');
      icon.className = 'search-select-option-icon';
      
      // 加载 SVG 图标
      fetch(engine.icon)
        .then(response => {
          if (!response.ok) {
            throw new Error(`Failed to load icon: ${response.status}`);
          }
          return response.text();
        })
        .then(svgContent => {
          icon.style.backgroundImage = `url('data:image/svg+xml;base64,${btoa(svgContent)}')`;
        })
        .catch(error => {
          console.warn(`Failed to load icon for ${engine.name}:`, error);
          // 使用默认图标或隐藏图标
        });
      
      const text = document.createElement('span');
      text.textContent = engine.name;
      
      option.appendChild(icon);
      option.appendChild(text);
      searchEngineDropdown.appendChild(option);
      
      option.addEventListener('click', () => {
        currentEngine = key;
        updateSearchEngine();
        searchSelectContainer?.classList.remove('active');
        localStorage.setItem('currentSearchEngine', currentEngine);
      });
    });
  }
  
  // 更新搜索框和图标
  const updateSearchEngine = () => {
    if (!searchEngine || !searchInput) return;
    
    const engine = CONFIG.searchEngines[currentEngine];
    searchInput.placeholder = `在 ${engine.name} 上搜索`;
    searchEngine.dataset.engine = currentEngine;
    
    // 直接更新图标，不使用动画类
    fetch(engine.icon)
      .then(response => {
        if (!response.ok) {
          throw new Error(`Failed to load icon: ${response.status}`);
        }
        return response.text();
      })
      .then(svgContent => {
        searchEngine.style.backgroundImage = `url('data:image/svg+xml;base64,${btoa(svgContent)}')`;
      })
      .catch(error => {
        console.warn(`Failed to load icon for ${engine.name}:`, error);
        // 使用默认图标或隐藏图标
      });
  };
  
  // 切换下拉列表
  searchEngine?.addEventListener('click', (e) => {
    e.stopPropagation();
    searchSelectContainer?.classList.toggle('active');
  });
  
  // 点击外部关闭下拉列表和设置面板
  document.addEventListener('click', (e) => {
    searchSelectContainer?.classList.remove('active');
    // 如果点击的不是侧边栏内部，关闭设置面板
    if (!e.target.closest('.sidebar') && !e.target.closest('.settings-panel')) {
      settingsPanel?.classList.remove('active');
    }
  });
  
  // 初始化
  updateSearchEngine();
  
  // 处理搜索
  searchInput?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter' && searchInput.value.trim()) {
      const engine = CONFIG.searchEngines[currentEngine];
      window.location.href = engine.url + encodeURIComponent(searchInput.value.trim());
    }
  });
  
  // 添加键盘导航
  searchInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Tab' && !e.shiftKey) {
      e.preventDefault();
      const squares = document.querySelectorAll('.square-container');
      if (squares.length > 0) {
        squares[0].focus();
      }
    }
  });

  // 侧边栏设置按钮控制
  const sidebarSettingsBtn = document.getElementById('sidebarSettingsBtn');
  sidebarSettingsBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    settingsPanel?.classList.toggle('active');
  });

  closeSettings?.addEventListener('click', () => {
    settingsPanel?.classList.remove('active');
  });

  settingsPanel?.addEventListener('click', (e) => {
    e.stopPropagation();
  });

  // 添加搜索引擎快捷键
  document.addEventListener('keydown', (e) => {
    if (e.altKey && !isNaN(e.key)) {
      const index = parseInt(e.key) - 1;
      const engines = Object.keys(CONFIG.searchEngines);
      if (index >= 0 && index < engines.length) {
        currentEngine = engines[index];
        updateSearchEngine();
        searchInput?.focus();
      }
    }
  });

  // 添加设置面板功能按钮的事件监听
  const importConfig = document.getElementById('importConfig');
  const configFileInput = document.getElementById('configFileInput');
  const exportConfig = document.getElementById('exportConfig');

  // 导出配置
  exportConfig?.addEventListener('click', async () => {
    try {
      if (window.ConfigManager) {
        await window.ConfigManager.exportConfig();
      }
    } catch (error) {
      console.error('导出失败:', error);
      if (window.ConfigManager) {
        window.ConfigManager.showToast('导出失败', 'error');
      }
    }
  });

  // 导入配置
  importConfig?.addEventListener('click', () => {
    configFileInput?.click();
  });

  // 处理文件选择
  configFileInput?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (file) {
      try {
        if (window.ConfigManager) {
          await window.ConfigManager.importConfig(file);
        }
      } catch (error) {
        console.error('导入失败:', error);
        if (window.ConfigManager) {
          window.ConfigManager.showToast('导入失败', 'error');
        }
      }
    }
    // 清空选择，允许选择相同文件
    e.target.value = '';
  });

  // 阻止设置面板内的点击事件冒泡
  const settingsContent = document.querySelector('.settings-content');
  settingsContent?.addEventListener('click', (e) => {
    e.stopPropagation();
  });
  
  // 初始化侧边栏
  initSidebar();
});

// 侧边栏管理器
class SidebarManager {
  constructor() {
    this.sidebar = document.getElementById('sidebar');
    this.sidebarToggle = document.getElementById('sidebarToggle');
    this.sidebarTrigger = document.getElementById('sidebarTrigger');
    this.sidebarOverlay = document.getElementById('sidebarOverlay');
    this.addPageBtn = document.getElementById('addPageBtn');
    this.container = document.querySelector('.container');
    
    // 状态管理
    this.isOpen = false;
    this.isAnimating = false;
    this.storageKey = 'sidebarState';
    
    // 响应式断点
    this.isMobile = window.innerWidth <= 768;
    
    if (!this.sidebar || !this.sidebarToggle) return;
    
    this.init();
  }
  
  init() {
    // 从本地存储恢复状态（仅桌面端）
    if (!this.isMobile) {
      const savedState = localStorage.getItem(this.storageKey);
      if (savedState === 'open') {
        this.isOpen = true;
        this.sidebar.classList.remove('collapsed');
        if (this.container) {
          this.container.classList.add('sidebar-open');
        }
        // 隐藏触发按钮
        if (this.sidebarTrigger) {
          this.sidebarTrigger.classList.remove('show-on-desktop');
        }
      } else if (savedState === 'closed') {
        // 明确设置为关闭状态
        this.isOpen = false;
        this.sidebar.classList.add('collapsed');
        if (this.container) {
          this.container.classList.remove('sidebar-open');
        }
        // 显示触发按钮
        if (this.sidebarTrigger) {
          this.sidebarTrigger.classList.add('show-on-desktop');
        }
      } else {
        // 首次访问，默认打开（桌面端）
        this.isOpen = true;
        this.sidebar.classList.remove('collapsed');
        if (this.container) {
          this.container.classList.add('sidebar-open');
        }
        // 隐藏触发按钮
        if (this.sidebarTrigger) {
          this.sidebarTrigger.classList.remove('show-on-desktop');
        }
        // 保存初始状态
        localStorage.setItem(this.storageKey, 'open');
      }
    } else {
      // 移动端默认关闭
      this.isOpen = false;
      this.sidebar.classList.add('collapsed');
      // 移动端容器不需要左边距
      if (this.container) {
        this.container.classList.remove('sidebar-open');
      }
    }
    
    // 绑定事件
    this.bindEvents();
    
    // 监听窗口大小变化
    window.addEventListener('resize', () => {
      this.handleResize();
    });
  }
  
  bindEvents() {
    // 切换按钮点击事件
    this.sidebarToggle.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggle();
    });
    
    // 触发按钮点击事件（移动端）
    this.sidebarTrigger?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.open();
    });
    
    // 遮罩层点击关闭
    this.sidebarOverlay?.addEventListener('click', () => {
      this.close();
    });
    
    // 阻止侧边栏内部点击事件冒泡
    this.sidebar.addEventListener('click', (e) => {
      e.stopPropagation();
    });
    
    // ESC 键关闭侧边栏
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isOpen) {
        this.close();
      }
    });
    
    // 添加新页面按钮
    this.addPageBtn?.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (window.pageManager) {
        await window.pageManager.createPage();
        if (window.ConfigManager) {
          window.ConfigManager.showToast('新页面已创建');
        }
      }
    });
  }
  
  // 打开侧边栏
  open() {
    if (this.isAnimating || this.isOpen) return;
    
    this.isAnimating = true;
    this.isOpen = true;
    
    // 移除收起状态
    this.sidebar.classList.remove('collapsed');
    
    // 隐藏触发按钮（桌面端）
    if (!this.isMobile && this.sidebarTrigger) {
      this.sidebarTrigger.classList.remove('show-on-desktop');
    }
    
    // 显示遮罩层
    if (this.sidebarOverlay) {
      this.sidebarOverlay.classList.add('active');
    }
    
    // 调整容器位置（桌面端）
    if (!this.isMobile && this.container) {
      this.container.classList.add('sidebar-open');
    } else if (this.isMobile && this.container) {
      // 移动端打开时不需要调整容器位置
      this.container.classList.remove('sidebar-open');
    }
    
    // 移动端防止背景滚动
    if (this.isMobile) {
      document.body.classList.add('sidebar-open-mobile');
    }
    
    // 保存状态（仅桌面端）
    if (!this.isMobile) {
      localStorage.setItem(this.storageKey, 'open');
    }
    
    // 动画完成后重置标志
    setTimeout(() => {
      this.isAnimating = false;
    }, 300);
    
    // 触发自定义事件
    this.dispatchEvent('sidebar:opened');
  }
  
  // 关闭侧边栏
  close() {
    if (this.isAnimating || !this.isOpen) return;
    
    this.isAnimating = true;
    this.isOpen = false;
    
    // 添加收起状态
    this.sidebar.classList.add('collapsed');
    
    // 显示触发按钮（桌面端）
    if (!this.isMobile && this.sidebarTrigger) {
      this.sidebarTrigger.classList.add('show-on-desktop');
    }
    
    // 隐藏遮罩层
    if (this.sidebarOverlay) {
      this.sidebarOverlay.classList.remove('active');
    }
    
    // 恢复容器位置
    if (this.container) {
      this.container.classList.remove('sidebar-open');
    }
    
    // 移动端恢复背景滚动
    document.body.classList.remove('sidebar-open-mobile');
    
    // 保存状态（仅桌面端）
    if (!this.isMobile) {
      localStorage.setItem(this.storageKey, 'closed');
    }
    
    // 动画完成后重置标志
    setTimeout(() => {
      this.isAnimating = false;
    }, 300);
    
    // 触发自定义事件
    this.dispatchEvent('sidebar:closed');
  }
  
  // 切换侧边栏状态
  toggle() {
    if (this.isOpen) {
      this.close();
    } else {
      this.open();
    }
  }
  
  // 处理窗口大小变化
  handleResize() {
    const wasMobile = this.isMobile;
    this.isMobile = window.innerWidth <= 768;
    
    // 从移动端切换到桌面端
    if (wasMobile && !this.isMobile) {
      // 移除移动端样式
      document.body.classList.remove('sidebar-open-mobile');
      // 恢复保存的状态
      const savedState = localStorage.getItem(this.storageKey);
      if (savedState === 'open') {
        this.open();
      } else {
        this.close();
      }
    }
    
    // 从桌面端切换到移动端
    if (!wasMobile && this.isMobile) {
      // 移动端默认关闭
      if (this.isOpen) {
        document.body.classList.add('sidebar-open-mobile');
      }
      // 如果侧边栏是打开的，保持打开状态但应用移动端样式
    }
  }
  
  // 触发自定义事件
  dispatchEvent(eventName) {
    const event = new CustomEvent(eventName, {
      detail: { isOpen: this.isOpen }
    });
    document.dispatchEvent(event);
  }
  
  // 获取当前状态
  getState() {
    return {
      isOpen: this.isOpen,
      isMobile: this.isMobile
    };
  }
}

// 初始化侧边栏
function initSidebar() {
  window.sidebarManager = new SidebarManager();
}

// 禁用右键菜单
document.addEventListener('contextmenu', e => e.preventDefault());
