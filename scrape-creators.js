#!/usr/bin/env node
/**
 * Nikon 色彩方案数据爬虫(创摄者 × 灵感库书单 × 方案详情 × 图片,多站点 × 多语言)
 *
 * 站点前端 2026-10 改版后,数据全部由匿名接口提供(未登录无需鉴权):
 *
 * 1. 创摄者: GET https://api.user.ir.imagingcloud.nikon.com{,.cn}/info/creator
 *    Header: Accept-Language
 * 2. 书单: POST https://api.user.cwp.imagingcloud.nikon.com{,.cn}/bff/recipe/release
 *    Body: { ownerUserId: "nikon", bookId: "", sortType: 0, lang_code, country }
 *    Header: access_token: null;空 bookId 返回该语言默认书(中国站"创意色彩灵感库"等)
 * 3. 方案详情: GET https://api.user.ir.imagingcloud.nikon.com{,.cn}<path>?sortType=0&isPagenation=false
 *    <path> 取自创摄者接口 recipes[].path(/publicrecipe/<路由bookId>/<recipeId>),
 *    路由 bookId 与 release 书 id 不同,不能用书 id 拼详情 URL(会 404/422)。
 *
 * 图片(封面/头像/详情缩略图)是 CloudFront 类带过期签名的临时 URL,必须当场下载字节。
 * 所有图片按内容 sha256 存储(跨语言/跨站的同图自动去重),JSON 引用仓库相对路径,
 * App 只需拼 CDN 前缀,彻底脱离尼康域名。
 *
 * 输出: assets/
 *   creators_{站点}_{语言}.json        创摄者(avatar -> 本地图片路径)
 *   book_{站点}_{语言}.json            书单(recipes[].cover -> 本地图片路径)
 *   details/{站点}/{语言}/{id}.json    方案详情快照(图片 URL 已重写为本地路径)
 *   img/<hash前2位>/<sha256>.<ext>     图片本体
 *   img/manifest.json                  下载清单(源对象 -> hash),支持增量跳过
 *
 * 环境变量: NIKON_SKIP_IMAGES=1 跳过图片下载(图片字段输出 null),用于无图网络下验证数据逻辑
 *
 * 用法: node scrape-creators.js
 */

const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ASSETS_DIR = path.join(__dirname, 'assets');
const IMG_DIR = path.join(ASSETS_DIR, 'img');
const MANIFEST_FILE = path.join(IMG_DIR, 'manifest.json');

const SITES = [
  {
    key: 'cn',
    irHost: 'api.user.ir.imagingcloud.nikon.com.cn',
    cwpHost: 'api.user.cwp.imagingcloud.nikon.com.cn',
    country: 'CN',
    // CN 站接口仅 zh-cn 有数据,其余语言返回空
    langs: { zh: 'zh-cn' },
    // 兼容别名: 内测用户已在用旧 URL,保持同步更新
    aliases: { zh: 'creators_zh.json' },
  },
  {
    key: 'intl',
    irHost: 'api.user.ir.imagingcloud.nikon.com',
    cwpHost: 'api.user.cwp.imagingcloud.nikon.com',
    country: 'US',
    langs: {
      de: 'de', en: 'en', es: 'es', fr: 'fr', it: 'it', ja: 'ja',
      zh: 'zh-cn', zh_tw: 'zh-tw', ko: 'ko', nl: 'nl', tr: 'tr', ru: 'ru',
    },
  },
];

// 图片跨主机回退:.cn 与 .com 双 CDN 同路径对象,一侧不可达时试另一侧
const IMG_ALT_HOST = {
  'front.ir.imagingcloud.nikon.com.cn': 'front.ir.imagingcloud.nikon.com',
  'front.ir.imagingcloud.nikon.com': 'front.ir.imagingcloud.nikon.com.cn',
};

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36';
const CONCURRENCY = { api: 6, img: 4 };
const MAX_IMAGE_BYTES = 2 * 1024 * 1024; // 单张护栏:超过跳过(告警)
const MAX_TOTAL_IMAGE_BYTES = 800 * 1024 * 1024; // 总量护栏:超过中止
const SKIP_IMAGES = process.env.NIKON_SKIP_IMAGES === '1';

// --- 网络请求(攒齐原始字节后统一解码,避免多字节字符被包边界切碎) ---
function request(url, { method = 'GET', headers = {}, body = null, retries = 2 } = {}) {
  const attempt = (n) => new Promise((resolve, reject) => {
    const req = https.request(url, { method, headers: { 'User-Agent': UA, ...headers } }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({
        status: res.statusCode,
        contentType: (res.headers['content-type'] || '').split(';')[0],
        buf: Buffer.concat(chunks),
      }));
    });
    req.on('error', (e) => {
      if (n > 0) setTimeout(() => attempt(n - 1).then(resolve, reject), 2000);
      else reject(e);
    });
    req.setTimeout(60_000, () => req.destroy(new Error(`timeout for ${url}`)));
    if (body) req.end(JSON.stringify(body));
    else req.end();
  });
  return attempt(retries);
}

