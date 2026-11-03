/* ============================================================
   第五轮迭代验收（数据层）：兼职教师全生命周期
   ------------------------------------------------------------
   覆盖：
     一、模型与种子（三段式之外的教师域五张表）
     二、新增教师与手机号唯一（含已退出教师的「恢复原档案」）
     三、账号开通与启用门槛
     四、暂停合作 / 恢复合作（未来课程处理、学员关系保留）
     五、学员分配 / 更换 / 解除（同一学员只允许一条有效关系）
     六、正式退出（交接校验、事务回滚、历史课程保护、账号禁用失败）
     七、重新加入（复用原档案，不产生重复教师）
     八、权限（写操作在 Store 内部校验角色，不靠页面隐藏按钮）
     九、持久化与跨域隔离
   运行：node prototype/_test/r5-data.js
   ============================================================ */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const root = path.join(__dirname, '..', 'assets', 'js') + path.sep;
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
  if (cond) ok.push(name);
  else bad.push(name + (extra !== undefined ? ' → ' + JSON.stringify(extra) : ''));
}
function codeOf(fn) {
  try { fn(); return null; } catch (e) { return e.code || 'NO_CODE:' + e.message; }
}
function msgOf(fn) {
  try { fn(); return null; } catch (e) { return e.message; }
}
function section(t) { ok.push('§ ' + t); }

const S = boot();
const T = id => S.teacher(id);
const relsOf = sid => S.db.teacherStudents.filter(r => r.studentId === sid);
const activeOf = sid => relsOf(sid).filter(r => r.status === '当前有效');
const nameOfStudent = sid => (S.student(sid) || {}).teacherName;

/* ============================================================
   一、模型与种子
   ============================================================ */
section('一、模型与种子');
assert('教师 7 人', S.teachers().length === 7, S.teachers().length);
assert('教师编号唯一', new Set(S.teachers().map(t => t.code)).size === 7);
assert('教师手机号唯一', new Set(S.teachers().map(t => t.phone)).size === 7);
assert('教师 id 与编号一致（原型）', S.teachers().every(t => t.id === t.code));
assert('合作状态都在词表内', S.teachers().every(t => S.COOP_STATUS.indexOf(t.cooperationStatus) >= 0));
assert('四种合作状态都存在', ['待启用', '可授课', '暂停合作', '已退出']
  .every(s => S.teachers().some(t => t.cooperationStatus === s)));
assert('账号状态都在词表内', S.teachers().every(t =>
  S.ACCOUNT_STATUS.indexOf(S.accountStatusOf(t.id)) >= 0));
assert('可授课教师都有正常账号', S.teachers().filter(t => t.cooperationStatus === '可授课')
  .every(t => S.accountStatusOf(t.id) === '正常'));
assert('账号与档案双向可追溯', S.users().every(u =>
  !u.teacherId || (T(u.teacherId) && T(u.teacherId).accountId === u.id)));
assert('账号不作为教师业务主键', S.users().every(u => u.id !== u.teacherId));

assert('师生关系 11 条', S.db.teacherStudents.length === 11, S.db.teacherStudents.length);
assert('每个学员最多一条有效关系', S.students().every(s => activeOf(s.id).length <= 1));
assert('关系状态只有两种', S.db.teacherStudents.every(r => ['当前有效', '已结束'].indexOf(r.status) >= 0));
assert('关系都带开始日期与分配人', S.db.teacherStudents.every(r => r.startAt && r.createdBy));
assert('已结束关系都带结束原因', S.db.teacherStudents.filter(r => r.status === '已结束')
  .every(r => !!r.endReason));
assert('学员当前教师 = 有效关系推导', S.students().every(s => {
  const a = activeOf(s.id)[0];
  if (!a) return s.teacherName === '未分配' && s.teacher === '';
  return s.teacher === a.teacherId && s.teacherName === T(a.teacherId).name;
}));
assert('吴思远未分配（历史关系已结束）', nameOfStudent('S2026006') === '未分配');
assert('陈可欣当前教师李婉', nameOfStudent('S2026001') === '李婉');

assert('李婉当前学员 2 人', S.currentStudentsOf('T001').length === 2);
assert('李婉历史学员 3 人', S.historyStudentsOf('T001').length === 3);
assert('李婉历史学员含吴思远', S.historyStudentsOf('T001').some(x => x.student.name === '吴思远'));

assert('合作流水 15 条', S.db.teacherCooperations.length === 15, S.db.teacherCooperations.length);
assert('合作流水动作都在词表内', S.db.teacherCooperations
  .every(c => !!S.COOP_ACTION_LABEL[c.action]));
