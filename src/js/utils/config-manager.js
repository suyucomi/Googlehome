class ConfigManager {
  static async exportConfig() {
    try {
      // 获取所有配置数据
      const [settings, squares] = await Promise.all([
        chrome.storage.sync.get('settings'),
        chrome.storage.sync.get('squares')
      ]);
      
      // 修改数据结构
      const data = {
        version: '1.0',
        timestamp: new Date().toISOString(),
        settings: settings.settings || {},
        squares: squares.squares || []  // 直接使用 squares 数组
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
      this.showToast('导出配置失败', 'error');
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
      
      // 清除现有配置
      await chrome.storage.sync.clear();
      
      // 导入新配置
      if (config.settings) {
        await chrome.storage.sync.set({ settings: config.settings });
      }
      if (config.squares) {
        await chrome.storage.sync.set({ squares: config.squares });
      }
      
      // 显示成功消息
      this.showToast('配置导入成功，即将刷新页面');
      
      // 延迟刷新页面
      setTimeout(() => {
        window.location.reload();
      }, 1500);
      
    } catch (error) {
      console.error('导入配置失败:', error);
      this.showToast('导入配置��败: ' + error.message, 'error');
    }
  }
  
  static validateConfig(config) {
    // 只保留基本验证
    if (!config || typeof config !== 'object') {
      console.error('无效的配置对象');
      return false;
    }
    
    if (!config.version) {
      console.error('缺少版本信息');
      return false;
    }
    
    if (config.squares && !Array.isArray(config.squares)) {
      console.error('无效的方块数据格式');
      return false;
    }
    
    if (config.squares && !config.squares.every(square => 
      square && 
      typeof square.url === 'string' && 
      typeof square.title === 'string'
    )) {
      console.error('方块数据格式不正确');
      return false;
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
  
  static async loadImage(url) {
    if ('loading' in HTMLImageElement.prototype) {
      img.loading = 'lazy';
    } else {
      // 降级方案：使用 Intersection Observer
      const observer = new IntersectionObserver(/* ... */);
    }
  }
  
  static async saveConfig(config) {
    // 保留现有的保存实现...
  }
}

window.ConfigManager = ConfigManager; 