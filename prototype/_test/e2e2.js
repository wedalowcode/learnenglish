/* ============================================================
   第二轮迭代验收：Store 业务完整性
   ------------------------------------------------------------
   覆盖：
     21 天复习 场景 A / B / C、莱特纳重复提交与修正、
     训练任务重复判断与修正、空复习计划、文章训练、
     课时冲正、家长端复习词表一致性
   运行：node prototype/_test/e2e2.js
   ============================================================ */
const fs = require('fs');
const vm = require('vm');

const root = 'D:/低代码/英语一对一教学软件/prototype/assets/js/';
const dataSrc = fs.readFileSync(root + 'data.js', 'utf8');
const storeSrc = fs.readFileSync(root + 'store.js', 'utf8');

const mem = {};
const localStorage = {
  getItem: k => (k in mem ? mem[k] : null),
  setItem: (k, v) => { mem[k] = String(v); },
  removeItem: k => { delete mem[k]; }
};

function boot() {
  const sandbox = { console, localStorage, Date, JSON, Math, Object, Array, String, Number, isFinite, parseInt, parseFloat };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(dataSrc, sandbox);
  vm.runInContext(storeSrc, sandbox);
  return sandbox.Store;
}

const ok = [];
const bad = [];
function assert(name, cond, extra) {
  if (cond) ok.push(name); else bad.push(name + (extra !== undefined ? ' → ' + extra : ''));
}
function throws(fn, kw) {
  try { fn(); return false; } catch (e) { return kw ? e.message.includes(kw) : true; }
}
const SID = 'S2026001';
const words = S => S.db.words.map(w => w.id);

/* ============================================================
   场景 A：21 天 —— 10 个单词全部正常判断，节点完成
   ============================================================ */
let S = boot();
S.reset();
(function scenarioA() {
  const ids = words(S).slice(0, 10);
  const p = S.create21Plan({ studentId: SID, name: 'A 计划', startDate: S.TODAY, wordIds: ids, by: '李婉' });
  assert('A: 计划创建成功', !!p.id, p.id);
  assert('A: 计划单词 10 个', p.wordIds.length === 10, p.wordIds.length);
  assert('A: 计划单词无重复', new Set(p.wordIds).size === 10);
  assert('A: 计划单词全部有效', p.wordIds.every(id => !!S.word(id)));

  const task = S.plan21Today(p.id);
  assert('A: 今日节点存在', !!task);
  assert('A: 节点 10 词', task.wordIds.length === 10, task.wordIds.length);
  assert('A: 节点内无 undefined', task.wordIds.every(id => typeof id === 'string' && !!S.word(id)));
  assert('A: 节点内无重复', new Set(task.wordIds).size === task.wordIds.length);

  task.wordIds.forEach((id, i) => S.plan21Judge(task.id, id, i % 4 === 0 ? 'no' : 'yes', 'T001'));

  const st = S.plan21TaskStat(task.id);
  assert('A: 完成唯一单词 10', st.done === 10, st.done);
  assert('A: 原始记录 10 条', st.records === 10, st.records);
  assert('A: 无修正', st.corrections === 0, st.corrections);
  assert('A: 节点状态=已完成', S.plan21Task(task.id).status === '已完成', S.plan21Task(task.id).status);
  assert('A: 节点已完成标记', st.complete === true);
  assert('A: 剩余 0 个', st.remain === 0, st.remain);

  // 刷新后仍然一致
  const S2 = boot();
  const st2 = S2.plan21TaskStat(task.id);
  assert('A: 刷新后完成数不变', st2.done === 10, st2.done);
  assert('A: 刷新后状态仍已完成', S2.plan21Task(task.id).status === '已完成');
})();

/* ============================================================
   场景 B：21 天 —— 同一单词连续提交 10 次
   ============================================================ */