async function fetchJson(url, opts = {}) {
  const r = await request(url, opts);
  if (r.status !== 200) throw new Error(`HTTP ${r.status} for ${url}`);
  try {
    return JSON.parse(r.buf.toString('utf8'));
  } catch (e) {
    throw new Error(`invalid JSON from ${url}: ${e.message}`);
  }
}

// --- 限并发映射 ---
async function pooledMap(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

// --- 图片库:内容哈希存储 + manifest 增量 ---
const imageStore = {
  manifest: new Map(), // 源对象key(host+path) -> { hash, ext, bytes } | { skipped: 'oversize' }
  newCount: 0,
  skipCount: 0,
  hitCount: 0,
  failures: [],
  totalBytes: 0,

  load() {
    fs.mkdirSync(IMG_DIR, { recursive: true });
    if (fs.existsSync(MANIFEST_FILE)) {
      const m = JSON.parse(fs.readFileSync(MANIFEST_FILE, 'utf8'));
      for (const [k, v] of Object.entries(m)) this.manifest.set(k, v);
    }
    const seen = new Set();
    for (const v of this.manifest.values()) {
      if (v.hash && !seen.has(v.hash)) { seen.add(v.hash); this.totalBytes += v.bytes; }
    }
  },

  save() {
    const sorted = {};
    for (const k of [...this.manifest.keys()].sort()) sorted[k] = this.manifest.get(k);
    fs.mkdirSync(IMG_DIR, { recursive: true });
    fs.writeFileSync(MANIFEST_FILE, JSON.stringify(sorted, null, 2) + '\n', 'utf-8');
  },

  key(url) {
    const u = new URL(url);
    return u.host + u.pathname; // 签名参数不参与 key(同一对象每次签名不同)
  },

  ref(entry) {
    return entry && entry.hash ? `img/${entry.hash.slice(0, 2)}/${entry.hash}${entry.ext}` : null;
  },

  fileExists(entry) {
    const ref = this.ref(entry);
    return ref && fs.existsSync(path.join(ASSETS_DIR, ref));
  },

  extOf(contentType, url) {
    if (contentType === 'image/jpeg') return '.jpg';
    if (contentType === 'image/png') return '.png';
    if (contentType === 'image/webp') return '.webp';
    const m = url.split('?')[0].match(/\.(jpe?g|png|webp)$/i);
    return m ? '.' + m[1].toLowerCase().replace('jpeg', 'jpg') : '.jpg';
  },

  // 下载(或复用)一个图片对象,返回 manifest 条目;失败抛错
  async fetchEntry(url) {
    const key = this.key(url);
    const cached = this.manifest.get(key);
    if (cached && (cached.skipped || this.fileExists(cached))) {
      this.hitCount++;
      return cached.skipped ? null : cached;
    }

    let res = null;
    let lastErr = null;
    for (const u of this.candidateUrls(url)) {
      try {
        const r = await request(u, { retries: 1 });
        if (r.status === 200 && r.buf.length > 0) { res = r; break; }
        lastErr = new Error(`HTTP ${r.status}`);
      } catch (e) { lastErr = e; }
    }
    if (!res) throw new Error(`download failed ${url}: ${lastErr ? lastErr.message : 'no response'}`);

    if (res.buf.length > MAX_IMAGE_BYTES) {
      console.warn(`     WARN 单图超 ${MAX_IMAGE_BYTES}B 跳过: ${this.key(url)} (${res.buf.length}B)`);
      this.manifest.set(key, { skipped: 'oversize', bytes: res.buf.length });
      this.skipCount++;
      return null;
    }

    const hash = crypto.createHash('sha256').update(res.buf).digest('hex');
    const ext = this.extOf(res.contentType, url);
    const entry = { hash, ext, bytes: res.buf.length };

    if (!this.manifest.values().some((v) => v.hash === hash && v.bytes === entry.bytes)) {
      if (this.totalBytes + res.buf.length > MAX_TOTAL_IMAGE_BYTES) {
        throw new Error(`图片总量超过护栏 ${MAX_TOTAL_IMAGE_BYTES}B,中止(当前 ${this.totalBytes}B)`);
      }
      this.totalBytes += res.buf.length;
      const file = path.join(IMG_DIR, hash.slice(0, 2), `${hash}${ext}`);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, res.buf);
      this.newCount++;
    }
    this.manifest.set(key, entry);
    return entry;
  },

  // 原始 URL 优先,失败候选加跨主机镜像
  candidateUrls(url) {
    const list = [url];
    const u = new URL(url);
    const alt = IMG_ALT_HOST[u.host];
    if (alt) list.push(`${u.protocol}//${alt}${u.pathname}${u.search}`);
    return list;
  },

  // 批量确保可用(并发受控),返回 url -> 本地引用(或 null)的 Map
  async ensureAll(urls) {
    const unique = [...new Set(urls)];
    const map = new Map();
    await pooledMap(unique, CONCURRENCY.img, async (url) => {
      if (SKIP_IMAGES) { map.set(url, null); return; }
      try {
        const entry = await this.fetchEntry(url);
        map.set(url, entry ? this.ref(entry) : null);
      } catch (e) {
        this.failures.push(`${url} -> ${e.message}`);
        map.set(url, null);
      }
    });
    return map;
  },
};

