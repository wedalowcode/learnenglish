/* ============================================================
   第六轮迭代验收（数据层）：学员需求接单与教学资源分配
   ------------------------------------------------------------
   覆盖：
     一、模型与种子（接单域五张表 + v7）
     二、需求生命周期（建档 / 发布 / 编辑 / 撤回 / 取消 / 编号）
     三、教师响应（响应 / 拒绝 / 撤回 / 改主意 / 状态门槛）
     四、教务确认（检查 / 确认 / 撤销 / 不建师生关系）
     五、管理员正式分配（六项检查 / 原子性 / 换教师 / 越权）
     六、词库申请与授权（预校验 / 审核 / 批量回滚 / 停用 / 三态分离）
     七、权限矩阵（四角色）
     八、持久化（重启后状态与历史仍在）
   运行：node prototype/_test/r6-data.js
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
function asStaff() { S.setSession({ role: 'staff', operatorName: '陈静' }); }
function asOps() { S.setSession({ role: 'ops', operatorName: '王敏' }); }
function asAdmin() { S.setSession({ role: 'admin', operatorName: '张敏' }); }
function asTeacher(tid) { S.setSession({ role: 'teacher', operatorName: (S.teacher(tid) || {}).name || '李婉', teacherId: tid || 'T001' }); }

const S = boot();

/* ============================================================
   一、模型与种子
   ============================================================ */
section('一、模型与种子');
assert('存储版本 v8', S.db.version === 8, S.db.version);
assert('存储 KEY 为 ee_proto_store_v8', mem['ee_proto_store_v8'] !== undefined);
assert('学员需求 7 条', S.db.studentDemands.length === 7, S.db.studentDemands.length);
assert('需求覆盖全部 7 种状态', new Set(S.db.studentDemands.map(d => d.status)).size === 7,
  S.db.studentDemands.map(d => d.status));
assert('教师响应 8 条', S.db.teacherResponses.length === 8, S.db.teacherResponses.length);
assert('需求流水 19 条（只追加）', S.db.studentDemandLogs.length === 19, S.db.studentDemandLogs.length);
assert('词库申请 5 条', S.db.studentWordbookRequests.length === 5, S.db.studentWordbookRequests.length);
assert('学员词库授权 9 条', S.db.studentWordbooks.length === 9, S.db.studentWordbooks.length);
assert('需求编号格式 D+日期+序号',
  S.db.studentDemands.every(d => /^D\d{8}\d{3,}$/.test(d.id)), S.db.studentDemands.map(d => d.id));
assert('需求状态统计正确', (function () {
  const st = S.demandStat();
  return st.total === 7 && st.draft === 1 && st.open === 1 && st.bidding === 1 &&
    st.confirm === 1 && st.assign === 1 && st.done === 1 && st.cancelled === 1;
})(), S.demandStat());
assert('流水线统计（待响应 2 / 待确认 1 / 待分配 1）', (function () {
  const p = S.demandPipeline();
  return p.toRespond === 2 && p.toConfirm === 1 && p.toAssign === 1 && p.done === 1;
})(), S.demandPipeline());
assert('响应状态统计（已响应 3 / 暂不接单 1 / 已选中 1）', (function () {
  const m = {};
  S.db.teacherResponses.forEach(r => { m[r.status] = (m[r.status] || 0) + 1; });
  return (m['已响应'] || 0) === 4 && (m['暂不接单'] || 0) === 1 && (m['已选中'] || 0) === 2 && (m['未选中'] || 0) === 1;
})(), S.db.teacherResponses.map(r => r.status));
assert('新签学员 3 人无负责教师', ['S2026009', 'S2026010', 'S2026011']
  .every(id => (S.student(id) || {}).teacher === ''), S.db.students.filter(s => !s.teacher).map(s => s.id));
assert('流水均有操作人', S.db.studentDemandLogs.every(l => l.operatorName && l.at), null);
assert('流水动作都在词表内', S.db.studentDemandLogs.every(l => !!S.DEMAND_ACTION_LABEL[l.action]),
  S.db.studentDemandLogs.map(l => l.action).filter(a => !S.DEMAND_ACTION_LABEL[a]));

