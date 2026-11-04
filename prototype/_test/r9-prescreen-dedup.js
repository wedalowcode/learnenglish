/** R9 阶段三-1 验收：初筛候选按基础 Word.id 去重
 *  同一基础单词存在于多个词库时，初筛列表只出现一次，sourceBooks 汇总来源。
 *  运行：node _test/r9-prescreen-dedup.js
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
function roleAdmin() {
  const u = (S.db.users || []).find(x => x.roleCode === 'admin');
  S.setSession({ role: 'admin', operatorId: u ? u.id : 'admin', operatorName: '管理员', accountId: u ? u.id : '' });
}

console.log('\n== R9 阶段三-1 · 初筛候选去重 ==');
roleAdmin();
const studentId = 'S2026001';
const b1 = 'WB001', b2 = 'WB002';
const wordsA = (S.wordsOfBook(b1) || []).map(w => w.id);
const wordsB = (S.wordsOfBook(b2) || []).map(w => w.id);
const shared = wordsA.filter(id => wordsB.indexOf(id) >= 0);
ok('存在双词库共享单词', shared.length > 0, shared.join(','));
if (!shared.length) { console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败'); process.exit(fail ? 1 : 0); }

const created = S.createTrainTask({ studentId, targetCount: 45 });
const tid = created.task.id;
const add = S.addWordbooksToTask(tid, [b1, b2]);
ok('同时添加两个词库', add.added.length === 2, add.added.map(x => x.id).join(','));

/* 全部词库（all=true）的初筛候选 */
const cands = S.prescreenCandidates(tid, { all: true });
const ids = cands.map(c => c.id);
/* 总候选 = 去重后的不重复单词数 */
const uniqTotal = new Set(wordsA.concat(wordsB)).size;
ok('候选数 = 去重后的单词总数', ids.length === uniqTotal, ids.length + '/' + uniqTotal);
/* 每个共享单词只出现一次 */
ok('共享单词只出现一次', shared.every(w => ids.filter(x => x === w).length === 1), shared.join(','));
/* sourceBooks 汇总了来源词库（含 b1 与 b2） */
const sh = shared.map(w => cands.find(c => c.id === w));
ok('共享词 sourceBooks 含两个词库', sh.every(c => c.sourceBooks.some(sb => sb.id === b1) && c.sourceBooks.some(sb => sb.id === b2)));
/* 非共享单词 sourceBooks 单一来源 */
const solo = cands.filter(c => shared.indexOf(c.id) < 0);
ok('非共享词 sourceBooks 单来源', solo.every(c => c.sourceBooks.length === 1), 'solo=' + solo.length);

console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败');
process.exit(fail ? 1 : 0);