// --- JSON 内图片 URL 的收集与重写 ---
const IMG_URL_RE = /^https:\/\/front\.ir\.imagingcloud\.nikon\.com(\.cn)?\//;

function collectImageUrls(obj, out = []) {
  if (obj == null) return out;
  if (typeof obj === 'string') {
    if (IMG_URL_RE.test(obj)) out.push(obj);
  } else if (Array.isArray(obj)) {
    obj.forEach((v) => collectImageUrls(v, out));
  } else if (typeof obj === 'object') {
    for (const k in obj) collectImageUrls(obj[k], out);
  }
  return out;
}

function rewriteImageUrls(obj, urlMap) {
  if (obj == null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map((v) => rewriteImageUrls(v, urlMap));
  const out = {};
  for (const k in obj) {
    const v = obj[k];
    out[k] = typeof v === 'string' && IMG_URL_RE.test(v)
      ? urlMap.get(v)
      : rewriteImageUrls(v, urlMap);
  }
  return out;
}

// bio 统一处理: <br/> 转换行、去残余标签(接口目前返回纯文本,防御性保留)
function normalizeBio(s) {
  return (s || '').replace(/<br\/?>/gi, '\n').replace(/<[^>]+>/g, '') || null;
}

function recipeIdFromPath(p) {
  const id = (p || '').split('/').filter(Boolean).pop() || '';
  if (!/^[A-Z0-9]+$/.test(id)) {
    throw new Error(`无法从 path 解析 recipeId: "${p}"`);
  }
  return id;
}

// --- 单站点单语言全量抓取 ---
async function scrapeSiteLang(site, lang, langCode) {
  const tag = `${site.key}/${lang}`;
  console.log(`\n----- ${tag} -----`);

  const creatorData = await fetchJson(`https://${site.irHost}/info/creator`, {
    headers: { 'Accept-Language': langCode },
  });
  if (!Array.isArray(creatorData.creators) || creatorData.creators.length === 0) {
    throw new Error(`creators ${tag}: 接口未返回创作者数据`);
  }

  const release = await fetchJson(`https://${site.cwpHost}/bff/recipe/release`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', access_token: 'null' },
    body: { ownerUserId: 'nikon', bookId: '', sortType: 0, lang_code: langCode, country: site.country },
  });
  const book = release.recipe_book && release.recipe_book[0];
  if (!book || !Array.isArray(release.recipe) || release.recipe.length === 0) {
    throw new Error(`book ${tag}: 接口未返回书单数据`);
  }

  // 详情:逐方案按创摄者接口给出的 path 抓取
  const recipePaths = creatorData.creators.flatMap((c) => c.recipes || []);
  const details = await pooledMap(recipePaths, CONCURRENCY.api, async (r) => {
    const d = await fetchJson(`https://${site.irHost}${r.path}?sortType=0&isPagenation=false`, {
      headers: { 'Accept-Language': langCode },
    });
    // 剥离随用户/时间抖动的字段,保证无变化时 diff 为空
    delete d.userLikeStatus;
    delete d.likeCount;
    return d;
  });
  const detailById = new Map(details.map((d) => [d.id, d]));
  for (const r of recipePaths) {
    const id = recipeIdFromPath(r.path);
    if (!detailById.has(id)) throw new Error(`detail ${tag}: 缺少方案 ${id}`);
  }

  // 汇总本语言全部图片对象后统一下载(签名 URL 当场使用)
  const avatarUrls = creatorData.creators.map((c) => c.thumbnail).filter(Boolean);
  const coverUrls = release.recipe.map((r) => r.img && r.img.url).filter(Boolean);
  const detailImgUrls = details.flatMap((d) => collectImageUrls(d));
  const urlMap = await imageStore.ensureAll([...avatarUrls, ...coverUrls, ...detailImgUrls]);

  // 输出创摄者
  const creatorsOut = creatorData.creators.map((c) => ({
    name: c.name || '',
    position: c.position || null,
    bio: normalizeBio(c.profile),
    avatar: urlMap.get(c.thumbnail) || null,
    recipes: (c.recipes || []).map((r) => {
      const id = recipeIdFromPath(r.path);
      return { name: r.name || '', id, detailUrl: `/recipe/release/detail/?id=${id}` };
    }),
  }));
  fs.writeFileSync(path.join(ASSETS_DIR, `creators_${site.key}_${lang}.json`), JSON.stringify(creatorsOut, null, 2) + '\n', 'utf-8');
  const alias = site.aliases?.[lang];
  if (alias) {
    fs.writeFileSync(path.join(ASSETS_DIR, alias), JSON.stringify(creatorsOut, null, 2) + '\n', 'utf-8');
  }

  // 输出书单(cover 引用本地图片)
  const bookOut = {
    bookId: book.id,
    label: book.label || null,
    isNew: !!book.is_new,
    recipes: release.recipe.map((r) => ({
      name: r.name || '',
      id: r.id,
      cover: urlMap.get(r.img && r.img.url) || null,
      detailUrl: `/recipe/release/detail/?id=${r.id}`,
      publicDate: r.public_date || null,
      isNew: !!r.is_new,
    })),
  };
  fs.writeFileSync(path.join(ASSETS_DIR, `book_${site.key}_${lang}.json`), JSON.stringify(bookOut, null, 2) + '\n', 'utf-8');

  // 输出详情快照(图片 URL 全部重写为本地路径)
  const detailDir = path.join(ASSETS_DIR, 'details', site.key, lang);
  fs.mkdirSync(detailDir, { recursive: true });
  for (const d of details) {
    fs.writeFileSync(path.join(detailDir, `${d.id}.json`), JSON.stringify(rewriteImageUrls(d, urlMap), null, 2) + '\n', 'utf-8');
  }

  const recipes = creatorsOut.reduce((n, c) => n + c.recipes.length, 0);
  console.log(`     创摄者 ${creatorsOut.length}/${recipes} 方案 | 书 "${bookOut.label}" ${bookOut.recipes.length} | 详情 ${details.length}`);
  return { creators: creatorsOut.length, recipes, details: details.length };
}

