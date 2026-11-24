# 微搭自定义 JSX 组件交互模式

> 写复杂自定义组件时查这个。每个模式含要点与完整代码骨架。

---

## 目录

1. [可搜索下拉（多行）](#1-可搜索下拉多行)
2. [行内表格编辑器](#2-行内表格编辑器)
3. [联动子表（大类→中类→权限）](#3-联动子表大类中类权限)
4. [状态同步与汇总重算](#4-状态同步与汇总重算)

---

## 1. 可搜索下拉（多行）

### 要点

- 每行独立状态：`empSearch[index]`、`empDropdownOpen[index]`、`empDropdownPos[index]`
- `useRef` 存 input，用 `getBoundingClientRect` 算 fixed 定位
- 全屏透明遮罩点击关闭
- 选项过滤：关键词 + **排除其他行已选中的人**（防重复）
- 选择时写入 `employee_id` + `name`，清空时两字段一起清

### 骨架

```tsx
export default function EmployeeSelectEditor(props) {
  const { $w, style } = props;
  const inputRefs = React.useRef({});

  const [rows, setRows] = React.useState(() => {
    const existed = $w.page.dataset.state.emp_rows;
    return Array.isArray(existed) && existed.length ? existed : [{ employee_id: '', name: '', amount: 0 }];
  });

  const [search, setSearch] = React.useState({});
  const [open, setOpen] = React.useState({});
  const [pos, setPos] = React.useState({});

  const allEmployees = $w.page.dataset.state.employee_list || [];

  const syncToPage = (next) => {
    setRows(next);
    $w.page.dataset.state.emp_rows = next;
  };

  const getFilteredOptions = (index) => {
    const keyword = (search[index] || '').trim();
    const selectedIds = rows
      .filter((_, i) => i !== index)
      .map((r) => r.employee_id)
      .filter(Boolean);
    return allEmployees
      .filter((emp) => !selectedIds.includes(emp._id))
      .filter((emp) => !keyword || (emp.name || '').includes(keyword));
  };

  const handleSelect = (index, emp) => {
    const next = rows.map((r, i) =>
      i === index ? { ...r, employee_id: emp._id, name: emp.name } : r
    );
    syncToPage(next);
    setOpen({ ...open, [index]: false });
    setSearch({ ...search, [index]: '' });
  };

  const handleClear = (index) => {
    const next = rows.map((r, i) =>
      i === index ? { ...r, employee_id: '', name: '' } : r
    );
    syncToPage(next);
  };

  const openDropdown = (index) => {
    const el = inputRefs.current[index];
    if (el) {
      const rect = el.getBoundingClientRect();
      setPos({ ...pos, [index]: { top: rect.bottom, left: rect.left, width: rect.width } });
    }
    setOpen({ ...open, [index]: true });
  };

  const inputStyle = { width: '100%', padding: '4px 8px', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '14px' };
  const dropdownStyle = (p) => ({
    position: 'fixed', top: `${p.top}px`, left: `${p.left}px`, width: `${p.width}px`,
    maxHeight: '200px', overflowY: 'auto', background: 'white',
    border: '1px solid #d1d5db', borderRadius: '4px', zIndex: 9999, boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
  });

  return (
    <div style={{ ...(style || {}), width: '100%' }}>
      {rows.map((row, index) => (
        <div key={index} style={{ display: 'flex', gap: '8px', marginBottom: '8px', alignItems: 'center' }}>
          <div style={{ position: 'relative', flex: 1 }}>
            <input
              ref={(el) => { inputRefs.current[index] = el; }}
              style={inputStyle}
              value={row.name || search[index] || ''}
              placeholder="搜索姓名"
              onFocus={() => openDropdown(index)}
              onChange={(e) => {
                setSearch({ ...search, [index]: e.target.value });
                if (!open[index]) openDropdown(index);
              }}
            />
            {row.employee_id && (
              <span onClick={() => handleClear(index)} style={{ cursor: 'pointer', marginLeft: '4px', color: '#e34d59' }}>✕</span>
            )}
          </div>
          {open[index] && pos[index] && (
            <>
              <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 9998 }}
                   onClick={() => setOpen({ ...open, [index]: false })} />
              <div style={dropdownStyle(pos[index])}>
                {getFilteredOptions(index).map((emp) => (
                  <div key={emp._id} onClick={() => handleSelect(index, emp)}
                       style={{ padding: '8px 12px', cursor: 'pointer', borderBottom: '1px solid #f3f4f6' }}
                       onMouseEnter={(e) => e.target.style.background = '#e8f3ff'}
                       onMouseLeave={(e) => e.target.style.background = 'white'}>
                    {emp.name}
                  </div>
                ))}
                {getFilteredOptions(index).length === 0 && (
                  <div style={{ padding: '12px', color: '#9ca3af', textAlign: 'center' }}>无匹配人员</div>
                )}
              </div>
            </>
          )}
        </div>
      ))}
    </div>
  );
}
```

---

## 2. 行内表格编辑器

### 要点

- `addRow` / `removeRow`（删时若有 `_id` 推入 deleted 数组）
- 序号在 `syncToPage` 里重排 `seq: i + 1`
- 金额 `onChange` + `onBlur` 规范化为非负两位小数
- 删除按钮字色 `#e34d59`

### 骨架

```tsx
export default function DetailTableEditor(props) {
  const { $w, style } = props;

  const [rows, setRows] = React.useState(() => {
    const existed = $w.page.dataset.state.detail_rows;
    return Array.isArray(existed) && existed.length ? existed : [];
  });

  React.useEffect(() => {
    const list = $w.page.dataset.state.detail_rows;
    if (Array.isArray(list)) setRows(list);
  }, [$w.page.dataset.state.detail_rows]);

  const syncToPage = (next) => {
    // 序号重排
    const renumbered = next.map((r, i) => ({ ...r, seq: i + 1 }));
    setRows(renumbered);
    $w.page.dataset.state.detail_rows = renumbered;
    // 汇总重算
    const total = renumbered.reduce((sum, r) => sum + Number(r.amount || 0), 0);
    $w.page.dataset.state.detail_total_amount = Number(total.toFixed(2));
    $w.page.dataset.state.detail_person_count = renumbered.length;
  };

  const addRow = () => {
    syncToPage([...rows, { seq: rows.length + 1, amount: 0, remark: '' }]);
  };

  const removeRow = (index) => {
    const row = rows[index];
    const next = rows.filter((_, i) => i !== index);
    if (row._id) {
      const deleted = $w.page.dataset.state.detail_deleted || [];
      $w.page.dataset.state.detail_deleted = [...deleted, row._id];
    }
    syncToPage(next);
  };

  const updateField = (index, field, value) => {
    const next = rows.map((r, i) => i === index ? { ...r, [field]: value } : r);
    syncToPage(next);
  };

  const normalizeAmount = (index, value) => {
    const num = Math.max(0, Number(value) || 0);
    updateField(index, 'amount', Number(num.toFixed(2)));
  };

  const th = { padding: '8px 12px', borderBottom: '2px solid #e5e7eb', textAlign: 'left', fontSize: '14px', fontWeight: 600, color: '#374151' };
  const td = { padding: '8px 12px', borderBottom: '1px solid #f3f4f6', fontSize: '14px' };
  const inputStyle = { width: '100%', padding: '4px 8px', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '14px' };

  return (
    <div style={{ ...(style || {}), width: '100%' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={{ ...th, width: '40px' }}>序号</th>
            <th style={th}>备注</th>
            <th style={{ ...th, width: '120px' }}>金额</th>
            <th style={{ ...th, width: '60px' }}>操作</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={row._id || index}>
              <td style={td}>{row.seq}</td>
              <td style={td}>
                <input style={inputStyle} value={row.remark || ''}
                       onChange={(e) => updateField(index, 'remark', e.target.value)} />
              </td>
              <td style={td}>
                <input type="number" style={inputStyle} value={row.amount ?? 0}
                       onChange={(e) => updateField(index, 'amount', e.target.value)}
                       onBlur={(e) => normalizeAmount(index, e.target.value)} />
              </td>
              <td style={td}>
                <span onClick={() => removeRow(index)}
                      style={{ cursor: 'pointer', color: '#e34d59', fontSize: '14px' }}>删除</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button onClick={addRow}
              style={{ marginTop: '8px', padding: '6px 16px', background: '#0052d9', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '14px' }}>
        + 添加行
      </button>
    </div>
  );
}
```

---

## 3. 联动子表（大类→中类→权限）

### 要点

- 组件内 `SUB_MAP` / `PERM_MAP` 的 key 与大类 value 一致
- 改大类清空中类/权限
- 多选存标识数组（`['11','12']`），单选存标识

### 骨架

```tsx
export default function PermissionEditor(props) {
  const { $w, style } = props;

  const SUB_MAP = {
    '1': [{ label: '查看', value: '11' }, { label: '编辑', value: '12' }],
    '2': [{ label: '审批', value: '21' }, { label: '归档', value: '22' }],
  };

  const PERM_MAP = {
    '11': [{ label: '本人', value: '111' }, { label: '全部', value: '112' }],
    '12': [{ label: '本人', value: '121' }, { label: '部门', value: '122' }],
  };

  const [rows, setRows] = React.useState(() => {
    const existed = $w.page.dataset.state.perm_rows;
    return Array.isArray(existed) && existed.length ? existed : [{ main_type: '', sub_type: '', permissions: [] }];
  });

  const syncToPage = (next) => {
    setRows(next);
    $w.page.dataset.state.perm_rows = next;
  };

  const handleMainChange = (index, value) => {
    const next = rows.map((r, i) =>
      i === index ? { ...r, main_type: value, sub_type: '', permissions: [] } : r
    );
    syncToPage(next);
  };

  const handleSubChange = (index, value) => {
    const next = rows.map((r, i) =>
      i === index ? { ...r, sub_type: value, permissions: [] } : r
    );
    syncToPage(next);
  };

  const handlePermToggle = (index, value) => {
    const row = rows[index];
    const current = row.permissions || [];
    const nextPerms = current.includes(value)
      ? current.filter((v) => v !== value)
      : [...current, value];
    const next = rows.map((r, i) =>
      i === index ? { ...r, permissions: nextPerms } : r
    );
    syncToPage(next);
  };

  const tagSelected = { border: '1px solid #0052d9', background: '#e8f3ff', color: '#0052d9' };
  const tagNormal = { border: '1px solid #d1d5db', background: 'white', color: '#374151' };
  const tagBase = { padding: '4px 12px', borderRadius: '4px', cursor: 'pointer', fontSize: '13px', display: 'inline-block', marginRight: '8px' };

  return (
    <div style={{ ...(style || {}), width: '100%' }}>
      {rows.map((row, index) => (
        <div key={index} style={{ display: 'flex', gap: '12px', marginBottom: '12px', alignItems: 'flex-start' }}>
          {/* 大类 */}
          <select value={row.main_type} onChange={(e) => handleMainChange(index, e.target.value)}
                  style={{ padding: '4px 8px', border: '1px solid #d1d5db', borderRadius: '4px' }}>
            <option value="">选择大类</option>
            <option value="1">管理</option>
            <option value="2">业务</option>
          </select>
          {/* 中类（联动） */}
          <select value={row.sub_type}
                  onChange={(e) => handleSubChange(index, e.target.value)}
                  disabled={!row.main_type}
                  style={{ padding: '4px 8px', border: '1px solid #d1d5db', borderRadius: '4px' }}>
            <option value="">选择中类</option>
            {(SUB_MAP[row.main_type] || []).map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
          {/* 权限（多选标签） */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
            {(PERM_MAP[row.sub_type] || []).map((p) => {
              const selected = (row.permissions || []).includes(p.value);
              return (
                <span key={p.value}
                      style={{ ...tagBase, ...(selected ? tagSelected : tagNormal) }}
                      onClick={() => handlePermToggle(index, p.value)}>
                  {p.label}
                </span>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
```

---

## 4. 状态同步与汇总重算

### 要点

所有自定义组件的核心模式：

```tsx
const syncToPage = (next) => {
  // 1. 重排序号（表格类）
  const renumbered = next.map((r, i) => ({ ...r, seq: i + 1 }));
  setRows(renumbered);
  // 2. 写回页面 state
  $w.page.dataset.state.xxx_rows = renumbered;
  // 3. 重算汇总
  const total = renumbered.reduce((sum, r) => sum + Number(r.amount || 0), 0);
  $w.page.dataset.state.xxx_total_amount = Number(total.toFixed(2));
  $w.page.dataset.state.xxx_person_count = renumbered.length;
};
```

### 删除时收集 _id

```tsx
const removeRow = (index) => {
  const row = rows[index];
  if (row._id) {
    const deleted = $w.page.dataset.state.xxx_deleted || [];
    $w.page.dataset.state.xxx_deleted = [...deleted, row._id];
  }
  syncToPage(rows.filter((_, i) => i !== index));
};
```

### 提交方法对接

提交方法只读 state，不直接操作组件：

```javascript
// 在 weda-custom-method 技能的提交方法里
const detailRows = $w.page.dataset.state.xxx_rows || [];
const deletedIds = ($w.page.dataset.state.xxx_deleted || []).filter(Boolean);
// → wedaBatchDeleteV2(deletedIds) → wedaUpdateV2(已有) → wedaBatchCreateV2(新增)
```
