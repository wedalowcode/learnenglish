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
function freshTask(sid) {
  let r = S.createTrainTask({ studentId: sid });
  if (r.reused) { try { S.endTask(r.task.id, '测试清理'); } catch (e) {} r = S.createTrainTask({ studentId: sid }); }
  return r.task;
}

console.log('\n== R9 阶段三-2 · 训练目标上限 45（第十轮固定 5/45 规则） ==');
roleAdmin();
ok('TARGET_RANGE.max = 45', S.TARGET_RANGE.max === 45, S.TARGET_RANGE.max);
ok('固定常量 TRAIN_WORD_MIN = 5', S.TRAIN_WORD_MIN === 5, S.TRAIN_WORD_MIN);
ok('固定常量 TRAIN_WORD_MAX = 45', S.TRAIN_WORD_MAX === 45, S.TRAIN_WORD_MAX);

/* targetCount 不再可配置，新任务一律按上限 45 */
const fixed = S.createTrainTask({ studentId: 'S2026002', targetCount: 10 });
ok('targetCount 不再可配置，新任务固定 45', fixed.ok && fixed.task.targetCount === 45, fixed.task.targetCount);
try { S.endTask(fixed.task.id, '测试清理'); } catch (e) {}

/* 候选 > 45：队列封顶 45、未入队候选保留 */
S.grantWordbook('S2026003', 'WB001', { reason: '上限验证补授权' });
S.grantWordbook('S2026003', 'WB002', { reason: '上限验证补授权' });
const tCap = freshTask('S2026003');
S.addWordbooksToTask(tCap.id, ['WB003', 'WB001', 'WB002']);
let cap = S.trainTask(tCap.id);
ok('候选超过 45', cap.wordIds.length >= 46, cap.wordIds.length);
cap.wordIds.forEach(id => S.prescreenAnswer(tCap.id, id, false));
cap = S.trainTask(tCap.id);
const fpCap = S.finishPrescreen(tCap.id);
cap = S.trainTask(tCap.id);
ok('队列封顶到 45', cap.queueWordIds.length === 45, cap.queueWordIds.length);
ok('未入队候选保留为 remain', cap.remainWordIds.length === cap.wordIds.length - 45, cap.remainWordIds.length);
ok('remain 仍为待强化训练(不丢失)', cap.remainWordIds.every(id => S.wordState('S2026003', id).state === '待强化训练'));
try { S.endTask(tCap.id, '测试清理'); } catch (e) {}

/* 候选 ≥5 且 <45：直接按实际数量开始，不再需要 confirmShort */
let low = null;
for (const sid of S.db.students.map(s => s.id)) {
  const r = S.createTrainTask({ studentId: sid });
  if (!r.reused) { low = r.task; break; }
}
ok('找到无未完成任务的新学员', !!low, low ? low.id + '/' + low.studentId : 'none');
if (!low) { console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败'); process.exit(fail ? 1 : 0); }
S.addWordbooksToTask(low.id, ['WB001']);
low = S.trainTask(low.id);
low.wordIds.slice(0, 8).forEach(id => S.prescreenAnswer(low.id, id, false));
const rOk = S.finishPrescreen(low.id);
low = S.trainTask(low.id);
ok('8 个不认识可直接开始（无需确认）', rOk.ok === true && low.queueWordIds.length === 8, low.queueWordIds.length);

console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败');
process.exit(fail ? 1 : 0);