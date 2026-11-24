# 微搭内置组件 API 完整参考

> 写自定义方法时查组件实例的方法与属性。
> `$w` 后面是组件实例 id（如 `listView1`），不是类型名。

---

## 三、ListView（数据列表）

- 官方文档：https://docs.cloudbase.net/lowcode/components/wedaUI/src/docs/compsdocs/database/ListView  
- 类型名：`ListView`  
- 实例访问：`$w.<组件id>`（如 `$w.listView1`）

### 3.1 用途

从数据源（数据模型、Query、表达式）查询多条数据并循环展示；支持分页、筛选、排序。也可作为数据提供器给内部业务组件使用。

### 3.2 方法 API（自定义代码重点）

| 方法标识 | 参数 | 说明 |
|----------|------|------|
| `refresh` | `string` 可选。<br>`refreshFromStart`：从第 1 页刷新<br>`refreshKeepPage`：保留当前页刷新 | 刷新列表数据 |
| `deleteOne` | `string`，要删除行的 `_id` | 删除列表中的单条数据 |

#### 调用示例

```javascript
// 保存成功后从首页刷新
if ($w.listView1?.refresh) {
  await $w.listView1.refresh('refreshFromStart');
}

// 保留当前页
await $w.listView1.refresh('refreshKeepPage');
// 或不传参
await $w.listView1.refresh();

// 删除一条（参数为记录 _id）
await $w.listView1.deleteOne(recordId);
```

### 3.3 属性 API（与数据 / 分页相关）

样式类属性从略，下表为数据与分页相关。

| 属性标识 | 类型 | 默认值 | 说明 |
|----------|------|--------|------|
| `template` | string | - | 列表模板，如 `simpleList` |
| `dataSourceType` | string | - | 数据源类型，如 `data-model` |
| `datasource` | object | - | 数据模型来源 |
| `dataSourceData` | array | - | 表达式数据；数组项需含 `_id` |
| `queryCondition` | array | - | 数据筛选条件，支持 fx |
| `orderBy` | string | - | 排序字段名 |
| `orderType` | string | - | `asc` / `desc` |
| `isSupportMultipleSort` | boolean | false | 是否多字段排序 |
| `sorter` | array | - | 多字段排序，如 `[{"orderBy":"updatedAt","orderType":"desc"}]` |
| `selectFieldType` | string | `main` | `all` 全部 / `main` 本表 / `custom` 自定义 |
| `selectFields` | array | - | 自定义查询字段 |
| `pagination` | string | - | 分页方式，如 `loadMoreButton` |
| `loadButtonText` | string | - | 加载更多按钮文案 |
| `pageSize` | number | - | 每页条数 |
| `pageIndex` | number | 1 | 初始页码 |
| `enableTotal` | boolean | false | 启用动态分页（后端分页） |
| `total` | number | - | 数据总条数 |
| `emptyText` | string | - | 空状态文案 |
| `loadCompletedText` | string | `""` | 加载到底提示 |
| `isSetLoading` | boolean | true | 是否显示加载状态 |
| `isSetStatus` | boolean | false | 是否显示异常状态 |
| `loading` | boolean | - | 加载中状态 |

**已下架（新页面勿用）：**  
`bindConnectMetadata`、`connectorMethod`、`connectorParams`（APIs 绑定，v2.30.0 起下线）。

### 3.4 事件（绑定自定义方法时的出参）

| 事件标识 | 出参 | 说明 |
|----------|------|------|
| `queryEmpty` | - | 查询结果为空 |
| `querySuccess` | - | 查询成功 |
| `queryFail` | `error`：`requestid`、`message`、`code`、`original` | 查询失败 |
| `onPagingChange` | `query`：`pageNo`、`pageSize` | 分页变化 |

### 3.5 推荐用法：增删改后刷新

```javascript
export default async function ({ event, data }) {
  try {
    // ... wedaCreateV2 / wedaUpdateV2 / wedaDeleteV2 ...

    if ($w.listView1?.refresh) {
      await $w.listView1.refresh('refreshFromStart');
    }
    $w.utils.showToast({ title: '操作成功', icon: 'success', duration: 2000 });
  } catch (error) {
    console.error('操作失败:', error);
    $w.utils.showToast({
      title: error?.message || '操作失败',
      icon: 'error',
      duration: 2000
    });
  }
}
```

### 3.6 表达式 + Query 动态分页（官方推荐）

1. Query 触发方式设为「入参变化时自动执行」。  
2. Query 的 `pageSize`、`pageNo` 与 ListView 对应属性绑定。  
3. 开启返回 `total`；ListView 的 `total` 绑定 `query1.data.total`。  
4. 加载更多时合并：`[...已有 records, ...query 新 records]`。  
5. 自 v2.30.0 起用 **表达式 + Query**，不要再用已下架 APIs 绑定。

### 3.7 注意点

1. **`_id` 必填**：表达式数组或 records 中每项必须有文本类型 `_id`，否则分页、`deleteOne` 会异常。  
2. **字段查询范围**：默认 `main`（本表）；需要关联表字段再用 `all` 或 `custom`。  
3. **组件 id**：以页面大纲为准，确认未被改名。  
4. **refresh 参数**：筛选变更、新增后用 `refreshFromStart`；仅刷新当前页用 `refreshKeepPage`。

---

## 四、WdForm（表单容器）

- 官方文档：https://docs.cloudbase.net/lowcode/components/wedaUI/src/docs/compsdocs/database/Form  
- 类型名：`WdForm`  
- 中文名：表单容器  
- 实例访问：`$w.<组件id>`（如 `$w.form1`、`$w.formDept`）

### 4.1 用途

快捷实现表单数据的提交与展示。绑定数据源后可按字段类型生成输入控件；支持 **新增 / 更新 / 查看** 场景。自定义方法里最常用：赋值、清空、校验、提交。

### 4.2 方法 API（自定义代码重点）

| 方法标识 | 参数 | 说明 |
|----------|------|------|
| `setValue` | `{ value: object }`，对象的 key 对应表单字段 | 设置表单值 |
| `submit` | 无 | 触发表单提交 |
| `clearValue` | `{ isImmediate?: boolean }` 可选，是否立即清空（防抖相关） | 清空表单值 |
| `clearValidate` | 无 | 清空校验状态 |
| `validate` | 无 | 触发表单校验（不自动提交） |
| `disableSubmit` | 无 | 禁用提交按钮 |
| `enableSubmit` | 无 | 启用提交按钮 |

#### 调用示例

```javascript
// 编辑回填
$w.form1.setValue({
  value: {
    name: '张三',
    code: 'D001',
    sort: 10,
    status: '启用'
  }
});

// 新建前清空
$w.form1.clearValue();
// 或立即清空
$w.form1.clearValue({ isImmediate: true });

// 先校验再业务提交（若不用组件自带提交）
await $w.form1.validate();

// 触发表单容器内置提交
$w.form1.submit();

// 防重复提交
$w.form1.disableSubmit();
// ... 异步保存完成后
$w.form1.enableSubmit();
```

### 4.3 属性 API（与数据 / 场景相关）

| 属性标识 | 类型 | 默认值 | 说明 |
|----------|------|--------|------|
| `formType` | string | `"create"` | 场景：`create` 新增 / `edit` 更新 / `read` 查看 |
| `datasourceType` | string | `"model"` | 数据源：`model` 或 APIs |
| `dataSourceName` | string | `""` | 绑定的数据模型名称 |
| `fields` | array | - | 字段管理：顺序、显隐、组件类型 |
| `_id` | string | `""` | 编辑/查看时的数据标识 |
| `value` | object | - | 当前表单值；可读 `$w.form1.value` |
| `methodGetItem` | string | `""` | APIs 时查询单条方法 |
| `paramGetItem` | object | `{}` | 查询入参 |
| `methodCreate` | string | `""` | APIs 时新增方法 |
| `methodUpdate` | string | `""` | APIs 时更新方法 |
| `colNum` | string | `"1"` | PC 端表单列数 |
| `lgWidth` | string | `"hundred"` | PC 端组件宽度 |
| `layout` | string | `"horizontal"` | 标题布局：`horizontal` 左右 / `vertical` 上下 |

只读相关：可用 `isDisabledSubmit` 判断提交按钮是否禁用（以运行时实际暴露为准）。

### 4.4 事件（绑定自定义方法时的出参）

| 事件标识 | 出参（event.detail） | 说明 |
|----------|----------------------|------|
| `submit` | - | 提交事件（兼容三端） |
| `validateSuccess` | `errors` 对象 | 校验成功 |
| `validateFail` | `errors` 对象 | 校验失败 |
| `queryEmpty` | `data` | 查询为空 |
| `querySuccess` | `data` | 查询成功 |
| `queryFail` | `error`：`requestid`、`message`、`code`、`original` | 查询失败 |

### 4.5 推荐用法：自定义方法接管保存

很多业务页 **不用** 表单容器自动绑定的 create/update，而是在自定义方法里读表单值再 `wedaCreateV2` / `wedaUpdateV2`：

```javascript
export default async function ({ event, data }) {
  try {
    // 方式 A：submit 事件里取数（若绑定了表单 submit）
    // 方式 B：直接读当前值
    const formData = $w.form1.value;
    // 或部分版本 / 场景：
    // const formData = $w.form1.submitParams?.data;

    if (!formData || !(formData.name || '').trim()) {
      $w.utils.showToast({ title: '请填写名称', icon: 'error', duration: 2000 });
      return;
    }

    $w.form1.disableSubmit?.();

    await $w.cloud.callDataSource({
      dataSourceName: 'ct_dept',
      methodName: 'wedaCreateV2',
      params: { data: { name: formData.name.trim(), /* ... */ } }
    });

    $w.form1.clearValue?.();
    if ($w.listView1?.refresh) {
      await $w.listView1.refresh('refreshFromStart');
    }
    $w.utils.showToast({ title: '保存成功', icon: 'success', duration: 2000 });
  } catch (error) {
    console.error('保存失败:', error);
    $w.utils.showToast({
      title: error?.message || '保存失败',
      icon: 'error',
      duration: 2000
    });
  } finally {
    $w.form1.enableSubmit?.();
  }
}
```

打开编辑弹窗时回填：

```javascript
$w.form1.setValue({
  value: {
    name: current.name,
    code: current.code,
    sort: current.sort,
    status: current.status
  }
});
// 如需切换场景
// $w.form1.formType = 'edit';
```

### 4.6 注意点