(function scenarioB() {
  S.reset();
  const ids = words(S).slice(0, 10);
  const p = S.create21Plan({ studentId: SID, name: 'B 计划', startDate: S.TODAY, wordIds: ids, by: '李婉' });
  const task = S.plan21Today(p.id);
  const target = task.wordIds[0];

  let success = 0, rejected = 0, lastMsg = '';
  for (let i = 0; i < 10; i++) {
    try { S.plan21Judge(task.id, target, i % 2 ? 'yes' : 'no', 'T001'); success++; }
    catch (e) { rejected++; lastMsg = e.message; }
  }

  const recs = S.plan21Records(p.id).filter(r => r.taskId === task.id && r.wordId === target);
  assert('B: 只有 1 次首次判断成功', success === 1, success);
  assert('B: 其余 9 次被拒绝', rejected === 9, rejected);
  assert('B: 该词记录只有 1 条', recs.length === 1, recs.length);
  assert('B: 拒绝原因提示修正', lastMsg.includes('修正'), lastMsg);
  assert('B: 节点未提前完成', S.plan21Task(task.id).status === '进行中', S.plan21Task(task.id).status);
  assert('B: 完成唯一单词 1 个', S.plan21TaskStat(task.id).done === 1, S.plan21TaskStat(task.id).done);
  assert('B: 计划整体进度不被虚增', S.plan21Progress(S.plan21(p.id)).doneWords === 1,
    S.plan21Progress(S.plan21(p.id)).doneWords);
})();

/* ============================================================
   场景 C：21 天 —— 完成后修改其中一个单词
   ============================================================ */
(function scenarioC() {
  S.reset();
  const ids = words(S).slice(0, 10);
  const p = S.create21Plan({ studentId: SID, name: 'C 计划', startDate: S.TODAY, wordIds: ids, by: '李婉' });
  const task = S.plan21Today(p.id);
  task.wordIds.forEach(id => S.plan21Judge(task.id, id, 'yes', 'T001'));

  const target = task.wordIds[2];
  const firstRec = S.plan21FirstRecord(task.id, target);
  assert('C: 原始结果=yes', firstRec.result === 'yes');
  assert('C: 节点已完成', S.plan21Task(task.id).status === '已完成');

  // 已完成节点禁止普通提交
  assert('C: 已完成节点拒绝普通提交',
    throws(() => S.plan21Judge(task.id, task.wordIds[5], 'no', 'T001'), '已完成'));

  // 修正必须填原因
  assert('C: 修正无原因被拒绝',
    throws(() => S.plan21Correct(task.id, target, 'no', '', 'T001'), '原因'));
  assert('C: 修正结果与原值相同被拒绝',
    throws(() => S.plan21Correct(task.id, target, 'yes', '重复', 'T001'), '相同'));
  assert('C: 未判断单词不能修正',
    throws(() => S.plan21Correct(task.id, 'w99', 'no', 'x', 'T001')));

  const r = S.plan21Correct(task.id, target, 'no', '学员当时口误，实际不认识', 'T001');
  assert('C: 修正返回原值/新值', r.from === 'yes' && r.to === 'no', JSON.stringify(r));
  assert('C: 修正轮次=2', r.round === 2, r.round);

  const recs = S.plan21Records(p.id).filter(x => x.taskId === task.id && x.wordId === target);
  assert('C: 历史保留原记录（共 2 条）', recs.length === 2, recs.length);
  assert('C: 原记录结果未被覆盖', recs[0].result === 'yes' && recs[0].correction === false);
  assert('C: 修正记录带原结果', recs[1].correctionFrom === 'yes', recs[1].correctionFrom);
  assert('C: 修正记录带原因', recs[1].correctionNote.includes('口误'), recs[1].correctionNote);
  assert('C: 修正记录带时间与教师', !!recs[1].at && recs[1].teacherId === 'T001');
  assert('C: 当前有效结果=no', S.plan21Effective(task.id)[target].result === 'no');
  assert('C: 完成数不变（仍 10）', S.plan21TaskStat(task.id).done === 10, S.plan21TaskStat(task.id).done);
  assert('C: 修正计数=1', S.plan21TaskStat(task.id).corrections === 1);
  assert('C: 原始记录仍 11 条', S.plan21TaskStat(task.id).records === 11, S.plan21TaskStat(task.id).records);

  // 已完成节点不能重复结束
  assert('C: 已完成节点重复结束被拒', S.finish21Task(task.id).ok === false);

  // 提前结束：未完成单词保留
  const p2 = S.create21Plan({ studentId: SID, name: 'C2 计划', startDate: S.TODAY, wordIds: words(S).slice(10, 20), by: '李婉' });
  const t2 = S.plan21Today(p2.id);
  S.plan21Judge(t2.id, t2.wordIds[0], 'yes', 'T001');
  S.plan21Judge(t2.id, t2.wordIds[1], 'no', 'T001');
  const fin = S.finish21Task(t2.id, { reason: '课堂时间不足' });
  assert('C: 提前结束返回 ok', fin.ok === true);
  assert('C: 提前结束未完成', fin.complete === false);
  assert('C: 剩余单词保留', S.plan21Task(t2.id).remainWordIds.length === 8,
    S.plan21Task(t2.id).remainWordIds.length);
  assert('C: 已判断记录保留', S.plan21TaskStat(t2.id).done === 2);
  assert('C: 提前结束状态=已中断', S.plan21Task(t2.id).status === '已中断', S.plan21Task(t2.id).status);
})();

