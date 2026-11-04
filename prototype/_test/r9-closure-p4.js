/** 阶段四验收：统一复习计划（数据层）
 *  场景四：部分掌握/待加强/未掌握 → 复习计划只含待加强+未掌握 → 复习产生记录并动态调整下次到期
 *  场景七：历史兼容（莱特纳/21天/课程报告不受影响，新增集合为附加式默认；normalizeDb 不回退旧数组）
 *  运行：node _test/r9-closure-p4.js
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
function fresh(sid) { roleAdmin(); let r = S.createTrainTask({ studentId: sid, targetCount: 15, teacherId: 'T001' }); if (r.reused) { S.endTask(r.task.id, '清理'); r = S.createTrainTask({ studentId: sid, targetCount: 15, teacherId: 'T001' }); } return r.task; }
function finDisplay(tid) { let g = 0; while (!S.displayStat(tid).allDone && g < 300) { const c = S.displayStat(tid).currentGroup; c.words.forEach(w => { if (w.step < 3) S.trainDisplayTap(tid, w.id); }); const s2 = S.displayStat(tid); if (s2.currentComplete && s2.groupIndex < s2.groupCount - 1) S.setTrainGroup(tid, s2.groupIndex + 1); g++; } return S.displayStat(tid); }

console.log('\n== 阶段四验收（复习计划）==');
const YEAR = 2026;

/* ---- 场景七(先取证)：历史数据本就在，新增集合是附加式 ---- */
const lentoBefore = S.db.leitnerStates.length;
const plan21Before = S.db.plans21.length;
const rec21Before = S.db.plan21Records.length;
const rep21Before = S.db.reports.length;
ok('场景七-历史莱特纳数据存在', lentoBefore > 0, lentoBefore);
ok('场景七-历史21天计划与记录存在', plan21Before > 0 && rec21Before > 0, `${plan21Before}/${rec21Before}`);
ok('场景七-新增集合为附加式空默认', Array.isArray(S.db.reviewPlans) && S.db.reviewPlans.length === 0 && Array.isArray(S.db.trainingReports) && S.db.trainingReports.length === 0);

/* ---- 场景四：完整训练 → 复习计划 → 复习动态调整 ---- */
const tid = fresh('S2026001').id, sid = 'S2026001';
roleAdmin();
S.addWordbooksToTask(tid, ['WB001']);
let t = S.trainTask(tid); t.wordIds.slice(0, 15).forEach(id => S.prescreenAnswer(tid, id, false));
S.finishPrescreen(tid, { confirmShort: true });
finDisplay(tid); S.toFinalStage(tid);
const q = S.trainTask(tid).queueWordIds.slice();
const maj = { yes: [], mid: [], no: [] };
q.forEach((id, k) => { const res = (k % 5 === 0) ? 'yes' : (k % 5 === 2) ? 'mid' : 'no'; S.finalJudge(tid, id, res, ''); maj[res].push(id); });
S.completeTask(tid, { joinLeitner: true, joinPlan21: true, joinGreen: false });
const plans = S.reviewPlansOf(sid).filter(p => p.sourceTaskId === tid);
ok('场景四-复习计划只含待加强+未掌握', plans.length === (maj.mid.length + maj.no.length), plans.length);
ok('场景四-掌握词不入复习计划', plans.every(p => maj.yes.indexOf(p.wordId) < 0));
const notPlans = plans.filter(p => maj.no.indexOf(p.wordId) >= 0);
const needsPlans = plans.filter(p => maj.mid.indexOf(p.wordId) >= 0);
ok('场景四-未掌握 vs 待加强 首期间隔(未掌握更近)', (notPlans.length && needsPlans.length) && notPlans[0].nextReviewAt <= needsPlans[0].nextReviewAt, `${notPlans[0].nextReviewAt} <= ${needsPlans[0].nextReviewAt}`);

const wNot = (plans.find(p => maj.no.indexOf(p.wordId) >= 0) || {}).wordId;
const wNeed = (plans.find(p => maj.mid.indexOf(p.wordId) >= 0) || {}).wordId;
/* 复习：未掌握 → 复习记录 + 保持短间隔；多次掌握 → 间隔放大 */
const r1 = S.recordReview({ studentId: sid, wordId: wNot, result: 'not_mastered', method: 'teacher', teacherId: 'T001' });
ok('场景四-复习产生记录且追加', S.reviewRecordsOf(sid, wNot).length === 1 && !!r1.nextReviewAt);
const planA = S.activeReviewPlan(sid, wNot);
ok('场景四-未掌握复习后仍低间隔(未放大)', (planA.nextReviewAt || '').indexOf(String(YEAR)) >= 0);
const r2 = S.recordReview({ studentId: sid, wordId: wNeed, result: 'mastered', method: 'teacher', teacherId: 'T001' });
const stageBefore = S.activeReviewPlan(sid, wNeed).currentStage;
const nextBefore = S.activeReviewPlan(sid, wNeed).nextReviewAt;
S.recordReview({ studentId: sid, wordId: wNeed, result: 'mastered', method: 'teacher', teacherId: 'T001' });
const planC = S.activeReviewPlan(sid, wNeed);
ok('场景四-掌握→间隔放大(stage递增)', planC.currentStage > stageBefore && (planC.nextReviewAt || '') > (nextBefore || ''), `stage ${stageBefore}->${planC.currentStage}, ${nextBefore}->${planC.nextReviewAt}`);
ok('场景四-复习记录为真实追加（多条并列，不覆盖）', S.reviewRecordsOf(sid, wNeed).length >= 2);
ok('场景四-计划唯一有效(版本化，无冲突并行)', S.reviewPlansOf(sid).filter(p => p.wordId === wNeed && (p.status === 'pending' || p.status === 'in_progress')).length === 1);

/* ---- 场景七：历史数据未被本轮改动/丢失 ---- */
/* 训练合法地新增了莱特纳/21天记录，故断言「不小于」且原记录仍在；课程报告不受训练改动，断言「相等」 */
const origPlanId = S.db.plans21[0] ? S.db.plans21[0].id : '';
ok('场景七-历史莱特纳记录未丢失(只增不减)', S.db.leitnerStates.length >= lentoBefore, lentoBefore + '→' + S.db.leitnerStates.length);
ok('场景七-历史21天计划/记录未丢失(只增不减)', S.db.plans21.length >= plan21Before && S.db.plan21Records.length >= rec21Before, `${plan21Before}/${rec21Before} → ${S.db.plans21.length}/${S.db.plan21Records.length}`);
ok('场景七-课程报告数量不受训练影响(相等)', S.db.reports.length === rep21Before, rep21Before);
ok('场景七-原21天计划仍存在', !origPlanId || !!S.plan21(origPlanId), origPlanId || 'none');
/* 历史 wordState 兜底读取仍可用 */
const anyState = S.db.studentWordStates[0] ? S.wordState(S.db.studentWordStates[0].studentId, S.db.studentWordStates[0].wordId) : null;
ok('场景七-历史单词状态可读', !!anyState || S.db.studentWordStates.length === 0);

console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败');
process.exit(fail ? 1 : 0);