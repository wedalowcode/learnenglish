/** R9 阶段二验收：最后一轮复习列表式判断（Store 层语义）
 *  验证：未全判断禁止提交、提交前可修改且以最终为准、提交后正确衔接莱特纳/21天、
 *        不误加绿盒（除非勾选）、初筛认识与最后复习独立、历史记录保留。
 *  运行：node _test/r9-final-review.js
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
function roleTeacher(tid) {
  const u = (S.db.users || []).find(x => x.roleCode === 'teacher' && (x.teacherId === tid || x.profileId === tid));
  S.setSession({ role: 'teacher', teacherId: tid, operatorId: tid, operatorName: '教师', accountId: u ? u.id : '' });
}
const W = (id, sid) => S.wordState(sid, id);

console.log('\n== R9 阶段二 · 最后复习列表式判断 ==');
roleTeacher('T001');
let studentId = '', book = null;
for (const sid of S.db.students.map(s => s.id)) {
  const auth = (S.db.wordbooks || []).filter(b => S.isAuthorized && S.isAuthorized(sid, b.id) && b.status === '启用');
  const cand = auth.find(b => { const n = (S.wordsOfBook(b.id) || []).length; return n >= 9; });
  if (cand) { studentId = sid; book = cand; break; }
}
ok('找到已授权 >=9 词词库', !!book, (book ? book.id : '') + ' / ' + studentId);
if (!book) { console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败'); process.exit(fail ? 1 : 0); }
const wc = S.wordsOfBook(book.id).length;

const created = S.createTrainTask({ studentId, targetCount: wc });
const tid = created.task.id;
S.addWordbooksToTask(tid, [book.id]);
let task = S.trainTask(tid);
/* 每 3 个单词标「初筛认识」，其余标不认识 → 认识进绿盒并排除出队 */
let i = 0;
const knowns = [];
task.wordIds.forEach(wid => { S.prescreenAnswer(tid, wid, (i++ % 3) === 0); if ((i - 1) % 3 === 0) knowns.push(wid); });
task = S.trainTask(tid);
ok('初筛认识有记录', task.knownWordIds.length > 0, task.knownWordIds.length);
ok('初筛认识已入绿盒', knowns.every(wid => { const ls = S.leitnerState(studentId, wid); return ls && ls.box === 'green'; }));
const fp = S.finishPrescreen(tid, { confirmShort: true });
task = S.trainTask(tid);
ok('队列=初筛不认识的单词', fp.ok && task.queueWordIds.length === task.candidateWordIds.length, task.queueWordIds.length);
ok('初筛认识的单词不进队列', task.queueWordIds.every(wid => knowns.indexOf(wid) < 0));

/* 完成全部展示 → 进入最后复习 */
let guard = 0;
while (!S.displayStat(tid).allDone && guard < 300) {
  const cur = S.displayStat(tid).currentGroup;
  cur.words.forEach(wt => { if (wt.step < 3) S.trainDisplayTap(tid, wt.id); });
  const s2 = S.displayStat(tid);
  if (s2.currentComplete && s2.groupIndex < s2.groupCount - 1) S.setTrainGroup(tid, s2.groupIndex + 1);
  guard++;
}
ok('全部展示完成', S.displayStat(tid).allDone);
const toFinal = S.toFinalStage(tid);
ok('进入最后复习', toFinal.ok && toFinal.task.phase === '最后复习');

/* 未全判断 → 禁止提交 */
let r = S.completeTask(tid, { joinLeitner: true, joinPlan21: true, joinGreen: false });
ok('未判断完禁止提交', r.ok === false && r.reason.indexOf('最后复习判断') >= 0, r.reason);

const queue = S.trainTask(tid).queueWordIds;
/* 70% 认识、20% 不认识、10% 暂不确定 */
const yes = queue.filter((w, k) => k % 10 < 7);
const no = queue.filter((w, k) => k % 10 >= 8);
const mid = queue.filter((w, k) => k % 10 === 7);
yes.forEach(w => S.finalJudge(tid, w, 'yes', ''));
no.forEach(w => S.finalJudge(tid, w, 'no', ''));
mid.forEach(w => S.finalJudge(tid, w, 'mid', ''));

/* 提交前修改：把第一个「认识」改为「不认识」，最终应以修改后为准 */
const switchWord = yes[0];
S.finalJudge(tid, switchWord, 'no', '');
task = S.trainTask(tid);
ok('提交前可修改且以最终为准', task.finalResults[switchWord].result === 'no', task.finalResults[switchWord].result);
ok('修改后标记 correctedFrom', task.finalResults[switchWord].correctedFrom === 'yes', task.finalResults[switchWord].correctedFrom);

let allJudged = queue.every(w => S.trainTask(tid).finalResults[w]);
ok('全部已判断', allJudged);

/* 提交：joinLeitner + joinPlan21，不勾绿盒 */
r = S.completeTask(tid, { joinLeitner: true, joinPlan21: true, joinGreen: false, by: '李婉' });
task = S.trainTask(tid);
ok('提交成功', r.ok === true && task.status === '已完成', task.status);
const need = queue.filter(w => ['no', 'mid'].indexOf(task.finalResults[w].result) >= 0);
const passed = queue.filter(w => task.finalResults[w].result === 'yes');
ok('通过=认识', passed.length > 0, passed.length);
ok('待复习=不认识+暂不确定', need.length === no.length + mid.length + 1, need.length); // +1 = 被修改的 switchWord

/* 衔接莱特纳：待复习词进入红盒/今日可复习 */
const ltIn = need.filter(w => { const s = S.leitnerState(studentId, w); return s && (s.box === 'red' || s.manualToday); });
ok('待复习词衔接莱特纳(红盒/今日)', ltIn.length === need.length, ltIn.length + '/' + need.length);
/* 通过词：本次任务未写入莱特纳（已有历史体系归属不应变，且不因通过被加入红色待复习） */
const ltWrote = task.joins.leitner || [];
ok('本次任务只把待复习词写入莱特纳', ltWrote.length === need.length && ltWrote.every(w => need.indexOf(w) >= 0), ltWrote.length + '/' + need.length);
const passedInWrote = ltWrote.filter(w => passed.indexOf(w) >= 0);
ok('通过词不被本次写入莱特纳', passedInWrote.length === 0, passedInWrote.length);

/* 不误加绿盒：未勾选 joinGreen，待复习词不入绿盒 */
const needInGreen = need.filter(w => { const s = S.leitnerState(studentId, w); return s && s.box === 'green'; });
ok('不勾绿盒则待复习词不入绿盒', needInGreen.length === 0, needInGreen.length);
ok('t.joins.green 为空', (task.joins.green || []).length === 0);

/* 21 天：待复习词生成独立计划 */
const plans = S.plansOf(studentId).filter(p => p.note && p.note.indexOf('训练任务 ' + tid) >= 0);
ok('生成独立 21 天计划', plans.length === 1, plans.length);
ok('21 天计划覆盖待复习词', (plans[0].wordIds || []).sort().join() === need.slice().sort().join());

/* 初筛认识独立：仍为初筛认识状态，未被最后复习覆盖 */
ok('初筛认识状态保留', knowns.every(w => W(w, studentId).state === '初筛认识'), knowns.length);
/* 历史记录保留 */
const pres = S.db.prescreens.filter(p => p.taskId === tid);
ok('初筛记录保留', pres.length === task.wordIds.length, pres.length);
ok('trainDetails 未写入掌握判断(展示流程)', S.detailsOf(tid).length === 0);

console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败');
process.exit(fail ? 1 : 0);