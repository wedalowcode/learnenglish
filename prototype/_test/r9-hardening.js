/* 第九轮业务完整性加固验收
   覆盖：同名学员不串账 / 续费驳回恢复 / 归属三拆 / 家长多对多 / 报备争议 /
        部分收款与退款 / 身份兜底与读权限。
   直接调用 Store，断言失败即抛错并退出非 0。 */
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
  return { Store: ctx.Store, ctx, ls: store.localStorage };
}
let n = 0;
const ok = [];
function assert(name, cond, detail) {
  n++;
  if (!cond) throw new Error('断言失败：' + name + (detail ? ' → ' + detail : ''));
  ok.push('  ✓ ' + name + (detail ? '（' + detail + '）' : ''));
}
function throws(fn) {
  try { fn(); return null; } catch (e) { return e; }
}
function section(t) { console.log('\n' + t); }

const { Store, ctx, ls } = boot();
const db = Store.db;

function admin() {
  Store.setSession({ role: 'admin', operatorName: '张敏', operatorId: '张敏' });
}
function asAgent(id) {
  Store.setSession({ role: 'agent', agentId: id, operatorName: (Store.agent(id) || {}).name || id });
}
function asParent(id) {
  Store.setSession({ role: 'parent', parentId: id, operatorName: (Store.parent(id) || {}).name || id });
}
function enroll(agentId, leadInput, productId) {
  asAgent(agentId);
  const l = Store.createLead(leadInput);
  Store.addLeadFollowUp(l.id, { type: '电话', content: '首次电话沟通', result: '家长愿意了解', status: '跟进中' });
  Store.markLeadIntent(l.id, { productId });
  const res = Store.submitEnrollmentOrder({
    leadId: l.id, productId,
    student: { studentName: leadInput.kidName, grade: leadInput.grade, book: leadInput.book }
  });
  return { lead: l, order: res.order };
}
function reviewAndPay(orderId, opt) {
  admin();
  Store.reviewOrder(orderId, { pass: true });
  return Store.confirmOrderPayment(orderId, opt || { method: '微信' });
}

/* ============================================================ */
section('1. 同名学员：扣课 / 课时调整 / 家长端 / 续费提醒 四类操作不串账');
const e1 = enroll('A001', { name: '李女士', phone: '13700000001', kidName: '陈一诺', grade: '三年级', book: '人教版' }, 'PRD03');
reviewAndPay(e1.order.id);
const e2 = enroll('A002', { name: '王女士', phone: '13700000002', kidName: '陈一诺', grade: '三年级', book: '人教版' }, 'PRD03');
reviewAndPay(e2.order.id);
const s1 = Store.student(e1.order.studentId);
const s2 = Store.student(e2.order.studentId);
assert('两个同名学员是两个独立档案', s1.id !== s2.id && s1.name === s2.name && s2.name === '陈一诺', s1.id + '/' + s2.id);
const acc1 = Store.accountsOfStudent(s1.id);
const acc2 = Store.accountsOfStudent(s2.id);
assert('两个账户同名但按 studentId 隔离', acc1.length === 1 && acc2.length === 1 && acc1[0].id !== acc2[0].id && acc1[0].student === acc2[0].student,
  acc1[0].id + '/' + acc2[0].id);

admin();
const base1 = s1.remain, base2 = s2.remain;
Store.adjustLessons(s1.id, -3, '同名学员隔离测试');
assert('管理员调整只影响目标学员', Store.student(s1.id).remain === base1 - 3 && Store.student(s2.id).remain === base2,
  Store.student(s1.id).remain + '/' + Store.student(s2.id).remain);

db.courses.push({
  id: 'C9-SAMENAME', studentId: s2.id, student: s2.name, teacherId: 'T004',
  date: Store.db.today, start: '09:00', end: '10:00', status: '待上课', createdAt: Store.stamp()
});
const deduct = Store.deductCourse('C9-SAMENAME', '张敏');
assert('扣课只扣目标学员的账户', deduct.ok && Store.student(s2.id).remain === base2 - 1 && Store.student(s1.id).remain === base1 - 3,
  's1=' + Store.student(s1.id).remain + ' s2=' + Store.student(s2.id).remain);

