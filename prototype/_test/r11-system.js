/* 第十一轮验收：系统管理专项（账号 / 角色权限 / 数据范围 / 审计 / 字典 / 通知 / 机构）
   覆盖用户六条验收 + v8 → v9 迁移 + 权限收紧即时生效 + 通知已读归属。
   纯 Node（vm + stub localStorage），无需浏览器。 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function makeStore(initial) {
  const m = Object.assign({}, initial || {});
  return {
    getItem: k => (k in m ? m[k] : null),
    setItem: (k, v) => { m[k] = String(v); },
    removeItem: k => { delete m[k]; },
    key: i => Object.keys(m)[i],
    get length() { return Object.keys(m).length; },
    _dump: () => m
  };
}

function boot(lsSeed) {
  const store = {};
  store.localStorage = makeStore(lsSeed || {});
  store.sessionStorage = makeStore();
  store.window = store;
  store.globalThis = store;
  store.console = console;
  store.PROTO_ROOT = '../';
  store.location = { href: '', search: '' };
  store.URLSearchParams = URLSearchParams;
  store.document = {
    addEventListener() {},
    querySelector() { return null; },
    querySelectorAll() { return []; },
    createElement() { return { style: {}, classList: { add() {}, remove() {} }, appendChild() {}, remove() {} }; },
    body: { appendChild() {} }
  };
  store.setTimeout = setTimeout;
  store.clearTimeout = clearTimeout;
  const ctx = vm.createContext(store);
  const dir = path.join(__dirname, '..', 'assets', 'js');
  vm.runInContext(fs.readFileSync(path.join(dir, 'data.js'), 'utf8'), ctx, { filename: 'data.js' });
  vm.runInContext(fs.readFileSync(path.join(dir, 'store.js'), 'utf8'), ctx, { filename: 'store.js' });
  vm.runInContext(fs.readFileSync(path.join(dir, 'common.js'), 'utf8'), ctx, { filename: 'common.js' });
  vm.runInContext('globalThis.__Proto = Proto;', ctx);
  return { Store: ctx.Store, Proto: ctx.__Proto, ctx, ls: store.localStorage, lsDump: () => store.localStorage._dump() };
}

let n = 0;
const pass = [];
function assert(name, cond, detail) {
  n++;
  if (!cond) throw new Error('断言失败：' + name + (detail ? ' → ' + detail : ''));
  pass.push('  ✓ ' + name + (detail ? '（' + detail + '）' : ''));
}
function section(t) { console.log('\n' + t); }
function throws(fn) {
  try { fn(); return null; } catch (e) { return e; }
}
function flattenMenus(Proto, role) {
  const out = [];
  (Proto.menusFor(role) || []).forEach(g => g.items.forEach(i => out.push(i)));
  return out;
}
function menuHas(Proto, role, id) { return flattenMenus(Proto, role).some(i => i.id === id); }

/* ============================================================
   0. v8 → v9 迁移：搬运历史数据、保留旧 key、失败保留备份
   ============================================================ */
section('0. 数据层 v8 → v9 迁移');
{
  const v8 = {
    version: 8,
    meta: { seq: { L: 9, ORD: 8 } },
    leads: [{
      id: 'LMIG001', code: 'LMIG001', name: '迁移客户', phone: '13800001111',
      kidName: '迁移学员', grade: '三年级', book: '', channel: '转介绍',
      sourceAgentId: '', currentAgentId: '', agentId: '', followerId: 'STF001',
      followerName: '张敏', intent: '', intentProductId: '', status: '新线索', level: '中',
      lastFollowAt: '', nextFollowAt: '', convertedStudentId: '', convertedAt: '',
      createdBy: '张敏', createdAt: '2026-10-01 10:00', updatedAt: '2026-10-01 10:00',
      invalidReason: '', remark: '迁移前历史线索'
    }],
    teacherStudents: []
  };
  const app = boot({ ee_proto_store_v8: JSON.stringify(v8) });
  const mi = app.Store.migrationInfo();
  assert('迁移被识别且成功', mi && mi.ok === true && mi.from === 'v8' && mi.to === 'v9');
  assert('v8 原始 key 未被删除', !!app.ls.getItem('ee_proto_store_v8'));
  assert('生成 v9 数据', app.Store.db.version === 9 && !!app.ls.getItem('ee_proto_store_v9'));
  assert('历史线索被搬运', app.Store.db.leads.some(l => l.id === 'LMIG001'));
  assert('系统管理新表已种子补齐',
    app.Store.db.roles.length >= 6 && app.Store.db.dictionaryTypes.length >= 6 &&
    app.Store.db.notificationRules.length >= 10);
  assert('迁移信息写入 meta', app.Store.db.meta.migration.backupKey === 'ee_proto_store_v8');
  console.log('  ✓ 6 项迁移校验通过');

  const bad = boot({ ee_proto_store_v8: '{坏数据' });
  const bmi = bad.Store.migrationInfo();
  assert('损坏 v8 数据不阻塞启动且提示失败', bmi && bmi.ok === false);
  assert('失败时旧 key 仍保留', !!bad.ls.getItem('ee_proto_store_v8'));
  assert('失败时回落到 v9 种子', bad.Store.db.version === 9 && bad.Store.db.leads.length > 0);
}

