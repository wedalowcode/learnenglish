/* 第十二轮 · 阶段四验收：多学员批量排课
   ------------------------------------------------------------
   实际执行：三步行的批次草稿、硬冲突分级、提醒确认、跳过、
             失败行单独重校验再提交、已创建行幂等跳过、
             重新加载后再次提交不重复建课、300 行上限。
   静态检查：batch-schedule.html 的分页多选、批量指定、智能推荐、
             预览分级、提交计数与历史批次恢复。
   运行：node prototype/_test/r12-batch.js
   ============================================================ */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..', 'assets', 'js') + path.sep;
const pageFile = path.join(__dirname, '..', 'admin', 'batch-schedule.html');

function boot(seed) {
  const mem = Object.assign({}, seed || {});
  const localStorage = {
    getItem: k => (k in mem ? mem[k] : null),
    setItem: (k, v) => { mem[k] = String(v); },
    removeItem: k => { delete mem[k]; },
    _dump: () => Object.assign({}, mem)
  };
  const sandbox = { console, localStorage, Date, JSON, Math, Object, Array, String, Number,
    isFinite, parseInt, parseFloat, RegExp, setTimeout, clearTimeout };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(root + 'data.js', 'utf8'), sandbox, { filename: 'data.js' });
  vm.runInContext(fs.readFileSync(root + 'store.js', 'utf8'), sandbox, { filename: 'store.js' });
  return { S: sandbox.Store, ls: localStorage };
}

const app = boot();
const S = app.S;
S.setSession({ role: 'admin' });
function throws(fn) { try { fn(); return null; } catch (e) { return e; } }

const ok = [];
const bad = [];
function assert(name, cond, extra) {
  if (cond) ok.push(name);
  else bad.push(name + (extra !== undefined ? ' → ' + JSON.stringify(extra) : ''));
}

/* ---------- 0. 准备：给学员设偏好，制造一条硬冲突 ---------- */
S.saveStudentPreference('S2026002', {
  preferredWeekdays: ['周六'], preferredPeriods: ['上午'],
  availableWeekdays: ['周六', '周日'], availablePeriods: ['上午', '下午'],
  lessonDuration: 60, weeklyLessonCount: 2, effectiveStartDate: '2026-11-02'
});
const blocker = S.createCourse({
  studentId: 'S2026004', teacherId: 'T001', date: '2026-11-11',
  start: '19:00', end: '20:00', note: '占用 T001 周四晚'
});
assert('冲突用课程已创建', !!blocker && blocker.teacherId === 'T001');

/* ---------- 1. 批次草稿与分级 ---------- */
const before = S.db.courses.length;
const rowsIn = [
  { rowKey: 'A', studentId: 'S2026002', teacherId: 'T002', date: '2026-11-03', start: '19:00', end: '20:00', type: '一对一' },
  { rowKey: 'B', studentId: 'S2026005', teacherId: 'T001', date: '2026-11-11', start: '19:00', end: '20:00', type: '一对一' },
  { rowKey: 'C', studentId: 'S2026006', teacherId: 'T002', date: '2026-11-04', start: '19:00', end: '20:00', type: '一对一', skip: true }
];
const batch = S.createScheduleBatch({ rows: rowsIn, note: '阶段四测试' });
assert('批次草稿写入 Store', !!S.batchOf(batch.id) && S.batchOf(batch.id).status === '草稿');
assert('批次追溯字段齐全', ['createdBy', 'operatorId', 'createdAt', 'dateFrom', 'dateTo', 'rows']
  .every(k => k in batch), Object.keys(batch));
assert('逐行行键与结果记录', batch.rows.length === 3 && batch.rows.every(r => r.rowKey && r.result),
  batch.rows.map(r => r.result));
assert('提醒行标为待确认', batch.rows.filter(r => r.rowKey === 'A')[0].result === '待确认',
  batch.rows.filter(r => r.rowKey === 'A')[0]);
assert('硬冲突行标为硬冲突', batch.rows.filter(r => r.rowKey === 'B')[0].result === '硬冲突',
  batch.rows.filter(r => r.rowKey === 'B')[0].reason);
assert('批次统计区分冲突与提醒', batch.warningCount === 1 && batch.conflictCount === 1,
  batch.warningCount + '/' + batch.conflictCount);
assert('草稿阶段不写入课程', S.db.courses.length === before);

/* ---------- 2. 提交：硬冲突阻断、提醒未确认不建课 ---------- */
const c1 = S.commitScheduleBatch(batch.id, { confirmWarnings: false });
assert('未确认提醒时不创建提醒行', c1.created.length === 0 && c1.pending.length === 1, c1);
assert('硬冲突被阻断', c1.failed.length === 1 && c1.failed[0].rowKey === 'B', c1.failed);
assert('跳过行计数', c1.skipped.length === 1 && c1.skipped[0].rowKey === 'C', c1.skipped);
assert('未创建课程保持原数量', S.db.courses.length === before);
assert('批次状态为草稿（部分待处理）', S.batchOf(batch.id).status === '草稿', S.batchOf(batch.id).status);

