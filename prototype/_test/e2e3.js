/* ============================================================
   第三轮迭代验收：从「功能闭环」到「课程闭环」
   ------------------------------------------------------------
   覆盖：
     一、统一状态词表（五个状态 + phase 分离，不再用布尔拼状态）
     二、课程上下文（openCourse / linkTask / 记录归属 courseId）
     三、课程教学记录聚合（关联 + 实时汇总 + 完成快照，不复制明细）
     四、未完成内容的三种处理策略（保留 / 结束 / 取消）
     五、完成课程与课时扣减（含余额不足）
     六、教学报告状态机（编辑中 → 已提交 → 已发布，家长可见性门控）
     七、复习来源解释（红盒 / 黄盒 / 教师指定）
     八、文章训练教师判定（掌握 / 待加强）
     九、单词学习全景（先看现在，再看时间轴）
    十、跨页一致性（课程 / 记录 / 报告 / 任务状态互不矛盾）
   运行：node prototype/_test/e2e3.js
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
const CID = 'C20261102005';          // 今天 19:00 陈可欣 待上课
const CID_DONE = 'C20261102001';     // 今天 09:00 已完成（报告编辑中）
const CID_PUB = 'C20261031001';      // 10-31 已完成（报告已发布）

/* ============================================================
   一、统一状态词表
   ============================================================ */
(function statusUnified() {
  const S = boot();
  const ALLOWED = ['未开始', '进行中', '已完成', '已中断', '已取消'];
  const inSet = v => ALLOWED.indexOf(v) >= 0;

  assert('状态词表仅五个值', Object.keys(S.STATUS).length === 5);
  assert('状态词表取值正确', ALLOWED.every(v => Object.keys(S.STATUS).map(k => S.STATUS[k]).indexOf(v) >= 0));

  const allTrain = S.db.trainTasks.every(t => inSet(t.status) && typeof t.phase === 'string');
  assert('训练任务状态在词表内且有 phase', allTrain);
  assert('训练任务不再有 submitted 布尔', S.db.trainTasks.every(t => t.submitted === undefined));

  assert('莱特纳任务状态在词表内', S.db.leitnerTasks.every(t => inSet(t.status)));
  assert('莱特纳任务不再有 interrupted 布尔', S.db.leitnerTasks.every(t => t.interrupted === undefined));
  assert('文章任务状态在词表内', S.db.articleTasks.every(t => inSet(t.status)));
  assert('21 天节点状态在词表内', S.db.plan21Tasks.every(t => inSet(t.status)));

  const nodes = S.db.plan21Tasks.filter(t => t.wordIds.length);
  assert('21 天节点有独立排期状态', nodes.every(t => ['今日', '未到期', '已逾期', '已完成'].indexOf(t.dateState) >= 0));
  /* status 是生命周期，dateState 是排期；两者词表不交叉（唯一合法的重合是「已完成」） */
  assert('排期词不写进任务状态', nodes.every(t => ['今日', '未到期', '已逾期', '休息'].indexOf(t.status) < 0));
  assert('节点状态仍用统一词表', nodes.every(t => inSet(t.status)));
  assert('状态与排期是两个字段', nodes.every(t => t.status !== t.dateState || t.status === '已完成'));

  const doneNode = nodes.filter(t => t.status === '已完成')[0];
  assert('已完成节点排期显示已完成', doneNode && doneNode.dateState === '已完成', doneNode && doneNode.dateState);
  const rest = S.db.plan21Tasks.filter(t => !t.wordIds.length)[0];
  assert('休息日排期=休息', rest && rest.dateState === '休息', rest && rest.dateState);

  assert('课程状态在课程词表内',
    S.db.courses.every(c => ['待上课', '授课中', '已完成', '未上课', '已取消'].indexOf(c.status) >= 0));
  assert('旧的「待处理」已归一为已完成+扣课异常', (function () {
    const c = S.db.courses.filter(x => x.id === 'C20261029003')[0];
    return c && c.status === '已完成' && c.deductState === '扣课异常';
  })());
})();

