/**
 * 第七轮验收脚本：新学员由教师 T004 接单并开始教学（真实调用 Store 逻辑）
 * 运行：node prototype/_test/round7-e2e.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const DATA_SRC = fs.readFileSync(path.join(ROOT, 'assets/js/data.js'), 'utf8');
const STORE_SRC = fs.readFileSync(path.join(ROOT, 'assets/js/store.js'), 'utf8');

function makeStorage() {
  const mem = {};
  return {
    _mem: mem,
    getItem: k => (Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null),
    setItem: (k, v) => { mem[k] = String(v); },
    removeItem: k => { delete mem[k]; },
    clear: () => { Object.keys(mem).forEach(k => delete mem[k]); }
  };
}

/** 独立上下文加载一份 Store（同一进程内多次 boot 互不干扰） */
function boot(storage) {
  const sandbox = { console, setTimeout, clearTimeout };
  const ctx = vm.createContext(sandbox);
  const g = vm.runInContext('this', ctx);
  g.window = g;
  g.localStorage = storage || makeStorage();
  vm.runInContext(DATA_SRC, ctx, { filename: 'data.js' });
  vm.runInContext(STORE_SRC, ctx, { filename: 'store.js' });
  return g.Store;
}

const results = [];
function check(name, fn) {
  try {
    const got = fn();
    results.push({ name, ok: got && got.ok !== false, detail: got && got.detail });
  } catch (e) {
    results.push({ name, ok: false, detail: '异常：' + e.message });
  }
}
function must(name, cond, detail) {
  results.push({ name, ok: !!cond, detail });
}

/* ============================================================
   场景 A：v6 → v7 迁移（历史演示数据保留）
   ============================================================ */
(function migrationTest() {
  const st = makeStorage();
  const legacy = {
    version: 6, savedAt: '2026-10-30 10:00',
    students: [{ id: 'S1', name: '历史学员', grade: '四年级', book: '人教版', remain: 0, teacher: 'T001', teacherName: '李婉' }],
    teachers: [{ id: 'T001', name: '李婉', cooperationStatus: '可授课' }],
    wordbooks: [{ id: 'B1', name: '历史词库', status: '启用' }],
    words: [{ id: 'W1', en: 'apple', cn: '苹果' }]
  };
  st.setItem('ee_proto_store_v6', JSON.stringify(legacy));
  const S = boot(st);
  const students = S.students();
  must('迁移：历史学员保留', students.some(s => s.id === 'S1'),
    'students=' + students.map(s => s.id).join(','));
  must('迁移：历史词库保留', S.wordbooks().some(b => b.id === 'B1'),
    'wordbooks=' + S.wordbooks().map(b => b.id).join(','));
  must('迁移：v6 原始 key 保留为备份', !!st.getItem('ee_proto_store_v6'), 'ee_proto_store_v6 未删除');
  must('迁移：新版本落盘为 v9', JSON.parse(st.getItem('ee_proto_store_v9')).version === 9, 'version=9');
  const meta = JSON.parse(st.getItem('ee_proto_store_v9')).meta || {};
  must('迁移：记录迁移结果', !!(meta.migration && meta.migration.from === 'v6'),
    JSON.stringify(meta.migration && { carried: meta.migration.carried.length, seeded: meta.migration.seeded.length }));
})();

/* ============================================================
   场景 B：T004 接单 → 分配 → 授权 → 开始教学
   ============================================================ */
const S = boot();
const student = '唐语彤';
const GRADE = '五年级';
const BOOK = '人教版';

/* 1. 教务创建需求：新建学员（课时 0）、年级教材、期望时间、发布 */
S.setSession({ role: 'staff', operatorName: '陈静' });
let created;
check('1 建档+发布需求', () => {
  created = S.createStudentWithDemand({
    student: { name: student, grade: GRADE, phone: '13800001234', book: BOOK },
    demand: {
      grade: GRADE, textbook: BOOK, learningNeeds: ['同步提分'],
      currentLevel: '词汇量约 600',
      expectedSchedule: { weekday: ['周一'], periods: ['晚上'], weeklyLessons: 1 },
      expectedStartAt: '2026-11-05'
    },
    publish: true
  });
  return { ok: true, detail: 'student=' + created.student.id + ' demand=' + created.demand.id };
});
must('1 新学员课时为 0', created && created.student.remain === 0, 'remain=' + (created && created.student.remain));
must('1 新学员无课时商品', created && created.student.product === '', 'product="' + (created && created.student.product) + '"');
must('1 需求已发布', created && created.demand.status === '待接单', 'status=' + (created && created.demand.status));