/* ============================================================
   莱特纳：重复判断、修正不重复推进、完成计数
   ============================================================ */
(function leitner() {
  S.reset();
  const redWords = S.leitnerBoxWords(SID, 'red').filter(s => S.isDue(s)).map(s => s.wordId);
  assert('L: 红盒到期存在', redWords.length > 0, redWords.length);

  const t = S.createLeitnerTask(SID, redWords, 'T001', '红盒子');
  assert('L: 任务词数=去重后', t.wordIds.length === redWords.length);
  assert('L: 任务词无重复', new Set(t.wordIds).size === t.wordIds.length);
  assert('L: 任务状态进行中', t.status === '进行中');

  const w0 = t.wordIds[0];
  const notIn = words(S).find(id => t.wordIds.indexOf(id) < 0);
  assert('L: 非任务单词被拒绝',
    throws(() => S.leitnerJudge(t.id, notIn, 'yes', 'T001'), '不属于'));

  const before = S.leitnerState(SID, w0).box;
  const r1 = S.leitnerJudge(t.id, w0, 'yes', 'T001');
  assert('L: 首次判断改变盒子', S.leitnerState(SID, w0).box === 'Y1', S.leitnerState(SID, w0).box);
  assert('L: 判断前盒子=红', r1.from === 'red', r1.from);

  // 重复判断必须被拒绝
  assert('L: 重复判断被拒绝',
    throws(() => S.leitnerJudge(t.id, w0, 'no', 'T001'), '修正'));

  // 记录仍只有 1 条
  const recs1 = S.leitnerRecordsOf(SID, w0).filter(r => r.taskId === t.id);
  assert('L: 同任务同词仅 1 条首次记录', recs1.length === 1, recs1.length);

  // 修正必须填原因
  assert('L: 修正无原因被拒绝',
    throws(() => S.leitnerCorrect(t.id, w0, 'no', '', 'T001'), '原因'));
  assert('L: 未判断单词不能修正',
    throws(() => S.leitnerCorrect(t.id, t.wordIds[1], 'no', 'x', 'T001')));

  // 修正：以原盒子重算，而不是在 Y1 上再推
  const rc = S.leitnerCorrect(t.id, w0, 'no', '学员认读错误，实际不认识', 'T001');
  assert('L: 修正基准为原盒子（红）', rc.from === 'red', rc.from);
  assert('L: 修正后回到红盒（未重复推进到 Y2）', S.leitnerState(SID, w0).box === 'red', S.leitnerState(SID, w0).box);
  assert('L: 修正返回修正前盒子', rc.boxBeforeCorrect === 'Y1', rc.boxBeforeCorrect);

  // 再修正回 yes → 应到 Y1
  S.leitnerCorrect(t.id, w0, 'yes', '复核后确认认识', 'T001');
  assert('L: 二次修正回到 Y1（未累计推进）', S.leitnerState(SID, w0).box === 'Y1', S.leitnerState(SID, w0).box);

  // 完成计数按唯一 wordId
  t.wordIds.slice(1).forEach(id => S.leitnerJudge(t.id, id, 'no', 'T001'));
  const st = S.leitnerTaskStat(t.id);
  assert('L: 唯一单词完成数=任务词数', st.done === t.wordIds.length, st.done + '/' + t.wordIds.length);
  assert('L: 修正 2 次记录在案', st.corrections === 2, st.corrections);
  assert('L: 原始记录条数不因修正翻倍', st.records === t.wordIds.length + 2, st.records);

  const f1 = S.finishLeitnerTask(t.id, 'T001');
  assert('L: 结束任务 ok', f1.ok === true);
  assert('L: 任务已完成', S.leitnerTask(t.id).status === '已完成');
  assert('L: 重复结束被拒绝', S.finishLeitnerTask(t.id, 'T001').ok === false);
  assert('L: 已完成任务禁止再判断',
    throws(() => S.leitnerJudge(t.id, t.wordIds[1], 'yes', 'T001'), '已完成'));

  // 21 天数据不受影响
  const plan21Recs = S.plan21Records('PN20261024001').length;
  assert('L: 未产生 21 天记录', S.plan21Records('PN20261024001').length === plan21Recs);
})();