assert('每个教师都有 CREATED 记录', S.teachers().every(t =>
  S.cooperationsOf(t.id).some(c => c.action === 'CREATED')));
assert('李婉首次合作 2024-03-01', T('T001').firstCooperationAt === '2024-03-01');
assert('已退出教师有 EXITED 记录', S.cooperationsOf('T006').some(c => c.action === 'EXITED'));
assert('暂停教师有 PAUSED 记录且带原因', (() => {
  const c = S.cooperationsOf('T005').filter(x => x.action === 'PAUSED')[0];
  return c && c.reason.indexOf('备考') >= 0;
})());

assert('可授课时间都是合法星期/时段', S.teachers().every(t =>
  t.availability.every(a => S.WEEKDAYS.indexOf(a.weekday) >= 0 && S.PERIODS.indexOf(a.period) >= 0)));
assert('可授课时间文本可读', S.availabilityText('T001').indexOf('周一 晚上') >= 0);
assert('未设置可授课时间返回「未设置」', S.availabilityText('T006') === '未设置');

const ov0 = S.teacherOverview();
assert('概览：总数 7', ov0.total === 7);
assert('概览：可授课 4 / 待启用 1 / 暂停 1 / 退出 1',
  ov0.ready === 4 && ov0.pending === 1 && ov0.paused === 1 && ov0.exited === 1, ov0);
assert('概览：本月有授课记录 1 人（课程表真实推导）', ov0.teachingThisMonth === 1, ov0.teachingThisMonth);

const st1 = S.teacherStat('T001');
assert('统计：当前学员数来自关系表', st1.currentStudents === 2);
assert('统计：累计负责学员去重', st1.totalStudents === 5, st1.totalStudents);
assert('统计：本月完成课程来自课程表', st1.monthCourses === 1, st1.monthCourses);
assert('统计：最近授课日期', st1.lastCourseAt === '2026-11-02');
assert('统计：未来课程数', st1.futureCourses === 3, st1.futureCourses);
assert('统计不存静态字段（teachers 上无 monthCourses）',
  S.teachers().every(t => t.monthCourses === undefined && t.students === undefined));

/* ============================================================
   二、新增教师与手机号唯一
   ============================================================ */
section('二、新增教师与手机号唯一');
S.reset();
const zhang = S.createTeacher({
  name: '张老师', phone: '13888880001', school: '南京大学', grades: ['七年级'], textbooks: ['人教版']
}, { reason: '新教师快速录入' });
assert('新增成功生成编号 T008', zhang.code === 'T008', zhang.code);
assert('新教师初始状态待启用', zhang.cooperationStatus === '待启用');
assert('新教师没有登录账号', zhang.accountId === '' && S.accountStatusOf(zhang.id) === '未开通');
assert('新教师有创建时间与创建人', !!zhang.createdAt && zhang.createdBy === '张敏');
assert('新教师首次合作时间为空（启用时才写）', zhang.firstCooperationAt === '');
assert('新增写入 CREATED 合作流水', S.cooperationsOf(zhang.id).length === 1 &&
  S.cooperationsOf(zhang.id)[0].action === 'CREATED');
assert('待启用教师不在可授课池', !S.teacherPool().some(p => p.teacher.id === zhang.id));
assert('待启用教师不能分配学员', codeOf(() => S.assignStudent(zhang.id, 'S2026006', { reason: 'x' })) === 'TEACHER_NOT_READY');

assert('手机号格式错误被拦截', codeOf(() => S.createTeacher({ name: '李四', phone: '123' })) === 'PHONE_INVALID');
assert('姓名为空被拦截', codeOf(() => S.createTeacher({ name: '  ', phone: '13888880002' })) === 'NAME_REQUIRED');
assert('手机号重复被拦截', codeOf(() => S.createTeacher({ name: '张老师2', phone: '13888880001' })) === 'PHONE_DUPLICATE');
assert('重复手机号错误里带原教师', (() => {
  try { S.createTeacher({ name: 'x', phone: '13888880001' }); return false; }
  catch (e) { return e.data && e.data.teacher && e.data.teacher.name === '张老师'; }
})());
assert('已退出教师手机号被识别为历史教师', codeOf(() =>
  S.createTeacher({ name: '郑好2', phone: '13806234567' })) === 'PHONE_EXITED');
assert('已退出手机号不产生第二份档案', S.teachers().filter(t => t.phone === '13806234567').length === 1);

const zhang2 = S.createTeacher({ name: '张老师', phone: '13888880003' });
assert('同名不同号允许（编号递增 T009）', zhang2.code === 'T009', zhang2.code);
assert('同名教师是两份独立档案', S.teachers().filter(t => t.name === '张老师').length === 2);

