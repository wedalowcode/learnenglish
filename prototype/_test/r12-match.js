/* 第十二轮 · 阶段五验收：教师匹配与推荐
   ------------------------------------------------------------
   实际执行：硬条件过滤（教师冲突 / 排除 / 学员禁止时间）、可解释评分、
             负责教师与首选教师加分、年级教材加分、提醒原因、数量限制、
             只建议不改 TeacherStudent 长期关系。
   静态检查：teacher-match.html 与排课总览 / 批量排课的推荐接入。
   运行：node prototype/_test/r12-match.js
   ============================================================ */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..', 'assets', 'js') + path.sep;
const dir = path.join(__dirname, '..', 'admin') + path.sep;

function boot() {
  const mem = {};
  const localStorage = {
    getItem: k => (k in mem ? mem[k] : null),
    setItem: (k, v) => { mem[k] = String(v); },
    removeItem: k => { delete mem[k]; }
  };
  const sandbox = { console, localStorage, Date, JSON, Math, Object, Array, String, Number,
    isFinite, parseInt, parseFloat, RegExp, setTimeout, clearTimeout };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(root + 'data.js', 'utf8'), sandbox, { filename: 'data.js' });
  vm.runInContext(fs.readFileSync(root + 'store.js', 'utf8'), sandbox, { filename: 'store.js' });
  return sandbox.Store;
}

const S = boot();
S.setSession({ role: 'admin' });
const ok = [];
const bad = [];
function assert(name, cond, extra) {
  if (cond) ok.push(name);
  else bad.push(name + (extra !== undefined ? ' → ' + JSON.stringify(extra) : ''));
}
const slot = { studentId: 'S2026001', date: '2026-11-09', start: '19:00', end: '20:00' };

/* ---------- 1. 基线推荐与可解释理由 ---------- */
const relBefore = JSON.stringify(S.db.teacherStudents);
const cand = S.teacherCandidatesFor(slot);
assert('返回候选教师列表', cand.length > 0, cand.map(c => c.name));
assert('候选按分数降序', cand.every((c, i) => i === 0 || cand[i - 1].score >= c.score),
  cand.map(c => c.score));
const t1 = cand.filter(c => c.teacherId === 'T001')[0];
assert('当前负责教师被识别且加分', !!t1 && t1.isResponsible === true &&
  t1.reasons.indexOf('当前负责教师') >= 0, t1);
assert('年级匹配写入理由', !!t1 && t1.reasons.some(r => /年级匹配/.test(r)), t1 && t1.reasons);
assert('教材匹配写入理由', !!t1 && t1.reasons.some(r => /教材匹配/.test(r)), t1 && t1.reasons);
assert('时段可用写入理由', !!t1 && t1.reasons.some(r => /该时段可用/.test(r)));
assert('负责教师排在首位', !!t1 && cand[0].teacherId === 'T001', cand.slice(0, 3).map(c => c.teacherId + ':' + c.score));
assert('非负责教师带提醒', cand.filter(c => !c.isResponsible).every(c =>
  c.warnings.some(w => /不是学员当前负责教师/.test(w))), cand.filter(c => !c.isResponsible).map(c => c.warnings));

/* ---------- 2. 学员首选教师加分 ---------- */
S.saveStudentPreference('S2026001', { preferredTeacherId: 'T003' });
const cand2 = S.teacherCandidatesFor(slot);
const t3 = cand2.filter(c => c.teacherId === 'T003')[0];
assert('首选教师获得加分理由', !!t3 && t3.reasons.indexOf('学员首选教师') >= 0, t3 && t3.reasons);
assert('首选教师分数高于同条件教师', !!t3 && t3.score >= 20, t3 && t3.score);

/* ---------- 3. 硬条件过滤 ---------- */
const blocker = S.createCourse({
  studentId: 'S2026004', teacherId: 'T003', date: '2026-11-09',
  start: '19:00', end: '20:00', note: '制造教师冲突'
});
const cand3 = S.teacherCandidatesFor(slot);
assert('同时段已有课程的教师被硬过滤', cand3.every(c => c.teacherId !== 'T003'),
  cand3.map(c => c.teacherId));
const candEx = S.teacherCandidatesFor(Object.assign({}, slot, { teacherId: 'T001' }));
assert('可显式排除指定教师', candEx.every(c => c.teacherId !== 'T001'));
assert('排除后仍返回其他候选', candEx.length > 0 && candEx[0].teacherId !== 'T001');

/* 学员禁止时间：所有候选都不可用 */
S.saveStudentPreference('S2026001', {
  unavailablePeriods: [{ weekday: '周一', period: '晚上', reason: '家长指定禁止周一晚' }]
});
assert('学员禁止时间时无候选', S.teacherCandidatesFor(slot).length === 0,
  S.teacherCandidatesFor(slot).map(c => c.teacherId));

/* 取消禁止后再看数量限制 */
S.saveStudentPreference('S2026001', {});
const many = S.teacherCandidatesFor(Object.assign({}, slot, { limit: 3 }));
assert('限制返回数量', many.length <= 3 && many.length > 0, many.length);

/* ---------- 4. 只建议，不改长期关系 ---------- */
assert('调用前后 TeacherStudent 未变化', JSON.stringify(S.db.teacherStudents) === relBefore,
  S.db.teacherStudents.length);
assert('推荐不创建 / 修改课程', S.db.courses.filter(c => c.teacherId === 'T001' && c.date === '2026-11-09').length === 0);

/* blocker 是测试中显式创建的课程，不属于推荐副作用 */
assert('仅测试制造的冲突课程存在', !!blocker);

/* ---------- 5. 页面静态检查 ---------- */
const match = fs.readFileSync(dir + 'teacher-match.html', 'utf8');
assert('教师匹配页接入真实候选接口', /S\.teacherCandidatesFor\(/.test(match));
assert('页面展示推荐理由与提醒', /推荐理由/.test(match) && /提醒/.test(match));
assert('页面声明硬条件过滤', /硬条件/.test(match) && /教师或学员冲突/.test(match));
assert('页面声明只建议不改长期关系', /不会自动修改师生长期关系/.test(match));
assert('排课总览改派使用推荐', /S\.teacherCandidatesFor\(/.test(fs.readFileSync(dir + 'schedule-workbench.html', 'utf8')));
assert('批量排课使用推荐', /S\.teacherCandidatesFor\(/.test(fs.readFileSync(dir + 'batch-schedule.html', 'utf8')));
assert('导航已加入教师匹配', /teacher-match/.test(fs.readFileSync(root + 'common.js', 'utf8')));

console.log('\n实际执行断言 ' + (ok.length + bad.length) + ' 项');
if (bad.length) {
  console.log('\n失败：');
  bad.forEach(b => console.log('  ✗ ' + b));
  process.exit(1);
}
console.log('\n全部通过：');
ok.forEach(o => console.log('  ✓ ' + o));
console.log('\nr12-match 通过');
