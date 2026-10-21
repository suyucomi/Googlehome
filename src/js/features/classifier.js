/* 智能书签分类核心（ESM 纯逻辑，无 DOM 依赖）
 *
 * 依赖：无（fetch 可用时调用 TypeSafe；否则用离线规则）。
 * 页面与 module service worker 共用这一份实现。
 * 导出：LinkClassifier（默认导出 + 具名导出），以及各函数具名导出。
 */

export const DEFAULT_BASE_URL = 'https://api.typesafe.ai';
export const DEFAULT_MODEL = 'jev-latest';
export const MAX_CANDIDATES = 250;
export const UNCATEGORIZED = '未分类';

// 推荐分类：首次使用时只作为候选，模型选中后才在浏览器里创建目录。
export const PROPOSED_FOLDERS = [
  ['学习与教育'],
  ['学习与教育', '编程与计算机'],
  ['学习与教育', '课程与公开课'],
  ['学习与教育', '语言学习'],
  ['学习与教育', '文档与手册'],
  ['新闻与资讯'],
  ['新闻与资讯', '新闻网站'],
  ['新闻与资讯', '科技资讯'],
  ['新闻与资讯', '博客与专栏'],
  ['新闻与资讯', '每日简报'],
  ['购物与生活'],
  ['购物与生活', '电商与二手'],
  ['购物与生活', '优惠与羊毛'],
  ['购物与生活', '生活服务'],
  ['小说与写作', '写作工具'],
  ['小说与写作', '素材与灵感'],
  ['小说与写作', '网文平台'],
  ['社区与论坛', '技术社区'],
  ['社区与论坛', '综合论坛'],
  ['社区与论坛', 'Telegram 群组'],
  ['账号与服务', '账号与合租'],
  ['账号与服务', '订阅与会员'],
  ['账号与服务', '邮箱与身份'],
  ['其他', '待整理']
];