const pv1 = Store.parentView(e1.order.parentId);
const pv2 = Store.parentView(e2.order.parentId);
assert('家长端只看到自己的孩子（同名不串）', pv1.children.length === 1 && pv1.children[0].id === s1.id &&
  pv2.children.length === 1 && pv2.children[0].id === s2.id);
assert('家长端课时各自独立', pv1.hours.length === 1 && pv1.hours[0].remain === Store.student(s1.id).remain &&
  pv2.hours.length === 1 && pv2.hours[0].remain === Store.student(s2.id).remain,
  pv1.hours[0].remain + '/' + pv2.hours[0].remain);

Store.adjustLessons(s1.id, -(Store.student(s1.id).remain - 3), '续费提醒隔离测试');
Store.refreshRenewalOpportunities(s1.id);
const s1Renewals = Store.renewals({ studentId: s1.id });
assert('续费提醒只为目标学员生成', s1Renewals.length >= 1 && s1Renewals.every(r => r.renewal.studentId === s1.id), 'count=' + s1Renewals.length);
assert('同名学员不产生续费机会', Store.renewals({ studentId: s2.id }).length === 0, 'count=' + Store.renewals({ studentId: s2.id }).length);

/* ============================================================ */
section('2. 续费订单驳回 → 机会恢复 → 重新下单 → 收款成功');
const opp = Store.renewals({ studentId: s1.id })[0].renewal;
asAgent('A001');
Store.handleRenewal(opp.id, { status: '跟进中', remark: '电话联系家长，家长愿意续费' });
const rOrd1 = Store.submitRenewalOrder(opp.id, 'PRD03').order;
assert('续费订单提交后机会为「已转订单」', Store.renewal(opp.id).status === '已转订单', Store.renewal(opp.id).status);
admin();
Store.reviewOrder(rOrd1.id, { pass: false, reason: '家长要求改套餐' });
assert('驳回后机会恢复「待跟进」', Store.renewal(opp.id).status === '待跟进', Store.renewal(opp.id).status);
assert('恢复时保留跟进记录与备注', Store.renewal(opp.id).remark.indexOf('跟进记录保留') >= 0, Store.renewal(opp.id).remark);
assert('恢复后解除订单绑定', Store.renewal(opp.id).renewalOrderId === '' && Store.renewal(opp.id).restoredFromOrderId === rOrd1.id);
asAgent('A001');
const rOrd2 = Store.submitRenewalOrder(opp.id, 'PRD03').order;
admin();
Store.reviewOrder(rOrd2.id, { pass: true });
Store.confirmOrderPayment(rOrd2.id, { method: '微信' });
assert('重新下单收款成功', Store.order(rOrd2.id).status === '已入账', Store.order(rOrd2.id).status);
assert('续费机会重新绑定新订单', Store.renewal(opp.id).status === '已转订单' && Store.renewal(opp.id).renewalOrderId === rOrd2.id);
assert('课时累加正确（3 + 20 = 23）', Store.student(s1.id).remain === 23, Store.student(s1.id).remain);
assert('续费订单账实相符', Store.orderCheck(rOrd2.id).ok, Store.orderCheck(rOrd2.id).reasons.join(';'));

/* ============================================================ */
section('3. 归属三拆：移交后 sourceAgentId 不变 / currentAgentId 变更 / 新订单归新代理');
const e3 = { lead: null };
asAgent('A001');
const lead3 = Store.createLead({ name: '周先生', phone: '13700000003', kidName: '周一诺', grade: '八年级', book: '人教版' });
e3.lead = lead3;
admin();
Store.assignLead(lead3.id, { agentId: 'A002', followerId: 'A002', reason: '区域调整移交给 A002' });
const l3 = Store.lead(lead3.id);
assert('sourceAgentId 仍为首次获客 A001', Store.leadSourceAgentId(l3) === 'A001', Store.leadSourceAgentId(l3));
assert('currentAgentId 已变更为 A002', Store.leadCurrentAgentId(l3) === 'A002', Store.leadCurrentAgentId(l3));
assert('旧字段 agentId 镜像 currentAgentId（兼容页面）', l3.agentId === 'A002', l3.agentId);
asAgent('A002');
Store.addLeadFollowUp(l3.id, { type: '电话', content: '移交后首次跟进', result: '家长同意报名', status: '跟进中' });
Store.markLeadIntent(l3.id, { productId: 'PRD01' });
const res3 = Store.submitEnrollmentOrder({
  leadId: l3.id, productId: 'PRD01',
  student: { studentName: '周一诺', grade: '八年级', book: '人教版' }
});

