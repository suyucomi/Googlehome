/**
 * core/utils.js — 无 DOM 依赖的通用工具（可在页面与 service worker 中共用）。
 */

/** HTML 转义（仅在必须拼接字符串时使用；优先 textContent） */
export function escapeHtml(value) {
  if (typeof value !== 'string') return value;
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/** 防抖：连续调用只在停止 wait 毫秒后执行一次，返回函数带 cancel() */
export function debounce(fn, wait = 0) {
  let timer = null;
  const wrapped = function (...args) {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn.apply(this, args);
    }, wait);
  };
  wrapped.cancel = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };
  return wrapped;
}

/** 节流：首次立即执行，结束后补一次尾部调用 */
export function throttle(fn, limit = 100) {
  let inThrottle = false;
  let lastRun = 0;
  let timer = null;
  return function (...args) {
    const context = this;
    const now = Date.now();
    if (!inThrottle) {
      fn.apply(context, args);
      lastRun = now;
      inThrottle = true;
      setTimeout(() => {
        inThrottle = false;
        if (timer) {
          clearTimeout(timer);
          timer = null;
          fn.apply(context, args);
          lastRun = Date.now();
        }
      }, limit);
      return;
    }
    clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      if (Date.now() - lastRun >= limit) {
        fn.apply(context, args);
        lastRun = Date.now();
      }
    }, Math.max(0, limit - (Date.now() - lastRun)));
  };
}

/** 将字符串稳定映射为 HSL 颜色（字母图标兜底） */
export function stringToColor(str) {
  const text = String(str || '');
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = text.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash % 360);
  return `hsl(${hue}, 65%, 45%)`;
}

/** 取 URL 的 host（失败返回 ''） */
export function domainOf(url) {
  try {
    return new URL(url).hostname;
  } catch (error) {
    return '';
  }
}

/** 是否可作为书签保存的 http(s) URL */
export function isHttpUrl(url) {
  if (typeof url !== 'string' || !url) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch (error) {
    return false;
  }
}

const LETTER_ICON_SVG = (letter, color) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">` +
  `<rect width="64" height="64" rx="14" fill="${color}"/>` +
  `<text x="32" y="34" font-family="Arial,Helvetica,sans-serif" font-size="30" fill="#fff" ` +
  `text-anchor="middle" dominant-baseline="central">${letter}</text></svg>`;

/** 字母占位图标（data URI） */
export function letterIcon(seed) {
  const text = String(seed || '?');
  const host = text.replace(/^https?:\/\//, '').split('/')[0] || '?';
  const letter = host.charAt(0).toUpperCase() || '?';
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(LETTER_ICON_SVG(letter, stringToColor(host)));
}

/**
 * 本地 favicon URL：优先 Chrome 内置 _favicon（同步、零网络）。
 * 按 host 缓存（同一站点多个书签不重复拼串），非法 URL 回退字母图标。
 */
export const faviconUrl = (() => {
  const cache = new Map();
  const MAX_CACHE = 800;
  return function resolveFavicon(url) {
    const host = domainOf(url);
    if (!host) return letterIcon(url);
    const cached = cache.get(host);
    if (cached) return cached;

    let resolved;
    try {
      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL) {
        resolved = chrome.runtime.getURL('/_favicon/?pageUrl=' + encodeURIComponent(url) + '&size=64');
      } else {
        resolved = letterIcon(host);
      }
    } catch (error) {
      resolved = letterIcon(host);
    }

    if (cache.size >= MAX_CACHE) cache.clear();
    cache.set(host, resolved);
    return resolved;
  };
})();

/** 生成页面/条目 id（时间戳 + 随机后缀，保持旧格式可读） */
export function uid(prefix = '') {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
}

/** 数字夹取 */
export function clamp(value, min, max) {
  return Math.min(Math.max(Number(value) || 0, min), max);
}

/** 数量文案：1234 → 1234（旧 UI 直接显示数字 + 「个书签」） */
export function formatCount(value) {
  return String(Number(value) || 0);
}

/** 安全 JSON 解析 */
export function safeJsonParse(text, fallback = null) {
  try {
    return JSON.parse(text);
  } catch (error) {
    return fallback;
  }
}

/** 系统是否开启「减少动态效果」 */
export function prefersReducedMotion() {
  try {
    return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch (error) {
    return false;
  }
}

/** 取 URL 的默认标题（域名主体，首字母大写） */
export function titleFromUrl(url) {
  const host = domainOf(url).replace(/^www\./, '');
  if (!host) return '网站';
  const main = host.split('.')[0] || host;
  return main
    .split(/[-_]/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ') || host;
}

/** 判断对象是否为普通对象（深合并用） */
export function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