1. **`setValue` 参数形态**：官方为 `$w.form1.setValue({ value: { ...字段 } })`，不要漏外层 `value`。  
2. **`value` 可读**：运行中可用 `$w.form1.value` 取当前表单对象。  
3. **`validate` 与 `submit`**：`validate()` 只校验；真正提交还要 `submit()` 或自己写数据源调用。  
4. **防重复提交**：提交前 `disableSubmit`，结束在 `finally` 里 `enableSubmit`。  
5. **formType**：`create` / `edit` / `read` 切换会影响内置提交行为与是否可编辑。  
6. **APIs 数据源**：入参/出参字段需平铺在根节点，否则映射失败。  
7. **clearValidate**：动态改字段规则后，可先清校验状态再重新 `validate`。

---

## 五、WdTable（数据表格）

- 官方文档：https://docs.cloudbase.net/lowcode/components/wedaUI/src/docs/compsdocs/database/WdTable  
- 类型名：`WdTable`  
- 中文名：数据表格  
- 实例访问：`$w.<组件id>`（如 `$w.table1`、`$w.tableChildDept`）

### 5.1 用途

以表格展示多行数据，支持排序、搜索、分页、列配置、行选择与操作列。自定义方法里最常用：**刷新、清空选中、按 id 选中、删行**。

### 5.2 方法 API（自定义代码重点）

| 方法标识 | 参数 | 说明 |
|----------|------|------|
| `refresh` | 无 | 刷新并回到 **第 1 页** |
| `refreshKeepPage` | 无 | 刷新并 **保留当前页** |
| `clearSelection` | 无 | 清空所有选中行 |
| `setSelectedKeys` | `{ selectedKeys: string[], recordKey?: string }` | 按主键批量设置选中 |
| `deleteOne` | `string` 记录标识（一般为 `_id`） | 删除单条（仅数据模型） |
| `deleteSelected` | 无 | 删除所有选中行（仅数据模型） |
| `resetFilter` | 无 | 重置筛选器到初始状态 |
| `import` | 无 | 导入 Excel（仅数据模型） |
| `export` | 无 | 导出当前选中行为 Excel |
| `exportOptionalMode` | 无 | 导出可选：全部 / 筛选后 / 选中 |
| `openOperationDialog` | 无 | 打开操作列弹窗（仅移动端） |

#### 调用示例

```javascript
// 新增/编辑成功后回到第一页
if ($w.table1?.refresh) {
  await $w.table1.refresh();
}

// 仅刷新当前页数据
await $w.table1.refreshKeepPage();

// 清空选中
$w.table1.clearSelection();

// 按 _id 选中多行
$w.table1.setSelectedKeys({
  selectedKeys: ['667b9f2c8d5e4a001c2f3a5b', '667b9f2c8d5e4a001c2f3a6c']
});

// 删一行（数据模型场景）
await $w.table1.deleteOne(rowId);

// 删选中行
await $w.table1.deleteSelected();
```

### 5.3 属性 API（与数据 / 分页 / 选择相关）

| 属性标识 | 类型 | 默认值 | 说明 |
|----------|------|--------|------|
| `dataSourceType` | string | - | 数据源类型，如 `data-model` |
| `bindMetadata` | object | - | 数据模型绑定 |
| `dataSourceData` | array | - | 表达式数据（数组） |
| `recordKey` | string | - | 数据主键，影响选择/编辑，常用 `_id` |
| `loading` | boolean | - | 加载中状态 |
| `queryCondition` | array | - | 数据筛选 |
| `orderType` | string | `desc` | 单字段排序方向 `asc` / `desc` |
| `isSupportMultipleSort` | boolean | false | 多字段排序 |
| `sorter` | array | - | 排序规则，如 `[{"orderBy":"updatedAt","orderType":"desc"}]` |
| `filterFields` | object | - | 运行态筛选器配置 |
| `selectFieldType` | string | `table` | `all` / `table` / `custom` |
| `selectFields` | array | - | 自定义查询字段 |
| `columnSets` | array | - | 列管理 |
| `columnSelectType` | string | `select` | 选择列样式 |
| `rowDisabled` | object | - | 按记录禁用行选择 |
| `emptyText` | string | `暂无数据` | 空状态文案 |
| `rowColor` | string | - | 行背景，可绑方法 |
| `enablePagination` | boolean | true | 是否显示分页 |
| `defaultPageSize` | number | 10 | 默认每页行数 |
| `defaultPageIndex` | number | 1 | 默认页码 |
| `enableTotal` | boolean | false | 启用服务端分页 |
| `total` | number | - | 总条数（服务端分页必配） |

**只读属性（运行时可直接读）：**

| 属性标识 | 说明 |
|----------|------|
| `records` | 当前页数据 |
| `total` | 总数 |
| `pageNo` | 当前页码 |
| `pageSize` | 每页条数 |
| `selectedRecords` | 已选中行数据 |
| `sort` | 当前排序（请求用） |
| `filter` | 当前筛选（请求用） |
| `filterConfig` | 筛选面板配置 |
| `value` | 行数据实时值（含自定义插槽内表单） |

### 5.4 事件（绑定自定义方法时的出参）

| 事件标识 | event.detail | 说明 |
|----------|--------------|------|
| `tabTableRow` | `record`、`rowKey`、`recordIndex` | 点击行 |
| `cellClick` | `record`、`column`、`rowKey`、`recordIndex`、`columnIndex` | 点击单元格 |
| `rowsSelected` | `data`（选中行数组） | 选中行变化（请用这个） |
| `rowsSelect` | - | **已废弃**，改用 `rowsSelected` |
| `querySuccess` | `data.query` | 查询成功（含分页/筛选变化） |
| `queryEmpty` | `data.query` | 查询为空 |
| `queryFail` | `error`（requestid/message/code/original） | 查询失败 |
| `sort` | `sort` 数组 | 点击表头排序 |
| `onRefreshBtnClick` | - | 点击刷新按钮 |
| `onPagingChange` | `query.pageIndex`、`pageSize` | 分页变化 |
| `onFilterChange` | `searchValues`、`filterConfig` | 筛选值变化 |

### 5.5 推荐用法：保存后刷新表格

```javascript
export default async function ({ event, data }) {
  try {
    // ... wedaCreateV2 / wedaUpdateV2 ...

    if ($w.table1?.refresh) {
      await $w.table1.refresh(); // 回第 1 页
    }
    // 若希望停在当前页：
    // await $w.table1.refreshKeepPage();

    $w.utils.showToast({ title: '保存成功', icon: 'success', duration: 2000 });
  } catch (error) {
    console.error('保存失败:', error);
    $w.utils.showToast({
      title: error?.message || '保存失败',
      icon: 'error',
      duration: 2000
    });
  }
}
```

读取选中行做批量操作：

```javascript
const rows = $w.table1.selectedRecords || [];
if (!rows.length) {
  $w.utils.showToast({ title: '请先选择数据', icon: 'error', duration: 2000 });
  return;
}
// rows.forEach ...
```

自定义插槽内表单实时值：

```javascript
const tableValue = $w.table1.value; // 所有行
const rowValue = $w.table1.cell_xxx.rowValue; // 某插槽所在行
```

### 5.6 注意点

1. **`refresh` vs `refreshKeepPage`**：前者固定回第 1 页；筛选项变更、新增后常用 `refresh`；原地更新用 `refreshKeepPage`。  
2. **`recordKey`**：默认按 `_id` 选择；表达式数据源必须保证主键字段与 `recordKey` 一致。  
3. **`deleteOne` / `deleteSelected` / 导入导出**：主要面向 **数据模型** 绑定；纯表达式数据源不要依赖这些方法删库。  
4. **服务端分页**：`enableTotal = true` 时必须正确设置 `total`，否则页码错误。  
5. **选中事件**：用 `rowsSelected`，不要用已废弃的 `rowsSelect`。  
6. **APIs 绑定已下架**：v2.30.0 后用表达式 + Query。  
7. **与 ListView 对比**：表格能力更全（列、选择、导出）；列表更偏循环卡片/简单列表。部门下级列表、人员列表等 B 端后台优先 WdTable。

---

## 六、WdModal（弹窗）

- 官方文档：https://docs.cloudbase.net/lowcode/components/wedaUI/src/docs/compsdocs/grid/WdModal  
- 类型名：`WdModal`  
- 中文名：弹窗  
- 实例访问：`$w.<组件id>`（如 `$w.modal1`、`$w.modalDept`）

### 6.1 用途

基础对话框展示。自定义方法里几乎只用两件事：**打开**、**关闭**。常与表单容器搭配：打开弹窗 → `setValue` 回填 → 保存后 `close`。

### 6.2 方法 API（自定义代码重点）

| 方法标识 | 参数 | 说明 |
|----------|------|------|
| `open` | `object info` 可选，透传信息 | 打开弹窗 |
| `close` | `object info` 可选，透传信息 | 关闭弹窗 |

#### 调用示例

```javascript
// 打开（可无参）
$w.modal1.open();

// 打开并透传上下文（编辑哪一条等）
$w.modal1.open({ mode: 'edit', id: rowId });

// 关闭
$w.modal1.close();

// 关闭并带结果
$w.modal1.close({ confirm: true });
```

打开后可读最近一次透传：

```javascript
const info = $w.modal1.openInfo; // 最近一次 open 传入的对象
const closeInfo = $w.modal1.closeInfo;
```

### 6.3 属性 API

| 属性标识 | 类型 | 默认值 | 说明 |
|----------|------|--------|------|
| `defaultShow` | boolean | - | 进入页面时是否默认打开；业务弹窗一般设为 `false`，由代码 `open` |
| `template` | string | - | 预设模板，如 `default` |
| `position` | string | - | 移动端位置：`bottom` 底部 / `center` 居中 |
| `closeType` | array | - | 关闭方式：`mask` 点遮罩、`esc` 按 ESC（仅 PC） |
| `defaultMaskShow` | boolean | - | 是否显示遮罩 |

**只读属性：**

| 属性标识 | 说明 |
|----------|------|
| `modalState` | 当前弹窗状态 |
| `openInfo` | 最近一次 `open` 的透传参数 |
| `closeInfo` | 最近一次 `close` 的透传参数 |

### 6.4 事件

| 事件标识 | event.detail | 说明 |
|----------|--------------|------|
| `open` | `info`（即调用 open 时传入的对象） | 弹窗打开时 |
| `close` | `info`（即调用 close 时传入的对象） | 弹窗关闭时 |

可在编辑器把「打开」事件绑到自定义方法，用 `event.detail` / `openInfo` 做回填。

### 6.5 推荐用法：新建 / 编辑弹窗

