document.addEventListener('DOMContentLoaded', function() {
  const container = document.getElementById('squaresContainer');
  if (!container) {
    console.warn('squares container not found');
    return;
  }

  // 拖拽排序的正式实现已经统一收敛到 src/js/utils/storage.js 的
  // window.addDragEvents(listItem) 中；page-manager.js 和 storage.js
  // 的加载逻辑都会为 .square-list-item 绑定该实现。
  //
  // 这里保留 components/squares.js 作为兼容占位模块，避免重复绑定
  // 第二套拖拽逻辑造成冲突（重复保存、错误的 DOM 结构操作、未定义变量等）。
  // 如需扩展方块相关行为，应在 storage.js 的唯一实现上继续演进。

  const hasUnifiedDragApi = typeof window.addDragEvents === 'function';
  if (!hasUnifiedDragApi) {
    console.warn('Unified drag API not available yet; drag behavior will be provided by storage.js when loaded.');
  }
});
