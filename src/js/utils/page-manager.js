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
      setTimeout(() => this.init(), 100);
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
    
    // 加载当前页面的书签
    if (this.currentPageId) {
      await this.loadPageBookmarks(this.currentPageId);
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
    
    // 加载新页面的书签
    await this.loadPageBookmarks(pageId);
    
    // 更新页面列表显示
    this.renderPages();
    
    // 更新悬浮图标
    this.renderFloatingIcons();
    
    // 更新页面计数
    await this.updatePageCount(pageId);
  }

  // 加载页面的书签
  async loadPageBookmarks(pageId) {
    try {
      const container = document.getElementById('squaresContainer');
      if (!container) return;
      
      // 清空当前显示的书签
      container.innerHTML = '';
      
      // 加载该页面的书签数据
      const data = await chrome.storage.local.get(`squares_${pageId}`);
      const squares = data[`squares_${pageId}`] || [];
      
      // 使用统一的渲染逻辑
      await this.renderBookmarks(squares, container);
    } catch (error) {
      console.error('加载页面书签失败:', error);
    }
  }

  // 渲染书签
  async renderBookmarks(squares, container) {
    const fragment = document.createDocumentFragment();
    const faviconPromises = [];
    
    for (const squareData of squares) {
      const listItem = document.createElement('div');
      listItem.className = 'square-list-item';
      
      const square = document.createElement('div');
      square.className = 'square-container';
      square.dataset.url = squareData.url;
      square.dataset.title = squareData.title;
      
      const titleSpan = document.createElement('span');
      titleSpan.className = 'square-title';
      titleSpan.textContent = squareData.title;
      
      const spinner = document.createElement('div');
      spinner.className = 'loading-spinner';
      square.appendChild(spinner);
      
      // 使用统一的图标获取函数
      const getFaviconFunc = window.getFavicon || (async (url) => {
        if (window.getFavicon) {
          return await window.getFavicon(url);
        }
        return null;
      });
      const faviconPromise = getFaviconFunc(squareData.url).then(faviconUrl => {
        if (faviconUrl && square.parentNode) {
          spinner.remove();
          square.style.setProperty('--favicon-url', `url('${faviconUrl}')`);
          square.style.setProperty('--favicon-size', '32px');
        } else if (square.parentNode && spinner.parentNode) {
          spinner.remove();
        }
      }).catch(error => {
        console.error('Error loading favicon:', error);
        if (square.parentNode && spinner.parentNode) {
          spinner.remove();
        }
      });
      faviconPromises.push(faviconPromise);
      
      square.addEventListener('click', function() {
        window.location.href = this.dataset.url;
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
      
      if (page.id === this.currentPageId) {
        icon.classList.add('active');
      }
      
      icon.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <div class="page-tooltip">${page.name}</div>
      `;
      
      icon.addEventListener('click', () => {
        this.switchPage(page.id);
      });
      
      container.appendChild(icon);
    });
  }

  // 渲染页面列表
  renderPages() {
    const container = document.getElementById('bookmarkPages');
    if (!container) return;
    
    container.innerHTML = '';
    
    this.pages.forEach(page => {
      const item = document.createElement('div');
      item.className = 'bookmark-page-item';
      if (page.id === this.currentPageId) {
        item.classList.add('active');
      }
      
      item.innerHTML = `
        <div class="page-icon">
          <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </div>
        <div class="page-info">
          <div class="page-name">${page.name}</div>
          <div class="page-count">${page.bookmarkCount} 个书签</div>
        </div>
        <div class="page-actions">
          <button class="page-action-btn edit-page-btn" data-page-id="${page.id}" title="重命名">
            <svg viewBox="0 0 24 24" fill="none">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" stroke="currentColor" stroke-width="2"/>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" stroke="currentColor" stroke-width="2"/>
            </svg>
          </button>
          <button class="page-action-btn delete-page-btn" data-page-id="${page.id}" title="删除">
            <svg viewBox="0 0 24 24" fill="none">
              <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" stroke="currentColor" stroke-width="2"/>
            </svg>
          </button>
        </div>
      `;
      
      // 点击切换页面
      item.addEventListener('click', (e) => {
        if (!e.target.closest('.page-actions')) {
          this.switchPage(page.id);
        }
      });
      
      // 重命名按钮
      const editBtn = item.querySelector('.edit-page-btn');
      editBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.handleRenamePage(page.id, page.name);
      });
      
      // 删除按钮
      const deleteBtn = item.querySelector('.delete-page-btn');
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

