// HTML 转义工具函数，防止 XSS 攻击
function escapeHtml(unsafe) {
  if (typeof unsafe !== 'string') return unsafe;
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// 书签页面管理器
class PageManager {
  constructor() {
    this.currentPageId = null;
    this.pages = [];
    this.initialized = false;
    // 延迟初始化，等待DOM加载完成
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => this.init());
    } else {
      // 如果DOM已加载，延迟一点确保其他脚本已加载
      setTimeout(() => this.init(), CONFIG.constants.DELAY_MEDIUM);
    }
  }

  async init() {
    if (this.initialized) return;
    
    // 从存储加载页面列表
    await this.loadPages();
    
    // 如果没有页面，创建默认页面
    if (this.pages.length === 0) {
      await this.createPage('默认页面');
    }
    
    // 设置当前页面
    if (!this.currentPageId && this.pages.length > 0) {
      this.currentPageId = this.pages[0].id;
      await this.saveCurrentPageId();
    }
    
    // 渲染页面列表
    this.renderPages();
    
    // 渲染悬浮图标
    this.renderFloatingIcons();
    
    // 加载当前页面的书签（首次加载，跳过动画）
    if (this.currentPageId) {
      await this.loadPageBookmarks(this.currentPageId, true);
    }
    
    this.initialized = true;
  }

  // 加载页面列表
  async loadPages() {
    try {
      const data = await chrome.storage.local.get(['bookmarkPages', 'currentPageId']);
      this.pages = data.bookmarkPages || [];
      this.currentPageId = data.currentPageId || null;
    } catch (error) {
      console.error('加载页面列表失败:', error);
      this.pages = [];
    }
  }

  // 保存页面列表
  async savePages() {
    try {
      await chrome.storage.local.set({ bookmarkPages: this.pages });
    } catch (error) {
      console.error('保存页面列表失败:', error);
    }
  }

  // 保存当前页面ID
  async saveCurrentPageId() {
    try {
      await chrome.storage.local.set({ currentPageId: this.currentPageId });
    } catch (error) {
      console.error('保存当前页面ID失败:', error);
    }
  }

  // 创建新页面
  async createPage(name = null) {
    // 确保页面名称唯一
    let pageName = name || `页面 ${this.pages.length + 1}`;
    let counter = 1;
    const originalName = pageName;
    while (this.pages.some(p => p.name === pageName)) {
      pageName = `${originalName} ${counter}`;
      counter++;
    }
    
    const newPage = {
      id: Date.now().toString() + Math.random().toString(36).substr(2, 9), // 确保ID唯一
      name: pageName,
      createdAt: new Date().toISOString(),
      bookmarkCount: 0
    };
    
    this.pages.push(newPage);
    await this.savePages();
    this.renderPages();
    this.renderFloatingIcons();
    
    // 切换到新页面
    await this.switchPage(newPage.id);
    
    return newPage;
  }

  // 删除页面
  async deletePage(pageId) {
    if (this.pages.length <= 1) {
      if (window.ConfigManager) {
        window.ConfigManager.showToast('至少需要保留一个页面', 'error');
      }
      return;
    }
    
    if (confirm('确定要删除这个页面吗？页面中的所有书签也会被删除。')) {
      // 删除页面的书签数据
      await chrome.storage.local.remove(`squares_${pageId}`);
      
      // 从列表中移除
      this.pages = this.pages.filter(p => p.id !== pageId);
      await this.savePages();
      
      // 如果删除的是当前页面，切换到第一个页面
      if (this.currentPageId === pageId) {
        if (this.pages.length > 0) {
          await this.switchPage(this.pages[0].id);
        }
      }
      
      this.renderPages();
      this.renderFloatingIcons();
      if (window.ConfigManager) {
        window.ConfigManager.showToast('页面已删除');
      }
    }
  }

  // 重命名页面
  async renamePage(pageId, newName) {
    const page = this.pages.find(p => p.id === pageId);
    if (page) {
      page.name = newName;
      await this.savePages();
      this.renderPages();
    }
  }

  // 切换页面
  async switchPage(pageId) {
    if (this.currentPageId === pageId) return;
    
    // 保存当前页面的书签
    if (this.currentPageId && window.saveData) {
      await window.saveData();
    }
    
    // 切换到新页面
    this.currentPageId = pageId;
    await this.saveCurrentPageId();
    
    // 立即更新页面图标状态（无延迟）
    this.renderPages();
    this.renderFloatingIcons();
    
    // 清空当前书签（立即清空，不等待动画）
    const container = document.getElementById('squaresContainer');
    if (container) {
      container.innerHTML = '';
    }
    
    // 加载新页面的书签（慢慢浮现）
    await this.loadPageBookmarks(pageId);
    
    // 更新页面计数
    await this.updatePageCount(pageId);
  }

  // 加载页面的书签
  async loadPageBookmarks(pageId, skipAnimation = false) {
    try {
      const container = document.getElementById('squaresContainer');
      if (!container) return;
      
      // 加载该页面的书签数据
      const data = await chrome.storage.local.get(`squares_${pageId}`);
      const squares = data[`squares_${pageId}`] || [];
      
      // 使用统一的渲染逻辑（书签慢慢浮现）
      await this.renderBookmarks(squares, container, skipAnimation);
    } catch (error) {
      console.error('加载页面书签失败:', error);
    }
  }

  // 渲染书签
  async renderBookmarks(squares, container, skipAnimation = false) {
    const fragment = document.createDocumentFragment();
    const faviconPromises = [];

    // 添加容器的 ARIA 角色
    container.setAttribute('role', 'list');
    container.setAttribute('aria-label', '书签列表');

    for (let i = 0; i < squares.length; i++) {
      const squareData = squares[i];
      const listItem = document.createElement('div');
      listItem.className = 'square-list-item';
      // 添加 ARIA 标签
      listItem.setAttribute('role', 'listitem');
      
      // 如果不是首次加载，添加淡入动画（慢慢浮现）
      if (!skipAnimation) {
        // 添加淡入动画类，初始状态为隐藏
        listItem.classList.add('fade-in');
        // 设置延迟，创建错落有致的淡入效果
        listItem.style.transitionDelay = `${i * 20}ms`;
        listItem.style.opacity = '0';
        listItem.style.transform = 'translateY(10px) scale(0.95)';
      }
      
      const square = document.createElement('div');
      square.className = 'square-container';
      square.dataset.url = squareData.url;
      square.dataset.title = squareData.title;
      // 添加 ARIA 标签和可访问性支持
      square.setAttribute('role', 'link');
      square.setAttribute('tabindex', '0');
      square.setAttribute('aria-label', `${squareData.title} - ${squareData.url}`);
      
      const titleSpan = document.createElement('span');
      titleSpan.className = 'square-title';
      titleSpan.textContent = squareData.title;
      
      const spinner = document.createElement('div');
      spinner.className = 'loading-spinner';
      square.appendChild(spinner);
      
      // 使用统一的图标获取函数
      const faviconPromise = (async () => {
        try {
          // 确保使用全局的 getFavicon 函数
          if (typeof window.getFavicon === 'function') {
            const faviconUrl = await window.getFavicon(squareData.url);
            if (faviconUrl && square.parentNode) {
              spinner.remove();
              square.style.setProperty('--favicon-url', `url('${faviconUrl}')`);
              square.style.setProperty('--favicon-size', '32px');
            } else if (square.parentNode && spinner.parentNode) {
              spinner.remove();
            }
          } else {
            // 如果 getFavicon 不存在，等待一下再尝试
            await new Promise(resolve => setTimeout(resolve, 100));
            if (typeof window.getFavicon === 'function') {
              const faviconUrl = await window.getFavicon(squareData.url);
              if (faviconUrl && square.parentNode) {
                spinner.remove();
                square.style.setProperty('--favicon-url', `url('${faviconUrl}')`);
                square.style.setProperty('--favicon-size', '32px');
              } else if (square.parentNode && spinner.parentNode) {
                spinner.remove();
              }
            } else {
              // 如果还是不存在，移除spinner
              if (square.parentNode && spinner.parentNode) {
                spinner.remove();
              }
            }
          }
        } catch (error) {
          console.error('Error loading favicon:', error);
          if (square.parentNode && spinner.parentNode) {
            spinner.remove();
          }
        }
      })();
      faviconPromises.push(faviconPromise);
      
      square.addEventListener('click', function() {
        window.location.href = this.dataset.url;
      });

      // 添加键盘导航支持
      square.addEventListener('keydown', function(e) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          window.location.href = this.dataset.url;
        }
      });
      
      square.addEventListener('contextmenu', function(e) {
        e.preventDefault();
        window.createContextMenu(e.clientX, e.clientY, this);
      });
      
      listItem.appendChild(square);
      listItem.appendChild(titleSpan);
      
      // 添加拖拽事件（从全局函数获取）
      if (typeof window.addDragEvents === 'function') {
        window.addDragEvents(listItem);
      } else {
        // 如果addDragEvents不存在，等待一下再尝试
        setTimeout(() => {
          if (typeof window.addDragEvents === 'function') {
            window.addDragEvents(listItem);
          }
        }, 100);
      }
      
      fragment.appendChild(listItem);
    }
    
    container.appendChild(fragment);
    
    // 如果不是首次加载，触发淡入动画
    if (!skipAnimation) {
      requestAnimationFrame(() => {
        const items = container.querySelectorAll('.square-list-item');
        items.forEach(item => {
          item.style.opacity = '1';
          item.style.transform = 'translateY(0) scale(1)';
        });
      });
    }
    
    await Promise.allSettled(faviconPromises);
  }

  // 更新页面书签计数
  async updatePageCount(pageId) {
    const page = this.pages.find(p => p.id === pageId);
    if (page) {
      const data = await chrome.storage.local.get(`squares_${pageId}`);
      const squares = data[`squares_${pageId}`] || [];
      page.bookmarkCount = squares.length;
      await this.savePages();
      this.renderPages();
      this.renderFloatingIcons();
    }
  }

  // 渲染悬浮页面图标
  renderFloatingIcons() {
    const container = document.getElementById('floatingPageIcons');
    if (!container) return;
    
    container.innerHTML = '';
    
    this.pages.forEach(page => {
      const icon = document.createElement('div');
      icon.className = 'floating-page-icon';
      icon.dataset.pageId = page.id;
      // 添加 ARIA 标签和可访问性支持
      icon.setAttribute('role', 'button');
      icon.setAttribute('tabindex', '0');
      icon.setAttribute('aria-label', `${page.name} - ${page.id === this.currentPageId ? '当前页面' : '切换到此页面'}`);
      icon.setAttribute('aria-current', page.id === this.currentPageId ? 'page' : 'false');

      if (page.id === this.currentPageId) {
        icon.classList.add('active');
      }

      // 使用安全的 DOM 方法，防止 XSS 攻击
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('aria-hidden', 'true'); // SVG 图标对屏幕阅读器隐藏
      svg.setAttribute('viewBox', '0 0 24 24');
      svg.setAttribute('fill', 'none');

      const path1 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path1.setAttribute('d', 'M4 19.5A2.5 2.5 0 0 1 6.5 17H20');
      path1.setAttribute('stroke', 'currentColor');
      path1.setAttribute('stroke-width', '2');
      path1.setAttribute('stroke-linecap', 'round');
      path1.setAttribute('stroke-linejoin', 'round');

      const path2 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path2.setAttribute('d', 'M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z');
      path2.setAttribute('stroke', 'currentColor');
      path2.setAttribute('stroke-width', '2');
      path2.setAttribute('stroke-linecap', 'round');
      path2.setAttribute('stroke-linejoin', 'round');

      svg.appendChild(path1);
      svg.appendChild(path2);

      const tooltip = document.createElement('div');
      tooltip.className = 'page-tooltip';
      tooltip.textContent = page.name; // 使用 textContent 防止 XSS

      icon.appendChild(svg);
      icon.appendChild(tooltip);

      // 添加点击事件和键盘事件支持
      icon.addEventListener('click', () => {
        this.switchPage(page.id);
      });

      // 添加键盘导航支持
      icon.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          this.switchPage(page.id);
        }
      });
      
      container.appendChild(icon);
    });
  }

  // 渲染页面列表
  renderPages() {
    const container = document.getElementById('bookmarkPages');
    if (!container) return;

    container.innerHTML = '';
    // 添加 ARIA 角色标记
    container.setAttribute('role', 'listbox');
    container.setAttribute('aria-label', '书签页面列表');
    
    this.pages.forEach(page => {
      const item = document.createElement('div');
      item.className = 'bookmark-page-item';
      // 添加 ARIA 标签
      item.setAttribute('role', 'option');
      item.setAttribute('aria-selected', page.id === this.currentPageId ? 'true' : 'false');
      item.setAttribute('aria-label', `${page.name} - ${page.bookmarkCount} 个书签`);

      if (page.id === this.currentPageId) {
        item.classList.add('active');
      }
      
      // 使用安全的 DOM 方法，防止 XSS 攻击
      const pageIcon = document.createElement('div');
      pageIcon.className = 'page-icon';

      const pageIconSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      pageIconSvg.setAttribute('viewBox', '0 0 24 24');
      pageIconSvg.setAttribute('fill', 'none');

      const pageIconPath1 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      pageIconPath1.setAttribute('d', 'M4 19.5A2.5 2.5 0 0 1 6.5 17H20');
      pageIconPath1.setAttribute('stroke', 'currentColor');
      pageIconPath1.setAttribute('stroke-width', '2');
      pageIconPath1.setAttribute('stroke-linecap', 'round');
      pageIconPath1.setAttribute('stroke-linejoin', 'round');

      const pageIconPath2 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      pageIconPath2.setAttribute('d', 'M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z');
      pageIconPath2.setAttribute('stroke', 'currentColor');
      pageIconPath2.setAttribute('stroke-width', '2');
      pageIconPath2.setAttribute('stroke-linecap', 'round');
      pageIconPath2.setAttribute('stroke-linejoin', 'round');

      pageIconSvg.appendChild(pageIconPath1);
      pageIconSvg.appendChild(pageIconPath2);
      pageIcon.appendChild(pageIconSvg);

      const pageInfo = document.createElement('div');
      pageInfo.className = 'page-info';

      const pageName = document.createElement('div');
      pageName.className = 'page-name';
      pageName.textContent = page.name; // 使用 textContent 防止 XSS

      const pageCount = document.createElement('div');
      pageCount.className = 'page-count';
      pageCount.textContent = `${page.bookmarkCount} 个书签`;

      pageInfo.appendChild(pageName);
      pageInfo.appendChild(pageCount);

      const pageActions = document.createElement('div');
      pageActions.className = 'page-actions';

      const editBtn = document.createElement('button');
      editBtn.className = 'page-action-btn edit-page-btn';
      editBtn.dataset.pageId = page.id;
      editBtn.title = '重命名';
      // 添加 ARIA 标签
      editBtn.setAttribute('aria-label', `重命名页面: ${page.name}`);
      editBtn.setAttribute('type', 'button');

      const editBtnSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      editBtnSvg.setAttribute('viewBox', '0 0 24 24');
      editBtnSvg.setAttribute('fill', 'none');

      const editBtnPath1 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      editBtnPath1.setAttribute('d', 'M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7');
      editBtnPath1.setAttribute('stroke', 'currentColor');
      editBtnPath1.setAttribute('stroke-width', '2');

      const editBtnPath2 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      editBtnPath2.setAttribute('d', 'M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z');
      editBtnPath2.setAttribute('stroke', 'currentColor');
      editBtnPath2.setAttribute('stroke-width', '2');

      editBtnSvg.appendChild(editBtnPath1);
      editBtnSvg.appendChild(editBtnPath2);
      editBtn.appendChild(editBtnSvg);

      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'page-action-btn delete-page-btn';
      deleteBtn.dataset.pageId = page.id;
      deleteBtn.title = '删除';
      // 添加 ARIA 标签
      deleteBtn.setAttribute('aria-label', `删除页面: ${page.name}`);
      deleteBtn.setAttribute('type', 'button');

      const deleteBtnSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      deleteBtnSvg.setAttribute('viewBox', '0 0 24 24');
      deleteBtnSvg.setAttribute('fill', 'none');

      const deleteBtnPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      deleteBtnPath.setAttribute('d', 'M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2');
      deleteBtnPath.setAttribute('stroke', 'currentColor');
      deleteBtnPath.setAttribute('stroke-width', '2');

      deleteBtnSvg.appendChild(deleteBtnPath);
      deleteBtn.appendChild(deleteBtnSvg);

      pageActions.appendChild(editBtn);
      pageActions.appendChild(deleteBtn);

      item.appendChild(pageIcon);
      item.appendChild(pageInfo);
      item.appendChild(pageActions);
      
      // 点击切换页面
      item.addEventListener('click', (e) => {
        if (!e.target.closest('.page-actions')) {
          this.switchPage(page.id);
        }
      });
      
      // 重命名按钮
      editBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.handleRenamePage(page.id, page.name);
      });

      // 删除按钮
      deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.deletePage(page.id);
      });
      
      container.appendChild(item);
    });
    
    // 同时更新悬浮图标
    this.renderFloatingIcons();
  }

  // 处理重命名页面
  handleRenamePage(pageId, currentName) {
    const newName = prompt('请输入新页面名称:', currentName);
    if (newName && newName.trim() && newName !== currentName) {
      this.renamePage(pageId, newName.trim());
    }
  }

  // 获取当前页面ID
  getCurrentPageId() {
    return this.currentPageId;
  }

  // 保存当前页面的书签
  async saveCurrentPageBookmarks() {
    if (!this.currentPageId) return;
    
    const listItems = document.querySelectorAll('.square-list-item');
    const squaresData = Array.from(listItems).map(item => {
      const square = item.querySelector('.square-container');
      const title = item.querySelector('.square-title');
      return {
        url: square.dataset.url,
        title: title.textContent
      };
    });
    
    await chrome.storage.local.set({ [`squares_${this.currentPageId}`]: squaresData });
    await this.updatePageCount(this.currentPageId);
  }
}

// 创建全局实例（延迟到DOM加载后）
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    window.pageManager = new PageManager();
  });
} else {
  window.pageManager = new PageManager();
}

