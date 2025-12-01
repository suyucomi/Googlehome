document.addEventListener('DOMContentLoaded', function() {
  const container = document.getElementById('squaresContainer');
  const searchInput = document.getElementById('searchInput');
  
  async function getFavicon(url) {
    if (window.getFavicon) {
      return await window.getFavicon(url);
    }
    return null;
  }

  // 创建加载动画
  function createLoadingSpinner() {
    const spinner = document.createElement('div');
    spinner.className = 'loading-spinner';
    return spinner;
  }

  // 获取网页标题的函数
  async function getWebsiteTitle(url) {
    try {
      const urlObj = new URL(url);
      const hostname = urlObj.hostname.replace('www.', '');

      // 使用配置文件中的预定义标题
      for (const [domain, title] of Object.entries(CONFIG.websiteTitles)) {
        if (hostname.includes(domain)) {
          return title;
        }
      }

      // 如果没有预定义标题，返回名
      return hostname;
    } catch (e) {
      console.error('Error processing URL:', e);
      const urlObj = new URL(url);
      return urlObj.hostname.replace('www.', '');
    }
  }

  // 将 createNameDialog 函数移到全局作用域
  window.createNameDialog = async function(url, initialName = '') {
    const existingOverlay = document.querySelector('.dialog-overlay');
    if (existingOverlay) {
      existingOverlay.remove();
    }

    const overlay = document.createElement('div');
    overlay.className = 'dialog-overlay';
    
    const dialog = document.createElement('div');
    dialog.className = 'name-dialog';
    
    // 创建头部
    const header = document.createElement('div');
    header.className = 'name-dialog-header';
    
    const icon = document.createElement('div');
    icon.className = 'site-icon';
    
    // 添加加载动画
    const spinner = createLoadingSpinner();
    icon.appendChild(spinner);
    
    const urlText = document.createElement('div');
    urlText.className = 'site-url';
    urlText.textContent = url;
    
    header.appendChild(icon);
    header.appendChild(urlText);
    
    // 创建内容区
    const content = document.createElement('div');
    content.className = 'name-dialog-content';
    
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'name-input';
    input.placeholder = '输入网站名称';
    
    // 如果有初始名称就使用它，否则获取网站标题
    if (initialName) {
      input.value = initialName;
    } else {
      // 异步获取标题
      getWebsiteTitle(url).then(title => {
        input.value = title;
      });
    }
    
    content.appendChild(input);
    
    // 建底部按钮
    const footer = document.createElement('div');
    footer.className = 'name-dialog-footer';
    
    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'dialog-btn btn-cancel';
    cancelBtn.textContent = '取消';
    
    const confirmBtn = document.createElement('button');
    confirmBtn.className = 'dialog-btn btn-confirm';
    confirmBtn.textContent = '确认';
    
    footer.appendChild(cancelBtn);
    footer.appendChild(confirmBtn);
    
    // 组装对话框
    dialog.appendChild(header);
    dialog.appendChild(content);
    dialog.appendChild(footer);
    overlay.appendChild(dialog);
    
    document.body.appendChild(overlay);
    
    // 异步加载图标
    getFavicon(url).then(faviconUrl => {
      if (faviconUrl) {
        spinner.remove();
        icon.style.backgroundImage = `url('${faviconUrl}')`;
      }
    }).catch(error => {
      console.error('Error loading favicon:', error);
      spinner.remove();
    });
    
    // 自动聚焦输入框
    input.focus();
    
    return new Promise((resolve) => {
      // 回车保存
      input.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          const result = { url, name: input.value.trim() };
          closeDialog(overlay, dialog, resolve, result);
        }
      });
      
      // 点击确认按钮保存
      confirmBtn.onclick = (e) => {
        e.stopPropagation();
        const result = { url, name: input.value.trim() };
        closeDialog(overlay, dialog, resolve, result);
      };
      
      // 取消操作
      cancelBtn.onclick = () => {
        closeDialog(overlay, dialog, resolve);
      };
      
      dialog.onclick = (e) => {
        e.stopPropagation();
      };
      
      overlay.onclick = () => {
        closeDialog(overlay, dialog, resolve);
      };
    });
  };

  // 将 closeDialog 函数移到全局作用域
  window.closeDialog = function(overlay, dialog, resolve, result = null) {
    overlay.classList.add('closing');
    dialog.classList.add('closing');
    
    setTimeout(() => {
      overlay.remove();
      resolve(result);
    }, 300);
  };

  // 添加 URL 验证
  function isValidUrl(url) {
    try {
      const urlObj = new URL(url);
      return ['http:', 'https:'].includes(urlObj.protocol);
    } catch (e) {
      return false;
    }
  }

  // 修改粘贴事件监听
  document.addEventListener('paste', async function(e) {
    if (document.activeElement === searchInput) return;
    
    e.preventDefault();
    const pastedText = e.clipboardData.getData('text');
    
    if (!isValidUrl(pastedText)) {
      console.warn('Invalid URL pasted');
      return;
    }
    
    const confirmed = await window.createNameDialog(pastedText);
    
    if (confirmed) {
      // 创建列表项容器
      const listItem = document.createElement('div');
      listItem.className = 'square-list-item';
      
      // 创建方块
      const square = document.createElement('div');
      square.className = 'square-container';
      square.dataset.url = confirmed.url;
      square.dataset.title = confirmed.name;
      
      // 创建标题元素
      const titleSpan = document.createElement('span');
      titleSpan.className = 'square-title';
      titleSpan.textContent = confirmed.name;
      
      // 设置初始状态
      square.style.opacity = '0';
      square.style.transform = 'scale(0.8) translateY(10px)';
      
      // 先显示加载动画
      const tempSpinner = createLoadingSpinner();
      square.appendChild(tempSpinner);
      
      // 添加点击事件
      square.addEventListener('click', function() {
        window.location.href = this.dataset.url;
      });
      
      // 添加右键菜单事件
      square.addEventListener('contextmenu', function(e) {
        e.preventDefault();
        window.createContextMenu(e.clientX, e.clientY, this);
      });
      
      // 组装列表项
      listItem.appendChild(square);
      listItem.appendChild(titleSpan);
      
      // 添加到容器
      container.appendChild(listItem);
      
      // 触发动画
      requestAnimationFrame(() => {
        square.style.transition = 'transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.3s ease';
        square.style.opacity = '1';
        square.style.transform = 'scale(1) translateY(0)';
      });
      
      // 先保存基本信息
      await window.saveData();
      
      // 然后异步下载图标
      const faviconUrl = await getFavicon(confirmed.url);
      if (faviconUrl) {
        tempSpinner.remove();
        square.style.setProperty('--favicon-url', `url('${faviconUrl}')`);
        square.style.setProperty('--favicon-size', '32px');
        
        // 再次保存，包含图标信息
        await window.saveData();
      }

      // 添加这一行，在添加新图标后更新悬浮效果
      if (window.settingsManager) {
        window.settingsManager.updateSquaresHoverEffect();
      }
    }
  });
}); 