const up = S.updateTeacher(zhang.id, { name: '张敏敏', school: '东南大学', grades: ['七年级', '八年级'] });
assert('编辑记录 3 项变更', up.changes === 3, up.changes);
assert('姓名修改写入变更记录', S.changeLogsOf(zhang.id).some(l =>
  l.fieldName === 'name' && l.oldValue === '张老师' && l.newValue === '张敏敏'));
assert('变更记录带操作人', S.changeLogsOf(zhang.id).every(l => l.operatorId === '张敏'));
assert('擅长年级数组写入', T(zhang.id).grades.join(',') === '七年级,八年级');
assert('修改手机号为他人号码被拦截', (() => {
  const before = T(zhang.id).phone;
  const c = codeOf(() => S.updateTeacher(zhang.id, { phone: '13888880003' }));
  return (c === 'PHONE_DUPLICATE' || c === 'PHONE_EXITED') && T(zhang.id).phone === before;
})());
assert('姓名为空被拦截', codeOf(() => S.updateTeacher(zhang.id, { name: '' })) === 'NAME_REQUIRED');

/* ============================================================
   三、账号开通与启用门槛
   ============================================================ */
section('三、账号开通与启用门槛');
S.reset();
const t7 = 'T007';
const chk0 = S.activationCheck(t7);
assert('苏念启用检查：缺账号', chk0.ready === false && chk0.accountStatus === '未开通');
assert('启用缺失项含「登录账号已开通」', chk0.missing.join('|').indexOf('登录账号已开通') >= 0);
assert('条件不满足时启用被拦截', codeOf(() => S.activateTeacher(t7)) === 'NOT_READY');
assert('错误里带回检查明细', (() => {
  try { S.activateTeacher(t7); return false; }
  catch (e) { return e.data && e.data.check && e.data.check.items.length === 6; }
})());

const u7 = S.openTeacherAccount(t7, { inviteChannel: '短信邀请' });
assert('账号开通成功且绑定教师', u7.teacherId === t7 && T(t7).accountId === u7.id);
assert('登录名使用手机号', u7.loginName === '13807234567');
assert('账号角色为教师', u7.roleId === 'teacher');
assert('原型不保存明文口令', u7.passwordHash === '' && u7.mustChangePassword === true);
assert('开通账号写合作流水', S.cooperationsOf(t7).some(c => c.action === 'ACCOUNT_OPENED'));
assert('重复开通被拦截', codeOf(() => S.openTeacherAccount(t7)) === 'ACCOUNT_EXISTS');

const chk1 = S.activationCheck(t7);
assert('开通后启用检查通过', chk1.ready === true, chk1.missing);

const act = S.activateTeacher(t7, { reason: '资料与账号就绪' });
assert('启用后状态可授课', T(t7).cooperationStatus === '可授课');
assert('启用写入首次合作时间', T(t7).firstCooperationAt === '2026-11-02');
assert('启用写入本轮合作开始时间', T(t7).lastCooperationStartAt === '2026-11-02');
assert('启用写 ACTIVATED 流水', S.cooperationsOf(t7).some(c => c.action === 'ACTIVATED'));
assert('启用后进入可授课池', S.teacherPool().some(p => p.teacher.id === t7));
assert('重复启用被拦截', codeOf(() => S.activateTeacher(t7)) === 'ALREADY_READY');
assert('暂停教师不能用启用入口', codeOf(() => S.activateTeacher('T005')) === 'IS_PAUSED');
assert('已退出教师不能用启用入口', codeOf(() => S.activateTeacher('T006')) === 'IS_EXITED');
assert('已退出教师不能开通账号', codeOf(() => S.openTeacherAccount('T006')) === 'TEACHER_EXITED');

/* ============================================================
   四、暂停合作 / 恢复合作
   ============================================================ */
section('四、暂停合作 / 恢复合作');
S.reset();
assert('暂停必须填原因', codeOf(() => S.pauseTeacher('T001', {})) === 'REASON_REQUIRED');
const future1 = S.futureCoursesOf('T001');
assert('李婉有 3 节未来有效课程', future1.length === 3, future1.length);
assert('未来课程未处理时不能暂停', codeOf(() =>
  S.pauseTeacher('T001', { reason: '备考' })) === 'COURSES_UNHANDLED');