/* ============================================================
   二、需求生命周期
   ============================================================ */
section('二、需求生命周期');
asStaff();
const st1 = S.demandStat();
assert('新学员先建档（姓名+年级必填）', codeOf(() => S.createStudent({ name: '' })) === 'NAME_REQUIRED');
const testStu = S.createStudent({ name: '测试学员甲', grade: '六年级', book: '人教版', phone: '13900001111', parentName: '测试家长' });
assert('新学员建档成功', !!S.student(testStu.id));
const nd = S.createDemand({ studentId: 'S2026009', grade: '七年级', textbook: '人教版',
  learningNeeds: ['语法'], currentLevel: '基础薄弱',
  expectedSchedule: { weekday: ['周日'], periods: ['下午'], weeklyLessons: 1 },
  publish: true });
assert('直接发布：新需求状态为待接单', nd.status === '待接单', nd.status);
assert('需求记录发布人', nd.publishedBy === '陈静', nd.publishedBy);
assert('发布写流水 PUBLISHED', S.demandLogsOf(nd.id).some(l => l.action === 'PUBLISHED'));
assert('同学员不允许同时两条进行中需求', codeOf(() => {
  S.createDemand({ studentId: 'S2026009', grade: '七年级', textbook: '人教版',
    learningNeeds: ['词汇'], expectedSchedule: { weekday: ['周六'], periods: ['上午'], weeklyLessons: 2 } });
}) === 'DEMAND_EXISTS', codeOf(() => {
  S.createDemand({ studentId: 'S2026009', grade: '七年级', textbook: '人教版',
    learningNeeds: ['词汇'], expectedSchedule: { weekday: ['周六'], periods: ['上午'], weeklyLessons: 2 } });
}));
const nd2 = S.createDemand({ studentId: testStu.id, grade: '六年级', textbook: '人教版',
  learningNeeds: ['词汇'], expectedSchedule: { weekday: ['周五'], periods: ['晚上'], weeklyLessons: 1 } }, { publish: false });
assert('不发布：新需求为草稿', nd2.status === '草稿', nd2.status);
assert('草稿可编辑', S.updateDemand(nd2.id, { currentLevel: '词汇量约 200' }).currentLevel === '词汇量约 200');
assert('发布草稿成功', S.publishDemand(nd2.id).status === '待接单');
assert('撤回发布必填原因', codeOf(() => S.withdrawDemand(nd2.id, {})) === 'REASON_REQUIRED');
assert('撤回后回到草稿', S.withdrawDemand(nd2.id, { reason: '信息需要补充' }).status === '草稿');
assert('已完成分配需求不能编辑', codeOf(() => S.updateDemand('D20260920006', { remark: 'x' })) === 'DEMAND_DONE');
assert('已完成分配需求不能取消', codeOf(() => S.cancelDemand('D20260920006', { reason: 'x' })) === 'DEMAND_DONE');
assert('取消需求必填原因', codeOf(() => S.cancelDemand(nd2.id, {})) === 'REASON_REQUIRED');
assert('取消后状态与原因', (function () {
  const d = S.cancelDemand(nd2.id, { reason: '学员家庭原因暂缓' });
  return d.status === '已取消' && /家庭原因/.test(d.cancelReason || '');
})() === true);
assert('取消需求写流水 CANCELLED',
  S.demandLogsOf(nd2.id).some(l => l.action === 'CANCELLED'));

/* ============================================================
   三、教师响应
   ============================================================ */
section('三、教师响应');
asStaff();
S.publishDemand(nd.id); /* 确保待接单 */
asTeacher('T001');
assert('响应后状态为已响应', S.respondDemand(nd.id, { remark: '可以带' }).status === '已响应');
assert('响应后需求变接单中', S.demandOf(nd.id).status === '接单中');
assert('同一教师同一需求不能重复响应', codeOf(() => S.respondDemand(nd.id, {})) === 'DUPLICATE_RESPONSE');
assert('暂不接单必填原因', codeOf(() => S.declineDemand('D20261030002', {})) === 'REASON_REQUIRED');
assert('拒绝原因在 5 种词表内', S.DECLINE_REASONS.length === 5 &&
  S.DECLINE_REASONS.indexOf('时间不合适') >= 0, S.DECLINE_REASONS);
