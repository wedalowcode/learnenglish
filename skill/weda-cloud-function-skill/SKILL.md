---
name: weda-cloud-function
description: 编写微搭（CloudBase WeDa）云函数。覆盖服务端批量任务、定时状态更新、@cloudbase/node-sdk、app.models CRUD、批量更新与降级。Use when user asks for 微搭云函数, cloudbase node-sdk, app.models, 定时任务, 批量更新, 服务端逻辑, or WeDa server-side JavaScript patterns.
---

# 微搭云函数开发规范

基于大华瑞云等项目实战提炼。本技能只管**云函数**（服务端 Node.js 环境）；前端自定义方法见 `weda-custom-method`。

## 何时使用 / 何时不用

**使用：**
- 写、改云函数（定时任务、批量状态更新、服务端业务逻辑）
- 使用 `@cloudbase/node-sdk` 的 `app.models` 进行数据增删改查
- 跨表批量操作、需要在服务端完成的业务动作
- 前端触发但不适合在前端执行的重逻辑（性能、安全、数据量）

**不使用：**
- 前端按钮事件、表单提交（用 `weda-custom-method`）
- 自定义 JSX 组件（用 `weda-component-jsx`）
- 与微搭无关的普通 Node.js 项目

---

## 强制骨架

统一使用 CommonJS，初始化 CloudBase 实例：

```javascript
const cloudbase = require('@cloudbase/node-sdk');

const app = cloudbase.init({
  env: cloudbase.SYMBOL_CURRENT_ENV,
});

const MODEL = 'VU_Application'; // 数据源标识

exports.main = async (event, context) => {
  const models = app.models;

  try {
    // 查询、业务处理、更新

    return {
      ok: true,
      runAt: new Date().toISOString(),
    };
  } catch (e) {
    console.error('云函数执行失败：', e);

    return {
      ok: false,
      message: e.message || '云函数执行失败',
      runAt: new Date().toISOString(),
    };
  }
};
```

开发约定：

1. CloudBase 实例在函数外初始化，避免每次调用重复初始化。
2. 使用 `SYMBOL_CURRENT_ENV`，让云函数运行在当前环境。
3. 数据源名称统一定义为常量，避免散落在代码中。
4. 入口统一使用 `exports.main`。
5. 不要把前端自定义方法的 `$w` API 用在云函数中。

---

## 查询与更新

### 1. 查询 list

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
  select: {
    $master: true,
  },
  pageSize: 200,
  getCount: true,
});

const records = listRes?.data?.records || listRes?.records || [];
```

常用参数：

| 参数 | 用途 |
|---|---|
| `filter.where` | 查询条件 |
| `select` | 指定返回字段或主表字段 |
| `pageSize` | 每页查询数量 |
| `pageNumber` | 分页页码 |
| `getCount` | 是否获取总数 |

注意：
- `pageSize` 不超过 200。
- 大数据量必须分页，不能只查询第一页。
- 带横杠的字段名使用字符串键，例如 `'E-date'`。
- 不要假设查询结果一定在 `data.records`，兼容项目实际返回结构。

### 2. 查询单条记录

```javascript
const result = await models[MODEL].get({
  filter: {
    where: {
      _id: {
        $eq: id,
      },
    },
  },
});
```

使用前确认当前模型支持 `get` 及其参数格式。如果只是按条件查询，优先使用已经验证过的 `list`。

### 3. 新增记录 create

```javascript
await models[MODEL].create({
  data: {
    name: '测试记录',
    status: '1',
  },
});
```

新增前注意：
- 检查业务唯一性，避免定时任务重复创建。
- 不要自行生成系统维护的 `_id` 等字段，除非业务明确要求。
- 关联字段按照关联字段写入规范处理。

### 4. 更新记录 update

```javascript
await models[MODEL].update({
  data: {
    status: '3',
  },
  filter: {
    where: {
      _id: {
        $eq: id,
      },
    },
  },
});
```

更新时：
- 使用明确的筛选条件。
- 不要在没有业务依据时使用空筛选条件。
- 更新关联字段时，注意关联字段的数据结构。
- 批量处理优先考虑 `updateMany`，但必须准备降级方案。

### 5. 删除记录 delete

```javascript
await models[MODEL].delete({
  filter: {
    where: {
      _id: {
        $eq: id,
      },
    },
  },
});
```

删除前确认业务是否允许物理删除。涉及业务历史的数据，优先考虑状态变更或逻辑删除。

### 6. 批量更新（优先 updateMany，失败则逐条）

```javascript
try {
  await models[MODEL].updateMany({
    data: {
      status: '3',
    },
    filter: {
      where: {
        status: {
          $eq: '2',
        },
      },
    },
  });
} catch (e) {
  console.warn('updateMany 执行失败，降级为逐条更新：', e.message);

  for (const row of records) {
    await models[MODEL].update({
      data: {
        status: '3',
      },
      filter: {
        where: {
          _id: {
            $eq: row._id,
          },
        },
      },
    });
  }
}
```

注意：
- `updateMany` 必须先确认当前模型和 SDK 版本支持。
- 不要假设所有模型都支持批量更新。
- 降级时记录失败的数据 ID，避免一条失败导致后续全部停止。
- 逐条更新前确认查询条件和更新条件一致，防止误更新。
- 不要把 `updateMany` 的异常一律理解为接口不存在，也可能是参数或数据问题。

---

## Filter 运算符速查

常用查询条件：

| 运算符 | 含义 | 示例 |
|---|---|---|
| `$eq` | 等于 | `{ status: { $eq: '1' } }` |
| `$ne` | 不等于 | `{ status: { $ne: '1' } }` |
| `$in` | 在数组中 | `{ status: { $in: ['1', '2'] } }` |
| `$nin` | 不在数组中 | `{ status: { $nin: ['1', '2'] } }` |
| `$gt` | 大于 | `{ amount: { $gt: 100 } }` |
| `$gte` | 大于等于 | `{ amount: { $gte: 100 } }` |
| `$lt` | 小于 | `{ amount: { $lt: 100 } }` |
| `$lte` | 小于等于 | `{ amount: { $lte: 100 } }` |
| `$and` | 同时满足 | 多个条件组合 |
| `$or` | 满足其中一个 | 多个条件组合 |

空值、模糊查询等运算符，应以当前模型 API 文档和实际运行结果为准，不要将其他 SDK 的操作符直接套用进来。

组合查询示例：

```javascript
filter: {
  where: {
    $and: [
      {
        status: {
          $in: ['1', '2'],
        },
      },
      {
        'E-date': {
          $lt: Date.now(),
        },
      },
    ],
  },
},
```

---

## 分页查询

单页最多查询 200 条。需要处理全部数据时，使用分页循环：

```javascript
const pageSize = 200;
let pageNumber = 1;
let allRecords = [];