```javascript
// 打开新建
export default async function ({ event, data }) {
  try {
    $w.page.dataset.state.formMode = 'create';
    if ($w.form1?.clearValue) $w.form1.clearValue();
    $w.modal1.open({ mode: 'create' });
  } catch (error) {
    console.error('打开弹窗失败:', error);
    $w.utils.showToast({
      title: error?.message || '打开失败',
      icon: 'error',
      duration: 2000
    });
  }
}

// 打开编辑并回填
export default async function ({ event, data }) {
  try {
    const row = event?.detail?.record || data;
    $w.page.dataset.state.formMode = 'edit';
    $w.page.dataset.state.editingId = row._id;
    $w.form1.setValue({
      value: {
        name: row.name,
        code: row.code
      }
    });
    $w.modal1.open({ mode: 'edit', id: row._id });
  } catch (error) {
    console.error('打开编辑失败:', error);
    $w.utils.showToast({
      title: error?.message || '打开失败',
      icon: 'error',
      duration: 2000
    });
  }
}

// 保存成功后关闭
if ($w.modal1?.close) $w.modal1.close();
```

### 6.6 注意点

1. **默认不要开着**：`defaultShow` 设为 false，统一用 `open`/`close` 控制。  
2. **`open`/`close` 可传对象**：用 `openInfo` / `closeInfo` 或打开事件取回，避免再靠全局变量传 id（也可用页面变量双保险）。  
3. **`esc` 仅 PC 有效**：移动端不能依赖 ESC 关闭。  
4. **与表单配合顺序**：先 `setValue` / `clearValue`，再 `open`（或 open 事件里 setValue），避免用户看到闪一下的空表。  
5. **遮罩关闭**：若表单未保存不允许点遮罩关掉，从 `closeType` 去掉 `mask`，只保留底部取消按钮调用 `close`。

---

## 七、WdTopTab（顶部选项卡）

- 官方文档：https://docs.cloudbase.net/lowcode/components/wedaUI/src/docs/compsdocs/navmenu/WdTopTab  
- 类型名：`WdTopTab`  
- 中文名：顶部选项卡  
- 实例访问：`$w.<组件id>`（如 `$w.topTab1`）

### 7.1 用途

顶部多标签切换。常见用法：

1. **按状态/分类筛列表**（待处理 / 已处理）  
2. **同一页切换不同内容区**（开启多插槽，类似简易导航）  

自定义方法里：读当前选中值，或代码切换到某一标签。

### 7.2 方法 API（自定义代码重点）

| 方法标识 | 参数 | 说明 |
|----------|------|------|
| `selectTab` | `{ value: string }` | 程序设置当前选中标签（value 须在 list 中存在） |

```javascript
$w.topTab1.selectTab({ value: '待处理' });
$w.topTab1.selectTab({ value: '2' });
```

### 7.3 属性 API

| 属性标识 | 类型 | 默认值 | 说明 |
|----------|------|--------|------|
| `list` | array | - | 标签列表，见下方结构 |
| `selectedValue` | string | `"1"` | 当前选中标签的 value；可读 `$w.topTab1.selectedValue` |
| `isMultipleSlot` | boolean | false | 为 true 时按标签生成多个内容插槽；**此时 list 不能用动态表达式** |

**`list` 项常用字段：**

| 字段 | 说明 |
|------|------|
| `label` | 显示文案 |
| `value` | 唯一值（必唯一） |
| `isDisabled` | 是否禁用 |
| `slotKey` | 多插槽时与内容区对应 |
| `iconType` / `innerIcon` / `outerImage` / `iconPosition` | 图标相关（按需） |

```javascript
// list 示例
[
  { label: '待处理', value: '待处理', isDisabled: false },
  { label: '已处理', value: '已处理' }
]
```

### 7.4 事件

| 事件标识 | event.detail | 说明 |
|----------|--------------|------|
| `change` | `{ value: string }` | 选项卡切换（业务优先绑这个） |
| `tap` | - | 点击（通用点击，筛选逻辑更推荐 change） |

### 7.5 推荐用法

**切换标签后刷新列表：**

```javascript
export default async function ({ event, data }) {
  try {
    const value = event?.detail?.value ?? $w.topTab1.selectedValue;
    $w.page.dataset.state.tabStatus = value;
    // 列表/表格按页面变量或 selectedValue 做筛选后刷新
    if ($w.table1?.refresh) {
      await $w.table1.refresh();
    }
  } catch (error) {
    console.error('切换选项卡失败:', error);
    $w.utils.showToast({
      title: error?.message || '切换失败',
      icon: 'error',
      duration: 2000
    });
  }
}
```

**表达式筛条件（编辑器配置）：**  
列表查询条件中引用 `$w.topTab1.selectedValue`（如 status 等于该值）。

**动态标签（关闭多插槽时）：**

```javascript
// 由查询结果生成
$w.topTab1.list = ($w.query1.data.records || []).map((item) => ({
  label: item.name,
  value: item.code
}));
```

**多插槽模式：**  
`isMultipleSlot = true`，大纲中每个标签下有独立插槽，切换只显示对应内容。标签必须静态配置。

### 7.6 注意点

1. **`value` 必须唯一**，否则选中状态会乱。  
2. **`isMultipleSlot === true` 时，`list` 不能动态绑定表达式**，只能静态标签。  
3. 业务筛选优先监听 **`change`**，用 `event.detail.value` 或 `$w.topTab1.selectedValue`。  
4. 代码切页用 `selectTab({ value })`，不要只改展示文案。  
5. 与审批中心「待办 / 已办 / 我发起」等状态切换场景高度匹配。

---

## 八、WdSideTab（侧边选项卡）

- 官方文档：https://docs.cloudbase.net/lowcode/components/wedaUI/src/docs/compsdocs/navmenu/WdSideTab  
- 类型名：`WdSideTab`  
- 中文名：侧边选项卡  
- 实例访问：`$w.<组件id>`（如 `$w.sideTab1`）

### 8.1 用途

提供 **左侧纵向** 选项卡布局，切换多个标签。能力模型与顶部选项卡（WdTopTab）基本一致，差别主要在布局方向：

| 对比 | WdTopTab | WdSideTab |
|------|----------|-----------|
| 方向 | 顶部横向 | 侧边纵向 |
| API | `list` / `selectedValue` / `selectTab` / `change` | 相同 |
| 典型场景 | 状态筛选条 | 页面内「侧边导航」分栏 |

### 8.2 方法 API（自定义代码重点）

| 方法标识 | 参数 | 说明 |
|----------|------|------|
| `selectTab` | `{ value: string }` | 程序设置当前选中标签 |

```javascript
$w.sideTab1.selectTab({ value: '1' });
$w.sideTab1.selectTab({ value: '待处理' });
```

### 8.3 属性 API

| 属性标识 | 类型 | 默认值 | 说明 |
|----------|------|--------|------|
| `list` | array | - | 侧边标签列表，结构见下 |
| `selectedValue` | string | `"1"` | 当前选中 value；读 `$w.sideTab1.selectedValue` |
| `isMultipleSlot` | boolean | false | 开启后大纲生成多个内容插槽，实现侧边导航切内容；**开启后 list 不支持动态表达式** |

**`list` 项结构示例：**

```javascript
[
  {
    label: '标签1',
    value: '1',
    iconType: 'none',
    innerIcon: '',
    outerImage: '',
    iconPosition: 'prefix', // 图标在文字前；可后置
    isDisabled: false,
    slotKey: '1'
  },
  { label: '标签2', value: '2', isDisabled: false, slotKey: '2' }
]
```

说明：`value` 必须唯一；作筛选入参时，value 要与数据源字段取值一致。

### 8.4 事件

| 事件标识 | event.detail | 说明 |
|----------|--------------|------|
| `change` | `{ value: string }` | 选项卡切换（业务优先） |
| `tap` | - | 点击 |

### 8.5 推荐用法

**侧边筛选列表（关闭多插槽）：**

```javascript
// change 事件
export default async function ({ event, data }) {
  try {
    const value = event?.detail?.value ?? $w.sideTab1.selectedValue;
    $w.page.dataset.state.sideTabValue = value;
    if ($w.table1?.refresh) {
      await $w.table1.refresh();
    }
  } catch (error) {
    console.error('侧边选项卡切换失败:', error);
    $w.utils.showToast({
      title: error?.message || '切换失败',
      icon: 'error',
      duration: 2000
    });
  }
}
```

编辑器中列表筛选条件可直接绑：`$w.sideTab1.selectedValue`。

**侧边导航（开启多插槽）：**

1. `isMultipleSlot = true`  
2. 静态配置 `list`  
3. 在各插槽中放入不同区块（概览 / 里程碑 / 预算…）  
4. 切换标签只显示对应插槽  

**动态标签（须关闭多插槽）：**

```javascript
$w.sideTab1.list = ($w.query1.data.records || []).map((item) => ({
  label: item.ztmc,
  value: item.ztmc
}));
```

### 8.6 注意点

1. 与 WdTopTab 相同：**value 唯一**；**多插槽与动态 list 互斥**。  
2. 官方文档属性说明中有一处拼写 `selctedValue`，实际以运行时 **`selectedValue`** 为准。  
3. 小程序端若侧栏需要滚动，可能要外层加滚动容器（见官方常见问题）。  
4. 项目详情「多 Tab 工作台」若用组件实现：侧边用 WdSideTab 多插槽，或顶部用 WdTopTab，按布局选择即可，API 写法通用。

---

## 九、WdCalendar（日历）

- 官方文档：https://docs.cloudbase.net/lowcode/components/wedaUI/src/docs/compsdocs/show/WdCalendar  
- 类型名：`WdCalendar`  
- 中文名：日历  
- 实例访问：`$w.<组件id>`（如 `$w.calendar1`）

### 9.1 用途

日历平铺展示，例如考勤、日程。可对若干日期做置灰或打点标记；自定义方法里主要是 **设置选中日**、**切换展示年月**。

### 9.2 方法 API（自定义代码重点）

| 方法标识 | 参数 | 说明 |
|----------|------|------|
| `setValue` | `number` 时间戳（毫秒） | 设置选中日期 |
| `setInitMonth` | `number` 时间戳（毫秒） | 切换当前展示的年月 |

```javascript
// 选中某一天（示例时间戳需换成业务日期 0 点或业务约定）
$w.calendar1.setValue(1688140800000);

// 切换到该时间戳所在月
$w.calendar1.setInitMonth(1688140800000);

// 读当前选中
const ts = $w.calendar1.value;
```

### 9.3 属性 API

