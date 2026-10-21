/**
 * ui/settings-panel.js — 设置面板开合 / 焦点管理 / 表单绑定。
 *
 * 开合（状态来自 store.state.ui.settingsOpen）：
 * - 打开：.settings-panel.active + aria-hidden=false，.app-main / #sidebar / #sidebarTrigger 设 inert，
 *   body.settings-open（CSS 锁滚动），焦点进入面板首个可聚焦控件；
 * - Tab 焦点陷阱；Esc 关闭；点击面板外/关闭按钮关闭；关闭恢复焦点、清除 inert；
 * - 滚动完全交给 CSS（.settings-body），不做 JS overflow 操作。
 *
 * 表单：
 * - 背景：选择图片（UI 侧 FileReader + canvas 压缩/校验）→ 预览/模糊/亮度 → 确定
 *   → store.updateSettings({background}) → features/settings.applyBackground(store.state.settings)；
 * - 智能分类：apiKey/model/autoClassify/taxonomy → store.updateSmartSettings；
 * - perfMode：先 applyPerfMode 再 store.updateSmartSettings；
 * - 重新导入 / 导出 / 导入配置（features/import-export 的 hooks 注入 confirm/toast/download/reload）。
 *
 * 依赖：core/*、features/settings、features/import-export、ui/frame、ui/dialogs。
 */

import { on, setAttr, setText } from '../core/dom.js';
import { store } from '../core/store.js';
import { CONFIG, DEFAULT_SMART } from '../core/config.js';
import { applyBackground, applyPerfMode } from '../features/settings.js';
import { exportConfig, importConfig } from '../features/import-export.js';
import { createRenderQueue, focusableWithin, trapTab } from './frame.js';
import { confirmDialog, showToast } from './dialogs.js';

const STATUS_ERROR_COLOR = '#ff7b7b';

