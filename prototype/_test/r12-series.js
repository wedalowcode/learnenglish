/* 第十二轮 · 阶段三验收：周期排课
   ------------------------------------------------------------
   实际执行：规则展开逐日实例、预览不落库、逐日冲突（改时间后单日恢复）、
             跳过、创建（seriesId / source / 不扣课）、单节 / 本次及后续 /
             整周期修改、取消（已完成只读保留）。
   静态检查：schedule-series.html 的规则表单、逐日表格编辑、重校验、
             修改范围与取消入口。
   运行：node prototype/_test/r12-series.js
   ============================================================ */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..', 'assets', 'js') + path.sep;
const pageFile = path.join(__dirname, '..', 'admin', 'schedule-series.html');

function boot() {
  const mem = {};
  const localStorage = {
    getItem: k => (k in mem ? mem[k] : null),
    setItem: (k, v) => { mem[k] = String(v); },
    removeItem: k => { delete mem[k]; }
  };
  const sandbox = { console, localStorage, Date, JSON, Math, Object, Array, String, Number,
    isFinite, parseInt, parseFloat, RegExp, setTimeout, clearTimeout };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(root + 'data.js', 'utf8'), sandbox, { filename: 'data.js' });
  vm.runInContext(fs.readFileSync(root + 'store.js', 'utf8'), sandbox, { filename: 'store.js' });
  return sandbox.Store;
}

const ok = [];
const bad = [];
function assert(name, cond, extra) {
  if (cond) ok.push(name);
  else bad.push(name + (extra !== undefined ? ' → ' + JSON.stringify(extra) : ''));
}
function throws(fn) { try { fn(); return null; } catch (e) { return e; } }

const S = boot();
S.setSession({ role: 'admin' });
const TODAY = S.TODAY;

/* ---------- 1. 规则展开 ---------- */
const base = {
  studentId: 'S2026002', teacherId: 'T002', type: '一对一', duration: 60,
  effectiveFrom: '2026-11-03', effectiveTo: '2026-11-24',
  weekdayPlans: [{ weekday: '周二', start: '19:00' }],
  meetingPolicy: '逐节填', note: '周期测试'
};
const before = S.db.courses.length;
const pv = S.previewScheduleSeries(base);
assert('按星期与生效区间展开实例', pv.rows.length === 4, pv.rows.map(r => r.date));
assert('实例日期正确', pv.rows.map(r => r.date).join(',') === '2026-11-03,2026-11-10,2026-11-17,2026-11-24');
assert('实例时长为 60 分钟', pv.rows.every(r => r.start === '19:00' && r.end === '20:00'));
assert('预览不写入课程', S.db.courses.length === before);
assert('预览汇总可读', pv.summary.total === 4 && pv.summary.pass + pv.summary.warn + pv.summary.conflict === 4,
  pv.summary);

/* 生效区间校验 */
assert('结束早于开始被拒绝', !!throws(() => S.previewScheduleSeries(Object.assign({}, base,
  { effectiveFrom: '2026-11-24', effectiveTo: '2026-11-03' }))));
assert('未选星期被拒绝', !!throws(() => S.previewScheduleSeries(Object.assign({}, base,
  { weekdayPlans: [] }))));

/* ---------- 2. 逐日冲突与单日修复 ---------- */
const blocker = S.createCourse({
  studentId: 'S2026004', teacherId: 'T002', date: '2026-11-10',
  start: '19:00', end: '20:00', meetingUrl: '', note: '占用同一时段'
});
const pv2 = S.previewScheduleSeries(base);
assert('单日冲突不导致整个预览失败', pv2.rows.length === 4 && pv2.summary.conflict === 1,
  pv2.summary);
assert('冲突标记到具体日期', pv2.rows.filter(r => !r.ok).map(r => r.date).join(',') === '2026-11-10');
const fixedRows = pv2.rows.map(r => r.date === '2026-11-10'
  ? Object.assign({}, r, { start: '20:00', end: '21:00' }) : r);
const pv3 = S.previewScheduleSeries(Object.assign({}, base, { rows: fixedRows }));
assert('改时间后该日恢复可提交', pv3.summary.conflict === 0 && pv3.rows.length === 4, pv3.summary);
const skipRows = pv3.rows.map(r => r.date === '2026-11-10' ? Object.assign({}, r, { skip: true }) : r);
const pv4 = S.previewScheduleSeries(Object.assign({}, base, { rows: skipRows }));
assert('跳过行保留在预览中', pv4.rows.filter(r => r.skip).length === 1);

/* ---------- 3. 创建（含跳过） ---------- */
const res = S.createScheduleSeries(Object.assign({}, base, {
  rows: skipRows, confirmedWarnings: true, reason: '测试创建周期'
}));
assert('创建周期头记录', !!S.seriesOf(res.series.id) && S.seriesOf(res.series.id).status === '已生成',
  S.seriesOf(res.series.id));
assert('跳过行不建课', res.created.length === 3 && res.skipped.length === 1,
  'created=' + res.created.length + ' skipped=' + res.skipped.length);