| 属性标识 | 类型 | 默认值 | 说明 |
|----------|------|--------|------|
| `initMonth` | number | - | 当前展示的年月（时间戳） |
| `value` | number | - | 当前选中日期（时间戳） |
| `start` | - | - | 最早可选日期 |
| `end` | - | - | 最晚可选日期 |
| `configData` | array | `[]` | 多日期特殊展示（置灰、打点等），见编辑器配置 |
| `initVisible` | boolean | true | 是否显示切换年月的操作按钮 |

日期相关字段在官方示例中以 **number 时间戳** 传入/读出，业务侧注意时区与「当天 0 点」约定。

### 9.4 事件

| 事件标识 | event.detail | 说明 |
|----------|--------------|------|
| `change` | `{ value: number }` | 选中日期变化 |
| `changeMonth` | `{ value: number }` | 切换展示年月 |

### 9.5 推荐用法

```javascript
// 选中日期后，按当天筛日程/考勤
export default async function ({ event, data }) {
  try {
    const ts = event?.detail?.value ?? $w.calendar1.value;
    $w.page.dataset.state.calendarDay = ts;
    // 转成 yyyy-MM-dd 再查库（按项目约定）
    if ($w.table1?.refresh) {
      await $w.table1.refresh();
    }
  } catch (error) {
    console.error('日历选中失败:', error);
    $w.utils.showToast({
      title: error?.message || '操作失败',
      icon: 'error',
      duration: 2000
    });
  }
}

// 代码跳到本月并选中今天
const now = Date.now();
$w.calendar1.setInitMonth(now);
$w.calendar1.setValue(now);
```

打点/置灰：在编辑器配置 `configData`，或按官方结构给数组（具体项字段以编辑器「展示配置」为准）。

### 9.6 注意点

1. **参数是时间戳 number**，不是 `'2024-01-01'` 字符串（除非后续版本扩展，以文档为准）。  
2. `setValue` 只改选中日；跨月展示还要 `setInitMonth`。  
3. 用 `start` / `end` 限制可选范围，避免选到无效区间。  
4. 与表单日期选择器不同：日历偏 **展示 + 点选**，适合考勤/日程面板，不替代所有表单日期字段。

---

## 十、WdTree（树）

- 官方文档：https://docs.cloudbase.net/lowcode/components/wedaUI/src/docs/compsdocs/show/WdTree  
- 类型名：`WdTree`  
- 中文名：树  
- 实例访问：`$w.<组件id>`（如 `$w.tree1`、`$w.treeDept`）

### 10.1 用途

多层级数据展示与选择，如 **组织架构、分类、物料**。部门管理左侧组织树即用此组件。

库表通常是扁平的 `parent_id`；组件要的是 **嵌套 JSON**。自定义方法负责：查表 → 拼树 → 赋给树的 `data`；点选后读 `treeInfo` 刷右侧详情。

### 10.2 节点数据格式（最重要）

每个节点必须是对象，常用 key：

| 字段 | 说明 |
|------|------|
| `label` | 显示名称 |
| `value` | 节点唯一标识（常用部门 `_id`） |
| `children` | 子节点数组 |
| `disabled` | 是否禁用 |
| `foldIcon` / `expendIcon` / `leafIcon` | 可选图标 URL（注意官方拼写是 expend） |

```javascript
[
  {
    label: '交付中心',
    value: 'dept_001',
    children: [
      { label: '研发部', value: 'dept_002', children: [] },
      { label: '测试部', value: 'dept_003' }
    ]
  }
]
```

把该数组赋给组件属性 **`data`**（编辑器称「树节点」），或绑页面变量 `$w.page.dataset.state.treeData`。

### 10.3 方法 API（自定义代码重点）

| 方法标识 | 参数 | 说明 |
|----------|------|------|
| `searchNode` | `{ searchKey: string }` | 按关键字搜索节点 |

```javascript
// 输入框失焦/回车时搜索
$w.tree1.searchNode({ searchKey: $w.inputSearch.value || '' });
```

选中、展开主要靠 **属性**（见下），不是再提供一堆 setSelected 方法名（以官方方法表为准；当前文档方法区以 `searchNode` 为主）。

### 10.4 属性 API（数据 / 选中 / 展开）

| 属性标识 | 类型 | 说明 |
|----------|------|------|
| `data` | array | 树节点数据（嵌套结构） |
| `checkable` | boolean | 是否显示复选框（多选） |
| `checkedCustom` | array | 选中节点的 value 列表，如 `["dept_002"]` |
| `expandType` | string | 展开方式：展开全部 / 不展开 / 自定义 |
| `expandCustom` | array | 自定义展开时的 value 列表 |
| `showIcon` | boolean | 是否显示节点图标 |
| `foldIcon` / `expendIcon` / `leafIcon` | string | 默认图标 |
| `line` | boolean | 是否显示连接线 |
| `isSupportSlot` | boolean | 是否开启插槽 |
| `enableSearchText` | boolean | 是否展示默认可搜索文本节点 |

**只读 / 运行时信息（官方「当前树信息」）：**

| 属性标识 | 说明 |
|----------|------|
| `treeInfo` | 用户操作后的树状态汇总对象 |
| `treeNodeList` | 扁平化节点列表 |
| `checkedNodes` / `expandedNodes` | 已选中 / 已展开节点对象列表 |

`treeInfo` 中常用：

| 字段 | 说明 |
|------|------|
| `checked` | 已选中 value 数组 |
| `checkedNodes` | 已选中节点对象 |
| `expanded` | 已展开 value 数组 |
| `selected` / `selectedNodes` | 点击相关节点 |
| `currentNode` | 当前操作节点 |

单选组织树时，取当前部门 id 常用：

```javascript
const id = $w.tree1.treeInfo?.checked?.[0];
// 或事件里的 currentNode.value
```

### 10.5 事件

| 事件标识 | 说明 |
|----------|------|
| `selectNodeChange` | 选中节点改变（部门树点选绑这个） |
| （节点展开/折叠相关事件） | 展开或折叠某节点时触发 |

`selectNodeChange` 的 `event.detail` 中可包含：

- `currentNode`：当前节点  
- `checked` / `checkedNodes`  
- `expanded` / `expandedNodes`  
- `event`：操作类型，如 `init` / `check` / `select` / `expand`  
- `checkedState` / `selectedState` 等布尔状态  

（字段以运行时 `event.detail` 为准，绑方法时先 `console.log(event.detail)` 一次最稳。）

### 10.6 推荐用法：部门组织树

**1）加载：扁平表 → 嵌套 → 赋 data**

```javascript
export default async function ({ event, data }) {
  try {
    const result = await $w.cloud.callDataSource({
      dataSourceName: 'ct_dept',
      methodName: 'wedaGetRecordsV2',
      params: {
        filter: { where: {} },
        select: { $master: true },
        pageSize: 200,
        pageNumber: 1
      }
    });
    const list = (result?.records || []).slice().sort(
      (a, b) => (Number(a.sort) || 0) - (Number(b.sort) || 0)
    );

    const map = {};
    list.forEach((d) => {
      map[d._id] = {
        label: d.name,
        value: d._id,
        children: []
      };
    });
    const roots = [];
    list.forEach((d) => {
      const node = map[d._id];
      if (d.parent_id && map[d.parent_id]) {
        map[d.parent_id].children.push(node);
      } else {
        roots.push(node);
      }
    });

    $w.page.dataset.state.treeData = roots;
    // 若属性未绑变量，也可尝试直接赋值（视运行时是否可写）
    // $w.tree1.data = roots;

    if (roots[0] && $w.tree1) {
      // 默认选中第一个顶级（属性可写时）
      // $w.tree1.checkedCustom = [roots[0].value];
    }
  } catch (error) {
    console.error('加载部门树失败:', error);
    $w.utils.showToast({
      title: error?.message || '加载失败',
      icon: 'error',
      duration: 2000
    });
  }
}
```

**2）选中改变 → 右侧详情**

```javascript
export default async function ({ event, data }) {
  try {
    const node =
      event?.detail?.currentNode ||
      event?.detail?.checkedNodes?.[0];
    const id =
      node?.value ||
      $w.tree1.treeInfo?.checked?.[0];
    if (!id) return;

    $w.page.dataset.state.currentDeptId = id;
    // 再 wedaGetItemV2 填表单、刷下级表格…
  } catch (error) {
    console.error('选中部门失败:', error);
    $w.utils.showToast({
      title: error?.message || '选中失败',
      icon: 'error',
      duration: 2000
    });
  }
}
```

**3）搜索**

```javascript
$w.tree1.searchNode({ searchKey: ($w.input1.value || '').trim() });
```

### 10.7 注意点

1. **组件要 `label`/`value`/`children`，不要直接丢 `parent_id` 扁平数组。**  
2. **`value` 建议用业务主键 `_id`**，便于和表、筛选条件对齐。  
3. 单选组织树：`checkable` 按产品需要；过滤列表时用 `treeInfo.checked[0]`。  
4. 官方图标字段拼写为 **`expendIcon`**（不是 expand）。  
5. 搜索用方法 **`searchNode({ searchKey })`**。  
6. 数据量大时仍建议一次拉部门全量在前端拼树（中小组织足够）；过大再考虑懒加载方案。

---

## 十一、WdCanvas（Canvas）

- 官方文档：https://docs.cloudbase.net/lowcode/components/wedaUI/src/docs/compsdocs/show/WdCanvas  
- 类型名：`WdCanvas`  
- 中文名：Canvas  
- 实例访问：`$w.<组件id>`（如 `$w.canvas1`、`$w.wdCanvas2`）

### 11.1 用途

基于标准 Web / 小程序 Canvas 能力做自定义绘制。常见场景：

- 页面水印  
- 手写签名  
- 简单图表或标注（需自己画）

**与其它组件不同：官方方法 API 为「无」。**  
绘图不靠 `$w.canvas1.xxx()` 业务方法，而是取 **实例 + 上下文**，再调标准 canvas API。

### 11.2 方法 API

| 方法标识 | 说明 |
|----------|------|
| （无） | 官方方法表为空；操作全部通过实例与上下文完成 |

### 11.3 属性 API

| 属性标识 | 类型 | 说明 |
|----------|------|------|
| `type` | string | Canvas 类型，示例 `"2d"`（另有 webgl） |
| `template` | string | 预设模板，示例 `"2d"` |
| `code` | object | 相关函数/代码配置（编辑器侧） |
| `disableScroll` | boolean | 画布内手势时是否禁止页面滚动与下拉刷新，默认 false |

**只读（自定义代码核心）：**

| 属性标识 | 说明 |
|----------|------|
| `canvasInstance` | canvas 元素引用 |
| `canvasCtx` | 绘图上下文（`getContext` 返回对象） |
| `type` | 当前类型，可用于判断是否 `2d` |

