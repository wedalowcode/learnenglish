---
name: weda-component-jsx
description: 编写微搭（CloudBase WeDa）自定义 JSX 组件。覆盖可搜索下拉、行内表格编辑器、联动子表、状态同步约定、React hooks 用法。Use when user asks for 微搭自定义组件, JSX表格, 可搜索下拉, 行内编辑器, 自定义JSX, or WeDa custom React component patterns.
---

# 微搭自定义 JSX 组件开发规范

基于大华瑞云等项目实战提炼。本技能只管**自定义 JSX 组件**（可搜索下拉、行内表格编辑器、联动子表）；内置组件实例方法速查见 `weda-component-api`，自定义方法见 `weda-custom-method`。

## 何时使用 / 何时不用

**使用：**
- 写/改自定义 JSX 组件（可搜索下拉、行内表格编辑器、联动子表）
- 组件需要与页面 `dataset.state` 双向同步明细数据
- 内置组件无法满足的复杂交互（多行独立下拉、序号重排、金额联动）

**不使用：**
- 查 `$w.listView1.refresh()` 等内置组件方法（用 `weda-component-api`）
- 前端按钮事件、表单提交逻辑（用 `weda-custom-method`）
- 纯视觉样式调整（用编辑器属性面板）

---

## 强制骨架

```tsx
export default function XxxEditor(props) {
  const { $w, style } = props;

  const [rows, setRows] = React.useState(() => {
    const existed = $w.page.dataset.state.xxx_rows;
    return Array.isArray(existed) && existed.length ? existed : [];
  });

  React.useEffect(() => {
    const list = $w.page.dataset.state.xxx_rows;
    if (Array.isArray(list)) setRows(list);
  }, [$w.page.dataset.state.xxx_rows]);

  const syncToPage = (next) => {
    setRows(next);
    $w.page.dataset.state.xxx_rows = next;
    // 派生汇总字段一并写入 page.dataset.state
  };

  return (
    <div style={{ ...(style || {}), width: '100%' }}>
      {/* UI */}
    </div>
  );
}
```

---

## 状态同步约定（核心）

自定义组件与提交方法之间的数据通道是 **`$w.page.dataset.state`**：

| 数据 | state key 约定 | 谁写 | 谁读 |
|------|----------------|------|------|
| 明细行数组 | `xxx_detail_rows` | 组件 `syncToPage` | 提交方法 |
| 已删明细 ID | `xxx_detail_deleted` | 组件 `removeRow` | 提交方法（batchDelete）|
| 汇总金额 | `xxx_total_amount` | 组件 `syncToPage` 重算 | 展示/提交 |
| 汇总数量 | `xxx_person_count` | 组件 `syncToPage` 重算 | 展示/提交 |

**原则：** 提交方法只读 `page.dataset.state`，组件负责写。

---

## 枚举与选项集

- 单选存选项标识（`'1'`~`'8'`），不存中文
- 多选存标识数组（`['11','12']`）
- 组件内 `SUB_MAP` / `PERM_MAP` 的 key 与大类 value 一致
- 枚举 value 与选项集标识一致

---

## 样式习惯

- 表头/单元格用对象常量 `th`、`td`、`inputStyle`
- 多选标签选中态：边框 `#0052d9`、背景 `#e8f3ff`
- 主按钮蓝 `#0052d9`，危险操作字色 `#e34d59`
- 外层 `div` 必须带 `style={{ ...(style || {}), width: '100%' }}`

---

## 常用交互模式速查

| 模式 | 要点 |
|------|------|
| 多行可搜索下拉 | 每行独立 state，按 index 隔离；排除其他行已选中项防重复 |
| 行内表格编辑器 | addRow/removeRow；删时若有 `_id` 推入 deleted；序号在 syncToPage 重排 |
| 金额输入 | onChange + onBlur 规范化为非负两位小数 `Number(x.toFixed(2))` |
| 联动清空 | 改大类清空中类/权限 |
| 汇总重算 | syncToPage 里遍历 rows 重算 total/count |

---

## 产出检查清单

- [ ] `syncToPage` 写回 `page.dataset.state`
- [ ] 初始值从 `page.dataset.state` 读取（兼容空数组）
- [ ] `useEffect` 监听外部 state 变化
- [ ] 多行下拉按 index 隔离状态
- [ ] 删除收集 `_id` 到 deleted 列表
- [ ] 与提交方法字段名一致
- [ ] 金额 toFixed(2)
- [ ] 序号在 syncToPage 里重排 `seq: i + 1`
- [ ] 枚举存标识不存中文

---

## 通用约定

1. **字段名**与提交方法约定一致（如 `detail_rows`、`detail_deleted`）。
2. **数据源名称**写进注释，提交方法里用。
3. 组件不直接调 `callDataSource`；数据读写交给提交方法，组件只管 UI 与 state 同步。
4. 业务口径以项目确认结果为准，在代码注释标明。
5. 详细模式与完整代码见 `references/patterns.md`。

---

## 与其他技能的协作

| 需求 | 用哪个技能 |
|------|-----------|
| 写自定义 JSX 组件（本技能） | `weda-component-jsx` |
| 查内置组件 `$w.listView1.refresh()` | `weda-component-api` |
| 写提交方法（读组件 state 后调数据源） | `weda-custom-method` |