/* ============================================================
   训练任务：重复判断、修正、阶段校验、提交校验
   ============================================================ */
(function training() {
  S.reset();
  const t = S.startTrainTask({ studentId: SID, teacherId: 'T001', wordbookId: 'WB001' });
  const bk = S.wordsOfBook('WB001');
  bk.forEach((w, i) => S.prescreenAnswer(t.id, w.id, i < 9));
  const r = S.finishPrescreen(t.id);
  assert('T: 队列 14', r.queue.length === 14, r.queue.length);

  const q0 = r.queue[0];
  const notInQueue = bk[0].id; // 认识的单词不在队列

  assert('T: 非队列单词被拒绝',
    throws(() => S.trainJudge(t.id, notInQueue, 'yes', 'en2cn', 0), '不属于'));

  const stBefore = S.wordState(SID, notInQueue).state;
  assert('T: 首次判断成功', (() => { S.trainJudge(t.id, q0, 'yes', 'en2cn', 0); return true; })());

  // 重复判断
  assert('T: 重复判断被拒绝',
    throws(() => S.trainJudge(t.id, q0, 'no', 'en2cn', 0), '修正'));
  const d1 = S.detailsOf(t.id).filter(d => d.wordId === q0);
  assert('T: 同词仅 1 条首次明细', d1.length === 1, d1.length);
  assert('T: 任务结果未被覆盖', S.trainTask(t.id).results[q0].result === 'yes');

  // 修正
  assert('T: 修正无原因被拒绝',
    throws(() => S.trainCorrect(t.id, q0, 'no', '', 0), '原因'));
  S.trainCorrect(t.id, q0, 'no', '误点，实际不认识', 0);
  const d2 = S.detailsOf(t.id).filter(d => d.wordId === q0);
  assert('T: 修正后明细 2 条', d2.length === 2, d2.length);
  assert('T: 原明细保留', d2[0].result === 'yes' && d2[0].correction === false);
  assert('T: 修正明细带原因与原值', d2[1].correction === true && d2[1].correctionFrom === 'yes'
    && d2[1].correctionNote.includes('误点'));
  assert('T: 当前有效值=no', S.trainTask(t.id).results[q0].result === 'no');

  // 阶段校验
  assert('T: 强化阶段不能直接提交', S.completeTask(t.id, {}).ok === false);
  assert('T: 最后复习阶段前不能 finalJudge',
    throws(() => S.finalJudge(t.id, q0, 'yes'), '最后一轮'));

  // 未全部判断不能进入最后复习
  let fr = S.toFinalStage(t.id);
  assert('T: 未完成不能进入最后复习', fr.ok === false && fr.missing.length === 13, fr.missing && fr.missing.length);

  r.queue.forEach(id => { if (!S.trainTask(t.id).results[id]) S.trainJudge(t.id, id, 'yes', 'en2cn', 0); });
  fr = S.toFinalStage(t.id);
  assert('T: 全部判断后可进入最后复习', fr.ok === true);
  assert('T: 状态=进行中/最后复习', S.trainTask(t.id).status === '进行中' && S.trainTask(t.id).phase === '最后复习', S.trainTask(t.id).status + '/' + S.trainTask(t.id).phase);

  assert('T: 最后复习非队列词被拒绝',
    throws(() => S.finalJudge(t.id, notInQueue, 'yes'), '不属于'));

  r.queue.forEach(id => S.finalJudge(t.id, id, 'yes'));
  /* 第九轮起：未提交前允许重判，直接以本次结果为准并记录 correctedFrom */
  assert('T: 提交前重判直接生效并留痕', (function () {
    S.finalJudge(t.id, q0, 'no');
    var fr = S.trainTask(t.id).finalResults[q0];
    return fr.result === 'no' && fr.correctedFrom === 'yes';
  })(), S.trainTask(t.id).finalResults[q0]);
  assert('T: 最后复习修正无原因被拒绝',
    throws(() => S.finalCorrect(t.id, q0, 'no', ''), '原因'));
  S.finalCorrect(t.id, q0, 'mid', '连读不清，暂不确定');
  assert('T: 最后复习修正留痕',
    S.trainTask(t.id).finalResults[q0].correctedFrom === 'no' &&
    S.trainTask(t.id).finalResults[q0].result === 'mid');

  // 提交：仍有 mid → need 计入
  const plansBefore = S.plansOf(SID).length;
  const ltBefore = S.leitnerTasksOf(SID).length;
  const res = S.completeTask(t.id, { joinLeitner: true, joinPlan21: true, by: '李婉' });
  assert('T: 提交成功', res.ok === true);
  assert('T: 待复习=1（mid）', res.need === 1, res.need);
  assert('T: 生成 21 天计划', S.plansOf(SID).length === plansBefore + 1);
  assert('T: 计划只含待复习单词', S.plan21(res.joins.planIds[0]).wordIds.length === 1);
  assert('T: 未创建布莱特纳任务（加入走状态不建任务）', S.leitnerTasksOf(SID).length === ltBefore);
  assert('T: 任务标记已完成', S.trainTask(t.id).status === '已完成');
  assert('T: 重复提交被拒绝', S.completeTask(t.id, {}).ok === false);
  assert('T: 已提交任务禁止修正',
    throws(() => S.trainCorrect(t.id, q0, 'yes', '事后修改'), '已提交'));
  assert('T: 已提交任务禁止普通判断',
    throws(() => S.trainJudge(t.id, q0, 'yes', 'en2cn', 0), '提交'));

  // 中断任务
  S.reset();
  const t2 = S.startTrainTask({ studentId: SID, teacherId: 'T001', wordbookId: 'WB001' });
  S.wordsOfBook('WB001').forEach((w, i) => S.prescreenAnswer(t2.id, w.id, i < 9));
  const r2 = S.finishPrescreen(t2.id);
  S.trainJudge(t2.id, r2.queue[0], 'yes', 'en2cn', 0);
  S.endTask(t2.id, '课堂时间不足');
  assert('T: 中断后禁止判断',
    throws(() => S.trainJudge(t2.id, r2.queue[1], 'yes', 'en2cn', 0), '中断'));
  assert('T: 中断后禁止提交', S.completeTask(t2.id, {}).ok === false);
  S.resumeTask(t2.id);
  assert('T: 恢复后可继续判断', (() => { S.trainJudge(t2.id, r2.queue[1], 'yes', 'en2cn', 0); return true; })());
  assert('T: 中断时未完成单词保留', S.wordState(SID, r2.queue[5]).state === '待强化训练',
    S.wordState(SID, r2.queue[5]).state);
})();