assert('移交后的新订单成交归属为新代理', res3.order.agentId === 'A002', res3.order.agentId);
asAgent('A001');
const oldView = throws(() => Store.leadView(l3.id));
assert('原代理不再能读已移交客户', !!oldView && oldView.code === 'FORBIDDEN', oldView && oldView.code);
const oldRows = Store.orderRows();
assert('原代理订单列表不含新代理的订单', oldRows.every(o => o.order.id !== res3.order.id));

/* ============================================================ */
section('4. 家长与学员多对多：两个家长账号关联同一学员');
const father = { id: 'P900', name: '陈先生（父亲）', phone: '13800000001', relation: '父亲', kids: [] };
db.parents.push(father);
admin();
const rel = Store.linkParentStudent('P900', s1.id, { relationship: '父亲', isPrimaryContact: false });
assert('关系表新增父亲账号关联', !!rel && db.parentStudents.filter(x => x.parentId === 'P900' && x.studentId === s1.id).length === 1);
assert('同一学员可对应两个家长账号', db.parentStudents.filter(x => x.studentId === s1.id).length === 2,
  'links=' + db.parentStudents.filter(x => x.studentId === s1.id).length);
const pvFather = Store.parentView('P900');
const pvMother = Store.parentView(e1.order.parentId);
assert('父亲账号能看到孩子', pvFather.children.length === 1 && pvFather.children[0].id === s1.id);
assert('母亲账号同时也能看到孩子', pvMother.children.length === 1 && pvMother.children[0].id === s1.id);
assert('两个账号看到的课时一致', pvFather.hours[0].remain === pvMother.hours[0].remain && pvMother.hours[0].remain === 23,
  pvFather.hours[0].remain + '/' + pvMother.hours[0].remain);
assert('关系表字段完整', rel.relationship === '父亲' && rel.isPrimaryContact === false && rel.id.indexOf('PS') === 0);

/* ============================================================ */
section('5. 重复报备生成争议，管理员可裁定且可追溯');
asAgent('A001');
const dup = throws(() => Store.createLead({ name: '周先生', phone: '13700000003', kidName: '周一诺' }));
assert('重复报备被阻断并提示争议单号', !!dup && dup.code === 'LEAD_DISPUTE' && /争议/.test(dup.message), dup && dup.message);
const disputes = Store.leadDisputesOf({ leadId: l3.id, status: '待裁定' });
assert('生成待裁定争议记录', disputes.length === 1 && disputes[0].dispute.claimantAgentId === 'A001' &&
  disputes[0].dispute.originalAgentId === 'A002', 'count=' + disputes.length);
const disputeId = disputes[0].dispute.id;
admin();
const resolved = Store.resolveLeadDispute(disputeId, { assignToAgentId: 'A001', result: '按首次获客归属判给 A001' });
assert('裁定后争议状态为已裁定', resolved.dispute.status === '已裁定', resolved.dispute.status);
assert('裁定结果写入处理人/结果/时间', resolved.dispute.handledBy === '张敏' && resolved.dispute.result.length > 0 && !!resolved.dispute.resolvedAt);
assert('裁定可调整维护归属', Store.leadCurrentAgentId(Store.lead(l3.id)) === 'A001', Store.leadCurrentAgentId(Store.lead(l3.id)));
assert('裁定不改变首次获客归属', Store.leadSourceAgentId(Store.lead(l3.id)) === 'A001');
assert('裁定结果落线索日志可追溯', Store.leadLogsOf(l3.id).some(x => x.action === 'DISPUTE_RESOLVED'));
assert('已裁定争议不能重复处理', !!throws(() => Store.resolveLeadDispute(disputeId, { result: '再判一次' })));

