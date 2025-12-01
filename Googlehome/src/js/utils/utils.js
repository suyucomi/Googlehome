// 共享的工具函数 - 优化的图标获取
window.getFavicon = (() => {
  const cache = new Map();
  const pendingRequests = new Map();
  const REQUEST_TIMEOUT = 5000; // 5秒超时
  const CACHE_DURATION = 7 * 24 * 60 * 60 * 1000; // 7天缓存

  // 带超时的 fetch
  async function fetchWithTimeout(url, timeout = REQUEST_TIMEOUT) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        mode: 'cors',
        cache: 'no-cache'
      });
      clearTimeout(timeoutId);
      return response;
    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    }
  }

  // 将 blob 转换为 base64
  async function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  // 验证图片是否有效
  function isValidImage(blob) {
    return blob.type.startsWith('image/') && blob.size > 0;
  }

  // 获取所有可能的图标 URL
  function getIconUrls(url) {
    try {
      const urlObj = new URL(url);
      const domain = urlObj.hostname;
      const protocol = urlObj.protocol;
      const origin = `${protocol}//${domain}`;
      
      // 移除 www. 前缀用于某些服务
      const domainWithoutWww = domain.replace(/^www\./, '');
      
      return [
        // 直接从网站获取 favicon
        `${origin}/favicon.ico`,
        `${origin}/favicon.png`,
        `${protocol}//${domainWithoutWww}/favicon.ico`,
        
        // 第三方图标服务（按可靠性排序）
        `https://www.google.com/s2/favicons?domain=${domain}&sz=64`,
        `https://icon.horse/icon/${domain}`,
        `https://favicon.yandex.net/favicon/${domain}`,
        `https://api.faviconkit.com/${domain}/64`,
        `https://icons.duckduckgo.com/ip3/${domain}.ico`,
        `https://www.google.com/s2/favicons?domain=${domainWithoutWww}&sz=64`,
        `https://favicons.githubusercontent.com/${domain}`,
        `https://api.allorigins.win/raw?url=${encodeURIComponent(`${origin}/favicon.ico`)}`,
        `https://t0.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=${origin}&size=64`,
        `https://t1.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=${origin}&size=64`,
        `https://t2.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=${origin}&size=64`,
        `https://t3.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=${origin}&size=64`,
      ];
    } catch (e) {
      console.error('Error generating icon URLs:', e);
      return [];
    }
  }

  // 尝试从单个 URL 获取图标
  async function tryFetchIcon(url) {
    try {
      const response = await fetchWithTimeout(url, REQUEST_TIMEOUT);
      
      if (!response.ok) {
        return null;
      }

      const blob = await response.blob();
      
      // 验证是否是有效的图片
      if (!isValidImage(blob)) {
        return null;
      }

      // 检查文件大小（避免过大的文件）
      if (blob.size > 500 * 1024) { // 500KB
        console.warn(`Icon too large: ${blob.size} bytes from ${url}`);
        return null;
      }

      return await blobToBase64(blob);
    } catch (error) {
      // 静默失败，继续尝试下一个源
      return null;
    }
  }

  // 并发尝试多个图标源，返回第一个成功的
  async function fetchIconFromMultipleSources(urls) {
    // 创建一个 Promise，一旦有任何一个请求成功就立即 resolve
    return new Promise((resolve) => {
      let resolved = false;
      let completedCount = 0;
      const total = urls.length;
      
      // 为每个 URL 创建请求
      urls.forEach(async (url) => {
        try {
          const icon = await tryFetchIcon(url);
          if (icon && !resolved) {
            resolved = true;
            resolve(icon);
          }
        } catch (e) {
          // 静默失败
        } finally {
          completedCount++;
          // 如果所有请求都完成了且还没有成功的结果，返回 null
          if (completedCount === total && !resolved) {
            resolve(null);
          }
        }
      });
    });
  }

  return async function(url) {
    let domain;
    try {
      domain = new URL(url).hostname;
    } catch (e) {
      console.error('Invalid URL:', url);
      return generateDefaultIcon(url);
    }
    
    // 检查内存缓存
    if (cache.has(domain)) {
      return cache.get(domain);
    }
    
    // 防止重复请求
    if (pendingRequests.has(domain)) {
      return pendingRequests.get(domain);
    }
    
    const request = (async () => {
      try {
        // 尝试从 localStorage 缓存获取
        const cacheKey = `favicon_${domain}`;
        const cachedData = localStorage.getItem(cacheKey);
        
        if (cachedData) {
          try {
            const { icon, timestamp } = JSON.parse(cachedData);
            // 检查缓存是否过期
            if (Date.now() - timestamp < CACHE_DURATION) {
              cache.set(domain, icon);
              return icon;
            }
          } catch (e) {
            // 如果解析失败，清除旧缓存
            localStorage.removeItem(cacheKey);
          }
        }

        // 获取所有可能的图标 URL
        const iconUrls = getIconUrls(url);
        
        if (iconUrls.length === 0) {
          return generateDefaultIcon(domain);
        }

        // 并发尝试多个源
        const icon = await fetchIconFromMultipleSources(iconUrls);
        
        if (icon) {
          // 保存到缓存
          const cacheData = {
            icon: icon,
            timestamp: Date.now()
          };
          localStorage.setItem(cacheKey, JSON.stringify(cacheData));
          cache.set(domain, icon);
          return icon;
        }

        // 如果所有源都失败，生成默认图标
        const defaultIcon = generateDefaultIcon(domain);
        // 也缓存默认图标，避免重复生成
        cache.set(domain, defaultIcon);
        return defaultIcon;
      } catch (e) {
        console.error('Error loading favicon:', e);
        return generateDefaultIcon(domain);
      } finally {
        pendingRequests.delete(domain);
      }
    })();
    
    pendingRequests.set(domain, request);
    return request;
  };
})();

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

// 添加节流函数
window.throttle = function(func, limit) {
  let inThrottle;
  let lastSave = null;
  let timeout;
  
  return function(...args) {
    const context = this;
    
    if (!inThrottle) {
      func.apply(context, args);
      lastSave = Date.now();
      inThrottle = true;
    } else {
      clearTimeout(timeout);
      timeout = setTimeout(function() {
        if (Date.now() - lastSave >= limit) {
          func.apply(context, args);
          lastSave = Date.now();
        }
      }, limit - (Date.now() - lastSave));
    }
  };
};

// 添加防抖函数
window.debounce = function(func, wait) {
  let timeout;
  return function(...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), wait);
  };
};


// 添加调试日志函数
window.debug = {
  log: function(...args) {
    if (localStorage.getItem('debug') === 'true') {
      console.log(...args);
    }
  },
  error: function(...args) {
    console.error(...args);
  },
  warn: function(...args) {
    console.warn(...args);
  }
}; 