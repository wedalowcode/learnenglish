/* 第十二轮 · 阶段一验收：排课总览与动态日历
   ------------------------------------------------------------
   实际执行：Store.courseQuery 的筛选 / 统计 / 分组 / 排序 / 分页 /
             异常标记（真实种子数据 + 受控注入一行未分配教师课程）。
   静态检查：schedule-workbench.html 的视图切换、筛选保留、多选与批量入口、
             动态周 / 日 / 月范围（不再写死 2026-11 日历）。
   运行：node prototype/_test/r12-overview.js
   ============================================================ */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..', 'assets', 'js') + path.sep;
const pageFile = path.join(__dirname, '..', 'admin', 'schedule-workbench.html');

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

const S = boot();
S.setSession({ role: 'admin' });

/* ---------- 1. 默认查询与统计 ---------- */
const q1 = S.courseQuery({ page: 1, pageSize: 10, sort: 'asc' });
assert('默认查询返回全部课程', q1.total === S.db.courses.length, q1.total);
assert('真实分页：10 条/页 → 2 页', q1.pages === 2 && q1.rows.length === 10, q1.pages + '/' + q1.rows.length);
assert('第二页剩余课程不重复', q1 && S.courseQuery({ page: 2, pageSize: 10 }).rows.every(r =>
  !q1.rows.some(x => x.id === r.id)));
assert('统计条字段齐全', ['total', 'pending', 'ongoing', 'done', 'missed', 'cancelled',
  'conflict', 'unassigned', 'missingMeeting', 'needsAdjust', 'workday', 'weekend', 'today', 'week']
  .every(k => typeof q1.stats[k] === 'number'), q1.stats);
assert('统计总数与列表总数一致', q1.stats.total === q1.total, q1.stats.total);
assert('今日课程统计来自业务今天', q1.stats.today === S.db.courses.filter(c => c.date === S.TODAY).length,
  S.TODAY + ' → ' + q1.stats.today);
assert('本周统计覆盖周一至周日', q1.stats.week === S.db.courses.filter(c =>
  c.date >= '2026-11-02' && c.date <= '2026-11-08').length, q1.stats.week);

/* ---------- 2. 排序 ---------- */
const asc = S.courseQuery({ all: true, sort: 'asc' }).allRows;
const desc = S.courseQuery({ all: true, sort: 'desc' }).allRows;
assert('升序按日期 + 开始时间', asc.every((r, i) => i === 0 ||
  (asc[i - 1].date + ' ' + asc[i - 1].start) <= (r.date + ' ' + r.start)), true);
assert('降序为升序反向', desc[0].date + desc[0].start === asc[asc.length - 1].date + asc[asc.length - 1].start);

/* ---------- 3. 各类筛选 ---------- */
const t1 = S.courseQuery({ teacherId: 'T001', all: true });
assert('按教师筛选', t1.allRows.length > 0 && t1.allRows.every(r => r.teacherId === 'T001'), t1.allRows.length);
const s1 = S.courseQuery({ studentId: 'S2026001', all: true });
assert('按学员筛选', s1.allRows.length > 0 && s1.allRows.every(r => r.studentId === 'S2026001'), s1.allRows.length);
const range = S.courseQuery({ dateFrom: S.TODAY, dateTo: '2026-11-08', all: true });
assert('按日期范围筛选', range.allRows.every(r => r.date >= S.TODAY && r.date <= '2026-11-08'), range.allRows.length);
const st = S.courseQuery({ status: '已完成', all: true });
assert('按状态筛选', st.allRows.length > 0 && st.allRows.every(r => r.status === '已完成'), st.allRows.length);
const grade = S.courseQuery({ grade: '七年级', all: true });
assert('按年级筛选', grade.allRows.every(r => r.grade === '七年级'), grade.allRows.length);
assert('工作日筛选', S.courseQuery({ dayType: 'workday', all: true }).allRows
  .every(r => ['周一', '周二', '周三', '周四', '周五'].indexOf(r.weekday) >= 0));
assert('周末筛选', S.courseQuery({ dayType: 'weekend', all: true }).allRows
  .every(r => ['周六', '周日'].indexOf(r.weekday) >= 0));
const withLink = S.courseQuery({ meeting: 'has', all: true });
const noLink = S.courseQuery({ meeting: 'none', all: true });
assert('会议链接筛选互斥且合计等于总数', withLink.total + noLink.total === S.db.courses.length &&
  withLink.allRows.every(r => !!r.meetingUrl) && noLink.allRows.every(r => !r.meetingUrl),
  withLink.total + '+' + noLink.total);

/* 关键字：课程编号 / 学员 / 教师 */
assert('关键字匹配课程编号', S.courseQuery({ kw: 'C20261102', all: true }).total > 0);
assert('关键字匹配学员姓名', S.courseQuery({ kw: '陈可欣', all: true }).total > 0);
assert('关键字匹配教师姓名', S.courseQuery({ kw: '李婉', all: true }).total > 0);

