# Nikon Cloud Res

爬取 Nikon 中国色彩方案灵感库的创摄者数据。

## 数据来源

- **目标页面**: https://imagingcloud.nikon.com.cn/recipe/release/?bookId=01HXDNN2X6N0ZHNP0WFBDF407Z
- **数据源**: Next.js SPA 的 JS bundle（动态查找包含创作者结构的 chunk + _app.js 中的 i18n 映射）

## CDN 访问

数据通过 jsDelivr 提供，可直接通过 URL 获取：

- **创作者数据**: https://cdn.jsdelivr.net/gh/2kpurple/nikon-cloud-res@main/assets/creators_zh.json
- **头像图片**: https://cdn.jsdelivr.net/gh/2kpurple/nikon-cloud-res@main/assets/creator-avatars/creator_fig01.png（将 `01` 替换为对应编号）

> `@main` 始终指向最新内容，CI/CD 更新后自动生效。

## 输出

| 文件 | 说明 |
|---|---|
| `assets/creators_zh.json` | 中文简体创作者数据 |
| `assets/creator-avatars/` | 头像图片（63 张） |

### JSON 结构

```json
[
  {
    "name": "创作者名称",
    "position": "职业",
    "bio": "简介",
    "avatar": "creator-avatars/creator_figXX.png",
    "recipes": [
      {
        "name": "色彩方案名称",
        "id": "recipe detail 页面 ID",
        "detailUrl": "/recipe/release/detail/?id=xxx"
      }
    ]
  }
]
```

## 本地运行

```bash
node scrape-creators.js
```

会自动下载并更新 `assets/creators_zh.json` 和头像图片。

## 自动更新

通过 GitHub Actions 每天 18:00（北京时间）自动运行爬虫。如果数据有变化，会自动提交并创建 Release，Release 中附带 `creators_zh.json`。

也可在 GitHub → Actions → **Update Creators Data** → **Run workflow** 手动触发。
