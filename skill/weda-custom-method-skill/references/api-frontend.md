# 微搭前端 API 完整参考

> 自定义方法写代码时查这个。入口统一为 `$w.cloud.callDataSource`。
> 官方文档：https://docs.cloudbase.net/lowcode/api/

---

## 目录

1. [调用入口](#1-调用入口)
2. [工具方法 $w.utils](#2-工具方法-wutils)
3. [数据源统一调用](#3-数据源统一调用)
4. [CRUD 方法详解](#4-crud-方法详解)
5. [查询条件 Filter / 运算符](#5-查询条件-filter--运算符)
6. [关联字段读写](#6-关联字段读写)
7. [页面与状态常用对象](#7-页面与状态常用对象)
8. [实战完整示例](#8-实战完整示例)
9. [常见坑与约定](#9-常见坑与约定)

---

## 1. 调用入口

| 环境 | 写法 | 说明 |
|------|------|------|
| 前端自定义方法 / JSX | `$w.cloud.callDataSource({ dataSourceName, methodName, params })` | 最常用 |
| 前端调云函数 | `$w.cloud.callFunction({ name, data })` | 调你自己写的云函数 |

**前端统一模板：**

```javascript
const result = await $w.cloud.callDataSource({
  dataSourceName: 't_salary_sheet',  // 模型「标识」，不是显示名
  methodName: 'wedaGetRecordsV2',
  params: { /* 见下文 */ },
});
```

---

## 2. 工具方法 $w.utils

### 2.1 提示与弹窗

```javascript
// 轻提示（自定义方法里最常用）
$w.utils.showToast({
  title: '操作成功',           // 必填
  icon: 'success',             // success | error | loading | none，默认 success
  // image: 'https://...',     // 自定义图，优先于 icon
  duration: 2000,              // 默认 1500
});

// Loading
$w.utils.showLoading({ title: '加载中', mask: false });
$w.utils.hideLoading();

// 模态确认
$w.utils.showModal({
  title: '提示',
  content: '确认删除？',
  showCancel: true,
  cancelText: '取消',
  confirmText: '确定',
  success(res) {
    if (res.confirm) { /* 确定 */ }
    if (res.cancel) { /* 取消 */ }
  },
});
```

### 2.2 页面跳转

```javascript
// 保留当前页，跳转（可带参数）
$w.utils.navigateTo({
  pageId: 'uendbmfnu5f',
  params: { _id: recordId, formType: 'edit' },
});

// 关闭当前页再跳转
$w.utils.redirectTo({ pageId: 'home', params: {} });

// 关闭所有页打开指定页
$w.utils.reLaunch({ pageId: 'home' });

// 返回上一页（可多级）
$w.utils.navigateBack();           // 默认 delta=1
$w.utils.navigateBack({ delta: 2 });

// 回首页
$w.utils.relaunchHome();
```

协议跳转（较少用）：

```javascript
$w.utils.navigateTo({ url: 'weda-page://main/index?tt=1' });
$w.utils.navigateTo({ url: 'https://example.com' }); // 仅 Web
```

### 2.3 存储 / 其它

```javascript
await $w.utils.setStorage({ key: 'k', data: { a: 1 } });
const { data } = await $w.utils.getStorage({ key: 'k' });
await $w.utils.removeStorage({ key: 'k' });

$w.utils.setClipboardData({ data: '复制文本' });
$w.utils.callPhone({ tel: '13800138000' });

// 枚举展示值
$w.utils.getEnumValue({
  enumOptions: [{ key: '1', value: '待审批' }, { key: '2', value: '已通过' }],
  key: '1', // → '待审批'
});
```

---

## 3. 数据源统一调用

```javascript
await $w.cloud.callDataSource({
  dataSourceName: string,   // 必填，模型标识
  methodName: string,       // 必填，见下表
  params: object,           // 必填，方法入参
});
```

### methodName 一览

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

---

## 4. CRUD 方法详解

### 4.1 查多条 `wedaGetRecordsV2`

**入参**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| filter | `{ where }` | 建议有 | 条件；无条件可 `where: {}` |
| select | object | 是 | `{ $master: true }` 主表全部；或指定字段 |
| pageSize | number | 建议 | 默认 10，**最大 200** |
| pageNumber | number | 建议 | 从 1 开始 |
| getCount | boolean | 否 | true 时返回 total |
| orderBy | array | 否 | 最多 3 个字段，如 `[{ createdAt: 'desc' }]` |
| relateWhere | object | 否 | 关联表条件 |
| compatibleWithV1 | boolean | 否 | 旧关联兼容 |

**出参**

```javascript
{
  records: [ { _id, ... }, ... ],
  total: 123,   // 仅 getCount: true 时可靠
}
// 实战兼容写法：
const records = result?.records || result?.data?.records || [];
const total = result?.total ?? result?.data?.total ?? 0;
```

**完整示例**

```javascript
const result = await $w.cloud.callDataSource({
  dataSourceName: 'user',
  methodName: 'wedaGetRecordsV2',
  params: {
    filter: {
      where: {
        $and: [
          { employee_status: { $eq: '1' } },
          { name: { $nempty: 1 } },
        ],
      },
    },
    select: { $master: true },
    pageSize: 200,
    pageNumber: 1,
    getCount: true,
    orderBy: [{ name: 'asc' }],
  },
});
const employees = result?.records || [];
```

日期范围：

```javascript
filter: {
  where: {
    work_date: { $gte: startDate, $lte: endDate }, // 毫秒时间戳
  },
},
```

### 4.2 查单条 `wedaGetItemV2`

```javascript
const project = await $w.cloud.callDataSource({
  dataSourceName: 'DH-Project',
  methodName: 'wedaGetItemV2',
  params: {
    filter: { where: { _id: { $eq: projectId } } },
    select: {
      $master: true,
      contract: true,  // 带出关联
      client: true,
      manager: true,
    },
  },
});

// 空结果判断（官方可能返回 {}）
if (!project || Object.keys(project).length === 0) {
  $w.utils.showToast({ title: '未找到项目', icon: 'error', duration: 2000 });
  return;
}
```

### 4.3 新建 `wedaCreateV2`

```javascript
const sheetResult = await $w.cloud.callDataSource({
  dataSourceName: 't_salary_sheet',
  methodName: 'wedaCreateV2',
  params: {
    data: {
      salary_type: '2',
      salary_month: '2026-08',
      total_amount: Number(total.toFixed(2)),
      status: '1',
      // 关联字段必须对象形式
      // owner: { _id: userId },
    },
  },
});

// 新 ID（兼容多种返回）
const sheetId = sheetResult?.id || sheetResult?._id || sheetResult?.data?._id;
if (!sheetId) throw new Error('创建失败，未返回ID');
```

### 4.4 批量新建 `wedaBatchCreateV2`

```javascript
await $w.cloud.callDataSource({
  dataSourceName: 't_salary_detail',
  methodName: 'wedaBatchCreateV2',
  params: {
    data: [
      {
        sheet_id: { _id: sheetId },
        employee_id: { _id: empId },
        employee_name: '张三',
        work_amount: 1000,
      },
      // ...
    ],
  },
});
// 返回通常含 idList
```

### 4.5 更新 `wedaUpdateV2` / `wedaBatchUpdateV2`

```javascript
// 单条：filter 应只命中 1 条
await $w.cloud.callDataSource({
  dataSourceName: 'contract',
  methodName: 'wedaUpdateV2',
  params: {
    data: { seal_status: '3' },
    filter: { where: { _id: { $eq: contractId } } },
  },
});

// 批量：最多 200
await $w.cloud.callDataSource({
  dataSourceName: 't_report_detail',
  methodName: 'wedaBatchUpdateV2',
  params: {
    data: { status: '2' },
    filter: { where: { report_id: { $eq: reportId } } },
  },
});
```

增量更新：只改传入字段；要清空可传 `null`（视字段类型而定）。

### 4.6 删除 `wedaDeleteV2` / `wedaBatchDeleteV2`

```javascript
// 按 ID 批量删（编辑明细常用）
await $w.cloud.callDataSource({
  dataSourceName: 't_report_detail',
  methodName: 'wedaBatchDeleteV2',
  params: {
    filter: {
      where: { _id: { $in: deletedIds } },
    },
  },
});
```

---

## 5. 查询条件 Filter / 运算符

### 5.1 结构

```javascript
filter: {
  where: {
    // 单字段
    status: { $eq: '1' },
    // 或逻辑组合
    $and: [ /* 条件对象 */ ],
    $or: [ /* 条件对象 */ ],
  },
  // 跨关联表过滤
  relateWhere: {
    contract: {
      where: { seal_status: { $eq: '3' } },
    },
  },
},
```

### 5.2 运算符表

| 运算符 | 含义 | 适用 |
|--------|------|------|
| `$eq` | 等于 | 通用 |
| `$neq` | 不等于 | 通用 |
| `$gt` / `$gte` | 大于 / 大于等于 | 数字、时间戳 |
| `$lt` / `$lte` | 小于 / 小于等于 | 数字、时间戳 |
| `$in` | 在数组中 | 数组 |
| `$nin` | 不在数组中 | 数组 |
| `$search` | 模糊包含 | 字符串（注意性能） |
| `$nsearch` | 不包含 | 字符串 |
| `$empty` | 为空/不存在 | 传 `1` |
| `$nempty` | 非空 | 传 `1` |

```javascript
// 组合示例
where: {
  $and: [
    { status: { $in: ['1', '2'] } },
    { 'E-date': { $lt: Date.now() } },  // 字段名带横杠用字符串键
    { name: { $nempty: 1 } },
  ],
},
```

`$in: null` 在部分场景表示不过滤该条件（以官方说明为准，实战少用）。

### 5.3 排序 orderBy

```javascript
orderBy: [
  { createdAt: 'desc' },
  { name: 'asc' },
],
// 最多 3 个字段；不要依赖「新建一定排最前」
```

---

## 6. 关联字段读写

### 6.1 写入（必须对象）

```javascript
// 多对一 / 一对一
data: {
  employee_id: { _id: empId },
  project: { _id: projectId },
  sheet_id: { _id: sheetId },
}

// 错误（会导致关联异常）
// employee_id: empId
```

一对多/多对多赋值（更新侧）：

```javascript
data: {
  student_list: [{ _id: 'id1' }, { _id: 'id2' }],
}
// 清空：[]
```

### 6.2 读取（兼容多种形态）

```javascript
// 实战必备工具函数
function pickId(val) {
  if (!val) return null;
  if (typeof val === 'string') return val;
  if (typeof val === 'object') {
    return val._id || val[0]?._id || null;
  }
  return null;
}

function pickName(val) {
  if (!val || typeof val !== 'object') return '';
  return val.name || val.nickName || val[0]?.name || '';
}

const empId = pickId(item.employee_id);
const empName = pickName(item.employee_id);
```

### 6.3 查询时带出关联

```javascript
select: {
  $master: true,
  employee_id: true,
  contract: true,
  manager: true,
  level3: true,
},
```

### 6.4 按关联表条件筛主表

```javascript
filter: {
  relateWhere: {
    manager: {
      where: { name: { $eq: '张三' } },
    },
  },
},
select: { $master: true, manager: true },
```

---

## 7. 页面与状态常用对象

```javascript
// 页面入参（列表点进详情）
$w.page.dataset.params._id
$w.page.dataset.params.formType   // 'create' | 'edit'

// 自定义组件与提交方法约定的状态
$w.page.dataset.state.xxx_detail_rows
$w.page.dataset.state.xxx_detail_deleted
$w.page.dataset.state.project      // 业务缓存

// 表单
$w.form1.submitParams.data
$w.form1.getFieldsValue?.()
$w.form1.setValue({ value: { fieldA: 1 } })

// 组件值
$w.date1.value
$w.select6.value

// 当前用户
$w.auth.currentUser
$w.auth.currentUser?.relatedRoles  // [{ name: '所长' }, ...]
```

---

## 8. 实战完整示例

### 8.1 选择项目后带出字段（change 事件）

```javascript
export default async function ({ event, data }) {
  try {
    const projectVal = event?.detail?.value ?? $w.form1?.getFieldValue?.('project');
    const projectId = typeof projectVal === 'object' ? projectVal?._id : projectVal;
    if (!projectId) {
      $w.form1.setValue({ value: { level: '', manager: '', C_file_status: '' } });
      return;
    }

    const projectRes = await $w.cloud.callDataSource({
      dataSourceName: 'DH-Project',
      methodName: 'wedaGetItemV2',
      params: {
        filter: { where: { _id: { $eq: projectId } } },
        select: { $master: true, contract: true, manager: true, level3: true },
      },
    });

    if (!projectRes || Object.keys(projectRes).length === 0) {
      $w.utils.showToast({ title: '未找到项目', icon: 'error', duration: 2000 });
      return;
    }

    const businessType =
      projectRes.level3?.L3 || projectRes.level3?.name || '';
    const managerName =
      projectRes.manager?.name || projectRes.manager?.nickName || '';

    $w.form1.setValue({
      value: {
        level: businessType,
        manager: managerName,
      },
    });
  } catch (error) {
    console.error('带出失败:', error);
    $w.utils.showToast({
      title: error?.message || '获取失败',
      icon: 'error',
      duration: 2000,
    });
  }
}
```

### 8.2 主表 + 明细提交（create / edit）

```javascript
export default async function ({ event, data }) {
  try {
    const formType = $w.page.dataset.params?.formType;
    const recordId = $w.page.dataset.params?._id;
    const detailRows = $w.page.dataset.state.detail_rows || [];
    const deletedIds = ($w.page.dataset.state.detail_deleted || []).filter(Boolean);

    if (!detailRows.length) {
      $w.utils.showToast({ title: '请至少添加一条明细', icon: 'error', duration: 2000 });
      return;
    }

    const mainData = {
      // ...表单字段
      // project: formatRelationField(formValues.project),
    };

    let mainId = recordId;

    if (formType === 'create' || !recordId) {
      const created = await $w.cloud.callDataSource({
        dataSourceName: 'APP_Invoice',
        methodName: 'wedaCreateV2',
        params: { data: mainData },
      });
      mainId = created.id || created._id;
    } else {
      await $w.cloud.callDataSource({
        dataSourceName: 'APP_Invoice',
        methodName: 'wedaUpdateV2',
        params: {
          data: mainData,
          filter: { where: { _id: { $eq: recordId } } },
        },
      });
      if (deletedIds.length) {
        await $w.cloud.callDataSource({
          dataSourceName: 'Invoice_Service_Detail',
          methodName: 'wedaBatchDeleteV2',
          params: { filter: { where: { _id: { $in: deletedIds } } } },
        });
      }
    }

    const toCreate = [];
    const toUpdate = [];
    detailRows.forEach((row) => {
      const body = {
        // ...清洗后的字段
        invoice_id: { _id: mainId },
      };
      if (row._id) {
        toUpdate.push({ _id: row._id, ...body });
      } else {
        toCreate.push(body);
      }
    });

    for (const item of toUpdate) {
      const id = item._id;
      const data = { ...item };
      delete data._id;
      await $w.cloud.callDataSource({
        dataSourceName: 'Invoice_Service_Detail',
        methodName: 'wedaUpdateV2',
        params: {
          filter: { where: { _id: { $eq: id } } },
          data,
        },
      });
    }
    if (toCreate.length) {
      await $w.cloud.callDataSource({
        dataSourceName: 'Invoice_Service_Detail',
        methodName: 'wedaBatchCreateV2',
        params: { data: toCreate },
      });
    }

    $w.page.dataset.state.detail_deleted = [];
    $w.utils.showToast({ title: '提交成功', icon: 'success', duration: 2000 });
    setTimeout(() => $w.utils.navigateBack(), 1000);
  } catch (error) {
    console.error(error);
    $w.utils.showToast({
      title: error?.message || '提交失败',
      icon: 'error',
      duration: 2000,
    });
  }
}
```

---

## 9. 常见坑与约定

| 坑 | 正确做法 |
|----|----------|
| 关联写入传字符串 ID | 必须 `{ _id: id }` |
| `!result` 判断查无 | 用 `!result \|\| Object.keys(result).length === 0` |
| 一次查超过 200 | 分页或多次请求 |
| 依赖 pageSize 默认 10 | 业务列表显式写 `pageSize: 200` |
| create 后只写 `result._id` | `result.id \|\| result._id \|\| result?.data?._id` |
| 字段名带 `-` | where 里用字符串键 `'E-date'` |
| 金额浮点 | `Number(x.toFixed(2))`，读 `Number(x \|\| 0)` |
| 编辑明细残留 | 先 batchDelete deletedIds，再 update/create |
| 枚举存中文 | 存选项标识 `'1'`/`'2'`，展示用 getEnumValue 或映射 |

---

## 附录：官方文档对应

| 主题 | 官方入口 |
|------|----------|
| Utils | https://docs.cloudbase.net/lowcode/api/utils |
| Cloud / 云函数调用 | https://docs.cloudbase.net/lowcode/api/cloud |
| CRUD | https://docs.cloudbase.net/lowcode/api/model_crud |
| 关联 | https://docs.cloudbase.net/lowcode/api/model_relation |
| 复杂查询 | https://docs.cloudbase.net/lowcode/api/model_queries |
| 数据源 V2 协议 | https://docs.cloudbase.net/lowcode/manage/datasource-v2 |