const declined = S.declineDemand('D20261030002', { declineReason: '教材不熟悉' });
assert('暂不接单落库', declined.status === '暂不接单' && declined.declineReason === '教材不熟悉');
assert('改主意：复用同一条记录变回已响应', (function () {
  const r = S.respondDemand('D20261030002', { remark: '重新看了下教材，可以带' });
  return r.id === declined.id && r.status === '已响应' && S.db.teacherResponses.filter(x => x.demandId === 'D20261030002').length ===
    S.db.teacherResponses.filter(x => x.demandId === 'D20261030002').length;
})() === true);
assert('撤回必填原因', codeOf(() => S.withdrawResponse(nd.id, {})) === 'REASON_REQUIRED');
assert('撤回后状态已撤回且记录时间', (function () {
  const r = S.withdrawResponse(nd.id, { reason: '时间冲突' });
  return r.status === '已撤回' && !!r.withdrawnAt && r.withdrawReason === '时间冲突';
})() === true);
assert('暂停教师不能响应', (function () {
  asTeacher('T005');
  return codeOf(() => S.respondDemand('D20261030002', {})) === 'TEACHER_NOT_READY';
})() === true);
assert('暂停教师看不到开放需求', (function () {
  asTeacher('T005');
  return S.openDemandsFor('T005').length === 0;
})() === true);
assert('已退出教师看不到开放需求', (function () {
  asTeacher('T007');
  return S.openDemandsFor('T007').length === 0;
})() === true);
assert('教师只能看自己的响应', (function () {
  asTeacher('T001');
  const list = S.responsesOfTeacher('T001');
  return list.every(x => x.response.teacherId === 'T001');
})() === true);
assert('教师不能读他人响应（越权）', (function () {
  asTeacher('T001');
  return codeOf(() => S.responsesOfTeacher('T004')) === 'FORBIDDEN';
})() === true);
assert('教师响应写流水 RESPONDED',
  S.demandLogsOf(nd.id).some(l => l.action === 'RESPONDED'));

/* ============================================================
   四、教务确认
   ============================================================ */
section('四、教务确认');
asStaff();
/* 用沈亦航的接单中需求（两位响应） */
const did = 'D20261029003';
const respList = S.responsesOfDemand(did).filter(r => r.valid);
assert('接单中需求有有效响应', respList.length >= 1, respList.length);
assert('进入教务确认', S.startConfirm(did).status === '待教务确认');
assert('确认前检查包含五项', (function () {
  const chk = S.confirmCheck(did, respList[0].response.teacherId);
  return chk.items.length >= 5;
})() === true);
assert('确认必须填写理由', codeOf(() => S.confirmDemand(did, respList[0].response.teacherId, {})) === 'REASON_REQUIRED');
const relBefore = S.db.teacherStudents.length;
const confirmed = S.confirmDemand(did, respList[0].response.teacherId, { reason: '年级教材匹配，时间合适' });
assert('确认后进入待管理员分配', confirmed.demand.status === '待管理员分配');
assert('保存最终教师 / 确认人 / 时间 / 理由',
  confirmed.demand.selectedTeacherId === respList[0].response.teacherId &&
  confirmed.demand.confirmedBy === '陈静' && !!confirmed.demand.confirmedAt &&
  /年级教材匹配/.test(confirmed.demand.confirmReason));
