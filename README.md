# Nikon Cloud Res

爬取尼康色彩方案灵感库的创摄者数据,支持中国站与国际站 × 多语言。

## 数据来源

| 站点 | 域名 | 输出 |
|---|---|---|
| 中国站 | `imagingcloud.nikon.com.cn` | `creators_cn_zh.json`(简中) |
| 国际站 | `imagingcloud.nikon.com` | `creators_intl_{lang}.json` × 12 种语言 |

两站均为 Next.js SPA,创作者数据无公开接口。爬虫流程:下载页面引用的 JS chunk → 在 `_app.js` 中按语言标记(WID1185_2 各语言文案)切出 12 个 i18n 段落 → 在数据 chunk 中定位创作者结构(头像 + i18n key + 各语言详情页 URL)→ 合并输出。

**方案 id 与"按语言分书"**:release 服务端按语言分书,每种语言一本书、一套独立的资源 id
(跨语言 id 零重叠)。站点静态数据里每个方案携带分语言的详情页 URL,天然指向该语言的书,
故 JSON 里各语言文件的 `id` 直接取自对应语言的 URL,与该语言 release 接口
(空 `bookId` + `lang_code`)返回的 id 一致,客户端按 id 关联即可,无需名称匹配。
注意 `lang_code` 必须是 BCP-47 连字符格式(如 `zh-cn`/`zh-tw`),传 `zh`、`zh_tw`
等变体不报错但会静默回落到英文书(Imaging Recipes),拿到的是另一套 id。

说明:

- **CN 站只输出简中**:其多语言数据不完整(仅国际共享的 32/66 位创作者有译文,较新的色彩方案也只有中文 URL),完整多语言数据统一从国际站获取
- 国际站个别字段缺失译文时(如 Brandon Woelfel 的俄语名),回退英文
- 头像不入仓库:JSON 的 `avatar` 字段已指向站点完整 URL,客户端直接加载即可

## 输出

`assets/creators_{站点}_{语言}.json`,语言代码:`zh`(简中)、`zh_tw`(繁中)、`en`、`ja`、`ko`、`de`、`fr`、`es`、`it`、`nl`、`tr`、`ru`。

另有兼容文件 `assets/creators_zh.json`——与 `creators_cn_zh.json` 内容完全相同,早期内测用户在用此 URL,保持同步更新。

### JSON 结构

```json
[
  {
    "name": "创作者名称",
    "position": "职业",
    "bio": "简介",
    "avatar": "https://imagingcloud.nikon.com.cn/img/recipe/release/creator_figXX.png",
    "recipes": [
      {
        "name": "色彩方案名称",
        "id": "该语言 release 书的方案 id(与 App 请求同语言接口返回的 id 一致)",
        "detailUrl": "/recipe/release/detail/?id=xxx"
      }
    ]
  }
]
```

`detailUrl` 是对应语言站点的相对路径,拼上站点域名即可访问。`id` 与同语言
release 接口(空 `bookId` + 该语言 `lang_code`)返回的 id 一致,客户端直接按
id 关联 release 列表数据即可。

## CDN 访问

数据通过 jsDelivr 提供,`@main` 始终指向最新内容:

| 站点 | 语言 | URL |
|---|---|---|
| 中国站 | 简体中文 | https://cdn.jsdelivr.net/gh/2kpurple/nikon-cloud-res@main/assets/creators_cn_zh.json |
| 中国站 | 简体中文(旧版兼容) | https://cdn.jsdelivr.net/gh/2kpurple/nikon-cloud-res@main/assets/creators_zh.json |
| 国际站 | 简体中文 | https://cdn.jsdelivr.net/gh/2kpurple/nikon-cloud-res@main/assets/creators_intl_zh.json |
| 国际站 | 繁体中文 | https://cdn.jsdelivr.net/gh/2kpurple/nikon-cloud-res@main/assets/creators_intl_zh_tw.json |
| 国际站 | English | https://cdn.jsdelivr.net/gh/2kpurple/nikon-cloud-res@main/assets/creators_intl_en.json |
| 国际站 | 日本語 | https://cdn.jsdelivr.net/gh/2kpurple/nikon-cloud-res@main/assets/creators_intl_ja.json |
| 国际站 | 한국어 | https://cdn.jsdelivr.net/gh/2kpurple/nikon-cloud-res@main/assets/creators_intl_ko.json |
| 国际站 | Deutsch | https://cdn.jsdelivr.net/gh/2kpurple/nikon-cloud-res@main/assets/creators_intl_de.json |
| 国际站 | Français | https://cdn.jsdelivr.net/gh/2kpurple/nikon-cloud-res@main/assets/creators_intl_fr.json |
| 国际站 | Español | https://cdn.jsdelivr.net/gh/2kpurple/nikon-cloud-res@main/assets/creators_intl_es.json |
| 国际站 | Italiano | https://cdn.jsdelivr.net/gh/2kpurple/nikon-cloud-res@main/assets/creators_intl_it.json |
| 国际站 | Nederlands | https://cdn.jsdelivr.net/gh/2kpurple/nikon-cloud-res@main/assets/creators_intl_nl.json |
| 国际站 | Türkçe | https://cdn.jsdelivr.net/gh/2kpurple/nikon-cloud-res@main/assets/creators_intl_tr.json |
| 国际站 | Русский | https://cdn.jsdelivr.net/gh/2kpurple/nikon-cloud-res@main/assets/creators_intl_ru.json |

## 本地运行

```bash
node scrape-creators.js
```

抓取两站数据,更新 `assets/creators_*.json` 及兼容文件 `creators_zh.json`。

## 自动更新

通过 GitHub Actions 每天 18:00(北京时间)自动运行爬虫。任一 JSON 有变化时,自动提交并创建 Release(附带全部数据文件);输出含 U+FFFD 乱码时直接失败,防止脏数据入库。

也可在 GitHub → Actions → **Update Creators Data** → **Run workflow** 手动触发。