while (true) {
  const result = await models[MODEL].list({
    filter: {
      where: {
        status: {
          $eq: '1',
        },
      },
    },
    select: {
      $master: true,
    },
    pageSize,
    pageNumber,
  });

  const records = result?.data?.records || result?.records || [];

  allRecords = allRecords.concat(records);

  if (records.length < pageSize) {
    break;
  }

  pageNumber++;
}
```

注意：
- 不要一次性查询大量数据。
- 数据量较大时，优先分批处理，避免云函数执行超时。
- 如果处理过程中会改变查询条件涉及的字段，要注意分页数据发生变化导致的漏处理或重复处理。
- 大批量任务可以采用固定批次、游标或先查询 ID 再处理的方式。

---

## 关联与副作用

### 1. 读取关联字段

关联字段可能返回对象、数组或字符串，读取时兼容不同结构：

```javascript
const empId =
  row.employee_id?._id ||
  row.employee_id?.[0]?._id ||
  row.employee_id;
```

如果关联字段为空，需要单独处理，不能直接假设一定存在 `_id`。

### 2. 更新关联字段

```javascript
await models[MODEL].update({
  data: {
    employee_id: {
      _id: empId,
    },
  },
  filter: {
    where: {
      _id: {
        $eq: id,
      },
    },
  },
});
```

关联字段写入时，按照模型定义要求传递对象结构，不要直接把关联记录的展示名称当作关联 ID。

### 3. 跨表更新

```javascript
// 更新主表
await models['V_application'].update({
  data: {
    status: '3',
  },
  filter: {
    where: {
      _id: {
        $eq: applicationId,
      },
    },
  },
});

// 更新关联表
await models['V_number'].update({
  data: {
    status: '3',
  },
  filter: {
    where: {
      _id: {
        $eq: numberId,
      },
    },
  },
});
```

注意：
- 更新关联表状态时，单独调用对应模型的 `update`。
- 一条主记录发生变化后，检查相关从表、关联表是否需要同步处理。
- 跨表操作不是天然事务，不能假设主表和关联表会一起成功。
- 对于重要业务，记录每一步执行结果，必要时设计失败补偿机制。

---

## 完整批量定时任务示例

下面是一个可复用的定时状态更新模板：

```javascript
const cloudbase = require('@cloudbase/node-sdk');

const app = cloudbase.init({
  env: cloudbase.SYMBOL_CURRENT_ENV,
});

const MODEL = 'VU_Application';

