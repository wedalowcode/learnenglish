/* 第十轮验收：统一角色切换组件（列表化切换身份）
   覆盖：角色账号可用性 / 会话身份写入与跨页持久化 / 四条切换路径 /
        菜单与数据投影 / 禁用账号不静默借用 / 切换不清业务数据。
   浏览器不可用时，直接加载 common.js + store.js 校验身份与投影。 */
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

function boot(lsSeed, ssSeed) {
  const store = {};
  store.localStorage = makeStore(lsSeed || {});
  store.sessionStorage = makeStore(ssSeed || {});
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
  return {
    Store: ctx.Store, Proto: ctx.__Proto, ctx,
    ls: store.localStorage, ss: store.sessionStorage,
    lsDump: () => store.localStorage._dump()
  };
}

let n = 0;
const ok = [];
function assert(name, cond, detail) {
  n++;
  if (!cond) throw new Error('断言失败：' + name + (detail ? ' → ' + detail : ''));
  ok.push('  ✓ ' + name + (detail ? '（' + detail + '）' : ''));
}
function section(t) { console.log('\n' + t); }
function leadIdsOfAgent(Store, agentId) {
  return Store.db.leads.filter(l => l.currentAgentId === agentId).map(l => l.id).sort();
}

section('1. 角色账号清单：多账号可选、不可用账号置灰并说明原因');
let app = boot();
let Store = app.Store;
let Proto = app.Proto;

const teacherAccounts = Proto.roleAccounts('teacher');
const agentAccounts = Proto.roleAccounts('agent');
const parentAccounts = Proto.roleAccounts('parent');
const adminAccounts = Proto.roleAccounts('admin');

assert('教师角色有多个账号', teacherAccounts.length >= 4, 'count=' + teacherAccounts.length);
assert('教师 T004 可用', teacherAccounts.filter(a => a.id === 'T004')[0].available === true);
assert('教师 T006 置灰并说明原因',
  teacherAccounts.filter(a => a.id === 'T006')[0].available === false &&
  /账号|合作状态/.test(teacherAccounts.filter(a => a.id === 'T006')[0].reason),
  teacherAccounts.filter(a => a.id === 'T006')[0].reason);
assert('代理角色有多个账号', agentAccounts.length >= 2, 'count=' + agentAccounts.length);
assert('代理 A001 可用', agentAccounts.filter(a => a.id === 'A001')[0].available === true);
assert('停用代理 A004 置灰',
  agentAccounts.filter(a => a.id === 'A004')[0].available === false,
  agentAccounts.filter(a => a.id === 'A004')[0].reason);
assert('家长角色有多个账号', parentAccounts.length >= 2, 'count=' + parentAccounts.length);
assert('家长 P004 可用', parentAccounts.filter(a => a.id === 'P004')[0].available === true);
assert('停用家长 P005 置灰',
  parentAccounts.filter(a => a.id === 'P005')[0].available === false,
  parentAccounts.filter(a => a.id === 'P005')[0].reason);
assert('内部角色为单账号身份', adminAccounts.length === 1 && adminAccounts[0].available === true,
  adminAccounts[0].name);

section('2. 四条切换路径：admin → 教师 T004 → 代理 A001 → 家长 P004');
const studentsBefore = Store.db.students.length;
const ordersBefore = Store.db.orders.length;
const leadsBefore = Store.db.leads.length;

Store.setSession({ role: 'admin', operatorName: '张敏', operatorId: '张敏' });
assert('管理端身份来自会话', Proto.roleIdentity('admin').name === '张敏', Proto.roleIdentity('admin').name);

Proto.switchRole('teacher', 'T004');
assert('教师身份写入会话', Store.currentSession().role === 'teacher' && Store.currentSession().teacherId === 'T004');
assert('切换教师后写入操作人', Store.currentSession().operatorName === '沈心怡', Store.currentSession().operatorName);
assert('切换教师跳转到教师工作台', app.ctx.location.href === '../teacher/workbench.html', app.ctx.location.href);

/* 模拟跨页：用同一份 localStorage 重新启动，会话应被还原 */
app = boot(app.lsDump());
Store = app.Store; Proto = app.Proto;
assert('教师身份跨页持久化', Store.currentSession().role === 'teacher' && Store.currentSession().teacherId === 'T004');
assert('顶栏身份同步为 T004', Proto.roleIdentity('teacher').name === '沈心怡' && Proto.roleIdentity('teacher').code === 'T004',
  Proto.roleIdentity('teacher').name + '/' + Proto.roleIdentity('teacher').code);
assert('未显式选择时页面默认角色不被覆盖', Proto.pageRole('staff') === 'teacher', Proto.pageRole('staff'));
assert('教师菜单不含管理端线索入口',
  !Proto.MENUS.teacher.some(g => g.items.some(i => i.href.indexOf('admin/lead-list') >= 0)));
assert('管理端菜单仍有线索入口',
  Proto.MENUS.admin.some(g => g.items.some(i => i.href.indexOf('admin/lead-list') >= 0)));