/* ============================================================
   空复习计划：全部通过时不建空计划 / 空任务
   ============================================================ */
(function emptyReview() {
  S.reset();
  const t = S.startTrainTask({ studentId: SID, teacherId: 'T001', wordbookId: 'WB001' });
  S.wordsOfBook('WB001').forEach((w, i) => S.prescreenAnswer(t.id, w.id, i < 9));
  const r = S.finishPrescreen(t.id);
  r.queue.forEach(id => S.trainJudge(t.id, id, 'yes', 'en2cn', 0));
  S.toFinalStage(t.id);
  r.queue.forEach(id => S.finalJudge(t.id, id, 'yes'));

  const plansBefore = S.plansOf(SID).length;
  const ltTasksBefore = S.leitnerTasksOf(SID).length;
  const res = S.completeTask(t.id, { joinLeitner: true, joinPlan21: true, joinGreen: true, by: '李婉' });

  assert('E: 提交成功', res.ok === true);
  assert('E: noReview 标记', res.noReview === true);
  assert('E: need=0', res.need === 0, res.need);
  assert('E: 未创建 21 天计划', S.plansOf(SID).length === plansBefore, S.plansOf(SID).length);
  assert('E: 未创建空莱特纳任务', S.leitnerTasksOf(SID).length === ltTasksBefore);
  assert('E: 未写入莱特纳加入清单', res.joins.leitner.length === 0);
  assert('E: 未写入计划号', res.joins.planIds.length === 0);
  assert('E: 提示无需加入复习体系', /没有待复习单词/.test(res.message), res.message);
  assert('E: joins.empty 标记为真', res.joins.empty === true);

  // create21Plan 拒绝空清单
  assert('E: create21Plan 拒绝空数组',
    throws(() => S.create21Plan({ studentId: SID, wordIds: [], startDate: S.TODAY }), '不能创建空计划'));
  assert('E: create21Plan 拒绝 undefined 清单',
    throws(() => S.create21Plan({ studentId: SID, wordIds: null, startDate: S.TODAY })));
  assert('E: create21Plan 拒绝不存在的单词',
    throws(() => S.create21Plan({ studentId: SID, wordIds: ['wXX', undefined], startDate: S.TODAY })));

  // 去重 + 过滤无效
  const p = S.create21Plan({
    studentId: SID, startDate: S.TODAY,
    wordIds: ['w01', 'w01', 'w02', undefined, 'wXX', 'w03', 'w02']
  });
  assert('E: 计划单词去重', p.wordIds.length === 3, p.wordIds.length);
  assert('E: 计划单词无 undefined', p.wordIds.every(id => !!S.word(id)));
  const nodes = S.plan21Tasks(p.id);
  assert('E: 每个节点单词都有效',
    nodes.every(n => n.wordIds.every(id => !!S.word(id))));
  assert('E: 每个节点单词不重复',
    nodes.every(n => new Set(n.wordIds).size === n.wordIds.length));
})();