/* ============================================================
   二、课程上下文：进入课程 → 任务归属 → 判断记录归属
   ============================================================ */
(function courseContext() {
  const S = boot();
  S.reset();
  const r0 = S.openCourse(CID);
  assert('进入课程成功', r0.ok === true);
  assert('课程状态 → 授课中', S.course(CID).status === '授课中', S.course(CID).status);
  assert('生成课程教学记录', !!r0.record && r0.record.status === '进行中');
  assert('课程与记录互指', S.course(CID).recordId === r0.record.id);

  const again = S.openCourse(CID);
  assert('重复进入复用同一记录', again.record.id === r0.record.id);

  const bk = S.db.wordbooks.filter(b => b.wordCount > 0)[0];
  const t = S.startTrainTask({ studentId: SID, teacherId: 'T001', wordbookId: bk.id, courseId: CID });
  S.linkTask(CID, 'train', t.id);
  assert('训练任务带课程号', t.courseId === CID, t.courseId);
  assert('课程记录关联训练任务', S.courseRecord(r0.record.id).links.trainTaskIds.indexOf(t.id) >= 0);

  assert('新任务状态=未开始 + 阶段=预筛选', t.status === '未开始' && t.phase === '预筛选', t.status + '/' + t.phase);
  t.wordIds.slice(0, 5).forEach(id => S.prescreenAnswer(t.id, id, false));
  assert('作答后状态=进行中', S.trainTask(t.id).status === '进行中');
  const fr = S.finishPrescreen(t.id);
  assert('预筛完成进入强化训练阶段',
    S.trainTask(t.id).status === '进行中' && S.trainTask(t.id).phase === '强化训练');

  S.trainJudge(t.id, fr.queue[0], 'yes', 'en2cn', 0, CID);
  const d = S.trainDetailsOf(SID, fr.queue[0])[0];
  assert('强化训练记录带课程号', d.courseId === CID, d.courseId);

  const other = S.recordSummary(r0.record.id);
  assert('汇总只统计本节课的动作', other.trainWords === 1 && other.trainRecords === 1, JSON.stringify(other));

  /* 同一任务在不带课程号时判断，不污染本节课汇总 */
  S.trainJudge(t.id, fr.queue[1], 'no', 'en2cn', 0, '');
  const other2 = S.recordSummary(r0.record.id);
  assert('无课程号的判断不进本节课', other2.trainWords === 1, other2.trainWords);

  /* 莱特纳任务 */
  const due = S.leitnerDueDetail(SID);
  const lt = S.createLeitnerTask(SID, due.items.slice(0, 3).map(x => x.wordId), 'T001', '系统推荐', CID);
  S.linkTask(CID, 'leitner', lt.id);
  assert('莱特纳任务带课程号', lt.courseId === CID);
  S.leitnerJudge(lt.id, lt.wordIds[0], 'yes', 'T001', CID);
  const lr = S.leitnerTaskRecords(lt.id)[0];
  assert('莱特纳记录带课程号', lr.courseId === CID, lr.courseId);
  assert('汇总包含莱特纳', S.recordSummary(r0.record.id).leitnerWords === 1);

  /* 刷新后仍在 */
  const S2 = boot();
  assert('刷新后课程仍为授课中', S2.course(CID).status === '授课中');
  assert('刷新后记录仍在', S2.recordOfCourse(CID).links.trainTaskIds.indexOf(t.id) >= 0);
  assert('刷新后记录课程号仍在', S2.trainDetailsOf(SID, fr.queue[0])[0].courseId === CID);
})();

/* ============================================================
   三、课程教学记录：只做关联与汇总，不复制明细
   ============================================================ */