/* 勾选确认提醒后再提交：A 创建，B 仍冲突，C 跳过 */
const c2 = S.commitScheduleBatch(batch.id, { confirmWarnings: true });
assert('确认提醒后创建 A', c2.created.length === 1 && c2.created[0].rowKey === 'A', c2.created);
assert('再次提交硬冲突仍失败', c2.failed.length === 1 && c2.failed[0].rowKey === 'B');
assert('课程只增加 1 节', S.db.courses.length === before + 1, S.db.courses.length - before);
assert('课程带 batchId 与 batchRowKey', (() => {
  const c = S.db.courses.filter(x => x.batchId === batch.id && x.batchRowKey === 'A')[0];
  return !!c && c.source === '批量';
})());
assert('批量排课不扣课时', S.db.courses.filter(x => x.batchId === batch.id).every(x => x.deduct === '未扣课'));

/* ---------- 3. 失败行单独重校验后重试 ---------- */
const fixed = S.retryBatchRow(batch.id, 'B', {
  date: '2026-11-12', start: '19:00', end: '20:00', teacherId: 'T003'
});
assert('失败行单独改期换教师后变为可提交', fixed.result === '可提交' || fixed.result === '待确认', fixed);
const c3 = S.commitScheduleBatch(batch.id, { confirmWarnings: true });
assert('重试只补建失败行', c3.created.length === 1 && c3.created[0].rowKey === 'B', c3.created);
assert('已成功行与跳过行保持幂等', c3.skipped.some(x => x.rowKey === 'A') && c3.skipped.some(x => x.rowKey === 'C'));
assert('课程总数增加 2 节', S.db.courses.length === before + 2, S.db.courses.length - before);
assert('批次计数与行结果一致', (() => {
  const b = S.batchOf(batch.id);
  return b.createdCount === 2 && b.failedCount === 0 &&
    b.rows.filter(r => r.result === '已创建').length === 2;
})(), S.batchOf(batch.id));

/* ---------- 4. 刷新 / 重新进入后再次提交：幂等 ---------- */
const dump = app.ls._dump();
const app2 = boot(dump);
const S2 = app2.S;
S2.setSession({ role: 'admin' });
const count2 = S2.db.courses.length;
const c4 = S2.commitScheduleBatch(batch.id, { confirmWarnings: true });
assert('刷新后仍能读取批次', !!S2.batchOf(batch.id));
assert('刷新后再次提交不重复建课', c4.created.length === 0 && S2.db.courses.length === count2,
  'created=' + c4.created.length + ' delta=' + (S2.db.courses.length - count2));
assert('幂等跳过带课程 ID', c4.skipped.filter(x => x.courseId).length === 2, c4.skipped);
const dup = S2.createCourse({
  studentId: 'S2026002', teacherId: 'T002', date: '2026-11-03', start: '19:00', end: '20:00',
  batchId: batch.id, batchRowKey: 'A', source: '批量'
});
assert('直接按批次行键 createCourse 也返回原课程', dup.id ===
  S2.db.courses.filter(x => x.batchId === batch.id && x.batchRowKey === 'A')[0].id, dup.id);

/* ---------- 5. 行数上限 ---------- */
const tooMany = Array.from({ length: 301 }, (_, i) => ({
  rowKey: 'X' + i, studentId: 'S2026002', teacherId: 'T002',
  date: '2026-12-01', start: '09:00', end: '10:00'
}));
assert('超过 300 行被拒绝', !!throws(() => S.createScheduleBatch({ rows: tooMany })));

/* ---------- 6. 页面静态检查 ---------- */
const html = fs.readFileSync(pageFile, 'utf8');
assert('页面三步式结构', /第 1 步/.test(html) && /第 2 步/.test(html) && /第 3 步/.test(html));
assert('第 1 步分页多选与筛选', /stuPager/.test(html) && /toggleStudent/.test(html) &&
  /q_grade/.test(html) && /q_kw/.test(html));
assert('第 2 步批量指定教师 / 时间 / 时长', /统一教师/.test(html) && /b_start/.test(html) && /b_duration/.test(html));
assert('第 2 步含推荐与理由', /teacherCandidatesFor/.test(html) && /推荐理由/.test(html));
assert('第 3 步分级冲突与计数', /待确认/.test(html) && /硬冲突/.test(html) && /commitResult/.test(html));
assert('硬冲突阻断 + 提醒确认', /我已确认提醒行/.test(html) && /硬冲突不会创建/.test(html));
assert('失败行可单独重校验 / 重试', /retryBatchRow/.test(html) && /重试失败/.test(html));
assert('历史批次可刷新后恢复', /openBatch/.test(html) && /幂等/.test(html));
assert('页面无假成功 Toast', /catch \(e\) \{ Proto\.toast\(e\.message, 'err'\)/.test(html));

console.log('\n实际执行断言 ' + (ok.length + bad.length) + ' 项');
if (bad.length) {
  console.log('\n失败：');
  bad.forEach(b => console.log('  ✗ ' + b));
  process.exit(1);
}
console.log('\n全部通过：');
ok.forEach(o => console.log('  ✓ ' + o));
console.log('\nr12-batch 通过');