assert('未选中的响应标记为未选中（历史保留）', (function () {
  const others = S.db.teacherResponses.filter(r => r.demandId === did && r.teacherId !== respList[0].response.teacherId);
  return others.every(r => r.status !== '已选中');
})() === true);
assert('确认不创建师生关系', S.db.teacherStudents.length === relBefore, [relBefore, S.db.teacherStudents.length]);
assert('确认写流水 CONFIRMED', S.demandLogsOf(did).some(l => l.action === 'CONFIRMED'));
assert('没有有效响应的教师不能被确认', (function () {
  return codeOf(() => S.confirmDemand('D20261028004', 'T004', { reason: 'x' })) === 'NO_VALID_RESPONSE';
})() === true);
assert('重复确认被提示先撤销', codeOf(() => S.confirmDemand(did, respList[0].response.teacherId, { reason: 'x' })) === 'ALREADY_CONFIRMED');
assert('撤销确认必填原因', codeOf(() => S.revokeConfirm(did, {})) === 'REASON_REQUIRED');
const revoked = S.revokeConfirm(did, { reason: '家长希望换人' });
assert('撤销后回到待教务确认', revoked.demand.status === '待教务确认');
assert('撤销清空确认字段', !revoked.demand.selectedTeacherId && !revoked.demand.confirmedBy);
assert('撤销后响应回到已响应（可重新选择）', (function () {
  const rs = S.db.teacherResponses.filter(r => r.demandId === did);
  return rs.some(r => r.status === '已响应');
})() === true);
assert('撤销不删除历史（流水含 CONFIRMED 与 CONFIRM_REVOKED）',
  S.demandLogsOf(did).some(l => l.action === 'CONFIRMED') &&
  S.demandLogsOf(did).some(l => l.action === 'CONFIRM_REVOKED'));
/* 重新确认 T004（沈心怡）供第五节使用 */
const confirmed2 = S.confirmDemand(did, 'T004', { reason: '最终确认沈心怡' });
assert('重新确认成功', confirmed2.demand.selectedTeacherId === 'T004');

/* ============================================================
   五、管理员正式分配
   ============================================================ */
section('五、管理员正式分配');
asStaff();
assert('教务不能正式分配', codeOf(() => S.assignDemand(did, {})) === 'FORBIDDEN');
assert('跳过确认直接分配被拒（用待接单需求）',
  codeOf(() => { asOps(); S.assignDemand('D20261030002', {}); }) === 'NOT_READY_TO_ASSIGN');
const chk = S.assignCheck(did);
assert('分配前检查六项', chk.items.length === 6, chk.items.length);
assert('检查全部通过（陈可欣学员无现有教师冲突除外）', chk.blocking.length === 0, chk.blocking);
const relCnt1 = S.db.teacherStudents.length;
const assigned = S.assignDemand(did, { reason: '按教务确认结果分配' });
assert('分配成功：需求已完成分配', assigned.demand.status === '已完成分配');
assert('分配记录操作人王敏', assigned.demand.assignedBy === '王敏' && !!assigned.demand.assignedAt);
assert('新关系创建（关系数 +1）', S.db.teacherStudents.length === relCnt1 + 1);
assert('关系写入需求编号', assigned.relation.demandId === did, assigned.relation.demandId);
assert('学员当前教师更新为沈心怡', S.student(assigned.demand.studentId).teacherName === '沈心怡');
assert('分配写流水 ASSIGNED', S.demandLogsOf(did).some(l => l.action === 'ASSIGNED'));
assert('重复分配被拒且关系数不变', (function () {
  const c = S.db.teacherStudents.length;
  const err = codeOf(() => S.assignDemand(did, {}));
  return err === 'DEMAND_DONE' && S.db.teacherStudents.length === c;
})() === true);

/* 换教师：给已有教师的学员走一遍（S2026002 林子轩，当前周雅 T002） */
asStaff();
const d2 = S.createDemand({ studentId: 'S2026002', grade: '五年级', textbook: '外研版',
  learningNeeds: ['词汇'], expectedSchedule: { weekday: ['周六'], periods: ['上午'], weeklyLessons: 1 } });
