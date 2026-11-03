/* ============================================================
   第六轮迭代验收（UI 链路）：学员需求接单与教学资源分配
   ------------------------------------------------------------
   用无头 Chrome 真实点击，覆盖建议书十个验收场景：
     A. 教师接单中心（场景 1/2/3/4/5/9 部分）
        _ui6c.js  31 项：响应/撤回/暂不接单/词库申请/暂停教师不可见
     B. 教务确认与管理员分配（场景 1/6/9/10）
        _ui6d.js  34 项：七列列表/六项检查/换教师原子性/越权拦截
     C. 词库申请与授权（场景 7/8/10）
        _ui6e.js  34 项：审核/批量回滚/停用历史保留/三态分离/空态引导
   运行：node prototype/_test/r6-ui.js
   ============================================================ */
const { spawnSync } = require('child_process');
const path = require('path');

const parts = ['_ui6c.js', '_ui6d.js', '_ui6e.js'];
let fail = 0;
console.log('第六轮 UI 链路验收');
for (const f of parts) {
  console.log('\n—— ' + f + ' ——');
  const r = spawnSync(process.execPath, [path.join(__dirname, f)], { encoding: 'utf8' });
  process.stdout.write(r.stdout || '');
  if (r.stderr) process.stderr.write(r.stderr);
  if (r.status !== 0) fail++;
}
console.log('\n============================================================');
if (fail) {
  console.log(`  ${fail} 个场景脚本未全部通过（见上方 ✗）`);
  process.exit(1);
} else {
  console.log('  十个端到端场景全部通过');
}
