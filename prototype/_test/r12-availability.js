/* 第十二轮 · 阶段二验收：教师可用时间与学员排课偏好
   ------------------------------------------------------------
   实际执行：旧 availability 展开、精确区间保存与合并、日期例外优先、
             负荷策略默认与保存、学员偏好三档、需求期望时间一次性迁移、
             以及设置对 createCourse 的真实阻断。
   静态检查：schedule-settings.html 的周历网格点击、批量复制、例外、
             负荷策略与学员三档表单。
   运行：node prototype/_test/r12-availability.js
   ============================================================ */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..', 'assets', 'js') + path.sep;
const pageFile = path.join(__dirname, '..', 'admin', 'schedule-settings.html');

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

/* ---------- 1. 旧 availability 兜底展开 ---------- */
const t1 = S.availabilityOfTeacher('T001');
assert('旧 availability 已展开为精确区间', t1.configured && t1.ranges.length === 4, t1.ranges.length);
assert('展开区间来自 PERIOD_TIME', t1.ranges.every(r =>
  ['08:30-11:30', '13:30-17:30', '18:30-21:00'].indexOf(r.start + '-' + r.end) >= 0),
  t1.ranges.map(r => r.weekday + ' ' + r.start + '-' + r.end));
assert('展开记录标注来源', t1.ranges.every(r => r.source === '旧数据展开'));
assert('旧字段仍保留只读兼容', t1.legacy.length === 4, t1.legacy.length);
assert('可用时间文本可读', /周一 18:30—21:00/.test(S.availabilityTextOf('T001')), S.availabilityTextOf('T001'));

/* ---------- 2. 精确区间保存与重叠合并 ---------- */
S.saveTeacherAvailability('T001', [
  { weekday: '周一', start: '09:00', end: '11:00' },
  { weekday: '周一', start: '10:00', end: '12:00' },
  { weekday: '周三', start: '19:00', end: '20:30' }
], { reason: '测试保存' });
const t1b = S.availabilityOfTeacher('T001');
assert('保存为整体替换（旧展开被新表替换）', t1b.ranges.length === 2, t1b.ranges.length);
assert('同星期重叠区间自动合并', t1b.ranges.filter(r => r.weekday === '周一').length === 1 &&
  t1b.ranges.filter(r => r.weekday === '周一')[0].start === '09:00' &&
  t1b.ranges.filter(r => r.weekday === '周一')[0].end === '12:00',
  t1b.ranges.map(r => r.weekday + ' ' + r.start + '-' + r.end));
assert('非法区间被拒绝', !!throws(() => S.saveTeacherAvailability('T001',
  [{ weekday: '周一', start: '12:00', end: '11:00' }])));

/* ---------- 3. 日期例外优先 ---------- */
const exBlock = S.addAvailabilityException('T001', {
  date: '2026-11-09', type: '不可用', reason: '学校考试'
});
const chkBlock = S.checkTeacherAvailability('T001', '2026-11-09', '10:00', '11:00');
assert('例外「不可用」硬阻断该日', chkBlock.hard === true && chkBlock.ok === false, chkBlock);
assert('例外提示包含原因', /学校考试/.test(chkBlock.reason || ''), chkBlock.reason);
assert('例外优先于固定周期（同一天其他时段也阻断）',
  S.checkTeacherAvailability('T001', '2026-11-09', '19:00', '20:00').hard === true);
assert('其他日期不受该例外影响',
  S.checkTeacherAvailability('T001', '2026-11-16', '10:00', '11:00').ok === true);
S.revokeAvailabilityException(exBlock.id, '测试撤销');
assert('撤销后恢复固定周期', S.checkTeacherAvailability('T001', '2026-11-09', '10:00', '11:00').ok === true);
assert('撤销保留记录状态', S.db.teacherAvailabilityExceptions.filter(x => x.id === exBlock.id)[0].status === '已撤销');

const exLimit = S.addAvailabilityException('T001', {
  date: '2026-11-10', type: '限定时段', start: '14:00', end: '16:00', reason: '仅下午可加课'
});
assert('限定时段内放行', S.checkTeacherAvailability('T001', '2026-11-10', '14:00', '15:00').ok === true);
assert('限定时段外硬阻断', S.checkTeacherAvailability('T001', '2026-11-10', '19:00', '20:00').hard === true);
assert('限定时段类型被校验', !!throws(() => S.addAvailabilityException('T001',
  { date: '2026-11-10', type: '限定时段' })));

