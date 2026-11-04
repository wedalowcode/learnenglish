/** R9 阶段三-4 验收：操作审计读取入口的 Store 层权限校验
 *  无 audit.view 的用户直接调用 auditRows/auditOf/auditStat 被拒；
 *  有权限（admin/staff/ops）功能不受影响。
 *  运行：node _test/r9-audit-perm.js
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
function throws(n, fn, sub) { try { fn(); fail++; console.log('  FAIL ' + n + '  — 未抛错'); } catch (e) { const m = String((e && e.message) || e); if (!sub || m.indexOf(sub) >= 0) { pass++; console.log('  PASS ' + n + '  (' + m + ')'); } else { fail++; console.log('  FAIL ' + n + '  — 错误不符:' + m); } } }
function role(r, id) {
  const s = { role: r };
  if (r === 'parent') { s.parentId = id; s.operatorId = id; s.operatorName = '家长'; }
  if (r === 'teacher') { s.teacherId = id; s.operatorId = id; s.operatorName = '教师'; }
  if (r === 'admin' || r === 'staff' || r === 'ops') {
    const u = (S.db.users || []).find(x => x.roleCode === r);
    s.accountId = u ? u.id : ''; s.operatorId = s.accountId || r; s.operatorName = r;
  }
  if (r === 'agent') { s.agentId = S.db.agents ? (S.db.agents[0] || {}).id : 'A001'; s.operatorId = s.agentId; s.operatorName = '代理'; }
  S.setSession(s);
}

console.log('\n== R9 阶段三-4 · 审计读取权限 ==');
/* 无权限角色直接调用被拒 */
role('teacher', 'T001');
throws('teacher 调 auditRows 被拒', () => S.auditRows({}), '无权执行该操作');
throws('teacher 调 auditStat 被拒', () => S.auditStat(), '无权执行该操作');
throws('teacher 调 auditOf 被拒', () => S.auditOf('A1'), '无权执行该操作');
role('parent', (S.db.parents || [])[0] ? S.db.parents[0].id : 'P001');
throws('parent 调 auditRows 被拒', () => S.auditRows({}), '无权执行该操作');
role('agent', 'A001');
throws('agent 调 auditRows 被拒', () => S.auditRows({}), '无权执行该操作');

/* 有权限角色功能不受影响 */
role('admin');
const arows = S.auditRows({});
ok('admin 可读 auditRows', Array.isArray(arows) && arows.length >= 0, arows.length + ' 条');
const astat = S.auditStat();
ok('admin 可读 auditStat', typeof astat.total === 'number', 'total=' + astat.total);
const any = arows[0];
if (any) ok('admin 可读 auditOf', (S.auditOf(any.id) || {}).id === any.id, any.id);
else ok('admin 可读 auditOf(空库跳过)', true);
role('staff');
ok('staff 可读 auditRows', Array.isArray(S.auditRows({})));
role('ops');
ok('ops 可读 auditRows', Array.isArray(S.auditRows({})));

console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败');
process.exit(fail ? 1 : 0);