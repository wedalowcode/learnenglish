# 微搭云函数 API 完整参考

> 云函数写代码时查这个。入口为 `@cloudbase/node-sdk` 的 `app.models`。
> 官方文档：https://docs.cloudbase.net/lowcode/api/cloud

---

## 目录

1. [SDK 初始化](#1-sdk-初始化)
2. [models 增删改查](#2-models-增删改查)
3. [查询条件 Filter / 运算符](#3-查询条件-filter--运算符)
4. [关联字段读写](#4-关联字段读写)
5. [前端调云函数](#5-前端调云函数)
6. [实战完整示例](#6-实战完整示例)
7. [常见坑与约定](#7-常见坑与约定)

---

## 1. SDK 初始化

```javascript
const cloudbase = require('@cloudbase/node-sdk');
const app = cloudbase.init({
  env: cloudbase.SYMBOL_CURRENT_ENV,  // 自动取当前环境，不要写死 envId
});

const MODEL = 'VU_Application'; // 数据源标识（不是显示名）
```

**入口函数：**

```javascript
exports.main = async (event, context) => {
  const models = app.models;
  // event 是前端 callFunction 传入的 data
  // context 含调用上下文信息
  try {
    // 业务逻辑
    return { ok: true };
  } catch (e) {
    return { ok: false, message: e.message };
  }
};
```

---

## 2. models 增删改查

### 2.1 查多条 `list`

```javascript
const listRes = await models[MODEL].list({
  filter: {
    where: {
      $and: [
        { status: { $in: ['1', '2'] } },
        { 'E-date': { $lt: Date.now() } },
      ],
    },
  },
  select: { $master: true },
  pageSize: 200,        // 最大 200
  pageNumber: 1,        // 从 1 开始
  getCount: true,       // 返回 total
  orderBy: [{ createdAt: 'desc' }],  // 最多 3 个字段
});

// 出参兼容写法（官方返回结构可能变化）
const records = listRes?.data?.records || listRes?.records || [];
const total = listRes?.data?.total ?? listRes?.total ?? 0;
```

### 2.2 查单条 `getItem`

```javascript
const itemRes = await models[MODEL].getItem({
  filter: { where: { _id: { $eq: id } } },
  select: { $master: true, contract: true, manager: true },
});

// 空结果判断
if (!itemRes || Object.keys(itemRes).length === 0) {
  return { ok: false, message: '未找到记录' };
}
```

### 2.3 新建 `create`

```javascript
const createRes = await models[MODEL].create({
  data: {
    name: '测试',
    status: '1',
    // 关联字段必须对象形式
    owner: { _id: userId },
  },
});
const newId = createRes?._id || createRes?.id;
```

### 2.4 更新 `update` / `updateMany`

```javascript
// 单条更新
await models[MODEL].update({
  data: { status: '3' },
  filter: { where: { _id: { $eq: rowId } } },
});

// 批量更新（优先用，不支持则降级）
try {
  await models[MODEL].updateMany({
    data: { status: '3' },
    filter: { where: { status: { $in: ['1', '2'] } } },
  });
} catch (e) {
  // 降级：逐条 update
  for (const row of records) {
    await models[MODEL].update({
      data: { status: '3' },
      filter: { where: { _id: { $eq: row._id } } },
    });
  }
}
```

增量更新：只改传入字段；要清空可传 `null`。

### 2.5 删除 `delete` / `deleteMany`

```javascript
// 单条删
await models[MODEL].delete({
  filter: { where: { _id: { $eq: rowId } } },
});

// 批量删
await models[MODEL].deleteMany({
  filter: { where: { _id: { $in: deletedIds } } },
});
```

---

## 3. 查询条件 Filter / 运算符

### 3.1 结构

```javascript
filter: {
  where: {
    status: { $eq: '1' },           // 单字段
    $and: [ /* 条件对象 */ ],        // 与
    $or: [ /* 条件对象 */ ],         // 或
  },
  // 跨关联表过滤
  relateWhere: {
    contract: {
      where: { seal_status: { $eq: '3' } },
    },
  },
},
```

### 3.2 运算符表

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

### 3.3 排序 orderBy

```javascript
orderBy: [
  { createdAt: 'desc' },
  { name: 'asc' },
],
// 最多 3 个字段
```

---

## 4. 关联字段读写

### 4.1 写入（必须对象）

```javascript
data: {
  employee_id: { _id: empId },
  project: { _id: projectId },
  sheet_id: { _id: sheetId },
}

// 一对多/多对多
data: {
  student_list: [{ _id: 'id1' }, { _id: 'id2' }],
}
// 清空：[]
```

### 4.2 读取（兼容多种形态）

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

const empId = pickId(row.employee_id);
```

### 4.3 查询时带出关联

```javascript
select: {
  $master: true,    // 主表全部字段
  employee_id: true,
  contract: true,
  manager: true,
},
```

### 4.4 按关联表条件筛主表

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

## 5. 前端调云函数

前端自定义方法里调用云函数：

```javascript
const res = await $w.cloud.callFunction({
  name: 'autoCloseApplication',  // 云函数名称
  data: { /* 业务入参 */ },
});

// res 即云函数 return 的对象
if (res?.ok) {
  $w.utils.showToast({ title: '处理完成', icon: 'success' });
} else {
  $w.utils.showToast({ title: res?.message || '处理失败', icon: 'error' });
}
```

---

## 6. 实战完整示例

### 6.1 定时关闭过期申请

```javascript
const cloudbase = require('@cloudbase/node-sdk');
const app = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV });

const MODEL = 'VU_Application';

exports.main = async (event, context) => {
  const models = app.models;
  const errors = [];

  try {
    // 1. 查符合条件的记录
    const listRes = await models[MODEL].list({
      filter: {
        where: {
          $and: [
            { status: { $in: ['1', '2'] } },
            { 'E-date': { $lt: Date.now() } },
          ],
        },
      },
      select: { $master: true },
      pageSize: 200,
      getCount: true,
    });
    const records = listRes?.data?.records || listRes?.records || [];

    if (!records.length) {
      return { ok: true, scanned: 0, updated: 0, runAt: new Date().toISOString() };
    }

    // 2. 批量更新
    let updated = 0;
    try {
      await models[MODEL].updateMany({
        data: { status: '3' },
        filter: {
          where: {
            $and: [
              { status: { $in: ['1', '2'] } },
              { 'E-date': { $lt: Date.now() } },
            ],
          },
        },
      });
      updated = records.length;
    } catch (e) {
      // 降级：逐条 update
      for (const row of records) {
        try {
          await models[MODEL].update({
            data: { status: '3' },
            filter: { where: { _id: { $eq: row._id } } },
          });
          updated++;
        } catch (err) {
          errors.push({ _id: row._id, message: err.message });
        }
      }
    }

    // 3. 同步关联表状态（如有）
    for (const row of records) {
      const numberId = row.number?._id || row.number;
      if (numberId) {
        try {
          await models['V_number'].update({
            data: { status: '3' },
            filter: { where: { _id: { $eq: numberId } } },
          });
        } catch (err) {
          errors.push({ _id: numberId, message: '关联表更新失败: ' + err.message });
        }
      }
    }

    return {
      ok: true,
      scanned: records.length,
      updated,
      errors: errors.length ? errors : undefined,
      runAt: new Date().toISOString(),
    };
  } catch (e) {
    return { ok: false, message: e.message, runAt: new Date().toISOString() };
  }
};
```

### 6.2 分页处理大数据量

```javascript
exports.main = async (event, context) => {
  const models = app.models;
  let pageNumber = 1;
  const pageSize = 200;
  let total = 0;
  let processed = 0;

  do {
    const listRes = await models[MODEL].list({
      filter: { where: { status: { $eq: '1' } } },
      select: { $master: true },
      pageSize,
      pageNumber,
      getCount: true,
    });
    const records = listRes?.data?.records || listRes?.records || [];
    total = listRes?.data?.total ?? listRes?.total ?? 0;

    for (const row of records) {
      // 逐条处理
      await models[MODEL].update({
        data: { status: '2' },
        filter: { where: { _id: { $eq: row._id } } },
      });
      processed++;
    }
    pageNumber++;
  } while ((pageNumber - 1) * pageSize < total);

  return { ok: true, scanned: processed, runAt: new Date().toISOString() };
};
```

---

## 7. 常见坑与约定

| 坑 | 正确做法 |
|----|----------|
| 写死 envId | 用 `cloudbase.SYMBOL_CURRENT_ENV` |
| list 结果取 `res.records` | 兼容 `res?.data?.records \|\| res?.records` |
| 依赖 updateMany 一定存在 | try/catch 降级逐条 update |
| 一次查超过 200 | 分页 while 循环 |
| 关联写入传字符串 ID | 必须 `{ _id: id }` |
| 字段名带 `-` | where 里用字符串键 `'E-date'` |
| 定时任务非幂等 | 同一批重复执行不应有副作用，先查再更新 |
| 返回结构不统一 | 固定 `{ ok, scanned, updated, errors?, runAt }` |
| 关联表状态遗漏 | 主表改完单独 update 关联表 |

---

## 附录：官方文档对应

| 主题 | 官方入口 |
|------|----------|
| 云函数 SDK | https://docs.cloudbase.net/lowcode/api/cloud |
| CRUD | https://docs.cloudbase.net/lowcode/api/model_crud |
| 关联 | https://docs.cloudbase.net/lowcode/api/model_relation |
| 复杂查询 | https://docs.cloudbase.net/lowcode/api/model_queries |
| @cloudbase/node-sdk | https://docs.cloudbase.net/api-node-sdk/overview |