```javascript
const canvas = $w.canvas1.canvasInstance;
const ctx = $w.canvas1.canvasCtx;
```

部分平台上实例还提供 **`getCanvasRectInfo()`**（签名场景用来算相对坐标）：

```javascript
const { left, top } = await $w.canvas1.canvasInstance.getCanvasRectInfo();
```

### 11.4 事件

| 事件标识 | 出参要点 | 适用 | 说明 |
|----------|----------|------|------|
| `canvasReady` | `canvasInstance`、`canvasCtx` | 三端 | **渲染完成**，初始化画布/画水印应绑此事件 |
| `click` | `e` | PC | 点击 |
| `dblclick` | `e` | PC | 双击 |
| `longtap` | - | 三端 | 长按约 500ms |
| `touchstart` / `touchmove` / `touchend` | - | 移动端、小程序 | 触摸 |
| `touchcancel` | - | 小程序 | 触摸被打断 |
| `mousedown` / `mousemove` / `mouseup` | `e` | PC | 鼠标 |
| `error` | - | 三端 | 错误 |

### 11.5 推荐用法

**取上下文（须在 canvasReady 之后）：**

```javascript
export default function ({ event, data }) {
  const canvas = event?.detail?.canvasInstance || $w.canvas1.canvasInstance;
  const ctx = event?.detail?.canvasCtx || $w.canvas1.canvasCtx;
  if (!ctx || !canvas) return;

  // 2d 示例：铺白底
  ctx.setFillStyle?.('white') || (ctx.fillStyle = 'white');
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.draw?.(); // 小程序侧常见需要 draw
}
```

**清空画布：**

```javascript
const canvas = $w.canvas1.canvasInstance;
const ctx = $w.canvas1.canvasCtx;
ctx.clearRect(0, 0, canvas.width, canvas.height);
ctx.setFillStyle?.('white');
ctx.fillRect(0, 0, canvas.width, canvas.height);
ctx.draw?.();
```

**导出图片（注意三端差异）：**

```javascript
// Web：toDataURL
const dataUrl = $w.canvas1.canvasInstance.toDataURL?.();

// 小程序：wx.canvasToTempFilePath + canvasInstance，见官方签名示例
```

**水印**：在 `canvasReady` 里设 `position:fixed`、铺满、半透明 `fillText` 循环绘制；`pointerEvents = 'none'` 避免挡操作。官方文档有完整水印示例。

**手写签名**：页面变量保存 `isMouseDown`、`canvasRect`；在 touch/mouse 系列事件里 `beginPath` / `moveTo` / `lineTo` / `stroke`；保存时再导出图片。逻辑以官方「手写签名」章节为准，Web 与小程序坐标与 `draw` 调用有差异。

### 11.6 注意点

1. **没有 submit/refresh 类方法**；核心是 `canvasInstance` + `canvasCtx`。  
2. **先等 `canvasReady`**，再读写上下文，否则可能为空。  
3. **Web 与小程序 API 不完全一致**（如 `setFillStyle` vs `fillStyle`、是否需要 `ctx.draw()`、导出方式）。用 `$w.wedaContext.platforms` 判断是否包含 `"MP"`。  
4. `type === '2d'` 时走 2d 上下文逻辑；webgl 需另一套写法。  
5. 签名、水印属于展示增强，和业务表单字段（签名图片 URL）通过「导出后上传云存储」衔接。

---

## 十二、WdAudio（音频播放）

- 官方文档：https://docs.cloudbase.net/lowcode/components/wedaUI/src/docs/compsdocs/show/WdAudio  
- 类型名：`WdAudio`  
- 中文名：音频播放  
- 实例访问：`$w.<组件id>`（如 `$w.audio1`）

### 12.1 用途

播放音频资源（含云文件 ID）。自定义方法里常用：**播放 / 暂停 / 停止 / 跳转 / 快进快退**。

### 12.2 方法 API（自定义代码重点）

| 方法标识 | 参数 | 说明 |
|----------|------|------|
| `play` | 无 | 开始或继续播放 |
| `pause` | 无 | 暂停 |
| `stop` | 无 | 停止；再次 play 会从头播 |
| `seek` | `{ position: number }` | 跳到指定秒（可到小数点后 3 位） |
| `fastForward` | `{ time: number }` | 快进 time 秒 |
| `backward` | `{ time: number }` | 快退 time 秒 |
| `destroy` | 无 | 销毁当前实例 |
| `init` | 无 | 重新初始化（destroy 之后用） |

```javascript
$w.audio1.play();
$w.audio1.pause();
$w.audio1.stop();
$w.audio1.seek({ position: 30 });
$w.audio1.fastForward({ time: 15 });
$w.audio1.backward({ time: 10 });
$w.audio1.destroy();
$w.audio1.init();
```

### 12.3 属性 API

| 属性标识 | 类型 | 默认/示例 | 说明 |
|----------|------|-----------|------|
| `template` | string | `"normal"` | 音频模板 |
| `src` | string | URL | 音频地址，**支持云文件 ID**；地址不要含中文（企业微信小程序等场景易失败） |
| `autoplay` | boolean | false | 自动播放（受浏览器策略限制，通常需用户先有交互） |
| `loop` | boolean | false | 循环播放 |
| `playbackRate` | number | 1 | 倍速 |
| `startTime` | number | 0 | 开始播放位置（秒） |

**只读：**

| 属性标识 | 说明 |
|----------|------|
| `audioInstance` | Audio 实例引用（更多能力可参考小程序 InnerAudioContext） |
| `currentTimeStr` | 当前进度，如 `00:00` |
| `durationStr` | 总时长，如 `00:00` |
| `played` | 是否正在播放 |

`audioReady` 事件 detail 中还会带出：`buffered`、`currentTime`、`duration`、`paused`、`src`、`autoplay`、`loop`、`playbackRate`、`startTime` 等。

### 12.4 事件

| 事件标识 | event.detail | 说明 |
|----------|--------------|------|
| `audioReady` | 含 `audioInstance` 及播放状态字段 | 实例初始化完成 |
| `play` | - | 开始/继续播放 |
| `pause` | - | 暂停 |
| `stop` | - | 结束播放 |
| `ended` | - | 播放到末尾 |
| `seeked` | `{ position }` | 跳转到指定位置后 |
| `timeupdate` | `{ currentTime, duration }` | 播放进度变化 |
| `error` | `{ errMsg, errCode }` | 播放错误 |

### 12.5 推荐用法

```javascript
// 切换资源后播放（先设 src，再 play；必要时 stop 一次）
export default async function ({ event, data }) {
  try {
    const url = data?.url || $w.page.dataset.state.audioUrl;
    if (!url) {
      $w.utils.showToast({ title: '无音频地址', icon: 'error', duration: 2000 });
      return;
    }
    // 属性可写时：
    // $w.audio1.src = url;
    $w.audio1.stop?.();
    $w.audio1.play();
  } catch (error) {
    console.error('播放失败:', error);
    $w.utils.showToast({
      title: error?.message || '播放失败',
      icon: 'error',
      duration: 2000
    });
  }
}

// 进度展示可监听 timeupdate，写到页面变量
// const { currentTime, duration } = event.detail;
```

### 12.6 注意点

1. **`src` 避免中文路径**，减少企业微信小程序等兼容问题。  
2. **`autoplay` 不可靠**：多数浏览器要求用户先点击页面。业务上用按钮触发 `play()` 更稳。  
3. `stop` 后再 `play` 从开头播；仅想暂停用 `pause`。  
4. `seek` / 快进快退的时间单位都是 **秒**。  
5. `destroy` 后需 `init` 才能再正常使用。  
6. 更底层能力可通过 `audioInstance` 查阅微信小程序 InnerAudioContext 文档（三端能力以微搭封装为准）。

---

## 十三、WdInput（单行输入）

- 官方文档：https://docs.cloudbase.net/lowcode/components/wedaUI/src/docs/compsdocs/form/WdInput  
- 类型名：`WdInput`  
- 中文名：单行输入  
- 实例访问：`$w.<组件id>`（如 `$w.input1`、`$w.inputSearch`）

### 13.1 用途

单行文本录入。表单容器绑定模型后，文本字段常自动渲染为本组件。自定义方法里高频：**读 `value`、setValue、清空、禁用、触发校验**。

### 13.2 方法 API（自定义代码重点）

| 方法标识 | 参数 | 说明 |
|----------|------|------|
| `setValue` | `string` | 设置输入值 |
| `clearValue` | 无 | 清空值 |
| `setVisible` | `boolean` | 显示/隐藏 |
| `setDisabled` | `boolean` | 禁用/启用 |
| `setReadOnly` | `boolean` | 只读/可编辑 |
| `handleValidate` | 无 | 触发校验 |
| `clearValidate` | 无 | 清除校验状态 |

```javascript
$w.input1.setValue('研发部');
const text = $w.input1.value; // 读取当前值
$w.input1.clearValue();
$w.input1.setDisabled(true);
$w.input1.setReadOnly(false);
$w.input1.setVisible(true);
$w.input1.handleValidate();
$w.input1.clearValidate();
```

注意：这里 `setValue` 直接传 **字符串**，与表单容器 `setValue({ value: { ... } })` 形态不同。

### 13.3 属性 API（与取值 / 校验相关）

| 属性标识 | 类型 | 说明 |
|----------|------|------|
| `name` | string | 绑定字段 Key，表单提交时匹配模型字段，表单内需唯一 |
| `inputValue` | string | 输入值（配置项） |
| `value` | string | 运行时可读的当前值（属性 API） |
| `placeholder` | string | 占位文字 |
| `label` | string | 标题内容 |
| `labelVisible` / `labelAlign` / `labelWrap` / `layout` / `labelWidth` | | 标题展示 |
| `required` | boolean | 是否必填 |
| `requiredFlag` | boolean | 是否显示必填星号 |
| `requiredMsg` | string | 必填提示 |
| `maxLength` | number | 最大长度，默认 140 |
| `rules` | array | 校验规则 |
| `status` | string | 状态，示例 `"edit"` |
| `password` | boolean | 是否密码展示 |
| `type` | string | 移动端键盘类型，默认 `text` |
| `clearable` | boolean | 是否显示清空按钮，默认 true |
| `before` / `after` | string | 前/后缀文字（提交时可能一并带上，见 `isUnionValue`） |
| `isUnionValue` | boolean | 取值是否包含前后缀文字，默认 true |
| `focus` | boolean | 是否自动聚焦 |
| `counterVisible` | boolean | 是否显示字数 |
| `disabled` / `readOnly` / `visible` | boolean | 禁用、只读、是否展示（只读属性侧） |

