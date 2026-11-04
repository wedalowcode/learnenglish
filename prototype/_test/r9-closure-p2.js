/** 阶段二验收：训练任务与训练过程（数据层）
 *  场景一(1-5)：选学员/选两词库/加词/确认任务/完成全部单词训练
 *  场景二：训练中断→恢复→完成单词与当前进度保留，不重复计算
 *  场景三：两个词库含相同基础 Word，训练清单只出现一次
 *  运行：node _test/r9-closure-p2.js
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
function role(r, t) {
  const u = S.db.users.find(x => x.roleCode === r);
  if (r === 'admin') S.setSession({ role: 'admin', accountId: u ? u.id : '', operatorId: u ? u.id : 'admin', operatorName: '管理员' });
  if (r === 'teacher') { const tu = S.db.users.find(x => x.roleCode === 'teacher' && (x.teacherId === t || x.profileId === t)); S.setSession({ role: 'teacher', teacherId: t, operatorId: t, operatorName: '教师', accountId: tu ? tu.id : '' }); }
}
function fresh(sid) {
  role('admin');
  let r = S.createTrainTask({ studentId: sid, targetCount: 20, teacherId: 'T001' });
  if (r.reused) { S.endTask(r.task.id, '清理'); r = S.createTrainTask({ studentId: sid, targetCount: 20, teacherId: 'T001' }); }
  return r.task;
}
function finishDisplay(tid) {
  let g = 0;
  while (!S.displayStat(tid).allDone && g < 300) {
    const cur = S.displayStat(tid).currentGroup;
    cur.words.forEach(w => { if (w.step < 3) S.trainDisplayTap(tid, w.id); });
    const s2 = S.displayStat(tid);
    if (s2.currentComplete && s2.groupIndex < s2.groupCount - 1) S.setTrainGroup(tid, s2.groupIndex + 1);
    g++;
  }
  return S.displayStat(tid);
}

console.log('\n== 阶段二验收（训练任务与训练过程）==');
role('admin');

/* ---- 场景三：多词库重复词（先验证去重，再用于场景一/二） ---- */
const tid = fresh('S2026001').id;
const add = S.addWordbooksToTask(tid, ['WB001', 'WB002']);
ok('场景三-同时选择两个词库', add.added.length === 2, add.pool + ' 去重词池');
const cands = S.prescreenCandidates(tid, { all: true });
const uniq = new Set(cands.map(c => c.id));
ok('场景三-训练清单相同基础 Word 只出现一次', uniq.size === cands.length, cands.length + '→' + uniq.size);
const shared = cands.filter(c => (c.sourceBooks || []).length > 1);
ok('场景三-共享词保留来源词库', shared.length > 0, shared.length + ' 个共享');

/* ---- 场景一(1-5)：初筛（认识/不认识）→ 生成训练队列 ---- */
let i = 0; const knowns = []; let t = S.trainTask(tid);
t.wordIds.forEach(id => { const kn = (i++ % 4) === 0; S.prescreenAnswer(tid, id, kn); if (kn) knowns.push(id); });
ok('场景一(3)-逐行判断认识/不认识', knowns.length > 0 && (t.wordIds.length - knowns.length) > 0, '认识' + knowns.length + ' 不认识' + (t.wordIds.length - knowns.length));
const fp = S.finishPrescreen(tid, { confirmShort: true });
t = S.trainTask(tid);
ok('场景一(4)-确认任务生成训练队列', fp.ok === true && t.queueWordIds.length > 0, 'queue=' + t.queueWordIds.length);
ok('场景一-队列不重复(按 Word.id)', new Set(t.queueWordIds).size === t.queueWordIds.length);

/* ---- 场景二：中断→恢复→进度保留、不重复计算 ---- */
role('teacher', 'T001');
const firstGroup = S.displayStat(tid).groups[0];
const word0 = firstGroup.words[0].id;
S.trainDisplayTap(tid, word0);  // 完成第1个词的展示
S.trainDisplayTap(tid, word0);
S.trainDisplayTap(tid, word0);
ok('场景二-完成1个单词展示', S.displayCompleted(tid, word0) === true);
const progBeforeLeave = S.displayStat(tid).done;
/* 离开页面 = 直接endTask中断（保留展示记录），模拟退出 */
S.endTask(tid, '课堂时间不足');
ok('场景二-任务中断', S.trainTask(tid).status === '已中断');
role('teacher', 'T001'); const t2 = S.resumeTask(tid);
ok('场景二-重新进入恢复任务', t2.status === '进行中');
ok('场景二-已完成单词进度保留(不回到未开始)', S.displayStat(tid).groups[0].words.find(w => w.id === word0).step === 3);
ok('场景二-不重复计算(已完成数仍=1)', S.displayStat(tid).done === progBeforeLeave, S.displayStat(tid).done);

/* 恢复后继续完成全部展示 */
const ds = finishDisplay(tid);
ok('场景一(5)-完成全部单词训练', ds.allDone && ds.done === ds.total, ds.done + '/' + ds.total);
ok('场景一(5)-进入待复习检测(pending_assessment)', (() => { const r = S.toFinalStage(tid); return r.ok === true && r.task.phase === '最后复习'; })());

console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败');
process.exit(fail ? 1 : 0);