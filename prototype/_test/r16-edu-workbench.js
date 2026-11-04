/** 第十三轮 · 教务端优化 数据层验收
 *  覆盖：教务待办统计口径、待补会议批量补充、订单快捷统计与收款入账一致性、
 *        低课时/无上课筛选、异常课程列表、教务备注、未回复咨询/超时报告、权限拦截
 *  运行：node _test/r16-edu-workbench.js
 */
const vm = require('node:vm'), fs = require('fs');
const DATA = fs.readFileSync('assets/js/data.js', 'utf8');
const STORE = fs.readFileSync('assets/js/store.js', 'utf8');

let pass = 0, fail = 0;
function ok(n, c, x) { if (c) { pass++; console.log('  PASS ' + n + (x !== undefined ? '  (' + x + ')' : '')); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? '  (' + x + ')' : '')); } }
function throws(n, fn, sub) { try { fn(); fail++; console.log('  FAIL ' + n + '  — 未抛错'); } catch (e) { const m = String((e && e.message) || e); if (!sub || m.indexOf(sub) >= 0) { pass++; console.log('  PASS ' + n + '  (' + m + ')'); } else { fail++; console.log('  FAIL ' + n + '  — 错误不符:' + m); } } }

function fresh() {
  const mem = {};
  const LS = { getItem: k => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); }, removeItem: k => { delete mem[k]; } };
  const ctx = { console, localStorage: LS, sessionStorage: LS, Date, Math, JSON, Object, Array, String, Number, setTimeout };
  ctx.globalThis = ctx; ctx.window = ctx; vm.createContext(ctx);
  vm.runInContext(DATA, ctx, { filename: 'data.js' });
  vm.runInContext(STORE, ctx, { filename: 'store.js' });
  const S = ctx.Store;
  const au = (S.db.users || []).find(x => x.roleCode === 'admin');
  S.setSession({ role: 'admin', accountId: au ? au.id : '', operatorId: au ? au.id : 'admin', operatorName: '管理员' });
  return S;
}
function dminus(S, n) {
  const d = new Date(S.TODAY + 'T00:00:00'); d.setDate(d.getDate() - n);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

console.log('\n== 教务端优化 · 数据层验收 ==');
const S = fresh();
const stu = S.db.students[0];
const tReady = (S.db.teachers || []).filter(t => t.cooperationStatus === '可授课')[0];

/* ---- 1. 教务待办统计口径一致 ---- */
const wb = S.eduWorkbench();
ok('待补会议计数=列表长度', wb.counts.missingMeeting === S.coursesMissingMeeting().length, wb.counts.missingMeeting);
ok('待审核/待收款=订单快捷统计', wb.counts.pendingOrders === S.orderQuickStat().pending && wb.counts.pendingPayment === S.orderQuickStat().reviewed);
ok('异常课程计数=列表长度', wb.counts.abnormalCourses === S.abnormalCourses().length, wb.counts.abnormalCourses);
ok('未回复咨询计数=列表长度', wb.counts.unrepliedInquiries === S.unrepliedInquiries().length, wb.counts.unrepliedInquiries);
ok('超时报告计数=列表长度', wb.counts.overdueReports === S.overdueReports(2).length, wb.counts.overdueReports);
ok('下钻列表为数组', ['missingMeeting', 'pendingOrders', 'abnormalCourses', 'unrepliedInquiries', 'overdueReports'].every(k => Array.isArray(wb.lists[k])));

/* ---- 2. 待补会议批量补充 ---- */
const c1 = S.createCourse({ studentId: stu.id, teacherId: tReady.id, date: '2027-03-01', start: '06:00', end: '07:00', courseType: '正式课', lessonMode: '一对一' });
ok('新课程缺会议链接进入待补', S.coursesMissingMeeting().some(x => x.id === c1.id));
const bm = S.batchFillMeeting({ courseIds: [c1.id], meetingUrl: 'https://meeting.tencent.com/dm/edu-test' });
ok('批量补充成功', bm.done.length === 1 && S.course(c1.id).meetingUrl === 'https://meeting.tencent.com/dm/edu-test');
ok('补充后移出待补列表', !S.coursesMissingMeeting().some(x => x.id === c1.id));
throws('非法会议链接被拒', () => S.batchFillMeeting({ courseIds: [c1.id], meetingUrl: 'ftp://x' }), '腾讯会议链接需以');

/* ---- 3. 订单快捷统计与收款入账一致性 ---- */
const rev = S.db.orders.filter(o => o.status === S.ORDER.REVIEWED)[0];
const qs0 = S.orderQuickStat();
if (rev) {
  const before = S.accounts().filter(a => a.studentId === rev.studentId).reduce((n, a) => n + Number(a.remain || 0), 0);
  const ov = S.confirmOrderPayment(rev.id, { method: '银行转账', amount: rev.amount, note: '验收确认收款' });
  const after = S.accounts().filter(a => a.studentId === rev.studentId).reduce((n, a) => n + Number(a.remain || 0), 0);
  ok('确认收款后订单入账', S.order(rev.id).status === S.ORDER.CREDITED, S.order(rev.id).status);
  ok('学员课时按订单入账增加', after === before + Number(rev.totalHours), before + '→' + after);
  ok('快捷统计已入账+1/待收款-1', S.orderQuickStat().credited === qs0.credited + 1 && S.orderQuickStat().reviewed === qs0.reviewed - 1);
} else {
  console.log('  (种子无待收款订单，跳过收款入账一致性)');
}

/* ---- 4. 异常课程列表 + 教务备注 ---- */
const c2 = S.createCourse({ studentId: stu.id, teacherId: tReady.id, date: '2027-03-02', start: '06:00', end: '07:00', courseType: '正式课' });
S.cancelCourse(c2.id, '家长临时取消');
ok('取消课程进入异常列表', S.abnormalCourses().some(x => x.id === c2.id));
S.courseWorkNote(c2.id, '已电话沟通，家长理解');
ok('异常课程备注保存', S.abnormalCourses().find(x => x.id === c2.id).workNote === '已电话沟通，家长理解');

/* ---- 5. 低课时/无上课筛选数据 ---- */
ok('未完成训练任务学员为数组', Array.isArray(S.studentsWithOpenTrainTask()));
ok('近7天无上课学员为数组', Array.isArray(S.inactiveStudents(7)));
const oldC = dminus(S, 5);
S.db.courses.push({
  id: 'C-EDU-OLD', date: oldC, start: '09:00', end: '10:00', studentId: stu.id, student: stu.name, grade: stu.grade || '',
  teacherId: tReady.id, teacher: tReady.name, teacherName: tReady.name, teacherCode: tReady.code || '', type: '一对一',
  courseType: '正式课', lessonMode: '一对一', status: '已完成', deductState: '已扣课', deduct: '已扣课',
  meetingUrl: 'https://x', meeting: '已生成', teacherFeeState: '未计费', createdAt: S.TODAY + ' 09:00', createdBy: '验收'
});
/* 仅按“最近完成课程”判断：该学员有近期完成课程则不应在无上课列表 */
const recentC = dminus(S, 1);
S.db.courses.push({
  id: 'C-EDU-RECENT', date: recentC, start: '11:00', end: '12:00', studentId: stu.id, student: stu.name, grade: stu.grade || '',
  teacherId: tReady.id, teacher: tReady.name, teacherName: tReady.name, teacherCode: tReady.code || '', type: '一对一',
  courseType: '正式课', lessonMode: '一对一', status: '已完成', deductState: '已扣课', deduct: '已扣课',
  meetingUrl: 'https://x', meeting: '已生成', teacherFeeState: '未计费', createdAt: S.TODAY + ' 09:00', createdBy: '验收'
});
ok('有近期完成课程的学员不在“近7天无上课”', S.inactiveStudents(7).indexOf(stu.id) < 0);

/* ---- 6. 超时未发布报告 ---- */
S.db.reports.push({
  id: 'RP-EDU-OLD', courseId: 'C-EDU-OLD', recordId: '', studentId: stu.id, teacherId: tReady.id,
  courseDate: oldC, title: '验收报告', status: '编辑中', content: { performance: '', weak: '', next: '' },
  createdAt: S.TODAY + ' 10:00', submittedAt: null, publishedAt: null
});
ok('超时未发布报告可识别', S.overdueReports(2).some(x => x.courseId === 'C-EDU-OLD'));

/* ---- 7. 未回复家长咨询 ---- */
const p0 = (S.db.parents || [])[0];
S.setSession({ role: 'parent', parentId: p0.id, operatorId: p0.id, operatorName: '家长' });
const iq = S.createParentInquiry({ type: '课时问题', content: '验收咨询：课时是否到账' });
const au = (S.db.users || []).find(x => x.roleCode === 'admin');
S.setSession({ role: 'admin', accountId: au ? au.id : '', operatorId: au ? au.id : 'admin', operatorName: '管理员' });
ok('未回复咨询进入待办', S.unrepliedInquiries().some(x => x.id === iq.id));
ok('工作台未回复咨询计数与列表一致', S.eduWorkbench().counts.unrepliedInquiries === S.unrepliedInquiries().length);

/* ---- 8. 学员教务备注 ---- */
S.setStudentEduNote(stu.id, '家长要求周三/周日晚上课，注意接送');
ok('学员教务备注保存', S.student(stu.id).eduNote === '家长要求周三/周日晚上课，注意接送');

/* ---- 9. 权限拦截 ---- */
S.setSession({ role: 'teacher', teacherId: tReady.id, operatorId: tReady.id, operatorName: '教师' });
throws('教师不能访问教务工作台聚合', () => S.eduWorkbench(), '无权执行教务操作');
throws('教师不能批量补会议', () => S.batchFillMeeting({ courseIds: [c1.id], meetingUrl: 'https://x' }), '无权执行教务操作');
throws('教师不能写教务备注', () => S.setStudentEduNote(stu.id, 'x'), '无权执行教务操作');
S.setSession({ role: 'agent', agentId: (S.db.agents || [])[0] ? S.db.agents[0].id : 'A001', operatorId: 'A', operatorName: '代理' });
throws('代理不能访问教务工作台聚合', () => S.eduWorkbench(), '无权执行教务操作');

console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败');
process.exit(fail ? 1 : 0);