exports.main = async (event, context) => {
  const models = app.models;

  const result = {
    ok: true,
    scanned: 0,
    updated: 0,
    errors: [],
    runAt: new Date().toISOString(),
  };

  try {
    const listRes = await models[MODEL].list({
      filter: {
        where: {
          $and: [
            {
              status: {
                $in: ['1', '2'],
              },
            },
            {
              'E-date': {
                $lt: Date.now(),
              },
            },
          ],
        },
      },
      select: {
        $master: true,
      },
      pageSize: 200,
      getCount: true,
    });

    const records = listRes?.data?.records || listRes?.records || [];

    result.scanned = records.length;

    for (const row of records) {
      try {
        await models[MODEL].update({
          data: {
            status: '3',
          },
          filter: {
            where: {
              _id: {
                $eq: row._id,
              },
            },
          },
        });

        result.updated++;
      } catch (e) {
        result.errors.push({
          id: row._id,
          message: e.message,
        });
      }
    }

    result.ok = result.errors.length === 0;
    return result;
  } catch (e) {
    console.error('定时任务执行失败：', e);

    return {
      ...result,
      ok: false,
      message: e.message || '任务执行失败',
    };
  }
};
```

说明：
- 示例使用逐条更新，兼容性更稳妥。
- 确认当前模型支持 `updateMany` 后，可以替换为批量更新。
- 示例只处理第一页，实际大数据量任务必须增加分页。
- 状态变更前应确认业务条件，避免重复执行产生副作用。

---

## 返回结构（固定）

便于日志、告警和调用方处理，建议统一返回：

```javascript
return {
  ok: true,
  scanned: records.length,  // 扫描数量
  updated: updatedCount,    // 成功更新数量
  errors: [],               // 可选，部分失败时记录
  runAt: new Date().toISOString(),
};
```

异常返回：

```javascript
return {
  ok: false,
  message: e.message || '执行失败',
  runAt: new Date().toISOString(),
};
```

注意：
- `scanned` 表示实际扫描数量，不是数据库总记录数。
- `updated` 表示成功更新数量，不是计划更新数量。
- 部分失败时，建议 `ok: false`，并保留具体失败记录。
- 返回值中不要包含敏感信息。

---

## 常用 API 速查

| API | 用途 | 说明 |
|---|---|---|
| `models[NAME].list()` | 查询列表 | 常用，支持筛选和分页 |
| `models[NAME].get()` | 查询单条 | 使用前确认当前模型接口支持 |
| `models[NAME].create()` | 新增记录 | 传入 `data` |
| `models[NAME].update()` | 更新记录 | 通过 `filter.where` 筛选 |
| `models[NAME].delete()` | 删除记录 | 注意物理删除风险 |
| `models[NAME].updateMany()` | 批量更新 | 先确认支持，准备逐条降级 |

其他批量接口，例如 `createMany`、`deleteMany`、`upsert`，以及 SQL 执行接口，不要仅凭其他 CloudBase SDK 的文档推断当前微搭模型支持。确有需求时，先检查当前项目 SDK 类型声明或实际运行验证。

---

## 与前端方法的差异

| 对比项 | 自定义方法（前端） | 云函数（本技能） |
|---|---|---|
| 入口 | `export default async function ({ event, data })` | `exports.main = async (event, context) => {}` |
| 数据访问 | `$w.cloud.callDataSource({...})` | `app.models[NAME].list/update/...` |
| 提示用户 | `$w.utils.showToast` | return，由调用方处理 |
| 运行环境 | 微搭运行时（浏览器/小程序） | Node.js 云函数 |
| 环境初始化 | 使用微搭运行时上下文 | `SYMBOL_CURRENT_ENV` |
| 批量更新 | 按前端数据源 API 实现 | 优先确认 `updateMany`，否则逐条更新 |

---

## 产出检查清单

- [ ] 使用 `@cloudbase/node-sdk` 初始化。
- [ ] 使用 `SYMBOL_CURRENT_ENV`。
- [ ] 数据源名称与模型标识一致。
- [ ] list 结果兼容 `data.records` 和 `records`。
- [ ] `pageSize` 不超过 200。
- [ ] 大数据量使用分页或分批处理。
- [ ] 批量更新确认接口支持，并有逐条降级路径。
- [ ] 返回 `{ ok, scanned, updated, runAt }` 等统一结构。
- [ ] 关联表状态更新没有遗漏。
- [ ] 定时任务具备幂等性。
- [ ] 部分失败有错误记录。
- [ ] 异常返回 `{ ok: false, message }`，同时保留服务端日志。
- [ ] 不信任前端传入的用户身份和权限信息。

---

## 通用约定

1. **数据源名称**：使用常量 `const MODEL = '...'`，并与微搭模型标识核对。
2. **状态枚举**：优先使用项目约定的字符串状态值，例如 `'1'` 草稿、`'2'` 已提交；具体以选项集定义为准。
3. **批量操作**：不要假设一定有 `updateMany`，必须准备降级方案。
4. **定时任务**：保证幂等，同一批数据重复执行不应产生重复副作用。
5. **数据安全**：不要信任前端传入的用户 ID、角色或权限信息。
6. **跨表操作**：明确主表、关联表的更新顺序和失败补偿方式。
7. **业务口径**：以项目确认结果为准，在关键代码处标注注释。
8. **接口准确性**：优先使用本技能中明确列出的 API；不确定的接口先核实，不要自行编造。

---

## 与其他技能的协作

| 需求 | 使用技能 |
|---|---|
| 写云函数 | `weda-cloud-function` |
| 前端调用云函数 `$w.cloud.callFunction` | `weda-custom-method` |
| 前端按钮事件、表单提交 | `weda-custom-method` |
| 自定义 JSX 组件 | `weda-component-jsx` |
| 数据模型与关联关系设计 | 对应的数据模型技能 |

完整 Filter 与关联字段说明见 `references/api-cloud.md`。