const exExtra = S.addAvailabilityException('T001', {
  date: '2026-11-11', type: '可加班', start: '18:00', end: '20:00', reason: '临时可加课'
});
assert('可加班例外覆盖固定周期外时段',
  S.checkTeacherAvailability('T001', '2026-11-11', '18:00', '19:00').ok === true);

/* 结构校验：星期 / 日期非法 */
assert('例外日期格式受校验', !!throws(() => S.addAvailabilityException('T001',
  { date: '2026/11/10', type: '不可用' })));

/* ---------- 4. 负荷策略 ---------- */
const p0 = S.loadPolicyOf('T002');
assert('默认负荷策略按设计建议值', p0.maxPerDay === 8 && p0.maxPerWeek === 30 &&
  p0.maxMinutesPerDay === 480 && p0.allowContinuous === true && p0.breakMinutes === 10 && p0.hard === false,
  p0);
const p1 = S.saveLoadPolicy('T002', {
  maxPerDay: 4, maxPerWeek: 12, maxMinutesPerDay: 240, breakMinutes: 15,
  allowContinuous: false, hard: true, reason: '新教师先控制负荷'
});
assert('负荷策略保存并读取一致', p1.maxPerDay === 4 && p1.maxPerWeek === 12 && p1.hard === true,
  p1);
assert('负数负荷参数被拒绝', !!throws(() => S.saveLoadPolicy('T002', { maxPerDay: -1 })));
assert('未配置教师仍回落到默认策略', S.loadPolicyOf('T004').maxPerDay === 8);

/* ---------- 5. 学员偏好三档 ---------- */
const pref1 = S.saveStudentPreference('S2026002', {
  preferredWeekdays: ['周六'], preferredPeriods: ['上午'],
  availableWeekdays: ['周六', '周日'], availablePeriods: ['上午', '下午'],
  unavailablePeriods: [{ weekday: '周日', period: '下午', reason: '家庭活动' }],
  lessonDuration: 90, weeklyLessonCount: 2,
  effectiveStartDate: '2026-11-02', effectiveEndDate: '2026-12-31',
  remark: '周末为主'
});
assert('学员偏好保存三档', pref1.preferredWeekdays.length === 1 && pref1.availableWeekdays.length === 2 &&
  pref1.unavailablePeriods.length === 1, pref1);
assert('禁止时间命中即硬阻断', S.checkStudentPreference('S2026002', '2026-11-08', '14:00', '15:00').forbidden === true,
  S.checkStudentPreference('S2026002', '2026-11-08', '14:00', '15:00'));
assert('首选时间被识别', S.checkStudentPreference('S2026002', '2026-11-07', '09:00', '10:00').preferred === true);
assert('可用范围外只提醒', S.checkStudentPreference('S2026002', '2026-11-04', '14:00', '15:00').warnings.length > 0 &&
  S.checkStudentPreference('S2026002', '2026-11-04', '14:00', '15:00').forbidden === false);
assert('生效期外按无偏好处理', (() => {
  S.saveStudentPreference('S2026002', { effectiveStartDate: '2027-01-01', unavailablePeriods: [{ weekday: '周日', period: '下午' }] });
  const r = S.checkStudentPreference('S2026002', '2026-11-08', '14:00', '15:00');
  return r.forbidden === false && /过生效期/.test(r.warnings.join(''));
})());
const prefList = S.db.studentSchedulePreferences.filter(p => p.studentId === 'S2026002');
assert('新版本保存后旧版本转历史', prefList.length === 2 &&
  prefList.filter(p => p.status === '历史').length === 1 &&
  prefList.filter(p => p.status === '有效').length === 1, prefList.map(p => p.status));

/* ---------- 6. 需求期望时间一次性迁移 ---------- */
const mig = S.studentPreferenceOf('S2026011');
assert('需求期望时间迁移为学员偏好', !!mig && mig.source === '需求迁移', mig && mig.source);
assert('迁移保留星期与时段', mig && mig.availableWeekdays.join('/') === '周三/周五' &&
  mig.availablePeriods.join('/') === '下午', mig && [mig.availableWeekdays, mig.availablePeriods]);
