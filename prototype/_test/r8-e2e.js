/* 第七轮端到端验收：代理获客 → 线索跟进 → 意向 → 报名单 → 收款 → 课时 → 教学反馈 → 续费 → 再次购买
   直接调用 Store，不依赖浏览器。断言失败会抛错并以非 0 退出。 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function makeLS(initial) {
  const m = Object.assign({}, initial || {});
  return {
    getItem: k => (k in m ? m[k] : null),
    setItem: (k, v) => { m[k] = String(v); },
    removeItem: k => { delete m[k]; },
    _dump: () => m
  };
}
function boot(initial) {
  const store = { localStorage: makeLS(initial) };
  store.window = store;
  store.globalThis = store;
  store.console = console;
  const ctx = vm.createContext(store);
  const dir = path.join(__dirname, '..', 'assets', 'js');
  vm.runInContext(fs.readFileSync(path.join(dir, 'data.js'), 'utf8'), ctx, { filename: 'data.js' });
  vm.runInContext(fs.readFileSync(path.join(dir, 'store.js'), 'utf8'), ctx, { filename: 'store.js' });
  return { Store: ctx.Store, ctx };
}
let n = 0;
const ok = [];
function assert(name, cond, detail) {
  n++;
  if (!cond) throw new Error('断言失败：' + name + (detail ? ' → ' + detail : ''));
  ok.push('  ✓ ' + name + (detail ? '（' + detail + '）' : ''));
}
function throws(fn, code) {
  try { fn(); return null; } catch (e) { return e; }
}
function section(t) { console.log('\n' + t); }

const { Store } = boot();
const db = Store.db;
const TODAY = db.today;
let leadId, studentId, parentId, order1, order2, renewalId, feedbackId;

section('1. 代理 A001 录入新家长线索');
Store.setSession({ role: 'agent', agentId: 'A001', operatorName: '王磊' });
const agentSelf = Store.currentAgentId();
assert('代理身份来自会话', agentSelf === 'A001', agentSelf);
const lead = Store.createLead({
  name: '周女士', phone: '13700009999', kidName: '周子涵', grade: '八年级',
  book: '人教版', channel: '代理推荐', intentProductId: 'PRD02'
});
leadId = lead.id;
assert('线索建立并回到「新线索」', lead.status === '新线索', lead.status);
assert('代理归属写入 lead.agentId', lead.agentId === 'A001', lead.agentId);
assert('维护归属写入 lead.followerId', lead.followerId === 'A001', lead.followerId);
assert('建立人来自会话而非硬编码', lead.createdBy === '王磊', lead.createdBy);
assert('线索日志记录归属', db.leadLogs.some(x => x.leadId === leadId && x.action === 'CREATED' && x.operatorName === '王磊'));

section('2. 录入两条跟进记录并推进状态');
Store.addLeadFollowUp(leadId, { type: '电话', content: '首次电话：孩子八年级，想提升词汇量', result: '家长愿意了解套餐', nextAt: '2026-11-05 10:00' });
const f2 = Store.addLeadFollowUp(leadId, { type: '微信', content: '发送 30 课时包介绍与课表', result: '家长认可，约试听', status: '跟进中' });
assert('两条跟进记录已落库', Store.leadFollowUpsOf(leadId).length === 2, 'actual=' + Store.leadFollowUpsOf(leadId).length);
assert('跟进后状态进入「跟进中」', Store.lead(leadId).status === '跟进中', Store.lead(leadId).status);
assert('跟进记录归属人来自会话', f2.followUp.by === '王磊', f2.followUp.by);
const badStatus = throws(() => Store.addLeadFollowUp(leadId, { content: 'x', status: '待联系' }));
assert('非法跨状态流转被阻断', !!badStatus && badStatus.code === 'STATUS_TRANSITION_INVALID', badStatus && badStatus.message);

section('3. 意向转化');
const intent = Store.markLeadIntent(leadId, { productId: 'PRD02', intent: '30 课时包（含 2 赠送）', level: '高' });
assert('线索转为「意向明确」', intent.status === '意向明确', intent.status);
assert('意向日志可追溯', db.leadLogs.some(x => x.leadId === leadId && x.action === 'INTENT'));

section('4. 代理提交报名订单（建档 + 订单原子化）');
const ord1 = Store.submitEnrollmentOrder({
  leadId, productId: 'PRD02',
  student: { studentName: '周子涵', grade: '八年级', book: '人教版', school: '城东实验中学' }
});
order1 = ord1.order;
studentId = order1.studentId;
parentId = order1.parentId;
assert('订单进入「待审核」', order1.status === '待审核', order1.status);
assert('订单成交归属 = 线索代理归属', order1.agentId === 'A001', order1.agentId);
assert('订单绑定线索', order1.leadId === leadId, order1.leadId);
assert('订单课时 = 30 + 2', order1.totalHours === 32, order1.totalHours);
assert('新建学员课时为 0（无凭空课时）', order1.studentId && Store.student(studentId).remain === 0, 'remain=' + Store.student(studentId).remain);
assert('订单未收款前没有课时账户', Store.orderCheck(order1.id).account === null);
assert('学员/家长已建档且互相关联', Store.parent(parentId).kids.indexOf(studentId) >= 0, parentId);
const dup = throws(() => Store.createLead({ name: '周女士2', phone: '13700009999' }));
assert('同手机号重复线索被阻断', !!dup && dup.code === 'LEAD_DUP', dup && dup.code);

section('5. 管理员审核订单 → 确认收款 → 课时入账');
Store.setSession({ role: 'admin', operatorName: '张敏', operatorId: '张敏' });
assert('代理不能代替管理员确认收款', !!throws(() => { Store.setSession({ role: 'agent', agentId: 'A001' }); Store.confirmOrderPayment(order1.id, {}); }, 'FORBIDDEN'));
Store.setSession({ role: 'admin', operatorName: '张敏', operatorId: '张敏' });
Store.reviewOrder(order1.id, { pass: true });
assert('审核后进入「待收款」', Store.order(order1.id).status === '待收款', Store.order(order1.id).status);
assert('待收款仍未产生课时', Store.student(studentId).remain === 0, Store.student(studentId).remain);
const paid = Store.confirmOrderPayment(order1.id, { method: '微信', note: '首期报名收款' });
assert('收款确认后订单「已入账」', paid.order.status === '已入账', paid.order.status);
assert('生成已确认收款记录', paid.order.paymentId && Store.orderPayments(order1.id)[0].status === '已确认');
assert('学员课时 = 订单课时 32', Store.student(studentId).remain === 32, Store.student(studentId).remain);
assert('课时账户与订单互链', paid.account && paid.account.orderId === order1.id, paid.account && paid.account.orderId);
assert('订单/账户/流水核对通过', Store.orderCheck(order1.id).ok, JSON.stringify(Store.orderCheck(order1.id).reasons));
assert('线索自动成交', Store.lead(leadId).status === '已成交', Store.lead(leadId).status);
assert('线索回填学员，链路可追溯', Store.lead(leadId).convertedStudentId === studentId);
assert('收款确认后仍只有一笔课时账户', db.accounts.filter(a => a.orderId === order1.id).length === 1);

section('6. 教务分配教师 T004');
Store.setSession({ role: 'admin', operatorName: '张敏', operatorId: '张敏' });
const rel = Store.assignStudent('T004', studentId, { reason: '新签学员，按年级与时间匹配' });
assert('师生关系创建', rel && rel.teacherId === 'T004', rel && rel.teacherId);
assert('学员当前教师为 T004', Store.student(studentId).teacher === 'T004', Store.student(studentId).teacher);
assert('T004 我的学员包含该学员', Store.currentStudentsOf('T004').some(s => s.student.id === studentId));

section('7. 教师授课后提交学习反馈');
Store.setSession({ role: 'teacher', teacherId: 'T004' });
const fb = Store.createLearningFeedback({
  studentId, title: 'Unit 1 词汇首课反馈',
  performance: '完成 24 个单词初筛，18 个已掌握。',
  weak: '长单词重音位置不稳定。',
  next: '下节课加入 6 个待复习词，并做听写。'
});
feedbackId = fb.id;
assert('反馈由当前教师 T004 提交', fb.teacherId === 'T004', fb.teacherId);
assert('反馈状态已发布', fb.status === '已发布', fb.status);

section('8. 代理看到自己客户的已发布反馈');
Store.setSession({ role: 'agent', agentId: 'A001', operatorName: '王磊' });
const view = Store.agentLeadView(leadId);
assert('代理可见客户详情', !!view.lead && view.lead.id === leadId);
assert('代理可见该客户学习反馈', view.feedbacks.length >= 1 && view.feedbacks.some(f => f.id === feedbackId), 'count=' + view.feedbacks.length);
assert('反馈不含内部报告全文/内部字段', view.feedbacks[0].performance && !('reportId' in view.feedbacks[0]));
assert('代理端不返回收款流水/内部日志', !('payments' in view) && !('logs' in view) && view.policy.canSeePaymentDetail === false);
const cross = throws(() => { Store.setSession({ role: 'agent', agentId: 'A002' }); Store.agentLeadView(leadId); });
assert('其他代理看不到该客户（FORBIDDEN）', !!cross && cross.code === 'FORBIDDEN', cross && cross.code);
const otherCustomers = Store.agentCustomers({ agentId: 'A002' }).filter(r => r.leadId === leadId);
assert('其他代理客户列表不含该客户', otherCustomers.length === 0);
Store.setSession({ role: 'agent', agentId: 'A001', operatorName: '王磊' });

section('9. 课时低于阈值 → 生成续费机会');
Store.setSession({ role: 'admin', operatorName: '张敏', operatorId: '张敏' });
Store.adjustLessons(studentId, -28, '模拟 28 节课程消耗（有权限调整）');
assert('调整后剩余 4 课时', Store.student(studentId).remain === 4, Store.student(studentId).remain);
const rnList = Store.renewals({ studentId });
assert('低于阈值生成续费机会', rnList.length >= 1, 'count=' + rnList.length);
renewalId = rnList[0].renewal.id;
assert('续费来源为「课时不足」', rnList[0].renewal.sourceType === '课时不足', rnList[0].renewal.sourceType);
assert('续费机会归属代理 A001', rnList[0].renewal.agentId === 'A001', rnList[0].renewal.agentId);

section('10. 代理跟进并发起续费订单');
Store.setSession({ role: 'agent', agentId: 'A001', operatorName: '王磊' });
assert('代理续费列表包含该机会', Store.agentRenewals().some(x => x.renewal.id === renewalId));
Store.handleRenewal(renewalId, { remark: '家长认可，选择 10 课时续费包' });
assert('续费机会进入「跟进中」', Store.renewal(renewalId).status === '跟进中', Store.renewal(renewalId).status);
const ord2 = Store.submitRenewalOrder(renewalId, 'PRD03', { remark: '家长续费 20 课时' });
order2 = ord2.order;
assert('续费订单类型/归属正确', order2.type === '续费' && order2.agentId === 'A001', order2.type + '/' + order2.agentId);
assert('续费订单进入「待审核」', order2.status === '待审核', order2.status);
assert('续费机会推进为「已转订单」', Store.renewal(renewalId).status === '已转订单', Store.renewal(renewalId).status);
assert('续费单提交后课时不变', Store.student(studentId).remain === 4, Store.student(studentId).remain);

section('11. 管理员再次确认收款 → 课时累加');
Store.setSession({ role: 'admin', operatorName: '张敏', operatorId: '张敏' });
const paid2 = Store.confirmOrderPayment(order2.id, { method: '支付宝' });
assert('续费订单入账', paid2.order.status === '已入账');
assert('课时累加 = 4 + 20 = 24', Store.student(studentId).remain === 24, Store.student(studentId).remain);
assert('续费订单核对通过', Store.orderCheck(order2.id).ok, JSON.stringify(Store.orderCheck(order2.id).reasons));
assert('续费机会绑定订单', Store.renewal(renewalId).renewalOrderId === order2.id);
assert('两笔订单归属同一位代理', Store.order(order1.id).agentId === 'A001' && Store.order(order2.id).agentId === 'A001');

section('12. 家长端最小投影与越权校验');
Store.setSession({ role: 'parent', parentId });
const pv = Store.parentView();
assert('家长只见自己的孩子', pv.children.length === 1 && pv.children[0].id === studentId, 'count=' + pv.children.length);
assert('家长课时汇总正确', pv.children[0].remain === 24, pv.children[0].remain);
assert('家长订单只含自己孩子', pv.orders.length === 2 && pv.orders.every(o => o.studentId === studentId));
assert('家长端不含内部流水/代理/佣金', !('flows' in pv) && !('commission' in pv) && pv.policy.canSeeInternalFlows === false);
const otherParent = db.parents.filter(p => p.id !== parentId)[0];
const pvOther = throws(() => Store.parentView(otherParent.id));
assert('家长跨孩子查看被阻断', !!pvOther && pvOther.code === 'FORBIDDEN', pvOther && pvOther.code);
assert('家长仍能看到已发布反馈', pv.feedbacks.some(f => f.id === feedbackId));

section('13. 归属与身份审计');
Store.setSession({ role: 'admin', operatorName: '张敏' });
const l0 = Store.lead(leadId);
assert('代理归属保留', l0.agentId === 'A001', l0.agentId);
assert('维护归属保留', l0.followerId === 'A001', l0.followerId);
assert('成交归属保留', Store.order(order1.id).agentId === 'A001');
assert('续费成交归属保留', Store.order(order2.id).agentId === 'A001');
const newLogs = db.leadLogs.filter(x => x.leadId === leadId);
assert('线索日志无 T001 硬编码', newLogs.every(x => !String(x.operatorId).includes('T001') && !String(x.operatorName).includes('T001')));
assert('新订单日志无 T001 硬编码', Store.orderLogsOf(order1.id).concat(Store.orderLogsOf(order2.id)).every(x => !String(x.operatorName).includes('T001')));
assert('新反馈教师为会话教师', Store.learningFeedbacksOfStudent(studentId).every(f => f.teacherId === 'T004'));
const audit = { lead: { agentId: l0.agentId, followerId: l0.followerId }, orders: [order1.id, order2.id], studentId, parentId, feedbackId };
fs.writeFileSync(path.join(__dirname, 'r8-audit.json'), JSON.stringify(audit, null, 2));

console.log('\n全部断言通过：' + n + ' 项');
console.log(ok.join('\n'));
