# 第三方依赖（本地化，不依赖外网）

## xlsx.full.min.js — SheetJS Community Edition 0.18.5

- 用途：在浏览器里直接解析 `.xlsx` / `.xls`，实现「批量导入词库」的真实文件解析。
- 来源：`https://unpkg.com/xlsx@0.18.5/dist/xlsx.full.min.js`
- 引入方式：不打包、不走 npm，`<script>` 直接引用本地文件，保证 `file://` 双击即可运行：

```html
<script src="../assets/vendor/xlsx.full.min.js"></script>
```

加载顺序要求：**必须在 `store.js` 之前**（`resource/import.html` 与测试脚本都遵循这个顺序）。
Store 本身不依赖 SheetJS：解析在页面里做，业务规则（表头识别、校验、去重、入库）在 `store.js` 里，
因此 Node 侧的数据层测试可以复用同一份 Excel 读取代码。

- 重新获取：

```bash
curl -sL https://unpkg.com/xlsx@0.18.5/dist/xlsx.full.min.js -o prototype/assets/vendor/xlsx.full.min.js
```

- 说明：只用到 `read` / `write` / `utils.sheet_to_json` / `utils.aoa_to_sheet` / `utils.book_new` /
  `utils.book_append_sheet`，未涉及需要额外许可的 Pro 功能。