/* ============================================================
   文章训练
   ============================================================ */
(function article() {
  S.reset();
  const sents = S.db.articleTaskDetails.filter(d => d.taskId === 'AT20261030001').map(d => ({ i: d.seq, en: d.en, cn: '' }));
  assert('AR: 种子文章任务存在', S.articleTasksOf(SID).length === 1);

  const w0 = 'w01';
  const stateBefore = S.wordState(SID, w0).state;

  const t = S.startArticleTask({
    studentId: SID, teacherId: 'T001', articleId: 'AR001',
    articleName: 'My First Day at School', sentences: sents
  });
  assert('AR: 任务创建', /^AT20261102/.test(t.id), t.id);
  assert('AR: 任务状态进行中', t.status === '进行中');
  assert('AR: 总句数=8', t.totalSentences === 8, t.totalSentences);
  assert('AR: 句子明细已建立 8 条', S.articleTaskDetails(t.id).length === 8);
  assert('AR: 明细初始未完成', S.articleTaskDetails(t.id).every(d => !d.readDone));

  // 重复开始返回同一任务，不重复创建
  const t2 = S.startArticleTask({
    studentId: SID, teacherId: 'T001', articleId: 'AR001', articleName: 'x', sentences: sents
  });
  assert('AR: 重复开始复用任务', t2.id === t.id, t2.id + ' vs ' + t.id);

  // 逐句记录
  S.setArticleAudioDone(t.id, true);
  const d0 = S.articleTaskDetails(t.id)[0];
  S.articleSentenceLog(t.id, d0.sentenceId, { audioPlayed: true });
  S.articleSentenceLog(t.id, d0.sentenceId, { cnViewed: true });
  S.articleSentenceLog(t.id, d0.sentenceId, { readDone: true, teacherConfirm: '通过' });

  const after = S.articleSentenceLog(t.id, d0.sentenceId, {});
  assert('AR: 播放已记录', after.audioPlayed === true);
  assert('AR: 查看中文已记录', after.cnViewed === true);
  assert('AR: 跟读已记录', after.readDone === true);
  assert('AR: 教师确认已记录', after.teacherConfirm === '通过', after.teacherConfirm);
  assert('AR: 操作时间已记录', !!after.at);
  assert('AR: 完成句数=1', S.articleTask(t.id).doneSentences === 1, S.articleTask(t.id).doneSentences);

  // 刷新后恢复
  const S3 = boot();
  assert('AR: 刷新后任务仍在', !!S3.articleTask(t.id));
  const restore = S3.articleTaskDetails(t.id);
  assert('AR: 刷新后逐句记录恢复', restore.filter(d => d.readDone).length === 1);
  assert('AR: 刷新后音频标记恢复', S3.articleTask(t.id).audioDone === true);

  // 提前结束：保留已有记录
  const fr = S3.finishArticleTask(t.id, { endReason: '课堂时间不足', evaluation: '听读尚可' });
  assert('AR: 提前结束 ok', fr.ok === true);
  assert('AR: 状态=已中断', S3.articleTask(t.id).status === '已中断', S3.articleTask(t.id).status);
  assert('AR: 已完成句数保留 1', fr.done === 1, fr.done);
  assert('AR: 未完成句数 7', fr.remain === 7, fr.remain);
  assert('AR: 教师评价已保存', S3.articleTask(t.id).evaluation === '听读尚可');
  assert('AR: 重复提交被拒绝', S3.finishArticleTask(t.id, {}).ok === false);
  assert('AR: 结束后禁止再记录',
    throws(() => S3.articleSentenceLog(t.id, d0.sentenceId, { readDone: true }), '已结束'));

  // 不影响单词掌握状态
  assert('AR: 不改变单词掌握状态', S3.wordState(SID, w0).state === stateBefore,
    stateBefore + ' → ' + S3.wordState(SID, w0).state);
})();

