document.addEventListener('DOMContentLoaded', () => {
  const searchInput = document.getElementById('searchInput');
  const searchEngine = document.getElementById('searchEngine');
  const searchEngineDropdown = document.getElementById('searchEngineDropdown');
  const searchSelectContainer = searchEngine?.parentElement;
  const settingsPanel = document.getElementById('settingsPanel');
  const menuButton = document.getElementById('menuButton');
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
        .then(response => response.text())
        .then(svgContent => {
          icon.style.backgroundImage = `url('data:image/svg+xml;base64,${btoa(svgContent)}')`;
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
    
    searchEngine.classList.add('changing');
    
    fetch(engine.icon)
      .then(response => response.text())
      .then(svgContent => {
        requestAnimationFrame(() => {
          searchEngine.style.backgroundImage = `url('data:image/svg+xml;base64,${btoa(svgContent)}')`;
          searchEngine.classList.remove('changing');
        });
      });
  };
  
  // 切换下拉列表
  searchEngine?.addEventListener('click', (e) => {
    e.stopPropagation();
    searchSelectContainer?.classList.toggle('active');
  });
  
  // 点击外部关闭下拉列表和设置面板
  document.addEventListener('click', () => {
    searchSelectContainer?.classList.remove('active');
    settingsPanel?.classList.remove('active');
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

  // 设置面板控制
  menuButton?.addEventListener('click', (e) => {
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
  const exportAll = document.getElementById('exportAll');
  const exportIcons = document.getElementById('exportIcons');
  const exportSettings = document.getElementById('exportSettings');
  const importConfig = document.getElementById('importConfig');
  const resetDefault = document.getElementById('resetDefault');
  const configFileInput = document.getElementById('configFileInput');
  const exportConfig = document.getElementById('exportConfig');

  // 导出所有配置
  exportAll?.addEventListener('click', async () => {
    try {
      await ConfigManager.exportConfig();
    } catch (error) {
      ConfigManager.showToast('导出失败', 'error');
    }
  });

  // 仅导出图标
  exportIcons?.addEventListener('click', async () => {
    try {
      const data = await chrome.storage.sync.get('squares');
      const blob = new Blob([JSON.stringify({ squares: data.squares }, null, 2)], {
        type: 'application/json'
      });
      const url = URL.createObjectURL(blob);
      const date = new Date().toISOString().split('T')[0];
      const a = document.createElement('a');
      a.href = url;
      a.download = `search-icons-${date}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      ConfigManager.showToast('图标配置已导出');
    } catch (error) {
      ConfigManager.showToast('导出失败', 'error');
    }
  });

  // 仅导出设置
  exportSettings?.addEventListener('click', async () => {
    try {
      const data = await chrome.storage.sync.get('settings');
      const blob = new Blob([JSON.stringify({ settings: data.settings }, null, 2)], {
        type: 'application/json'
      });
      const url = URL.createObjectURL(blob);
      const date = new Date().toISOString().split('T')[0];
      const a = document.createElement('a');
      a.href = url;
      a.download = `search-settings-${date}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      ConfigManager.showToast('设置已导出');
    } catch (error) {
      ConfigManager.showToast('导出失败', 'error');
    }
  });

  // 导出配置
  exportConfig?.addEventListener('click', async () => {
    try {
      await ConfigManager.exportConfig();
    } catch (error) {
      console.error('导出失败:', error);
      ConfigManager.showToast('导出失败', 'error');
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
        await ConfigManager.importConfig(file);
      } catch (error) {
        console.error('导入失败:', error);
        ConfigManager.showToast('导入失败', 'error');
      }
    }
    // 清空选择，允许选择相同文件
    e.target.value = '';
  });

  // 恢复默认设置
  resetDefault?.addEventListener('click', async () => {
    if (confirm('确定要恢复默认设置吗？这将清除所有自定义配置。')) {
      try {
        await chrome.storage.sync.clear();
        window.location.reload();
      } catch (error) {
        ConfigManager.showToast('恢复默认设置失败', 'error');
      }
    }
  });

  // 阻止设置面板内的点击事件冒泡
  const settingsContent = document.querySelector('.settings-content');
  settingsContent?.addEventListener('click', (e) => {
    e.stopPropagation();
  });
});

// 禁用右键菜单
document.addEventListener('contextmenu', e => e.preventDefault()); 

// 按需加载模块
async function loadSettingsModule() {
  const { SettingsManager } = await import('./utils/settings-manager.js');
  return new SettingsManager();
}