document.addEventListener('DOMContentLoaded', function() {
  const dropZone = document.getElementById('squaresContainer');
  
  if (!dropZone) {
    console.warn('Drop zone element not found');
    return;
  }

  // 防止浏览器默认的拖放行为
  document.addEventListener('dragover', function(e) {
    e.preventDefault();
  });

  // 处理拖放
  dropZone.addEventListener('drop', function(e) {
    e.preventDefault();
    
    // 创建新的正方形
    const square = document.createElement('div');
    square.className = 'square-container';
    
    // 获取链接信息
    const url = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain');
    if (url) {
      // 存储URL信息
      square.dataset.url = url;
      
      // 添加到容器
      dropZone.appendChild(square);
    }
  });
}); 