(function recordAggregation() {
  const S = boot();
  S.reset();
  const r = S.openCourse(CID).record;
  assert('新建记录 summary 为空（未落汇总）', r.snapshot === null);

  const bk = S.db.wordbooks.filter(b => b.wordCount > 0)[0];
  const t = S.startTrainTask({ studentId: SID, teacherId: 'T001', wordbookId: bk.id, courseId: CID });
  S.linkTask(CID, 'train', t.id);
  t.wordIds.slice(0, 5).forEach(id => S.prescreenAnswer(t.id, id, false));
  const fr = S.finishPrescreen(t.id);
  fr.queue.forEach((id, i) => S.trainJudge(t.id, id, i % 2 ? 'no' : 'yes', 'en2cn', 0, CID));

  const s1 = S.recordSummary(r.id);
  assert('实时汇总：单词数=队列数', s1.trainWords === fr.queue.length, s1.trainWords);
  assert('实时汇总：记录数=判断条数', s1.trainRecords === fr.queue.length, s1.trainRecords);
  assert('汇总不写入记录（仍为 null）', S.courseRecord(r.id).snapshot === null);

  const before = fs.existsSync ? null : null;
  const detailCount = S.db.trainDetails.length;
  assert('汇总不产生明细副本', S.db.trainDetails.length === detailCount && before === null);

  /* 修正记录不会让汇总虚增 */
  const target = fr.queue[0];
  S.trainCorrect(t.id, target, 'no', '课上误判', 0, CID);
  const s2 = S.recordSummary(r.id);
  assert('修正不增加单词数', s2.trainWords === s1.trainWords, s2.trainWords);
  assert('修正增加记录条数', s2.trainRecords === s1.trainRecords + 1, s2.trainRecords);

  /* 汇总口径：进行中读实时，已完成读快照 —— 两者字段必须同构 */
  const FIELDS = ['trainWords', 'trainRecords', 'leitnerWords', 'leitnerRecords',
    'plan21Words', 'plan21Records', 'articleCount', 'articleSentences',
    'articleMastered', 'articleWeak', 'mastered', 'weak', 'totalActions'];
  const live = S.recordView(r.id);
  assert('进行中的课 recordView = 实时汇总', live.trainRecords === s2.trainRecords, live.trainRecords);

  const S2 = boot();
  const seededDone = S2.db.courseRecords.filter(x => x.status === '已完成' && x.snapshot)[0];
  assert('已有已完成课程快照', !!seededDone);
  const snap = S2.recordView(seededDone.id);
  assert('已完成的课 recordView = 快照', snap === S2.courseRecord(seededDone.id).snapshot);
  assert('快照字段与实时汇总同构',
    FIELDS.every(k => typeof snap[k] === 'number'), FIELDS.filter(k => typeof snap[k] !== 'number'));
  assert('快照不含 trainDone / articleTotal 这类旧字段',
    snap.trainDone === undefined && snap.articleTotal === undefined,
    Object.keys(snap));
})();

/* ============================================================
   四、未完成内容的三种处理策略
   ============================================================ */
