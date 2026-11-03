/* 页面调用冒烟：模拟各页面实际使用的 Store 投影，确认不抛错且字段可用 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
function makeLS() { const m = {}; return { getItem: k => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, removeItem: k => { delete m[k]; } }; }
const store = { localStorage: makeLS(), console }; store.window = store; store.globalThis = store;
const ctx = vm.createContext(store);
const dir = path.join(__dirname, '..', 'assets', 'js');
vm.runInContext(fs.readFileSync(path.join(dir, 'data.js'), 'utf8'), ctx, { filename: 'data.js' });
vm.runInContext(fs.readFileSync(path.join(dir, 'store.js'), 'utf8'), ctx, { filename: 'store.js' });
const S = ctx.Store;
let n = 0;
function ok(name, cond, detail) { n++; if (!cond) throw new Error('FAIL ' + name + (detail ? ' ' + detail : '')); console.log('  ✓ ' + name + (detail ? '（' + detail + '）' : '')); }

/* 代理工作台/客户列表 */
S.setSession({ role: 'agent', agentId: 'A001', operatorName: '王磊' });
const ov = S.agentOverview('A001');
ok('agentOverview 字段', typeof ov.customers === 'number' && typeof ov.deals === 'number' && typeof ov.amount === 'number', `customers=${ov.customers}`);
const cust = S.agentCustomers();
ok('agentCustomers 非空', cust.length > 0, 'rows=' + cust.length);
ok('客户行字段', !!cust[0].leadId && !!cust[0].customerName && 'remain' in cust[0], 'first=' + cust[0].leadId);
const rn = S.agentRenewals('A001');
ok('agentRenewals 可用', Array.isArray(rn), 'rows=' + rn.length);
if (rn[0]) ok('续费行字段', !!rn[0].studentName && !!rn[0].renewal.status && typeof rn[0].teacherName === 'string');
const c = cust.find(x => x.converted && x.leadId);
if (c) {
  const V = S.agentLeadView(c.leadId);
  ok('agentLeadView 反馈投影', Array.isArray(V.feedbacks) && Array.isArray(V.orders) && !!V.student, 'feedbacks=' + V.feedbacks.length);
  if (V.feedbacks[0]) ok('反馈字段完整', !!V.feedbacks[0].title && !!V.feedbacks[0].teacherName && !!V.feedbacks[0].performance);
}

/* 管理端 */
S.setSession({ role: 'admin', operatorName: '张敏' });
const rows = S.leads({ kw: '' });
ok('leads 行字段', rows.length > 0 && !!rows[0].lead && typeof rows[0].orders === 'number', 'rows=' + rows.length);
const counts = S.leadRowCounts();
ok('leadRowCounts', Object.keys(counts).length >= 7);
const agRows = S.agentsOf();
ok('agentsOf 字段', agRows.length > 0 && !!agRows[0].agent && typeof agRows[0].amount === 'number', 'rows=' + agRows.length);
ok('佣金预估字段', !!agRows[0].commission && typeof agRows[0].commission.estimatedCommission === 'number');
const oRows = S.orderRows({});
ok('orderRows 字段', oRows.length > 0 && !!oRows[0].order && !!oRows[0].studentName, 'rows=' + oRows.length);
const anyOrder = oRows[0].order.id;
const OV = S.orderView(anyOrder);
ok('orderView 收款/日志', Array.isArray(OV.payments) && Array.isArray(OV.logs));
const ck = S.orderCheck(anyOrder);
ok('orderCheck 返回结构', typeof ck.ok === 'boolean' && Array.isArray(ck.reasons) && typeof ck.flowHours === 'number');
S.products().forEach(p => { if (!p.id || !p.name) throw new Error('product field missing'); });
ok('products 可用', true, 'count=' + S.products().length);
const renewAll = S.renewals();
ok('renewals 可用', Array.isArray(renewAll), 'rows=' + renewAll.length);

/* 家长端 */
S.setSession({ role: 'parent', parentId: '' });
const pid = S.defaultParentId();
S.setSession({ role: 'parent', parentId: pid, operatorName: S.parent(pid).name });
const PV = S.parentView();
ok('parentView 投影', !!PV.parent && Array.isArray(PV.children) && Array.isArray(PV.orders), 'kids=' + PV.children.length);
ok('家长策略不含内部流水', PV.policy && PV.policy.canSeeInternalFlows === false);
const K = PV.children[0];
if (K) ok('孩子字段', !!K.name && typeof K.remain === 'number' && !!K.teacherName, 'kid=' + K.id);
const H = S.parentHours();
ok('parentHours 账户', Array.isArray(H) && H.every(x => Array.isArray(x.accounts)));
const C = S.parentChildren();
ok('parentChildren 可用', C.length > 0, 'kids=' + C.length);

console.log('\n页面调用冒烟通过：' + n + ' 项');
