/* 第十二轮 · 阶段六验收：批量维护与课程列表接 Store
   ------------------------------------------------------------
   实际执行：批量改派逐节校验（新教师时段冲突 / 可用时间例外 / 已完成不可改）、
             批量会议链接（设置 / 清空 / 跳过已完成）、批量取消（必填原因、不物理删除、不扣课）、
             courseQuery 扣课状态筛选、单节改派与详情字段。
   静态检查：course-list.html / course-detail.html 已从静态 DB.courses 接到 Store。
   运行：node prototype/_test/r12-bulk.js
   ============================================================ */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..', 'assets', 'js') + path.sep;
const dir = path.join(__dirname, '..', 'admin') + path.sep;

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

const S = boot();
const admin = S.users().filter(u => u.roleCode === 'admin')[0];
S.setSession({ role: 'admin', accountId: admin.id, operatorId: admin.id,
  operatorName: admin.name || admin.loginName || '管理员' });
const ok = [];
const bad = [];
function assert(name, cond, extra) {
  if (cond) ok.push(name);
  else bad.push(name + (extra !== undefined ? ' → ' + JSON.stringify(extra) : ''));
}

/* ---------- 1. 批量改派：逐节校验 ---------- */
const doneCourse = S.courses().filter(c => c.status === '已完成')[0];
const A = S.createCourse({ studentId: 'S2026001', teacherId: 'T001', date: '2026-11-09', start: '19:00', end: '20:00' });
const B = S.createCourse({ studentId: 'S2026002', teacherId: 'T001', date: '2026-11-10', start: '19:00', end: '20:00' });
const C = S.createCourse({ studentId: 'S2026004', teacherId: 'T001', date: '2026-11-11', start: '19:00', end: '20:00' });
/* 制造 T003 在 B 同时段的课程，B 改派必须失败 */
S.createCourse({ studentId: 'S2026003', teacherId: 'T003', date: '2026-11-10', start: '19:00', end: '20:00' });

const r1 = S.batchReassignCourses([A.id, B.id, C.id, doneCourse.id], 'T003', '教师调课');
assert('批量改派成功节数正确', r1.success.length === 2, r1.success.map(x => x.courseId));
assert('批量改派失败节数正确', r1.failed.length === 2, r1.failed);
assert('时段冲突的课程被单独列出原因', r1.failed.some(f => f.courseId === B.id && /冲突/.test(f.reason)), r1.failed);
assert('已完成课程不可改派', r1.failed.some(f => f.courseId === doneCourse.id && /已完成/.test(f.reason)), r1.failed);
assert('成功课程已换教师', S.course(A.id).teacherId === 'T003' && S.course(C.id).teacherId === 'T003');
assert('失败课程保留原教师', S.course(B.id).teacherId === 'T001', S.course(B.id).teacherId);
assert('改派流水保留原教师/新教师/原因/操作人/时间', (() => {
  const l = S.course(A.id).reassignLogs.slice(-1)[0];
  return !!l && l.fromTeacherId === 'T001' && l.toTeacherId === 'T003' && l.reason === '教师调课' && !!l.at;
})(), S.course(A.id).reassignLogs);

/* ---------- 2. 单节改派：可用时间例外硬阻断 ---------- */
const D = S.createCourse({ studentId: 'S2026005', teacherId: 'T001', date: '2026-11-12', start: '19:00', end: '20:00' });
S.addAvailabilityException('T003', { date: '2026-11-12', type: '不可用', reason: '当天请假' });
let blocked = '';
try { S.reassignCourse(D.id, 'T003', { reason: '测试例外' }); } catch (e) { blocked = e.message; }
assert('新教师日期例外不可用时改派被阻断', /不可用|例外/.test(blocked), blocked);
assert('被阻断的课程保留原教师', S.course(D.id).teacherId === 'T001');