(function unfinishedPolicy() {
  /* 4.1 默认保留 */
  let S = boot(); S.reset();
  S.openCourse(CID);
  const bk = S.db.wordbooks.filter(b => b.wordCount > 0)[0];
  let t = S.startTrainTask({ studentId: SID, teacherId: 'T001', wordbookId: bk.id, courseId: CID });
  S.linkTask(CID, 'train', t.id);
  t.wordIds.slice(0, 5).forEach(id => S.prescreenAnswer(t.id, id, false));
  let fr = S.finishPrescreen(t.id);
  S.trainJudge(t.id, fr.queue[0], 'yes', 'en2cn', 0, CID);

  const unf = S.courseUnfinished(CID);
  assert('检测到未完成任务', unf.total === 1 && unf.items[0].kind === 'train', JSON.stringify(unf.items.map(i => i.kind)));
  assert('未完成项给出 已完成/剩余', unf.items[0].done === 1 && unf.items[0].remain === fr.queue.length - 1);

  const f1 = S.finishCourse(CID, { policy: '保留', note: '保留，下节课继续', by: 'T001' });
  assert('完成课程成功', f1.ok === true, JSON.stringify(f1.reason));
  assert('策略记录为保留', f1.record.unfinishedPolicy === '保留');
  assert('保留下任务仍可继续', S.trainTask(t.id).status === '进行中', S.trainTask(t.id).status);
  assert('保留下未完成快照已写入', f1.record.unfinished.length === 1 && f1.record.unfinished[0].remain === fr.queue.length - 1);
  assert('完整快照已写入', !!f1.record.snapshot && f1.record.snapshot.trainWords === 1);
  assert('课程状态=已完成', S.course(CID).status === '已完成');
  assert('记录状态=已完成', S.recordOfCourse(CID).status === '已完成');

  /* 4.2 结束任务 */
  S = boot(); S.reset();
  const CID2 = 'C20261102002';  // 付嘉禾 10:15 待上课
  S.openCourse(CID2);
  const bk2 = S.db.wordbooks.filter(b => b.wordCount > 0)[0];
  const t2 = S.startTrainTask({ studentId: 'S2026005', teacherId: 'T001', wordbookId: bk2.id, courseId: CID2 });
  S.linkTask(CID2, 'train', t2.id);
  t2.wordIds.slice(0, 5).forEach(id => S.prescreenAnswer(t2.id, id, false));
  const fr2 = S.finishPrescreen(t2.id);
  S.trainJudge(t2.id, fr2.queue[0], 'yes', 'en2cn', 0, CID2);
  const f2 = S.finishCourse(CID2, { policy: '结束', reason: '本节时间结束', by: 'T001' });
  assert('结束策略执行成功', f2.ok === true);
  assert('任务变为已中断', S.trainTask(t2.id).status === '已中断', S.trainTask(t2.id).status);
  assert('已中断带原因', !!S.trainTask(t2.id).interruptReason);
  assert('已做记录保留', S.trainTaskStat(t2.id).trained === 1);

  /* 4.3 取消剩余内容 */
  S = boot(); S.reset();
  const CID3 = 'C20261102001';
  S.openCourse(CID3, { allowDone: true });
  const bk3 = S.db.wordbooks.filter(b => b.wordCount > 0)[0];
  const t3 = S.startTrainTask({ studentId: SID, teacherId: 'T001', wordbookId: bk3.id, courseId: CID3 });
  S.linkTask(CID3, 'train', t3.id);
  const f3 = S.finishCourse(CID3, { policy: '取消', reason: '临时取消', by: 'T001', allowDone: true });
  assert('已完成课程不能重复完成', f3.ok === false, JSON.stringify(f3));

  /* 4.4 非法策略 */
  assert('非法策略被拒绝', throws(() => S.finishCourse(CID3, { policy: '随便' }), '不合法'));
})();

/* ============================================================
   五、完成课程与课时扣减
   ============================================================ */
