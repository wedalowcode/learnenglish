/** P10 家长端数据安全与权限修复（P0）验收测试
 *  加载 data.js + store.js，按 PRD 用例 A~E + 咨询落库逐项断言。
 *  运行：node _test/p10-parent-security.js
 *  期望：全部 PASS，exit 0。
 */
const vm = require('node:vm'), fs = require('fs'), path = require('path');
const T = __dirname;
const mem = {};
const LS = { getItem: k => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); }, removeItem: k => { delete mem[k]; } };
const ctx = { console, localStorage: LS, sessionStorage: LS, Date, Math, JSON, Object, Array, String, Number, setTimeout };
ctx.globalThis = ctx; ctx.window = ctx; vm.createContext(ctx);
['../assets/js/data.js', '../assets/js/store.js'].forEach(f => vm.runInContext(fs.readFileSync(path.join(T, f), 'utf8'), ctx, { filename: f }));
const S = ctx.Store;
let pass = 0, fail = 0;
function ok(n, c, x) { if (c) { pass++; console.log('  PASS ' + n + (x ? '  (' + x + ')' : '')); } else { fail++; console.log('  FAIL ' + n + (x ? '  (' + x + ')' : '')); } }
function throws(n, fn, sub) { try { fn(); fail++; console.log('  FAIL ' + n + '  — 未抛错'); } catch (e) { const m = String((e && e.message) || e); if (!sub || m.indexOf(sub) >= 0) { pass++; console.log('  PASS ' + n + '  (' + m + ')'); } else { fail++; console.log('  FAIL ' + n + '  — 错误不符:' + m); } } }
function role(r, id) {
  const s = { role: r };
  if (r === 'parent') { s.parentId = id; s.operatorId = id; s.operatorName = '家长'; }
  if (r === 'teacher') { s.teacherId = id; s.operatorId = id; s.operatorName = '教师'; }
  if (r === 'admin') { const u = (S.db.users || []).find(x => x.roleCode === 'admin' && x.status === '正常') || (S.db.users || []).find(x => x.roleCode === 'admin'); s.accountId = u ? u.id : ''; s.operatorId = s.accountId || 'admin'; s.operatorName = '管理员'; }
  S.setSession(s);
}

console.log('\n== P0 家长端数据安全与权限修复 ==');
const parents = S.db.parents;
const pa = parents[0], pb = parents[1];
ok('存在≥2家长', parents.length >= 2);
const kidA = S.parentChildren(pa.id)[0];
const kidA2 = S.parentChildren(pa.id)[1];
const kidB = S.parentChildren(pb.id)[0];
ok('家长A有孩子', !!kidA);
ok('家长A有≥2孩子(切换场景)', !!kidA2);
ok('家长B有孩子(供越权)', !!kidB);
ok('A/B孩子不同', kidA.id !== kidB.id);

