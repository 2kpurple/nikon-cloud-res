#!/usr/bin/env node
/**
 * Nikon 色彩方案创摄者爬虫(多站点 × 多语言)
 *
 * 站点改版后数据不再打进 Next.js 静态 chunk,改为前端运行时调用匿名接口:
 *   GET https://api.user.ir.imagingcloud.nikon.com{,.cn}/info/creator
 *   Header: Accept-Language: <lang>(未登录无需 Authorization)
 * 返回: { creators: [{ id, name, position, profile, thumbnail,
 *                      recipes: [{ name, path: "/publicrecipe/<bookId>/<recipeId>" }] }] }
 *
 * 详情页 URL: /recipe/release/detail/?id=<recipeId>,与旧版静态 chunk 时代的
 * id 完全一致(详见 scrape-creators.js 历史);release 服务端按语言分书
 * (每种语言一本书、一套独立资源 id),接口按 Accept-Language 返回对应语言的 id。
 *
 * 输出: assets/creators_{站点}_{语言}.json (schema 与旧版一致)
 *   站点: cn   = api.user.ir.imagingcloud.nikon.com.cn (仅 zh-cn 有数据)
 *         intl = api.user.ir.imagingcloud.nikon.com
 *   语言: de en es fr it ja zh zh_tw ko nl tr ru
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
    apiHost: 'api.user.ir.imagingcloud.nikon.com.cn',
    // CN 站接口仅 zh-cn 有数据,其余语言返回空
    langs: { zh: 'zh-cn' },
    // 兼容别名: 内测用户已在用旧 URL,保持同步更新
    aliases: { zh: 'creators_zh.json' },
  },
  {
    key: 'intl',
    apiHost: 'api.user.ir.imagingcloud.nikon.com',
    // 输出文件名 -> Accept-Language
    langs: {
      de: 'de', en: 'en', es: 'es', fr: 'fr', it: 'it', ja: 'ja',
      zh: 'zh-cn', zh_tw: 'zh-tw', ko: 'ko', nl: 'nl', tr: 'tr', ru: 'ru',
    },
  },
];

// --- 网络请求(攒齐原始字节后统一解码,避免多字节字符被包边界切碎) ---
function fetchJson(url, headers) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers }, (res) => {
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        } catch (e) {
          reject(new Error(`invalid JSON from ${url}: ${e.message}`));
        }
      });
    });
    req.on('error', reject);
  });
}

// bio 统一处理: <br/> 转换行、去残余标签(接口目前返回纯文本,防御性保留)
function normalizeBio(s) {
  return (s || '').replace(/<br\/?>/gi, '\n').replace(/<[^>]+>/g, '') || null;
}

// path: /publicrecipe/<bookId>/<recipeId> -> recipeId(即详情页 ?id= 参数)
function recipeIdFromPath(p) {
  const id = (p || '').split('/').filter(Boolean).pop() || '';
  if (!/^[A-Z0-9]+$/.test(id)) {
    throw new Error(`无法从 path 解析 recipeId: "${p}"`);
  }
  return id;
}

function convertCreators(creators) {
  return creators.map((c) => ({
    name: c.name || '',
    position: c.position || null,
    bio: normalizeBio(c.profile),
    avatar: c.thumbnail || null,
    recipes: (c.recipes || []).map((r) => {
      const id = recipeIdFromPath(r.path);
      return {
        name: r.name || '',
        id,
        detailUrl: `/recipe/release/detail/?id=${id}`,
      };
    }),
  }));
}

async function scrapeSite(site) {
  console.log(`\n========== 站点: ${site.key} (${site.apiHost}) ==========`);

  const outputs = [];
  for (const [lang, acceptLang] of Object.entries(site.langs)) {
    const data = await fetchJson(`https://${site.apiHost}/info/creator`, {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      'Accept-Language': acceptLang,
    });
    if (!Array.isArray(data.creators) || data.creators.length === 0) {
      throw new Error(`${site.key}/${lang}: 接口未返回创作者数据`);
    }

    const output = convertCreators(data.creators);
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
    const recipes = JSON.parse(fs.readFileSync(o.file, 'utf-8')).reduce((n, c) => n + c.recipes.length, 0);
    console.log(`     已保存: ${path.basename(o.file)} (${o.count} 位创作者, ${recipes} 个色彩方案)`);
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