/* 原子性：需求表单不完整时不得留下孤立学员 */
let atomicOk = false;
try {
  S.createStudentWithDemand({
    student: { name: '原子性测试学员', grade: GRADE, book: BOOK },
    demand: { grade: GRADE, textbook: BOOK, learningNeeds: [], expectedSchedule: { weekday: [], periods: [] } },
    publish: true
  });
} catch (e) {
  atomicOk = e.code === 'NEEDS_REQUIRED' && !S.students().some(s => s.name === '原子性测试学员');
}
must('1 需求校验失败时整体回滚（无孤立学员）', atomicOk, '原子性测试学员未入库');

/* 2. T004 响应；T003 也响应 */
S.setSession({ role: 'teacher', teacherId: 'T004', operatorName: (S.teacher('T004') || {}).name || '' });
let view = S.teacherDemandView(created.demand.id);
must('2 教师投影含需求与学员必要字段',
  view && view.demand && view.student && view.student.name === student,
  'student=' + (view && view.student && view.student.name) + ' responseCount=' + (view && view.responseCount));
must('2 教师投影不含家长手机号',
  JSON.stringify(view).indexOf('13800001234') < 0, '未出现手机号');
must('2 教师投影不含内部确认/负责教师字段',
  !('selectedTeacherId' in view.demand) && !('confirmedBy' in view.demand) && !('isChange' in view),
  'demand keys=' + Object.keys(view.demand).join(','));
check('2 T004 响应需求', () => {
  S.respondDemand(created.demand.id, { remark: 'T004 接单意向' });
  return { ok: true, detail: 'T004 已响应' };
});
S.setSession({ role: 'teacher', teacherId: 'T003', operatorName: (S.teacher('T003') || {}).name || '' });
check('2 T003 响应需求（对照）', () => {
  S.respondDemand(created.demand.id, { remark: 'T003 也响应' });
  return { ok: true, detail: 'T003 已响应' };
});
must('2 响应人数为 2', S.teacherDemandView(created.demand.id).responseCount === 2,
  'responseCount=' + S.teacherDemandView(created.demand.id).responseCount);
must('2 教师端看不到他人响应备注',
  JSON.stringify(S.openDemandsFor('T003')).indexOf('T004 接单意向') < 0, '未出现其他教师备注');

/* 3. 教务必选 T004；先验证账号禁用会阻断 */
S.setSession({ role: 'admin', operatorName: '张敏' });
check('3 管理员禁用 T004 账号', () => {
  S.setAccountStatus('T004', '已禁用', { reason: '验收：验证确认阶段账号硬校验' });
  return { ok: true, detail: "T004 account='已禁用'" };
});
S.setSession({ role: 'staff', operatorName: '陈静' });
let blockedMsg = '';
try { S.confirmDemand(created.demand.id, 'T004'); } catch (e) { blockedMsg = e.code + '/' + e.message; }
must('3 账号禁用时教务确认被阻断', blockedMsg.indexOf('TEACHER_NOT_READY') === 0, blockedMsg);
must('3 需求未卡在待分配（仍在接单阶段）',
  ['待接单', '接单中'].indexOf(S.demandOf(created.demand.id).status) >= 0,
  'status=' + S.demandOf(created.demand.id).status);

S.setSession({ role: 'admin', operatorName: '张敏' });
check('3 管理员恢复 T004 账号', () => {
  S.setAccountStatus('T004', '正常', { reason: '验收：恢复账号' });
  return { ok: true, detail: "T004 account='正常'" };
});
S.setSession({ role: 'staff', operatorName: '陈静' });
check('3 教务必选 T004', () => {
  const c = S.confirmDemand(created.demand.id, 'T004', { reason: 'T004 更匹配五年级人教版' });
  return { ok: c.demand.status === '待管理员分配', detail: 'status=' + c.demand.status };
});