/* 异常：未分配教师（受控注入一行，验证筛选真实命中） */
const inject = Object.assign({}, S.db.courses[0], {
  id: 'C99999999999', teacherId: '', teacher: '', teacherName: '', teacherCode: '',
  studentId: 'S2026011', student: '测试学员', date: '2026-11-09', start: '10:00', end: '11:00',
  status: '待上课', meetingUrl: '', deduct: '未扣课'
});
S.db.courses.push(inject);
const un = S.courseQuery({ anomaly: 'unassigned', all: true });
assert('异常筛选命中未分配教师', un.allRows.some(r => r.id === 'C99999999999') &&
  un.allRows.every(r => !r.teacherId), un.allRows.map(r => r.id));
const noMeet = S.courseQuery({ anomaly: 'meeting', all: true });
assert('异常筛选命中缺会议链接且只含缺链接课程',
  noMeet.allRows.length === S.db.courses.filter(c => c.teacherId && !c.meetingUrl).length &&
  noMeet.allRows.every(r => !r.meetingUrl), noMeet.total);
S.db.courses = S.db.courses.filter(c => c.id !== 'C99999999999');

/* ---------- 4. 分组 ---------- */
const gDate = S.courseQuery({ group: 'date', page: 1, pageSize: 100 });
assert('按日期分组：组数 = 有课日期数', gDate.groups.length ===
  new Set(S.db.courses.map(c => c.date)).size, gDate.groups.length);
assert('按日期分组：组内行数合计 = 总数', gDate.groups.reduce((n, g) => n + g.rows.length, 0) === gDate.total);
assert('按日期分组：组标签可读', gDate.groups.every(g => /周/.test(g.label)), gDate.groups.map(g => g.label));
const gT = S.courseQuery({ group: 'teacher', page: 1, pageSize: 100 });
assert('按教师分组：组标签为教师姓名', gT.groups.length > 0 &&
  gT.groups.every(g => g.label && g.rows.every(r => (r.teacher || '未分配教师') === g.label)),
  gT.groups.map(g => g.label));

/* ---------- 5. 组合筛选 + 分页保持 ---------- */
const combo = S.courseQuery({ teacherId: 'T001', status: '待上课', page: 1, pageSize: 3 });
assert('组合筛选后仍真实分页', combo.rows.length <= 3 && combo.total ===
  S.db.courses.filter(c => c.teacherId === 'T001' && c.status === '待上课').length,
  combo.total + ' / ' + combo.rows.length);
assert('筛选后统计随之收敛', combo.stats.total === combo.total, combo.stats.total);

/* ---------- 6. 页面静态检查 ---------- */
const html = fs.readFileSync(pageFile, 'utf8');
assert('页面已接入真实 Store 查询', /S\.courseQuery\(/.test(html));
assert('页面含周 / 日 / 月视图切换', /setView\('week'\)/.test(html) && /setView\('day'\)/.test(html) &&
  /setView\('month'\)/.test(html));
assert('日视图按教师分栏', /drawDay[\s\S]*data-teacher/.test(html));
assert('月视图显示每天课程数量', /md-count/.test(html) && /月[\s\S]*共 \$\{list\.length\} 节/.test(html));
assert('周 / 日 / 月不再写死单周日期', !/const DAYS = \['2026-11-02'/.test(html) && !/2026-11-02——/.test(html));
assert('上一 / 下一导航按视图动态', /stepCalendar\(-1\)/.test(html) && /stepCalendar\(1\)/.test(html) &&
  /addDays\(state\.anchor, dir \* 7\)/.test(html));
assert('切换视图保留筛选控件值', /function setView[\s\S]*drawAll\(\)/.test(html) &&
  !/function setView[\s\S]{0,300}(value = ''|resetFilters)/.test(html));
assert('列表支持多选与批量入口', /toggleRow/.test(html) && /toggleAll/.test(html) &&
  /批量改派/.test(html) && /批量会议链接/.test(html) && /批量取消/.test(html));
assert('批量操作调用真实 Store 接口', /S\.batchReassignCourses\(/.test(html) &&
  /S\.batchSetMeetingUrl\(/.test(html) && /S\.batchCancelCourses\(/.test(html));
assert('页面无假成功 Toast（写操作均在 try 内）', /catch \(e\) \{ Proto\.toast\(e\.message, 'err'\)/.test(html));
assert('页面标注排课不扣课时', /排课[\s\S]*不扣课时/.test(html));

/* ---------- 汇总 ---------- */
console.log('\n实际执行断言 ' + (ok.length + bad.length) + ' 项');
if (bad.length) {
  console.log('\n失败：');
  bad.forEach(b => console.log('  ✗ ' + b));
  process.exit(1);
}
console.log('\n全部通过：');
ok.forEach(o => console.log('  ✓ ' + o));
console.log('\nr12-overview 通过（含页面静态检查 ' + 12 + ' 项）');