assert('错误里带回未来课程清单', (() => {
  try { S.pauseTeacher('T001', { reason: '备考' }); return false; }
  catch (e) { return e.data.courses.length === 3; }
})());
/* 完整方案里只改一节课的处理方式，其余保持「保留」，用于校验单节错误 */
function pausePlanWith(patch) {
  const p = {};
  future1.forEach(c => { p[c.id] = { action: 'keep' }; });
  return Object.assign(p, patch);
}
assert('改派必须指定接替教师', codeOf(() => S.pauseTeacher('T001', {
  reason: '备考', courses: pausePlanWith({ [future1[0].id]: { action: 'reassign' } })
})) === 'TARGET_NOT_FOUND');
assert('改派不能指定本人', codeOf(() => S.pauseTeacher('T001', {
  reason: '备考', courses: pausePlanWith({ [future1[0].id]: { action: 'reassign', toTeacherId: 'T001' } })
})) === 'TARGET_SELF');
assert('改派不能指定暂停教师', codeOf(() => S.pauseTeacher('T001', {
  reason: '备考', courses: pausePlanWith({ [future1[0].id]: { action: 'reassign', toTeacherId: 'T005' } })
})) === 'TARGET_NOT_READY');
assert('非法处理方式被拦截', codeOf(() => S.pauseTeacher('T001', {
  reason: '备考', courses: pausePlanWith({ [future1[0].id]: { action: 'whatever' } })
})) === 'BAD_ACTION');

const pausePlan = {
  [future1[0].id]: { action: 'reassign', toTeacherId: 'T003' },
  [future1[1].id]: { action: 'reassign', toTeacherId: 'T002' },
  [future1[2].id]: { action: 'cancel' }
};
const pauseRes = S.pauseTeacher('T001', {
  reason: '备考研究生入学考试', startAt: '2026-11-02', expectResumeAt: '2026-12-20',
  remark: '预计 12 月底恢复', courses: pausePlan
});
assert('暂停成功', T('T001').cooperationStatus === '暂停合作');
assert('暂停记录原因/预计恢复', (() => {
  const p = T('T001').pauseInfo;
  return p && p.reason === '备考研究生入学考试' && p.expectResumeAt === '2026-12-20';
})());
assert('暂停写 PAUSED 流水', S.cooperationsOf('T001').some(c => c.action === 'PAUSED'));
assert('暂停按策略禁用账号', S.accountStatusOf('T001') === '已禁用');
assert('暂停后不在可授课池', !S.teacherPool().some(p => p.teacher.id === 'T001'));
assert('暂停后不能分配新学员', codeOf(() =>
  S.assignStudent('T001', 'S2026006', { reason: 'x' })) === 'TEACHER_NOT_READY');
assert('暂停保留学员关系 2 条', S.currentRelationsOf('T001').length === 2);
assert('保留的关系带关注标记', S.currentRelationsOf('T001').every(r => !!r.attention));
assert('暂停不改写学员缓存', nameOfStudent('S2026001') === '李婉');

const c1 = S.course(future1[0].id);
const c2 = S.course(future1[1].id);
const c3 = S.course(future1[2].id);
assert('课程 1 改派给何俊', c1.teacherId === 'T003' && c1.teacher === '何俊');
assert('改派写入改派记录', c1.reassignLogs.length === 1 && c1.reassignLogs[0].fromTeacherId === 'T001');
assert('课程 2 改派给周雅', c2.teacherId === 'T002');
assert('课程 3 已取消且未扣课', c3.status === '已取消' && c3.deductState === '未扣课');
assert('取消课程保留原教师', c3.teacherId === 'T001');
assert('暂停不动历史课程', S.course('C20261102001').status === '已完成' &&
  S.course('C20261102001').teacherId === 'T001');

assert('恢复前不能启用', codeOf(() => S.activateTeacher('T001')) === 'IS_PAUSED');
const relBefore = S.currentRelationsOf('T001').map(r => r.id).join(',');
S.releaseStudent('S2026008', { reason: '暂停期间由教务解除，进入待分配' });
assert('暂停期间可以解除关系', S.currentRelationsOf('T001').length === 1);
const resumeRes = S.resumeTeacher('T001', { useSameAccount: true, reason: '考试结束' });
assert('恢复后状态可授课', T('T001').cooperationStatus === '可授课');
assert('恢复后账号重新启用', S.accountStatusOf('T001') === '正常');
assert('恢复写 RESUMED 流水', S.cooperationsOf('T001').some(c => c.action === 'RESUMED'));
assert('恢复后暂停信息清空', T('T001').pauseInfo === null);
assert('恢复后回到可授课池', S.teacherPool().some(p => p.teacher.id === 'T001'));
assert('恢复不自动重建被解除的关系（付嘉禾仍待分配）', nameOfStudent('S2026008') === '未分配');
assert('恢复保留仍有效的关系', S.currentRelationsOf('T001').length === 1 &&
  S.currentRelationsOf('T001')[0].studentId === 'S2026001');
