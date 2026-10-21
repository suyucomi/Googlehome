/**
 * ui/search.js — 搜索引擎 UI（图标/下拉/快捷键/提交）。
 *
 * 行为对齐旧 main.js + components/search.js：
 * - 下拉选项由 CONFIG.searchEngines 生成，图标用扩展内 svg（无网络/无 base64）；
 * - 点击引擎按钮开合；点击外部关闭；Esc 关闭；Tab 关闭并交回浏览器；
 * - Alt+数字 快速切换（持久化经 store.setSearchEngine）；
 * - Enter 提交搜索；搜索框内 Tab 聚焦第一个书签方块；
 * - aria-expanded 与真实开合状态同步；当前引擎从 store.state.searchEngine 初始化；
 * - 事件全部委托 / 返回 destroy。
 */

import { el, on, setAttr, toggleClass } from '../core/dom.js';
import { store } from '../core/store.js';
import { CONFIG } from '../core/config.js';
import { createRenderQueue } from './frame.js';

const SWITCH_ANIMATION_MS = 125;

export function mountSearch({ root = document } = {}) {
  const input = root.querySelector('#searchInput');
  const button = root.querySelector('#searchEngine');
  const dropdown = root.querySelector('#searchEngineDropdown');
  if (!input || !button || !dropdown) {
    console.warn('[search] 缺少搜索框结构，跳过挂载');
    return { destroy() {} };
  }
  const wrapper = button.closest('.search-select-container') || dropdown.parentElement;

  const engines = Object.entries(CONFIG.searchEngines || {});
  const engineKeys = engines.map(([key]) => key);
  const disposers = [];
  let destroyed = false;
  let open = false;
  let activeIndex = Math.max(0, engineKeys.indexOf(store.state.searchEngine));
  let lastEngineKey = null;
  let firstRender = true;
  let switchTimer = 0;

  const queue = createRenderQueue(updateEngine);

  /* ---------------- 下拉选项 ---------------- */

  function createOption(key, engine) {
    const option = el('div', {
      className: 'search-select-option',
      attrs: { role: 'option', tabindex: '-1', 'aria-selected': 'false', id: `search-engine-option-${key}` }
    });
    option.dataset.value = key;
    const icon = el('div', { className: 'search-select-option-icon' });
    icon.style.backgroundImage = `url("${engine.icon}")`;
    option.append(icon, el('span', { text: engine.name }));
    return option;
  }

  const optionNodes = engines.map(([key, engine]) => {
    const option = createOption(key, engine);
    dropdown.appendChild(option);
    return option;
  });
  setAttr(dropdown, 'aria-hidden', 'true');

  function options() {
    return optionNodes;
  }

  function setActive(index) {
    if (!optionNodes.length) return;
    activeIndex = Math.max(0, Math.min(index, optionNodes.length - 1));
    optionNodes.forEach((node, i) => {
      const selected = i === activeIndex;
      toggleClass(node, 'active', selected);
      setAttr(node, 'aria-selected', selected ? 'true' : 'false');
      setAttr(node, 'tabindex', selected ? '0' : '-1');
    });
    setAttr(button, 'aria-activedescendant', optionNodes[activeIndex].id);
  }

  function focusActiveOption() {
    const node = optionNodes[activeIndex];
    if (!node) return;
    try {
      node.focus({ preventScroll: true });
      node.scrollIntoView({ block: 'nearest' });
    } catch (error) {
      /* 忽略 */
    }
  }

  function isOpen() {
    return open;
  }

  function openDropdown() {
    if (open) return;
    open = true;
    activeIndex = Math.max(0, engineKeys.indexOf(store.state.searchEngine));
    setActive(activeIndex);
    toggleClass(wrapper, 'active', true);
    setAttr(button, 'aria-expanded', 'true');
    setAttr(dropdown, 'aria-hidden', 'false');
    focusActiveOption();
  }

  function closeDropdown({ restoreFocus = true } = {}) {
    if (!open) return;
    open = false;
    toggleClass(wrapper, 'active', false);
    setAttr(button, 'aria-expanded', 'false');
    setAttr(dropdown, 'aria-hidden', 'true');
    if (restoreFocus) {
      try {
        button.focus({ preventScroll: true });
      } catch (error) {
        /* 忽略 */
      }
    }
  }

  /* ---------------- 当前引擎 ---------------- */

  function applyEngineIcon(engine) {
    button.dataset.engine = lastEngineKey;
    button.style.backgroundImage = `url("${engine.icon}")`;
  }

  function updateEngine() {
    if (destroyed) return;
    const key = store.state.searchEngine;
    const engine = CONFIG.searchEngines[key] || engines[0] && engines[0][1];
    if (!engine) return;
    input.placeholder = `在 ${engine.name} 上搜索`;
    setAttr(button, 'aria-label', `选择搜索引擎（当前 ${engine.name}）`);

    if (key === lastEngineKey) return;
    const previous = lastEngineKey;
    lastEngineKey = key;
    activeIndex = Math.max(0, engineKeys.indexOf(key));
    setActive(activeIndex);

    if (firstRender || !previous) {
      firstRender = false;
      applyEngineIcon(engine);
      return;
    }

    // 切换动画：淡出到一半时换图标，再淡入（旧体验）
    if (switchTimer) clearTimeout(switchTimer);
    button.classList.add('icon-switching');
    switchTimer = setTimeout(() => {
      switchTimer = 0;
      applyEngineIcon(engine);
      requestAnimationFrame(() => {
        if (!destroyed) button.classList.remove('icon-switching');
      });
    }, SWITCH_ANIMATION_MS);
  }

  async function selectEngine(key) {
    if (!key) return;
    try {
      await store.setSearchEngine(key);
    } catch (error) {
      console.warn('[search] 保存搜索引擎失败:', error);
    }
    closeDropdown({ restoreFocus: false });
  }

  function submitSearch() {
    const value = input.value.trim();
    if (!value) return;
    const key = store.state.searchEngine;
    const engine = CONFIG.searchEngines[key] || CONFIG.searchEngines.google;
    if (!engine) return;
    window.location.href = engine.url + encodeURIComponent(value);
  }

  /* ---------------- 事件 ---------------- */

  disposers.push(on(button, 'click', (event) => {
    event.stopPropagation();
    if (open) closeDropdown({ restoreFocus: false });
    else openDropdown();
  }));

  disposers.push(on(button, 'keydown', (event) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) openDropdown();
      else {
        setActive(activeIndex + (event.key === 'ArrowDown' ? 1 : -1));
        focusActiveOption();
      }
      return;
    }
    if (event.key === 'Escape' && open) {
      event.preventDefault();
      event.stopPropagation();
      closeDropdown();
    }
  }));

  disposers.push(on(dropdown, 'click', (event) => {
    const option = event.target instanceof Element ? event.target.closest('.search-select-option') : null;
    if (!option) return;
    selectEngine(option.dataset.value).catch((error) => console.warn('[search]', error));
  }));

  disposers.push(on(dropdown, 'keydown', (event) => {
    const list = options();
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        setActive((activeIndex + 1) % list.length);
        focusActiveOption();
        break;
      case 'ArrowUp':
        event.preventDefault();
        setActive((activeIndex - 1 + list.length) % list.length);
        focusActiveOption();
        break;
      case 'Home':
        event.preventDefault();
        setActive(0);
        focusActiveOption();
        break;
      case 'End':
        event.preventDefault();
        setActive(list.length - 1);
        focusActiveOption();
        break;
      case 'Enter':
      case ' ': {
        event.preventDefault();
        const node = list[activeIndex];
        if (node) selectEngine(node.dataset.value).catch((error) => console.warn('[search]', error));
        break;
      }
      case 'Escape':
        event.preventDefault();
        event.stopPropagation();
        closeDropdown();
        break;
      case 'Tab':
        closeDropdown({ restoreFocus: false });
        break;
      default:
        break;
    }
  }));

  // 点击外部关闭
  disposers.push(on(document, 'click', () => {
    if (open) closeDropdown({ restoreFocus: false });
  }));

  // 搜索框：Enter 提交；Tab 聚焦第一个书签
  disposers.push(on(input, 'keydown', (event) => {
    if (event.key === 'Enter' && !event.isComposing) {
      event.preventDefault();
      submitSearch();
      return;
    }
    if (event.key === 'Tab' && !event.shiftKey) {
      const firstSquare = document.querySelector('#squaresContainer .square-container');
      if (firstSquare) {
        event.preventDefault();
        firstSquare.focus({ preventScroll: true });
      }
    }
  }));

  // 全局：Esc 关闭下拉；Alt+数字切换引擎
  disposers.push(on(document, 'keydown', (event) => {
    if (event.key === 'Escape') {
      if (event.defaultPrevented || !open) return;
      event.preventDefault();
      closeDropdown();
      return;
    }
    if (!event.altKey || event.ctrlKey || event.metaKey || event.defaultPrevented) return;
    if (!/^[1-9]$/.test(event.key)) return;
    const index = Number(event.key) - 1;
    const key = engineKeys[index];
    if (!key) return;
    event.preventDefault();
    selectEngine(key)
      .then(() => input.focus({ preventScroll: true }))
      .catch((error) => console.warn('[search]', error));
  }));

  const unsubscribe = store.subscribe(() => queue.schedule());
  disposers.push(unsubscribe);

  // 首屏
  updateEngine();

  return {
    destroy() {
      if (destroyed) return;
      destroyed = true;
      queue.dispose();
      if (switchTimer) clearTimeout(switchTimer);
      closeDropdown({ restoreFocus: false });
      for (const dispose of disposers.splice(0)) {
        try {
          dispose();
        } catch (error) {
          /* 忽略 */
        }
      }
    }
  };
}
