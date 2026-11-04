/** R9 整体流程验收：场景一~四 串行跑通（多词库筛选 → 强化训练 → 最后复习 → 异常权限）
 *  运行：node _test/r9-scenario-e2e.js
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
function role(r, t) {
  if (r === 'admin') { const u = (S.db.users || []).find(x => x.roleCode === 'admin'); S.setSession({ role: 'admin', accountId: u ? u.id : '', operatorId: u ? u.id : 'admin', operatorName: '管理员' }); }
  if (r === 'teacher') { const u = (S.db.users || []).find(x => x.roleCode === 'teacher' && (x.teacherId === t || x.profileId === t)); S.setSession({ role: 'teacher', teacherId: t, operatorId: t, operatorName: '教师', accountId: u ? u.id : '' }); }
}

console.log('\n== R9 整体流程（场景一~四）==');
const sidA = 'S2026001';
const b1 = 'WB001', b2 = 'WB002';
const knowns = [];

/* ---- 场景一：多词库动态筛选 + 去重 + 认识入绿盒（管理员建任务并指定归属 T001，绕过教师授权限制） ---- */
role('admin');
let r = S.createTrainTask({ studentId: sidA, targetCount: 45, teacherId: 'T001' });
if (r.reused) { S.endTask(r.task.id, '清理'); r = S.createTrainTask({ studentId: sidA, targetCount: 45, teacherId: 'T001' }); }
const t1 = r.task;
ok('场景一-任务归属为 T001', S.trainTask(t1.id).teacherId === 'T001');
const add = S.addWordbooksToTask(t1.id, [b1, b2]);
ok('场景一-添加两个词库', add.added.length === 2 && add.pool >= 40, add.added.map(x => x.id).join(',') + ' pool=' + add.pool);
const cands = S.prescreenCandidates(t1.id, { all: true });
const dupIds = cands.map(c => c.id).filter((id, i, a) => a.indexOf(id) !== i);
ok('场景一-重复基础词只出现一次', dupIds.length === 0, 'cands=' + cands.length);
const shared = cands.filter(c => (c.sourceBooks || []).length > 1);
ok('场景一-共享词保留来源词库信息', shared.length > 0, 'share=' + shared.length);
/* 逐行判断：偶数标认识（进绿盒），奇数标不认识 */
let i = 0; let tk = S.trainTask(t1.id);
tk.wordIds.forEach(id => { const known = (i++ % 2) === 0; S.prescreenAnswer(t1.id, id, known); if (known) knowns.push(id); });
ok('场景一-认识词进绿盒', knowns.length > 0 && knowns.every(id => { const ls = S.leitnerState(sidA, id); return ls && ls.box === 'green'; }), knowns.length);
const fpa = S.finishPrescreen(t1.id, { confirmShort: true });
tk = S.trainTask(t1.id);
ok('场景一-生成训练队列(只含不认识、无重复)', fpa.ok === true && tk.queueWordIds.every(id => knowns.indexOf(id) < 0) && tk.queueWordIds.length === (new Set(tk.queueWordIds)).size, 'queue=' + tk.queueWordIds.length);
const queued = tk.queueWordIds.slice();

/* ---- 场景二：强化训练（回到教师 T001 操作归属任务） ---- */
role('teacher', 'T001');
let guard = 0;
while (!S.displayStat(t1.id).allDone && guard < 300) {
  const cur = S.displayStat(t1.id).currentGroup;
  cur.words.forEach(wt => { if (wt.step < 3) S.trainDisplayTap(t1.id, wt.id); });
  const s2 = S.displayStat(t1.id);
  if (s2.currentComplete && s2.groupIndex < s2.groupCount - 1) S.setTrainGroup(t1.id, s2.groupIndex + 1);
  guard++;
}
const ds = S.displayStat(t1.id);
ok('场景二-全部组完成', ds.allDone && ds.done === ds.total, ds.done + '/' + ds.total);
ok('场景二-展示阶段不产生掌握判断', Object.keys(S.trainTask(t1.id).results).length === 0);
ok('场景二-最后组不足5时规模正确', ds.groups[ds.groupCount - 1].total <= 5, 'last=' + ds.groups[ds.groupCount - 1].total);
const toFin = S.toFinalStage(t1.id);
ok('场景二-进入最后复习', toFin.ok === true, toFin.task.phase);

/* ---- 场景三：最后复习（列表式判断 + 可修改 + 提交衔接体系） ---- */
queued.forEach((id, k) => S.finalJudge(t1.id, id, (k % 10) < 7 ? 'yes' : 'no', ''));
const sw = queued.filter(id => S.trainTask(t1.id).finalResults[id].result === 'yes')[0];
S.finalJudge(t1.id, sw, 'no', '');
ok('场景三-提交前可修改且以最终为准', S.trainTask(t1.id).finalResults[sw].result === 'no');
const need = queued.filter(id => S.trainTask(t1.id).finalResults[id].result === 'no');
ok('场景三-待复习=不认识', need.length > 0, need.length);
const cp = S.completeTask(t1.id, { joinLeitner: true, joinPlan21: true, joinGreen: false, by: '李婉' });
ok('场景三-提交成功', cp.ok === true && S.trainTask(t1.id).status === '已完成');
ok('场景三-待复习词衔接莱特纳', need.every(id => { const s = S.leitnerState(sidA, id); return s && (s.box === 'red' || s.manualToday); }));
ok('场景三-生成 21 天计划且覆盖待复习', S.plansOf(sidA).filter(p => p.note.indexOf('训练任务 ' + t1.id) >= 0).length === 1);
ok('场景三-未勾绿盒则待复习不入绿盒', !S.trainTask(t1.id).joins.green.length);

/* ---- 场景四：异常与权限 ---- */
role('teacher', 'T002');
throws('场景四-教师B操作教师A任务被拒', () => S.trainDisplayTap(t1.id, queued[0]), '不属于当前教师');
throws('场景四-教师B最后复习被拒', () => S.finalJudge(t1.id, queued[0], 'yes'), '不属于当前教师');
throws('场景四-教师B读取审计被拒', () => S.auditRows({}), '无权执行');
role('teacher', 'T001');
ok('场景四-原教师仍看到任务已提交', S.trainTask(t1.id).status === '已完成');

console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败');
process.exit(fail ? 1 : 0);