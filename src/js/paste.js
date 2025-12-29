document.addEventListener('DOMContentLoaded', function() {
  const container = document.getElementById('squaresContainer');
  const searchInput = document.getElementById('searchInput');
  
  // 辅助函数：获取域名首字母和颜色（用于默认图标显示）
  function getDomainInitial(url) {
    try {
      const domain = new URL(url).hostname;
      return {
        letter: domain.charAt(0).toUpperCase(),
        domain: domain
      };
    } catch (e) {
      return { letter: '?', domain: '' };
    }
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

      // 尝试从公共 API 获取网站标题
      try {
        // 使用多种 API 依次尝试
        const titleApis = [
          // 方法1: 使用 textise dot iitty（尝试获取页面文本）
          `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
          // 方法2: 使用 corsproxy
          `https://corsproxy.io/?${encodeURIComponent(url)}`
        ];

        for (const apiUrl of titleApis) {
          try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000);

            const response = await fetch(apiUrl, {
              signal: controller.signal,
              headers: {
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
              }
            });
            clearTimeout(timeoutId);

            if (response.ok) {
              const text = await response.text();
              // 尝试从 HTML 中提取 title
              const titleMatch = text.match(/<title[^>]*>([^<]+)<\/title>/i);
              if (titleMatch && titleMatch[1]) {
                const extractedTitle = titleMatch[1].trim();
                // 清理标题（移除常见的后缀）
                const cleanTitle = extractedTitle
                  .replace(/[\s-_|]+登录[\s-_|]*$/i, '')
                  .replace(/[\s-_|]*登录[\s-_|]*/i, '')
                  .replace(/ - .*/, '')
                  .replace(/ \| .*/, '')
                  .replace(/ @ .*/, '')
                  .trim();
                if (cleanTitle && cleanTitle.length > 0 && cleanTitle.length < 100) {
                  console.log(`✓ Fetched title for ${hostname}: ${cleanTitle}`);
                  return cleanTitle;
                }
              }
            }
          } catch (e) {
            // 继续尝试下一个 API
            continue;
          }
        }
      } catch (e) {
        // API 调用失败，继续使用默认方法
        console.warn('Failed to fetch title from APIs:', e);
      }

      // 如果无法获取真实标题，使用域名生成友好的标题
      return generateFriendlyTitle(hostname);
    } catch (e) {
      console.error('Error processing URL:', e);
      try {
        const urlObj = new URL(url);
        return generateFriendlyTitle(urlObj.hostname.replace('www.', ''));
      } catch (e2) {
        return '网站';
      }
    }
  }

  // 从域名生成友好的标题
  function generateFriendlyTitle(hostname) {
    // 移除端口号和路径
    const domain = hostname.split(':')[0].split('/')[0];

    // 常见的域名前缀和后缀映射
    const prefixes = {
      'blog': '博客',
      'news': '新闻',
      'mail': '邮箱',
      'docs': '文档',
      'help': '帮助',
      'api': 'API',
      'dev': '开发',
      'test': '测试',
      'app': '应用',
      'm': '手机',
      'mobile': '手机'
    };

    const suffixes = {
      'com': '',
      'cn': '中国',
      'net': '网络',
      'org': '组织',
      'io': '',
      'co': '',
      'app': '',
      'dev': '',
      'tech': '科技',
      'edu': '教育'
    };

    // 分割域名的各个部分
    const parts = domain.split('.');

    // 处理类似 "github.com" 的情况
    let mainPart = parts[0];
    let suffix = parts.length > 1 ? parts[parts.length - 1] : '';

    // 检查是否有前缀需要移除
    for (const [key, value] of Object.entries(prefixes)) {
      if (mainPart === key) {
        // 如果有第二部分，使用第二部分
        if (parts.length > 2) {
          mainPart = parts[1];
        } else {
          mainPart = '';
        }
        break;
      }
    }

    // 生成标题
    let title = '';

    if (mainPart) {
      // 将域名转换为标题格式（首字母大写，处理连字符）
      title = mainPart
        .split(/[-_]/)
        .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join(' ');

      // 添加后缀说明
      if (suffixes[suffix]) {
        title += suffixes[suffix];
      }
    } else {
      // 使用完整域名
      title = domain
        .split('.')
        .slice(0, -1)
        .join('.')
        .split(/[-_]/)
        .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join(' ');
    }

    return title || domain;
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
    input.placeholder = '正在获取网站名称...';

    // 如果有初始名称就使用它，否则异步获取网站标题
    if (initialName) {
      input.value = initialName;
      input.select(); // 自动选中，方便用户修改
    } else {
      // 立即显示域名作为临时标题
      const urlObj = new URL(url);
      const hostname = urlObj.hostname.replace('www.', '');
      input.value = generateFriendlyTitle(hostname);
      input.select(); // 自动选中

      // 异步获取更准确的标题
      getWebsiteTitle(url).then(title => {
        if (title && title !== input.value) {
          input.value = title;
          input.select(); // 更新后重新选中
        }
        input.placeholder = '输入网站名称';
      }).catch(err => {
        input.placeholder = '输入网站名称';
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
    
    // 异步加载图标（使用全局统一的 getFavicon 函数）
    if (typeof window.getFavicon === 'function') {
      window.getFavicon(url).then(faviconUrl => {
        if (faviconUrl && spinner.parentNode) {
          spinner.remove();
          icon.style.backgroundImage = `url('${faviconUrl}')`;
        }
      }).catch(error => {
        console.error('Error loading favicon:', error);
        if (spinner.parentNode) {
          spinner.remove();
        }
        // 显示默认图标（首字母）
        const { letter, domain } = getDomainInitial(url);
        if (domain) {
          icon.textContent = letter;
          // 使用简单的颜色方案
          const hash = domain.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
          const hue = Math.abs(hash % 360);
          icon.style.backgroundColor = `hsl(${hue}, 65%, 45%)`;
          icon.style.color = 'white';
          icon.style.display = 'flex';
          icon.style.justifyContent = 'center';
          icon.style.alignItems = 'center';
          icon.style.fontSize = '24px';
          icon.style.fontWeight = 'bold';
        }
      });
    } else {
      // 如果 getFavicon 还未加载，等待一下
      setTimeout(() => {
        if (typeof window.getFavicon === 'function') {
          window.getFavicon(url).then(faviconUrl => {
            if (faviconUrl && spinner.parentNode) {
              spinner.remove();
              icon.style.backgroundImage = `url('${faviconUrl}')`;
            }
          }).catch(error => {
            console.error('Error loading favicon:', error);
            if (spinner.parentNode) {
              spinner.remove();
            }
          });
        } else if (spinner.parentNode) {
          spinner.remove();
        }
      }, 100);
    }
    
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

  // 添加 URL 验证 - 阻止 javascript: 协议和其他危险协议
  function isValidUrl(url) {
    if (typeof url !== 'string') return false;

    // 使用配置中的危险协议列表
    const lowerUrl = url.toLowerCase().trim();
    for (const protocol of CONFIG.security.dangerousProtocols) {
      if (lowerUrl.startsWith(protocol)) {
        return false;
      }
    }

    try {
      const urlObj = new URL(url);
      // 使用配置中的允许协议列表
      return CONFIG.security.allowedProtocols.includes(urlObj.protocol);
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
    
    // 立即开始预加载图标并缓存（不等待对话框确认）
    let faviconPromise = null;
    if (typeof window.getFavicon === 'function') {
      faviconPromise = window.getFavicon(pastedText).catch(err => {
        console.warn('Failed to preload favicon:', err);
        return null;
      });
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
      
      // 使用预加载的图标或重新获取（使用全局统一的 getFavicon 函数）
      let faviconUrl = null;
      if (faviconPromise) {
        // 如果之前已经开始预加载，等待它完成
        faviconUrl = await faviconPromise;
      }
      
      // 如果预加载失败或未开始，重新获取
      if (!faviconUrl && typeof window.getFavicon === 'function') {
        try {
          faviconUrl = await window.getFavicon(confirmed.url);
        } catch (error) {
          console.error('Error loading favicon:', error);
        }
      }
      
      if (faviconUrl) {
        if (tempSpinner.parentNode) {
          tempSpinner.remove();
        }
        square.style.setProperty('--favicon-url', `url('${faviconUrl}')`);
        square.style.setProperty('--favicon-size', '32px');
        
        // 再次保存，包含图标信息
        await window.saveData();
      } else if (tempSpinner.parentNode) {
        tempSpinner.remove();
      }

      // 添加这一行，在添加新图标后更新悬浮效果
      if (window.settingsManager) {
        window.settingsManager.updateSquaresHoverEffect();
      }
    }
  });
}); 