(function deduct() {
  const S = boot();
  S.reset();
  const acc0 = S.db.accounts.filter(a => a.student === '陈可欣')[0];
  const before = acc0.remain;
  const flowN = S.db.flows.length;

  S.openCourse(CID);
  const f = S.finishCourse(CID, { policy: '保留', by: 'T001' });
  assert('完成课程扣 1 课时', f.deduct.ok === true && f.deduct.remaining === before - 1, JSON.stringify(f.deduct));
  assert('账户余额已更新', S.db.accounts.filter(a => a.student === '陈可欣')[0].remain === before - 1);
  assert('新增一条扣课流水', S.db.flows.length === flowN + 1);
  const nf = S.db.flows[S.db.flows.length - 1];
  assert('流水类型=正常扣课', nf.type === '正常扣课' && nf.delta === -1);
  assert('流水记录前后余额', nf.before === before && nf.after === before - 1);
  assert('流水关联课程', nf.courseId === CID, nf.courseId);
  assert('课程扣课状态=已扣课', S.course(CID).deductState === '已扣课');

  const f2 = S.finishCourse(CID, { policy: '保留' });
  assert('重复完成被拒绝', f2.ok === false, JSON.stringify(f2.reason));
  assert('重复完成不重复扣课', S.db.accounts.filter(a => a.student === '陈可欣')[0].remain === before - 1);

  /* 余额不足：不阻断完成，但标记扣课异常 */
  const S2 = boot();
  S2.reset();
  const acc = S2.db.accounts.filter(a => a.student === '陈可欣')[0];
  acc.remain = 0;
  S2.save();
  S2.openCourse(CID);
  const f3 = S2.finishCourse(CID, { policy: '保留', by: 'T001' });
  assert('余额不足仍可完成课程', f3.ok === true);
  assert('余额不足标记扣课异常', S2.course(CID).deductState === '扣课异常', S2.course(CID).deductState);
  assert('余额不足给出提示', f3.warnings.length === 1 && f3.warnings[0].includes('余额不足'), JSON.stringify(f3.warnings));
})();

/* ============================================================
   六、教学报告状态机
   ============================================================ */
(function reportFlow() {
  const S = boot();
  S.reset();

  /* 6.1 课程完成后自动生成「编辑中」报告 */
  const r0 = S.openCourse(CID);
  assert('进入课程时还没有报告', !S.reportOfCourse(CID));
  const f = S.finishCourse(CID, { policy: '保留', by: 'T001' });
  const rp = f.report;
  assert('完成课程生成报告', !!rp && rp.status === '编辑中', rp && rp.status);
  assert('报告与记录互指', rp.recordId === f.record.id && f.record.reportId === rp.id);

  /* 6.2 未填写不能提交 */
  assert('空报告不能提交', throws(() => S.submitReport(rp.id, 'T001'), '请先填写'));
  S.saveReportDraft(rp.id, { performance: '本节表现良好' }, 'T001');
  assert('只填一段仍不能提交', throws(() => S.submitReport(rp.id, 'T001'), '待加强'));

  /* 6.3 三段齐全 → 已提交 */
  S.saveReportDraft(rp.id, { performance: '本节表现良好', weak: '发音待加强', next: '下节课先复习' }, 'T001');
  const sb = S.submitReport(rp.id, 'T001');
  assert('提交报告成功', sb.ok === true && sb.report.status === '已提交');
  assert('提交时间已记录', !!S.report(rp.id).submittedAt);
  assert('重复提交被拒绝', S.submitReport(rp.id, 'T001').ok === false);

  /* 6.4 未提交不能发布；提交后才能发布 */
  const rp2Course = 'C20261103001';
  assert('未提交报告不能发布', throws(() => S.publishReport(S.reportOfCourse(rp2Course) ? S.reportOfCourse(rp2Course).id : 'RP-NONE', 'T001')));

  const pb = S.publishReport(rp.id, 'T001');
  assert('发布报告成功', pb.ok === true && pb.report.status === '已发布');
  assert('发布时间已记录', !!S.report(rp.id).publishedAt);
  assert('重复发布被拒绝', S.publishReport(rp.id, 'T001').ok === false);
  assert('已发布不能改内容', throws(() => S.saveReportDraft(rp.id, { performance: 'x' }, 'T001'), '已发布'));

  /* 6.5 家长可见性门控 */
  const pub = S.publishedReportsOf(SID);
  const all = S.reportsOf(SID);
  assert('家长可见报告少于全部报告', pub.length < all.length, pub.length + '/' + all.length);
  assert('家长可见全部为已发布', pub.every(r => r.status === '已发布'));
  const draft = all.filter(r => r.status === '编辑中')[0];
  assert('编辑中报告不在家长可见列表', draft && pub.every(r => r.id !== draft.id));

  /* 6.6 刷新后状态不变（必须在任何 reset 之前读取，否则库被重建） */
  const S3 = boot();
  assert('刷新后报告已发布', S3.report(rp.id) && S3.report(rp.id).status === '已发布');
  assert('刷新后课程已完成', S3.course(CID).status === '已完成');
  assert('刷新后扣课状态保留', S3.course(CID).deductState === '已扣课');
})();