export const DOMAIN_RULES = [
  ['chatgpt.com', ['AI 与 大模型', 'AI 对话与助手'], 0.95],
  ['chat.openai.com', ['AI 与 大模型', 'AI 对话与助手'], 0.95],
  ['poe.com', ['AI 与 大模型', 'AI 对话与助手'], 0.9],
  ['claude.ai', ['AI 与 大模型', 'AI 对话与助手'], 0.95],
  ['anthropic.com', ['AI 与 大模型', 'AI 对话与助手'], 0.9],
  ['gemini.google.com', ['AI 与 大模型', 'AI 对话与助手'], 0.95],
  ['kimi.com', ['AI 与 大模型', 'AI 对话与助手'], 0.9],
  ['doubao.com', ['AI 与 大模型', 'AI 对话与助手'], 0.9],
  ['cursor.so', ['AI 与 大模型', 'AI 编程与建站'], 0.9],
  ['cursor.com', ['AI 与 大模型', 'AI 编程与建站'], 0.9],
  ['v0.dev', ['AI 与 大模型', 'AI 编程与建站'], 0.9],
  ['replicate.com', ['AI 与 大模型', 'API 与开发平台'], 0.9],
  ['huggingface.co', ['AI 与 大模型', 'API 与开发平台'], 0.9],
  ['platform.openai.com', ['AI 与 大模型', 'API 与开发平台'], 0.95],
  ['civitai.com', ['AI 与 大模型', 'AI 绘画与生成'], 0.95],
  ['novelai.net', ['AI 与 大模型', 'AI 绘画与生成'], 0.95],
  ['github.com', ['开发与编程', '代码托管'], 0.95],
  ['gitlab.com', ['开发与编程', '代码托管'], 0.95],
  ['gitee.com', ['开发与编程', '代码托管'], 0.95],
  ['vercel.com', ['开发与编程', '云平台与部署'], 0.9],
  ['zeabur.com', ['开发与编程', '云平台与部署'], 0.9],
  ['koyeb.com', ['开发与编程', '云平台与部署'], 0.9],
  ['heroku.com', ['开发与编程', '云平台与部署'], 0.9],
  ['docker.com', ['开发与编程', '云平台与部署'], 0.85],
  ['developers.cloudflare.com', ['开发与编程', '云平台与部署'], 0.85],
  ['colab.research.google.com', ['开发与编程', '在线开发环境'], 0.95],
  ['vscode.dev', ['开发与编程', '在线开发环境'], 0.9],
  ['runoob.com', ['开发与编程', 'Web 与前端工具'], 0.9],
  ['core.telegram.org', ['开发与编程', 'Bot 与自动化'], 0.9],
  ['fofa.info', ['开发与编程', '安全与网络'], 0.9],
  ['free-programming-books', ['开发与编程', '学习资源'], 0.9],
  ['cloudflare.com', ['服务器与主机', '域名与 DNS'], 0.9],
  ['cloudns.net', ['服务器与主机', '域名与 DNS'], 0.9],
  ['freenom.com', ['服务器与主机', '域名与 DNS'], 0.9],
  ['freessl.cn', ['服务器与主机', '证书与监控'], 0.9],
  ['uptimerobot.com', ['服务器与主机', '证书与监控'], 0.9],
  ['vultr.com', ['服务器与主机', 'VPS 与主机'], 0.9],
  ['digitalocean.com', ['服务器与主机', 'VPS 与主机'], 0.9],
  ['pan.baidu.com', ['工具与效率', '网盘与文件传输'], 0.95],
  ['aliyundrive.com', ['工具与效率', '网盘与文件传输'], 0.95],
  ['alipan.com', ['工具与效率', '网盘与文件传输'], 0.95],
  ['123pan.com', ['工具与效率', '网盘与文件传输'], 0.95],
  ['mega.nz', ['工具与效率', '网盘与文件传输'], 0.95],
  ['dropbox.com', ['工具与效率', '网盘与文件传输'], 0.95],
  ['easychuan.cn', ['工具与效率', '网盘与文件传输'], 0.9],
  ['lanzou', ['工具与效率', '网盘与文件传输'], 0.9],
  ['kinhdown.com', ['工具与效率', '下载与解析'], 0.9],
  ['y2mate.com', ['工具与效率', '下载与解析'], 0.9],
  ['dlpanda.com', ['工具与效率', '下载与解析'], 0.9],
  ['goo.gs', ['工具与效率', '短链与粘贴'], 0.9],
  ['soo.run', ['工具与效率', '短链与粘贴'], 0.9],
  ['pastebin.com', ['工具与效率', '短链与粘贴'], 0.9],
  ['telegra.ph', ['工具与效率', '短链与粘贴'], 0.8],
  ['5sim.net', ['工具与效率', '接码与临时邮箱'], 0.95],
  ['sms-man.com', ['工具与效率', '接码与临时邮箱'], 0.9],
  ['mail.tm', ['工具与效率', '接码与临时邮箱'], 0.9],
  ['temp-mail.org', ['工具与效率', '接码与临时邮箱'], 0.95],
  ['igoutu.cn', ['图片与素材', '图标与设计素材'], 0.9],
  ['wallhaven.cc', ['图片与素材', '壁纸'], 0.95],
  ['pexels.com', ['图片与素材', '图库与插画'], 0.95],
  ['pixabay.com', ['图片与素材', '图库与插画'], 0.95],
  ['unsplash.com', ['图片与素材', '图库与插画'], 0.95],
  ['pixiv.net', ['图片与素材', '图库与插画'], 0.9],
  ['huaban.com', ['图片与素材', '图库与插画'], 0.9],
  ['hellowindows.cn', ['工具与效率', '系统与软件'], 0.9],
  ['music.163.com', ['影音娱乐', '音乐与音频'], 0.95],
  ['spotify.com', ['影音娱乐', '音乐与音频'], 0.95],
  ['bilibili.com', ['影音娱乐', '影视与追剧'], 0.9],
  ['youtube.com', ['影音娱乐', '影视与追剧'], 0.9],
  ['netflix.com', ['影音娱乐', '影视与追剧'], 0.95],
  ['douyin.com', ['影音娱乐', '影视与追剧'], 0.9],
  ['ddys.tv', ['影音娱乐', '影视与追剧'], 0.9],
  ['store.steampowered.com', ['影音娱乐', '游戏'], 0.95],
  ['steamchina.com', ['影音娱乐', '游戏'], 0.9],
  ['fanqienovel.com', ['小说与写作'], 0.95],
  ['qidian.com', ['小说与写作'], 0.95],
  ['jjwxc.net', ['小说与写作'], 0.95],
  ['nodeseek.com', ['社区与论坛'], 0.95],
  ['v2ex.com', ['社区与论坛'], 0.95],
  ['reddit.com', ['社区与论坛'], 0.95],
  ['ptt.cc', ['社区与论坛'], 0.85],
  ['accounts.google.com', ['账号与服务'], 0.9],
  ['slack.com', ['账号与服务'], 0.9],
  ['wordpress.com', ['账号与服务'], 0.9],
  ['pornhub.com', ['成人内容', '视频'], 0.98],
  ['xvideos.com', ['成人内容', '视频'], 0.98],
  ['hanime1.me', ['成人内容', '视频'], 0.95],
  ['hcomic', ['成人内容', '漫画'], 0.95],
  ['manhwa18', ['成人内容', '漫画'], 0.95],
  ['laowang', ['成人内容', '论坛与导航'], 0.95],
  ['theporndude.com', ['成人内容', '论坛与导航'], 0.95]
];