/* ============================================================
   主环境
   ============================================================ */
const app = boot();
const Store = app.Store;
const Proto = app.Proto;

function asAdmin() {
  Store.setSession({ role: 'admin', accountId: '', operatorName: '', operatorId: '',
    teacherId: '', agentId: '', parentId: '' });
}
function asTeacher(tid, accId) {
  Store.setSession({ role: 'teacher', accountId: accId || '', operatorName: '',
    operatorId: accId || tid, teacherId: tid, agentId: '', parentId: '' });
}
function asAgent(aid, accId) {
  Store.setSession({ role: 'agent', accountId: accId || '', operatorName: '',
    operatorId: accId || aid, teacherId: '', agentId: aid, parentId: '' });
}
function asParent(pid, accId) {
  Store.setSession({ role: 'parent', accountId: accId || '', operatorName: '',
    operatorId: accId || pid, teacherId: '', agentId: '', parentId: pid });
}
function accountOf(type, pid) {
  return Store.db.users.filter(u => u.profileType === type && u.profileId === pid)[0] || null;
}

/* ============================================================
   1. 账号：新增 / 启停 与登录身份、切换器联动
   ============================================================ */
section('1. 账号新增与启停联动');
asAdmin();
const unbound = Store.staffProfiles().filter(p => !Store.accountOfProfile('staff', p.id) && p.noAccount);
assert('存在未绑定账号的员工档案（可新增账号）', unbound.length > 0,
  unbound.map(p => p.id + ' ' + p.name).join(', '));

const target = unbound[0];
const newAcc = Store.createAccount({
  profileType: 'staff', profileId: target.id, roleCode: target.roleCode,
  loginName: 'liuyang', phone: target.phone, reason: '新员工入职开通账号'
});
assert('新增账号绑定姓名与角色',
  newAcc.profileId === target.id && newAcc.roleCode === target.roleCode && newAcc.status === '正常');
assert('新增账号写入操作日志',
  Store.auditRows({ resourceType: 'account', resourceId: newAcc.id }).some(a => a.action === '账号开通'));

let staffList = Proto.roleAccounts('staff');
assert('角色切换器读到了新增账号',
  staffList.some(a => a.accountId === newAcc.id && a.name === target.name && a.available === true));

Proto.switchRole('staff', newAcc.id);
assert('切换到新账号后会话身份来自账号',
  Store.currentSession().role === 'staff' && Store.currentSession().accountId === newAcc.id &&
  Store.currentSession().operatorName === target.name);
assert('切换后 currentIdentity 与账号一致', Store.currentIdentity().name === target.name);

asAdmin();
Store.setUserAccountStatus(newAcc.id, '禁用', { reason: '离职交接中' });
staffList = Proto.roleAccounts('staff');
const disabledRow = staffList.filter(a => a.accountId === newAcc.id)[0];
assert('禁用后切换器置灰并给出原因',
  disabledRow.available === false && !!disabledRow.reason, disabledRow.reason);