/* ---------- 3. 批量会议链接 ---------- */
const flowsBefore = S.flows().length;
const m1 = S.batchSetMeetingUrl([A.id, B.id, D.id, doneCourse.id], 'https://meeting.tencent.com/dm/BULK-R12');
assert('批量设置会议链接成功节数正确', m1.success.length === 3, m1.success.map(x => x.courseId));
assert('已完成课程跳过会议链接', m1.failed.some(f => f.courseId === doneCourse.id && /已完成/.test(f.reason)), m1.failed);
assert('会议链接真实写入', [A.id, B.id, D.id].every(id => S.course(id).meetingUrl === 'https://meeting.tencent.com/dm/BULK-R12'));
const m2 = S.batchSetMeetingUrl([A.id, B.id], '');
assert('批量清空会议链接', [A.id, B.id].every(id => S.course(id).meetingUrl === '' && S.course(id).meeting === '未生成'));
let invalid = '';
try { S.batchSetMeetingUrl([A.id], 'meeting.tencent.com/x'); } catch (e) { invalid = e.message; }
assert('非法会议链接被拒绝', /http/.test(invalid), invalid);

/* ---------- 4. 批量取消：二次确认入口 / 不物理删除 / 不扣课 ---------- */
let noReason = '';
try { S.batchCancelCourses([A.id, B.id], ''); } catch (e) { noReason = e.message; }
assert('批量取消必须填写原因', /原因/.test(noReason), noReason);
const countBefore = S.courses().length;
const c1 = S.batchCancelCourses([A.id, B.id, doneCourse.id], '教务批量取消');
assert('批量取消成功节数正确', c1.success.length === 2, c1.success.map(x => x.courseId));
assert('已完成课程不参与批量取消', c1.failed.some(f => f.courseId === doneCourse.id && /已完成/.test(f.reason)), c1.failed);
assert('取消不物理删除课程', S.courses().length === countBefore, S.courses().length);
assert('取消课程状态与扣课状态正确', [A.id, B.id].every(id =>
  S.course(id).status === '已取消' && S.course(id).deductState === '未扣课'), [A.id, B.id].map(id => S.course(id).status));
assert('取消不产生扣课流水', S.flows().length === flowsBefore, S.flows().length);
assert('取消原因与操作人留痕', S.course(A.id).cancelReason === '教务批量取消' && !!S.course(A.id).cancelledAt);

/* ---------- 5. courseQuery 扣课筛选 ---------- */
const dd = S.courseQuery({ deduct: '已扣课', all: true });
assert('按扣课状态筛选返回一致条数', dd.total === S.courses().filter(c => (c.deductState || '未扣课') === '已扣课').length, dd.total);
assert('查询结果带扣课状态字段', dd.allRows.every(r => !!r.deductState));

/* ---------- 6. 页面静态检查 ---------- */
const listHtml = fs.readFileSync(dir + 'course-list.html', 'utf8');
const detailHtml = fs.readFileSync(dir + 'course-detail.html', 'utf8');
assert('课程列表使用 Store 查询', /S\.courseQuery\(/.test(listHtml));
assert('课程列表不再读取静态 DB.courses', !/DB\.courses/.test(listHtml));
assert('课程列表使用真实分页', /function renderPages|renderPages\(/.test(listHtml) && /pageSize/.test(listHtml));
assert('课程列表取消走 Store', /S\.cancelCourse\(/.test(listHtml) && !/Proto\.toast\('课程已取消'/.test(listHtml));
assert('课程列表教师下拉来自 Store', /S\.teachers\(\)/.test(listHtml));
assert('课程详情使用 Store 读取课程', /S\.course\(courseId\)/.test(detailHtml) && !/DB\.courses/.test(detailHtml));
assert('课程详情取消/调整/改派走 Store', /S\.cancelCourse\(/.test(detailHtml) &&
  /S\.updateCourse\(/.test(detailHtml) && /S\.reassignCourse\(/.test(detailHtml));
assert('课程详情不再伪造教师提交结果', !/function submitResult/.test(detailHtml) && !/actStart/.test(detailHtml));

console.log('\n实际执行断言 ' + (ok.length + bad.length) + ' 项');
if (bad.length) {
  console.log('\n失败：');
  bad.forEach(b => console.log('  ✗ ' + b));
  process.exit(1);
}
console.log('\n全部通过：');
ok.forEach(o => console.log('  ✓ ' + o));
console.log('\nr12-bulk 通过');