export const KEYWORD_RULES = [
  ['v2ray', ['科学上网', '节点与订阅'], 0.85],
  ['clash', ['科学上网', '节点与订阅'], 0.85],
  ['机场', ['科学上网', '机场与 VPN'], 0.8],
  ['订阅转换', ['科学上网', '节点与订阅'], 0.85],
  ['chatgpt', ['AI 与 大模型', 'AI 对话与助手'], 0.85],
  ['claude', ['AI 与 大模型', 'AI 对话与助手'], 0.85],
  ['网盘', ['工具与效率', '网盘与文件传输'], 0.85],
  ['接码', ['工具与效率', '接码与临时邮箱'], 0.85],
  ['壁纸', ['图片与素材', '壁纸'], 0.85],
  ['图标', ['图片与素材', '图标与设计素材'], 0.8],
  ['小说', ['小说与写作'], 0.85],
  ['论坛', ['社区与论坛'], 0.75],
  ['游戏', ['影音娱乐', '游戏'], 0.75],
  ['影视', ['影音娱乐', '影视与追剧'], 0.8],
  ['音乐', ['影音娱乐', '音乐与音频'], 0.8],
  ['porn', ['成人内容'], 0.85]
];

export function hashString(value) {
  let hash = 5381;
  for (let i = 0; i < value.length; i++) hash = ((hash << 5) + hash + value.charCodeAt(i)) >>> 0;
  return hash.toString(36);
}

export function domainOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

export function classifyByRules({ title = '', url = '' } = {}) {
  const u = String(url).toLowerCase();
  const t = String(title).toLowerCase();
  for (const [frag, path, confidence] of DOMAIN_RULES) {
    if (u.includes(frag)) return { path: [...path], confidence, reason: 'domain:' + frag, source: 'rules' };
  }
  for (const [kw, path, confidence] of KEYWORD_RULES) {
    if (u.includes(kw) || t.includes(kw)) return { path: [...path], confidence, reason: 'keyword:' + kw, source: 'rules' };
  }
  return null;
}

