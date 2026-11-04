/* 临时探针：第九轮多词库训练任务链路（实现期自检，验收后删除） */
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const root = path.join(__dirname, '..', 'assets', 'js') + path.sep;
const mem = {};
const localStorage = { getItem: k => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); }, removeItem: k => { delete mem[k]; } };
function boot() {
  const sandbox = { console, localStorage, Date, JSON, Math, Object, Array, String, Number, isFinite, parseInt, parseFloat };
  sandbox.window = sandbox; sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(root + 'data.js', 'utf8'), sandbox);
  vm.runInContext(fs.readFileSync(root + 'store.js', 'utf8'), sandbox);
  return sandbox.Store;
}
const S = boot();
const log = (...a) => console.log(...a);

S.setSession({ role: 'teacher', teacherId: 'T001', operatorName: '李婉' });
log('授权词库', S.teachingWordbooks('S2026001').map(b => b.id + ':' + b.name + '(' + b.wordCount + ')').join(' | '));

const r = S.createTrainTask({ studentId: 'S2026001', teacherId: 'T001', targetCount: 12 });
log('createTrainTask', r.ok, r.reused, r.task.id, r.task.targetCount, r.task.phase);
const t = r.task;

const a1 = S.addWordbooksToTask(t.id, ['WB001']);
log('add WB001', a1.added, a1.skipped, 'pool', a1.pool);

let cands = S.prescreenCandidates(t.id);
log('候选数', cands.length, cands.slice(0, 3).map(c => c.en + '/' + c.status).join(','));

/* 前 6 认识，其余不认识 */
cands.slice(0, 6).forEach(c => S.prescreenAnswer(t.id, c.id, true));
cands.slice(6).forEach(c => S.prescreenAnswer(t.id, c.id, false));
let stat = S.prescreenTaskStat(t.id);
log('初筛后', JSON.stringify({ known: stat.known, unknown: stat.unknown, unscreened: stat.unscreened, needMore: stat.needMore }));
log('绿盒', S.leitnerState('S2026001', cands[0].id).box, S.leitnerState('S2026001', cands[0].id).source,
  S.wordState('S2026001', cands[0].id).screeningStatus);

/* 补第二个词库 */
const a2 = S.addWordbooksToTask(t.id, ['WB002']);
log('add WB002', a2.added, a2.skipped, 'pool', a2.pool);
let cands2 = S.prescreenCandidates(t.id, { wordbookId: 'WB002' });
log('WB002 候选', cands2.length, '排除已初筛认识', cands2.filter(c => c.excluded).length, 'Task', S.wordbookName ? '' : '');

/* WB002 全部不认识，补到目标 */
cands2.forEach(c => S.prescreenAnswer(t.id, c.id, false));
stat = S.prescreenTaskStat(t.id);
log('目标检查', stat.target, stat.unknown, stat.reached, stat.needMore);

const fr = S.finishPrescreen(t.id);
log('finishPrescreen', fr.ok, 'queue', fr.queue.length, 'remain', fr.remain.length, 'groups', fr.groups.map(g => g.length).join('+'));
log('重复去重检查', new Set(fr.queue).size === fr.queue.length);

/* 展示循环 */
const ds0 = S.displayStat(t.id);
log('displayStat', ds0.total, ds0.done, ds0.groupCount, ds0.currentGroup.total);
const first = ds0.currentGroup.wordIds[0];
S.trainDisplayTap(t.id, first);
log('tap1', S.trainDisplayOf(t.id, first).displayStep, S.trainDisplayOf(t.id, first).cycleCompleted);
S.trainDisplayTap(t.id, first);
S.trainDisplayTap(t.id, first);
log('tap3', S.trainDisplayOf(t.id, first).displayStep, S.trainDisplayOf(t.id, first).cycleCompleted);
log('其它词不受影响', S.trainDisplayOf(t.id, ds0.currentGroup.wordIds[1]) === null);
try { S.setTrainGroup(t.id, 1); log('!! 未完成却进了下一组'); } catch (e) { log('下一组被拒', e.code, e.message); }

/* 完成本组 */
ds0.currentGroup.wordIds.forEach(id => { S.trainDisplayTap(t.id, id); S.trainDisplayTap(t.id, id); S.trainDisplayTap(t.id, id); });
const g = S.setTrainGroup(t.id, 1);
log('完成本组后进入第 2 组', g.stat.groupIndex);

try { S.trainJudge(t.id, fr.queue[0], 'yes', 'en2cn', 0); log('!! 强化阶段写入了掌握判断'); }
catch (e) { log('强化阶段禁止掌握判断', e.code); }

/* 全组完成 → 最后复习 */
S.displayStat(t.id).groups.forEach(gg => gg.wordIds.forEach(id => {
  if (!S.displayCompleted(t.id, id)) { S.trainDisplayTap(t.id, id); S.trainDisplayTap(t.id, id); S.trainDisplayTap(t.id, id); }
}));
const tf = S.toFinalStage(t.id);
log('toFinalStage', tf.ok, tf.task && tf.task.phase);

/* 最后复习 */
fr.queue.forEach((id, i) => S.finalJudge(t.id, id, i % 3 === 0 ? 'yes' : i % 3 === 1 ? 'no' : 'mid'));
const ct = S.completeTask(t.id, { joinLeitner: true, joinPlan21: true, joinGreen: true, by: '李婉' });
log('completeTask', ct.ok, ct.pass, ct.review, ct.mid, ct.need, JSON.stringify(ct.joins));

/* 绿盒不覆盖初筛状态 */
const g1 = S.leitnerState('S2026001', fr.queue[0]);
const s1 = S.wordState('S2026001', fr.queue[0]);
log('最后复习不认识进绿盒', g1 && g1.box, g1 && g1.source, 'screeningStatus=', s1.screeningStatus);

log('backend', S.backend, 'version', S.db.version, '任务数', S.db.trainTasks.length);
console.log('---- 重载持久化 ----');
const S2 = boot();
const t2 = S2.trainTask(t.id);
console.log('重载后', t2 && t2.status, t2 && t2.phase, 'displays', S2.db.trainDisplays.length, 'queued', t2 && t2.queueWordIds.length);
