# 微搭云函数 Skill

## 文件

| 文件 | 说明 |
|------|------|
| `SKILL.md` | Skill 正文（加载到 AI）— 云函数骨架、app.models CRUD、updateMany 降级、返回结构 |
| `references/api-cloud.md` | 完整云函数 API 参考：SDK 初始化、list/update/updateMany、Filter 运算符、关联读写、实战示例 |
| `README.md` | 本说明 |

## 安装

1. 目录名必须为 `weda-cloud-function`
2. 放入 `SKILL.md`
3. 可选保留 `references/api-cloud.md`（推荐保留，写代码时查参数）
4. 拷贝到 Cursor / Trae / 其他 Agent Skills 目录

## 触发说法示例

- 「写一个微搭云函数，定时关闭过期申请」
- 「帮我写 app.models 批量更新状态」
- 「云函数里怎么查多条数据」
- 「updateMany 不支持怎么办」

## 配套技能

| 技能 | 管什么 |
|------|--------|
| **本技能** | 云函数骨架、app.models、服务端批量逻辑 |
| `weda-custom-method` | 前端调云函数 `$w.cloud.callFunction`、按钮事件 |
| `weda-component-jsx` | 自定义 JSX 组件 |
| `weda-component-api` | 内置组件实例方法速查 |