内置校验类型包括：身份证、银行卡、邮箱、数字、中文、网址、车牌、手机号、固定电话、金额、护照等（完整列表见官方）。

### 13.4 事件

| 事件标识 | event.detail | 说明 |
|----------|--------------|------|
| `change` | `{ value }` | 值改变 |
| `focus` | `{ value }` | 聚焦 |
| `blur` | `{ value }` | 失焦 |
| `confirm` | `{ value }` | Web 端回车确认 |
| `clear` | `{ originValue }` | 点击清空，带清除前的值 |
| `inputAdornmentClick` | `{ type }` | 前后缀文字/图标点击；type 为 `beforeText` / `afterText` / `prefix` / `suffix` |

### 13.5 推荐用法

```javascript
// 搜索框失焦 → 树搜索（部门管理）
export default async function ({ event, data }) {
  try {
    const key = (event?.detail?.value ?? $w.inputSearch.value ?? '').trim();
    if ($w.tree1?.searchNode) {
      $w.tree1.searchNode({ searchKey: key });
    }
  } catch (error) {
    console.error('搜索失败:', error);
    $w.utils.showToast({
      title: error?.message || '搜索失败',
      icon: 'error',
      duration: 2000
    });
  }
}

// 独立校验（不在表单容器内时）
export default async function ({ event, data }) {
  try {
    $w.inputCode.handleValidate?.();
    const v = ($w.inputCode.value || '').trim();
    if (!v) {
      $w.utils.showToast({ title: '请填写编码', icon: 'error', duration: 2000 });
      return;
    }
    // ...
  } catch (error) {
    console.error('校验失败:', error);
    $w.utils.showToast({
      title: error?.message || '校验失败',
      icon: 'error',
      duration: 2000
    });
  }
}
```

在 **表单容器** 内时，优先读 `$w.form1.value.字段名` 或表单 `submit`；单独输入框才直接用 `$w.input1.value`。

### 13.6 注意点

1. **`setValue("文案")` 传字符串**，不要套成表单那种 `{ value: {} }`。  
2. 读值用 **`$w.input1.value`**。  
3. `before`/`after` 可能进入提交值，注意 `isUnionValue`。  
4. 表单内 `name` 必须唯一且与模型字段标识一致。  
5. 尺寸、标题对齐等在表单容器内默认跟随容器配置；PC/移动表现有差异。

---

## 十四、WdSelect（下拉单选）

- 官方文档：https://docs.cloudbase.net/lowcode/components/wedaUI/src/docs/compsdocs/form/WdSelect  
- 类型名：`WdSelect`  
- 中文名：下拉单选（原下拉选择）  
- 实例访问：`$w.<组件id>`（如 `$w.select1`、`$w.selectStatus`）

### 14.1 用途

列表形式展示选项，支持搜索与单选。表单里关联关系、枚举单选、文本字段常映射为本组件。自定义方法里：**设选中值、读 value/item、清空、校验**。

### 14.2 方法 API（自定义代码重点）

| 方法标识 | 参数 | 说明 |
|----------|------|------|
| `setValue` | `string` | 设置选中值（必须是 **选项 value**，不是 label） |
| `clearValue` | 无 | 清空选中 |
| `setVisible` | `boolean` | 显隐 |
| `setDisabled` | `boolean` | 禁用 |
| `setReadOnly` | `boolean` | 只读 |
| `handleValidate` | 无 | 触发校验 |
| `clearValidate` | 无 | 清除校验 |

```javascript
$w.select1.setValue('enabled'); // 选项 value
const v = $w.select1.value;
const label = $w.select1.selectedLabel;
const item = $w.select1.item; // 选中项对象
$w.select1.clearValue();
$w.select1.handleValidate();
```

### 14.3 属性 API（与选项 / 选中相关）

| 属性标识 | 类型 | 说明 |
|----------|------|------|
| `name` | string | 表单字段 Key，表单内唯一 |
| `label` | string | 标题，示例「下拉单选」 |
| `range` | array | 选项列表：`[{ label, value }]` |
| `value` | string | 选中值（选项 value） |
| `placeholder` | string | 占位，默认「请选择」 |
| `searchable` | boolean | 是否支持搜索，默认 true |
| `searchPlaceholder` | string | 搜索框占位 |
| `filterable` | boolean | **禁用前端筛选**（远程搜索时勾选，用 search 事件 + Query） |
| `required` / `requiredFlag` / `requiredMsg` | | 必填相关 |
| `status` | string | 如 `edit` |
| `clearable` | boolean | 清空按钮，默认 true |
| `where` / `queryCondition` / `sorter` | | 关联数据筛选与排序 |
| `selectFieldLabel` / `selectFieldType` / `selectFields` | | 关联字段展示配置 |
| `enableRelationalRefresh` | boolean | 关联选项刷新按钮 |
| `enableAddRelationButton` | boolean | 关联「去新建」按钮 |
| `addRelationButtonText` | string | 新建按钮文案，默认「去新建」 |
| `enableRelationTag` | boolean | 只读时标签展示 |

**只读：**

| 属性标识 | 说明 |
|----------|------|
| `value` | 选中值 |
| `selectedLabel` | 选中项文案 |
| `item` | 选中项对象 |
| `disabled` / `readOnly` / `visible` / `required` | 状态 |

**选项数据结构：**

```javascript
[
  { label: '启用', value: 'enabled' },
  { label: '停用', value: 'disabled' }
]
```

动态选项：绑定 Query 的 `records`，并配置标签名称/标签值字段；远程搜索时用页面变量 + `search` 事件 + 勾选禁用前端筛选。

### 14.4 事件

| 事件标识 | event.detail | 说明 |
|----------|--------------|------|
| `change` | `value`；`context.option` 为选中项 | 值改变 |
| `search` | `value`（搜索框输入） | 输入搜索内容 |
| `focus` / `blur` | - | 聚焦、失焦 |
| `onSettingButtonClick` | - | 点击设置按钮 |
| `onAddRelationButtonClick` | - | 点击新建按钮 |
| `onRelationTagClick` | `item`（label/value） | 点击标签 |
| `onRelationOptionJump` | `item` | 关联选项跳转 |

### 14.5 推荐用法

```javascript
// 切换状态后刷新列表
export default async function ({ event, data }) {
  try {
    const value = event?.detail?.value ?? $w.selectStatus.value;
    const option = event?.detail?.context?.option;
    $w.page.dataset.state.filterStatus = value;
    if ($w.table1?.refresh) {
      await $w.table1.refresh();
    }
  } catch (error) {
    console.error('下拉变更失败:', error);
    $w.utils.showToast({
      title: error?.message || '操作失败',
      icon: 'error',
      duration: 2000
    });
  }
}

// 远程搜索：search 事件写入变量，Query 监听入参变化
export default function ({ event, data }) {
  $w.page.dataset.state.searchValue = event?.detail?.value || '';
}
```

### 14.6 注意点

1. **`setValue` / 默认选中填的是选项 value，不是 label。**  
2. 需要文案时用 `selectedLabel` 或 `item`。  
3. `change` 里可用 `event.detail.context.option` 拿到完整选项。  
4. 远程搜索：勾选 **禁用前端筛选**（`filterable`），用 `search` + Query，不要只靠本地过滤。  
5. 关联关系自动生成的选项：label/value 分别强制主列与数据标识。  
6. 与 WdInput 相同：`setValue` 传字符串；在表单容器内也可走 `form.value.字段`。

---

## 十五、WdSelectMultiple（下拉多选）

- 官方文档：https://docs.cloudbase.net/lowcode/components/wedaUI/src/docs/compsdocs/form/WdSelectMultiple  
- 类型名：`WdSelectMultiple`  
- 中文名：下拉多选  
- 实例访问：`$w.<组件id>`（如 `$w.selectMultiple1`）

### 15.1 用途

列表展示选项，支持 **多选**。能力与下拉单选相近，核心差异是 **值为数组**。

| 对比 | WdSelect | WdSelectMultiple |
|------|----------|------------------|
| 选中值类型 | `string` | `array` |
| `setValue` | 传字符串 value | 传 **选项 value 数组** |
| `item` | 单个对象 | **对象数组** |
| `change` | `context.option` | `context.options` |

### 15.2 方法 API（自定义代码重点）

| 方法标识 | 参数 | 说明 |
|----------|------|------|
| `setValue` | 选中值数组（见下） | 设置多选选中项，元素为选项 **value** |
| `clearValue` | 无 | 清空 |
| `setVisible` | `boolean` | 显隐 |
| `setDisabled` | `boolean` | 禁用 |
| `setReadOnly` | `boolean` | 只读 |
| `handleValidate` | 无 | 触发校验 |
| `clearValidate` | 无 | 清除校验 |

官方方法表将 `setValue` 参数描述为对象形态 `value: array`。实际调用时以运行时为准，常见写法：

```javascript
// 优先按数组设置（与 value 类型一致）
$w.selectMultiple1.setValue(['a', 'b']);

// 若运行时要求对象包装，则：
// $w.selectMultiple1.setValue({ value: ['a', 'b'] });

const values = $w.selectMultiple1.value; // string[]
const items = $w.selectMultiple1.item;   // 选中项对象数组
const labels = $w.selectMultiple1.selectedLabel;

$w.selectMultiple1.clearValue();
```

### 15.3 属性 API（与单选差异处加粗）

| 属性标识 | 类型 | 说明 |
|----------|------|------|
| `range` | array | `[{ label, value }]` 选项列表 |
| **`value`** | **array** | 选中值列表，默认 `[]` |
| `name` | string | 表单字段 Key |
| `label` | string | 标题，示例「下拉多选」 |
| `placeholder` | string | 占位 |
| `searchable` | boolean | 支持搜索，默认 true |
| `searchPlaceholder` | string | 搜索占位 |
| `filterable` | boolean | 禁用前端筛选（远程搜索） |
| `required` / `requiredFlag` / `requiredMsg` | | 必填 |
| `where` / `queryCondition` / `sorter` | | 关联筛选排序 |
| 关联扩展按钮类属性 | | 与单选类似（刷新/新建/标签等） |

**只读：**

| 属性标识 | 类型 | 说明 |
|----------|------|------|
| `value` | array | 选中 value 列表 |
| `selectedLabel` | string | 选中项名称文案 |
| **`item`** | **array** | 选中项对象列表 |
| `disabled` / `readOnly` / `visible` | boolean | 状态 |

### 15.4 事件