assert('恢复清掉关注标记', S.currentRelationsOf('T001').every(r => !r.attention));
assert('非暂停教师不能恢复', codeOf(() => S.resumeTeacher('T002')) === 'NOT_PAUSED');

/* ============================================================
   五、学员分配 / 更换 / 解除
   ============================================================ */
section('五、学员分配 / 更换 / 解除');
S.reset();
assert('分配必须填原因', codeOf(() => S.assignStudent('T002', 'S2026006', {})) === 'REASON_REQUIRED');
assert('分配不存在的学员被拦截', codeOf(() =>
  S.assignStudent('T002', 'S9999', { reason: 'x' })) === 'STUDENT_NOT_FOUND');
const r1 = S.assignStudent('T002', 'S2026006', { reason: '年级方向匹配', startAt: '2026-11-02' });
assert('分配创建有效关系', r1.status === '当前有效' && r1.teacherId === 'T002');
assert('分配后学员缓存更新', nameOfStudent('S2026006') === '周雅' && S.student('S2026006').teacher === 'T002');
assert('周雅当前学员 +1', S.currentStudentsOf('T002').length === 3);
assert('重复分配被拦截（防重复提交）', codeOf(() =>
  S.assignStudent('T002', 'S2026006', { reason: 'x' })) === 'DUPLICATE');
const cDup = codeOf(() => S.assignStudent('T003', 'S2026006', { reason: 'x' }));
assert('已有教师的学员不能被直接覆盖', cDup === 'STUDENT_HAS_TEACHER', cDup);
assert('覆盖错误里带当前教师', (() => {
  try { S.assignStudent('T003', 'S2026006', { reason: 'x' }); return false; }
  catch (e) { return e.data.teacher.name === '周雅'; }
})());

const tr = S.transferStudent('S2026001', 'T004', { reason: '家长指定换教师', effectiveAt: '2026-11-02' });
assert('更换教师：原关系结束', tr.from.status === '已结束' && tr.from.endAt === '2026-11-02');
assert('更换教师：原关系保留结束原因', tr.from.endReason === '家长指定换教师');
assert('更换教师：新关系有效', tr.to.status === '当前有效' && tr.to.teacherId === 'T004');
assert('更换教师：学员缓存更新', nameOfStudent('S2026001') === '沈心怡');
assert('原教师历史学员出现该学员', S.historyStudentsOf('T001').some(x => x.student.name === '陈可欣'));
assert('新教师当前学员出现该学员', S.currentStudentsOf('T004').some(x => x.student.name === '陈可欣'));
assert('历史课程授课教师不变', S.coursesOf('S2026001').filter(c => c.status === '已完成')
  .every(c => c.teacherId === 'T001'));
assert('关系历史条数增加但不删除', relsOf('S2026001').length === 2);
assert('同一学员仍只有一条有效关系', activeOf('S2026001').length === 1);
assert('更换到自己被拦截', codeOf(() =>
  S.transferStudent('S2026001', 'T004', { reason: 'x' })) === 'DUPLICATE');
assert('更换到暂停教师被拦截', codeOf(() =>
  S.transferStudent('S2026001', 'T005', { reason: 'x' })) === 'TEACHER_NOT_READY');

const relCountBefore = S.db.teacherStudents.length;
S.releaseStudent('S2026004', { reason: '家长暂停服务', effectiveAt: '2026-11-02' });
assert('解除关系后学员待分配', nameOfStudent('S2026004') === '未分配');
assert('解除关系不删除记录', S.db.teacherStudents.length === relCountBefore);
assert('解除后可重新分配', (() => {
  S.assignStudent('T002', 'S2026004', { reason: '重新分配' });
  return nameOfStudent('S2026004') === '周雅';
})());
S.releaseStudent('S2026004', { reason: '再次解除测试' });
assert('没有关系时解除被拦截', codeOf(() => S.releaseStudent('S2026004', { reason: 'x' })) === 'NO_RELATION');

/* ============================================================
   六、正式退出
   ============================================================ */
section('六、正式退出');
S.reset();
const ex0 = S.exitCheck('T002');
assert('退出前检查：2 名学员 + 2 节未来课', ex0.students.length === 2 && ex0.futureCourses.length === 2,
  { s: ex0.students.length, c: ex0.futureCourses.length });
