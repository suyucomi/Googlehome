document.addEventListener('DOMContentLoaded', function() {
  const container = document.getElementById('squaresContainer');
  if (!container) {
    console.warn('squares container not found');
    return;
  }
  
  let draggedItem = null;
  let placeholder = null;
  let lastX = 0;
  let lastY = 0;
  let dragOffset = { x: 0, y: 0 };
  let hoveredItem = null;
  
  // 创建节流后的保存函数
  const throttledSave = window.throttle(() => {
    window.saveData();
  }, 1000);
  
  // 为所有现有的方块添加拖拽功能
  function initializeDragAndDrop() {
    const squares = document.getElementsByClassName('square-container');
    const fragment = document.createDocumentFragment();
    Array.from(squares).forEach(square => {
      const listItem = square.closest('.square-list-item') || square.parentElement;
      if (listItem && typeof window.addDragEvents === 'function') {
        window.addDragEvents(listItem);
      }
      fragment.appendChild(square);
    });
    container.appendChild(fragment);
  }

  // 修改拖动结束事件处理
  function handleDragEnd(e) {
    if (!draggedItem || !container) return;
    
    // 确保所有元素回到正常状态
    container.querySelectorAll('.square-container').forEach(square => {
      square.style.transform = '';
      square.style.transition = '';
    });
    
    draggedItem.classList.remove('dragging');
    container.classList.remove('dragging-in-progress');
    draggedItem.style.display = '';
    draggedItem.style.position = '';
    draggedItem.style.left = '';
    draggedItem.style.top = '';
    draggedItem.style.pointerEvents = '';
    
    const adjustedX = lastX - dragOffset.x;
    const adjustedY = lastY - dragOffset.y;
    const closestItem = getClosestItem(container, adjustedX, adjustedY);
    
    if (closestItem && closestItem.element) {
      const insertAfter = closestItem.position === 'after';
      if (insertAfter) {
        closestItem.element.parentNode.insertBefore(draggedItem, closestItem.element.nextSibling);
      } else {
        closestItem.element.parentNode.insertBefore(draggedItem, closestItem.element);
      }
    } else {
      container.appendChild(draggedItem);
    }
    
    // 添加放下动画
    draggedItem.classList.add('drag-end');
    setTimeout(() => {
      if (draggedItem) {
        draggedItem.classList.remove('drag-end');
      }
    }, 300);
    
    if (placeholder && placeholder.parentNode) {
      placeholder.parentNode.removeChild(placeholder);
    }
    
    draggedItem = null;
    placeholder = null;
    dragOffset = { x: 0, y: 0 };
    
    throttledSave();
  }

  // 修改事件监听器的添加和移除方式
  function addDragEvents(listItem) {
    const handlers = {
      dragstart: (e) => {
        draggedItem = listItem;
        listItem.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        
        const dragImage = listItem.cloneNode(true);
        dragImage.style.position = 'absolute';
        dragImage.style.left = '-9999px';
        dragImage.classList.add('drag-image');
        document.body.appendChild(dragImage);
        e.dataTransfer.setDragImage(dragImage, 28, 28);
        
        setTimeout(() => {
          document.body.removeChild(dragImage);
        }, 0);
      },

      dragend: () => {
        listItem.classList.remove('dragging');
        draggedItem = null;
        document.querySelectorAll('.square-list-item').forEach(item => {
          item.classList.remove('hover-scale');
        });
        saveData();
      },

      dragover: (e) => {
        e.preventDefault();
        if (!draggedItem || draggedItem === listItem) return;
        
        if (hoveredItem && hoveredItem !== listItem) {
          hoveredItem.classList.remove('hover-scale');
        }
        
        listItem.classList.add('hover-scale');
        hoveredItem = listItem;
      },

      dragleave: () => {
        listItem.classList.remove('hover-scale');
        if (hoveredItem === listItem) {
          hoveredItem = null;
        }
      },

      drop: (e) => {
        e.preventDefault();
        if (!draggedItem || draggedItem === listItem) return;
        
        const items = Array.from(document.querySelectorAll('.square-list-item'));
        const fromIndex = items.indexOf(draggedItem);
        const toIndex = items.indexOf(listItem);
        
        if (fromIndex !== -1 && toIndex !== -1) {
          items.forEach(item => item.classList.remove('hover-scale'));
          
          if (fromIndex < toIndex) {
            listItem.parentNode.insertBefore(draggedItem, listItem.nextSibling);
          } else {
            listItem.parentNode.insertBefore(draggedItem, listItem);
          }
          
          draggedItem.classList.add('swap-animation');
          listItem.classList.add('swap-animation');
          
          setTimeout(() => {
            draggedItem.classList.remove('swap-animation');
            listItem.classList.remove('swap-animation');
          }, 300);
        }
        
        saveData();
      }
    };

    // 添加事件监听器
    listItem.setAttribute('draggable', true);
    Object.entries(handlers).forEach(([event, handler]) => {
      listItem.addEventListener(event, handler);
    });

    // 存储事件处理函数引用
    listItem._dragHandlers = handlers;

    // 添加清理方法
    listItem.cleanup = () => {
      Object.entries(handlers).forEach(([event, handler]) => {
        listItem.removeEventListener(event, handler);
      });
      listItem.removeAttribute('draggable');
      delete listItem._dragHandlers;
    };
  }

  // 优化获取最近元素的逻辑 - 限制搜索范围
  function getClosestItem(container, x, y) {
    return getClosestItemOptimized(container, x, y);
  }
  
  function getClosestItemOptimized(container, x, y) {
    if (!container) return null;
    
    // 优化：只搜索可见区域附近的元素，而不是所有元素
    const children = Array.from(container.children);
    if (children.length === 0) {
      return { element: null, position: 'before', distance: Infinity };
    }
    
    // 计算搜索半径（只搜索附近一定范围内的元素）
    const SEARCH_RADIUS = 200; // 像素
    const searchRadiusSquared = SEARCH_RADIUS * SEARCH_RADIUS;
    
    let closestElement = null;
    let closestDistance = Infinity;
    let position = 'before';
    
    // 优化：使用索引快速定位可能的候选元素
    // 先找到鼠标位置附近的元素索引
    const containerRect = container.getBoundingClientRect();
    const relativeX = x - containerRect.left;
    const relativeY = y - containerRect.top;
    
    // 估算每行的图标数量
    const containerWidth = container.clientWidth;
    const iconsPerRow = Math.max(1, Math.floor((containerWidth + 35) / (56 + 35)));
    const estimatedRow = Math.floor(relativeY / 100); // 假设每行高度约100px
    const estimatedCol = Math.floor(relativeX / 100); // 假设每个图标宽度约100px
    const estimatedIndex = estimatedRow * iconsPerRow + estimatedCol;
    
    // 搜索范围：从估算位置前后各搜索一定数量的元素
    const SEARCH_RANGE = Math.min(20, Math.ceil(children.length / 2)); // 最多搜索20个元素
    const startIndex = Math.max(0, estimatedIndex - SEARCH_RANGE);
    const endIndex = Math.min(children.length, estimatedIndex + SEARCH_RANGE);
    
    // 只遍历搜索范围内的元素
    for (let i = startIndex; i < endIndex; i++) {
      const child = children[i];
      if (!child || child.classList.contains('dragging') || child.classList.contains('placeholder')) {
        continue;
      }
      
      const square = child.querySelector('.square-container');
      if (!square) continue;
      
      const rect = square.getBoundingClientRect();
      const elementCenterX = rect.left + rect.width / 2;
      const elementCenterY = rect.top + rect.height / 2;
      
      // 快速距离检查（使用平方距离避免开方计算）
      const dx = x - elementCenterX;
      const dy = y - elementCenterY;
      const distanceSquared = dx * dx + dy * dy;
      
      // 如果距离太远，跳过
      if (distanceSquared > searchRadiusSquared) {
        continue;
      }
      
      if (distanceSquared < closestDistance) {
        closestDistance = distanceSquared;
        closestElement = square;
        position = x < elementCenterX ? 'before' : 'after';
      }
    }
    
    // 如果没找到，回退到全量搜索（但限制数量）
    if (!closestElement && children.length < 100) {
      const draggableElements = children
        .filter(child => !child.classList.contains('dragging') && !child.classList.contains('placeholder'))
        .map(child => child.querySelector('.square-container'))
        .filter(Boolean);
      
      for (const element of draggableElements) {
        const rect = element.getBoundingClientRect();
        const elementCenterX = rect.left + rect.width / 2;
        const elementCenterY = rect.top + rect.height / 2;
        
        const dx = x - elementCenterX;
        const dy = y - elementCenterY;
        const distanceSquared = dx * dx + dy * dy;
        
        if (distanceSquared < closestDistance) {
          closestDistance = distanceSquared;
          closestElement = element;
          position = x < elementCenterX ? 'before' : 'after';
        }
      }
    }
    
    return { element: closestElement, position, distance: Math.sqrt(closestDistance) };
  }

  // 修改拖动事件处理
  if (container) {
    // 优化：使用 requestAnimationFrame 节流
    let rafId = null;
    let lastUpdateTime = 0;
    const UPDATE_INTERVAL = 16; // 约 60fps
    
    container.addEventListener('dragover', function(e) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      
      lastX = e.clientX;
      lastY = e.clientY;
      
      // 使用 requestAnimationFrame 节流更新
      if (rafId === null) {
        rafId = requestAnimationFrame(() => {
          const now = performance.now();
          if (now - lastUpdateTime >= UPDATE_INTERVAL && draggedItem && placeholder) {
            updateDragPosition();
            lastUpdateTime = now;
          }
          rafId = null;
        });
      }
    });
    
    function updateDragPosition() {
      if (!draggedItem || !placeholder) return;
      
      const closestItem = getClosestItem(container, lastX, lastY);
      
      if (closestItem && closestItem.element) {
          // 找到 closestItem 的父元素（square-list-item）
          const targetListItem = closestItem.element.closest('.square-list-item');
          if (!targetListItem) return;
          
          const currentPosition = Array.from(container.children).indexOf(placeholder);
          const targetPosition = Array.from(container.children).indexOf(targetListItem);
          
          if (currentPosition !== -1 && targetPosition !== -1 && currentPosition !== targetPosition) {
            const direction = currentPosition < targetPosition ? 1 : -1;
            const itemWidth = 91; // 56px + 35px gap
            
            // 优化：批量更新，减少 DOM 查询
            const children = Array.from(container.children);
            const updates = [];
            
            // 计算每行的图标数量
            const containerWidth = container.clientWidth;
            const iconsPerRow = Math.floor((containerWidth + 35) / (56 + 35));
            
            // 确定是否需要换行移动
            const currentRow = Math.floor(currentPosition / iconsPerRow);
            const targetRow = Math.floor(targetPosition / iconsPerRow);
            
            children.forEach((child, index) => {
              if (child !== placeholder && child !== draggedItem) {
                const childRow = Math.floor(index / iconsPerRow);
                let shouldMove = false;
                let transform = '';
                
                if (direction > 0) {
                  if (index > currentPosition && index <= targetPosition) {
                    shouldMove = true;
                    if (childRow === currentRow) {
                      transform = `translateX(-${itemWidth}px)`;
                    } else {
                      const rowDiff = childRow - currentRow;
                      transform = `translate(-${itemWidth}px, -${rowDiff * 40}px)`;
                    }
                  }
                } else {
                  if (index >= targetPosition && index < currentPosition) {
                    shouldMove = true;
                    if (childRow === targetRow) {
                      transform = `translateX(${itemWidth}px)`;
                    } else {
                      const rowDiff = targetRow - childRow;
                      transform = `translate(${itemWidth}px, ${rowDiff * 40}px)`;
                    }
                  }
                }
                
                if (shouldMove) {
                  updates.push({ element: child, transform });
                }
              }
            });
            
            requestAnimationFrame(() => {
              if (closestItem.position === 'after') {
                closestItem.element.parentNode.insertBefore(placeholder, closestItem.element.nextSibling);
              } else {
                closestItem.element.parentNode.insertBefore(placeholder, closestItem.element);
              }
              
              // 重置所有元��的transform
              setTimeout(() => {
                container.querySelectorAll('.square-container').forEach(square => {
                  square.classList.remove('moving');
                  square.style.transform = '';
                });
              }, 200);
            });
          }
      } else if (!placeholder.parentNode) {
        container.appendChild(placeholder);
      }
    }
  }

  // 初始化
  initializeDragAndDrop();
  
  // 监听新添加的方块
  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      mutation.addedNodes.forEach((node) => {
        // 检查是否是 square-list-item（完整的书签项）
        if (node.classList && node.classList.contains('square-list-item')) {
          if (typeof window.addDragEvents === 'function') {
            window.addDragEvents(node);
          }
        }
        // 兼容旧格式：square-container
        else if (node.classList && node.classList.contains('square-container')) {
          // 找到父元素 square-list-item
          const listItem = node.closest('.square-list-item') || node.parentElement;
          if (listItem && typeof window.addDragEvents === 'function') {
            window.addDragEvents(listItem);
          }
        }
      });
    });
  });
  
  if (container) {
    observer.observe(container, { childList: true });
  }

  // 修改清理函数
  function cleanup() {
    const squares = document.querySelectorAll('.square-list-item');
    squares.forEach(square => {
      if (typeof square.cleanup === 'function') {
        square.cleanup();
      }
    });
  }

  // 在页面卸载时清理
  window.addEventListener('beforeunload', cleanup);
}); 