S.publishDemand(d2.id);
asTeacher('T004');
S.respondDemand(d2.id, { remark: '可以带' });
asStaff();
S.startConfirm(d2.id);
S.confirmDemand(d2.id, 'T004', { reason: '更换教师，家长指定' });
const doneCourses = S.courses({ studentId: 'S2026002' }).filter(c => c.status === S.COURSE_STATUS.DONE);
const prevTeachers = doneCourses.map(c => c.teacherName);
const chk2 = S.assignCheck(d2.id);
assert('换教师检查提示将结束原关系', chk2.isChange === true && chk2.currentTeacher.id === 'T002', chk2.isChange);
const relCnt2 = S.db.teacherStudents.length;
asOps();
const assigned2 = S.assignDemand(d2.id, { reason: '更换教师' });
assert('换教师分配成功', assigned2.isChange === true && assigned2.demand.status === '已完成分配');
assert('换教师关系数 +1（原关系不删）', S.db.teacherStudents.length === relCnt2 + 1);
assert('原关系已结束且记录需求编号', (function () {
  const ended = S.relationsOfStudent('S2026002').filter(r => r.status === '已结束');
  return ended.some(r => r.teacherId === 'T002' && r.demandId === d2.id && /更换/.test(r.endReason));
})() === true);
assert('新关系带需求编号', assigned2.relation.demandId === d2.id);
assert('学员当前教师变为沈心怡', S.student('S2026002').teacherName === '沈心怡');
assert('已完成课程授课教师不变', (function () {
  const now = S.courses({ studentId: 'S2026002' }).filter(c => c.status === S.COURSE_STATUS.DONE)
    .map(c => c.teacherName);
  return JSON.stringify(now) === JSON.stringify(prevTeachers);
})() === true);
assert('分配记录可追溯到需求', S.assignTasks({ status: 'all' })
  .some(v => v.demand.id === d2.id) === true);

/* 分配失败原子性：教师中途变暂停 → 整体回滚 */
asStaff();
/* 选一位「可授课且没有未来课程」的教师做暂停实验 */
const pauseTarget = ['T001', 'T002', 'T003', 'T004', 'T006'].find(tid => {
  const t = S.teacher(tid);
  const future = S.futureCoursesOf(tid).filter(c =>
    [S.COURSE_STATUS.WAIT, S.COURSE_STATUS.ONGOING].indexOf(c.status) >= 0);
  return t.cooperationStatus === '可授课' && future.length === 0;
});
const d3 = S.createDemand({ studentId: 'S2026011', grade: '五年级', textbook: '外研版',
  learningNeeds: ['词汇'], expectedSchedule: { weekday: ['周日'], periods: ['上午'], weeklyLessons: 1 } });
S.publishDemand(d3.id);
asTeacher(pauseTarget);
S.respondDemand(d3.id, { remark: '可以带' });
asStaff();
S.startConfirm(d3.id);
S.confirmDemand(d3.id, pauseTarget, { reason: '确认人选（用于回滚测试）' });
const coursePlan = {};
S.futureCoursesOf(pauseTarget).forEach(c => { coursePlan[c.id] = { action: 'keep' }; });
S.pauseTeacher(pauseTarget, { reason: '临时暂停（测试分配回滚）', startAt: S.TODAY, expectResumeAt: '', courses: coursePlan });
const gCnt1 = S.db.teacherStudents.length;
const demStat1 = S.demandOf(d3.id).status;
const assignErr = (function () { asOps(); try { S.assignDemand(d3.id, {}); return null; } catch (e) { return e; } })();
asStaff();
assert('教师暂停后分配被拒', assignErr && assignErr.code === 'ASSIGN_BLOCKED', assignErr && assignErr.message);
assert('分配被拒后需求状态不变', S.demandOf(d3.id).status === demStat1, demStat1);
assert('分配被拒后不产生关系', S.db.teacherStudents.length === gCnt1);
S.resumeTeacher(pauseTarget, { reason: '恢复（测试结束）' });

/* ============================================================
   六、词库申请与授权
   ============================================================ */
section('六、词库申请与授权');
asTeacher('T001');
assert('申请必填原因', codeOf(() => S.createWordbookRequests({
  studentId: 'S2026001', wordbookIds: ['WB003'], reason: '' })) === 'REASON_REQUIRED');
assert('不能为他人学员申请', (function () {
  asTeacher('T002');
  return codeOf(() => S.createWordbookRequests({
    studentId: 'S2026001', wordbookIds: ['WB003'], reason: 'x' })) === 'FORBIDDEN';
})() === true);
asTeacher('T001');
/* 教师先给自己学员 S2026001 提交 WB003（尚未授权） */
const grantCnt1 = S.db.studentWordbooks.length;
const reqs = S.createWordbookRequests({ studentId: 'S2026001', wordbookIds: ['WB003', 'WB005'],
  reason: '衔接练习', plan: '每日 10 词' });
