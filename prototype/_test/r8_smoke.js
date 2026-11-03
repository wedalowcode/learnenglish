const fs = require('fs');
const path = require('path');
const vm = require('vm');

function makeLS(initial) {
  const m = Object.assign({}, initial || {});
  return {
    getItem: k => (k in m ? m[k] : null),
    setItem: (k, v) => { m[k] = String(v); },
    removeItem: k => { delete m[k]; },
    clear: () => { Object.keys(m).forEach(k => delete m[k]); },
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

const { Store } = boot();
Store.setSession({ role: 'admin', operatorName: '张敏' });
const db = Store.db;
console.log('version', db.version);
console.log('agents', db.agents.length, db.agents.map(a => a.id + ':' + a.status).join(','));
console.log('products', db.products.length, db.products.map(p => p.id + ':' + p.hours + '+' + p.gift + '/¥' + p.amount).join(' | '));
const lc = Store.leadRowCounts ? Store.leadRowCounts() : {};
console.log('leads', db.leads.length, JSON.stringify(lc));
console.log('followUps', db.leadFollowUps.length, 'leadLogs', db.leadLogs.length);
console.log('orders', db.orders.length, db.orders.map(o => o.id + ':' + o.status + ':' + o.totalHours + ':agent=' + (o.agentId || '-')).join(' | '));
console.log('payments', db.payments.length);
console.log('accounts', db.accounts.length, 'flows', db.flows.length);
console.log('renewals', db.renewalOpportunities.length, db.renewalOpportunities.map(r => r.id + ':' + r.studentId + ':' + r.sourceType + ':' + r.agentId).join(' | '));
console.log('feedbacks', db.learningFeedbacks.length);
const phantom = db.students.filter(s => s.remain > 0 && !db.accounts.some(a => a.studentId === s.id || a.student === s.name));
console.log('phantom students', phantom.map(s => s.id + ':' + s.name + ':' + s.remain).join(' | ') || 'none');
const check = db.orders.filter(o => o.status === '已入账').map(o => ({ o: o.id, ok: Store.orderCheck(o.id).ok, reasons: Store.orderCheck(o.id).reasons }));
console.log('orderCheck', JSON.stringify(check));
console.log('agent customers A001', Store.agentCustomers({ agentId: 'A001' }).map(r => r.customerName + '/' + r.status + '/fb=' + r.feedbackCount).join(' | '));
console.log('A001 feedbacks', Store.agentFeedbacks('A001').length, 'A003', Store.agentFeedbacks('A003').length);
console.log('parentView P001', JSON.stringify(Store.parentView('P001'), null, 2).slice(0, 500));
