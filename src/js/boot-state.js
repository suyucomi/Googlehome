/**
 * boot-state.js — 首帧前同步写入侧栏布局状态（html[data-sidebar]）。
 *
 * 为什么要它：
 *   store.init() 是异步的（读 chrome.storage / 首次导入书签）。如果等它完成
 *   再决定主内容列是否让出侧栏宽度，桌面端会在首帧后整体右移 300px，
 *   产生一次明显的 layout shift（实测 CLS≈0.19）。
 *   本脚本在 <head> 中、样式表之后同步执行（documentElement 已存在），
 *   用与 core/store.js 完全一致的规则提前写好 `html[data-sidebar="open|closed"]`，
 *   首帧即按最终布局渲染，之后 store/sidebar 的应用是幂等的。
 *
 * 状态规则（与 store.init 保持一致）：
 *   localStorage.sidebarState === 'closed' → closed
 *   localStorage.sidebarState === 'open'   → open
 *   无记录 → 桌面默认 open，移动端默认 closed
 *
 * 移动端侧栏是 fixed 覆盖式抽屉，不参与文档流；CSS 里 data-sidebar 的
 * 让位规则只在 @media (min-width:769px) 生效，移动端不会因此位移。
 *
 * 这是整个扩展里唯一的同步经典脚本；其余逻辑全部在 ESM 模块中。
 */
(function initSidebarLayoutState() {
  var root = document.documentElement;
  try {
    var saved = null;
    try {
      saved = window.localStorage ? window.localStorage.getItem('sidebarState') : null;
    } catch (error) {
      saved = null;
    }
    var isMobile = window.innerWidth <= 768;
    var open = saved === 'closed' ? false : saved === 'open' ? true : !isMobile;
    root.dataset.sidebar = open ? 'open' : 'closed';
  } catch (error) {
    // 预置失败也不影响启动：store 初始化后 ui/sidebar 会写入正确状态
    root.dataset.sidebar = 'open';
  }
})();