const sessBefore = Store.currentSession();
Proto.switchRole('staff', newAcc.id);
assert('禁用账号无法被切换为当前身份', Store.currentSession().role === sessBefore.role &&
  Store.currentSession().accountId === sessBefore.accountId);
assert('直接写入会话也会被拒绝',
  !!throws(() => Store.setSession({ role: 'staff', accountId: newAcc.id })));
assert('禁用操作写入日志并记录前后状态', Store.auditRows({ resourceType: 'account', resourceId: newAcc.id })
  .some(a => a.action === '禁用账号' && a.beforeData.status === '正常' && a.afterData.status === '已禁用'));

Store.setUserAccountStatus(newAcc.id, '启用', { reason: '交接完成恢复账号' });
assert('启用后切换器恢复可用',
  Proto.roleAccounts('staff').some(a => a.accountId === newAcc.id && a.available === true));

/* ============================================================
   2. 字典：新增选项后业务表单/接口立即可选
   ============================================================ */
section('2. 数据字典被业务真实引用');
asAdmin();
const dictBefore = Store.dictionaryOptions('lead_channel');
assert('初始渠道下拉来自字典', dictBefore.indexOf('转介绍') >= 0 && dictBefore.indexOf('小红书') < 0,
  dictBefore.join('/'));
Store.createDictionaryItem({ typeCode: 'lead_channel', label: '小红书', value: '小红书', sort: 90, reason: '新增获客渠道' });
assert('新增字典项立即进入下拉',
  Store.dictionaryOptions('lead_channel').indexOf('小红书') >= 0);
const leadByDict = Store.createLead({
  name: '林女士', phone: '13800138099', kidName: '林小满', grade: '三年级',
  channel: '小红书', level: '高', remark: '字典新增渠道后录入'
});
assert('业务写入接受新字典值', leadByDict.channel === '小红书');
assert('非法字典值被业务接口拒绝',
  !!throws(() => Store.createLead({ name: '错渠道', phone: '13800138098', channel: '不存在的渠道' })));
assert('被引用字典项不能删除',
  !!throws(() => Store.removeDictionaryItem(
    Store.dictionaryItems('lead_channel').filter(i => i.value === '小红书')[0].id)));

/* ============================================================
   3. 数据范围：代理只看自己客户、教师只看自己学员、家长只看自己孩子
   ============================================================ */
section('3. 数据范围隔离');
const agentWithLead = Store.db.agents.filter(a => a.status === '启用' &&
  Store.db.leads.some(l => (l.currentAgentId || '') === a.id))[0];
assert('存在有客户的启用代理', !!agentWithLead);
const otherAgentLead = Store.db.leads.filter(l =>
  (l.currentAgentId || '') && l.currentAgentId !== agentWithLead.id &&
  !Store.db.orders.some(o => o.leadId === l.id && o.agentId === agentWithLead.id))[0];
const ownAgentLead = Store.db.leads.filter(l => (l.currentAgentId || '') === agentWithLead.id)[0];
asAgent(agentWithLead.id, (accountOf('agent', agentWithLead.id) || {}).id);
const agentRows = Store.agentCustomers();
assert('代理客户列表只含自己客户', agentRows.every(r => {
  const l = Store.db.leads.filter(x => x.id === r.leadId)[0];
  if (l && l.currentAgentId === agentWithLead.id) return true;
  return Store.db.orders.some(o => o.studentId === r.studentId && o.agentId === agentWithLead.id);
}), '共 ' + agentRows.length + ' 条');
assert('代理读取他人客户被拒绝', !!otherAgentLead && !!throws(() => Store.leadView(otherAgentLead.id)));
assert('代理读取自己客户成功', Store.leadView(ownAgentLead.id).lead.id === ownAgentLead.id);

const teacherPair = Store.db.teachers.filter(t => t.cooperationStatus === '可授课' && accountOf('teacher', t.id))
  .map(t => ({ t, students: Store.db.teacherStudents.filter(r => r.teacherId === t.id && r.status === '当前有效') }))
  .filter(x => x.students.length > 0);
