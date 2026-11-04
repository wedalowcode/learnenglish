/** 第十轮代理端改造 · 数据层验收
 *  - 工作台四入口统计（今日必跟/逾期/待提交订单/待确认收款）正确
 *  - 结构化跟进保存与回读、线索等级/下次动作同步
 *  - 订单状态时间轴派生与驳回/取消原因
 *  - 代理数据隔离（只能自身客户/订单）；批量报备与重复检测
 *  运行：node _test/r12-agent-workbench.js
 */
const vm = require('node:vm'), fs = require('fs');
const mem = {};
const LS = { getItem: k => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); }, removeItem: k => { delete mem[k]; } };
const ctx = { console, localStorage: LS, sessionStorage: LS, Date, Math, JSON, Object, Array, String, Number, setTimeout };
ctx.globalThis = ctx; ctx.window = ctx; vm.createContext(ctx);
['assets/js/data.js', 'assets/js/store.js'].forEach(f => vm.runInContext(fs.readFileSync(f, 'utf8'), ctx, { filename: f }));
const S = ctx.Store;
let pass = 0, fail = 0;
function ok(n, c, x) { if (c) { pass++; console.log('  PASS ' + n + (x !== undefined ? '  (' + x + ')' : '')); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? '  (' + x + ')' : '')); } }
function throws(n, fn, sub) { try { fn(); fail++; console.log('  FAIL ' + n + '  — 未抛错'); } catch (e) { const m = String((e && e.message) || e); if (!sub || m.indexOf(sub) >= 0) { pass++; console.log('  PASS ' + n + '  (' + m + ')'); } else { fail++; console.log('  FAIL ' + n + '  — 错误不符:' + m); } } }
function roleA(a) { S.setSession({ role: 'agent', agentId: a.id, operatorId: a.id, operatorName: a.name }); }
const d10 = t => String(t || '').slice(0, 10);
const TERM = [S.LEAD.DEAL, S.LEAD.INVALID, S.LEAD.CLOSED];

console.log('\n== 第十轮代理端 · 数据层验收 ==');
const agents = S.db.agents || [];
const A = agents[0], B = agents.find(a => a.id !== (A || {}).id);
roleA(A);

/* ---- 1. 工作台四入口统计 ---- */
const rows = S.agentCustomers();
const expToday = rows.filter(r => r.nextFollowAt && d10(r.nextFollowAt) === S.TODAY && TERM.indexOf(r.status) < 0).length;
const expOverdue = rows.filter(r => r.nextFollowAt && d10(r.nextFollowAt) < S.TODAY && TERM.indexOf(r.status) < 0).length;
const expIntent = rows.filter(r => r.status === S.LEAD.INTENT && !r.orderCount).length;
const expPay = (S.db.orders || []).filter(o => o.agentId === A.id && o.status === S.ORDER.REVIEWED).length;
const wb = S.agentWorkbench(A.id);
ok('工作台-今日必跟统计', wb.counts.todayFollow === expToday, wb.counts.todayFollow + '/' + expToday);
ok('工作台-逾期统计', wb.counts.overdue === expOverdue, wb.counts.overdue + '/' + expOverdue);
ok('工作台-待提交订单统计', wb.counts.intentNoOrder === expIntent, wb.counts.intentNoOrder + '/' + expIntent);
ok('工作台-待确认收款统计', wb.counts.pendingPayment === expPay, wb.counts.pendingPayment + '/' + expPay);