// --- 终检:所有 JSON 里的 img/ 引用必须真实存在 ---
function validateRefs() {
  const missing = [];
  const walk = (p) => {
    if (fs.statSync(p).isDirectory()) { fs.readdirSync(p).forEach((f) => walk(path.join(p, f))); return; }
    if (!p.endsWith('.json')) return;
    collectRefs(JSON.parse(fs.readFileSync(p, 'utf8')), p);
  };
  const collectRefs = (obj, file) => {
    if (obj == null) return;
    if (typeof obj === 'string') {
      if (/^img\//.test(obj) && !fs.existsSync(path.join(ASSETS_DIR, obj))) missing.push(`${file}: ${obj}`);
    } else if (Array.isArray(obj)) obj.forEach((v) => collectRefs(v, file));
    else if (typeof obj === 'object') for (const k in obj) collectRefs(obj[k], file);
  };
  walk(ASSETS_DIR);
  return missing;
}

async function main() {
  imageStore.load();

  const summary = [];
  for (const site of SITES) {
    console.log(`\n========== 站点: ${site.key} ==========`);
    for (const [lang, langCode] of Object.entries(site.langs)) {
      summary.push({ tag: `${site.key}/${lang}`, ...(await scrapeSiteLang(site, lang, langCode)) });
    }
  }
  imageStore.save();

  console.log('\n========== 汇总 ==========');
  for (const s of summary) console.log(`  ${s.tag}: 创摄者 ${s.creators}, 方案 ${s.recipes}, 详情 ${s.details}`);
  console.log(`  图片: 新下载 ${imageStore.newCount}, 增量命中 ${imageStore.hitCount}, 超限跳过 ${imageStore.skipCount}, 失败 ${imageStore.failures.length}`);
  if (imageStore.failures.length) {
    console.log('  失败明细(前 20):');
    imageStore.failures.slice(0, 20).forEach((f) => console.log('    ', f));
  }
  console.log(`  图片总量: ${(imageStore.totalBytes / 1024 / 1024).toFixed(1)}MB`);

  if (!SKIP_IMAGES) {
    const missing = validateRefs();
    if (missing.length) {
      console.error(`\n校验失败: ${missing.length} 个悬空图片引用(前 20):`);
      missing.slice(0, 20).forEach((m) => console.error('  ', m));
      process.exit(1);
    }
    console.log('  引用校验: 全部 img/ 引用均存在 ✓');
  }

  if (imageStore.failures.length && !SKIP_IMAGES) {
    console.error(`\n存在 ${imageStore.failures.length} 个图片下载失败,以失败退出`);
    process.exit(1);
  }
  console.log('\n全部站点处理完成');
}

main().catch((err) => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