assert('存在有学员的可授课教师', teacherPair.length >= 1);
const t1 = teacherPair[0].t;
const t2 = teacherPair.filter(x => x.t.id !== t1.id)[0];
asTeacher(t1.id, accountOf('teacher', t1.id).id);
const myStudents = Store.currentStudentsOf(t1.id);
assert('教师学员列表只含当前负责学员',
  myStudents.every(r => Store.db.teacherStudents.some(x =>
    x.teacherId === t1.id && x.studentId === r.student.id && x.status === '当前有效')) &&
  myStudents.length === teacherPair[0].students.length);
if (t2) {
  assert('教师读取他人学员列表被拒绝', !!throws(() => Store.currentStudentsOf(t2.t.id)));
  const foreignStudent = t2.students[0].studentId;
  assert('教师读取非自己学员任务被拒绝', !!throws(() => Store.tasksOf(foreignStudent)));
}

const parents = Store.db.parents.filter(p => Store.parentStudents(p.id).length > 0 && accountOf('parent', p.id));
assert('存在有孩子的家长', parents.length >= 1);
const p1 = parents[0];
const p2 = parents.filter(x => x.id !== p1.id)[0];
asParent(p1.id, accountOf('parent', p1.id).id);
const kids = Store.parentChildren(p1.id);
assert('家长只读到自己的孩子',
  kids.length === Store.parentStudents(p1.id).length && kids.every(k => Store.parentStudents(p1.id).some(x => x.id === k.id)));
assert('家长读取他人孩子被拒绝', !!throws(() => Store.parentChildren(p2 ? p2.id : 'P999')));
assert('家长访问他人孩子档案被拒绝', !!throws(() => Store.parentStudentDetail((p2 ? Store.parentStudents(p2.id)[0].id : 'S999'))));

/* ============================================================
   4. 操作日志：报名 → 收款 → 课时入账 → 分配教师
   ============================================================ */
section('4. 关键业务链路留痕并可回溯单据');
asAdmin();
Store.addLeadFollowUp(leadByDict.id, { type: '电话', content: '首次电话沟通，确认三年级英语需求', status: '跟进中' });
Store.markLeadIntent(leadByDict.id, { intent: '希望一周两次课', productId: Store.products()[0].id, level: '高' });
const product = Store.products()[0];
const order = Store.submitEnrollmentOrder({
  leadId: leadByDict.id, productId: product.id, remark: '线下试听满意，直接报名'
});
const oid = order.order.id;
assert('报名订单生成待审核',
  order.order.status === '待审核' && order.order.amount === product.price,
  oid + ' ¥' + order.order.amount);
Store.reviewOrder(oid, { pass: true, reason: '信息核对无误' });
assert('订单审核通过进入待收款', Store.orderOf(oid).status === '待收款');
const reg = Store.registerPayment(oid, { amount: order.order.amount, method: '微信', voucherNo: 'WX20261103001' });
assert('收款登记为待确认', reg.status === '待确认');
assert('登记收款不产生课时', Store.accountsOfStudent(order.student.id).length === 0);
const confirmed = Store.confirmRegisteredPayment(reg.id, { reason: '到账核对完成' });
assert('确认收款后生成课时账户', confirmed.account && Number(confirmed.account.remain) > 0,
  'remain=' + (confirmed.account || {}).remain);
assert('订单转为已入账', confirmed.order.status === '已入账');

const freeTeacher = Store.db.teachers.filter(t => t.cooperationStatus === '可授课' &&
  !Store.db.teacherStudents.some(r => r.studentId === order.student.id && r.status === '当前有效'))[0];
assert('存在可分配的可授课教师', !!freeTeacher);
Store.assignStudent(freeTeacher.id, order.student.id, { reason: '按年级与教材匹配分配' });
assert('师生关系建立', Store.db.teacherStudents.some(r =>
  r.teacherId === freeTeacher.id && r.studentId === order.student.id && r.status === '当前有效'));

const orderLogs = Store.auditRows({ resourceType: 'order', resourceId: oid });
const orderActions = orderLogs.map(a => a.action);
assert('订单链路日志逐条可查',
  orderActions.indexOf('提交报名订单') >= 0 &&
  orderActions.indexOf('审核报名订单（通过）') >= 0 &&
  orderActions.indexOf('登记收款') >= 0 &&
  orderActions.indexOf('确认收款并入账') >= 0,
  orderActions.join(' → '));
