/** 整体验收·场景六：权限验证（六角色 + Store 直调整权，不靠前端）
 *  教师只能操作归属学员；家长只读自己关联学员；代理/家长不能改教学记录与复习计划；
 *  非授权不能经 Store 直调绕过。
 *  运行：node _test/r9-closure-perm.js
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
  const u = S.db.users.find(x => x.roleCode === r);
  const s = { role: r, accountId: u ? u.id : '', operatorId: u ? u.id : r, operatorName: r };
  if (r === 'teacher') { const tu = S.db.users.find(x => x.roleCode === 'teacher' && (x.teacherId === id)); s.teacherId = id; s.accountId = tu ? tu.id : ''; s.operatorId = id; s.operatorName = '教师'; }
  if (r === 'parent') { s.parentId = id; s.operatorId = id; s.operatorName = '家长'; }
  if (r === 'agent') { s.agentId = (S.db.agents || [])[0] ? S.db.agents[0].id : 'A001'; s.operatorId = s.agentId; s.operatorName = '代理'; }
  S.setSession(s);
}

console.log('\n== 整体验收·场景六 权限 ==');
/* 先取双亲与「其他家庭的孩子」（此时为管理员会话，parentChildren 不触发自我校验） */
role('admin');
const pa = (S.db.parents || [])[0], pb = (S.db.parents || [])[1];
const myKid = pa ? S.parentChildren(pa.id)[0] : null;
const otherKids = (pa && pb ? S.parentChildren(pb.id) : []).filter(k => !S.parentChildren(pa.id).some(x => x.id === k.id));

/* 备一个学员与任务：管理员建 teacherId=T001 的任务并进入队列 */
role('admin');
const sidA = 'S2026001';
const lento = S.db.teachers.map(t => t.id);
let stid = '', tidA = '';
for (const sid of S.db.students.map(s => s.id)) { const rel = S.activeRelationOfStudent(sid); if (rel && lento.indexOf(rel.teacherId) >= 0) { stid = sid; break; } }
let r = S.createTrainTask({ studentId: sidA, targetCount: 8, teacherId: 'T001' });
if (r.reused) { S.endTask(r.task.id, '清理'); r = S.createTrainTask({ studentId: sidA, targetCount: 8, teacherId: 'T001' }); }
tidA = r.task.id;
S.addWordbooksToTask(tidA, ['WB001']);
let t = S.trainTask(tidA); t.wordIds.slice(0, 8).forEach(id => S.prescreenAnswer(tidA, id, false));
S.finishPrescreen(tidA, { confirmShort: true });
const wordA = S.trainTask(tidA).queueWordIds[0];

/* 教师只能操作归属学员的任务 */
role('teacher', 'T002');
throws('教师B不能改教师A任务的展示', () => S.markTrainReinforce(tidA, wordA, true), '不属于当前教师');
throws('教师B不能完成教师A任务', () => S.completeTask(tidA, {}), '不属于当前教师');

/* 代理不能修改教学训练结果 / 复习计划 / 复习记录 */
role('agent');
throws('代理不能写复习记录', () => S.recordReview({ studentId: sidA, wordId: wordA, result: 'mastered' }), '不能修改教学训练结果');
throws('代理不能提交训练', () => S.completeTask(tidA, {}), '不能修改教学训练结果');
throws('代理不能标记需要强化', () => S.markTrainReinforce(tidA, wordA, true), '不能修改教学训练结果');

/* 家长不能修改正式状态（训练结果 / 复习计划 / 复习记录），但可只读自己关联学员 */
role('parent', pa.id);
throws('家长不能写复习记录', () => S.recordReview({ studentId: sidA, wordId: wordA, result: 'mastered' }), '不能修改教学训练结果');
throws('家长不能提交训练', () => S.completeTask(tidA, {}), '不能修改教学训练结果');
throws('家长不能生成报告', () => S.generateTrainingReport(tidA), '不能修改教学训练结果');
/* 家长只读：只能看自己关联学员的报告/计划（myKid / otherKids 已在顶部按管理员会话取好） */
ok('家长只读自己孩子的报告接口可用', Array.isArray(S.parentTrainingReports(pa.id, myKid.id)), myKid.id);
if (otherKids && otherKids[0]) {
  throws('家长不能访问其他家庭学员的训练报告', () => S.parentTrainingReports(pa.id, otherKids[0].id), '不在当前家长名下');
  throws('家长不能访问其他家庭学员的复习计划', () => S.parentReviewPlan(pa.id, otherKids[0].id), '不在当前家长名下');
} else console.log('  (无第二家庭跨访问样本，跳过)');

/* 管理员（管理端）保留能力：可写复习记录（角色守卫只拦代理/家长，不误伤管理端） */
role('admin');
let adminRec = false;
try { S.recordReview({ studentId: sidA, wordId: wordA, result: 'needs_practice', method: 'admin-op' }); adminRec = true; } catch (e) { console.log('   admin recordReview err:', e.message); }
ok('管理员可写复习记录(保留管理能力)', adminRec === true);

console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败');
process.exit(fail ? 1 : 0);