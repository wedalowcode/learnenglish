/** R9 阶段一验收：强化训练列表式展示循环（displayFlow）
 *  验证：每组5词独立推进、组完成才可进下一组、最后一组不足5词、
 *        pause/resume 后步进保留、全完成才进最后复习、不产生掌握判断、displayFlow 下 trainJudge 被拒。
 *  运行：node _test/r9-display-flow.js
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
function roleTeacher(tid) {
  const u = (S.db.users || []).find(x => x.roleCode === 'teacher' && (x.teacherId === tid || x.profileId === tid));
  S.setSession({ role: 'teacher', teacherId: tid, operatorId: tid, operatorName: '教师',
    accountId: u ? u.id : '', courseId: '' });
}
function countBy(b) { return (S.wordsOfBook ? S.wordsOfBook(b.id) : []).length; }

console.log('\n== R9 阶段一 · 强化训练展示循环 ==');
roleTeacher('T001');

/* 选一个学员 + 已授权、5..45 词且非 5 整数倍的词库，确保「最后一组不足5词」 */
let studentId = '', book = null, wc = 0;
const stus = S.db.students.filter(s => S.parentStudents || true).map(s => s.id);
for (const sid of stus) {
  const auth = (S.db.wordbooks || []).filter(b =>
    S.isAuthorized && S.isAuthorized(sid, b.id) && b.status === '启用');
  const cand = auth.find(b => { const n = countBy(b); return n >= 6 && n <= 45 && n % 5 !== 0; });
  if (cand) { studentId = sid; book = cand; wc = countBy(cand); break; }
}
ok('找到已授权且非5整数倍词量的词库', studentId && book && wc > 0, (studentId || '') + ' / ' + (book ? book.id : '') + ' / ' + wc);
if (!studentId || !book) { console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败'); process.exit(fail ? 1 : 0); }

let created = S.createTrainTask({ studentId, targetCount: wc });
ok('创建 displayFlow 任务', created.ok && created.task.displayFlow === true, created.task.id);
if (created.reused) { ok('复用已有任务（清理以得到干净队列）', false, '已有未完成任务'); }
const tid = created.task.id;
const add = S.addWordbooksToTask(tid, [book.id]);
ok('添加词库成功', add.ok === true, add.added[0] ? add.added[0].name : '');
/* 全部标记为不认识，进入候选 */
let task = S.trainTask(tid);
(task.wordIds || []).forEach(id => S.prescreenAnswer(tid, id, false));
task = S.trainTask(tid);
ok('候选数量 = 词库单词数', task.candidateWordIds.length === wc, task.candidateWordIds.length);
const fp = S.finishPrescreen(tid, { confirmShort: true });
ok('初筛完成生成队列', fp.ok === true, ('queue=' + (fp.queue || []).length));
task = S.trainTask(tid);
ok('进入强化训练阶段', task.phase === '强化训练' && task.status === '进行中');

/* --- 展示循环语义 --- */
let st = S.displayStat(tid);
const sizes = (st.groups || []).map(g => g.total);
ok('分组为每组5词，最后一组不足5', sizes.every((n, i) => n === 5 || i === sizes.length - 1) && sizes[sizes.length - 1] < 5, sizes.join('/'));
ok('总进度 0/' + task.queueWordIds.length, st.done === 0, st.done + '/' + st.total);
const firstGroup = st.groups[0];
const w0 = firstGroup.words[0], w1 = firstGroup.words[1];

/* 每词独立 0→1→2→3 */
S.trainDisplayTap(tid, w0.id); st = S.displayStat(tid);
ok('第1次点击→显示英文(step1)', st.groups[0].words.find(w => w.id === w0.id).step === 1);
ok('word1 不受影响(仍未开始)', st.groups[0].words.find(w => w.id === w1.id).step === 0);
S.trainDisplayTap(tid, w0.id); st = S.displayStat(tid);
ok('第2次点击→显示中文(step2)', st.groups[0].words.find(w => w.id === w0.id).step === 2);
S.trainDisplayTap(tid, w0.id); st = S.displayStat(tid);
ok('第3次点击→隐藏并完成(step3)', st.groups[0].words.find(w => w.id === w0.id).step === 3);
ok('本词标记 cycleCompleted', S.displayCompleted(tid, w0.id) === true);
/* 完成后不再累加 */
S.trainDisplayTap(tid, w0.id); st = S.displayStat(tid);
ok('完成后多点击不累加', st.groups[0].words.find(w => w.id === w0.id).step === 3);
/* 未完成本组 → 禁止进入下一组 */
throws('未完成本组禁止进下一组', () => S.setTrainGroup(tid, 1), '未完成展示');
/* 重复点击同一词不产生掌握判断 */
ok('展示阶段 results 为空（无掌握判断）', Object.keys(S.trainTask(tid).results || {}).length === 0);
const tdBefore = S.detailsOf(tid).length;
S.trainDisplayTap(tid, w1.id);
ok('展示不写 trainDetails 掌握记录', S.detailsOf(tid).length === tdBefore);
ok('展示不产生「认识/本次通过」状态', !['本次通过', '初筛认识'].includes(S.wordState(studentId, w1.id).state), S.wordState(studentId, w1.id).state);

/* displayFlow 任务不得用 trainJudge */
throws('displayFlow 下 trainJudge 被拒', () => S.trainJudge(tid, w1.id, 'yes', 'en2cn', 0), '展示循环流程');

/* 暂停/恢复后步进保留 */
const stepBeforeResume = S.displayStat(tid).groups[0].words.find(w => w.id === w1.id).step;
S.pauseTask(tid); S.resumeTask(tid);
ok('暂停/恢复后步进保留', S.displayStat(tid).groups[0].words.find(w => w.id === w1.id).step === stepBeforeResume, stepBeforeResume);
/* 模拟刷新：从 store 重新读取 task 与 displayStat，步进仍来自持久化 trainDisplays */
ok('刷新重读后步进保留', S.displayStat(tid).groups[0].words.find(w => w.id === w0.id).step === 3);

/* 完成第 1 组全部单词（w0 已 step3，w1 在早先后续产生过一次点击，统一补齐） */
let g0guard = 0;
while (!S.displayStat(tid).groups[0].allDone && g0guard < 50) {
  S.displayStat(tid).groups[0].words.forEach(wt => { if (wt.step < 3) S.trainDisplayTap(tid, wt.id); });
  g0guard++;
}
st = S.displayStat(tid);
ok('第1组全部完成', st.groups[0].allDone && st.groups[0].done === 5);
S.setTrainGroup(tid, 1); st = S.displayStat(tid);
ok('可进入第2组', st.groupIndex === 1, st.groupIndex + 1 + '/' + st.groupCount);

/* 未全部完成 → toFinalStage 拒绝 */
let r = S.toFinalStage(tid);
ok('未全部完成禁止进最后复习', r.ok === false, r.reason);

/* 完成所有组 */
let guard = 0;
while (!S.displayStat(tid).allDone && guard < 200) {
  const cur = S.displayStat(tid).currentGroup;
  cur.words.forEach(wt => { if (wt.step < 3) S.trainDisplayTap(tid, wt.id); });
  const s2 = S.displayStat(tid);
  if (s2.currentComplete && s2.groupIndex < s2.groupCount - 1) S.setTrainGroup(tid, s2.groupIndex + 1);
  guard++;
}
st = S.displayStat(tid);
ok('全部组完成', st.allDone, st.done + '/' + st.total + ' (groups=' + sizes.join('/') + ')');
r = S.toFinalStage(tid);
ok('全部完成后进入最后复习', r.ok === true && r.task.phase === '最后复习', r.task.phase);

console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败');
process.exit(fail ? 1 : 0);