const studentLogs = Store.auditRows({ resourceType: 'student', resourceId: order.student.id });
const assignLog = studentLogs.filter(a => a.action === '正式分配学员')[0];
assert('分配教师日志记录前后值与单据对象',
  assignLog && assignLog.beforeData.teacherName === '未分配' &&
  assignLog.afterData.teacherId === freeTeacher.id && assignLog.resourceId === order.student.id);
assert('日志字段完整：操作人/身份/时间/对象/动作/结果',
  assignLog.operatorName && assignLog.operatorRole && assignLog.createdAt &&
  assignLog.module === '教学资源分配' && assignLog.result === '成功');
assert('可从日志回溯到具体单据',
  (Store.auditOf(assignLog.id) || {}).resourceId === order.student.id &&
  (Store.auditOf(orderLogs[0].id) || {}).resourceId === oid);

/* ============================================================
   5. 通知：业务事件生成、消息中心可读、已读未读正确
   ============================================================ */
section('5. 业务事件通知与已读状态');
asAdmin();
const adminAcc = Store.db.users.filter(u => u.roleCode === 'admin' && u.status === '正常')[0];
asAdmin();
const unreadBefore = Store.unreadNotificationCount();
const myNotes = Store.notifications({});
assert('订单待审核事件生成通知',
  myNotes.some(x => x.eventCode === 'ORDER_REVIEW' && x.businessId === oid && x.receiverRole === 'admin'));
assert('收款待确认事件生成通知',
  myNotes.some(x => x.eventCode === 'PAYMENT_REGISTERED' && x.businessId === oid));
assert('通知模板占位符被真实业务值替换',
  myNotes.filter(x => x.eventCode === 'ORDER_REVIEW' && x.businessId === oid)[0].title.indexOf(oid) >= 0);
assert('未读通知数覆盖两类事件', Store.unreadNotificationCount() >= 2,
  '未读 ' + Store.unreadNotificationCount() + ' 条');

const note = myNotes.filter(x => x.eventCode === 'PAYMENT_REGISTERED' && x.businessId === oid)[0];
Store.markNotificationRead(note.id);
const afterRead = Store.notifications({}).filter(x => x.id === note.id)[0];
assert('标记已读后 readAt 有值', !!afterRead.readAt);
assert('未读数相应减少', Store.unreadNotificationCount() === Store.notifications({}).filter(x => !x.readAt).length);

if (agentWithLead) {
  asAgent(agentWithLead.id, (accountOf('agent', agentWithLead.id) || {}).id);
  assert('不能标记他人的通知为已读', !!throws(() => Store.markNotificationRead(note.id)));
  assert('代理只看到自己的通知',
    Store.notifications({}).every(x => x.receiverRole === 'agent' && x.receiverId === agentWithLead.id));
}

asAdmin();
const cleared = Store.markAllNotificationsRead();
assert('全部标记已读生效', cleared >= 0 && Store.unreadNotificationCount() === 0);

/* ============================================================
   6. 角色权限变更：教师与代理菜单/操作即时收紧，再恢复默认
   ============================================================ */
section('6. 角色权限变更即时生效');
asAdmin();
const teacherRole = Store.roleOf('teacher');
const agentRole = Store.roleOf('agent');
assert('教师/代理角色存在', !!teacherRole && !!agentRole);

const teacherMenuBefore = flattenMenus(Proto, 'teacher').map(i => i.id);
assert('教师默认有「我的学员」「词库申请」菜单',
  teacherMenuBefore.indexOf('my-students') >= 0 && teacherMenuBefore.indexOf('demand-wbreq') >= 0);
const agentMenuBefore = flattenMenus(Proto, 'agent').map(i => i.id);
assert('代理默认有「客户报备」菜单', agentMenuBefore.indexOf('agent-report') >= 0);

const teacherStudent = teacherPair[0].students[0].studentId;
const wordbookId = (Store.db.wordbooks.filter(w => w.status === '启用' &&
  !Store.db.studentWordbooks.some(g => g.studentId === teacherStudent && g.wordbookId === w.id) &&
  !Store.db.studentWordbookRequests.some(r => r.studentId === teacherStudent &&
    r.wordbookId === w.id && r.status === '待审核'))[0] || {}).id;