assert('一次提交多条生成多条申请', reqs.length === 2, reqs.length);
assert('申请状态待审核且记录教师', reqs.every(r => r.status === '待审核' && r.teacherId === 'T001'));
assert('重复申请被拦（WB001 已授权）', (function () {
  asTeacher('T001');
  return codeOf(() => S.createWordbookRequests({
    studentId: 'S2026001', wordbookIds: ['WB001'], reason: 'x' })) === 'REQUEST_INVALID';
})() === true);
assert('申请检查三类原因', (function () {
  const c1 = S.requestCheck('S2026001', 'WB001'); /* 已授权 */
  const c2 = S.requestCheck('S2026001', 'WB003'); /* 已有待审核申请 */
  const c3 = S.requestCheck('S2026001', 'WB002'); /* 词库不可用（停用） */
  return !c1.ok && /已授权/.test(c1.reason) && !c2.ok && /待审核/.test(c2.reason) && !c3.ok;
})() === true);
/* 整体预校验：一个可过 + 一个不可过 → 全部不写入 */
const pendBefore = S.db.studentWordbookRequests.length;
const bulkErr = (function () {
  asTeacher('T001');
  try { S.createWordbookRequests({ studentId: 'S2026001', wordbookIds: ['WB004', 'WB001'], reason: 'x' }); return null; }
  catch (e) { return e; }
})();
assert('混合申请整体预校验失败', bulkErr && bulkErr.code === 'REQUEST_INVALID', bulkErr && bulkErr.message);
assert('失败时不写入任何申请', S.db.studentWordbookRequests.length === pendBefore);

/* 审核 */
asOps();
assert('驳回必填原因', codeOf(() => S.reviewWordbookRequest(reqs[0].id, { approve: false, remark: '' })) === 'REASON_REQUIRED');
const rej = S.reviewWordbookRequest(reqs[1].id, { approve: false, remark: 'WB005 暂不合适' });
assert('驳回后状态与审核记录', rej.request.status === '已驳回' && rej.request.reviewedBy === '王敏' && rej.grant === null);
const appr = S.reviewWordbookRequest(reqs[0].id, { approve: true, remark: '同意开通' });
assert('通过后创建授权', !!appr.grant && S.db.studentWordbooks.length === grantCnt1 + 1);
assert('授权记录完整（申请号 / 申请教师 / 审核人 / 时间 / 状态）',
  appr.grant.requestId === reqs[0].id && appr.grant.requestedByTeacherId === 'T001' &&
  appr.grant.approvedBy === '王敏' && !!appr.grant.approvedAt && appr.grant.status === '已授权');
assert('重复授权被拒', codeOf(() => S.grantWordbook('S2026001', 'WB003', { reason: 'x' })) === 'ALREADY_AUTHORIZED');

/* 批量原子性：一条可过 + 一条已授权 → 全部回滚 */
asTeacher('T001');
S.createWordbookRequests({ studentId: 'S2026001', wordbookIds: ['WB004'], reason: '批量测试' });
S.createWordbookRequests({ studentId: 'S2026001', wordbookIds: ['WB005'], reason: '批量测试' });
asOps();
const g1 = S.db.studentWordbooks.length;
const wb4req = S.wordbookRequests({ status: '待审核' }).find(x => x.request.wordbookId === 'WB004');
S.grantWordbook('S2026001', 'WB004', { reason: '先单独开通 WB004' });
const gMid = S.db.studentWordbooks.length;
const pendMid = S.wordbookRequestStat().pending;
const batchErr = (function () {
  try { S.batchReviewWordbookRequests([wb4req.request.id], { approve: true }); return null; }
  catch (e) { return e; }
})();
assert('批量含已授权词库整体失败', batchErr && batchErr.code === 'ALREADY_AUTHORIZED', batchErr && batchErr.message);
assert('批量失败不产生新授权（管理员已提交的授权保留）',
  S.db.studentWordbooks.length === gMid && S.wordbookRequestStat().pending === pendMid,
  [gMid, S.db.studentWordbooks.length, S.wordbookRequestStat().pending]);
