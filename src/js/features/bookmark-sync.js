/* 浏览器书签 ↔ 主题页面 双向同步（ESM）
 *
 * 依赖：chrome.bookmarks、chrome.storage（仅在函数调用时访问，import 时零副作用）。
 * 页面与 module service worker 共用这一份实现。
 * 导出：BookmarkSync（默认导出 + 具名导出），以及各函数具名导出。
 */

import { LinkClassifier } from './classifier.js';

const KEY_PAGES = 'bookmarkPages';
const KEY_CURRENT = 'currentPageId';
const SUPPRESS_MS = 8000;

// 主题自己写浏览器书签时，background 不能再把这条书签当成“用户星标”重新分类。
const suppressed = new Map();

// 串行化对 bookmarkPages / squares_* 的读改写：
// 首次导入和星标镜像可能同时发生，并发读改写会互相覆盖（实测丢页面）。
let writeQueue = Promise.resolve();
function serialize(task) {
  const run = writeQueue.then(task, task);
  writeQueue = run.then(() => {}, () => {});
  return run;
}

export function suppress(url) {
  if (url) suppressed.set(url, Date.now());
}

export function isSuppressed(url) {
  const at = suppressed.get(url);
  if (!at) return false;
  if (Date.now() - at > SUPPRESS_MS) {
    suppressed.delete(url);
    return false;
  }
  return true;
}

export async function getBarNode() {
  const tree = await chrome.bookmarks.getTree();
  const root = tree && tree[0];
  const children = (root && root.children) || [];
  return children.find((node) => node.title === '书签栏') || children[0] || null;
}

export async function ensureFolderPath(rootId, names) {
  let parentId = rootId;
  for (const name of names) {
    const children = await chrome.bookmarks.getChildren(parentId);
    let hit = children.find((node) => !node.url && node.title === name);
    if (!hit) hit = await chrome.bookmarks.create({ parentId, title: name });
    parentId = hit.id;
  }
  return parentId;
}

// 首次使用：把书签栏的一级目录做成主题页面，二级目录记为书签的 folder。
async function doImport(options) {
  const force = Boolean(options && options.force);
  const bar = await getBarNode();
  if (!bar) return { ok: false, error: '找不到书签栏' };

  const stored = await chrome.storage.local.get([KEY_PAGES, 'smartImport']);
  const existingPages = stored[KEY_PAGES] || [];
  if (!force) {
    if (stored.smartImport) return { ok: true, skipped: true, pages: existingPages.length };
    // 主题可能已经自动建过一个空的「默认页面」；只有这种情况才自动覆盖导入，
    // 已经装过书签的页面不覆盖，避免丢数据。
    const hasContent = existingPages.some((page) => (page.bookmarkCount || 0) > 0);
    if (existingPages.length && hasContent) {
      return { ok: true, skipped: true, pages: existingPages.length };
    }
  }

  const result = LinkClassifier.buildPagesFromTree(bar);
  if (!result.pages.length) return { ok: true, skipped: true, pages: 0 };

  const total = result.pages.reduce((sum, page) => sum + page.bookmarkCount, 0);
  const payload = Object.assign({}, result.squaresByPageId, {
    [KEY_PAGES]: result.pages,
    [KEY_CURRENT]: result.pages[0].id,
    smartImport: { at: Date.now(), count: total }
  });
  await chrome.storage.local.set(payload);
  return { ok: true, pages: result.pages.length, bookmarks: total };
}

async function doMirror({ url, title, pageName, subfolder }) {
  if (!url || !pageName) return;
  const stored = await chrome.storage.local.get([KEY_PAGES]);
  const pages = stored[KEY_PAGES] || [];
  let page = pages.find((item) => item.name === pageName);
  if (!page) {
    page = {
      id: 'page_' + LinkClassifier.hashString(pageName),
      name: pageName,
      createdAt: new Date().toISOString(),
      bookmarkCount: 0,
      subfolders: []
    };
    pages.push(page);
  }
  const key = 'squares_' + page.id;
  const got = await chrome.storage.local.get(key);
  const squares = got[key] || [];
  if (!squares.some((item) => item.url === url)) {
    squares.push({ url, title: title || url, folder: subfolder || '' });
  }
  page.bookmarkCount = squares.length;
  if (subfolder && !(page.subfolders || []).includes(subfolder)) {
    page.subfolders = (page.subfolders || []).concat(subfolder);
  }
  await chrome.storage.local.set({ [KEY_PAGES]: pages, [key]: squares });
}

// 主题里新增书签：也写一份到浏览器对应目录。
async function doAddToBrowser({ pageName, subfolder, url, title }) {
  if (!url) return { ok: false, error: '缺少 url' };
  if (!chrome.bookmarks) return { ok: false, error: '没有 bookmarks 权限' };
  const bar = await getBarNode();
  if (!bar) return { ok: false, error: '找不到书签栏' };

  suppress(url);
  const names = [pageName].concat(subfolder ? [subfolder] : []).filter(Boolean);
  const folderId = await ensureFolderPath(bar.id, names);
  const children = await chrome.bookmarks.getChildren(folderId);
  const exists = children.some((node) => node.url === url);
  if (!exists) {
    await chrome.bookmarks.create({ parentId: folderId, title: title || url, url });
  }
  await doMirror({ url, title, pageName, subfolder });
  return { ok: true, created: !exists, folderId };
}

// 对外入口：统一走串行队列，避免并发写坏页面数据
export function importFromBrowser(options) {
  return serialize(() => doImport(options));
}

export function mirrorToTheme(entry) {
  return serialize(() => doMirror(entry));
}

export function addToBrowser(entry) {
  return serialize(() => doAddToBrowser(entry));
}

// 把主题页面重命名/删除时同步浏览器目录（可选，暂供设置页“重建页面”用）
export async function rebuildFromBrowser() {
  return importFromBrowser({ force: true });
}

export const BookmarkSync = {
  getBarNode,
  ensureFolderPath,
  importFromBrowser,
  mirrorToTheme,
  addToBrowser,
  rebuildFromBrowser,
  suppress,
  isSuppressed
};

export default BookmarkSync;