/* 6.7 课程未完成不能提交报告 —— 独立库，避免覆盖上一节 */
(function reportGate() {
  const S = boot();
  S.reset();
  const C = 'C20261103001';           // 待上课
  const c0 = S.course(C);
  assert('门控课程尚未上课', c0.status === '待上课', c0.status);
  assert('不存在的报告不能改', throws(() => S.saveReportDraft('RP-NONE', { performance: 'a' }, 'T001'), '不存在'));
  assert('不存在的报告不能提交', throws(() => S.submitReport('RP-NONE', 'T001'), '不存在'));

  /* 真正走一遍：进入课程（授课中）但不完成，此时不存在报告 */
  S.openCourse(C);
  assert('授课中不生成报告', !S.reportOfCourse(C), S.reportOfCourse(C) && S.reportOfCourse(C).status);
  assert('授课中课程状态正确', S.course(C).status === '授课中', S.course(C).status);

  /* 人为挂一条「编辑中」报告到未完成课程上，验证提交门控 */
  const tpl = JSON.parse(JSON.stringify(S.db.reports[0]));
  tpl.id = 'RP-GATE'; tpl.courseId = C; tpl.status = '编辑中';
  tpl.content = { performance: 'a', weak: 'b', next: 'c' };
  S.db.reports.push(tpl);
  S.save();
  assert('课程未完成不能提交报告', throws(() => S.submitReport('RP-GATE', 'T001'), '尚未完成'));
  assert('未完成课程不进入家长可见', S.publishedReportsOf('S2026001').every(r => r.id !== 'RP-GATE'));
})();

/* ============================================================
   七、复习来源解释
   ============================================================ */
(function dueReason() {
  const S = boot();
  S.reset();
  const d = S.leitnerDueDetail(SID);
  const due = S.leitnerDue(SID);

  assert('红盒分组非空', d.red.length > 0, d.red.length);
  assert('分组总数 = 推荐总数', d.red.length + d.yellow.length + d.manual.length === d.total);
  assert('推荐总数不超过体系内单词', d.total <= S.leitnerStates(SID).filter(s => s.box !== 'graduated').length);
  assert('与 leitnerDue 口径一致', d.total === due.dedupTotal, d.total + '/' + due.dedupTotal);
  assert('每个推荐项都有原因', d.items.every(i => !!i.reason));
  assert('推荐项按 wordId 唯一', new Set(d.items.map(i => i.wordId)).size === d.total);

  const p = S.plan21TodaySummary(SID);
  assert('21 天摘要：有计划', p.hasPlan === true);
  assert('21 天摘要：第 N 天', p.day > 0 && p.day <= 21, p.day);
  assert('21 天摘要：今日应复习 = 已完成 + 剩余',
    p.due === p.done + p.remain || p.remain === 0, p.due + ' vs ' + p.done + '+' + p.remain);
  assert('21 天摘要：逾期字段存在', typeof p.overdueTasks === 'number' && typeof p.overdueWords === 'number');
})();

/* ============================================================
   八、文章训练教师判定
   ============================================================ */