// 把浏览器书签栏节点转成主题页面 + 每页书签（书签对象带 folder 二级分类）
export function buildPagesFromTree(barNode) {
  const pages = [];
  const squaresByPageId = {};
  const usedIds = new Set();

  const pageIdOf = (name) => {
    let id = 'page_' + hashString(name);
    let n = 2;
    while (usedIds.has(id)) id = 'page_' + hashString(name) + '_' + n++;
    usedIds.add(id);
    return id;
  };

  const squareOf = (node, folder) => ({
    url: node.url,
    title: node.title || node.url,
    folder: folder || ''
  });

  const children = (barNode && barNode.children) || [];
  const looseBookmarks = [];

  for (const child of children) {
    if (child.url) {
      looseBookmarks.push(child);
      continue;
    }
    const subfolders = [];
    const squares = [];
    for (const sub of child.children || []) {
      if (sub.url) {
        squares.push(squareOf(sub, ''));
        continue;
      }
      const name = sub.title || '';
      let count = 0;
      for (const item of sub.children || []) {
        if (item.url) {
          squares.push(squareOf(item, name));
          count++;
        }
      }
      if (name && count > 0) subfolders.push(name);
    }
    const seen = new Set();
    const deduped = squares.filter((s) => {
      if (seen.has(s.url)) return false;
      seen.add(s.url);
      return true;
    });
    if (!deduped.length) continue;
    const id = pageIdOf(child.title || '未命名');
    pages.push({
      id,
      name: child.title || '未命名',
      createdAt: new Date().toISOString(),
      bookmarkCount: deduped.length,
      subfolders
    });
    squaresByPageId['squares_' + id] = deduped;
  }

  if (looseBookmarks.length) {
    const id = pageIdOf(UNCATEGORIZED);
    const seen = new Set();
    const squares = looseBookmarks
      .filter((node) => {
        if (seen.has(node.url)) return false;
        seen.add(node.url);
        return true;
      })
      .map((node) => squareOf(node, ''));
    pages.push({
      id,
      name: UNCATEGORIZED,
      createdAt: new Date().toISOString(),
      bookmarkCount: squares.length,
      subfolders: []
    });
    squaresByPageId['squares_' + id] = squares;
  }

  return { pages, squaresByPageId };
}

export function folderCandidatesFromTree(barNode) {
  const out = [];
  for (const child of (barNode && barNode.children) || []) {
    if (child.url) continue;
    out.push({ path: [child.title], id: child.id });
    for (const sub of child.children || []) {
      if (!sub.url) out.push({ path: [child.title, sub.title], id: sub.id });
    }
  }
  return out;
}

export function mergeTaxonomy(existing, options) {
  const opts = options || {};
  const maxDepth = opts.maxDepth || 2;
  const max = opts.max || MAX_CANDIDATES;
  const out = existing.slice();
  const seen = new Set(out.map((c) => c.path.join('/')));
  for (const path of PROPOSED_FOLDERS) {
    if (out.length >= max) break;
    if (path.length > maxDepth) continue;
    const key = path.join('/');
    if (seen.has(key)) continue;
    const parentKey = path.slice(0, -1).join('/');
    if (path.length > 1 && !seen.has(parentKey)) continue;
    seen.add(key);
    out.push({ path: [...path], id: null, proposed: true });
  }
  return out;
}

export function endpointOf(baseUrl) {
  const base = String(baseUrl || DEFAULT_BASE_URL).trim().replace(/\/+$/, '');
  if (!base) throw new Error('未配置接口地址');
  if (/\/systemone$/i.test(base)) return base;
  if (/\/v1$/i.test(base)) return base + '/systemone';
  return base + '/v1/systemone';
}

export function buildSystemOneRequest({ title, url, candidates, model }) {
  const criteria = {};
  const folders = [];
  for (const candidate of candidates) {
    const key = candidate.path.join(' / ');
    criteria[key] = null;
    folders.push(key);
  }
  return {
    model: model || DEFAULT_MODEL,
    state: {
      bookmark: { title: title || '', url: url || '', domain: domainOf(url) },
      folders
    },
    questions: {
      folder: {
        type: 'choice',
        instructions:
          '用户收藏了一个网页，请在候选书签目录中选出最适合长期存放它的一个。' +
          '根据 `bookmark.title`、`bookmark.url` 和 `bookmark.domain` 判断网页的主题和用途，' +
          '选择用户以后最可能去那里找它的目录。有更具体的子目录时优先选子目录，不要选它的父目录；' +
          '只依据候选目录里的名字选择，不要发明新目录。',
        criteria
      },
      belongs: {
        type: 'noul',
        instructions: '`bookmark` 是否明确属于 `folders` 中列出的某个书签目录？',
        criteria: {
          true: '`bookmark` 的主题与 `folders` 中某个目录明显相关，放进去以后容易找到',
          false: '临时页面、工具页，或内容与所有目录都不相关'
        }
      }
    }
  };
}