assert('迁移记录每周课时与生效日期', mig && mig.weeklyLessonCount === 2 && mig.effectiveStartDate === '2026-11-06');
assert('同一学员只生成一条有效迁移偏好', S.db.studentSchedulePreferences.filter(p =>
  p.studentId === 'S2026011' && p.status === '有效').length === 1);
assert('需求原始数据未被删除', S.db.studentDemands.some(d => d.id === 'D20261029003'));

/* ---------- 7. 设置真实阻断排课 ---------- */
const beforeCount = S.db.courses.length;
const remainBefore = S.student('S2026002').remain;
const ex2 = S.addAvailabilityException('T002', {
  date: '2026-11-17', type: '不可用', start: '19:00', end: '20:00', reason: '测试阻断'
});
const err = throws(() => S.createCourse({
  studentId: 'S2026002', teacherId: 'T002', date: '2026-11-17',
  start: '19:00', end: '20:00', meetingUrl: ''
}));
assert('教师例外不可用时 createCourse 被阻断', !!err && /不可用/.test(err.message), err && err.message);
assert('阻断时不写入课程', S.db.courses.length === beforeCount);
S.revokeAvailabilityException(ex2.id, '测试解除');
const c1 = S.createCourse({
  studentId: 'S2026002', teacherId: 'T002', date: '2026-11-17',
  start: '19:00', end: '20:00', meetingUrl: '', note: '阶段二验证'
});
assert('解除例外后可正常排课', !!c1 && S.db.courses.some(c => c.id === c1.id));
assert('排课不扣课时', c1.deduct === '未扣课' && S.student('S2026002').remain === remainBefore,
  remainBefore + ' → ' + S.student('S2026002').remain);

S.saveStudentPreference('S2026003', {
  unavailablePeriods: [{ weekday: '周五', period: '晚上', reason: '家长禁止周五晚上' }]
});
const err2 = throws(() => S.createCourse({
  studentId: 'S2026003', teacherId: 'T002', date: '2026-11-20',
  start: '19:00', end: '20:00'
}));
assert('学员禁止时间阻断排课', !!err2 && /禁止时间/.test(err2.message), err2 && err2.message);
assert('学员首选偏差不阻断', S.createCourse({
  studentId: 'S2026002', teacherId: 'T002', date: '2026-11-18',
  start: '19:00', end: '20:00'
}).scheduleWarnings.length >= 0);

/* ---------- 8. 页面静态检查 ---------- */
const html = fs.readFileSync(pageFile, 'utf8');
assert('页面接入可用时间 Store 接口', /S\.saveTeacherAvailability\(/.test(html) &&
  /S\.availabilityOfTeacher\(/.test(html));
assert('周历网格按 30 分钟可点击添加区间', /SLOT_MIN = 30/.test(html) && /onclick="clickSlot/.test(html));
assert('区间支持移除与批量复制到其他星期', /removeRange/.test(html) && /复制本日区间到/.test(html) &&
  /function copyRanges/.test(html));
assert('页面录入请假 / 例外并撤销', /addAvailabilityException/.test(html) && /revokeAvailabilityException/.test(html) &&
  /不可用（请假）/.test(html));
assert('页面可保存负荷策略', /saveLoadPolicy/.test(html) && /超限视为硬冲突/.test(html));
assert('学员偏好首选 / 可用 / 禁止三档齐全', /首选项/.test(html) && /可用范围/.test(html) && /禁止时间（硬阻断）/.test(html));
assert('学员偏好含生效起止 / 时长 / 周课时 / 首选教师',
  /pf_from/.test(html) && /pf_to/.test(html) && /pf_duration/.test(html) && /pf_weekly/.test(html) && /pf_teacher/.test(html));
assert('页面保存学员偏好调用真实 Store', /S\.saveStudentPreference\(/.test(html));
assert('页面区分旧字段与新表来源', /旧版「星期 \+ 时段」/.test(html) || /旧版/.test(html));
assert('页面无硬编码操作人', !/createdBy: '张敏'/.test(html) && !/operatorName:'张敏'/.test(html));

console.log('\n实际执行断言 ' + (ok.length + bad.length) + ' 项');
if (bad.length) {
  console.log('\n失败：');
  bad.forEach(b => console.log('  ✗ ' + b));
  process.exit(1);
}
console.log('\n全部通过：');
ok.forEach(o => console.log('  ✓ ' + o));
console.log('\nr12-availability 通过');
