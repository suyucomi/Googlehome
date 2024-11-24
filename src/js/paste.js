document.addEventListener('DOMContentLoaded', function() {
  const container = document.getElementById('squaresContainer');
  const searchInput = document.getElementById('searchInput');
  
  // 获取网站图标的函数
  async function getFavicon(url) {
    try {
      const urlObj = new URL(url);
      const domain = urlObj.hostname;
      
      // 尝试多个图标服务
      const iconServices = [
        `https://icon.horse/icon/${domain}`,
        `https://www.google.com/s2/favicons?sz=64&domain=${domain}`,
        `https://favicon.yandex.net/favicon/${domain}`,
        `https://api.faviconkit.com/${domain}/64`
      ];

      // 尝试从缓存获取
      const cachedIcon = localStorage.getItem(`favicon_${domain}`);
      if (cachedIcon) {
        return cachedIcon;
      }

      // 依次尝试不同的服务
      for (const serviceUrl of iconServices) {
        try {
          const response = await fetch(serviceUrl);
          if (response.ok) {
            const blob = await response.blob();
            const base64 = await new Promise((resolve) => {
              const reader = new FileReader();
              reader.onloadend = () => resolve(reader.result);
              reader.readAsDataURL(blob);
            });
            
            // 缓存成功获取的图标
            localStorage.setItem(`favicon_${domain}`, base64);
            return base64;
          }
        } catch (e) {
          console.warn(`Failed to fetch icon from ${serviceUrl}:`, e);
          continue;
        }
      }

      // 如果所有服务都失败，返回默认图标
      return generateDefaultIcon(domain);
    } catch (e) {
      console.error('Error in getFavicon:', e);
      return generateDefaultIcon(url);
    }
  }

  // 生成默认图标
  function generateDefaultIcon(url) {
    try {
      const domain = new URL(url).hostname;
      const letter = domain.charAt(0).toUpperCase();
      const color = stringToColor(domain);
      
      const svg = `
        <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
          <rect width="64" height="64" rx="12" fill="${color}"/>
          <text x="32" y="32" font-family="Arial" font-size="32" fill="white" 
                text-anchor="middle" dominant-baseline="central">${letter}</text>
        </svg>
      `;
      
      return `data:image/svg+xml;base64,${btoa(svg)}`;
    } catch (e) {
      console.error('Error generating default icon:', e);
      return 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI2NCIgaGVpZ2h0PSI2NCIgdmlld0JveD0iMCAwIDY0IDY0Ij48cmVjdCB3aWR0aD0iNjQiIGhlaWdodD0iNjQiIHJ4PSIxMiIgZmlsbD0iIzMwMzEzNCIvPjx0ZXh0IHg9IjMyIiB5PSIzMiIgZm9udC1mYW1pbHk9IkFyaWFsIiBmb250LXNpemU9IjMyIiBmaWxsPSJ3aGl0ZSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZG9taW5hbnQtYmFzZWxpbmU9ImNlbnRyYWwiPj88L3RleHQ+PC9zdmc+';
    }
  }

  // 将字符串转换为颜色
  function stringToColor(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    const hue = Math.abs(hash % 360);
    return `hsl(${hue}, 65%, 45%)`;
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

      // 如果没有预定义标题，返回���名
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
      // 显示一个默认图标或者网站首字母
      const domain = new URL(url).hostname;
      icon.textContent = domain.charAt(0).toUpperCase();
      icon.style.backgroundColor = stringToColor(domain);
      icon.style.color = 'white';
      icon.style.display = 'flex';
      icon.style.justifyContent = 'center';
      icon.style.alignItems = 'center';
      icon.style.fontSize = '24px';
      icon.style.fontWeight = 'bold';
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