export function parseAnswer(data, candidates) {
  const answer = data && data.answers && data.answers.folder;
  if (!answer) throw new Error('接口返回缺少 answers.folder');
  if (answer.type !== 'choice') throw new Error('answers.folder 不是 Choice 类型');
  const belongs = data.answers.belongs ? Number(data.answers.belongs.noul) : 1;
  const confidence = Number(answer.confidence);
  if (!Number.isFinite(confidence)) throw new Error('Choice 回答缺少 confidence');
  if (belongs < 0.5) {
    return { path: null, confidence, belongs, reason: '模型判断没有明显匹配的目录' };
  }
  const choice = String(answer.choice);
  const hit = candidates.find((c) => c.path.join(' / ') === choice);
  if (!hit) throw new Error('模型返回了候选之外的目录：' + choice);
  return { path: [...hit.path], confidence, belongs, reason: '' };
}

export async function classifyByModel({ title, url, candidates, settings, fetchImpl }) {
  const apiKey = settings && settings.apiKey;
  if (!apiKey) throw new Error('未配置 API Key');
  const body = buildSystemOneRequest({ title, url, candidates, model: settings.model });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), settings.timeoutMs || 15000);
  try {
    const doFetch = fetchImpl || globalThis.fetch.bind(globalThis);
    const res = await doFetch(endpointOf(settings.baseUrl), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + apiKey
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      const err = new Error('TypeSafe 返回 ' + res.status + (res.status === 451 ? '（当前网络地区不可用，请开代理）' : '') + '：' + text.slice(0, 160));
      err.status = res.status;
      throw err;
    }
    return parseAnswer(await res.json(), candidates);
  } finally {
    clearTimeout(timer);
  }
}

// 决策顺序：模型（配置了 Key）→ 离线规则。两者都没有就返回 null。
export async function decide({ title, url, candidates, settings, fetchImpl }) {
  if (settings && settings.apiKey && settings.autoClassify !== false) {
    try {
      const result = await classifyByModel({ title, url, candidates, settings, fetchImpl });
      if (result.path) {
        const hit = candidates.find((c) => c.path.join('/') === result.path.join('/'));
        if (hit) {
          return {
            path: [...hit.path],
            confidence: result.confidence,
            source: 'model',
            reason: result.reason
          };
        }
      }
    } catch (err) {
      // 模型失败不阻塞，继续用规则
      if (globalThis.console) globalThis.console.warn('[智能书签] 模型分类失败：', err && err.message ? err.message : err);
    }
  }
  const rule = classifyByRules({ title, url });
  if (!rule) return null;
  const hit = candidates.find((c) => c.path.join('/') === rule.path.join('/')) ||
    candidates.find((c) => rule.path.join('/').startsWith(c.path.join('/') + '/'));
  if (!hit) return null;
  return { path: [...hit.path], confidence: rule.confidence, source: 'rules', reason: rule.reason };
}

export const LinkClassifier = {
  DEFAULT_BASE_URL,
  DEFAULT_MODEL,
  UNCATEGORIZED,
  PROPOSED_FOLDERS,
  classifyByRules,
  buildPagesFromTree,
  folderCandidatesFromTree,
  mergeTaxonomy,
  buildSystemOneRequest,
  parseAnswer,
  classifyByModel,
  decide,
  domainOf,
  hashString
};

export default LinkClassifier;
