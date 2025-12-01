// 共享的工具函数
window.getFavicon = (() => {
  const cache = new Map();
  const pendingRequests = new Map();
  // 缓存有效期：24小时（毫秒）
  const CACHE_EXPIRY = 24 * 60 * 60 * 1000;
  
  return async function(url) {
    const domain = new URL(url).hostname;
    
    // 先检查内存缓存
    if (cache.has(domain)) {
      return cache.get(domain);
    }
    
    // 防止重复请求
    if (pendingRequests.has(domain)) {
      return pendingRequests.get(domain);
    }
    
    const request = (async () => {
      try {
        // 尝试从 localStorage 缓存获取（带时间戳验证）
        const cacheKey = `favicon_${domain}`;
        const cachedData = localStorage.getItem(cacheKey);
        
        if (cachedData) {
          try {
            // 尝试解析为带时间戳的格式
            const parsed = JSON.parse(cachedData);
            if (parsed.icon && parsed.timestamp) {
              // 检查缓存是否过期
              if (Date.now() - parsed.timestamp < CACHE_EXPIRY) {
                cache.set(domain, parsed.icon);
                return parsed.icon;
              }
            } else {
              // 兼容旧格式（直接存储 base64 字符串）
              cache.set(domain, cachedData);
              return cachedData;
            }
          } catch (e) {
            // 如果解析失败，可能是旧格式，直接使用
            cache.set(domain, cachedData);
            return cachedData;
          }
        }

        // 尝试多个图标服务（按优先级）
        const iconServices = [
          `https://icon.horse/icon/${domain}`,
          `https://www.google.com/s2/favicons?sz=64&domain=${domain}`,
          `https://favicon.yandex.net/favicon/${domain}`,
          `https://api.faviconkit.com/${domain}/64`
        ];

        // 依次尝试不同的服务
        for (const serviceUrl of iconServices) {
          try {
            // 使用 Promise.race 实现超时控制（兼容性更好）
            const timeoutPromise = new Promise((_, reject) => {
              setTimeout(() => reject(new Error('Request timeout')), 5000);
            });
            
            const fetchPromise = fetch(serviceUrl).then(response => {
              if (response.ok) {
                return response.blob();
              }
              throw new Error(`HTTP ${response.status}`);
            });
            
            const blob = await Promise.race([fetchPromise, timeoutPromise]);
            const base64 = await new Promise((resolve) => {
              const reader = new FileReader();
              reader.onloadend = () => resolve(reader.result);
              reader.readAsDataURL(blob);
            });
            
            // 保存带时间戳的缓存
            const cacheData = {
              icon: base64,
              timestamp: Date.now()
            };
            localStorage.setItem(cacheKey, JSON.stringify(cacheData));
            cache.set(domain, base64);
            return base64;
          } catch (e) {
            // 继续尝试下一个服务
            if (e.message !== 'Request timeout') {
              console.warn(`Failed to fetch icon from ${serviceUrl}:`, e.message || e);
            }
            continue;
          }
        }

        // 如果所有服务都失败，生成默认图标
        const defaultIcon = generateDefaultIcon(domain);
        // 默认图标也缓存（但标记为默认图标，不设置过期时间）
        cache.set(domain, defaultIcon);
        return defaultIcon;
      } catch (e) {
        console.error('Error loading favicon:', e);
        const defaultIcon = generateDefaultIcon(url);
        cache.set(domain, defaultIcon);
        return defaultIcon;
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

// 优化全局错误处理
window.addEventListener('error', function(e) {
  // 添加错误分类处理
  const errorTypes = {
    NETWORK_ERROR: 'NetworkError',
    STORAGE_ERROR: 'StorageError',
    RUNTIME_ERROR: 'RuntimeError'
  };
  
  const errorHandler = {
    [errorTypes.NETWORK_ERROR]: handleNetworkError,
    [errorTypes.STORAGE_ERROR]: handleStorageError,
    [errorTypes.RUNTIME_ERROR]: handleRuntimeError
  };
  
  const errorType = determineErrorType(e.error);
  if (errorHandler[errorType]) {
    errorHandler[errorType](e.error);
  } else {
    console.error('未处理的错误:', e.error);
  }
});

// 添加错误上报机制
function reportError(error, context) {
  // 实现错误上报逻辑
}

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