/* ============================================================ */
section('6. 部分收款：两次累加等于订单额、课时累计正确、超额被拒');
const e6 = enroll('A001', { name: '孙女士', phone: '13700000004', kidName: '孙小满', grade: '四年级', book: '人教版' }, 'PRD03');
const o6 = e6.order;
assert('订单金额 2580 / 课时 20', o6.amount === 2580 && o6.totalHours === 20);
admin();
Store.reviewOrder(o6.id, { pass: true });
asAgent('A001');
const reg1 = Store.registerPayment(o6.id, { amount: 1290, method: '微信', voucherNo: 'WX001', note: '首笔定金' });
assert('收款登记为「待确认」且未生成课时', reg1.status === '待确认' && Store.student(e6.order.studentId).remain === 0 &&
  Store.orderCheck(o6.id).account === null);
const overReg = throws(() => Store.registerPayment(o6.id, { amount: 2000, method: '微信' }));
assert('待确认登记也计入累计上限，超额登记被拒', !!overReg && overReg.code === 'AMOUNT_OVERFLOW', overReg && overReg.code);
admin();
Store.confirmRegisteredPayment(reg1.id);
const mid = Store.order(o6.id);
assert('首笔确认后为「待收款（部分收款中）」', mid.status === '待收款' && mid.paidAmount === 1290, mid.status + '/' + mid.paidAmount);
assert('首笔按单价折算入账 10 课时', mid.creditedHours === 10 && Store.student(e6.order.studentId).remain === 10,
  mid.creditedHours + '/' + Store.student(e6.order.studentId).remain);
assert('部分收款阶段账实相符', Store.orderCheck(o6.id).ok, Store.orderCheck(o6.id).reasons.join(';'));
asAgent('A001');
const reg2 = Store.registerPayment(o6.id, { amount: 1290, method: '银行转账', voucherNo: 'BK001' });
admin();
Store.confirmRegisteredPayment(reg2.id);
const done = Store.order(o6.id);
assert('两笔收款累计等于订单额', done.paidAmount === 2580 && done.status === '已入账', done.paidAmount + '/' + done.status);
assert('课时累计等于订单课时（10 + 10 = 20）', done.creditedHours === 20 && Store.student(e6.order.studentId).remain === 20,
  done.creditedHours + '/' + Store.student(e6.order.studentId).remain);
assert('收款完成 orderCheck.ok', Store.orderCheck(o6.id).ok, Store.orderCheck(o6.id).reasons.join(';'));
assert('已入账订单不能继续登记收款', !!throws(() => Store.registerPayment(o6.id, { amount: 1 })));

/* ============================================================ */
section('7. 退款审核：课时按比例冲回、余额不为负、超额拒绝');
const o6student = e6.order.studentId;
const rf1 = Store.requestOrderRefund(o6.id, { amount: 1290, reason: '家长申请退一半' });
assert('退款申请为「待审核」，不立即回写账户', rf1.status === '待审核' && Store.student(o6student).remain === 20);
const overRefund = throws(() => Store.requestOrderRefund(o6.id, { amount: 2000, reason: '超额申请' }));
assert('退款金额超过已确认收款合计被拒', !!overRefund && overRefund.code === 'REFUND_AMOUNT_EXCEED', overRefund && overRefund.code);
admin();
assert('代理不能自行审核退款', !!throws(() => { asAgent('A001'); Store.reviewRefund(rf1.id, { pass: true }); }));
admin();
const approved = Store.reviewRefund(rf1.id, { pass: true, result: '同意退一半' });
assert('退款通过后订单标记「已退款（部分）」', Store.order(o6.id).status === '已退款' &&
  Store.order(o6.id).partialRefund === true && Store.order(o6.id).refundedAmount === 1290);
assert('按比例冲回 10 课时且余额不为负', approved.reversedHours === 10 && Store.student(o6student).remain === 10,
  approved.reversedHours + '/' + Store.student(o6student).remain);
assert('写负数退款流水', db.flows.some(f => f.orderId === o6.id && f.type === '退款冲回' && Number(f.delta) === -10));
assert('退款后订单账实相符', Store.orderCheck(o6.id).ok, Store.orderCheck(o6.id).reasons.join(';'));