assert('退出前检查给出阻塞项', ex0.blocks.length === 2 && ex0.ready === false);
assert('缺学员方案不能退出', codeOf(() => S.exitTeacher('T002', { courses: [] })) === 'REMAIN_STUDENTS');
assert('缺课程方案不能退出', codeOf(() => S.exitTeacher('T002', {
  students: ex0.students.map(x => ({ studentId: x.student.id, action: 'release', reason: 'x' }))
})) === 'REMAIN_COURSES');
assert('退出方案改派到暂停教师被拦截', (() => {
  const c = codeOf(() => S.exitTeacher('T002', {
    students: ex0.students.map(x => ({ studentId: x.student.id, action: 'release', reason: 'x' })),
    courses: ex0.futureCourses.map(x => ({ courseId: x.id, action: 'reassign', toTeacherId: 'T005' }))
  }));
  return c === 'TARGET_NOT_READY';
})());
assert('退出方案缺原因被拦截', codeOf(() => S.exitTeacher('T002', {
  students: [{ studentId: ex0.students[0].student.id, action: 'reassign', toTeacherId: 'T004', reason: '' },
    { studentId: ex0.students[1].student.id, action: 'release', reason: 'x' }],
  courses: ex0.futureCourses.map(x => ({ courseId: x.id, action: 'cancel' }))
})) === 'REASON_REQUIRED');

/* 历史课程快照：退出前记下每一节已完成课程的授课教师 */
const historyBefore = {};
S.courses().filter(c => c.status === '已完成').forEach(c => { historyBefore[c.id] = c.teacherId; });

const exitRes = S.exitTeacher('T002', {
  students: [
    { studentId: 'S2026002', action: 'reassign', toTeacherId: 'T004', reason: '转交给沈心怡继续带' },
    { studentId: 'S2026005', action: 'release', reason: '暂时解除，进入待分配' }
  ],
  courses: [
    { courseId: ex0.futureCourses[0].id, action: 'reassign', toTeacherId: 'T003' },
    { courseId: ex0.futureCourses[1].id, action: 'cancel' }
  ]
}, { reason: '教师毕业后离校，正式结束合作', remark: '已完成全部交接' });

assert('退出成功', exitRes.ok === true && T('T002').cooperationStatus === '已退出');
assert('退出记录结束日期', T('T002').cooperationEndAt === '2026-11-02');
assert('退出禁用账号', S.accountStatusOf('T002') === '已禁用');
assert('退出写 EXITED 流水并带统计', (() => {
  const c = S.cooperationsOf('T002').filter(x => x.action === 'EXITED')[0];
  return c && c.reason.indexOf('毕业') >= 0 && c.remark.indexOf('学员转交 1') >= 0;
})());
assert('退出统计：转交 1 / 解除 1', exitRes.stats.transferred === 1 && exitRes.stats.released === 1);
assert('退出统计：课程改派 1 / 取消 1', exitRes.stats.coursesReassigned === 1 && exitRes.stats.coursesCancelled === 1);
assert('学员已转交', nameOfStudent('S2026002') === '沈心怡');
assert('学员已解除', nameOfStudent('S2026005') === '未分配');
assert('退出后没有有效关系', S.currentRelationsOf('T002').length === 0);
assert('退出后历史课程授课教师全部不变', Object.keys(historyBefore).every(cid =>
  S.course(cid).teacherId === historyBefore[cid]));
assert('退出后不能分配学员', codeOf(() =>
  S.assignStudent('T002', 'S2026006', { reason: 'x' })) === 'TEACHER_NOT_READY');
assert('退出后不能启用', codeOf(() => S.activateTeacher('T002')) === 'IS_EXITED');
assert('重复退出被拦截', codeOf(() => S.exitTeacher('T002', {}, {})) === 'ALREADY_EXITED');
assert('退出后仍在教师列表中', !!T('T002'));
assert('退出后历史学员仍可查', S.historyStudentsOf('T002').length === 2);

/* 回滚：写入关系时抛错（模拟事务中途失败） */
section('六之二、退出事务回滚');
S.reset();
const ex0b = S.exitCheck('T002');
const relN = S.db.teacherStudents.length;
const accN = S.accountStatusOf('T002');
S.db.teacherStudents.push = function () { throw new Error('模拟写入失败'); };
const cRoll = codeOf(() => S.exitTeacher('T002', {
  students: [
    { studentId: 'S2026002', action: 'reassign', toTeacherId: 'T004', reason: '转交' },
    { studentId: 'S2026005', action: 'release', reason: '解除' }
  ],
  courses: ex0b.futureCourses.map(x => ({ courseId: x.id, action: 'cancel' }))
}, { reason: '测试回滚' }));
assert('事务失败给出 EXIT_FAILED', cRoll === 'EXIT_FAILED', cRoll);
assert('回滚后教师仍可授课', T('T002').cooperationStatus === '可授课');
assert('回滚后关系数量不变', S.db.teacherStudents.length === relN, S.db.teacherStudents.length);
assert('回滚后学员归属不变', nameOfStudent('S2026002') === '周雅');
assert('回滚后课程状态不变', S.futureCoursesOf('T002').length === 2);
assert('回滚后账号状态不变', S.accountStatusOf('T002') === accN);