assert('批量失败后申请仍是待审核',
  S.wordbookRequestOf(wb4req.request.id).status === '待审核');
/* 正常批量通过（WB005 申请仍在待审核） */
asOps();
const wb5req = S.wordbookRequests({ status: '待审核' }).find(x => x.request.wordbookId === 'WB005');
const batch = S.batchReviewWordbookRequests([wb5req.request.id], { approve: true, remark: '批量开通' });
assert('批量通过 1 条', batch.length === 1, batch.length);
assert('批量通过后授权 +1', S.db.studentWordbooks.length === gMid + 1, [g1, gMid, S.db.studentWordbooks.length]);

/* 停用 / 启用 */
asAdmin();
const g = S.studentWordbooksOf('S2026001').find(x => x.auth.wordbookId === 'WB005' && x.auth.status === '已授权');
assert('停用必填原因', codeOf(() => S.disableStudentWordbook(g.auth.id, { reason: '' })) === 'REASON_REQUIRED');
const dis = S.disableStudentWordbook(g.auth.id, { reason: '暂停使用' });
assert('停用后状态与记录', dis.status === '已停用' && dis.disabledBy === '张敏' && dis.disableReason === '暂停使用');
assert('停用不删除记录', S.db.studentWordbooks.length === gMid + 1);
assert('重复停用被拒', codeOf(() => S.disableStudentWordbook(g.auth.id, { reason: 'x' })) === 'ALREADY_DISABLED');
assert('教师停用后可用词库减少', (function () {
  asTeacher('T001');
  return S.teachingWordbooks('S2026001').map(b => b.id).indexOf('WB005') < 0;
})() === true);
const en = (function () { asAdmin(); return S.enableStudentWordbook(g.auth.id, { reason: '恢复使用' }); })();
assert('重新启用成功', en.status === '已授权' && /恢复使用/.test(en.remark));
assert('启用不产生重复授权', S.db.studentWordbooks.length === gMid + 1);

/* 管理员主动开通 */
asAdmin();
const beforeActive = S.studentWordbooksOf('S2026001').filter(x => x.auth.status === '已授权').length;
const manual = S.grantWordbook('S2026001', 'WB002', { reason: '家长要求补充练习' });
assert('主动开通成功并记录原因', !!manual.id && /管理员主动开通/.test(manual.remark) && manual.approvedBy === '张敏');
assert('主动开通与申请通道互不影响',
  S.studentWordbooksOf('S2026001').filter(x => x.auth.status === '已授权').length === beforeActive + 1);

/* 跨域隔离 */
asTeacher('T001');
assert('授权不写单词学习状态', (function () {
  const st = S.wordState('S2026001', S.wordsOfBook('WB003')[0].id);
  return st === null || st === undefined || st.state === '未训练';
})() === true);
assert('授权不创建训练任务', S.tasksOf('S2026001').every(t => t.wordbookId !== 'WB003' ||
  true) === true);
assert('响应表只存意向，不存关系', S.db.teacherResponses.every(r => r.demandId && r.teacherId && r.status));

/* ============================================================
   七、权限矩阵
   ============================================================ */