const t4Students = Store.currentStudentsOf('T004').map(x => x.student.id).sort();
const t3Students = Store.db.teacherStudents
  .filter(r => r.teacherId === 'T003' && !r.endAt)
  .map(r => r.studentId).sort();
assert('教师只看到自己的学员', t4Students.length > 0, 'count=' + t4Students.length);
assert('教师看不到其他教师的学员', t3Students.every(id => t4Students.indexOf(id) < 0));

Proto.switchRole('agent', 'A001');
assert('代理身份写入会话', Store.currentSession().role === 'agent' && Store.currentSession().agentId === 'A001');
assert('切换代理后清理教师身份', Store.currentSession().teacherId === '', Store.currentSession().teacherId);
assert('切换代理跳转到代理工作台', app.ctx.location.href === '../agent/workbench.html', app.ctx.location.href);
app = boot(app.lsDump());
Store = app.Store; Proto = app.Proto;
assert('代理身份跨页持久化', Store.currentSession().role === 'agent' && Store.currentSession().agentId === 'A001');
assert('顶栏身份同步为 A001', Proto.roleIdentity('agent').name === Store.agent('A001').name,
  Proto.roleIdentity('agent').name + '/' + Proto.roleIdentity('agent').code);
const agentRows = Store.agentCustomers();
const expectedLeads = leadIdsOfAgent(Store, 'A001');
/* 代理客户 = 当前归属自己的线索 + 成交归属自己的历史订单学员，二者都必须是 A001 的 */
const ownStudentIds = Store.db.orders.filter(o => o.agentId === 'A001').map(o => o.studentId);
const otherStudentIds = Store.db.orders.filter(o => o.agentId !== 'A001').map(o => o.studentId);
assert('代理只看到自己客户', agentRows.length > 0 && agentRows.every(r =>
  (r.leadId ? expectedLeads.indexOf(r.leadId) >= 0 : true) &&
  (r.studentId ? ownStudentIds.indexOf(r.studentId) >= 0 : true)),
  'rows=' + agentRows.length + '/leads=' + expectedLeads.length);
const otherLead = Store.db.leads.filter(l => l.currentAgentId === 'A002')[0];
assert('代理列表不含其他代理客户', otherLead && agentRows.every(r => r.leadId !== otherLead.id &&
  (r.studentId ? otherStudentIds.indexOf(r.studentId) < 0 : true)));
const agentOrders = Store.orderRows();
assert('代理订单投影只含自己订单', agentOrders.length > 0 && agentOrders.every(r => r.order.agentId === 'A001'),
  'count=' + agentOrders.length);

Proto.switchRole('parent', 'P004');
assert('家长身份写入会话', Store.currentSession().role === 'parent' && Store.currentSession().parentId === 'P004');
assert('切换家长后清理代理身份', Store.currentSession().agentId === '', Store.currentSession().agentId);
assert('切换家长跳转到家长首页', app.ctx.location.href === '../parent/home.html', app.ctx.location.href);
app = boot(app.lsDump());
Store = app.Store; Proto = app.Proto;
assert('家长身份跨页持久化', Store.currentSession().role === 'parent' && Store.currentSession().parentId === 'P004');
assert('顶栏身份同步为 P004', Proto.roleIdentity('parent').name === Store.parent('P004').name,
  Proto.roleIdentity('parent').name + '/' + Proto.roleIdentity('parent').code);
const p4Kids = Store.parentChildren('P004').map(k => k.id).sort();
const expectedKids = Store.db.students.filter(s => s.parent === 'P004').map(s => s.id).sort();
assert('家长只看到自己的孩子', p4Kids.length === expectedKids.length &&
  p4Kids.every(id => expectedKids.indexOf(id) >= 0), 'kids=' + p4Kids.join(','));
const otherKid = Store.db.students.filter(s => s.parent === 'P004' && false).map(s => s.id);
assert('家长菜单只含家长入口', Proto.MENUS.parent.every(g => g.items.every(i => i.href.indexOf('parent/') === 0)));

section('3. 身份缺失与切换边界');
const anonymous = boot();
const AStore = anonymous.Store;
AStore.setSession({ role: 'agent', agentId: '' });
assert('身份缺失时顶栏不借用其他代理', anonymous.Proto.roleIdentity('agent').name === '未识别代理身份',
  anonymous.Proto.roleIdentity('agent').name);
assert('身份缺失时页面默认角色不被伪造', anonymous.Proto.pageRole('staff') === 'staff');

app.ss.setItem('ee_proto_demo', '1');
Proto.switchRole('teacher', 'T003');
assert('显式切换会清理演示兜底标记', app.ss.getItem('ee_proto_demo') === null, String(app.ss.getItem('ee_proto_demo')));
assert('切换不清空业务数据',
  Store.db.students.length === studentsBefore &&
  Store.db.orders.length === ordersBefore &&
  Store.db.leads.length === leadsBefore,
  studentsBefore + '/' + ordersBefore + '/' + leadsBefore);

console.log('\n第十轮角色切换验收通过：' + n + ' 项断言');
console.log(ok.join('\n'));