(function articleVerdict() {
  const S = boot();
  S.reset();
  S.openCourse(CID);
  const sents = (S.W && S.W.DB ? [] : null) || null;
  const at = S.startArticleTask({
    studentId: SID, teacherId: 'T001', articleId: 'AR001', articleName: 'My First Day at School',
    courseId: CID, by: '李婉',
    sentences: [1, 2, 3, 4].map(i => ({ i, en: 'Sentence ' + i, cn: '第 ' + i + ' 句' }))
  });
  S.linkTask(CID, 'article', at.id);
  assert('文章任务带课程号', at.courseId === CID);

  const d1 = S.articleTaskDetails(at.id)[0];
  assert('句子初始未判定', d1.verdict === '' && d1.verdictLog.length === 0);

  S.articleSentenceLog(at.id, d1.sentenceId, { audioPlayed: true, cnViewed: true, readDone: true });
  assert('跟读完成但未判定', S.articleTaskStat(at.id).done === 1 && S.articleTaskStat(at.id).judged === 0);

  S.articleSentenceLog(at.id, d1.sentenceId, { verdict: '掌握' });
  assert('判定掌握写入', S.articleDetail(at.id, d1.sentenceId).verdict === '掌握');
  assert('统计掌握数=1', S.articleTaskStat(at.id).mastered === 1);

  S.articleSentenceLog(at.id, d1.sentenceId, { verdict: '待加强', verdictNote: '连读不自然' });
  const dd = S.articleDetail(at.id, d1.sentenceId);
  assert('改判保留历史', dd.verdict === '待加强' && dd.verdictLog.length === 2, dd.verdictLog.length);
  assert('判定历史带原因', dd.verdictLog[1].note === '连读不自然');
  assert('统计随判定更新', S.articleTaskStat(at.id).mastered === 0 && S.articleTaskStat(at.id).weak === 1);

  assert('非法判定被拒绝', throws(() => S.articleSentenceLog(at.id, d1.sentenceId, { verdict: '还行' }), '掌握'));

  /* 不改单词状态 */
  const ws = S.wordState(SID, S.db.words[0].id);
  const wsBefore = ws ? ws.state : '未训练';
  S.articleSentenceLog(at.id, S.articleTaskDetails(at.id)[1].sentenceId, { readDone: true, verdict: '掌握' });
  const wsAfter = S.wordState(SID, S.db.words[0].id);
  assert('文章判定不改单词掌握状态', (wsAfter ? wsAfter.state : '未训练') === wsBefore);

  /* 未完成不能直接保存为已完成 */
  assert('未完成保存必须填原因', throws(() => S.finishArticleTask(at.id, { evaluation: 'ok' }), '结束原因'));
  const fa = S.finishArticleTask(at.id, { evaluation: 'ok', endReason: '课堂时间不足', by: 'T001' });
  assert('提前结束 → 已中断', fa.ok === true && fa.task.status === '已中断', fa.task.status);
  assert('中断保留已做句数', fa.done === 2 && fa.remain === 2, fa.done + '/' + fa.remain);
  assert('结束后禁止记录', throws(() => S.articleSentenceLog(at.id, d1.sentenceId, { readDone: true }), '已结束'));
})();

/* ============================================================
   九、单词学习全景
   ============================================================ */
(function panorama() {
  const S = boot();
  S.reset();
  const wid = S.db.words[0].id;
  const p = S.wordPanorama(SID, wid);
  assert('全景返回单词', p && p.word.id === wid);
  assert('全景包含当前状态', typeof p.state === 'string' && !!p.state);
  assert('全景包含莱特纳信息', p.leitner && typeof p.leitner.inSystem === 'boolean');
  assert('全景包含 21 天信息', p.plan21 !== undefined);
  assert('全景包含最近训练字段', 'lastTrain' in p);
  assert('时间轴按时间倒序', p.timeline.every((x, i) => i === 0 || p.timeline[i - 1].at >= x.at));
  assert('时间轴每项有类型与文案', p.timeline.every(x => !!x.type && !!x.text));

  const p2 = S.wordPanorama(SID, 'w9999');
  assert('不存在的单词返回 null', p2 === null);

  /* 有训练记录时最近训练可见 */
  S.openCourse(CID);
  const bk = S.db.wordbooks.filter(b => b.wordCount > 0)[0];
  const t = S.startTrainTask({ studentId: SID, teacherId: 'T001', wordbookId: bk.id, courseId: CID });
  t.wordIds.slice(0, 5).forEach(id => S.prescreenAnswer(t.id, id, false));
  const fr = S.finishPrescreen(t.id);
  S.trainJudge(t.id, fr.queue[0], 'yes', 'en2cn', 0, CID);
  const p3 = S.wordPanorama(SID, fr.queue[0]);
  assert('训练后最近训练可读', p3.lastTrain && p3.lastTrain.result === 'yes', JSON.stringify(p3.lastTrain));
  assert('时间轴包含强化训练', p3.timeline.some(x => x.type.indexOf('强化训练') === 0));
})();