/* 账号禁用失败：不允许假装退出成功 */
S.reset();
const ex0c = S.exitCheck('T002');
const userT2 = S.users().filter(u => u.teacherId === 'T002')[0];
Object.freeze(userT2);
let accErr = null;
try {
  S.exitTeacher('T002', {
    students: ex0c.students.map(x => ({ studentId: x.student.id, action: 'release', reason: '解除' })),
    courses: ex0c.futureCourses.map(x => ({ courseId: x.id, action: 'cancel' }))
  }, { reason: '账号禁用失败测试' });
} catch (e) { accErr = e; }
assert('账号禁用失败时退出失败', accErr && accErr.code === 'ACCOUNT_DISABLE_FAILED', accErr && accErr.code);
assert('错误说明里明确已中止/回滚', !!accErr && (accErr.message.indexOf('已回滚') >= 0 ||
  accErr.message.indexOf('已中止') >= 0), accErr && accErr.message);
assert('账号禁用失败后教师未退出', T('T002').cooperationStatus === '可授课');
assert('账号禁用失败后学员关系未被动过', S.currentRelationsOf('T002').length === 2);
assert('账号禁用失败后课程未被取消', S.futureCoursesOf('T002').length === 2);

/* ============================================================
   七、重新加入
   ============================================================ */
section('七、重新加入');
S.reset();
assert('非退出教师不能重新加入', codeOf(() => S.rejoinTeacher('T001')) === 'NOT_EXITED');
const rj = S.rejoinTeacher('T006', { reason: '教师返校，希望继续兼职' });
assert('重新加入后回到待启用', T('T006').cooperationStatus === '待启用');
assert('重新加入次数 +1', T('T006').rejoinCount === 1);
assert('重新加入写 REJOINED 流水', S.cooperationsOf('T006').some(c => c.action === 'REJOINED'));
assert('首次合作时间保持历史值', T('T006').firstCooperationAt === '2025-09-01');
assert('本轮合作开始时间待启用时为空', T('T006').lastCooperationStartAt === '');
assert('历史合作记录仍在', S.cooperationsOf('T006').length === 4, S.cooperationsOf('T006').length);
assert('历史学员仍在', S.historyStudentsOf('T006').length === 1);
assert('重新加入不新建档案', S.teachers().length === 7);
assert('原手机号仍被占用，不能再建档', codeOf(() =>
  S.createTeacher({ name: '郑好', phone: '13806234567' })) === 'PHONE_DUPLICATE');
assert('已有账号不能重复开通', codeOf(() => S.openTeacherAccount('T006')) === 'ACCOUNT_EXISTS');
const chk6 = S.activationCheck('T006');
assert('账号已存在即算条件就绪', chk6.ready === true, chk6.missing);
S.activateTeacher('T006', { reason: '重新合作，恢复可授课' });
assert('重新加入后可再次启用', T('T006').cooperationStatus === '可授课');
assert('启用自动恢复被禁用的账号', S.accountStatusOf('T006') === '正常');
assert('新一轮合作开始时间写入', T('T006').lastCooperationStartAt === '2026-11-02');
assert('首次合作时间仍是最初的 2025-09-01', T('T006').firstCooperationAt === '2025-09-01');
assert('合作流水累计 6 条（含账号恢复）', S.cooperationsOf('T006').length === 6, S.cooperationsOf('T006').length);
assert('恢复账号记 ACCOUNT_ENABLED 而不是重复记开户', S.cooperationsOf('T006')
  .filter(c => c.action === 'ACCOUNT_OPENED').length === 0);
assert('恢复账号写入 ACCOUNT_ENABLED 流水', S.cooperationsOf('T006')
  .some(c => c.action === 'ACCOUNT_ENABLED'));

/* ============================================================
   八、权限
   ============================================================ */
section('八、权限');
S.reset();
S.setSession({ role: 'teacher', operatorName: '李婉' });
assert('教师角色不能看教师列表', S.can('teacher.view') === false);
assert('教师角色不能新增教师', codeOf(() => S.createTeacher({ name: 'a', phone: '13899990000' })) === 'FORBIDDEN');
assert('教师角色不能暂停', codeOf(() => S.pauseTeacher('T001', { reason: 'x' })) === 'FORBIDDEN');
assert('教师角色不能退出', codeOf(() => S.exitTeacher('T001', {}, {})) === 'FORBIDDEN');
assert('教师角色不能分配学员', codeOf(() =>
  S.assignStudent('T001', 'S2026006', { reason: 'x' })) === 'FORBIDDEN');