assert('存在尚未授权给该学员的词库', !!wordbookId);
asTeacher(t1.id, accountOf('teacher', t1.id).id);
const reqOk = Store.createWordbookRequests({
  studentId: teacherStudent, wordbookIds: [wordbookId], reason: '按教材进度开通词库'
});
assert('收紧前教师可提交词库申请', reqOk.length === 1);

asAdmin();
const tMatrix = Store.permissionMatrix('teacher');
const tList = tMatrix.modules.reduce((a, m) => a.concat(m.items.map(i => ({
  code: i.code, enabled: i.code === 'student.view' || i.code === 'wordbook.request' ? false : i.enabled
}))), []);
Store.updateRolePermissions(teacherRole.id, tList, { dataScope: 'OWN', reason: '按校区要求收紧教师权限' });
assert('教师权限变更写入日志',
  Store.auditRows({ resourceType: 'role', resourceId: teacherRole.id }).some(a => a.action.indexOf('权限') >= 0 || a.action.indexOf('角色') >= 0));

const aMatrix = Store.permissionMatrix('agent');
const aList = aMatrix.modules.reduce((a, m) => a.concat(m.items.map(i => ({
  code: i.code, enabled: i.code === 'lead.create' ? false : i.enabled
}))), []);
Store.updateRolePermissions(agentRole.id, aList, { dataScope: 'OWN', reason: '代理暂停自主报备' });

asTeacher(t1.id, accountOf('teacher', t1.id).id);
const teacherMenuAfter = flattenMenus(Proto, 'teacher').map(i => i.id);
assert('教师「我的学员」菜单同步消失', teacherMenuAfter.indexOf('my-students') < 0);
assert('教师「词库申请」菜单同步消失', teacherMenuAfter.indexOf('demand-wbreq') < 0);
assert('教师词库申请操作被 Store 拒绝', !!throws(() => Store.createWordbookRequests({
  studentId: teacherStudent, wordbookIds: [wordbookId], reason: '再次申请'
})));
assert('教师仍有未被收回的菜单（不是一刀切）', teacherMenuAfter.indexOf('workbench') >= 0);

asAgent(agentWithLead.id, (accountOf('agent', agentWithLead.id) || {}).id);
assert('代理「客户报备」菜单同步消失', flattenMenus(Proto, 'agent').map(i => i.id).indexOf('agent-report') < 0);
assert('代理新增客户操作被 Store 拒绝', !!throws(() => Store.createLead({
  name: '测试代理报备', phone: '13800138097', channel: '转介绍'
})));

asAdmin();
Store.resetRolePermissions(teacherRole.id, { reason: '恢复预置权限' });
Store.resetRolePermissions(agentRole.id, { reason: '恢复预置权限' });
assert('恢复默认后教师菜单回补', menuHas(Proto, 'teacher', 'my-students') && menuHas(Proto, 'teacher', 'demand-wbreq'));
assert('恢复默认后代理菜单回补', menuHas(Proto, 'agent', 'agent-report'));

/* ============================================================
   7. 机构设置与操作日志统计
   ============================================================ */
section('7. 机构设置与日志统计');
const orgBefore = Store.organizationSettings();
Store.updateOrganizationSettings({ lessonAlertThreshold: 6, reason: '按校区运营要求调整预警阈值' });
assert('课时预警阈值已保存', Store.organizationSettings().lessonAlertThreshold === 6);
assert('机构设置变更留痕',
  Store.auditRows({ resourceType: 'organization' }).some(a => a.action === '更新机构设置' &&
    a.beforeData.lessonAlertThreshold === orgBefore.lessonAlertThreshold));
assert('非法阈值被拒绝', !!throws(() => Store.updateOrganizationSettings({ lessonAlertThreshold: -1 })));
const stat = Store.auditStat();
assert('日志统计覆盖多模块', stat.total > 0 && Object.keys(stat.modules).length >= 4,
  Object.keys(stat.modules).join('/'));

console.log('\n========================================');
console.log('第十一轮系统管理验收：' + n + ' 项全部通过');
console.log('========================================');
pass.forEach(x => console.log(x));
