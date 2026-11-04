/** R9 阶段三-2 验收：训练目标上限固定 45
 *  验证：TARGET_RANGE.max=45、>45 建任务被拒、候选>目标时队列封顶且未入队候选保留、
 *        候选<目标时缺 confirmShort 拒绝、confirmShort 后按实际开始。
 *  运行：node _test/r9-target-cap.js
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
function roleAdmin() {
  const u = (S.db.users || []).find(x => x.roleCode === 'admin');
  S.setSession({ role: 'admin', operatorId: u ? u.id : 'admin', operatorName: '管理员', accountId: u ? u.id : '' });
}
function throws(n, fn, sub) { try { fn(); fail++; console.log('  FAIL ' + n + '  — 未抛错'); } catch (e) { const m = String((e && e.message) || e); if (!sub || m.indexOf(sub) >= 0) { pass++; console.log('  PASS ' + n + '  (' + m + ')'); } else { fail++; console.log('  FAIL ' + n + '  — 错误不符:' + m); } } }
/* 结束已有未完成任务，保证新建任务是「新任务」而非复用 */
function freshTask(sid, target) {
  let r = S.createTrainTask({ studentId: sid, targetCount: target });
  if (r.reused) { try { S.endTask(r.task.id, '测试清理'); } catch (e) {} r = S.createTrainTask({ studentId: sid, targetCount: target }); }
  return r.task;
}

console.log('\n== R9 阶段三-2 · 训练目标上限 45 ==');
roleAdmin();
ok('TARGET_RANGE.max = 45', S.TARGET_RANGE.max === 45, S.TARGET_RANGE.max);

/* >45 拒绝（数据层校验） */
throws('目标 46 建任务被拒', () => S.createTrainTask({ studentId: 'S2026001', targetCount: 46 }), '训练目标数量需在');

/* =45 可建 */
const c45 = S.createTrainTask({ studentId: 'S2026002', targetCount: 45 });
ok('目标 45 可建任务', c45.ok && c45.task.targetCount === 45, c45.task.id);
try { S.endTask(c45.task.id, '测试清理'); } catch (e) {}

/* 候选 > 目标：队列封顶、未入队候选保留 */
const tCap = freshTask('S2026001', 10);   // 小目标便于用 WB001(23词) 制造超额
S.addWordbooksToTask(tCap.id, ['WB001']);
let cap = S.trainTask(tCap.id);
cap.wordIds.forEach(id => S.prescreenAnswer(tCap.id, id, false));
cap = S.trainTask(tCap.id);
ok('候选 23 > 目标 10', cap.candidateWordIds.length > 10, cap.candidateWordIds.length);
const fpCap = S.finishPrescreen(tCap.id, {});
cap = S.trainTask(tCap.id);
ok('队列封顶到目标(10)', cap.queueWordIds.length === 10, cap.queueWordIds.length);
ok('未入队候选保留为 remain', cap.remainWordIds.length === cap.candidateWordIds.length - 10, cap.remainWordIds.length);
ok('remain 仍为待强化训练(不丢失)', cap.remainWordIds.every(id => S.wordState('S2026001', id).state === '待强化训练'));
try { S.endTask(tCap.id, '测试清理'); } catch (e) {}

/* 候选 < 目标：无 confirmShort 拒绝、confirmShort 后按实际开始 */
/* 复用任何被 INTERRUPTED/进行中的任务都会被 isOpen 复用，故选一个无未完成任务的新学员 */
let low = null;
for (const sid of S.db.students.map(s => s.id)) {
  const r = S.createTrainTask({ studentId: sid, targetCount: 45 });
  if (!r.reused) { low = r.task; break; }
}
ok('找到无未完成任务的新学员', !!low, low ? low.id + '/' + low.studentId : 'none');
if (!low) { console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败'); process.exit(fail ? 1 : 0); }
S.addWordbooksToTask(low.id, ['WB001']);
low = S.trainTask(low.id);
low.wordIds.slice(0, 8).forEach(id => S.prescreenAnswer(low.id, id, false));
low = S.trainTask(low.id);
const rSh = S.finishPrescreen(low.id, {});
ok('候选不足且未确认被拒(可确认)', rSh.ok === false && rSh.reason === 'SHORT_OF_TARGET' && rSh.canConfirm === true, 'cand=' + rSh.candidate + ' target=' + rSh.target);
const rOk = S.finishPrescreen(low.id, { confirmShort: true });
low = S.trainTask(low.id);
ok('confirmShort 后按实际开始', rOk.ok === true && low.queueWordIds.length === 8, low.queueWordIds.length);

console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败');
process.exit(fail ? 1 : 0);