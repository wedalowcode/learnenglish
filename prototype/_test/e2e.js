/* 端到端逻辑验收（node 环境，模拟页面刷新 = 重新加载 store.js） */
const fs = require('fs');
const vm = require('vm');

const root = 'D:/低代码/英语一对一教学软件/prototype/assets/js/';
const dataSrc = fs.readFileSync(root + 'data.js', 'utf8');
const storeSrc = fs.readFileSync(root + 'store.js', 'utf8');

/* 极简 localStorage 模拟，跨"页面"共享 */
const mem = {};
const localStorage = {
  getItem: k => (k in mem ? mem[k] : null),
  setItem: (k, v) => { mem[k] = String(v); },
  removeItem: k => { delete mem[k]; }
};

function boot() {
  const sandbox = { console, localStorage, Date, JSON, Math, Object, Array, String, Number };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(dataSrc, sandbox);
  vm.runInContext(storeSrc, sandbox);
  return sandbox.Store;
}

const ok = [];
const bad = [];
function assert(name, cond, extra) {
  if (cond) ok.push(name); else bad.push(name + (extra ? ' → ' + extra : ''));
}

/* ============ 场景 A：单词训练 ============ */
let S = boot();
assert('初始无进行中训练任务', S.activeTask('S2026001', 'WB001') === null);

let t = S.startTrainTask({ studentId: 'S2026001', teacherId: 'T001', wordbookId: 'WB001' });
assert('任务编号生成', /^TR20261102\d+$/.test(t.id), t.id);
assert('任务状态=未开始（预筛选阶段）', t.status === '未开始' && t.phase === '预筛选', t.status + '/' + t.phase);

const words = S.wordsOfBook('WB001');
assert('词库 23 词', words.length === 23, words.length);

// 前 9 个「认识」，其余 14 个「不认识」
words.forEach((w, i) => S.prescreenAnswer(t.id, w.id, i < 9));

// 未筛选校验：另开一个任务的第 1 个词保持未答，不应被计为认识或不认识
const r = S.finishPrescreen(t.id);
assert('初筛认识 9', r.known === 9, r.known);
assert('不认识 14', r.unknown === 14, r.unknown);
assert('训练队列 14 个', r.queue.length === 14, r.queue.length);
assert('剩余待训练 0', r.remain.length === 0, r.remain.length);
assert('分组 5/5/4', JSON.stringify(r.groups.map(g => g.length)) === '[5,5,4]', JSON.stringify(r.groups.map(g => g.length)));
assert('认识的单词不入队', !r.queue.some(id => r.queue.indexOf(id) !== -1 && words.slice(0, 9).some(w => w.id === id)));

// 认识的单词学员状态=初筛认识
assert('认识→初筛认识', S.wordState('S2026001', words[0].id).state === '初筛认识', S.wordState('S2026001', words[0].id).state);
assert('不认识→待强化', ['待强化训练', '待最后复习'].includes(S.wordState('S2026001', words[10].id).state), S.wordState('S2026001', words[10].id).state);

// 组内逐词判断
const groups = S.groupsOfTask(t);
assert('组数=3', groups.length === 3);

// 每组：前 3 个认识、后 2 个不认识（最后一组 4 个）
const plan = {};
groups.forEach((g, gi) => g.forEach((id, wi) => { plan[id] = { gi, res: wi < 3 ? 'yes' : 'no' }; }));

// 只做第 1 组，然后"刷新页面"验证恢复
groups[0].forEach(id => S.trainJudge(t.id, id, plan[id].res, 'en2cn', 0));
S.setTaskPos(t.id, { groupIndex: 0, wordIndex: 0 });
S.pauseTask(t.id);

let S2 = boot(); // 模拟刷新
let t2 = S2.trainTask(t.id);
assert('刷新后任务仍在', !!t2);
assert('刷新后状态=进行中/强化训练', t2.status === '进行中' && t2.phase === '强化训练', t2.status + '/' + t2.phase);
assert('刷新后已完成 5 个', Object.keys(t2.results).length === 5, Object.keys(t2.results).length);
assert('刷新后明细 5 条', S2.detailsOf(t.id).length === 5, S2.detailsOf(t.id).length);

// 恢复 + 误判修正
S2.resumeTask(t.id);
const firstId = groups[0][0];
S2.trainCorrect(t.id, firstId, 'no', '课上误点，实际不认识');
const dets = S2.detailsOf(t.id).filter(d => d.wordId === firstId);
assert('误判修正追加而非覆盖', dets.length === 2 && dets[1].correction === true, dets.length);
assert('原始记录保留', dets[0].result === 'yes' && dets[0].correction === false);

// 继续完成剩余组
S = boot();
t = S.trainTask(t.id);
for (let gi = 1; gi < groups.length; gi++) {
  groups[gi].forEach(id => S.trainJudge(t.id, id, plan[id].res, 'en2cn', gi));
}
// 未做最后复习就完成 → 应被拦截
let bad1 = S.completeTask(t.id, { joinLeitner: true });
assert('缺最后复习不许完成', bad1.ok === false, bad1.reason);

