// 添加一个保存队列
const saveQueue = [];
let isSaving = false;
let draggedItem = null;

// 添加本地缓存
const cache = new Map();

// 优化保存操作
const throttledSave = throttle(() => {
  saveData();
}, 1000);

// 优化搜索操作
const debouncedSearch = debounce((value) => {
  performSearch(value);
}, 300);

// 将函数暴露到全局
window.saveData = async function() {
  const listItems = document.querySelectorAll('.square-list-item');
  const squaresData = Array.from(listItems).map(item => {
    const square = item.querySelector('.square-container');
    const title = item.querySelector('.square-title');
    return {
      url: square.dataset.url,
      title: title.textContent
    };
  });

  const searchEngine = document.getElementById('searchEngine').value;
  const data = {
    squares: squaresData,
    searchEngine: searchEngine
  };

  saveQueue.push(data);
  
  if (!isSaving) {
    processSaveQueue();
  }
};

// 处理保存队列
async function processSaveQueue() {
  if (saveQueue.length === 0) {
    isSaving = false;
    return;
  }

  isSaving = true;
  const data = saveQueue[saveQueue.length - 1];
  saveQueue.length = 0;

  let retries = 3;
  while (retries > 0) {
    try {
      await chrome.storage.sync.set(data);
      break;
    } catch (error) {
      retries--;
      if (retries === 0) {
        console.error('保存数据失败，已重试3次:', error);
      } else {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
  }

  setTimeout(() => {
    processSaveQueue();
  }, 1000);
}

// 添加拖拽事件处理
function addDragEvents(listItem) {
  listItem.setAttribute('draggable', true);
  let hoveredItem = null;
  
  listItem.addEventListener('dragstart', (e) => {
    draggedItem = listItem;
    listItem.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    
    // 创建拖动时的预览图像
    const dragImage = listItem.cloneNode(true);
    dragImage.style.position = 'absolute';
    dragImage.style.left = '-9999px';
    dragImage.classList.add('drag-image');
    document.body.appendChild(dragImage);
    e.dataTransfer.setDragImage(dragImage, 28, 28); // 设置鼠标位置在图标中心
    
    setTimeout(() => {
      document.body.removeChild(dragImage);
    }, 0);
  });

  listItem.addEventListener('dragend', () => {
    listItem.classList.remove('dragging');
    draggedItem = null;
    
    // 清除所有悬浮效果
    document.querySelectorAll('.square-list-item').forEach(item => {
      item.classList.remove('hover-scale');
    });
    
    saveData();
  });

  listItem.addEventListener('dragover', (e) => {
    e.preventDefault();
    if (!draggedItem || draggedItem === listItem) return;
    
    // 移除其他项的悬浮效果
    if (hoveredItem && hoveredItem !== listItem) {
      hoveredItem.classList.remove('hover-scale');
    }
    
    // 添加当前项的悬浮效果
    listItem.classList.add('hover-scale');
    hoveredItem = listItem;
  });

  listItem.addEventListener('dragleave', () => {
    listItem.classList.remove('hover-scale');
    if (hoveredItem === listItem) {
      hoveredItem = null;
    }
  });

  listItem.addEventListener('drop', (e) => {
    e.preventDefault();
    if (!draggedItem || draggedItem === listItem) return;
    
    // 获取所有列表项
    const items = Array.from(document.querySelectorAll('.square-list-item'));
    const fromIndex = items.indexOf(draggedItem);
    const toIndex = items.indexOf(listItem);
    
    // 交换元素位置
    if (fromIndex !== -1 && toIndex !== -1) {
      // 移除所有悬浮效果
      items.forEach(item => item.classList.remove('hover-scale'));
      
      // 如果是向后移动
      if (fromIndex < toIndex) {
        listItem.parentNode.insertBefore(draggedItem, listItem.nextSibling);
      } else {
        listItem.parentNode.insertBefore(draggedItem, listItem);
      }
      
      // 添加交换动画
      draggedItem.classList.add('swap-animation');
      listItem.classList.add('swap-animation');
      
      setTimeout(() => {
        draggedItem.classList.remove('swap-animation');
        listItem.classList.remove('swap-animation');
      }, 300);
    }
    
    saveData();
  });
}

// 添加页面级别的拖拽监听
document.addEventListener('dragover', (e) => {
  e.preventDefault();
});

document.addEventListener('drop', (e) => {
  e.preventDefault();
  if (draggedItem && !e.target.closest('.square-list-item')) {
    // 如果在空白处放下，找到最近的目标位置
    const container = document.getElementById('squaresContainer');
    if (container) {
      const rect = container.getBoundingClientRect();
      const items = Array.from(container.querySelectorAll('.square-list-item'));
      
      if (items.length > 0) {
        // 找到最近的项
        let closestItem = items[0];
        let closestDistance = Infinity;
        
        items.forEach(item => {
          const itemRect = item.getBoundingClientRect();
          const distance = Math.hypot(
            e.clientX - (itemRect.left + itemRect.width / 2),
            e.clientY - (itemRect.top + itemRect.height / 2)
          );
          
          if (distance < closestDistance) {
            closestDistance = distance;
            closestItem = item;
          }
        });
        
        // 将拖动项移动到最近的位置
        if (e.clientY < closestItem.getBoundingClientRect().top) {
          container.insertBefore(draggedItem, closestItem);
        } else {
          container.insertBefore(draggedItem, closestItem.nextSibling);
        }
      } else {
        container.appendChild(draggedItem);
      }
      
      saveData();
    }
  }
});

// 修改加载数据函数
async function loadData() {
  try {
    const container = document.getElementById('squaresContainer');
    const searchEngine = document.getElementById('searchEngine');
    
    const data = await chrome.storage.sync.get(['squares', 'searchEngine']);
    
    if (data.searchEngine) {
      searchEngine.value = data.searchEngine;
      searchEngine.dispatchEvent(new Event('change'));
    }
    
    if (data.squares && Array.isArray(data.squares)) {
      for (const squareData of data.squares) {
        // 创建列表项
        const listItem = document.createElement('div');
        listItem.className = 'square-list-item';
        
        // 创建方块
        const square = document.createElement('div');
        square.className = 'square-container';
        square.dataset.url = squareData.url;
        square.dataset.title = squareData.title;
        
        // 创建标题
        const titleSpan = document.createElement('span');
        titleSpan.className = 'square-title';
        titleSpan.textContent = squareData.title;
        
        // 添加加载动画
        const spinner = document.createElement('div');
        spinner.className = 'loading-spinner';
        square.appendChild(spinner);
        
        // 获取图标
        getFaviconWithCache(squareData.url).then(faviconUrl => {
          if (faviconUrl) {
            spinner.remove();
            square.style.setProperty('--favicon-url', `url('${faviconUrl}')`);
            square.style.setProperty('--favicon-size', '32px');
          }
        });
        
        // 添加事件监听
        square.addEventListener('click', function() {
          window.location.href = this.dataset.url;
        });
        
        square.addEventListener('contextmenu', function(e) {
          e.preventDefault();
          createContextMenu(e.clientX, e.clientY, this);
        });
        
        // 组装列表项
        listItem.appendChild(square);
        listItem.appendChild(titleSpan);
        
        // 添加拖拽事件
        addDragEvents(listItem);
        
        // 添加到容器
        container.appendChild(listItem);
      }
    }
  } catch (error) {
    console.error('Error loading data:', error);
  }
}

// 页载时初始化
document.addEventListener('DOMContentLoaded', async () => {
  await loadData();
});

// 修改右键菜单函数
window.createContextMenu = function(x, y, square) {
  // 移除已存在的菜单
  const existingMenu = document.querySelector('.context-menu');
  if (existingMenu) {
    existingMenu.remove();
  }

  const menu = document.createElement('div');
  menu.className = 'context-menu';
  
  document.body.appendChild(menu);
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;
  
  // 修改选项
  const editItem = document.createElement('div');
  editItem.className = 'context-menu-item';
  editItem.textContent = '修改';
  editItem.onclick = async () => {
    menu.remove();
    const url = square.dataset.url;
    const name = square.dataset.title;
    
    // 使用与粘贴相同的弹窗
    const confirmed = await createNameDialog(url, name);
    
    if (confirmed) {
      square.dataset.title = confirmed.name;
      const titleSpan = square.parentNode.querySelector('.square-title');
      titleSpan.textContent = confirmed.name;
      await saveData();
    }
  };

  // 删除选项
  const deleteItem = document.createElement('div');
  deleteItem.className = 'context-menu-item';
  deleteItem.textContent = '删除';
  deleteItem.onclick = () => {
    menu.remove();
    const listItem = square.parentNode;
    
    // 添加消失动画
    listItem.style.transition = 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.3s ease';
    listItem.style.transform = 'scale(0.8) translateY(10px)';
    listItem.style.opacity = '0';
    
    // 等待动画完成后再移除元素
    setTimeout(() => {
      listItem.remove();
      saveData();
    }, 300);
  };

  menu.appendChild(editItem);
  menu.appendChild(deleteItem);

  // 调整菜单位置，确保不超出视窗
  const menuRect = menu.getBoundingClientRect();
  const windowWidth = window.innerWidth;
  const windowHeight = window.innerHeight;

  if (menuRect.right > windowWidth) {
    menu.style.left = `${windowWidth - menuRect.width - 5}px`;
  }
  if (menuRect.bottom > windowHeight) {
    menu.style.top = `${windowHeight - menuRect.height - 5}px`;
  }

  // 点击其他地方关闭菜单
  const closeMenu = (e) => {
    if (!menu.contains(e.target)) {
      menu.remove();
      document.removeEventListener('click', closeMenu);
      document.removeEventListener('contextmenu', closeMenu);
    }
  };
  
  // 延迟添加事件监听，避免立即触发
  setTimeout(() => {
    document.addEventListener('click', closeMenu);
    document.addEventListener('contextmenu', closeMenu);
  }, 0);
}; 

async function getFaviconWithCache(domain) {
  if (cache.has(domain)) {
    return cache.get(domain);
  }
  
  const favicon = await getFavicon(domain);
  cache.set(domain, favicon);
  return favicon;
} 