/* ---- 2. 结构化跟进保存与回读 ---- */
const leadRow = rows.find(r => r.leadId);
ok('存在可跟进客户', !!leadRow, leadRow ? leadRow.leadId : 'none');
if (leadRow) {
  const lid = leadRow.leadId;
  S.addLeadFollowUp(lid, {
    type: '电话', content: '验收-结构化跟进', level: '高',
    concerns: ['价格', '效果'], decisionMaker: '父母', budget: '1-2万', nextAction: '试听', nextAt: S.TODAY
  });
  const v = S.agentLeadView(lid);
  const f = v.followUps.find(x => x.content.indexOf('验收-结构化跟进') >= 0);
  ok('结构化跟进已保存并可回读', !!f && f.level === '高' && f.decisionMaker === '父母' && f.budget === '1-2万' && f.nextAction === '试听', f ? JSON.stringify({ level: f.level, concerns: f.concerns, dm: f.decisionMaker, budget: f.budget, na: f.nextAction }) : 'none');
  ok('主要顾虑多选保存', !!f && Array.isArray(f.concerns) && f.concerns.indexOf('价格') >= 0 && f.concerns.indexOf('效果') >= 0);
  ok('线索等级同步', S.lead(lid).level === '高');
  ok('线索下次动作同步', S.lead(lid).nextAction === '试听');
}

/* ---- 3. 订单时间轴与驳回/取消原因 ---- */
const anyOrder = (S.db.orders || []).find(o => o.agentId === A.id);
if (anyOrder) {
  const t = S.agentOrderTimeline(anyOrder.id);
  const labels = t.timeline.map(n => n.label);
  ok('订单时间轴含 已提交/待审核/待收款/已入账', ['已提交', '待审核', '待收款', '已入账'].every(l => labels.indexOf(l) >= 0), labels.join('→'));
  ok('订单时间轴节点含 done 标记', t.timeline.every(n => typeof n.done === 'boolean'));
  if (anyOrder.status === S.ORDER.CANCELLED) {
    ok('取消/驳回原因透出', typeof t.rejectReason === 'string');
  } else {
    ok('非取消订单驳回原因为空', t.rejectReason === '');
  }
} else {
  console.log('  (代理A无订单，时间轴样例跳过)');
}
/* 构造取消订单验证驳回原因透出（不破坏原数据：临时改副本） */
if (anyOrder) {
  const copy = JSON.parse(JSON.stringify(anyOrder));
  copy.id = 'ORD-TEST-RJ'; copy.status = S.ORDER.CANCELLED; copy.cancelReason = '信息不完整，审核驳回';
  S.db.orders.push(copy);
  const t2 = S.agentOrderTimeline(copy.id);
  ok('驳回/取消原因可见', t2.rejectReason === '信息不完整，审核驳回', t2.rejectReason);
  const term = t2.timeline.find(n => n.terminal);
  ok('取消/退款为旁支终态节点', !!term, term ? term.label : 'none');
  S.db.orders.pop(); /* 复原 */
}

/* ---- 4. 代理数据隔离 ---- */
if (B) {
  const leadIdA = (rows.find(r => r.leadId) || {}).leadId;
  if (leadIdA) throws('其他代理不能查看该客户详情', () => { roleA(B); S.agentLeadView(leadIdA); }, '不在你负责');
  roleA(B);
  const ownIds = S.agentCustomers().map(r => r.leadId);
  ok('其他代理客户列表不含A的客户', !!leadIdA && ownIds.indexOf(leadIdA) < 0, leadIdA || 'none');
  if (anyOrder) throws('其他代理不能查看该订单时间轴', () => S.agentOrderTimeline(anyOrder.id), '不属于');
}

/* ---- 5. 批量报备与重复检测 ---- */
roleA(A);
const uniqPhone = '139' + String(10000000 + (Math.floor(Math.random() * 89999999))).slice(-8);
const lead1 = S.createLead({ name: '验收批量甲', phone: uniqPhone, grade: '三年级', channel: '地推' });
ok('批量报备可创建线索', !!lead1 && lead1.id, lead1 && lead1.id);
throws('重复手机号被拦截', () => S.createLead({ name: '验收批量乙', phone: uniqPhone, grade: '三年级', channel: '地推' }), '已有未关闭');

console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败');
process.exit(fail ? 1 : 0);