/* ============================================================
   课时冲正
   ============================================================ */
(function finance() {
  S.reset();
  const f = S.flow('FL20261029006');
  assert('F: 原流水存在', !!f);
  const acc = S.account(f.account);
  const balBefore = acc.remain;

  assert('F: 不存在的流水被拒绝',
    throws(() => S.reverseFlow('FL_NOT_EXIST', 1, '系统异常', '测试', '张敏'), '不存在'));
  assert('F: 入账类流水不允许冲正',
    throws(() => S.reverseFlow('FL20261031003', 1, '系统异常', '测试', '张敏'), '不允许冲正'));
  assert('F: 冲正课时必须>0',
    throws(() => S.reverseFlow('FL20261029006', 0, '系统异常', '测试', '张敏'), '大于 0'));
  assert('F: 必须选择原因',
    throws(() => S.reverseFlow('FL20261029006', 1, '', '测试', '张敏'), '原因'));
  assert('F: 必须填写说明',
    throws(() => S.reverseFlow('FL20261029006', 1, '系统异常', '', '张敏'), '说明'));
  assert('F: 超过原始变动被拒绝',
    throws(() => S.reverseFlow('FL20261029006', 2, '系统异常', '测试', '张敏'), '上限'));

  const flowsBefore = S.flows().length;
  const r = S.reverseFlow('FL20261029006', 1, '课程取消', '课程 C20261029005 实际未上课', '张敏');
  assert('F: 生成新流水', !!r.flow.id && r.flow.id !== 'FL20261029006');
  assert('F: 新流水方向相反', r.flow.delta === 1, r.flow.delta);
  assert('F: 新流水类型=扣课冲正', r.flow.type === '扣课冲正');
  assert('F: 流水总数+1', S.flows().length === flowsBefore + 1);
  assert('F: 账户余额增加', S.account(f.account).remain === balBefore + 1, S.account(f.account).remain);
  assert('F: 新流水记变动前后余额', r.flow.before === balBefore && r.flow.after === balBefore + 1);
  assert('F: 备注含关联原流水', r.flow.note.includes('FL20261029006'));
  assert('F: 原流水保留且未被修改', S.flow('FL20261029006').delta === f.delta && S.flow('FL20261029006').after === f.after);
  assert('F: 冲正记录含原因/操作人/时间/关联',
    (() => { const v = S.reversalsOf('FL20261029006')[0]; return v && v.reason === '课程取消'
      && v.by === '张敏' && !!v.at && v.flowId === 'FL20261029006' && v.newFlowId === r.flow.id; })());

  assert('F: 重复全额冲正被拒绝',
    throws(() => S.reverseFlow('FL20261029006', 1, '课程取消', '再来一次', '张敏'), '已全额冲正'));

  // 部分冲正：构造一笔 -2 的扣课流水作为测试数据
  S.db.flows.unshift({
    id: 'FLTEST00002', student: '陈可欣', account: 'ACC-2026-0001', type: '正常扣课',
    delta: -2, before: 44, after: 42, ref: 'CTEST 课程完成', op: '系统',
    time: '2026-11-02 11:00', note: ''
  });
  S.save();
  const bal2 = S.account('ACC-2026-0001').remain;
  const r1 = S.reverseFlow('FLTEST00002', 1, '重复扣课', '部分冲回 1 课时', '张敏');
  assert('F: 部分冲正成功', r1.remaining === 1, r1.remaining);
  assert('F: 部分冲正后余额+1', S.account('ACC-2026-0001').remain === bal2 + 1);
  assert('F: 剩余可冲正 1',
    throws(() => S.reverseFlow('FLTEST00002', 2, '重复扣课', '超额', '张敏'), '上限'));
  const r2b = S.reverseFlow('FLTEST00002', 1, '重复扣课', '再冲 1 课时', '张敏');
  assert('F: 冲满后剩余 0', r2b.remaining === 0, r2b.remaining);
  assert('F: 冲满后禁止再冲',
    throws(() => S.reverseFlow('FLTEST00002', 1, '重复扣课', '第三次', '张敏'), '已全额冲正'));
  assert('F: 账户已用课时相应扣减', S.account('ACC-2026-0001').used >= 0);
})();

/* ============================================================
   家长端复习词表
   ============================================================ */
