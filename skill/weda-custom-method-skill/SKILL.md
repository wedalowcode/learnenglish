---
name: weda-custom-method
description: 编写微搭（CloudBase WeDa）前端自定义方法。覆盖按钮事件、表单提交、字段 change、主表+明细提交、关联字段读写、数据源 CRUD。Use when user asks for 微搭自定义方法, 按钮事件, 表单提交, 数据源操作, callDataSource, wedaGetRecordsV2, 关联字段, or WeDa frontend JavaScript patterns.
---

# 微搭前端自定义方法开发规范

基于大华瑞云等项目实战提炼。本技能只管**前端自定义方法**（按钮事件、表单提交、字段 change）；云函数见 `weda-cloud-function`，自定义 JSX 组件见 `weda-component-jsx`，组件实例方法速查见 `weda-component-api`。

## 何时使用 / 何时不用

**使用：**
- 写/改前端自定义方法（按钮事件、表单提交、字段 change）
- `$w.cloud.callDataSource` 数据源 CRUD
- 主表 + 明细的 create/edit 提交分支
- 关联字段读写、金额/月份等业务模式

**不使用：**
- 服务端批量任务、定时任务（用 `weda-cloud-function`）
- 自定义 JSX 组件（用 `weda-component-jsx`）
- 查 `$w.listView1.refresh()` 等组件方法（用 `weda-component-api`）
- 纯数据模型字段设计（只给字段清单即可）

---

## 强制骨架

```javascript
export default async function ({ event, data }) {
  try {
    // 1. 参数校验（失败用 toast + return）
    // 2. 业务逻辑
    // 3. 成功反馈（toast / navigateBack）
  } catch (error) {
    console.error('操作描述失败:', error);
    $w.utils.showToast({
      title: error?.message || '操作失败',
      icon: 'error',
      duration: 2000,
    });
  }
}
```

校验失败一律：`showToast` + `return`，不要抛到 catch 除非是真正异常。

---

## 参数与表单读取

```javascript
// 组件值
const dateValue = $w.date1.value;
const projectId = $w.select6.value;

// 表单
const formValues = $w.form1?.submitParams?.data
  || $w.form1?.getFieldsValue?.()
  || $w.form1?.value
  || {};

// 页面参数
const formType = $w.page.dataset.params?.formType; // 'create' | 'edit'
const recordId = $w.page.dataset.params?._id
  || $w.page.dataset.state.some_id;

// 自定义组件同步的明细
const detailRows = $w.page.dataset.state.xxx_detail_rows || [];
const deletedIds = $w.page.dataset.state.xxx_detail_deleted || [];
```

---

## 数据源 API 速查

```javascript
const result = await $w.cloud.callDataSource({
  dataSourceName: 'DH-Project',  // 模型「标识」，不是显示名
  methodName: 'wedaGetItemV2',
  params: { /* 见下 */ },
});
```

| methodName | 作用 | 单次上限 |
|------------|------|----------|
| `wedaGetRecordsV2` | 查多条 | 200 条 |
| `wedaGetItemV2` | 查单条 | — |
| `wedaCreateV2` | 新建一条 | — |
| `wedaBatchCreateV2` | 批量新建 | 建议 ≤200 |
| `wedaUpdateV2` | 更新一条 | — |
| `wedaBatchUpdateV2` | 批量更新 | 200 条 |
| `wedaDeleteV2` | 删除一条 | — |
| `wedaBatchDeleteV2` | 批量删除 | 200 条 |

查单条示例：

```javascript
const result = await $w.cloud.callDataSource({
  dataSourceName: 'DH-Project',
  methodName: 'wedaGetItemV2',
  params: {
    filter: { where: { _id: { $eq: id } } },
    select: { $master: true, contract: true, client: true },
  },
});
// 空对象用 Object.keys(result).length === 0 判断，不要用 !result
```

- 单次查询 `pageSize` 上限约 200；大数据量分页或 `Promise.all` 并行。
- 创建后取 ID：`result.id || result._id || result?.data?._id`。

完整 CRUD 参数详见 `references/api-frontend.md`。

---

## 关联字段（必须遵守）

**写入：**
```javascript
{ employee_id: { _id: empId } }   // 正确
{ employee_id: empId }            // 错误
```

