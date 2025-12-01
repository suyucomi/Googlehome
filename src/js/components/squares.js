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
  
  // 创建节流后的保存函数
  const throttledSave = window.throttle(() => {
    window.saveData();
  }, 1000);
  
  // 为所有现有的方块添加拖拽功能
  function initializeDragAndDrop() {
    const squares = document.getElementsByClassName('square-container');
    const fragment = document.createDocumentFragment();
    
    // 将 HTMLCollection 转换为数组再使用 forEach
    Array.from(squares).forEach(square => {
      addDragEvents(square);
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

  // 修改获取最近元素的逻辑
  function getClosestItem(container, x, y) {
    if (!container) return null;
    
    const draggableElements = [...container.querySelectorAll('.square-container:not(.dragging):not(.placeholder)')];
    if (draggableElements.length === 0) {
      return { element: null, position: 'before', distance: Infinity };
    }
    
    // 获取最近的元素
    let closestElement = null;
    let closestDistance = Infinity;
    let position = 'before';
    
    draggableElements.forEach(element => {
      const rect = element.getBoundingClientRect();
      const elementCenterX = rect.left + rect.width / 2;
      const elementCenterY = rect.top + rect.height / 2;
      
      // 计算鼠标与元素中心点的距离
      const distance = Math.hypot(x - elementCenterX, y - elementCenterY);
      
      if (distance < closestDistance) {
        closestDistance = distance;
        closestElement = element;
        
        // 根据鼠标在元素的左右位置决定插入位置
        position = x < elementCenterX ? 'before' : 'after';
      }
    });
    
    return { element: closestElement, position, distance: closestDistance };
  }

  // 修改拖动事件处理
  if (container) {
    container.addEventListener('dragover', function(e) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      
      lastX = e.clientX;
      lastY = e.clientY;
      
      if (draggedItem && placeholder) {
        const mouseX = e.clientX;
        const mouseY = e.clientY;
        
        const closestItem = getClosestItem(container, mouseX, mouseY);
        
        if (closestItem && closestItem.element) {
          const currentPosition = Array.from(container.children).indexOf(placeholder);
          const targetPosition = Array.from(container.children).indexOf(closestItem.element);
          
          if (currentPosition !== -1 && targetPosition !== -1 && currentPosition !== targetPosition) {
            const direction = currentPosition < targetPosition ? 1 : -1;
            const itemWidth = 91; // 56px + 35px gap
            
            // 移除之前的所有移动类和样式
            container.querySelectorAll('.square-container').forEach(square => {
              square.classList.remove('moving');
              square.style.transform = '';
            });
            
            // 计算每行的图标数量
            const containerWidth = container.clientWidth;
            const iconsPerRow = Math.floor((containerWidth + 35) / (56 + 35));
            
            // 确定是否需要换行移动
            const currentRow = Math.floor(currentPosition / iconsPerRow);
            const targetRow = Math.floor(targetPosition / iconsPerRow);
            
            Array.from(container.children).forEach((child, index) => {
              if (child !== placeholder && child !== draggedItem) {
                const childRow = Math.floor(index / iconsPerRow);
                
                if (direction > 0) {
                  // 向后移动
                  if (index > currentPosition && index <= targetPosition) {
                    child.classList.add('moving');
                    if (childRow === currentRow) {
                      // 同行移动
                      child.style.transform = `translateX(-${itemWidth}px)`;
                    } else {
                      // 跨行移动
                      const rowDiff = childRow - currentRow;
                      child.style.transform = `translate(-${itemWidth}px, -${rowDiff * 40}px)`;
                    }
                  }
                } else {
                  // 向前移动
                  if (index >= targetPosition && index < currentPosition) {
                    child.classList.add('moving');
                    if (childRow === targetRow) {
                      // 同行移动
                      child.style.transform = `translateX(${itemWidth}px)`;
                    } else {
                      // 跨行移动
                      const rowDiff = targetRow - childRow;
                      child.style.transform = `translate(${itemWidth}px, ${rowDiff * 40}px)`;
                    }
                  }
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
    });
  }

  // 初始化
  initializeDragAndDrop();
  
  // 监听新添加的方
  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      mutation.addedNodes.forEach((node) => {
        if (node.classList && node.classList.contains('square-container')) {
          addDragEvents(node);
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

  // 添加虚拟列表以处理大量图标
  class VirtualList {
    constructor(container, items) {
      this.container = container;
      this.items = items;
      this.visibleItems = new Set();
      this.observer = new IntersectionObserver(this.handleIntersection.bind(this));
    }
    
    render() {
      // 只渲染可视区域的项目
      const visibleIndexes = this.calculateVisibleIndexes();
      this.updateDOM(visibleIndexes);
    }
  }

  // 将多个事件监听器合并到父元素
  function initializeEventDelegation() {
    container.addEventListener('click', (e) => {
      const square = e.target.closest('.square-container');
      if (!square) return;
      
      // 处理点击事件
    });
    
    container.addEventListener('contextmenu', (e) => {
      const square = e.target.closest('.square-container');
      if (!square) return;
      
      // 处理右键菜单
    });
  }
}); 