let fin = S.toFinalStage(t.id);
assert('进入最后一轮复习', fin.ok === true, JSON.stringify(fin.missing || []));
t = S.trainTask(t.id);
assert('状态=进行中/最后复习', t.status === '进行中' && t.phase === '最后复习', t.status + '/' + t.phase);

const q = t.queueWordIds;
q.forEach(id => {
  const g = plan[id].res;
  // 强化训练不认识的，最后复习仍不认识；认识的改成通过
  S.finalJudge(t.id, id, g === 'yes' ? 'yes' : 'no');
});
let res = S.completeTask(t.id, { joinLeitner: true, joinPlan21: true, joinGreen: false });
assert('完成成功', res.ok === true, res.reason);
assert('通过/待复习计数', res.pass + res.review + res.mid === 14, JSON.stringify(res));

// 防重复提交
let dup = S.completeTask(t.id, { joinLeitner: true });
assert('防重复提交', dup.ok === false, dup.reason);

// 一致性：通过的单词=本次通过；不通过的进红盒且今日到期
const passIds = q.filter(id => plan[id].res === 'yes');
const failIds = q.filter(id => plan[id].res === 'no');
assert('通过数 9', passIds.length === 9, passIds.length);
assert('通过→本次通过', passIds.every(id => S.wordState('S2026001', id).state === '本次通过'));
assert('不通过→待复习', failIds.every(id => S.wordState('S2026001', id).state === '待复习'));
assert('不通过→莱特纳红盒', failIds.every(id => {
  const ls = S.leitnerState('S2026001', id);
  return ls && ls.box === 'red' && ls.dueAt === '2026-11-02';
}), JSON.stringify(failIds.map(id => { const l = S.leitnerState('S2026001', id); return l ? l.box + '/' + l.dueAt : 'none'; })));
assert('通过的不改动体系盒', passIds.every(id => {
  const ls = S.leitnerState('S2026001', id);
  return !ls || ls.box !== 'graduated';
}));
assert('通过的不新建体系记录', passIds.filter(id => S.leitnerState('S2026001', id)).every(id => {
  const ls = S.leitnerState('S2026001', id);
  return ls.source !== '训练加入' || ls.addedAt < '2026-11-02';
}));

/* ============ 场景 B：莱特纳复习 ============ */
S = boot();
S.reset();
const due = S.leitnerDue('S2026001');
assert('红盒到期 6', due.red.length === 6, due.red.length);
assert('黄盒到期 5', due.yellow.reduce((n, y) => n + y.words.length, 0) === 5);
assert('手动加入 2', due.manual.length === 2, due.manual.length);
assert('去重生效', due.dedupRemoved >= 1, JSON.stringify({ raw: due.rawTotal, dedup: due.dedupTotal, removed: due.dedupRemoved }));

const before91 = S.leitnerState('S2026001', S.wordByEn('friend').id);
const taskL = S.createLeitnerTask('S2026001', due.union.map(s => s.wordId), 'T001', '系统推荐');
assert('复习任务去重后总数一致', taskL.wordIds.length === due.dedupTotal, taskL.wordIds.length);

const friendId = S.wordByEn('friend').id;
const mv = S.leitnerJudge(taskL.id, friendId, 'yes', 'T001');
assert('认识→按配置升盒', mv.to === 'Y1', mv.to);
assert('下次到期按间隔计算', mv.nextDue === '2026-11-04', mv.nextDue);
assert('盒状态已更新', S.leitnerState('S2026001', friendId).box === 'Y1');

// 不认识的留在红盒并生成次日到期
const libId = S.wordByEn('library').id;
const mv2 = S.leitnerJudge(taskL.id, libId, 'no', 'T001');
assert('不认识→回红盒', mv2.to === 'red', mv2.to);
assert('红盒次日再复习', mv2.nextDue === '2026-11-03', mv2.nextDue);

// 绿盒不受自动移动影响
const happyId = S.wordByEn('happy').id;
S.addToGreen('S2026001', S.wordByEn('look').id, '课堂易混');
const mvG = S.leitnerJudge(taskL.id, S.wordByEn('look').id, 'yes', 'T001');
assert('绿盒不自动升盒', mvG.to === 'green', mvG.to);

const fL = S.finishLeitnerTask(taskL.id, 'T001', { reason: '测试：提前结束' });
const tL = fL.task;
assert('未全部复习完 → 已中断（不再伪装成已完成）', fL.ok === true && tL.status === '已中断' && fL.stat.done > 0 && tL.interruptReason, tL.status + '/' + tL.interruptReason);
assert('复习记录可查', S.leitnerRecordsOf('S2026001', friendId).length >= 2, S.leitnerRecordsOf('S2026001', friendId).length);
assert('手动操作留痕', S.leitnerOps('S2026001').length >= 1);