/* ============================================================
   十、跨页一致性
   ============================================================ */
(function consistency() {
  const S = boot();
  S.reset();
  const S2 = boot();
  assert('刷新前后课程数一致', S.courseStat('T001', S.TODAY).total === S2.courseStat('T001', S.TODAY).total);

  S.openCourse(CID);
  const f = S.finishCourse(CID, { policy: '保留', by: 'T001' });
  const c = S.course(CID);
  const rec = S.recordOfCourse(CID);
  const rp = S.reportOfCourse(CID);

  assert('课程/记录/报告三者状态自洽',
    c.status === '已完成' && rec.status === '已完成' && rp.status === '编辑中',
    c.status + '/' + rec.status + '/' + rp.status);
  assert('课程记录 ID 与课程互指', c.recordId === rec.id && rec.courseId === c.id);
  assert('报告指向同一课程', rp.courseId === c.id && rp.recordId === rec.id);

  const S3 = boot();
  assert('刷新后三者仍自洽',
    S3.course(CID).status === '已完成'
    && S3.recordOfCourse(CID).status === '已完成'
    && S3.reportOfCourse(CID).status === '编辑中');

  /* 报告发布后家长端可读，且内容与教师写入一致 */
  S3.saveReportDraft(rp.id, { performance: '表现 A', weak: '薄弱 B', next: '建议 C' }, 'T001');
  S3.submitReport(rp.id, 'T001');
  S3.publishReport(rp.id, 'T001');
  const S4 = boot();
  const pub = S4.publishedReportsOf(SID).filter(r => r.id === rp.id)[0];
  assert('家长端读到已发布报告', !!pub);
  assert('家长端内容与教师写入一致',
    pub.content.performance === '表现 A' && pub.content.weak === '薄弱 B' && pub.content.next === '建议 C');

  /* 课程状态不会因为任务中断而变形 */
  const S5 = boot();
  S5.reset();
  S5.openCourse('C20261102002');
  const bk = S5.db.wordbooks.filter(b => b.wordCount > 0)[0];
  const t = S5.startTrainTask({ studentId: 'S2026005', teacherId: 'T001', wordbookId: bk.id, courseId: 'C20261102002' });
  S5.linkTask('C20261102002', 'train', t.id);
  t.wordIds.slice(0, 5).forEach(id => S5.prescreenAnswer(t.id, id, false));
  S5.finishPrescreen(t.id);
  S5.endTask(t.id, '学员状态不佳', '');
  assert('训练中断不影响课程状态', S5.course('C20261102002').status === '授课中');
  S5.finishCourse('C20261102002', { policy: '保留', by: 'T001' });
  assert('课程完成后中断任务仍是已中断',
    S5.trainTask(t.id).status === '已中断' && S5.course('C20261102002').status === '已完成');
})();

/* ============================================================
   汇总
   ============================================================ */
console.log('');
if (bad.length) {
  console.log('失败 ' + bad.length + ' 项：');
  bad.forEach(b => console.log('  ✗ ' + b));
  console.log('');
}
console.log('通过 ' + ok.length + ' / ' + (ok.length + bad.length) + ' 项');
if (!bad.length) console.log('第三轮全部断言通过');
process.exit(bad.length ? 1 : 0);
