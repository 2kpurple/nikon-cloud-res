# Nikon Cloud Res

尼康色彩方案灵感库的全量数据快照(创摄者 × 书单 × 方案详情 × 图片),支持中国站与国际站 × 多语言。App 只需读本仓库(jsDelivr CDN),不依赖任何尼康接口。

## 数据来源

站点前端改版后(2026-10),数据由三个匿名接口提供,爬虫全量拉取并落地:

| 数据 | 接口 | 说明 |
|---|---|---|
| 创摄者 | `GET api.user.ir.imagingcloud.nikon.com{,.cn}/info/creator` | `Accept-Language` 选语言;含头像 URL 与方案 path |
| 书单 | `POST api.user.cwp.imagingcloud.nikon.com{,.cn}/bff/recipe/release` | body `{ ownerUserId:"nikon", bookId:"", sortType:0, lang_code, country }`、header `access_token: null`;空 bookId 返回该语言默认书 |
| 方案详情 | `GET api.user.ir.imagingcloud.nikon.com{,.cn}<path>?sortType=0&isPagenation=false` | `<path>` 用创摄者接口给的 `recipes[].path`(其中的路由 bookId 与 release 书 id 不同,不能混用) |

**图片**(封面/头像/详情缩略图)是带过期签名的临时 URL(签名过期即失效,这就是直连尼康接口图片不稳定的原因),爬虫当场下载字节,按内容 sha256 存储,跨语言/跨站同图自动去重为一份。

**方案 id 与"按语言分书"**:release 服务端按语言分书,每种语言一本书、一套独立资源 id(跨语言 id 零重叠)。13 组(中国站简中 + 国际站 12 语言)各 144 个方案,书内 id 与创摄者文件、详情文件一一对应,客户端按 id 关联即可。

说明:

- **CN 站只输出简中**:其接口仅接受 `zh-cn`,其余语言返回空;完整多语言数据统一从国际站获取
- 头像/封面不入仓库原图域名的引用:JSON 里所有图片字段都是仓库相对路径(见下)
- 图片下载带跨 CDN 主机回退(`.cn` ↔ `.com` 同路径对象互备)与体积护栏(单张 2MB / 总量 800MB)

## 输出

```
assets/
  creators_{站点}_{语言}.json        # 创摄者数组
  book_{站点}_{语言}.json            # 书单(默认书)
  details/{站点}/{语言}/{方案id}.json # 方案详情快照(参数/文案/相机镜头信息)
  img/<hash前2位>/<sha256>.<ext>     # 图片本体(内容哈希命名)
  img/manifest.json                  # 图片下载清单(增量用)
```

语言代码:`zh`(简中)、`zh_tw`(繁中)、`en`、`ja`、`ko`、`de`、`fr`、`es`、`it`、`nl`、`tr`、`ru`。站点:`cn`(中国站)、`intl`(国际站)。

另有兼容文件 `assets/creators_zh.json`——与 `creators_cn_zh.json` 内容完全相同,早期内测用户在用此 URL,保持同步更新。

### 图片引用规则

JSON 中所有图片字段(创摄者的 `avatar`、书单的 `cover`、详情内的 `thumbnail` 等)都是**仓库相对路径**(如 `img/ab/c3ab….jpg`),App 拼接 CDN 前缀即可:

```
https://cdn.jsdelivr.net/gh/2kpurple/nikon-cloud-res@main/assets/<相对路径>
```

### JSON 结构

创摄者文件(顶层数组):

```json
[
  {
    "name": "创作者名称",
    "position": "职业",
    "bio": "简介",
    "avatar": "img/01/0123….png",
    "recipes": [
      { "name": "色彩方案名称", "id": "方案id", "detailUrl": "/recipe/release/detail/?id=xxx" }
    ]
  }
]
```

书单文件(顶层对象):

```json
{
  "bookId": "该语言书的 id",
  "label": "书名(如 创意色彩灵感库 / Imaging Recipes)",
  "isNew": true,
  "recipes": [
    {
      "name": "色彩方案名称",
      "id": "方案 id",
      "cover": "img/ab/c3ab….jpg",
      "detailUrl": "/recipe/release/detail/?id=xxx",
      "publicDate": "2026-10-14T09:54:49+08:00",
      "isNew": true
    }
  ]
}
```

详情文件(接口原样快照,图片 URL 已重写为本地路径,剥离了随用户抖动的 `userLikeStatus`/`likeCount`),含 `pictureControl`(优化校准参数)、`exif`、`camera`/`lens`、`recipeDetail`(创作者说明,分语言)等字段。

`detailUrl` 是对应语言站点的相对路径,拼上站点域名可跳转尼康官网详情页(仅作外链用途)。

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

### 灵感库书单

| 站点 | 语言 | URL |
|---|---|---|
| 中国站 | 简体中文 | https://cdn.jsdelivr.net/gh/2kpurple/nikon-cloud-res@main/assets/book_cn_zh.json |
| 国际站 | 简体中文 | https://cdn.jsdelivr.net/gh/2kpurple/nikon-cloud-res@main/assets/book_intl_zh.json |
| 国际站 | 繁体中文 | https://cdn.jsdelivr.net/gh/2kpurple/nikon-cloud-res@main/assets/book_intl_zh_tw.json |
| 国际站 | English | https://cdn.jsdelivr.net/gh/2kpurple/nikon-cloud-res@main/assets/book_intl_en.json |
| 国际站 | 日本語 | https://cdn.jsdelivr.net/gh/2kpurple/nikon-cloud-res@main/assets/book_intl_ja.json |
| 国际站 | 한국어 | https://cdn.jsdelivr.net/gh/2kpurple/nikon-cloud-res@main/assets/book_intl_ko.json |
| 国际站 | Deutsch | https://cdn.jsdelivr.net/gh/2kpurple/nikon-cloud-res@main/assets/book_intl_de.json |
| 国际站 | Français | https://cdn.jsdelivr.net/gh/2kpurple/nikon-cloud-res@main/assets/book_intl_fr.json |
| 国际站 | Español | https://cdn.jsdelivr.net/gh/2kpurple/nikon-cloud-res@main/assets/book_intl_es.json |
| 国际站 | Italiano | https://cdn.jsdelivr.net/gh/2kpurple/nikon-cloud-res@main/assets/book_intl_it.json |
| 国际站 | Nederlands | https://cdn.jsdelivr.net/gh/2kpurple/nikon-cloud-res@main/assets/book_intl_nl.json |
| 国际站 | Türkçe | https://cdn.jsdelivr.net/gh/2kpurple/nikon-cloud-res@main/assets/book_intl_tr.json |
| 国际站 | Русский | https://cdn.jsdelivr.net/gh/2kpurple/nikon-cloud-res@main/assets/book_intl_ru.json |

## 本地运行

```bash
node scrape-creators.js                 # 全量(数据 + 图片)
NIKON_SKIP_IMAGES=1 node scrape-creators.js   # 仅数据(图片字段输出 null)
```

抓取两站数据,更新 `assets/` 下的创摄者/书单/详情文件、图片库与兼容文件 `creators_zh.json`。输出为确定性 JSON(无变化时 diff 为空);图片按 manifest 增量跳过。

## 自动更新

通过 GitHub Actions 每天 18:00(北京时间)自动运行爬虫。任一文件有变化时,自动提交并创建 Release(附件仅含创摄者/书单汇总 JSON,详情快照与图片走 `@main` 分支);输出含 U+FFFD 乱码、图片下载失败或出现悬空图片引用时直接失败,防止脏数据入库。

也可在 GitHub → Actions → **Update Creators Data** → **Run workflow** 手动触发。