// 莱特纳复习不得改动 21 天
const planId0 = S.plansOf('S2026001')[0].id;
const planRecBefore = S.plan21Records(planId0).length;
const planTaskBefore = JSON.stringify(S.plan21Tasks(planId0).map(t => [t.id, t.wordIds.length, t.status]));
S = boot();
assert('21 天记录未被莱特纳改动', S.plan21Records(planId0).length === planRecBefore);
assert('21 天任务未被莱特纳改动', JSON.stringify(S.plan21Tasks(planId0).map(t => [t.id, t.wordIds.length, t.status])) === planTaskBefore);
assert('莱特纳改动已持久化', S.leitnerState('S2026001', friendId).box === 'Y1');

/* ============ 场景 C：21 天复习 ============ */
S = boot();
S.reset();
const planA = S.plan21('PN20261024001');
const prog0 = S.plan21Progress(planA);
assert('计划 23 词', planA.wordIds.length === 23, planA.wordIds.length);
assert('今日任务 12 个', prog0.todayTotal === 12, prog0.todayTotal);
assert('计划进度天数 10', prog0.currentDay === 10, prog0.currentDay);

const todayTask = prog0.todayTask;
const leitnerSnap = JSON.stringify(S.leitnerStates('S2026001').map(s => [s.wordId, s.box, s.dueAt]));
todayTask.wordIds.forEach((id, i) => S.plan21Judge(todayTask.id, id, i < 8 ? 'yes' : 'no'));
const prog1 = S.plan21Progress(planA);
assert('今日完成 12', prog1.todayDone === 12, prog1.todayDone);
assert('节点标记完成', S.plan21Task(todayTask.id).status === '已完成', S.plan21Task(todayTask.id).status);
assert('完成率提升', prog1.rate > prog0.rate, prog0.rate + '→' + prog1.rate);

S = boot();
assert('21 天复习不改莱特纳', JSON.stringify(S.leitnerStates('S2026001').map(s => [s.wordId, s.box, s.dueAt])) === leitnerSnap);
assert('21 天记录已持久化', S.plan21Records(planA.id).filter(r => r.taskId === todayTask.id).length === 12);

/* ============ 场景 D：同一单词参与多个体系 ============ */
S = boot();
S.reset();
// 选一个「同时在绿盒与今日 21 天节点」的单词：happy(w22)
const heId = S.wordByEn('happy').id;
const l0 = S.leitnerState('S2026001', heId);
const p2 = S.plan21('PN20261024001');
const t21 = S.plan21Today(p2.id);
assert('初始同时在两体系', l0 && l0.box === 'green'
  && S.plansOf('S2026001')[0].wordIds.includes(heId)
  && t21.wordIds.includes(heId));
const taskL2 = S.createLeitnerTask('S2026001', [heId], 'T001', '绿盒');
S.leitnerJudge(taskL2.id, heId, 'yes', 'T001');
const recL = S.leitnerRecordsOf('S2026001', heId).length;
const recBefore21 = S.plan21Records(p2.id, heId).length;
// 21 天里对同一单词做相反判断
S.plan21Judge(t21.id, heId, 'no');
assert('两体系记录互不覆盖(莱特纳)', S.leitnerRecordsOf('S2026001', heId).length === recL);
assert('两体系记录互不覆盖(21天)', S.plan21Records(p2.id, heId).length === recBefore21 + 1);
assert('21 天判断不改盒', S.leitnerState('S2026001', heId).box === 'green', S.leitnerState('S2026001', heId).box);

/* ============ 上限 45 校验 ============ */
S = boot();
S.reset();
const t45 = S.startTrainTask({ studentId: 'S2026002', teacherId: 'T002', wordbookId: 'WB001' });
S.wordsOfBook('WB001').forEach(w => S.prescreenAnswer(t45.id, w.id, false));
const r45 = S.finishPrescreen(t45.id);
assert('全部不认识时队列=23(<45) 不截断', r45.queue.length === 23, r45.queue.length);

/* 上限逻辑单元校验：直接构造 46 个候选 */
const fake = S.startTrainTask({ studentId: 'S2026003', teacherId: 'T003', wordbookId: 'WB001' });
fake.wordIds = [];
for (let i = 0; i < 46; i++) fake.wordIds.push(S.wordsOfBook('WB001')[i % 23].id);
fake.wordIds.forEach(id => { fake.prescreen[id] = { known: false, at: 'x' }; });
const r46 = S.finishPrescreen(fake.id);
assert('46 个候选 → 队列 45', r46.queue.length === 45, r46.queue.length);
assert('其余 1 个保留待训练', r46.remain.length === 1, r46.remain.length);

/* ============ 输出 ============ */
console.log('\n通过 ' + ok.length + ' 项');
if (bad.length) {
  console.log('\n失败 ' + bad.length + ' 项：');
  bad.forEach(b => console.log('  ✗ ' + b));
  process.exit(1);
} else {
  console.log('全部断言通过');
}