(function parent() {
  S.reset();
  const all = S.reviewWords(SID, {});
  assert('P: 全部体系有数据', all.length > 0, all.length);
  assert('P: 默认不含已通过单词', all.every(r => r.state !== '本次通过'));

  const lt = S.reviewWords(SID, { system: 'leitner' });
  const p21 = S.reviewWords(SID, { system: 'plan21' });
  assert('P: 莱特纳体系子集', lt.every(r => r.systems.indexOf('莱特纳') >= 0));
  assert('P: 21 天体系子集', p21.every(r => r.systems.indexOf('21 天') >= 0));
  assert('P: 全部=两体系并集去重',
    all.length <= lt.length + p21.length && all.length > 0);
  assert('P: 结果按 wordId 唯一', new Set(all.map(r => r.wordId)).size === all.length);

  const withPassed = S.reviewWords(SID, { includePassed: true });
  assert('P: 含已通过数量不少于默认', withPassed.length >= all.length);

  const bk = S.wordbooks().filter(b => b.wordCount > 0)[0];
  const byBook = S.reviewWords(SID, { bookId: bk.id });
  assert('P: 词库筛选生效', byBook.every(r => r.bookIds.indexOf(bk.id) >= 0), byBook.length);
  const emptyBook = S.reviewWords(SID, { bookId: 'WB999' });
  assert('P: 不存在词库返回空', emptyBook.length === 0);

  // 家庭复习勾选不改变正式状态
  const wid = all[0].wordId;
  const stBefore = S.wordState(SID, wid).state;
  const boxBefore = (S.leitnerState(SID, wid) || {}).box;
  S.toggleFamilyCheck(SID, wid, true, '家长');
  assert('P: 勾选已记录', S.familyCheck(SID, wid).checked === true);
  assert('P: 勾选不改变学员学习状态', S.wordState(SID, wid).state === stBefore);
  assert('P: 勾选不改变莱特纳盒子', (S.leitnerState(SID, wid) || {}).box === boxBefore);
  S.toggleFamilyCheck(SID, wid, false, '家长');
  assert('P: 取消勾选生效', S.familyCheck(SID, wid).checked === false);

  // 刷新后勾选仍在
  S.toggleFamilyCheck(SID, wid, true, '家长');
  const S4 = boot();
  assert('P: 刷新后勾选保留', S4.familyCheck(SID, wid).checked === true);
})();

/* ============================================================
   跨页一致性：训练 → 档案 → 单词详情
   ============================================================ */
(function cross() {
  S.reset();
  const t = S.startTrainTask({ studentId: SID, teacherId: 'T001', wordbookId: 'WB001' });
  S.wordsOfBook('WB001').forEach((w, i) => S.prescreenAnswer(t.id, w.id, i < 18));
  const r = S.finishPrescreen(t.id);
  assert('X: 队列 5（23 词中 18 个认识，满足最低 5 个）', r.queue.length === 5, r.queue.length);
  r.queue.forEach(id => S.trainJudge(t.id, id, 'no', 'en2cn', 0));
  const fr = S.toFinalStage(t.id);
  assert('X: 进入最后复习', fr.ok === true);
  r.queue.forEach(id => S.finalJudge(t.id, id, 'no'));
  const res = S.completeTask(t.id, { joinLeitner: true, by: '李婉' });
  assert('X: 提交成功', res.ok === true);

  const w0 = r.queue[0];
  const S5 = boot();
  assert('X: 刷新后任务仍已完成', S5.trainTask(t.id).status === '已完成');
  assert('X: 单词档案状态=待复习', S5.wordState(SID, w0).state === '待复习', S5.wordState(SID, w0).state);
  assert('X: 莱特纳盒子=红', S5.leitnerState(SID, w0).box === 'red', S5.leitnerState(SID, w0).box);
  assert('X: 莱特纳今日到期含该词',
    S5.leitnerDue(SID).union.some(s => s.wordId === w0));
  assert('X: 单词档案能查到训练明细', S5.trainDetailsOf(SID, w0).length >= 1);
  assert('X: 单词档案能查到最后复习',
    S5.finalReviewsOf(SID, w0).some(x => x.taskId === t.id));
  assert('X: 学员统计已更新', S5.stats(SID).byState['待复习'] >= 1);
})();

/* ============================================================ */
const total = ok.length + bad.length;
console.log('');
if (bad.length) {
  console.log('失败 ' + bad.length + ' 项：');
  bad.forEach(b => console.log('  ✗ ' + b));
  console.log('');
}
console.log('通过 ' + ok.length + ' / ' + total + ' 项');
console.log(bad.length ? '存在失败断言' : '第二轮全部断言通过');
process.exit(bad.length ? 1 : 0);
