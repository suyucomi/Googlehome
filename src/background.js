/* Googlehome background service worker（ES module）
 * 职责：
 *  1. 首次安装时把浏览器书签栏导入主题页面
 *  2. 浏览器里点星标时自动分类，并同步到主题页面
 *
 * 依赖：feature 层（classifier / bookmark-sync），页面与 worker 共用同一份实现。
 * manifest 需声明 "background": { "service_worker": "src/background.js", "type": "module" }。
 */

import { BookmarkSync } from './js/features/bookmark-sync.js';
import { LinkClassifier } from './js/features/classifier.js';
import { DEFAULT_SMART } from './js/core/config.js';

async function getSmartSettings() {
  const data = await chrome.storage.local.get('smartSettings');
  return Object.assign({}, DEFAULT_SMART, data.smartSettings || {});
}

async function runImport(force) {
  try {
    return await BookmarkSync.importFromBrowser({ force: Boolean(force) });
  } catch (err) {
    console.warn('[Googlehome] 导入书签失败：', err);
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
}

chrome.runtime.onInstalled.addListener(() => runImport(false));
chrome.runtime.onStartup.addListener(() => runImport(false));

const CACHE_TTL = 90 * 24 * 60 * 60 * 1000;

async function getCachedPath(domain) {
  if (!domain) return null;
  try {
    const data = await chrome.storage.local.get('smartCache');
    const hit = (data.smartCache || {})[domain];
    if (!hit || !Array.isArray(hit.path)) return null;
    if (hit.at && Date.now() - hit.at > CACHE_TTL) return null;
    return hit.path;
  } catch (error) {
    return null;
  }
}

async function putCachedPath(domain, path) {
  if (!domain || !Array.isArray(path) || !path.length) return;
  try {
    const data = await chrome.storage.local.get('smartCache');
    const cache = data.smartCache || {};
    cache[domain] = { path: [...path], at: Date.now() };
    const keys = Object.keys(cache);
    if (keys.length > 500) {
      keys.sort((a, b) => (cache[a].at || 0) - (cache[b].at || 0));
      for (const key of keys.slice(0, keys.length - 500)) delete cache[key];
    }
    await chrome.storage.local.set({ smartCache: cache });
  } catch (error) {
    // 缓存失败不影响主流程
  }
}

async function handleCreated(id, node) {
  if (!node || !node.url) return;
  if (BookmarkSync.isSuppressed(node.url)) return;

  const settings = await getSmartSettings();
  if (settings.autoClassify === false) return;

  const bar = await BookmarkSync.getBarNode();
  // 只接管“收藏在书签栏根目录”的书签；用户手动放进子目录就尊重用户选择。
  if (!bar || node.parentId !== bar.id) return;

  let candidates = LinkClassifier.folderCandidatesFromTree(bar);
  if (settings.taxonomy !== false) {
    candidates = LinkClassifier.mergeTaxonomy(candidates, { maxDepth: 2 });
  }
  if (!candidates.length) return;

  // 同一域名第二次收藏直接复用上次的分类，省一次模型调用
  const domain = LinkClassifier.domainOf(node.url);
  const cachedPath = settings.learning === false ? null : await getCachedPath(domain);

  let decision = cachedPath
    ? { path: cachedPath, confidence: 0.99, source: 'cache', reason: '域名缓存' }
    : null;

  if (!decision) {
    try {
      decision = await LinkClassifier.decide({
        title: node.title,
        url: node.url,
        candidates,
        settings
      });
    } catch (err) {
      console.warn('[Googlehome] 分类失败：', err);
      return;
    }
    if (decision) await putCachedPath(domain, decision.path);
  }
  if (!decision) {
    // 分类不出来也至少让主题里能看到：放进「未分类」页面，浏览器书签保持原位
    try {
      await BookmarkSync.mirrorToTheme({
        url: node.url,
        title: node.title,
        pageName: LinkClassifier.UNCATEGORIZED,
        subfolder: ''
      });
    } catch (err) {
      console.warn('[Googlehome] 同步未分类失败：', err);
    }
    return;
  }

  try {
    const folderId = await BookmarkSync.ensureFolderPath(bar.id, decision.path);
    await chrome.bookmarks.move(id, { parentId: folderId, index: 0 });
    await BookmarkSync.mirrorToTheme({
      url: node.url,
      title: node.title,
      pageName: decision.path[0],
      subfolder: decision.path[1] || ''
    });
  } catch (err) {
    console.warn('[Googlehome] 移动/同步失败：', err);
  }
}

chrome.bookmarks.onCreated.addListener((id, node) => {
  handleCreated(id, node).catch((err) => console.warn('[Googlehome]', err));
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      if (msg && msg.type === 'smart:import') {
        sendResponse(await runImport(Boolean(msg.force)));
      } else if (msg && msg.type === 'smart:add') {
        sendResponse(await BookmarkSync.addToBrowser(msg));
      } else if (msg && msg.type === 'smart:status') {
        const data = await chrome.storage.local.get(['smartImport', 'bookmarkPages']);
        sendResponse({
          ok: true,
          importedAt: (data.smartImport && data.smartImport.at) || 0,
          bookmarks: (data.smartImport && data.smartImport.count) || 0,
          pages: (data.bookmarkPages || []).length
        });
      } else {
        sendResponse({ ok: false, error: 'unknown message' });
      }
    } catch (err) {
      sendResponse({ ok: false, error: err && err.message ? err.message : String(err) });
    }
  })();
  return true;
});
