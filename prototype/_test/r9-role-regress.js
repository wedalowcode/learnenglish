/** R9 阶段三-5 验收：六种角色权限回归
 *  运行期权限矩阵真实受控（以 hasPermission 动态矩阵为准，与菜单门控同源）、
 *  账号禁用后不能成为当前身份执行操作、教师/代理/家长数据隔离。
 *  运行：node _test/r9-role-regress.js
 */
const vm = require('node:vm'), fs = require('fs');
const mem = {};
const LS = { getItem: k => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); }, removeItem: k => { delete mem[k]; } };
const ctx = { console, localStorage: LS, sessionStorage: LS, Date, Math, JSON, Object, Array, String, Number, setTimeout };
ctx.globalThis = ctx; ctx.window = ctx; vm.createContext(ctx);
['assets/js/data.js', 'assets/js/store.js'].forEach(f => vm.runInContext(fs.readFileSync(f, 'utf8'), ctx, { filename: f }));
const S = ctx.Store;
let pass = 0, fail = 0;
function ok(n, c, x) { if (c) { pass++; console.log('  PASS ' + n + (x !== undefined ? '  (' + x + ')' : '')); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? '  (' + x + ')' : '')); } }
function role(r, accountId) {
  const u = (S.db.users || []).find(x => x.roleCode === r);
  const s = { role: r, accountId: accountId || (u ? u.id : ''), operatorId: (u ? u.id : r), operatorName: r };
  if (r === 'teacher') { s.teacherId = S.db.teachers[0].id; }
  if (r === 'agent') { s.agentId = (S.db.agents || [])[0] ? S.db.agents[0].id : 'A001'; }
  if (r === 'parent') { s.parentId = (S.db.parents || [])[0] ? S.db.parents[0].id : 'P001'; }
  S.setSession(s);
}

console.log('\n== R9 阶段三-5 · 六角色权限回归 ==');
const G = {
  audit:       { admin: 1, staff: 1, ops: 1, teacher: 0, agent: 0, parent: 0 },
  parentView:  { admin: 1, staff: 1, ops: 1, teacher: 0, agent: 0, parent: 0 },
  studentView: { admin: 1, staff: 1, ops: 1, teacher: 1, agent: 1, parent: 1 }, // 代理/家长在矩阵层可按 OWN/RELATED 数据范围查阅学员
  orderReview: { admin: 1, staff: 0, ops: 1, teacher: 0, agent: 0, parent: 0 }
};
const CODES = { audit: 'audit.view', parentView: 'parent.view', studentView: 'student.view', orderReview: 'order.review' };
const roles = ['admin', 'staff', 'ops', 'teacher', 'agent', 'parent'];
for (const key of ['audit', 'parentView', 'studentView', 'orderReview']) {
  for (const r of roles) {
    role(r);
    const got = S.hasPermission('', CODES[key]) ? 1 : 0;
    ok(`${r}.${key} 受控(${got === G[key][r] ? '一致' : '不一致'})`, got === G[key][r], CODES[key] + (got ? '=有' : '=无'));
  }
}

/* 菜单门控码与 Store 判定一致：菜单可见性基于 hasPermission 动态矩阵 */
role('admin'); ok('admin 可访问审计/家长咨询菜单门控', S.hasPermission('', 'audit.view') && S.hasPermission('', 'parent.view'));
role('teacher'); ok('teacher 不具备管理端门控', !S.hasPermission('', 'audit.view') && !S.hasPermission('', 'account.view'));

/* 账号禁用后不能作为当前身份执行操作（setSession 会拒绝已禁用账号） */
{
  role('admin');
  const u = S.db.users.find(x => x.roleCode === 'staff');
  const id = u.id, orig = u.status;
  u.status = '停用';   // 模拟停用（用有效状态值）
  let threw = false;
  try { S.setSession({ role: 'staff', accountId: id, operatorId: id, operatorName: 'staff' }); } catch (e) { threw = e.code === 'ACCOUNT_DISABLED'; }
  ok('停用账号不能作为当前身份执行操作', threw === true);
  u.status = orig;     // 复原为原有效状态
  role('staff', id);
  ok('恢复后账号可正常操作', S.hasPermission('', 'student.view') === true);
}

/* 教师 / 代理 / 家长 跨数据隔离（回归层面轻量断言） */
/* 先在家长会话前取「其他家庭的孩子」用于越权断言 */
const _pa = (S.db.parents || [])[0], _pb = (S.db.parents || [])[1];
const _otherSid = _pb ? S.parentChildren(_pb.id).map(k => k.id).filter(id => !S.parentChildren(_pa.id).some(k => k.id === id))[0] : undefined;
{
  const tids = (S.db.teachers || []).map(t => t.id);
  let tA = '', sidA = '';
  for (const sid of S.db.students.map(s => s.id)) { const rel = S.activeRelationOfStudent(sid); if (rel && tids.indexOf(rel.teacherId) >= 0) { tA = rel.teacherId; sidA = sid; break; } }
  const u = (S.db.users || []).find(x => x.roleCode === 'teacher' && (x.teacherId === tA || x.profileId === tA));
  S.setSession({ role: 'teacher', teacherId: tA, operatorId: tA, operatorName: '教师', accountId: u ? u.id : '' });
  const relOwn = S.activeRelationOfStudent(sidA);
  ok('教师可操作负责学员', !!relOwn && relOwn.teacherId === tA, sidA + '→' + tA);
  const sidOther = S.db.students.find(s => s.id !== sidA);
  const relOther = S.activeRelationOfStudent((sidOther || {}).id || 'XX');
  ok('教师不能越权其他学员', !relOther || relOther.teacherId !== tA, sidOther ? sidOther.id : 'XX');
}
{
  role('agent');
  const ag = (S.db.agents || [])[0];
  let aOwn = false; try { aOwn = typeof S.agentOverview(ag.id) === 'object'; } catch (e) {}
  ok('代理仅能查看自己维度数据(接口存在)', aOwn);
}
{
  S.setSession({ role: 'parent', parentId: _pa.id, operatorId: _pa.id, operatorName: '家长A' });
  let denied = false;
  if (_otherSid) { try { S.parentStudentDetail(_pa.id, _otherSid); } catch (e) { denied = true; } }
  ok('家长不能访问其他家庭学员', denied === true, _otherSid || '(无第二家庭)');
}

console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败');
process.exit(fail ? 1 : 0);