| 事件标识 | event.detail | 说明 |
|----------|--------------|------|
| `change` | **`value` 为 array**；`context.options` 为选中项 | 值改变 |
| `search` | `value` 搜索关键字 | 输入搜索 |
| `focus` / `blur` | - | 焦点 |
| `onSettingButtonClick` / `onAddRelationButtonClick` | - | 关联扩展 |
| `onRelationTagClick` / `onRelationOptionJump` | `item` | 标签/跳转 |

### 15.5 推荐用法

```javascript
export default async function ({ event, data }) {
  try {
    const values = event?.detail?.value ?? $w.selectMultiple1.value ?? [];
    const options = event?.detail?.context?.options;
    $w.page.dataset.state.selectedIds = values;
    // 例如：按多选部门/标签过滤
    if ($w.table1?.refresh) {
      await $w.table1.refresh();
    }
  } catch (error) {
    console.error('多选变更失败:', error);
    $w.utils.showToast({
      title: error?.message || '操作失败',
      icon: 'error',
      duration: 2000
    });
  }
}

// 回填多选（编辑页）
$w.selectMultiple1.setValue(['id1', 'id2']);
```

动态选项、远程搜索做法与 **WdSelect** 相同：Query 绑 `range` 数据源；`search` 写变量 + 禁用前端筛选。

### 15.6 注意点

1. **全程按数组处理 value**，不要当成单选字符串。  
2. `setValue` 的每一项必须是选项 **value**，不是 label。  
3. `change` 用 `context.options`（复数），不是 `option`。  
4. 落库时若模型字段是关联多选/数组，保持数组；若后端要逗号串，提交前自行 `join`。  
5. 官方方法说明里若出现单选文案示例，以 **value 类型为 array** 的属性定义为准。

---

## 十六、WdDate（日期时间选择）

- 官方文档：https://docs.cloudbase.net/lowcode/components/wedaUI/src/docs/compsdocs/form/WdDate  
- 类型名：`WdDate`  
- 中文名：日期时间选择  
- 实例访问：`$w.<组件id>`（如 `$w.date1`、`$w.datePlan`）

### 16.1 用途

选择日期或日期时间。表单中「日期 / 日期时间」字段常自动渲染为本组件。  
支持多种 **时间模式**：年、年-月、年-月-日、年-月-日 时:分、年-月-日 时:分:秒。

与 **WdCalendar（日历）** 的区别：WdDate 是表单控件；WdCalendar 偏面板展示与点选。

### 16.2 方法 API（自定义代码重点）

| 方法标识 | 参数 | 说明 |
|----------|------|------|
| `setValue` | 时间值（官方为 `value: number`） | 设置选中时间 |
| `clearValue` | 无 | 清空 |
| `setVisible` | `boolean` | 显隐 |
| `setDisabled` | `boolean` | 禁用 |
| `setReadOnly` | `boolean` | 只读 |
| `handleValidate` | 无 | 触发校验 |
| `clearValidate` | 无 | 清除校验 |

```javascript
// 属性 API 中 value 类型为 number（时间戳）
const ts = Date.now();
$w.date1.setValue(ts);
// 若运行时要求对象包装：
// $w.date1.setValue({ value: ts });

const current = $w.date1.value; // number
$w.date1.clearValue();
$w.date1.handleValidate();
```

### 16.3 属性 API（数据相关）

| 属性标识 | 类型 | 默认/示例 | 说明 |
|----------|------|-----------|------|
| `name` | string | - | 表单字段 Key |
| `label` | string | `"日期时间"` | 标题 |
| **`mode`** | string | `"datetime"` | 时间模式（年 / 年月 / 年月日 / 含时分秒等，以编辑器枚举为准） |
| **`dateFormat`** | string | `"YYYY-MM-DD HH:mm:ss"` | 展示格式；模式不含的段运行态不展示 |
| **`value`** | number | - | 选中时间（时间戳） |
| `start` | - | - | 最早可选时间 |
| `end` | - | - | 最晚可选时间 |
| `placeholder` | string | `"请选择"` | 占位 |
| `required` / `requiredFlag` / `requiredMsg` | | | 必填 |
| `status` | string | `"edit"` | 编辑等状态 |
| `clearable` | boolean | true | 清空按钮 |
| `labelVisible` / `layout` / … | | | 标题布局（表单内常跟随容器） |

**只读：** `value`、`name`、`label`、`disabled`、`readOnly`、`visible`、`required` 等。

### 16.4 事件

| 事件标识 | event.detail | 说明 |
|----------|--------------|------|
| `change` | `{ value: number }` | 选中值改变 |

### 16.5 推荐用法

```javascript
// 选中后写入页面变量，供筛选
export default async function ({ event, data }) {
  try {
    const ts = event?.detail?.value ?? $w.date1.value;
    $w.page.dataset.state.planDate = ts;
    // 需要 yyyy-MM-dd 时自行格式化（注意时区）
    if ($w.table1?.refresh) {
      await $w.table1.refresh();
    }
  } catch (error) {
    console.error('日期变更失败:', error);
    $w.utils.showToast({
      title: error?.message || '操作失败',
      icon: 'error',
      duration: 2000
    });
  }
}

// 编辑回填
$w.date1.setValue(record.plan_date); // 库中存时间戳时直接回填
```

`start` / `end` 用于限制可选范围（如不能早于今天、不能超过项目截止日期）。

### 16.6 注意点

1. **`value` / `change` 的值类型为 number（时间戳）**，不要默认当成 `'2024-01-01'` 字符串。  
2. 展示靠 `mode` + `dateFormat`；存库格式与模型「日期时间」字段约定保持一致。  
3. 与 WdCalendar 一样注意 **时区 / 当天 0 点** 业务约定。  
4. 方法表若出现与字符串相关的示例文案，以 **value: number** 的属性定义为准。  
5. 表单内优先也可读 `$w.form1.value.日期字段`。

---

## 十七、WdDateRange（日期区间选择）

- 官方文档：https://docs.cloudbase.net/lowcode/components/wedaUI/src/docs/compsdocs/form/WdDateRange  
- 类型名：`WdDateRange`  
- 中文名：日期区间选择  
- 实例访问：`$w.<组件id>`（如 `$w.dateRange1`）

### 17.1 用途

选择 **开始～结束** 的日期（或年月、含时分秒等）区间。适合筛选列表时间范围、项目计划起止等。

与 WdDate 对比：

| 点 | WdDate | WdDateRange |
|------|--------|-------------|
| 值 | 单个时间戳 `number` | **`[开始, 结束]` 时间戳数组** |
| `setValue` | 一个 number | **两个 number 的数组** |
| 占位 | `placeholder` | `startPlaceholder` / `endPlaceholder` |
| 默认 mode | `datetime` | `day` |

### 17.2 方法 API（自定义代码重点）

| 方法标识 | 参数 | 说明 |
|----------|------|------|
| `setValue` | `number[]` 时间戳数组 | 设置区间，如 `[开始, 结束]` |
| `clearValue` | 无 | 清空 |
| `setVisible` | `boolean` | 显隐 |
| `setDisabled` | `boolean` | 禁用 |
| `setReadOnly` | `boolean` | 只读 |
| `handleValidate` | 无 | 触发校验 |
| `clearValidate` | 无 | 清除校验 |

```javascript
// 官方示例
$w.dateRange1.setValue([1672531200000, 1703980800000]);

const range = $w.dateRange1.value; // [startTs, endTs]
const [start, end] = range || [];
$w.dateRange1.clearValue();
```

### 17.3 属性 API（数据相关）

| 属性标识 | 类型 | 默认/示例 | 说明 |
|----------|------|-----------|------|
| `name` | string | - | 表单字段 Key |
| `label` | string | `"日期区间选择"` | 标题 |
| `mode` | string | `"day"` | 时间模式（年 / 年月 / 日 / 含时分秒等） |
| `dateFormat` | string | `"YYYY-MM-DD HH:mm:ss"` | 展示格式 |
| **`value`** | **array** | - | Unix 时间戳数组，如 `[1718681637000, 1719504000000]` |
| `start` / `end` | - | - | 最早/最晚可选时间 |
| `startPlaceholder` | string | `"开始时间"` | 开始占位 |
| `endPlaceholder` | string | `"结束时间"` | 结束占位 |
| `required` / `requiredFlag` / `requiredMsg` | | | 必填 |
| `status` | string | `"edit"` | 状态 |
| `clearable` | boolean | true | 清空按钮 |

**只读：** `value`、`name`、`label`、`disabled`、`readOnly`、`visible`、`required` 等。

### 17.4 事件

| 事件标识 | event.detail | 说明 |
|----------|--------------|------|
| `change` | `{ value: number[] }` | 区间改变，value 为时间戳数组 |

### 17.5 推荐用法

```javascript
// 区间筛选列表
export default async function ({ event, data }) {
  try {
    const range = event?.detail?.value ?? $w.dateRange1.value ?? [];
    const [start, end] = range;
    $w.page.dataset.state.filterStart = start ?? null;
    $w.page.dataset.state.filterEnd = end ?? null;
    if ($w.table1?.refresh) {
      await $w.table1.refresh();
    }
  } catch (error) {
    console.error('日期区间变更失败:', error);
    $w.utils.showToast({
      title: error?.message || '操作失败',
      icon: 'error',
      duration: 2000
    });
  }
}

// 回填
$w.dateRange1.setValue([record.start_at, record.end_at]);
```

### 17.6 注意点

1. **`value` 始终是长度为 2 的时间戳数组**（未选齐时以运行时实际返回为准）。  
2. `setValue([start, end])`，元素为 **number**，不是日期字符串。  
3. 列表筛选时通常把 start/end 拆到两个查询条件（`>=` / `<=`）。  
4. `mode` 默认是 `day`，与单日期的 `datetime` 默认不同。  
5. 时区与日切约定与 WdDate / WdCalendar 相同。

---

## 十八、WdRating（评分）

- 官方文档：https://docs.cloudbase.net/lowcode/components/wedaUI/src/docs/compsdocs/form/WdRating  
- 类型名：`WdRating`  
- 中文名：评分  
- 实例访问：`$w.<组件id>`（如 `$w.rating1`）

### 18.1 用途

评分录入与展示，用图标直观表达分值。适合评审打分、满意度等场景（如里程碑评审评分）。

### 18.2 方法 API（自定义代码重点）

| 方法标识 | 参数 | 说明 |
|----------|------|------|
| `setValue` | `number` | 设置评分值 |
| `clearValue` | 无 | 清空 |
| `setVisible` | `boolean` | 显隐 |
| `setDisabled` | `boolean` | 禁用 |
| `setReadOnly` | `boolean` | 只读（纯展示） |
| `handleValidate` | 无 | 触发校验 |
| `clearValidate` | 无 | 清除校验 |

