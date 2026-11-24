---
name: weda-component-api
description: 微搭（CloudBase WeDa）内置组件实例方法与属性速查。覆盖 ListView/WdForm/WdTable/WdModal/WdTree 等 20 个组件的 refresh/setValue/open/selectTab 等方法。Use when user asks for 组件方法, $w.listView refresh, $w.form1 setValue, WdTable clearSelection, 组件API, or how to call methods on WeDa built-in components.
---

# 微搭内置组件 API 速查

本技能管**内置组件实例上能调什么方法、有哪些数据相关属性**；自定义方法骨架见 `weda-custom-method`，自定义 JSX 组件见 `weda-component-jsx`。

## 何时使用

- 写自定义方法里要刷新列表、删行、读写组件状态
- 不确定某个组件有哪些方法、参数怎么传
- 关键词：组件 API、属性 API、方法 API、`$w.listView`、`refresh`、数据列表、ListView、树、表单、表格

## 何时不用

- 写自定义方法骨架（用 `weda-custom-method`）
- 写自定义 JSX 组件（用 `weda-component-jsx`）
- 查 `$w.cloud.callDataSource` 数据源 CRUD（用 `weda-custom-method`）

---

## 与自定义方法规范的关系

| 技能 | 管什么 |
|------|--------|
| `weda-custom-method` | 方法骨架、`try/catch`、`showToast`、数据源 `weda*V2` |
| **本技能** | 某个组件实例上能调什么方法、有哪些数据相关属性 |

两者一起用：骨架按自定义方法规范写，组件操作按本技能查。

---

## 通用调用约定

```javascript
// 读属性
const val = $w.list1.xxx;

// 调方法（建议 await）
await $w.list1.refresh();
await $w.list1.refresh('refreshFromStart');

// 组件 id = 编辑器大纲里的名称，不是类型名 ListView
```

规则：

1. `$w` 后面是 **组件实例 id**（如 `listView1`、`table1`），不是组件类型名。
2. 方法名、参数以本文档各组件章节为准。
3. 调用前建议判断：`if ($w.listView1 && $w.listView1.refresh)`。
4. 列表类组件：在增删改成功后、筛选条件变化后再 `refresh`。

---

## 写自定义方法时的检索顺序

1. 确认页面上的 **组件 id**。
2. 在 `references/components.md` 找到对应组件章节，查方法名与参数。
3. 在 `try` 里 `await` 调用；失败走统一 `showToast`。
4. 需要改查询条件时，优先改页面变量 / Query 入参，再 `refresh`。

---

## 已收录组件一览

| 组件 | 类型名 | 常用方法 |
|------|--------|----------|
| 数据列表 | ListView | `refresh`、`deleteOne` |
| 表单容器 | WdForm | `setValue`、`submit`、`clearValue`、`validate` |
| 数据表格 | WdTable | `refresh`、`refreshKeepPage`、`clearSelection`、`setSelectedKeys` |
| 弹窗 | WdModal | `open`、`close` |
| 顶部选项卡 | WdTopTab | `selectTab`；读 `selectedValue` |
| 侧边选项卡 | WdSideTab | `selectTab`；读 `selectedValue` |
| 日历 | WdCalendar | `setValue`、`setInitMonth`；读 `value` |
| 树 | WdTree | `searchNode`；读/写 `data`、`checkedCustom`、`treeInfo` |
| Canvas | WdCanvas | 无组件方法；用 `canvasInstance` / `canvasCtx` 标准绘图 API |
| 音频播放 | WdAudio | `play`、`pause`、`stop`、`seek`、`fastForward`、`backward` |
| 单行输入 | WdInput | `setValue`、`clearValue`、`setVisible`、`setDisabled`、`handleValidate` |
| 下拉单选 | WdSelect | `setValue`、`clearValue`、`setDisabled`、`handleValidate`；读 `value` / `item` |
| 下拉多选 | WdSelectMultiple | `setValue`（数组）、`clearValue`；读 `value` / `item`（均为数组） |
| 日期时间选择 | WdDate | `setValue`、`clearValue`；读 `value`（时间戳 number） |
| 日期区间选择 | WdDateRange | `setValue`([开始,结束])、`clearValue`；`value` 为时间戳数组 |
| 评分 | WdRating | `setValue`、`clearValue`；读 `value`（number） |
| 进度条 | WdProgress | 读/写 `value`（number）；官方方法表为空 |
| 标签选择 | WdTagSelect | `setValue`、`clearValue`；`value` 单选 string / 多选 array |

每个组件的完整方法表、属性表、事件出参、推荐用法与注意点见 `references/components.md`。

---

## 快速对照：最常用方法

| 场景 | 组件 | 方法 |
|------|------|------|
| 保存后刷新列表 | ListView | `$w.listView1.refresh('refreshFromStart')` |
| 保存后刷新表格（回第一页） | WdTable | `$w.table1.refresh()` |
| 刷新表格（保留当前页） | WdTable | `$w.table1.refreshKeepPage()` |
| 表单回填 | WdForm | `$w.form1.setValue({ value: { name: '张三' } })` |
| 表单校验 | WdForm | `await $w.form1.validate()` |
| 清空表单 | WdForm | `$w.form1.clearValue()` |
| 打开弹窗 | WdModal | `$w.modal1.open({ mode: 'edit', id })` |
| 关闭弹窗 | WdModal | `$w.modal1.close()` |
| 切换选项卡 | WdTopTab | `$w.topTab1.selectTab({ value: '2' })` |
| 选中树节点 | WdTree | 读 `$w.tree1.treeInfo?.checked?.[0]` |
| 设置输入框值 | WdInput | `$w.input1.setValue('文本')` |
| 设置下拉选中 | WdSelect | `$w.select1.setValue('optionValue')` |
| 设置日期 | WdDate | `$w.date1.setValue(timestamp)` |

---

## 通用约定

1. **组件 id 以页面大纲为准**，确认未被改名。
2. **方法调用前判断存在**：`if ($w.xxx?.method)`，避免组件未渲染时报错。
3. **列表刷新时机**：增删改成功后、筛选条件变化后再 `refresh`。
4. **表单 setValue 形态差异**：WdForm 用 `{ value: { ... } }`；WdInput/WdSelect 直接传值。
5. 每新增一个官方组件，在「已收录组件一览」增加一行，并在 `references/components.md` 追加对应章节。