export function mountSettingsPanel({ root = document } = {}) {
  const panel = root.querySelector('#settingsPanel');
  if (!panel) {
    console.warn('[settings-panel] 缺少 #settingsPanel，跳过挂载');
    return { destroy() {} };
  }

  const appMain = root.querySelector('.app-main') || root.querySelector('#appMain');
  const trigger = root.querySelector('#sidebarTrigger');
  const settingsBtn = root.querySelector('#sidebarSettingsBtn');
  const panelBody = panel.querySelector('.settings-body') || panel;

  const ids = [
    'closeSettings',
    'previewImage',
    'previewPlaceholder',
    'backgroundFile',
    'blurRange',
    'brightnessRange',
    'blurValue',
    'brightnessValue',
    'confirmBackground',
    'smartApiKey',
    'smartModel',
    'smartAutoClassify',
    'smartTaxonomy',
    'smartReimport',
    'smartStatus',
    'smartPerfMode',
    'exportConfig',
    'importConfig',
    'configFileInput'
  ];
  const nodes = {};
  for (const id of ids) nodes[id] = root.querySelector('#' + id);

  const disposers = [];
  let destroyed = false;
  let open = false;
  let previousFocus = null;
  let dirty = false;
  let working = null; // 背景编辑中的值 {type,value,blur,brightness}
  let statusLoaded = false;

  const queue = createRenderQueue(() => {
    if (destroyed) return;
    renderOpen(Boolean(store.state.ui.settingsOpen));
    if (open) syncForm(store.state);
  });

  /* ---------------- 开合 ---------------- */

  function setInert(node, inert) {
    if (!node) return;
    if (inert) node.setAttribute('inert', '');
    else node.removeAttribute('inert');
  }

  function openPanel(state) {
    previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panel.classList.add('active');
    panel.removeAttribute('inert');
    setAttr(panel, 'aria-hidden', 'false');
    setInert(appMain, true);
    setInert(trigger, true);
    // #sidebar 的 inert 由 ui/sidebar 根据 state.ui.settingsOpen 统一管理，避免两个模块互相覆盖
    document.body.classList.add('settings-open');
    if (settingsBtn) setAttr(settingsBtn, 'aria-expanded', 'true');

    loadBackgroundForm(state);
    syncForm(state);
    loadImportStatus();
    if (panelBody) panelBody.scrollTop = 0;

    const focusables = focusableWithin(panel);
    const target = focusables[0] || panel;
    try {
      target.focus({ preventScroll: true });
    } catch (error) {
      /* 忽略 */
    }
  }

  function closePanel() {
    panel.classList.remove('active');
    panel.setAttribute('inert', '');
    setAttr(panel, 'aria-hidden', 'true');
    setInert(appMain, false);
    setInert(trigger, false);
    document.body.classList.remove('settings-open');
    if (settingsBtn) setAttr(settingsBtn, 'aria-expanded', 'false');

    // 焦点回归：优先打开前的元素；body/documentElement（程序化 click 常见）不算有效目标，回退到设置按钮
    const fallback = settingsBtn || trigger || null;
    const target = isUsableFocusTarget(previousFocus) ? previousFocus : fallback;
    // 下一帧再恢复焦点：本帧稍后 ui/sidebar 会按 state 清除自己的 inert，否则聚焦会失败
    requestAnimationFrame(() => {
      if (destroyed || open) return;
      focusWithFallback(target, fallback);
    });
    previousFocus = null;
  }

  /** body/documentElement 等不是有效“恢复焦点”目标（程序化 click 时 activeElement 常是 body） */
  function isUsableFocusTarget(node) {
    if (!node || !node.isConnected) return false;
    if (node === document.body || node === document.documentElement) return false;
    if (node.closest && node.closest('[inert]')) return false;
    return typeof node.focus === 'function';
  }

  function focusWithFallback(target, fallback) {
    const attempt = (node) => {
      if (!node || !node.isConnected) return false;
      try {
        node.focus({ preventScroll: true });
      } catch (error) {
        return false;
      }
      return document.activeElement === node;
    };
    if (attempt(target)) return;
    if (fallback && fallback !== target) attempt(fallback);
  }

  function renderOpen(nextOpen) {
    if (nextOpen === open) return;
    open = nextOpen;
    if (open) openPanel(store.state);
    else closePanel();
  }

  /* ---------------- 表单同步 ---------------- */

  function setInputValue(field, value) {
    if (!field) return;
    const next = value == null ? '' : String(value);
    if (document.activeElement === field) return;
    if (field.value !== next) field.value = next;
  }

  function setCheckbox(field, checked) {
    if (!field) return;
    const next = Boolean(checked);
    if (field.checked !== next) field.checked = next;
  }

  function setRange(field, value) {
    if (!field) return;
    const next = String(Number(value) || 0);
    if (field.value !== next) field.value = next;
  }

  function syncForm(state) {
    const smart = state.smartSettings || {};
    setInputValue(nodes.smartApiKey, smart.apiKey || '');
    setInputValue(nodes.smartModel, smart.model || DEFAULT_SMART.model);
    setCheckbox(nodes.smartAutoClassify, smart.autoClassify !== false);
    setCheckbox(nodes.smartTaxonomy, smart.taxonomy !== false);
    setCheckbox(nodes.smartPerfMode, smart.perfMode !== false);
    if (!dirty) loadBackgroundForm(state);
  }

  function backgroundFromState(state) {
    const background = (state.settings && state.settings.background) || {};
    return {
      type: background.type || 'none',
      value: background.value || '',
      blur: Number(background.blur) || 0,
      brightness: Number(background.brightness) || 100
    };
  }

  function loadBackgroundForm(state) {
    working = backgroundFromState(state);
    dirty = false;
    renderBackgroundForm();
  }

  function renderBackgroundForm() {
    if (!working) return;
    const hasImage = working.type === 'image' && Boolean(working.value);
    if (nodes.previewImage) {
      if (hasImage) {
        if (nodes.previewImage.getAttribute('src') !== working.value) nodes.previewImage.src = working.value;
        nodes.previewImage.style.display = 'block';
        nodes.previewImage.style.filter = `blur(${working.blur}px) brightness(${working.brightness}%)`;
      } else {
        nodes.previewImage.style.display = 'none';
      }
    }
    if (nodes.previewPlaceholder) nodes.previewPlaceholder.style.display = hasImage ? 'none' : 'flex';
    if (nodes.blurRange) {
      nodes.blurRange.disabled = !hasImage;
      setRange(nodes.blurRange, working.blur);
    }
    if (nodes.brightnessRange) {
      nodes.brightnessRange.disabled = !hasImage;
      setRange(nodes.brightnessRange, working.brightness);
    }
    setText(nodes.blurValue, working.blur);
    setText(nodes.brightnessValue, working.brightness);
    if (nodes.confirmBackground) nodes.confirmBackground.disabled = !hasImage;
  }

  function setStatus(text, isError = false) {
    if (!nodes.smartStatus) return;
    nodes.smartStatus.textContent = text || '';
    nodes.smartStatus.style.color = isError ? STATUS_ERROR_COLOR : '';
  }

  async function loadImportStatus() {
    if (statusLoaded) return;
    statusLoaded = true;
    try {
      if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.sendMessage) return;
      const result = await chrome.runtime.sendMessage({ type: 'smart:status' });
      if (result && result.ok && result.bookmarks) {
        setStatus('已导入 ' + result.bookmarks + ' 条书签');
      }
    } catch (error) {
      /* 状态展示失败不影响设置 */
    }
  }

  /* ---------------- 背景图片处理 ---------------- */

  function readFileAsDataURL(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(reader.error || new Error('文件读取失败'));
      reader.readAsDataURL(file);
    });
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('图片加载失败'));
      image.src = src;
    });
  }

  async function processImageFile(file) {
    const dataUrl = await readFileAsDataURL(file);
    const image = await loadImage(dataUrl);
    const {
      BACKGROUND_MAX_WIDTH = 1920,
      BACKGROUND_MAX_HEIGHT = 1080,
      BACKGROUND_QUALITY = 0.85
    } = CONFIG.constants || {};
    const maxFileSize = (CONFIG.security && CONFIG.security.maxFileSize) || 5 * 1024 * 1024;
    const needCompress =
      file.size > maxFileSize / 2 ||
      image.width > BACKGROUND_MAX_WIDTH ||
      image.height > BACKGROUND_MAX_HEIGHT;
    if (!needCompress) return dataUrl;

    const ratio = Math.min(BACKGROUND_MAX_WIDTH / image.width, BACKGROUND_MAX_HEIGHT / image.height, 1);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.width * ratio));
    canvas.height = Math.max(1, Math.round(image.height * ratio));
    const context = canvas.getContext('2d');
    if (!context) return dataUrl;
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    try {
      return canvas.toDataURL('image/jpeg', BACKGROUND_QUALITY);
    } catch (error) {
      return dataUrl;
    }
  }

  async function handleBackgroundFile(file) {
    if (!file) return;
    const security = CONFIG.security || {};
    const maxFileSize = security.maxFileSize || 5 * 1024 * 1024;
    const formats = Array.isArray(security.supportedImageFormats)
      ? security.supportedImageFormats
      : ['image/jpeg', 'image/png', 'image/webp'];
    if (file.size > maxFileSize) {
      showToast('图片大小不能超过 5MB', 'error');
      return;
    }
    if (!formats.includes(file.type)) {
      showToast('仅支持 JPG、PNG 和 WebP 格式', 'error');
      return;
    }
    try {
      showToast('正在处理图片...', 'info');
      const dataUrl = await processImageFile(file);
      working = {
        type: 'image',
        value: dataUrl,
        blur: Number(nodes.blurRange && nodes.blurRange.value) || 0,
        brightness: Number(nodes.brightnessRange && nodes.brightnessRange.value) || 100
      };
      dirty = true;
      renderBackgroundForm();
      if (nodes.previewImage) {
        nodes.previewImage.style.filter = `blur(${working.blur}px) brightness(${working.brightness}%)`;
      }
    } catch (error) {
      console.error('[settings-panel] 背景图片处理失败:', error);
      showToast('图片处理失败', 'error');
    }
  }

  async function confirmBackground() {
    if (!working || working.type !== 'image' || !working.value) {
      showToast('请先选择一张背景图片', 'warning');
      return;
    }
    const background = {
      type: 'image',
      value: working.value,
      blur: Number(working.blur) || 0,
      brightness: Number(working.brightness) || 100
    };
    try {
      // 先应用性能模式，让 applyBackground 走无过渡路径（与旧体验一致）
      applyPerfMode(store.state.smartSettings.perfMode !== false);
      await store.updateSettings({ background });
      applyBackground(store.state.settings);
      dirty = false;
      showToast('背景设置已保存');
    } catch (error) {
      console.error('[settings-panel] 保存背景失败:', error);
      showToast('保存设置失败', 'error');
    }
  }

  /* ---------------- 智能分类 / 性能 ---------------- */

  async function updateSmart(patch) {
    try {
      await store.updateSmartSettings(patch);
    } catch (error) {
      console.error('[settings-panel] 保存智能设置失败:', error);
      showToast('保存设置失败', 'error');
    }
  }

  async function handlePerfModeChange(checked) {
    applyPerfMode(Boolean(checked));
    await updateSmart({ perfMode: Boolean(checked) });
  }

  async function reimportBookmarks() {
    const ok = await confirmDialog({
      title: '重新导入浏览器书签',
      message: '重新导入会按当前浏览器书签栏重建主题页面（主题里手动加的书签会保留在浏览器书签中）。继续？',
      confirmText: '继续',
      danger: true
    });
    if (!ok) return;
    setStatus('正在导入…');
    try {
      if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.sendMessage) {
        throw new Error('扩展环境不可用');
      }
      const result = await chrome.runtime.sendMessage({ type: 'smart:import', force: true });
      if (!result || !result.ok) throw new Error((result && result.error) || '导入失败');
      setStatus('已导入 ' + (result.bookmarks || 0) + ' 条，' + (result.pages || 0) + ' 个分类');
      setTimeout(() => window.location.reload(), 800);
    } catch (error) {
      setStatus('导入失败：' + (error && error.message ? error.message : error), true);
    }
  }

  /* ---------------- 导入 / 导出 ---------------- */

  function downloadConfigFile({ filename, json, mime }) {
    const blob = new Blob([json], { type: mime || 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename || 'search-config.json';
    anchor.style.display = 'none';
    // 下载用的临时 <a> 点击事件会冒泡到 document；阻止冒泡，避免触发「点击面板外关闭设置」
    anchor.addEventListener('click', (event) => event.stopPropagation());
    document.body.appendChild(anchor);
    anchor.click();
    setTimeout(() => {
      anchor.remove();
      URL.revokeObjectURL(url);
    }, 0);
  }

  async function handleExport() {
    try {
      await exportConfig({ download: downloadConfigFile, notify: showToast });
    } catch (error) {
      console.error('[settings-panel] 导出配置失败:', error);
      showToast('导出失败', 'error');
    }
  }

  async function handleImport(file) {
    if (!file) return;
    try {
      await importConfig(file, {
        confirm: () => confirmDialog({
          title: '导入配置',
          message: '导入将覆盖现有配置，是否继续？',
          confirmText: '导入',
          danger: true
        }),
        notify: showToast,
        reload: () => setTimeout(() => window.location.reload(), 800)
      });
    } catch (error) {
      console.error('[settings-panel] 导入配置失败:', error);
      showToast('导入失败', 'error');
    } finally {
      if (nodes.configFileInput) nodes.configFileInput.value = '';
    }
  }

  /* ---------------- 事件（委托到面板） ---------------- */

  function handleClick(event) {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;

    if (target.closest('#closeSettings')) {
      store.setUi({ settingsOpen: false });
      return;
    }
    if (target.closest('#confirmBackground')) {
      confirmBackground().catch((error) => console.error('[settings-panel]', error));
      return;
    }
    if (target.closest('#smartReimport')) {
      reimportBookmarks().catch((error) => console.error('[settings-panel]', error));
      return;
    }
    if (target.closest('#exportConfig')) {
      handleExport();
      return;
    }
    if (target.closest('#importConfig')) {
      if (nodes.configFileInput) nodes.configFileInput.click();
    }
  }

  function handleChange(event) {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const id = target.id;

    if (id === 'backgroundFile') {
      const file = target.files && target.files[0];
      handleBackgroundFile(file).catch((error) => console.error('[settings-panel]', error));
      target.value = '';
      return;
    }
    if (id === 'configFileInput') {
      const file = target.files && target.files[0];
      handleImport(file).catch((error) => console.error('[settings-panel]', error));
      return;
    }
    if (id === 'smartApiKey') {
      updateSmart({ apiKey: (target.value || '').trim() });
      return;
    }
    if (id === 'smartModel') {
      updateSmart({ model: (target.value || '').trim() || DEFAULT_SMART.model });
      return;
    }
    if (id === 'smartAutoClassify') {
      updateSmart({ autoClassify: target.checked });
      return;
    }
    if (id === 'smartTaxonomy') {
      updateSmart({ taxonomy: target.checked });
      return;
    }
    if (id === 'smartPerfMode') {
      handlePerfModeChange(target.checked).catch((error) => console.error('[settings-panel]', error));
    }
  }

  function handleInput(event) {
    const target = event.target;
    if (!(target instanceof HTMLElement) || !working) return;
    if (target.id === 'blurRange') {
      working.blur = Number(target.value) || 0;
      dirty = true;
      setText(nodes.blurValue, working.blur);
      if (nodes.previewImage) {
        nodes.previewImage.style.filter = `blur(${working.blur}px) brightness(${working.brightness}%)`;
      }
      return;
    }
    if (target.id === 'brightnessRange') {
      working.brightness = Number(target.value) || 100;
      dirty = true;
      setText(nodes.brightnessValue, working.brightness);
      if (nodes.previewImage) {
        nodes.previewImage.style.filter = `blur(${working.blur}px) brightness(${working.brightness}%)`;
      }
    }
  }

  disposers.push(on(panel, 'click', handleClick));
  disposers.push(on(panel, 'change', handleChange));
  disposers.push(on(panel, 'input', handleInput));

  // Esc 关闭 + Tab 焦点陷阱（先注册：优先于侧栏/搜索的 Esc 处理）
  disposers.push(on(document, 'keydown', (event) => {
    if (!open || event.defaultPrevented) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      store.setUi({ settingsOpen: false });
      return;
    }
    if (event.key === 'Tab') trapTab(event, panel);
  }));

  // 点击面板外部关闭（弹窗打开时不算外部点击）
  disposers.push(on(document, 'click', (event) => {
    if (!open) return;
    const target = event.target instanceof Node ? event.target : null;
    if (!target) return;
    if (panel.contains(target)) return;
    if (settingsBtn && settingsBtn.contains(target)) return;
    if (document.querySelector('.dialog-overlay:not(.closing), .context-menu')) return;
    store.setUi({ settingsOpen: false });
  }));

  const unsubscribe = store.subscribe(() => queue.schedule());
  disposers.push(unsubscribe);

  return {
    destroy() {
      if (destroyed) return;
      destroyed = true;
      queue.dispose();
      if (open) {
        panel.classList.remove('active');
        setInert(appMain, false);
        setInert(trigger, false);
        document.body.classList.remove('settings-open');
      }
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
