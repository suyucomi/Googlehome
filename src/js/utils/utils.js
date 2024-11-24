// 共享的工具函数
window.getFavicon = (() => {
  const cache = new Map();
  const pendingRequests = new Map();
  
  return async function(url) {
    const domain = new URL(url).hostname;
    
    if (cache.has(domain)) {
      return cache.get(domain);
    }
    
    // 防止重复请求
    if (pendingRequests.has(domain)) {
      return pendingRequests.get(domain);
    }
    
    const request = (async () => {
      try {
        // 尝试从缓存获取
        const cachedIcon = localStorage.getItem(`favicon_${domain}`);
        if (cachedIcon) {
          return cachedIcon;
        }

        // 尝试获取图标
        const response = await fetch(`https://icon.horse/icon/${domain}`);
        if (response.ok) {
          const blob = await response.blob();
          const base64 = await new Promise((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.readAsDataURL(blob);
          });
          
          // 缓存图标
          localStorage.setItem(`favicon_${domain}`, base64);
          cache.set(domain, base64);
          return base64;
        }

        // 如果获取失败，生成默认图标
        return generateDefaultIcon(domain);
      } catch (e) {
        console.error('Error loading favicon:', e);
        return generateDefaultIcon(url);
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

// 添加全局错误处理
window.addEventListener('error', function(e) {
  console.error('Global error:', e.error);
});

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