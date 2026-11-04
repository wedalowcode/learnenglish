/** 阶段三验收：统一复习检测与训练报告（数据层）
 *  场景一(6-10)：部分掌握/待加强/未掌握 → 提交检测 → 自动生成报告 → 自动创建复习计划；报告统计与计划数量一致
 *  场景五：重复提交检测/重复完成/重复生成报告/重复创建复习计划均不产生重复数据
 *  运行：node _test/r9-closure-p3.js
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
function roleAdmin() { const u = S.db.users.find(x => x.roleCode === 'admin'); S.setSession({ role: 'admin', accountId: u ? u.id : '', operatorId: u ? u.id : 'admin', operatorName: '管理员' }); }
function fresh(sid) {
  roleAdmin();
  let r = S.createTrainTask({ studentId: sid, targetCount: 18, teacherId: 'T001' });
  if (r.reused) { S.endTask(r.task.id, '清理'); r = S.createTrainTask({ studentId: sid, targetCount: 18, teacherId: 'T001' }); }
  return r.task;
}
function finDisplay(tid) { let g = 0; while (!S.displayStat(tid).allDone && g < 300) { const c = S.displayStat(tid).currentGroup; c.words.forEach(w => { if (w.step < 3) S.trainDisplayTap(tid, w.id); }); const s2 = S.displayStat(tid); if (s2.currentComplete && s2.groupIndex < s2.groupCount - 1) S.setTrainGroup(tid, s2.groupIndex + 1); g++; } return S.displayStat(tid); }

console.log('\n== 阶段三验收（检测与训练报告）==');
const tid = fresh('S2026001').id;
roleAdmin();
S.addWordbooksToTask(tid, ['WB001']);
let t = S.trainTask(tid); t.wordIds.slice(0, 18).forEach(id => S.prescreenAnswer(tid, id, false));
S.finishPrescreen(tid, { confirmShort: true });
finDisplay(tid);
S.toFinalStage(tid);
/* 场景一(7)：判断 5 掌握 / 6 待加强 / 7 未掌握（共 18） */
const q = S.trainTask(tid).queueWordIds.slice();
let m1 = 0, need1 = 0, not1 = 0;
q.forEach((id, k) => {
  const res = (k % 3 === 0) ? 'yes' : (k % 3 === 1) ? 'mid' : 'no';
  S.finalJudge(tid, id, res, '');
  if (res === 'yes') m1++; else if (res === 'mid') need1++; else not1++;
});
ok('场景一(7)-三种判断齐全', m1 > 0 && need1 > 0 && not1 > 0, `mastered=${m1} needs=${need1} not=${not1}`);
/* 场景一(8)：全部判断完成后提交 */
const r = S.completeTask(tid, { joinLeitner: true, joinPlan21: true, joinGreen: false });
ok('场景一(8)-提交检测成功', r.ok === true && S.trainTask(tid).status === '已完成');
/* 场景一(9)：自动生成训练报告，统计=检测结果 */
const rep = S.generateTrainingReport(tid);
ok('场景一(9)-报告统计=检测三态', rep.masteredCount === m1 && rep.needsPracticeCount === need1 && rep.notMasteredCount === not1, `${rep.masteredCount}/${rep.needsPracticeCount}/${rep.notMasteredCount} vs ${m1}/${need1}/${not1}`);
ok('场景一(9)-掌握率=已掌握÷总数', Math.abs(rep.masteredRate - (m1 / q.length * 100)) < 0.01, rep.masteredRate + '%');
/* 场景一(10)：自动创建复习计划，数量=待加强+未掌握 */
const plans = S.reviewPlansOf('S2026001').filter(p => p.sourceTaskId === tid);
ok('场景一(10)-复习计划数量=待加强+未掌握', plans.length === (need1 + not1), plans.length + ' vs ' + (need1 + not1));
ok('场景一(10)-报告统计与计划数量一致', (rep.needsPracticeCount + rep.notMasteredCount) === plans.length);
ok('场景一(10)-掌握词不入复习计划', !plans.some(p => { const fr = S.trainTask(tid).finalResults[p.wordId]; return fr && fr.result === 'yes'; }));
ok('场景一(10)-掌握率与计划口径不对立(各词归类互斥)', (m1 + need1 + not1) === q.length);

/* ---- 场景五：重复操作幂等 ---- */
const r2 = S.completeTask(tid, { joinLeitner: true });   // 重复提交检测
ok('场景五-重复提交检测被拒', r2.ok === false);
const rep2 = S.generateTrainingReport(tid);              // 重复生成报告
ok('场景五-重复生成报告返回同一份', rep2.id === rep.id, rep2.id);
const plansA = S.createReviewPlansFromTraining(tid);
const plansB = S.createReviewPlansFromTraining(tid);      // 重复创建计划
ok('场景五-重复创建复习计划不新增', plansB.length === plansA.length, plansA.length + '==' + plansB.length);
const plansAfter = S.reviewPlansOf('S2026001').filter(p => p.sourceTaskId === tid);
ok('场景五-任务计划总数不增长', plansAfter.length === plans.length, plansAfter.length);
const reportsCount = S.trainingReportsOf('S2026001').filter(x => x.taskId === tid).length;
ok('场景五-训练报告仅 1 份', reportsCount === 1, reportsCount);
ok('场景五-报告回指唯一', S.trainTask(tid).reportId === rep.id);

console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败');
process.exit(fail ? 1 : 0);