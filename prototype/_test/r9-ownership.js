/** R9 阶段三-3 验收：教师与训练任务归属校验
 *  教师 A 建任务；教师 B 用同一 taskId 调用各操作必须被拒；
 *  教师 B 不能复用教师 A 的未完成任务。
 *  运行：node _test/r9-ownership.js
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
function roleTeacher(tid, accId) {
  const u = (S.db.users || []).find(x => x.roleCode === 'teacher' && (x.teacherId === tid || x.profileId === tid));
  S.setSession({ role: 'teacher', teacherId: tid, operatorId: tid, operatorName: '教师', accountId: accId || (u ? u.id : '') });
}

console.log('\n== R9 阶段三-3 · 任务归属校验 ==');

/* 选教师 A 及其负责的学员（依据 activeRelationOfStudent 的当前师生关系）；教师 B 取另一位教师 */
const tids = (S.db.teachers || []).map(t => t.id);
let tA = '', tB = '', sidA = '';
for (const sid of S.db.students.map(s => s.id)) {
  const rel = S.activeRelationOfStudent(sid);
  if (rel && rel.teacherId && tids.indexOf(rel.teacherId) >= 0) { tA = rel.teacherId; sidA = sid; break; }
}
for (const tid of tids) { if (tid !== tA) { tB = tid; break; } }
ok('找到教师A及其学员', tA && sidA, tA + '/' + sidA);
ok('找到教师B(不同于A)', tB && tB !== tA, tB);
if (!tA || !tB || !sidA) { console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败'); process.exit(fail ? 1 : 0); }

/* 教师 A 创建任务并推进 */
roleTeacher(tA);
let created = S.createTrainTask({ studentId: sidA, targetCount: 10 });
if (created.reused) { try { S.endTask(created.task.id, '测试清理'); } catch (e) {} created = S.createTrainTask({ studentId: sidA, targetCount: 10 }); }
const tAid = created.task.id;
ok('教师A创建任务(teacherId=A)', S.trainTask(tAid).teacherId === tA, S.trainTask(tAid).teacherId);
const bk = (S.db.wordbooks || []).find(b => b.status === '启用' && (S.wordsOfBook(b.id) || []).length >= 6);
S.addWordbooksToTask(tAid, [bk.id]);
const words = S.trainTask(tAid).wordIds;
words.slice(0, 6).forEach(id => S.prescreenAnswer(tAid, id, false));
S.finishPrescreen(tAid, {});

/* 教师 B 尝试操作教师 A 的任务：全部应被拒 */
roleTeacher(tB);
throws('B-加词库被拒', () => S.addWordbooksToTask(tAid, [bk.id]), '不属于当前教师');
throws('B-初筛判断被拒', () => S.prescreenAnswer(tAid, words[0], true), '不属于当前教师');
throws('B-初筛候选读取被拒', () => S.prescreenCandidates(tAid, { all: true }), '不属于当前教师');
throws('B-完成初筛被拒', () => S.finishPrescreen(tAid, {}), '不属于当前教师');
throws('B-展示进度被拒', () => S.trainDisplayTap(tAid, words[0]), '不属于当前教师');
throws('B-切组被拒', () => S.setTrainGroup(tAid, 1), '不属于当前教师');
throws('B-进最后复习被拒', () => S.toFinalStage(tAid), '不属于当前教师');
throws('B-最后复习判断被拒', () => S.finalJudge(tAid, words[0], 'yes'), '不属于当前教师');
throws('B-提交任务被拒', () => S.completeTask(tAid, { joinLeitner: true }), '不属于当前教师');
throws('B-暂停被拒', () => S.pauseTask(tAid), '不属于当前教师');
throws('B-恢复被拒', () => S.resumeTask(tAid), '不属于当前教师');
throws('B-中断被拒', () => S.endTask(tAid, '测试'), '不属于当前教师');
throws('B-取消被拒', () => S.cancelTask(tAid), '不属于当前教师');
throws('B-trainJudge 被拒', () => S.trainJudge(tAid, words[0], 'yes', 'en2cn', 0), '不属于当前教师');

/* 教师 B 尝试为该学员建任务：不得复用/接管教师 A 的任务 */
roleTeacher(tB);
S.disableAccount && roleTeacher(tB);
let reused = null, deniedReuse = false;
try {
  const r = S.createTrainTask({ studentId: sidA, targetCount: 10 });
  reused = r.reused ? r.task.id : null;
} catch (e) { deniedReuse = !!e.message; }
ok('教师B被迫离开/无法复用A的任务', deniedReuse || reused !== tAid, (reused || 'denied'));

/* 原教师 A 仍可继续（归属未被 B 污染，且初筛阶段可正常读取候选） */
roleTeacher(tA);
ok('教师A仍可操作自己的任务', S.prescreenCandidates(tAid, { all: true }).length > 0, S.prescreenCandidates(tAid, { all: true }).length + ' 候选');

/* 非教师角色（管理员）仍可管理（不误伤） */
roleAdmin();
ok('管理员仍可读取任务', S.trainTask(tAid).id === tAid, 'ok');

console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
function roleAdmin() {
  const u = (S.db.users || []).find(x => x.roleCode === 'admin');
  S.setSession({ role: 'admin', operatorId: u ? u.id : 'admin', operatorName: '管理员', accountId: u ? u.id : '' });
}