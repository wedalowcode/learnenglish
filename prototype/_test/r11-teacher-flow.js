/** 第十轮验收：教师工作台 / 课程入口 / 多词库筛查 / 5-45 规则 / 越权（数据层）
 *  运行：node _test/r11-teacher-flow.js
 *  覆盖：任务书十、八个测试场景中可在数据层复现的部分。
 */
const vm = require('node:vm'), fs = require('fs');
const mem = {};
const LS = {
  getItem: k => (k in mem ? mem[k] : null),
  setItem: (k, v) => { mem[k] = String(v); },
  removeItem: k => { delete mem[k]; }
};
function makeCtx() {
  const ctx = { console, localStorage: LS, sessionStorage: LS, Date, Math, JSON, Object, Array, String, Number, setTimeout };
  ctx.globalThis = ctx; ctx.window = ctx;
  vm.createContext(ctx);
  ['assets/js/data.js', 'assets/js/store.js'].forEach(f =>
    vm.runInContext(fs.readFileSync(f, 'utf8'), ctx, { filename: f }));
  return ctx.Store;
}
let S = makeCtx();
let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS ' + name + (extra !== undefined ? '  (' + extra + ')' : '')); }
  else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? '  (' + extra + ')' : '')); }
}
function throws(name, fn, re) {
  try { fn(); ok(name, false, '未抛错'); }
  catch (e) {
    var txt = (e.message || '') + ' ' + (e.code || '');
    ok(name, !re || re.test(txt), txt);
  }
}
function admin() {
  const u = S.db.users.find(x => x.roleCode === 'admin');
  S.setSession({ role: 'admin', accountId: u ? u.id : '', operatorId: u ? u.id : 'admin', operatorName: '管理员' });
}
function asTeacher(id) {
  const t = S.teacher(id);
  S.setSession({ role: 'teacher', teacherId: id, operatorName: t ? t.name : id });
}
function openTasksOf(sid) {
  return S.db.trainTasks.filter(t => t.studentId === sid && t.status !== '已完成' && t.status !== '已取消');
}

console.log('\n== 场景一：教师今日课程（只读本人课程 / 状态 / 会议链接） ==');
asTeacher('T001');
const today = S.coursesOfTeacher('T001', '2026-11-02');
ok('只返回本人课程', today.length === 3 && today.every(c => c.teacherId === 'T001'), today.length);
ok('按开始时间升序', today.map(c => c.start).join(',').indexOf('09:00,10:15,19:00') === 0, today.map(c => c.start).join(','));
const stat = S.courseStat('T001', '2026-11-02');
ok('顶部数量：总数/待上课/已完成', stat.total === 3 && stat.pending === 2 && stat.done === 1 && stat.ongoing === 0,
  JSON.stringify(stat.by));
