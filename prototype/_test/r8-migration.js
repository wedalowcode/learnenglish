/* v7 → v8 / v6 → v8 迁移验收：搬运、永不删除旧 key、失败保留备份并提示 */
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
  store.window = store; store.globalThis = store; store.console = console;
  const ctx = vm.createContext(store);
  const dir = path.join(__dirname, '..', 'assets', 'js');
  vm.runInContext(fs.readFileSync(path.join(dir, 'data.js'), 'utf8'), ctx, { filename: 'data.js' });
  vm.runInContext(fs.readFileSync(path.join(dir, 'store.js'), 'utf8'), ctx, { filename: 'store.js' });
  return { Store: ctx.Store, ctx, ls: store.localStorage };
}
let n = 0;
function assert(name, cond, detail) {
  n++;
  if (!cond) throw new Error('断言失败：' + name + (detail ? ' → ' + detail : ''));
  console.log('  ✓ ' + name + (detail ? '（' + detail + '）' : ''));
}
function buildV7() {
  const seedBoot = boot();
  const d = seedBoot.Store.db;
  return {
    version: 7,
    words: d.words,
    teachers: d.teachers,
    students: [{ id: 'S2026901', name: '迁移学员甲', grade: '七年级', teacher: '', teacherName: '未分配', remain: 0, status: '在读', parent: 'P001', createdAt: '2026-01-01 09:00' }].concat(d.students.slice(0, 2)),
    parents: d.parents,
    accounts: d.accounts,
    flows: d.flows,
    wordbooks: d.wordbooks, wordbookWords: d.wordbookWords,
    courses: d.courses, courseRecords: d.courseRecords, reports: d.reports,
    teacherStudents: d.teacherStudents,
    meta: { seq: {} }
  };
}

console.log('\n1. v7 → v8 正常迁移');
const v7 = buildV7();
const r1 = boot({ ee_proto_store_v7: JSON.stringify(v7) });
assert('版本升级为 8', r1.Store.db.version === 8, 'version=' + r1.Store.db.version);
const mi = r1.Store.migrationInfo();
assert('迁移结果写入 meta', !!mi && mi.ok === true, JSON.stringify(mi && mi.from));
assert('迁移来源 v7', mi.from === 'v7' && mi.to === 'v8');
assert('历史学员被搬运', r1.Store.db.students.some(s => s.id === 'S2026901'));
assert('历史词库/课程被搬运', r1.Store.db.words.length === v7.words.length && r1.Store.db.courses.length === v7.courses.length);
assert('新增表用种子补齐（代理 4 个）', r1.Store.db.agents.length === 4, 'agents=' + r1.Store.db.agents.length);
assert('新增表线索已补齐', r1.Store.db.leads.length > 0, 'leads=' + r1.Store.db.leads.length);
const ls1 = r1.ls._dump();
assert('永不删除 v7 旧 key', typeof ls1.ee_proto_store_v7 === 'string' && ls1.ee_proto_store_v7.length > 0);
assert('写入 v8 新 key', typeof ls1.ee_proto_store_v8 === 'string' && ls1.ee_proto_store_v8.length > 0);
assert('旧 key 内容未被修改', ls1.ee_proto_store_v7 === JSON.stringify(v7));
assert('迁移后仍无凭空课时', r1.Store.db.students.every(s => s.remain === 0 || r1.Store.db.accounts.some(a => a.studentId === s.id || a.student === s.name)));

console.log('\n2. v7 数据损坏：保留备份并明确提示');
const r2 = boot({ ee_proto_store_v7: '{bad json' });
assert('损坏时仍以 v8 种子启动', r2.Store.db.version === 8);
const mi2 = r2.Store.migrationInfo();
assert('记录迁移失败原因', !!mi2 && mi2.ok === false, mi2 && mi2.reason);
assert('说明演示数据已重置', /重置/.test(mi2.strategy), mi2.strategy);
assert('损坏的 v7 原始串仍保留', r2.ls._dump().ee_proto_store_v7 === '{bad json');
assert('种子态可用（代理存在）', r2.Store.db.agents.length === 4);

console.log('\n3. v6 → v8 兼容旧迁移');
const v6 = buildV7(); v6.version = 6; delete v6.agents;
const r3 = boot({ ee_proto_store_v6: JSON.stringify(v6) });
assert('v6 也能升级到 v8', r3.Store.db.version === 8);
const mi3 = r3.Store.migrationInfo();
assert('迁移来源记录为 v6', !!mi3 && mi3.from === 'v6' && mi3.to === 'v8');
assert('v6 旧 key 保留', typeof r3.ls._dump().ee_proto_store_v6 === 'string');
assert('v6 历史学员被搬运', r3.Store.db.students.some(s => s.id === 'S2026901'));

console.log('\n迁移验收通过：' + n + ' 项断言');