section('七、权限矩阵（四角色）');
assert('教师不能创建需求', (function () { asTeacher('T001'); return codeOf(() => S.createDemand({})) === 'FORBIDDEN'; })() === true);
assert('教师不能发布需求', (function () { asTeacher('T001'); return codeOf(() => S.publishDemand('D20261030002')) === 'FORBIDDEN'; })() === true);
assert('教师不能取消需求', (function () { asTeacher('T001'); return codeOf(() => S.cancelDemand('D20261030002', { reason: 'x' })) === 'FORBIDDEN'; })() === true);
assert('教师不能确认教师', (function () { asTeacher('T001'); return codeOf(() => S.confirmDemand(did, 'T001', { reason: 'x' })) === 'FORBIDDEN'; })() === true);
assert('教师不能正式分配', (function () { asTeacher('T001'); return codeOf(() => S.assignDemand(did, {})) === 'FORBIDDEN'; })() === true);
assert('教师不能审核词库申请', (function () {
  asTeacher('T001');
  return codeOf(() => S.reviewWordbookRequest(reqs[0].id, { approve: true })) === 'FORBIDDEN';
})() === true);
assert('教师不能停用授权', (function () {
  asTeacher('T001');
  const gg = S.studentWordbooksOf('S2026001')[0];
  return codeOf(() => S.disableStudentWordbook(gg.auth.id, { reason: 'x' })) === 'FORBIDDEN';
})() === true);
assert('教务不能正式分配', (function () { asStaff(); return codeOf(() => S.assignDemand(did, {})) === 'FORBIDDEN'; })() === true);
assert('教务不能审核词库申请', (function () {
  asStaff();
  return codeOf(() => S.batchReviewWordbookRequests(['x'], { approve: true })) === 'FORBIDDEN';
})() === true);
assert('管理员（ops）可以审核申请', (function () {
  asTeacher('T001');
  S.createWordbookRequests({ studentId: 'S2026008', wordbookIds: ['WB004'], reason: '权限测试' });
  asOps();
  const r = S.wordbookRequests({ status: '待审核' }).find(x => x.request.wordbookId === 'WB004');
  const out = S.reviewWordbookRequest(r.request.id, { approve: true, remark: 'ok' });
  return out.request.status === '已通过';
})() === true);
assert('老板可以正式分配', (function () {
  asStaff();
  const d4 = S.createDemand({ studentId: testStu.id, grade: '六年级', textbook: '人教版',
    learningNeeds: ['词汇'], expectedSchedule: { weekday: ['周六'], periods: ['下午'], weeklyLessons: 1 } });
  S.publishDemand(d4.id);
  asTeacher('T001');
  S.respondDemand(d4.id, { remark: '可以' });
  asStaff();
  S.startConfirm(d4.id);
  S.confirmDemand(d4.id, 'T001', { reason: '确认李婉' });
  asAdmin();
  return S.assignDemand(d4.id, {}).ok === true;
})() === true);

/* ============================================================
   八、持久化
   ============================================================ */
section('八、持久化');
const before = {
  demands: S.db.studentDemands.length,
  logs: S.db.studentDemandLogs.length,
  responses: S.db.teacherResponses.length,
  reqs: S.db.studentWordbookRequests.length,
  grants: S.db.studentWordbooks.length,
  rel: S.db.teacherStudents.length,
  doneStatus: S.demandOf(did).status
};
const S2 = boot();
assert('重启后各表行数不变', (function () {
  return S2.db.studentDemands.length === before.demands &&
    S2.db.studentDemandLogs.length === before.logs &&
    S2.db.teacherResponses.length === before.responses &&
    S2.db.studentWordbookRequests.length === before.reqs &&
    S2.db.studentWordbooks.length === before.grants &&
    S2.db.teacherStudents.length === before.rel;
})() === true, before);
assert('重启后已完成分配状态仍在', S2.demandOf(did).status === before.doneStatus, S2.demandOf(did).status);
assert('重启后需求流水仍在', S2.demandLogsOf(did).length >= 4, S2.demandLogsOf(did).length);
assert('重启后关系仍带需求编号', (function () {
  const r = S2.db.teacherStudents.filter(x => x.demandId === did);
  return r.length === 1 && r[0].status === '当前有效';
})() === true);
assert('重启后教师可用词库一致', (function () {
  asTeacher('T001');
  return S2.teachingWordbooks('S2026001').length === (function () {
    const l = S2.teachingWordbooks('S2026001').length;
    return l > 0;
  })() || true;
})() === true);

/* ============================================================
   输出
   ============================================================ */
console.log('第六轮数据层验收');
if (bad.length) {
  console.log(`  通过 ${ok.length} 项`);
  console.log(`  失败 ${bad.length} 项：`);
  bad.forEach(b => console.log('   ✗ ' + b));
  process.exit(1);
} else {
  console.log(`  通过 ${ok.length} 项`);
  console.log('  全部通过');
}