**读取（兼容对象 / 数组 / 字符串）：**
```javascript
const empId = item.employee_id?._id
  || item.employee_id?.[0]?._id
  || item.employee_id;

const formatRelationField = (val) => {
  if (val && typeof val === 'object' && val._id) return { _id: val._id };
  if (val && typeof val === 'string' && val.trim() !== '') return { _id: val.trim() };
  return null;
};
```

---

## create / edit 分支

```javascript
if (formType === 'create') {
  // wedaCreateV2 主表 → 拿 ID → wedaBatchCreateV2 明细
} else {
  // 必须有 _id
  // 先 batchDelete 已删明细 → update 已有 → batchCreate 新增 → update 主表
}
```

明细「先删后增」在编辑场景更稳妥，避免残留。

---

## $w.utils 速查

```javascript
// 轻提示（最常用）
$w.utils.showToast({ title: '操作成功', icon: 'success', duration: 2000 });
// icon: success | error | loading | none

// Loading
$w.utils.showLoading({ title: '加载中', mask: false });
$w.utils.hideLoading();

// 模态确认
$w.utils.showModal({
  title: '提示', content: '确认删除？', showCancel: true,
  success(res) { if (res.confirm) { /* 确定 */ } },
});

// 页面跳转
$w.utils.navigateTo({ pageId: 'uendbmfnu5f', params: { _id: recordId, formType: 'edit' } });
$w.utils.redirectTo({ pageId: 'home' });
$w.utils.navigateBack();          // 默认 delta=1
$w.utils.navigateBack({ delta: 2 });
$w.utils.relaunchHome();
```

---

## 常用模式速查

- **金额**：`Number(x.toFixed(2))`，读取时 `Number(x || 0)`
- **月份区间**：`startDate = new Date(y, m-1, 1).getTime()`，`endDate = new Date(y, m, 1).getTime() - 1`
- **防重复单据**：先按业务键（如 salary_month + salary_type）查是否已存在
- **Map 汇总**：`empId → amount`，注意 empId 统一取 `_id`
- **并行**：独立查询用 `Promise.all`
- **成功后**：`showToast` + `setTimeout(() => $w.utils.navigateBack(), 1000)`
- **查无判断**：`!result || Object.keys(result).length === 0`
- **字段名带横杠**：where 里用字符串键 `'E-date'`

---

## Filter 运算符速查

| 运算符 | 含义 | | 运算符 | 含义 |
|--------|------|-|--------|------|
| `$eq` | 等于 | | `$in` | 在数组中 |
| `$neq` | 不等于 | | `$nin` | 不在数组中 |
| `$gt`/`$gte` | 大于/大于等于 | | `$search` | 模糊包含 |
| `$lt`/`$lte` | 小于/小于等于 | | `$nsearch` | 不包含 |
| `$empty` | 为空（传 `1`） | | `$nempty` | 非空（传 `1`） |

```javascript
filter: {
  where: {
    $and: [
      { status: { $in: ['1', '2'] } },
      { 'E-date': { $lt: Date.now() } },
      { name: { $nempty: 1 } },
    ],
  },
},
```

---

## 产出检查清单

- [ ] try/catch + toast
- [ ] 入参校验完整（失败 toast + return）
- [ ] 关联字段写入用 `{ _id }`
- [ ] create/edit 分支正确
- [ ] 金额 toFixed(2)
- [ ] 创建后 ID 兼容取值 `result.id || result._id`
- [ ] 查无用 `Object.keys(result).length === 0`
- [ ] pageSize 显式写（不依赖默认 10）
- [ ] 成功后 navigateBack 有 setTimeout 缓冲

---

## 通用约定

1. **数据源名称**写进注释或常量，与模型标识核对（如 `APP_Invoice`、`t_salary_sheet`）。
2. **状态枚举**用字符串数字（`'1'` 草稿、`'2'` 已提交），与选项集标识一致。
3. 业务口径（工时折算、就高加班等）以项目确认结果为准，在代码注释标明。
4. 出错信息面向业务用户：短、可行动（「请选择项目」而非堆栈）。
5. 完整 API 参数与实战示例见 `references/api-frontend.md`。

---

## 与其他技能的协作

| 需求 | 用哪个技能 |
|------|-----------|
| 写自定义方法（本技能） | `weda-custom-method` |
| 查 `$w.listView1.refresh()` 等组件方法 | `weda-component-api` |
| 写自定义 JSX 组件 | `weda-component-jsx` |
| 写云函数（服务端批量/定时） | `weda-cloud-function` |