/* 已消耗课时超过剩余可冲回课时 → 拒绝并给明确错误 */
for (let i = 0; i < 5; i++) {
  db.courses.push({
    id: 'C9-REFUND-' + i, studentId: o6student, student: Store.student(o6student).name, teacherId: 'T004',
    date: Store.db.today, start: '10:00', end: '11:00', status: '待上课', createdAt: Store.stamp()
  });
  Store.deductCourse('C9-REFUND-' + i, '张敏');
}
assert('先消耗 5 课时后余额为 5', Store.student(o6student).remain === 5, Store.student(o6student).remain);
const rf2 = Store.requestOrderRefund(o6.id, { amount: 1290, reason: '剩余款项全退' });
const exceedHours = throws(() => Store.reviewRefund(rf2.id, { pass: true }));
assert('冲回课时超过账户余额时拒绝', !!exceedHours && exceedHours.code === 'REFUND_HOURS_EXCEED' &&
  /不得为负|余额/.test(exceedHours.message), exceedHours && exceedHours.code);
assert('拒绝后账户余额不变（不为负）', Store.student(o6student).remain === 5, Store.student(o6student).remain);
Store.reviewRefund(rf2.id, { pass: false, reason: '课时已消耗，需按剩余课时重新核定' });
const rf2b = Store.requestOrderRefund(o6.id, { amount: 645, reason: '按剩余 5 课时折算退款' });
admin();
const approved2 = Store.reviewRefund(rf2b.id, { pass: true });
assert('按金额折算可退：冲回 5 课时', approved2.reversedHours === 5 && Store.student(o6student).remain === 0,
  approved2.reversedHours + '/' + Store.student(o6student).remain);
assert('累计退款 1935 / 已收 2580', Store.order(o6.id).refundedAmount === 1935);
assert('多次退款后账实相符', Store.orderCheck(o6.id).ok, Store.orderCheck(o6.id).reasons.join(';'));

/* ============================================================ */
section('8. 身份缺失不自动借用其他代理身份');
Store.setSession({ role: 'agent', agentId: '', operatorName: '无身份代理' });
const defaultId = Store.defaultAgentId();
assert('身份缺失时 currentAgentId 返回空', Store.currentAgentId() === '', 'actual=' + Store.currentAgentId());
assert('不再借用第一位启用代理', Store.currentAgentId() !== defaultId, defaultId);
const noCtx = throws(() => Store.agentCustomers());
assert('代理数据接口明确报错而不是串号', !!noCtx && noCtx.code === 'NO_AGENT_CONTEXT', noCtx && noCtx.code + ' ' + (noCtx && noCtx.message));
const noCreate = throws(() => Store.createLead({ name: '测试', phone: '13900000001', kidName: '测试' }));
assert('线索创建同样阻断', !!noCreate && noCreate.code === 'NO_AGENT_CONTEXT', noCreate && noCreate.code);
ls.setItem('ee_proto_demo', '1');
assert('显式演示模式才允许回落到演示代理', Store.currentAgentId() === defaultId, 'actual=' + Store.currentAgentId());
ls.removeItem('ee_proto_demo');
Store.setSession({ role: 'agent', agentId: '', operatorName: '无身份代理' });
assert('关闭演示模式后恢复为空的严格身份', Store.currentAgentId() === '');

/* 代理只能读自己归属的订单 */
asAgent('A002');
const own = Store.orderRows();
assert('A002 订单列表只含自己归属订单', own.length > 0 && own.every(o => o.order.agentId === 'A002'), 'count=' + own.length);
const otherOrder = own.filter(o => o.order.agentId !== 'A002')[0];
assert('代理订单列表不能越权读到他人订单', !otherOrder, 'leak=' + (otherOrder && otherOrder.order.id));
asAgent('A001');
const forbiddenOrder = throws(() => Store.orderView(res3.order.id));
assert('orderView 对非本人订单抛 FORBIDDEN', !!forbiddenOrder && forbiddenOrder.code === 'FORBIDDEN', forbiddenOrder && forbiddenOrder.code);

console.log('\n第九轮加固验收通过：' + n + ' 项断言');
ok.forEach(function (l) { console.log(l); });
