// tools/seed-data.mjs — 构造审计用的确定性 chrome.storage 数据
// 10 个页面；当前页（p1）300 条书签，其他页各 50 条；含二级分类与长标题。

export const PAGE_NAMES = ['默认页面', '开发工具', '设计灵感', '阅读清单', 'AI 研究',
  '视频收藏', '购物比价', '学习资料', '效率工具', '待整理'];

export function buildSeedData() {
  const pages = PAGE_NAMES.map((name, i) => ({
    id: `p${i + 1}`,
    name,
    bookmarkCount: i === 0 ? 300 : (i === 9 ? 0 : 50),
    subfolders: i === 0 ? ['开发', '设计', '阅读', '稍后读'] : (i < 3 ? ['工作', '生活'] : []),
  }));

  const folders = (pageIdx) => (pageIdx === 0 ? ['开发', '设计', '阅读', '稍后读', ''] : (pageIdx < 3 ? ['工作', '生活', ''] : ['']));
  const titles = [
    'GitHub - 一个很长很长的仓库名称用于测试标题溢出与省略号表现',
    'MDN Web Docs',
    'Figma 设计稿',
    '知乎回答：如何系统地学习前端性能优化',
    'YouTube 视频：CSS Grid 完全指南（第 3 部分）',
    '淘宝 - 便携显示器 15.6 英寸',
    'arXiv 论文',
    'Notion 工作区',
    '短标题',
  ];

  const squaresByPage = {};
  for (let pi = 0; pi < pages.length; pi++) {
    const n = pages[pi].bookmarkCount;
    squaresByPage[pages[pi].id] = Array.from({ length: n }, (_, j) => ({
      url: `https://p${pi + 1}-site${j + 1}.example.com/path/${j + 1}`,
      title: titles[(pi * 3 + j) % titles.length] + (j % 7 === 0 ? ` #${j + 1}` : ''),
      folder: folders(pi)[(j + pi) % folders(pi).length],
    }));
  }

  const settings = { background: { type: 'none', value: '', blur: 0, brightness: 100 }, searchEngine: 'google' };
  const smartSettings = {
    apiKey: '', baseUrl: 'https://api.typesafe.ai', model: 'jev-latest',
    autoClassify: true, taxonomy: true, perfMode: true, timeoutMs: 15000,
  };

  return {
    pages,
    currentPageId: 'p1',
    squaresByPage,
    storage: {
      bookmarkPages: pages,
      currentPageId: 'p1',
      settings,
      smartSettings,
      searchEngine: 'google',
      ...Object.fromEntries(Object.entries(squaresByPage).map(([id, arr]) => [`squares_${id}`, arr])),
    },
    localStorage: {
      sidebarState: 'open',
      currentSearchEngine: 'google',
    },
  };
}

/** 在扩展页面里写入种子数据（chrome.storage.local + localStorage） */
export async function seedPageData(page) {
  const data = buildSeedData();
  const storageJson = JSON.stringify(data.storage);
  const localJson = JSON.stringify(data.localStorage);
  await page.evaluate(`(async () => {
    const storage = ${storageJson};
    const local = ${localJson};
    await chrome.storage.local.clear();
    await chrome.storage.local.set(storage);
    for (const [k, v] of Object.entries(local)) localStorage.setItem(k, v);
    return { keys: Object.keys(storage).length };
  })()`, { timeoutMs: 60000 });
  return data;
}