role('parent', pa.id);
{
  const list = S.parentChildren(pa.id);
  ok('用例A-孩子列表仅本人孩子', list.every(k => k.id === kidA.id || k.id === kidA2.id), '共' + list.length);
  throws('用例A-学员详情越权', () => S.parentStudentDetail(pa.id, kidB.id), '不在当前家长名下');
  throws('用例A-课程越权', () => S.parentCourses(pa.id, kidB.id), '不在当前家长名下');
  throws('用例A-报告越权', () => S.parentReports(pa.id, kidB.id), '不在当前家长名下');
  throws('用例A-复习越权', () => S.parentReviewWords(pa.id, kidB.id), '不在当前家长名下');
  role('teacher', 'T001');
  throws('用例A-非家长角色被拒', () => S.parentReviewWords(pa.id, kidA.id), '仅限家长');
  role('parent', pa.id);
}
{
  const rows = S.parentReviewWords(pa.id, kidA.id, { view: 'all' });
  const today = S.parentReviewWords(pa.id, kidA.id, { view: 'today' });
  console.log('  全部待复习=' + rows.length + '，今日到期=' + today.length);
  ok('用例B-今日行均 dueToday', today.every(r => r.dueToday));
  ok('用例B-今日≤全部', today.length <= rows.length);
  throws('用例B-其他孩子复习被拒', () => S.parentReviewWords(pa.id, kidB.id), '不在当前家长名下');
  throws('用例B-提交其他孩子wordId被拒', () => S.toggleParentFamilyCheck(pa.id, kidB.id, 'W1', true), '不在当前家长名下');
}
{
  const today = S.parentReviewWords(pa.id, kidA.id, { view: 'today' });
  const all = S.parentReviewWords(pa.id, kidA.id, { view: 'all' });
  const pool = today.length ? today : all;
  if (pool.length) {
    const w = pool[0].wordId;
    const rec = S.toggleParentFamilyCheck(pa.id, kidA.id, w, true);
    ok('用例C-studentId正确', rec.studentId === kidA.id, rec.studentId);
    ok('用例C-wordId正确', rec.wordId === w, rec.wordId);
    ok('用例C-parentId正确', rec.parentId === pa.id, rec.parentId);
    ok('用例C-记录by', typeof rec.by === 'string' && rec.by.length > 0, rec.by);
    ok('用例C-当天记录可见', S.parentFamilyChecks(pa.id, kidA.id).some(c => c.wordId === w && c.checked));
    ok('用例C-取消勾选', S.toggleParentFamilyCheck(pa.id, kidA.id, w, false).checked === false);
  } else console.log('  (无待复习数据，跳过勾选细节)');
  throws('用例C-改他人记录被拒', () => S.toggleParentFamilyCheck(pa.id, kidB.id, 'W1', true), '不在当前家长名下');
}
{
  role('admin');
  const tid = S.db.teachers[0].id;
  const base = { studentId: kidA.id, teacherId: tid, title: 'T', performance: '表现良好', weak: '', next: '', homeworkAdvice: '回家读三遍' };
  const f1 = S.createLearningFeedback(Object.assign({}, base, { publish: true, visibleToParent: true, visibleToAgent: true }));
  const f2 = S.createLearningFeedback(Object.assign({}, base, { publish: true, visibleToParent: false, visibleToAgent: true }));
  const f3 = S.createLearningFeedback(Object.assign({}, base, { publish: false }));
  const f4 = S.createLearningFeedback(Object.assign({}, base, { publish: true, visibleToParent: true, visibleToAgent: false }));
  role('parent', pa.id);
  const pf = S.parentFeedbacks(pa.id);
  ok('用例D-家长仅见允许可见的已发布', pf.some(x => x.id === f1.id) && !pf.some(x => x.id === f2.id) && !pf.some(x => x.id === f3.id) && pf.some(x => x.id === f4.id), '家长可见' + pf.length);
  ok('用例D-homeworkAdvice透出', (pf.find(x => x.id === f1.id) || {}).homeworkAdvice === '回家读三遍');
  const agentView = S.learningFeedbacksOfStudent(kidA.id, 'agent');
  ok('用例D-代理投影含visibleToAgent且不含parent-only', agentView.some(x => x.id === f2.id) && !agentView.some(x => x.id === f4.id), '代理可见' + agentView.length);
}
{
  const s2 = S.db.students.find(s => s.id !== kidA.id && s.id !== kidA2.id && s.id !== kidB.id);
  role('admin');
  ok('用例E-新增关联', !!S.linkParentStudent(pa.id, s2.id, { relationship: '家长' }));
  role('parent', pa.id);
  ok('用例E-新增后可访问', S.parentStudentDetail(pa.id, s2.id).id === s2.id);
  const histBefore = S.parentCourses(pa.id, kidA.id).length;
  role('admin');
  ok('用例E-解除关联', S.unlinkParentStudent(pa.id, s2.id).removed === true);
  role('parent', pa.id);
  throws('用例E-解除后拒绝', () => S.parentStudentDetail(pa.id, s2.id), '不在当前家长名下');
  ok('用例E-历史课程保留', S.parentCourses(pa.id, kidA.id).length === histBefore, '(' + histBefore + ')');
}
{
  role('parent', pa.id);
  const q = S.createParentInquiry({ studentId: kidA.id, type: '续费', content: '想了解下季度套餐', contact: '13800000000' });
  ok('咨询-创建&待处理', !!q.id && q.status === '待处理', q.id);
  ok('咨询-关联家长', q.parentId === pa.id);
  ok('咨询-关联孩子', q.studentId === kidA.id);
  ok('咨询-家长可查自己', S.parentInquiries(pa.id).some(x => x.id === q.id));
  throws('咨询-查他人咨询被拒', () => S.parentInquiryDetail(pb.id, q.id), '家长');
  role('admin');
  const h = S.handleParentInquiry(q.id, { reply: '已预留名额', status: '已回复' });
  ok('咨询-教务回复', h.status === '已回复' && !!h.reply);
}

console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