ok('有链接的课程带真实 meetingUrl', today.filter(c => c.id !== 'C20261102004').every(c => /^https?:\/\//.test(c.meetingUrl || '')));
const noLink = S.course('C20261102004');
ok('缺链接课程 meetingUrl 为空且不伪装「已生成」', noLink.meetingUrl === '' && noLink.meeting === '未生成',
  noLink.meeting + '|' + noLink.meetingUrl);
const doneEnter = S.openCourse('C20261102001');
ok('已完成课程只能回看，不能进入正常教学流程', doneEnter.ok === false && doneEnter.reason === '本节课已完成', doneEnter.reason);
const readOnly = S.openCourse('C20261102001', { allowDone: true });
ok('允许回看时返回课程记录（状态不变）', readOnly.ok === true && S.course('C20261102001').status === '已完成',
  S.course('C20261102001').status);
ok('今日课程均带学员年级快照', today.every(c => !!c.grade), today.map(c => c.grade).join(','));

console.log('\n== 场景二：教务排课真实落库 + 会议链接（Store 二次校验） ==');
admin();
const courseCountBefore = S.db.courses.length;
const created = S.createCourse({
  studentId: 'S2026001', teacherId: 'T001', date: '2026-11-06',
  start: '09:00', end: '10:00',
  meetingUrl: 'https://meeting.tencent.com/dm/R11Verify', note: '第十轮排课验收', type: '一对一'
});
ok('课程真实写入课程集合', S.db.courses.length === courseCountBefore + 1 && !!S.course(created.id), created.id);
ok('课程关联真实 studentId / teacherId', created.studentId === 'S2026001' && created.teacherId === 'T001',
  created.studentId + '/' + created.teacherId);
ok('保存日期、起止时间与会议链接', created.date === '2026-11-06' && created.start === '09:00' && created.end === '10:00'
  && created.meetingUrl === 'https://meeting.tencent.com/dm/R11Verify', created.meetingUrl);
ok('记录创建人与创建时间', !!created.createdBy && !!created.createdAt, created.createdBy + ' ' + created.createdAt);
ok('初始状态为待上课', created.status === '待上课', created.status);
asTeacher('T001');
ok('教师工作台可见新排课程', S.coursesOfTeacher('T001', '2026-11-06').some(c => c.id === created.id));
admin();
throws('同时段同教师再次排课被 Store 拦截', () => S.createCourse({
  studentId: 'S2026002', teacherId: 'T001', date: '2026-11-06', start: '09:00', end: '10:00',
  meetingUrl: 'https://meeting.tencent.com/dm/R11C2'
}), /冲突|COURSE_CONFLICT/);
throws('同时段同学员换教师也被拦截', () => S.createCourse({
  studentId: 'S2026001', teacherId: 'T002', date: '2026-11-06', start: '09:30', end: '10:30',
  meetingUrl: 'https://meeting.tencent.com/dm/R11C3'
}), /冲突|COURSE_CONFLICT/);
throws('开始时间晚于结束时间被拒绝', () => S.createCourse({
  studentId: 'S2026001', teacherId: 'T001', date: '2026-11-07', start: '11:00', end: '10:00'
}), /时间|TIME/);
throws('伪造会议链接被拒绝', () => S.createCourse({
  studentId: 'S2026001', teacherId: 'T001', date: '2026-11-07', start: '09:00', end: '10:00',
  meetingUrl: 'meeting-abc'
}), /链接|URL/);
throws('学员不存在被拒绝', () => S.createCourse({
  studentId: 'S9999999', teacherId: 'T001', date: '2026-11-07', start: '09:00', end: '10:00'
}), /学员/);
const noLinkCourse = S.createCourse({
  studentId: 'S2026001', teacherId: 'T001', date: '2026-11-07', start: '09:00', end: '10:00'
});
ok('会议链接留空时保存为空值并标记未生成', noLinkCourse.meetingUrl === '' && noLinkCourse.meeting === '未生成',
  noLinkCourse.meeting);
const upd = S.updateCourse(created.id, { meetingUrl: 'https://meeting.tencent.com/dm/R11Updated' });
ok('教务可维护会议链接', S.course(created.id).meetingUrl === 'https://meeting.tencent.com/dm/R11Updated', upd.meetingUrl);
throws('教务改期到冲突时段被 Store 拦截', () => S.updateCourse(created.id, {
  date: '2026-11-02', start: '10:15', end: '11:15'
}), /冲突|COURSE_CONFLICT/);
throws('改期后开始晚于结束被拒绝', () => S.updateCourse(created.id, {
  date: '2026-11-08', start: '11:00', end: '10:00'
}), /时间|TIME/);
throws('暂停合作教师不能被排课', () => S.createCourse({
  studentId: 'S2026001', teacherId: 'T005', date: '2026-11-10', start: '09:00', end: '10:00'
}), /暂停|不可排课|TEACHER_NOT_READY/);
asTeacher('T001');
throws('教师不能自行创建/修改排课', () => S.createCourse({
  studentId: 'S2026001', teacherId: 'T001', date: '2026-11-09', start: '09:00', end: '10:00'
}), /无权|FORBIDDEN/);

console.log('\n== 场景三：多选词库只创建一个任务 + 去重 + 课程关联 ==');
admin();
S.grantWordbook('S2026001', 'WB003', { reason: '第十轮多词库验收补充授权' });
asTeacher('T001');
const multi = S.createCourseTrainTask('C20261104001', ['WB001', 'WB003']);
ok('一次提交两个词库，只创建一个任务', !!multi.task && openTasksOf('S2026001').length === 1,
  openTasksOf('S2026001').length);
ok('任务关联课程 studentId / teacherId', multi.task.studentId === 'S2026001' && multi.task.teacherId === 'T001'
  && multi.task.courseId === 'C20261104001', multi.task.courseId);
ok('两个词库都写入任务来源', multi.task.wordbookIds.slice().sort().join(',') === 'WB001,WB003',
  multi.task.wordbookIds.join(','));
const uniq = new Set(multi.task.wordIds).size;
ok('候选单词按基础 Word ID 去重', uniq === multi.task.wordIds.length && multi.pool === uniq,
  multi.task.wordIds.length + ' 个 / 去重后 ' + uniq);
const rec = S.recordOfCourse('C20261104001');
ok('课程教学记录关联训练任务', !!rec && (rec.links.trainTaskIds || []).indexOf(multi.task.id) >= 0,
  rec ? (rec.links.trainTaskIds || []).join(',') : '无记录');
const taskTotalBefore = S.db.trainTasks.length;
const again = S.createCourseTrainTask('C20261104001', ['WB001']);
ok('同课程重复进入复用原任务，不重复创建', again.reused === true && S.db.trainTasks.length === taskTotalBefore
  && again.task.id === multi.task.id, again.task.id);

console.log('\n== 场景四 / 五：不足 5 动态追加；刚好 5 直接开始 ==');
admin();
S.grantWordbook('S2026008', 'WB003', { reason: '第十轮不足 5 追加验收' });
asTeacher('T001');
const small = S.createCourseTrainTask('C20261102002', ['WB001']);
const smallId = small.task.id;
const first3 = small.task.wordIds.slice(0, 3);
first3.forEach(id => S.prescreenAnswer(smallId, id, false));
let st = S.prescreenTaskStat(smallId);
ok('只筛 3 个不认识：不能开始', st.unknown === 3 && st.canStart === false && st.needMore === 2,
  JSON.stringify({ unknown: st.unknown, canStart: st.canStart, needMore: st.needMore }));
ok('固定规则常量生效（最低 5 / 上限 45）', st.minRequired === 5 && st.maxAllowed === 45 && st.remainingCapacity === 42,
  st.minRequired + '/' + st.maxAllowed + '/' + st.remainingCapacity);
const shortFin = S.finishPrescreen(smallId);
ok('不足 5 返回 MIN_WORDS_REQUIRED 且不可确认', shortFin.ok === false && shortFin.reason === 'MIN_WORDS_REQUIRED'
  && shortFin.canConfirm === false && shortFin.minRequired === 5, shortFin.reason);
ok('intercept：confirmShort 不能绕过', S.finishPrescreen(smallId, { confirmShort: true }).ok === false);
const appended = S.appendBooksToCourseTask(smallId, 'C20261102002', ['WB003']);
ok('筛查中批量追加词库成功', appended.added.length === 1 && appended.task.wordbookIds.indexOf('WB003') >= 0,
  appended.added.map(x => x.id).join(','));
ok('追加后候选池变大且任务不重建', appended.pool > small.pool && S.db.trainTasks.length === taskTotalBefore + 1
  && S.trainTask(smallId).status !== '已取消', small.pool + '→' + appended.pool);
ok('追加后已判断结果保留', first3.every(id => {
  const p = S.db.prescreens.filter(x => x.taskId === smallId && x.wordId === id)[0];
  return p && p.known === false;
}));
const more = S.trainTask(smallId).wordIds.filter(id => first3.indexOf(id) < 0).slice(0, 2);
more.forEach(id => S.prescreenAnswer(smallId, id, false));
st = S.prescreenTaskStat(smallId);
ok('继续筛到第 5 个：可以开始', st.unknown === 5 && st.canStart === true, st.unknown);
const exact = S.finishPrescreen(smallId);
ok('刚好 5 个直接入队（队列 5 个）', exact.ok === true && exact.queue.length === 5 && exact.remain.length === 0,
  exact.queue.length);
ok('5 个全部进入队列且无认识单词凑数', exact.queue.every(id => first3.indexOf(id) >= 0 || more.indexOf(id) >= 0));
ok('任务进入强化展示阶段', S.trainTask(smallId).phase === '强化展示' || S.trainTask(smallId).phase === S.PHASE.DISPLAY,
  S.trainTask(smallId).phase);

console.log('\n== 场景六：达到 45 上限，超出保留不丢 ==');
admin();
S.grantWordbook('S2026003', 'WB001', { reason: '第十轮 45 上限验收' });
S.grantWordbook('S2026003', 'WB002', { reason: '第十轮 45 上限验收' });
asTeacher('T003');
const big = S.createCourseTrainTask('C20261102003', ['WB003', 'WB001', 'WB002']);
ok('三词库去重后候选超过 45', big.task.wordIds.length >= 46, big.task.wordIds.length);
big.task.wordIds.forEach(id => S.prescreenAnswer(big.task.id, id, false));
const fortyFive = S.finishPrescreen(big.task.id);
const taskBig = S.trainTask(big.task.id);
ok('队列最多 45 个', fortyFive.ok === true && taskBig.queueWordIds.length === 45, taskBig.queueWordIds.length);
ok('超出部分进入保留集合', fortyFive.remain.length === big.task.wordIds.length - 45 && taskBig.remainWordIds.length === fortyFive.remain.length,
  fortyFive.remain.length);
ok('保留单词仍在候选中（未删除）', taskBig.remainWordIds.every(id => taskBig.wordIds.indexOf(id) >= 0));
ok('保留单词未被标为已训练', taskBig.remainWordIds.every(id => taskBig.queueWordIds.indexOf(id) < 0));
ok('45 个队列内不重复', new Set(taskBig.queueWordIds).size === 45);

console.log('\n== 场景七：越权拦截（改 URL / 他人学员 / 未授权词库 / 他人任务 / 直调 Store） ==');
asTeacher('T001');
throws('访问其他教师课程被拦截', () => S.openCourse('C20261102003'), /不是当前教师|FORBIDDEN/);
throws('用其他教师课程创建任务被拦截', () => S.createCourseTrainTask('C20261102003', ['WB003']), /不是当前教师|FORBIDDEN/);
throws('无课程直接给非本人学员建任务被拦截', () => S.createTrainTask({ studentId: 'S2026002', teacherId: 'T001' }), /无权|FORBIDDEN/);
throws('带他人课程 + 他人学员建任务被拦截', () => S.createTrainTask({
  studentId: 'S2026003', teacherId: 'T001', courseId: 'C20261102003'
}), /不是当前教师|FORBIDDEN/);
throws('操作他人训练任务被拦截', () => S.prescreenAnswer(big.task.id, big.task.wordIds[0], false), /无权|FORBIDDEN/);
throws('给他人任务追加词库被拦截', () => S.addWordbooksToTask(big.task.id, ['WB001']), /无权|FORBIDDEN/);
throws('给他人任务生成队列被拦截', () => S.finishPrescreen(big.task.id), /无权|FORBIDDEN/);
throws('跨课程错配追加被拦截', () => S.appendBooksToCourseTask(smallId, 'C20261104001', ['WB003']), /不一致|FORBIDDEN/);
const fresh = S.createCourseTrainTask('C20261102005', ['WB001']);
const unauth = S.addWordbooksToTask(fresh.task.id, ['WB004']);
ok('未授权词库不能加入（跳过而非写入）', unauth.added.length === 0 && (unauth.skipped || []).length >= 1
  && S.trainTask(fresh.task.id).wordbookIds.indexOf('WB004') < 0, JSON.stringify(unauth.skipped));
const crossBook = S.addWordbooksToTask(fresh.task.id, ['WB002']);
ok('直接传其他学员词库 ID 不能加入', crossBook.added.length === 0, JSON.stringify(crossBook.skipped));
S.setSession({ role: 'parent', parentId: 'P2026001', operatorName: '家长' });
throws('家长身份不能创建课程训练任务', () => S.createTrainTask({
  studentId: 'S2026001', teacherId: 'T001', courseId: 'C20261104001'
}), /无权|FORBIDDEN/);
S.setSession({ role: 'teacher', teacherId: 'T002', operatorName: '周雅' });
throws('其他教师不能进入非本人课程', () => S.openCourse('C20261104001'), /不是当前教师|FORBIDDEN/);
throws('其他教师不能读取非本人学员词库授权', () => S.teachingWordbooks('S2026001'), /无权|FORBIDDEN/);
admin();
S.createCourse({
  studentId: 'S2026001', teacherId: 'T002', date: '2026-11-11', start: '09:00', end: '10:00'
});
asTeacher('T002');
ok('课程绑定后可读取该课程学员词库授权', S.teachingWordbooks('S2026001').length >= 1,
  S.teachingWordbooks('S2026001').map(b => b.id).join(','));

console.log('\n== 场景八：刷新恢复（同一 localStorage 重新加载 Store） ==');
const beforeSnap = {
  tasks: S.db.trainTasks.length,
  prescreens: S.db.prescreens.filter(p => p.taskId === smallId).length,
  wordbookIds: S.trainTask(smallId).wordbookIds.slice().sort(),
  queue: S.trainTask(smallId).queueWordIds.slice(),
  remain: S.trainTask(big.task.id).remainWordIds.slice()
};
S = makeCtx();
S.setSession({ role: 'teacher', teacherId: 'T001', operatorName: '李婉' });
const restored = S.trainTask(smallId);
ok('刷新后任务仍存在', !!restored && restored.id === smallId);
ok('刷新后已判断记录不丢失', S.db.prescreens.filter(p => p.taskId === smallId).length === beforeSnap.prescreens,
  beforeSnap.prescreens);
ok('刷新后追加的词库仍在', restored.wordbookIds.slice().sort().join(',') === beforeSnap.wordbookIds.join(','),
  restored.wordbookIds.join(','));
ok('刷新后任务未重复创建', S.db.trainTasks.length === beforeSnap.tasks, S.db.trainTasks.length + '/' + beforeSnap.tasks);
ok('刷新后队列与保留集合保持', restored.queueWordIds.join(',') === beforeSnap.queue.join(',')
  && S.trainTask(big.task.id).remainWordIds.length === beforeSnap.remain.length);
const reenter = (function () {
  try { return S.createCourseTrainTask('C20261104001', ['WB001']); }
  catch (e) { return { error: e.message }; }
})();
ok('刷新后再次进入仍复用原任务', reenter && reenter.task && reenter.task.id === multi.task.id && reenter.reused === true,
  reenter && (reenter.task ? reenter.task.id : reenter.error));

console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
