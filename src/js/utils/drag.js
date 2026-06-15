document.addEventListener('DOMContentLoaded', function() {
  const dropZone = document.getElementById('squaresContainer');

  if (!dropZone) {
    console.warn('Drop zone element not found');
    return;
  }

  function isValidUrl(url) {
    if (typeof url !== 'string') return false;

    const lowerUrl = url.toLowerCase().trim();
    if (Array.isArray(CONFIG?.security?.dangerousProtocols)) {
      for (const protocol of CONFIG.security.dangerousProtocols) {
        if (lowerUrl.startsWith(protocol)) {
          return false;
        }
      }
    }

    try {
      const urlObj = new URL(url);
      if (Array.isArray(CONFIG?.security?.allowedProtocols)) {
        return CONFIG.security.allowedProtocols.includes(urlObj.protocol);
      }
      return urlObj.protocol === 'http:' || urlObj.protocol === 'https:';
    } catch (e) {
      return false;
    }
  }

  function getDefaultTitle(url) {
    try {
      const hostname = new URL(url).hostname.replace('www.', '');
      const mainPart = hostname.split('.')[0] || hostname;
      return mainPart
        .split(/[-_]/)
        .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join(' ');
    } catch (e) {
      return '网站';
    }
  }

  function createLoadingSpinner() {
    const spinner = document.createElement('div');
    spinner.className = 'loading-spinner';
    return spinner;
  }

  async function createBookmarkListItem(url) {
    const title = getDefaultTitle(url);

    const listItem = document.createElement('div');
    listItem.className = 'square-list-item';

    const square = document.createElement('div');
    square.className = 'square-container';
    square.dataset.url = url;
    square.dataset.title = title;
    square.setAttribute('role', 'link');
    square.setAttribute('tabindex', '0');
    square.setAttribute('aria-label', `${title} - ${url}`);

    const titleSpan = document.createElement('span');
    titleSpan.className = 'square-title';
    titleSpan.textContent = title;

    const spinner = createLoadingSpinner();
    square.appendChild(spinner);

    square.addEventListener('click', function() {
      window.location.href = this.dataset.url;
    });

    square.addEventListener('keydown', function(e) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        window.location.href = this.dataset.url;
      }
    });

    square.addEventListener('contextmenu', function(e) {
      e.preventDefault();
      if (typeof window.createContextMenu === 'function') {
        window.createContextMenu(e.clientX, e.clientY, this);
      }
    });

    listItem.appendChild(square);
    listItem.appendChild(titleSpan);

    if (typeof window.addDragEvents === 'function') {
      window.addDragEvents(listItem);
    }

    dropZone.appendChild(listItem);

    let faviconUrl = null;
    if (typeof window.getFavicon === 'function') {
      try {
        faviconUrl = await window.getFavicon(url);
      } catch (error) {
        console.error('Error loading favicon:', error);
      }
    }

    if (spinner.parentNode) {
      spinner.remove();
    }

    if (faviconUrl) {
      square.style.setProperty('--favicon-url', `url('${faviconUrl}')`);
      square.style.setProperty('--favicon-size', '32px');
    }

    if (window.settingsManager) {
      window.settingsManager.updateSquaresHoverEffect();
    }

    await window.saveData();
  }

  // 防止浏览器默认的拖放行为
  document.addEventListener('dragover', function(e) {
    e.preventDefault();
  });

  // 处理拖放
  dropZone.addEventListener('drop', async function(e) {
    e.preventDefault();

    const url = (e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain') || '').trim();
    if (!isValidUrl(url)) {
      console.warn('Invalid URL dropped');
      return;
    }

    await createBookmarkListItem(url);
  });
});
