/* 校验改造后的页面只调用 Store 已导出的成员，避免页面运行时报 undefined */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
function makeLS() {
  const m = {};
  return { getItem: k => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, removeItem: k => { delete m[k]; } };
}
const store = { localStorage: makeLS(), console };
store.window = store; store.globalThis = store;
const ctx = vm.createContext(store);
const dir = path.join(__dirname, '..', 'assets', 'js');
vm.runInContext(fs.readFileSync(path.join(dir, 'data.js'), 'utf8'), ctx, { filename: 'data.js' });
vm.runInContext(fs.readFileSync(path.join(dir, 'store.js'), 'utf8'), ctx, { filename: 'store.js' });
const S = ctx.Store;

const files = [
  'agent/workbench.html', 'agent/my-customers.html', 'agent/customer-create.html',
  'agent/customer-detail.html', 'agent/commission.html', 'agent/renewal-list.html',
  'admin/lead-list.html', 'admin/lead-detail.html', 'admin/agent-list.html',
  'admin/order-list.html', 'admin/order-detail.html', 'admin/renewal-list.html',
  'parent/home.html', 'parent/hours.html', 'parent/course-records.html', 'parent/report.html'
];
let missing = [];
for (const f of files) {
  const html = fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
  const ids = new Set();
  for (const m of html.matchAll(/\bS\.([A-Za-z_$][\w$]*)/g)) ids.add(m[1]);
  for (const id of ids) {
    if (typeof S[id] === 'undefined') missing.push(f + ' -> Store.' + id);
  }
}
if (missing.length) { console.log('MISSING:\n' + missing.join('\n')); process.exit(1); }
console.log('ALL STORE MEMBERS OK');
