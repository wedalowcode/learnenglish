# 微搭自定义 JSX 组件 Skill

## 文件

| 文件 | 说明 |
|------|------|
| `SKILL.md` | Skill 正文（加载到 AI）— JSX 骨架、状态同步约定、枚举/样式、检查清单 |
| `references/patterns.md` | 完整交互模式：可搜索下拉（多行）、行内表格编辑器、联动子表 |
| `README.md` | 本说明 |

## 安装

1. 目录名必须为 `weda-component-jsx`
2. 放入 `SKILL.md`
3. 可选保留 `references/patterns.md`（推荐保留，写复杂组件时查模式）
4. 拷贝到 Cursor / Trae / 其他 Agent Skills 目录

## 触发说法示例

- 「写一个微搭自定义 JSX 组件，多行可搜索下拉选人」
- 「帮我写行内表格编辑器，能增删行、序号重排」
- 「自定义组件怎么和提交方法同步数据」
- 「联动子表，改大类清空中类」

## 配套技能

| 技能 | 管什么 |
|------|--------|
| **本技能** | 自定义 JSX 组件骨架、状态同步、交互模式 |
| `weda-component-api` | 内置组件实例方法速查 |
| `weda-custom-method` | 提交方法（读组件 state 后调数据源） |
| `weda-cloud-function` | 云函数 |