assert('逐日实例为独立课程', res.created.every(c => S.db.courses.some(x => x.id === c.id)));
assert('课程关联 seriesId 与来源', res.created.every(c => {
  const x = S.db.courses.filter(y => y.id === c.id)[0];
  return x.seriesId === res.series.id && x.source === '周期';
}));
assert('周期课程不扣课时', res.created.every(c => S.db.courses.filter(x => x.id === c.id)[0].deduct === '未扣课'));
assert('周期头计数与实际一致', res.series.createdCount === 3 && res.series.skippedCount === 1 &&
  res.series.conflictCount === 0, res.series);
assert('周期头记录创建人来自会话', res.series.createdBy === S.currentSession().operatorName ||
  res.series.createdBy === '');
assert('周期列表可追溯', S.scheduleSeriesList().some(x => x.id === res.series.id && x.courses === 3));

/* ---------- 4. 单节 / 本次及后续 / 整周期修改 ---------- */
const list = S.seriesCourses(res.series.id);
const first = list[0], second = list[1], last = list[list.length - 1];
const upSingle = S.updateScheduleSeries(res.series.id, 'single', {
  courseId: first.id, start: '20:00', reason: '家长临时改时间'
});
assert('单节改时间成功', upSingle.updated.length === 1 && S.course(first.id).start === '20:00',
  S.course(first.id));
const upFollowing = S.updateScheduleSeries(res.series.id, 'following', {
  fromDate: second.date, teacherId: 'T003', reason: '后半段换教师'
});
assert('本次及后续只改该日期之后', upFollowing.updated.length === 2 &&
  S.course(second.id).teacherId === 'T003' && S.course(last.id).teacherId === 'T003' &&
  S.course(first.id).teacherId === 'T002', 'updated=' + upFollowing.updated.length);
assert('单节修改不影响同周期其他节', S.course(last.id).date === last.date);

/* 已完成课程只读：将最后一节标记完成，整周期修改应被拒绝 */
const lastCourse = S.db.courses.filter(c => c.id === last.id)[0];
lastCourse.status = '已完成';
const errAll = throws(() => S.updateScheduleSeries(res.series.id, 'all', {
  start: '18:00', reason: '整周期提前'
}));
assert('整周期修改遇到已完成课程被拒绝', !!errAll && /不能整体修改/.test(errAll.message), errAll && errAll.message);
const upAllFuture = throws(() => S.updateScheduleSeries(res.series.id, 'all', {
  start: '18:00', reason: '绕过测试'
}));
assert('已完成后仍不允许整周期覆盖', !!upAllFuture);

/* ---------- 5. 取消：已完成保留 ---------- */
const cancel = S.cancelScheduleSeries(res.series.id, { text: '周期结束取消' }, 'all');
assert('取消未完成课程', cancel.cancelled.length >= 2, cancel.cancelled.length);
assert('已完成课程跳过且保留', cancel.skipped.some(x => x.courseId === last.id) &&
  S.db.courses.some(c => c.id === last.id && c.status === '已完成'),
  cancel.skipped.map(x => x.courseId));
assert('取消后课程状态为已取消', cancel.cancelled.every(id =>
  S.db.courses.filter(c => c.id === id)[0].status === '已取消'));
assert('取消不扣课时', cancel.cancelled.every(id =>
  S.db.courses.filter(c => c.id === id)[0].deduct === '未扣课'));
assert('取消不物理删除课程', cancel.cancelled.every(id => S.db.courses.some(c => c.id === id)));
assert('取消记录原因', cancel.cancelled.every(id =>
  (S.db.courses.filter(c => c.id === id)[0].cancelReason || '') === '周期结束取消'),
  S.db.courses.filter(c => c.id === cancel.cancelled[0])[0].cancelReason);
assert('周期详情仍可查', !!S.seriesOf(res.series.id) && S.seriesCourses(res.series.id).length === 3);

/* ---------- 6. 页面静态检查 ---------- */
const html = fs.readFileSync(pageFile, 'utf8');
assert('页面使用 Store 周期接口', /S\.previewScheduleSeries\(/.test(html) &&
  /S\.createScheduleSeries\(/.test(html) && /S\.updateScheduleSeries\(/.test(html) &&
  /S\.cancelScheduleSeries\(/.test(html));
assert('页面先预览后创建', /预览逐日实例/.test(html) && /创建周期课程/.test(html));
assert('逐日表格可改时间 / 换教师 / 跳过', /row-time/.test(html) && /editRow\(/.test(html) &&
  /'teacherId'/.test(html) && /'skip'/.test(html));
assert('页面提供重新校验', /重新校验/.test(html) && /recheckPreview/.test(html));
assert('页面支持单节 / 本次及后续 / 整周期', /value="single"/.test(html) && /value="following"/.test(html) &&
  /value="all"/.test(html));
assert('页面提示已完成只读不覆盖', /已完成[\s\S]{0,20}只读/.test(html) || /不覆盖历史/.test(html));
assert('页面无硬编码操作人', !/createdBy: '张敏'/.test(html) && !/operatorName:'张敏'/.test(html));

console.log('\n实际执行断言 ' + (ok.length + bad.length) + ' 项');
if (bad.length) {
  console.log('\n失败：');
  bad.forEach(b => console.log('  ✗ ' + b));
  process.exit(1);
}
console.log('\n全部通过：');
ok.forEach(o => console.log('  ✓ ' + o));
console.log('\nr12-series 通过');
