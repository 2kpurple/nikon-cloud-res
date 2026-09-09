#!/usr/bin/env node
/**
 * Nikon 色彩方案创摄者爬虫(多站点 × 多语言)
 *
 * 两站结构相同,均为 Next.js SPA:
 *  1. 动态发现包含创作者结构数据的 JS chunk (搜索 img:{url:"/img/recipe/release/creator_fig)
 *  2. _app.js 中的 i18n 键值映射 (12 种语言,按 WID1185_2 键在各语言下的文案切段)
 *
 * 输出: assets/creators_{站点}_{语言}.json
 *   站点: cn   = imagingcloud.nikon.com.cn
 *         intl = imagingcloud.nikon.com
 *   语言: de en es fr it ja zh zh_tw ko nl tr ru
 *
 * 方案 id 说明: release 服务端按语言分书(每种语言一本书、一套独立资源 id),
 * 站点静态数据里每个方案的分语言详情 URL 天然指向该语言的书,故直接取
 * URL 中的 id 即可,无需也无法对齐到某一本"统一的书"。
 *
 * 用法: node scrape-creators.js
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const ASSETS_DIR = path.join(__dirname, 'assets');

const SITES = [
  {
    key: 'cn',
    baseUrl: 'https://imagingcloud.nikon.com.cn',
    pageUrl: '/recipe/release/?bookId=01HXDNN2X6N0ZHNP0WFBDF407Z',
    // CN 站只有简中数据完整: 其他语言仅覆盖国际共享的 32/66 位创作者,
    // 77 个较新色彩方案也只有中文 URL。完整多语言数据从 intl 站取
    langs: ['zh'],
    // 兼容别名: 内测用户已在用旧 URL,保持同步更新
    aliases: { zh: 'creators_zh.json' },
  },
  {
    key: 'intl',
    baseUrl: 'https://imagingcloud.nikon.com',
    pageUrl: '/recipe/release',
    langs: null, // 全部检测到的语言
  },
];

// i18n 段落定位标记: 同一个键 WID1185_2("人像摄影师")在各语言下的文案各不相同,
// 以此确定每种语言段落在 _app.js 中的起点。值为 JS 源码转义解码后的文本。
// zh/tr 两站文案略有差异,两种变体都收录。值为 JS 源码转义解码后的文本。
const LANG_BY_MARKER = {
  'Porträtfotograf': 'de',
  'Portrait Photographer': 'en',
  'Retratista': 'es',
  'Photographe': 'fr',
  'Fotografo di ritratti': 'it',
  'ポートレートフォトグラファー': 'ja',
  '人像摄影师': 'zh', // CN 站简体
  '肖像摄影师': 'zh', // intl 站简体
  '人像攝影師': 'zh_tw',
  '인물 사진 작가': 'ko',
  'Portretfotograaf': 'nl',
  'Portre Fotoğrafçı': 'tr', // CN 站
  'Portre Fotoğrafçısı': 'tr', // intl 站(结尾多个 ı)
  'Фотограф-портретист': 'ru',
};

// --- 网络请求(攒齐原始字节后统一解码,避免多字节字符被包边界切碎) ---
function fetch(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
    }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return fetch(res.headers.location).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    });
    req.on('error', reject);
  });
}

function unescapeJsEscapes(s) {
  // \uXXXX / \xXX 为站点实际在用的转义;引号反斜杠的转义残留(如 D\'Ann)也一并还原。
  // 引号类替换循环到稳定: 源码里 D\\'Ann 这种双重转义,单次替换会留下 \' 残字
  let prev;
  do {
    prev = s;
    s = s
      .replace(/\\u([\da-fA-F]{4})|\\x([\da-fA-F]{2})/g, (_, u4, x2) =>
        String.fromCharCode(parseInt(u4 || x2, 16))
      )
      .replace(/\\(['"\\/])/g, '$1');
  } while (s !== prev);
  return s;
}

// --- 从 HTML 提取 JS chunk 路径 ---
function extractJsChunks(html) {
  const paths = [];
  const pattern = /src="(\/_next\/static\/chunks\/[^"]+\.js)"/g;
  let match;
  while ((match = pattern.exec(html))) {
    paths.push(match[1]);
  }
  return paths;
}

// --- 检测 _app.js 中各语言段落的位置 ---
function detectLanguageSections(content) {
  const pattern = /"ID-NC-VF0502_WID1185_2":"((?:\\.|[^"])*)"/g;
  const found = [];
  let match;
  while ((match = pattern.exec(content)) !== null) {
    const value = unescapeJsEscapes(match[1]);
    const code = LANG_BY_MARKER[value];
    if (!code) {
      console.warn(`     WARNING: 未识别的语言标记文案 "${value}",跳过`);
      continue;
    }
    found.push({ code, pos: match.index });
  }
  found.sort((a, b) => a.pos - b.pos);

  const sections = new Map();
  for (let i = 0; i < found.length; i++) {
    const end = i + 1 < found.length ? found[i + 1].pos : content.length;
    if (!sections.has(found[i].code)) {
      sections.set(found[i].code, content.slice(found[i].pos, end));
    }
  }
  return sections;
}

// --- 提取某语言段落内的 i18n 键值映射 ---
function extractI18nMap(section) {
  const map = {};
  const pattern = /ID-NC-VF0502_WID(\d+)_(\d+(?:_\d+)?)":"([^"]*(?:\\.[^"]*)*)"/g;
  let match;

  while ((match = pattern.exec(section)) !== null) {
    const [, id, suffix, value] = match;
    const key = `ID-NC-VF0502_WID${id}_${suffix}`;
    map[key] = unescapeJsEscapes(value);
  }

  return map;
}

// --- 解析 chunk 中的创作者结构 ---
function parseCreatorsFromChunk(content) {
  const creators = [];

  // 每个 creator: {num:XX,img:{url:"...",alt:"..."},name:"...",position:"...",text:"...",recipes:[...]}
  const entryPattern = /\{num:(\d+),img:\{url:"([^"]+)",alt:"([^"]+)"\},name:"([^"]+)",position:"([^"]+)",text:"([^"]+)",recipes:\[([^\]]*)\]\}/g;
  let match;

  while ((match = entryPattern.exec(content)) !== null) {
    const [, num, imgUrl, altKey, nameKey, positionKey, textKey, recipesRaw] = match;

    // recipes 的详情页 URL 挂在每个 recipe 自己的原文切片里,按 name 切开,
    // 避免旧实现"全文找 URL 再按顺序配对"在缺 URL 时错位配对的问题
    const namePattern = /\{name:"([^"]+)"/g;
    const nameMatches = [...recipesRaw.matchAll(namePattern)];
    const recipes = nameMatches.map((m, i) => {
      const slice = recipesRaw.slice(m.index, i + 1 < nameMatches.length ? nameMatches[i + 1].index : undefined);
      return { nameKey: m[1], slice };
    });

    creators.push({
      num: parseInt(num, 10),
      avatarUrl: imgUrl,
      nameKey,
      positionKey,
      bioKey: textKey,
      recipes,
    });
  }

  return creators;
}

// --- 在单个 recipe 的原文切片中找某语言的详情页 URL ---
// 形态 A: key:"".concat("...")   (国际站)
// 形态 B: key:"..."              (中国站;运行时注入的 `${...}` 模板两种都匹配不到,返回空)
function findDetailUrl(slice, lang) {
  const keys = lang === 'zh' ? ['zhCn', 'zh'] : lang === 'zh_tw' ? ['zhTw'] : [lang];
  for (const key of keys) {
    let m = slice.match(new RegExp(`[,{]${key}:""\\.concat\\("([^"]*)"\\)`));
    if (m && m[1]) return m[1];
    m = slice.match(new RegExp(`[,{]${key}:"((?:\\\\.|[^"])*)"`));
    if (m && m[1]) return m[1];
  }
  return '';
}

// --- 抓取单个站点 ---
async function scrapeSite(site) {
  console.log(`\n========== 站点: ${site.key} (${site.baseUrl}) ==========`);

  console.log('[1/4] 获取页面 HTML...');
  const html = await fetch(`${site.baseUrl}${site.pageUrl}`);
  const allChunks = extractJsChunks(html);
  console.log(`     页面共引用 ${allChunks.length} 个 JS chunk`);

  const appChunk = allChunks.find(p => p.includes('pages/_app'));
  const otherChunks = allChunks.filter(p => !p.includes('pages/_app'));
  if (!appChunk) {
    throw new Error('未找到 _app chunk');
  }

  console.log('[2/4] 下载 _app.js 并检测语言...');
  const appJs = await fetch(`${site.baseUrl}${appChunk}`);
  const sections = detectLanguageSections(appJs);
  console.log(`     识别出 ${sections.size} 种语言: ${[...sections.keys()].join(' ')}`);

  console.log('[3/4] 查找创作者数据 chunk...');
  const signature = 'img:{url:"/img/recipe/release/creator_fig';
  let creatorChunkContent = null;
  for (const chunkPath of otherChunks) {
    try {
      const content = await fetch(`${site.baseUrl}${chunkPath}`);
      if (content.includes(signature)) {
        creatorChunkContent = content;
        console.log(`     找到: ${chunkPath}`);
        break;
      }
    } catch (e) {
      console.log(`     跳过: ${chunkPath} (${e.message})`);
    }
  }
  if (!creatorChunkContent) {
    throw new Error('未找到包含创作者数据的 chunk');
  }

  const creators = parseCreatorsFromChunk(creatorChunkContent);
  console.log(`     共 ${creators.length} 位创作者`);

  console.log('[4/4] 生成多语言数据...');

  const outputs = [];
  // 英文映射作为译文缺失时的回退(如 Brandon Woelfel 的名字在 ru 无翻译)
  const enMap = sections.has('en') ? extractI18nMap(sections.get('en')) : {};
  const targetLangs = site.langs ? [...sections.keys()].filter(l => site.langs.includes(l)) : [...sections.keys()];

  for (const [lang, section] of sections) {
    if (!targetLangs.includes(lang)) continue;
    const i18nMap = extractI18nMap(section);
    // 译文缺失时回退英文;name 仍无值时保底原始 key 维持数组对齐,position/bio 则为 null
    const t = (key) => i18nMap[key] || enMap[key] || '';

    const output = creators.map(c => ({
      name: t(c.nameKey) || c.nameKey,
      position: t(c.positionKey) || null,
      bio: (t(c.bioKey) || '').replace(/<br\/>/g, '\n').replace(/<[^>]+>/g, '') || null,
      avatar: `${site.baseUrl}${c.avatarUrl}`,
      recipes: c.recipes.map(r => {
        const detailUrl = findDetailUrl(r.slice, lang);
        return {
          name: t(r.nameKey) || r.nameKey,
          id: detailUrl.match(/[?&]id=([A-Z0-9]+)/)?.[1] || '',
          detailUrl,
        };
      }),
    }));

    const file = path.join(ASSETS_DIR, `creators_${site.key}_${lang}.json`);
    fs.writeFileSync(file, JSON.stringify(output, null, 2), 'utf-8');
    outputs.push({ lang, file, count: output.length });

    const alias = site.aliases?.[lang];
    if (alias) {
      fs.writeFileSync(path.join(ASSETS_DIR, alias), JSON.stringify(output, null, 2), 'utf-8');
      console.log(`     兼容别名: ${alias} -> creators_${site.key}_${lang}.json (内容相同)`);
    }
  }

  for (const o of outputs) {
    console.log(`     已保存: ${path.basename(o.file)} (${o.count} 位创作者, ${o.count ? JSON.parse(fs.readFileSync(o.file, 'utf-8')).reduce((n, c) => n + c.recipes.length, 0) : 0} 个色彩方案)`);
  }
  return outputs;
}

async function main() {
  for (const site of SITES) {
    await scrapeSite(site);
  }
  console.log('\n全部站点处理完成');
}

main().catch((err) => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
