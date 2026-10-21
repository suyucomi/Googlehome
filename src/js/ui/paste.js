/**
 * ui/paste.js — 粘贴 / 拖入 URL → 命名弹窗 → store.addBookmark。
 *
 * 行为保持旧 paste.js：
 * - 页面任意非输入区域粘贴 http(s) URL，弹出命名弹窗（标题可编辑，确认后入库）；
 * - 拖拽外部 URL 到页面同样弹出命名弹窗；
 * - 成功后按旧行为镜像到浏览器书签：chrome.runtime.sendMessage({ type:'smart:add', pageName, subfolder, url, title })，
 *   失败只 warn，不影响主题数据；
 * - 输入框/可编辑区域内的粘贴不拦截；内部书签排序拖拽不触发新增。
 */

import { on } from '../core/dom.js';
import { store } from '../core/store.js';
import { isHttpUrl } from '../core/utils.js';
import { createNameDialog, isDialogOpen, showToast } from './dialogs.js';
import { isInternalDrag } from './squares.js';

function isEditableTarget(target) {
  if (!(target instanceof Element)) return false;
  return Boolean(target.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]'));
}

function urlFromDataTransfer(dataTransfer) {
  if (!dataTransfer) return '';
  const uriList = dataTransfer.getData('text/uri-list');
  const plain = dataTransfer.getData('text/plain');
  const candidate = (uriList || plain || '').trim();
  if (!candidate) return '';
  // uri-list 可能有多行（# 开头是注释）
  for (const line of candidate.split(/\r?\n/)) {
    const value = line.trim();
    if (value && !value.startsWith('#')) return value;
  }
  return '';
}

function hasUrlPayload(dataTransfer) {
  if (!dataTransfer) return false;
  const types = Array.from(dataTransfer.types || []);
  if (types.includes('Files')) return false;
  return types.includes('text/uri-list') || types.includes('text/plain');
}

export function mountPaste({ root = document } = {}) {
  let destroyed = false;
  let adding = false;
  const disposers = [];

  async function addFromUrl(url) {
    if (destroyed || adding) return;
    adding = true;
    try {
      const folder = store.state.currentFolder || '';
      const confirmed = await createNameDialog(url);
      if (!confirmed) return;

      const result = await store.addBookmark({
        url: confirmed.url,
        title: confirmed.name,
        folder
      });
      if (!result || result.ok === false) {
        if (result && result.reason === 'duplicate') showToast('这个网址已在当前页面了', 'warning');
        else if (result && result.reason === 'invalid-url') showToast('无效的网址', 'error');
        else showToast('添加书签失败', 'error');
        return;
      }
      showToast('已添加书签');

      // 镜像到浏览器书签（旧行为；background.addToBrowser 自带去重）
      const page = store.getCurrentPage();
      try {
        if (page && typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
          const response = await chrome.runtime.sendMessage({
            type: 'smart:add',
            pageName: page.name,
            subfolder: folder,
            url: confirmed.url,
            title: confirmed.name
          });
          if (!response || !response.ok) {
            console.warn('[paste] 同步浏览器书签失败:', response && response.error);
          }
        }
      } catch (error) {
        console.warn('[paste] 同步浏览器书签失败:', error);
      }
    } catch (error) {
      console.error('[paste] 添加书签失败:', error);
      showToast('添加书签失败', 'error');
    } finally {
      adding = false;
    }
  }

  // 粘贴：跳过输入框/可编辑区；非 URL 时不拦截默认粘贴
  disposers.push(on(document, 'paste', (event) => {
    if (isDialogOpen()) return;
    const target = event.target;
    if (target instanceof Element && target.closest('#searchInput')) return;
    if (isEditableTarget(target)) return;
    const text = event.clipboardData ? event.clipboardData.getData('text') : '';
    const url = String(text || '').trim();
    if (!isHttpUrl(url)) return;
    event.preventDefault();
    addFromUrl(url);
  }));

  // 外部拖入 URL：document 层兜底；内部排序拖拽由 squares.js stopPropagation/preventDefault 拦下
  disposers.push(on(document, 'dragover', (event) => {
    if (isInternalDrag()) return;
    if (!hasUrlPayload(event.dataTransfer)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
  }));

  disposers.push(on(document, 'drop', (event) => {
    if (isInternalDrag()) return;
    if (event.defaultPrevented) return;
    if (isEditableTarget(event.target)) return;
    const url = urlFromDataTransfer(event.dataTransfer);
    if (!isHttpUrl(url)) return;
    event.preventDefault();
    addFromUrl(url);
  }));

  return {
    destroy() {
      if (destroyed) return;
      destroyed = true;
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