```javascript
$w.rating1.setValue(4);
const score = $w.rating1.value; // number
$w.rating1.clearValue();
$w.rating1.setReadOnly(true); // 仅展示
$w.rating1.handleValidate();
```

官方方法表参数类型为 **number**（若文档示例出现字符串，以 number 为准）。

### 18.3 属性 API（数据 / 外观）

| 属性标识 | 类型 | 默认值 | 说明 |
|----------|------|--------|------|
| `name` | string | - | 表单字段 Key，页面内唯一 |
| `label` | string | - | 标题 |
| **`value`** | **number** | - | 当前评分值 |
| `min` | number | 0 | 最小值 |
| `max` | number | 5 | 最大值 |
| `step` | number | 1 | 步长（如 `0.5` 可半星） |
| `icon` | string | `"td:star-filled"` | 默认选中图标 |
| `iconSrc` | string | - | 自定义选中图标地址 |
| `backgroundIcon` | string | - | 未选中图标（空则用默认未选中效果） |
| `backgroundIconSrc` | string | - | 自定义未选中图标 |
| `foregroundColor` | string | `"#ffcf48"` | 选中颜色（自定义图片时不生效） |
| `backgroundColor` | string | `"#bfbfbf"` | 未选中颜色 |
| `size` | string | `"sm"` | 组件尺寸 |
| `status` | string | `"edit"` | 状态 |
| `required` / `requiredFlag` / `requiredMsg` | | | 必填 |
| `callbacks` | object | - | 相关回调/提示文案生成等 |
| `labelVisible` / `layout` / … | | | 标题布局 |

**只读：** `value`、`min`、`max`、`step`、`disabled`、`readOnly`、`visible` 等。

### 18.4 事件

| 事件标识 | event.detail | 说明 |
|----------|--------------|------|
| `change` | `{ value: number }` | 评分变化 |

### 18.5 推荐用法

```javascript
// 评审打分 change
export default async function ({ event, data }) {
  try {
    const score = event?.detail?.value ?? $w.rating1.value;
    $w.page.dataset.state.reviewScore = score;
  } catch (error) {
    console.error('评分变更失败:', error);
    $w.utils.showToast({
      title: error?.message || '操作失败',
      icon: 'error',
      duration: 2000
    });
  }
}

// 编辑回填 / 详情只读展示
$w.rating1.setValue(record.score);
$w.rating1.setReadOnly(true);
```

半星：将 `step` 设为 `0.5`，并配合图标样式（见官方「步长、图标展示」说明）。

### 18.6 注意点

1. **`value` 为 number**，不是字符串。  
2. `setValue` 应在 `min`～`max` 之间，并符合 `step`。  
3. 使用 **自定义图片图标** 时，颜色配置不生效。  
4. 详情页只展示时用 `setReadOnly(true)` 或属性只读，避免误改。  
5. 表单内可走 `$w.form1.value.评分字段`；独立组件直接读 `$w.rating1.value`。

---

## 十九、WdProgress（进度条）

- 官方文档：https://docs.cloudbase.net/lowcode/components/wedaUI/src/docs/compsdocs/form/WdProgress  
- 类型名：`WdProgress`  
- 中文名：进度条  
- 实例访问：`$w.<组件id>`（如 `$w.progress1`）

### 19.1 用途

展示或可调节的当前进度，例如上传进度、任务完成度、音频进度。支持在编辑态点击/拖拽调整（见官方示例）。

### 19.2 方法 API

官方文档 **未提供方法 API 表**（无 `setValue` / `clearValue` 等正式方法条目）。

自定义代码中以 **属性读写 `value`** 为主：

```javascript
// 读当前进度
const p = $w.progress1.value;

// 写进度（属性可写时）
$w.progress1.value = 60;

// 也可用页面变量绑定 value，在业务里改变量驱动进度
$w.page.dataset.state.uploadPercent = 60;
```

若运行时后续补齐与其它表单一致的方法，再以官方更新为准。

### 19.3 属性 API

| 属性标识 | 类型 | 默认值 | 说明 |
|----------|------|--------|------|
| `name` | string | - | 表单字段 Key，页面内唯一 |
| `label` | string | - | 标题 |
| **`value`** | **number** | - | 当前进度值 |
| `min` | number | 0 | 最小值 |
| `max` | number | 100 | 最大值 |
| `step` | number | 1 | 点击/调整时的步长 |
| `showPercent` | boolean | - | 是否显示进度百分比 |
| `status` | string | `"edit"` | 状态 |
| `required` / `requiredFlag` / `requiredMsg` | | | 必填相关 |
| `labelVisible` / `layout` / … | | | 标题布局 |

**只读属性 API 列出：** `name`、`label`、`showPercent`、`min`、`max`、`value`、`step`、`visible`、`disabled`、`readOnly`。

### 19.4 事件

| 事件标识 | event.detail | 说明 |
|----------|--------------|------|
| `change` | `{ value: number }` | 进度值改变（含点击/拖拽调整） |

### 19.5 推荐用法

```javascript
// 上传/任务回调里更新进度
export default async function ({ event, data }) {
  try {
    const percent = Math.min(100, Math.max(0, Number(data?.percent) || 0));
    $w.progress1.value = percent;
    // 或：$w.page.dataset.state.taskProgress = percent;
  } catch (error) {
    console.error('更新进度失败:', error);
  }
}

// 用户拖拽进度条
export default function ({ event, data }) {
  const v = event?.detail?.value ?? $w.progress1.value;
  $w.page.dataset.state.progress = v;
}
```

样式上可用 `.wd-progress`（轨道）、`.wd-progress__value`（已完成段）改颜色与高度（见官方样式 API）。

### 19.6 注意点

1. **`value` 为 number**，范围受 `min`/`max` 约束，默认 0～100。  
2. 官方 **无方法表**；优先属性赋值或变量绑定，不要假设一定有 `setValue`。  
3. `step` 影响可点击/拖拽时的增减幅度。  
4. 纯展示进度时将状态设为只读/禁用，避免用户拖改。  
5. 与评分 WdRating 不同：进度条是线性进度，不是星级图标。

---

## 二十、WdTagSelect（标签选择）

- 官方文档：https://docs.cloudbase.net/lowcode/components/wedaUI/src/docs/compsdocs/form/WdTagSelect  
- 类型名：`WdTagSelect`  
- 中文名：标签选择  
- 实例访问：`$w.<组件id>`（如 `$w.tagSelect1`）

### 20.1 用途

多个标签并排展示，支持 **单选 / 多选**。比下拉更适合「一眼点选」的分类、状态、标签筛选。

与 WdSelect / WdSelectMultiple 对比：交互是标签块，不是下拉列表；选项结构同样是 `label` + `value`。

### 20.2 方法 API（自定义代码重点）

| 方法标识 | 参数 | 说明 |
|----------|------|------|
| `setValue` | 见下 | 设置选中值 |
| `clearValue` | 无 | 清空 |
| `setVisible` | `boolean` | 显隐 |
| `setDisabled` | `boolean` | 禁用 |
| `setReadOnly` | `boolean` | 只读 |
| `handleValidate` | 无 | 触发校验 |
| `clearValidate` | 无 | 清除校验 |

官方方法表将 `setValue` 参数写为 string。实际 **单选传选项 value（文本/字符串），多选应传 value 数组**（与 `value` 属性说明一致）：

```javascript
// 多选（checkType 为 checkbox 等）
$w.tagSelect1.setValue(['1', '2']);

// 单选
$w.tagSelect1.setValue('1');

const v = $w.tagSelect1.value;
const labels = $w.tagSelect1.selectedLabel;
const items = $w.tagSelect1.item; // 选中项对象（文档类型为 array）
$w.tagSelect1.clearValue();
```

### 20.3 属性 API（数据相关）

| 属性标识 | 类型 | 默认/示例 | 说明 |
|----------|------|-----------|------|
| `name` | string | - | 表单字段 Key |
| `label` | string | `"标签选择"` | 标题 |
| `range` | array | 见下 | 选项列表 |
| **`checkType`** | string | `"checkbox"` | 选择方式（影响单选/多选） |
| **`value`** | string 或 array | 示例 `["1"]` | **单选为文本，多选为数组**；`$w.组件ID.value` 读取 |
| `direction` | string | `"inline"` | 选项排列方式 |
| `tagStyleType` | string | `"light"` | 标签风格 |
| `tagStyleColor` | string | `"#0052d9"` | 选中颜色 |
| `tagStyleRadius` | string | - | 圆角 |
| `tagStyleWidthType` | string | `"flex"` | 移动端宽度（H5/小程序） |
| `tagStyleWidthCols` | number | - | 移动端列数 |
| `tagStyleSpace` | string | `"md"` | 标签间距 |
| `required` / `requiredFlag` / `requiredMsg` | | | 必填 |
| `status` | string | `"edit"` | 状态 |
| `size` | string | - | 尺寸 |

**选项示例：**

```javascript
[
  { label: '标签 1', value: '1' },
  { label: '标签 2', value: '2' },
  { label: '标签 3', value: '3' }
]
```

**只读：** `value`、`range`、`selectedLabel`、`item`、`disabled`、`readOnly`、`visible`、`required` 等。

### 20.4 事件

| 事件标识 | event.detail | 说明 |
|----------|--------------|------|
| `change` | `value`（单选 string / 多选 array） | 选中改变 |

### 20.5 推荐用法

```javascript
// 标签筛选列表
export default async function ({ event, data }) {
  try {
    const v = event?.detail?.value ?? $w.tagSelect1.value;
    $w.page.dataset.state.tagFilter = v;
    if ($w.table1?.refresh) {
      await $w.table1.refresh();
    }
  } catch (error) {
    console.error('标签选择变更失败:', error);
    $w.utils.showToast({
      title: error?.message || '操作失败',
      icon: 'error',
      duration: 2000
    });
  }
}

// 回填多选
$w.tagSelect1.setValue(['bug', 'urgent']);
```

**选中后不可取消**（官方样式技巧）：

```css
.wd-tag-item.is-selected {
  pointer-events: none;
}
```

### 20.6 注意点

1. **`value` 类型随单选/多选变化**：单选 string，多选 array；处理时先判断 `Array.isArray`。  
2. `setValue` 填的是选项 **value**，不是 label。  
3. 默认 `checkType` 为 `checkbox`（偏多选），改单选需在编辑器选对选择方式。  
4. 与下拉多选类似，落库时数组可能要 `join` 或按关联多选字段提交。  
5. 官方方法表示例偏字符串；**多选场景以 value 为数组的属性说明为准**。

---