assert('教师角色不能改派课程', codeOf(() =>
  S.reassignCourse('C20261102002', 'T002', { reason: 'x' })) === 'FORBIDDEN');
assert('教师角色不能查教师统计', S.can('teacher.stats') === false);
assert('教师角色可以看本人记录', S.can('self.records') === true);
assert('越权错误带 FORBIDDEN 码与动作', (() => {
  try { S.exitTeacher('T001', {}, {}); return false; }
  catch (e) { return e.code === 'FORBIDDEN' && e.action === 'teacher.exit'; }
})());
S.setSession({ role: 'staff', operatorName: '教务处-小陈' });
assert('教务可以新增教师', S.can('teacher.create') === true);
assert('教务不能正式分配学员（与第六轮规则一致）', S.can('teacher.assign') === false);
const staffT = S.createTeacher({ name: '教务录入', phone: '13899990001' });
assert('教务创建记录操作人', S.cooperationsOf(staffT.id)[0].operatorName === '教务处-小陈');
S.setSession({ role: 'admin', operatorName: '张敏' });
assert('老板可以退出合作', S.can('teacher.exit') === true);

/* ============================================================
   九、持久化与隔离
   ============================================================ */
section('九、持久化与跨域隔离');
S.reset();
S.createTeacher({ name: '持久化测试', phone: '13877770001' });
S.assignStudent('T002', 'S2026006', { reason: '持久化前分配' });
S.transferStudent('S2026003', 'T004', { reason: '持久化前更换' });
S.pauseTeacher('T004', {
  reason: '临时暂停', courses: Object.fromEntries(
    S.futureCoursesOf('T004').map(c => [c.id, { action: 'cancel' }]))
});
const teacherN = S.teachers().length;
const relN2 = S.db.teacherStudents.length;
const coopN = S.db.teacherCooperations.length;
const chgN = S.db.teacherChanges.length;

/* 知识隔离：学员学习状态在教师操作前后完全一致 */
const statesBefore = JSON.stringify(S.db.studentWordStates);
const leitnerBefore = JSON.stringify(S.db.leitnerStates);
assert('教师操作不改学员单词状态', JSON.stringify(S.db.studentWordStates) === statesBefore);
assert('教师操作不改莱特纳状态', JSON.stringify(S.db.leitnerStates) === leitnerBefore);

const S2 = boot();
assert('重新加载后教师数不变', S2.teachers().length === teacherN, S2.teachers().length);
assert('重新加载后关系数不变', S2.db.teacherStudents.length === relN2);
assert('重新加载后合作流水不变', S2.db.teacherCooperations.length === coopN);
assert('重新加载后变更记录不变', S2.db.teacherChanges.length === chgN);
assert('重新加载后新增教师仍在', !!S2.teachers().filter(t => t.phone === '13877770001')[0]);
assert('重新加载后学员归属一致', S2.students().every(s => {
  const a = S2.db.teacherStudents.filter(r => r.studentId === s.id && r.status === '当前有效')[0];
  return a ? s.teacher === a.teacherId : s.teacher === '';
}));
assert('重新加载后暂停状态仍在', S2.teacher('T004').cooperationStatus === '暂停合作');
assert('重新加载后账号状态一致', S2.accountStatusOf('T004') === '已禁用');
assert('重新加载后没有重复有效关系', S2.students().every(s =>
  S2.db.teacherStudents.filter(r => r.studentId === s.id && r.status === '当前有效').length <= 1));

/* 词库导入不得触碰教师域 */
const teacherSnapshot = JSON.stringify(S2.teachers());
const wbBefore = S2.wordbooks().length;
S2.commitImport({
  fileName: '教师域隔离.xlsx', sheetName: 'Sheet1', headerRow: 1, dataStartRow: 2,
  mapping: { en: 0, cn: 1 }, rows: [['英文', '中文'], ['orbit', '轨道']]
}, { name: '隔离测试词库' });
assert('导入词库成功', S2.wordbooks().length === wbBefore + 1);
assert('导入词库不改教师档案', JSON.stringify(S2.teachers()) === teacherSnapshot);

/* ============================================================
   结果
   ============================================================ */
console.log('\n第五轮数据层验收');
console.log('  通过 ' + ok.length + ' 项');
if (bad.length) {
  console.log('  失败 ' + bad.length + ' 项：');
  bad.forEach(b => console.log('    × ' + b));
  process.exit(1);
} else {
  console.log('  全部通过');
}
