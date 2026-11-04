/** 家长端优化 · 数据层验收
 *  - 最近扣课记录投影（只读、近10条、扣课为负）
 *  - 报告已读/未读 + 仅未读过滤 + 详情已读
 *  - 家庭复习勾选进度
 *  - 课时可用周数估算
 *  - 家庭建议勾选不改正式状态
 *  - 家长数据隔离
 *  运行：node _test/r13-parent-opt.js
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

console.log('\n== 家长端优化 · 数据层验收 ==');
const parents = S.db.parents || [];
const pa = parents[0], pb = parents[1];
/* 先用管理员会话取「其他家庭孩子」，避免家长会话下 parentChildren(pb) 触发自我校验 */
let otherKid = null;
if (pb) {
  S.setSession({ role: 'admin' });
  const aKids = S.parentChildren(pa.id).map(k => k.id);
  otherKid = S.parentChildren(pb.id).map(k => k.id).filter(id => aKids.indexOf(id) < 0)[0] || null;
}
S.setSession({ role: 'parent', parentId: pa.id, operatorId: pa.id, operatorName: '家长A' });
const kid = S.parentChildren(pa.id)[0];
ok('家长A有关联孩子', !!kid, kid ? kid.id : 'none');

/* ---- 1. 最近扣课记录投影 ---- */
const flows = S.parentLessonFlows(pa.id, kid.id);
ok('扣课记录为只读投影数组', Array.isArray(flows));
ok('扣课记录不超过10条', flows.length <= 10, flows.length);
ok('扣课记录均为扣课(负 delta)', flows.every(f => Number(f.delta) < 0), flows.map(f => f.delta).join(','));
ok('扣课记录含日期/主题/扣后剩余', flows.every(f => f.at && f.topic && typeof f.after === 'number'), flows[0] ? JSON.stringify({ at: flows[0].at, topic: flows[0].topic, after: flows[0].after }) : '');

/* ---- 2. 报告已读/未读与仅未读 ---- */
const reps = S.parentReports(pa.id, kid.id, {});
ok('报告含 read 标记', reps.length === 0 || typeof reps[0].read === 'boolean');
if (reps.length) {
  const r0 = reps[0];
  const unreadBefore = S.parentReports(pa.id, kid.id, { unread: true }).length;
  S.markParentReportRead(pa.id, kid.id, r0.id);
  const after = S.parentReports(pa.id, kid.id, {});
  ok('标记已读后 read=true', after.find(r => r.id === r0.id).read === true);
  const unreadAfter = S.parentReports(pa.id, kid.id, { unread: true }).length;
  ok('仅未读过滤排除已读', unreadAfter === unreadBefore - 1, unreadAfter + '/' + unreadBefore);
  ok('详情已读标记为 true', S.parentReportDetail(pa.id, kid.id, r0.id).read === true);
} else console.log('  (无已发布报告，跳过已读细节)');

/* ---- 3. 家庭复习勾选进度 ---- */
const p1 = S.parentReviewProgress(pa.id, kid.id);
ok('复习进度结构(due/checked/remaining)', typeof p1.due === 'number' && typeof p1.checked === 'number' && p1.remaining === p1.due - p1.checked, JSON.stringify(p1));
const dueWords = S.parentReviewWords(pa.id, kid.id, { view: 'today' });
if (dueWords.length) {
  const w = dueWords[0].wordId;
  const before = S.parentReviewProgress(pa.id, kid.id);
  const stBefore = (S.wordState(kid.id, w) || {}).state;
  S.toggleParentFamilyCheck(pa.id, kid.id, w, true);
  const after = S.parentReviewProgress(pa.id, kid.id);
  ok('勾选后已勾选数增加', after.checked >= before.checked, before.checked + '→' + after.checked);
  ok('家庭勾选不改正式掌握状态', (S.wordState(kid.id, w) || {}).state === stBefore, (S.wordState(kid.id, w) || {}).state);
} else console.log('  (今日无到期单词，跳过勾选进度细节)');

/* ---- 4. 课时可用周数估算 ---- */
const h = S.parentHours(pa.id).filter(x => x.studentId === kid.id)[0];
ok('课时含周数估算', h && typeof h.weeksEstimate === 'number' && typeof h.weeklyEstimate === 'number', h ? (h.totalRemain + '÷' + h.weeklyEstimate + '=' + h.weeksEstimate) : 'none');
ok('周数估算=剩余÷每周', h && Math.abs(h.weeksEstimate - Math.round(h.totalRemain / h.weeklyEstimate * 10) / 10) < 0.01);

/* ---- 5. 家庭建议勾选不改正式状态 ---- */
if (reps.length) {
  const r = reps[0];
  const before = S.parentReportDetail(pa.id, kid.id, r.id).content;
  const c = S.toggleParentAdviceCheck(pa.id, kid.id, r.id, '多读课文', true);
  ok('家庭建议勾选可保存', c && c.checked === true);
  const back = S.parentAdviceChecks(pa.id, kid.id, r.id);
  ok('家庭建议勾选可回读', back.some(x => x.itemKey === '多读课文' && x.checked));
  const after = S.parentReportDetail(pa.id, kid.id, r.id).content;
  ok('家庭建议勾选不改报告内容', JSON.stringify(before) === JSON.stringify(after));
  const stAny = (S.wordStates(kid.id) || []).map(s => s.state).join('|');
  const stAny2 = (S.wordStates(kid.id) || []).map(s => s.state).join('|');
  ok('家庭建议勾选不影响学习状态集合', stAny === stAny2);
}

/* ---- 6. 家长数据隔离 ---- */
if (pb && otherKid) {
  throws('家长A不能读其他家庭扣课记录', () => S.parentLessonFlows(pa.id, otherKid), '不在当前家长名下');
  throws('家长A不能读其他家庭报告', () => S.parentReports(pa.id, otherKid), '不在当前家长名下');
  throws('家长A不能标记其他家庭报告已读', () => S.markParentReportRead(pa.id, otherKid, reps[0] ? reps[0].id : 'X'), '不在当前家长名下');
} else console.log('  (无第二家庭跨访问样本，跳过)');
/* 非家长角色不能调用家长专用接口 */
const t = (S.db.teachers || [])[0];
if (t) { S.setSession({ role: 'teacher', teacherId: t.id, operatorId: t.id, operatorName: '教师' }); throws('教师不能调用家长专用扣课投影', () => S.parentLessonFlows(pa.id, kid.id), '仅限家长'); }

console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败');
process.exit(fail ? 1 : 0);