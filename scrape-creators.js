#!/usr/bin/env node
/**
 * Nikon 色彩方案创摄者爬虫
 *
 * 数据来源:
 *  1. 动态发现包含创作者结构数据的 JS chunk (搜索 img:{url:"/img/recipe/release/creator_fig)
 *  2. _app.js 中的 i18n 键值映射 (只取中文简体 zh-CN)
 *
 * 用法: node scrape-creators.js
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const BASE_URL = 'https://imagingcloud.nikon.com.cn';
const TMP_DIR = path.join(__dirname, 'tmp');
const ASSETS_DIR = path.join(__dirname, 'assets');
const CREATORS_DIR = path.join(ASSETS_DIR, 'creator-avatars');
const OUTPUT_FILE = path.join(ASSETS_DIR, 'creators_zh.json');

fs.mkdirSync(CREATORS_DIR, { recursive: true });

// --- 网络请求 ---
function fetch(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
    }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return fetch(res.headers.location).then(resolve, reject);
      }
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
  });
}

function fetchBuffer(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
    }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return fetchBuffer(res.headers.location).then(resolve, reject);
      }
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });
    req.on('error', reject);
  });
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

// --- 解析 chunk 中的创作者结构 ---
function parseCreatorsFromChunk(content) {
  const creators = [];

  // 每个 creator: {num:XX,img:{url:"...",alt:"..."},name:"...",position:"...",text:"...",recipes:[...]}
  const entryPattern = /\{num:(\d+),img:\{url:"([^"]+)",alt:"([^"]+)"\},name:"([^"]+)",position:"([^"]+)",text:"([^"]+)",recipes:\[([^\]]*)\]\}/g;
  let match;

  while ((match = entryPattern.exec(content)) !== null) {
    const [, num, imgUrl, altKey, nameKey, positionKey, textKey, recipesRaw] = match;

    // 解析 recipes: 提取 name key 和 zhCn URL
    // 注意: url 值中有 ${r.env.XXX} 模板字面量，需要跳过这些
    const recipes = [];
    const recipeNamePattern = /\{name:"([^"]+)"/g;
    let rNameMatch;
    const recipeNames = [];
    while ((rNameMatch = recipeNamePattern.exec(recipesRaw)) !== null) {
      recipeNames.push(rNameMatch[1]);
    }

    // 提取所有 zhCn URL
    const recipeUrlPattern = /zhCn:"([^"]*)"/g;
    let rUrlMatch;
    const recipeUrls = [];
    while ((rUrlMatch = recipeUrlPattern.exec(recipesRaw)) !== null) {
      recipeUrls.push(rUrlMatch[1]);
    }

    // 配对 name 和 url
    for (let i = 0; i < recipeNames.length; i++) {
      recipes.push({
        nameKey: recipeNames[i],
        detailUrl: recipeUrls[i] || '',
      });
    }

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

// --- 从 _app.js 提取中文简体 i18n 映射 ---
function extractZhCnI18nMap(content) {
  // 12 种语言按顺序排列。通过找到的中文简体特有标记定位:
  // zhCn 起始: "ID-NC-VF0502_WID1185_2":"人像摄影师"
  // zhTw 起始: "ID-NC-VF0502_WID1185_2":"人像攝影師" (繁体)
  const zhStartMarker = '"ID-NC-VF0502_WID1185_2":"人像摄影师"';
  const zhEndMarker = '"ID-NC-VF0502_WID1185_2":"人像攝影師"';

  let zhStart = content.indexOf(zhStartMarker);
  if (zhStart < 0) {
    console.warn('WARNING: 未找到中文简体标记，回退到全文解析');
    zhStart = 0;
  }

  let zhEnd = content.indexOf(zhEndMarker, zhStart);
  if (zhEnd < 0) {
    zhEnd = content.length;
  }

  const zhSection = content.slice(zhStart, zhEnd);

  // 提取该区域内的所有 i18n 键值对
  const map = {};
  const pattern = /ID-NC-VF0502_WID(\d+)_(\d+(?:_\d+)?)":"([^"]*(?:\\.[^"]*)*)"/g;
  let match;

  while ((match = pattern.exec(zhSection)) !== null) {
    const [, id, suffix, value] = match;
    const key = `ID-NC-VF0502_WID${id}_${suffix}`;
    map[key] = value.replace(/\\u([\da-fA-F]{4})/g, (_, hex) =>
      String.fromCharCode(parseInt(hex, 16))
    );
  }

  return map;
}

// --- 主流程 ---
async function main() {
  console.log('[1/5] 获取页面 HTML...');
  const html = await fetch(`${BASE_URL}/recipe/release/?bookId=01HXDNN2X6N0ZHNP0WFBDF407Z`);

  const allChunks = extractJsChunks(html);
  console.log(`     页面共引用 ${allChunks.length} 个 JS chunk`);

  const appChunk = allChunks.find(p => p.includes('pages/_app'));
  const otherChunks = allChunks.filter(p => !p.includes('pages/_app'));

  if (!appChunk) {
    console.error('ERROR: 未找到 _app chunk');
    process.exit(1);
  }

  console.log('[2/5] 下载 _app.js (i18n 数据源)...');
  const appJs = await fetch(`${BASE_URL}${appChunk}`);
  console.log(`     大小: ${(appJs.length / 1024).toFixed(1)} KB`);

  // 动态查找创作者数据 chunk
  console.log('[3/5] 查找创作者数据 chunk...');
  const signature = 'img:{url:"/img/recipe/release/creator_fig';
  let creatorChunkPath = null;
  let creatorChunkContent = null;

  for (const chunkPath of otherChunks) {
    try {
      const content = await fetch(`${BASE_URL}${chunkPath}`);
      if (content.includes(signature)) {
        creatorChunkPath = chunkPath;
        creatorChunkContent = content;
        break;
      }
    } catch (e) {
      console.log(`     跳过: ${chunkPath} (${e.message})`);
    }
  }

  if (!creatorChunkPath) {
    console.error('ERROR: 未找到包含创作者数据的 chunk');
    console.log('     搜索特征: img:{url:"/img/recipe/release/creator_fig');
    process.exit(1);
  }
  console.log(`     找到: ${creatorChunkPath}`);

  console.log('[4/5] 解析并合并数据 (中文简体)...');
  const creators = parseCreatorsFromChunk(creatorChunkContent);
  const i18nMap = extractZhCnI18nMap(appJs);
  console.log(`     i18n 映射: ${Object.keys(i18nMap).length} 条`);

  // 合并 i18n 值
  for (const c of creators) {
    c.name = i18nMap[c.nameKey] || c.nameKey;
    c.position = i18nMap[c.positionKey] || '';
    c.bio = (i18nMap[c.bioKey] || '').replace(/<br\/>/g, '\n').replace(/<[^>]+>/g, '');
    for (const recipe of c.recipes) {
      recipe.name = i18nMap[recipe.nameKey] || recipe.nameKey;
    }
  }
  console.log(`     共 ${creators.length} 位创作者`);

  // 下载头像
  console.log('[5/5] 下载头像图片...');
  let downloaded = 0;
  for (const c of creators) {
    const avatarFile = path.basename(c.avatarUrl);
    const localPath = path.join(CREATORS_DIR, avatarFile);
    c.avatarLocalPath = `creator-avatars/${avatarFile}`;

    if (!fs.existsSync(localPath)) {
      try {
        const buf = await fetchBuffer(`${BASE_URL}${c.avatarUrl}`);
        fs.writeFileSync(localPath, buf);
        downloaded++;
      } catch (e) {
        console.log(`     ⚠ 下载失败: ${c.name} (${c.avatarUrl})`);
      }
    }
  }
  console.log(`     下载 ${downloaded} 张头像`);

  // 构建干净的输出
  const output = creators.map(c => ({
    name: c.name,
    position: c.position || null,
    bio: c.bio || null,
    avatar: `${BASE_URL}${c.avatarUrl}`,
    recipes: c.recipes.map(r => ({
      name: r.name,
      id: r.detailUrl.match(/[?&]id=([A-Z0-9]+)/)?.[1] || '',
      detailUrl: r.detailUrl,
    })),
  }));

  // 保存
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2), 'utf-8');
  console.log(`\n     已保存: ${OUTPUT_FILE}`);

  // 打印
  console.log(`\n--- 全部 ${output.length} 位创作者 (中文简体) ---`);
  output.forEach((c, i) => {
    const recipes = c.recipes.map(r => r.name).join(', ');
    console.log(`  ${i + 1}. ${c.name}`);
    console.log(`      职位: ${c.position || '(无)'}`);
    console.log(`      色彩方案: ${recipes || '(无)'}`);
  });
}

main().catch((err) => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