/* 4. 管理员正式分配 */
S.setSession({ role: 'admin', operatorName: '张敏' });
let assigned;
check('4 管理员正式分配 T004', () => {
  assigned = S.assignDemand(created.demand.id, { reason: '验收分配', effectiveAt: '2026-11-05' });
  return { ok: true, detail: 'relation=' + assigned.relation.id + ' teacher=' + assigned.relation.teacherId };
});
must('4 师生关系当前有效', assigned && assigned.relation.status === '当前有效', 'status=' + (assigned && assigned.relation.status));
must('4 学员当前教师为 T004',
  S.student(created.student.id).teacher === 'T004' ||
  (S.currentStudentsOf('T004').some(x => x.student.id === created.student.id)),
  'currentStudentsOf(T004) 含该学员');

/* 5. T004 为学员申请 2 个词库 */
S.setSession({ role: 'teacher', teacherId: 'T004', operatorName: (S.teacher('T004') || {}).name || '' });
const books = S.wordbooks().filter(b => b.status === '启用').slice(0, 2);
must('5 词库资源可申请', books.length === 2, books.map(b => b.id).join(','));
let reqs;
check('5 T004 申请 2 个词库', () => {
  reqs = S.createWordbookRequests({
    studentId: created.student.id, teacherId: 'T004',
    wordbookIds: books.map(b => b.id), reason: '验收：五年级词汇强化'
  });
  return { ok: reqs.length === 2, detail: reqs.map(r => r.id).join(',') };
});
must('5 申请状态为待审核', reqs && reqs.every(r => r.status === '待审核'), '2 条待审核');

/* 6. 管理员审核通过 */
S.setSession({ role: 'admin', operatorName: '张敏' });
let authOk = 0;
reqs.forEach(r => {
  check('6 审核通过 ' + r.id, () => {
    S.reviewWordbookRequest(r.id, { approve: true, remark: '验收通过' });
    authOk++;
    return { ok: true, detail: 'granted' };
  });
});
const auths = S.studentWordbooksOf(created.student.id).filter(w => w.auth.status === '已授权');
must('6 产生 2 条有效授权', auths.length === 2, auths.map(w => w.auth.id).join(','));
must('6 授权可追溯到申请', auths.every(w => !!w.auth.requestId), auths.map(w => w.auth.requestId).join(','));

/* 7. T004 登录教学端：我的学员 / 已授权词库 / 启动训练 */
S.setSession({ role: 'teacher', teacherId: 'T004', operatorName: (S.teacher('T004') || {}).name || '' });
must('7 T004 可见该学员',
  S.currentStudentsOf('T004').some(x => x.student.id === created.student.id),
  'currentStudentsOf(T004) 命中');
const allowed = S.authorizedWordbooksOf(created.student.id);
must('7 T004 可见 2 个已授权词库', allowed.length === 2, allowed.map(x => x.wordbook.id).join(','));
let task;
check('7 T004 启动训练', () => {
  task = S.startTrainTask({
    studentId: created.student.id, teacherId: 'T004',
    wordbookId: allowed[0].wordbook.id
  });
  return { ok: true, detail: 'task=' + task.id + ' teacher=' + task.teacherId };
});
must('7 训练记录 teacherId = T004', task && task.teacherId === 'T004', 'teacherId=' + (task && task.teacherId));
must('7 训练记录不含 T001', S.tasksOf(created.student.id).every(t => t.teacherId !== 'T001'),
  'tasks=' + S.tasksOf(created.student.id).map(t => t.id + ':' + t.teacherId).join(','));

/* 8. 全程无虚假课时 */
const flows = S.flows().filter(f => f.studentId === created.student.id);
must('8 该学员无课时流水', flows.length === 0, 'flows=' + flows.length);
must('8 学员课时余额仍为 0', S.student(created.student.id).remain === 0,
  'remain=' + S.student(created.student.id).remain);

/* ============================================================
   汇总输出
   ============================================================ */
let pass = 0;
results.forEach(r => {
  if (r.ok) pass++;
  console.log((r.ok ? 'PASS' : 'FAIL') + '  ' + r.name + (r.detail ? '  → ' + r.detail : ''));
});
console.log('\n合计 ' + pass + '/' + results.length + ' 通过');
process.exit(pass === results.length ? 0 : 1);
