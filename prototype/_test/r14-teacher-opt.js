/** 教师端优化 · 数据层验收
 *  - 今日课程含报告状态、统计、待写报告、需要关注学员
 *  - 今日到期复习合并计数（莱特纳 + 21 天）
 *  - 本节课建议（到期/薄弱词/通过率）
 *  - 报告自动带数（对齐课程记录快照）
 *  - 教师归属 / 课程上下文隔离
 *  运行：node _test/r14-teacher-opt.js
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
function roleTeacher(tid) { const u = (S.db.users || []).find(x => x.roleCode === 'teacher' && (x.teacherId === tid || x.profileId === tid)); S.setSession({ role: 'teacher', teacherId: tid, operatorId: tid, operatorName: '教师', accountId: u ? u.id : '' }); }

console.log('\n== 教师端优化 · 数据层验收 ==');
let TID = '', SID = '';
for (const s of (S.db.students || [])) { const rel = S.activeRelationOfStudent(s.id); if (rel && rel.teacherId && (S.db.teachers || []).some(t => t.id === rel.teacherId)) { TID = rel.teacherId; SID = s.id; break; } }
ok('找到教师与其负责学员', TID && SID, TID + '/' + SID);
roleTeacher(TID);

/* ---- 1. 今日概览 ---- */
const ov = S.teacherTodayOverview(TID, S.TODAY);
ok('今日概览返回课程数组', Array.isArray(ov.courses));
ok('课程含报告状态字段', ov.courses.every(c => typeof c.reportStatus === 'string'));
ok('课程统计与课程数一致', ov.stat.total === ov.courses.length, ov.stat.total + '/' + ov.courses.length);
ok('课程均属于当前教师', ov.courses.every(c => c.teacherId === TID || c.teacherId === undefined));
ok('待写报告仅含编辑中/已提交', ov.pendingReports.every(r => r.status === '编辑中' || r.status === '已提交'));
ok('关注学员为数组', Array.isArray(ov.attention));
ok('待写报告计数一致', ov.pendingDraft === ov.pendingReports.filter(r => r.status === '编辑中').length, ov.pendingDraft);

/* ---- 2. 今日到期复习合并计数 ---- */
const due = S.teacherDueReviewSummary(SID);
const dueD = S.leitnerDueDetail(SID);
const p21 = S.plan21TodaySummary(SID);
ok('到期合并-莱特纳=leitnerDueDetail.total', due.leitner === (dueD ? dueD.total : 0), due.leitner + '/' + (dueD ? dueD.total : 0));
ok('到期合并-21天=plan21TodaySummary.due', due.plan21 === (p21 ? p21.due : 0), due.plan21 + '/' + (p21 ? p21.due : 0));
ok('到期合并-总=两者之和', due.total === due.leitner + due.plan21, due.total);

/* ---- 3. 本节课建议 ---- */
const adv = S.teacherLessonAdvice(SID);
ok('建议-到期数=合并到期', adv.dueReview === due.total, adv.dueReview + '/' + due.total);
ok('建议-薄弱词为数组', Array.isArray(adv.weakWords));
ok('建议-通过率为空或0-100', adv.lastPassRate === null || (adv.lastPassRate >= 0 && adv.lastPassRate <= 100), adv.lastPassRate);

/* ---- 4. 报告自动带数对齐课程记录 ---- */
const myCourse = (S.coursesOfTeacher(TID) || [])[0];
if (myCourse) {
  const auto = S.courseRecordAutoData(myCourse.id);
  const rec = S.recordOfCourse(myCourse.id);
  const v = rec ? S.recordView(rec) : null;
  ok('自动带数-训练单词对齐', auto.trainWords === (v ? v.trainWords : 0), auto.trainWords);
  ok('自动带数-掌握/待加强对齐', auto.mastered === (v ? v.mastered : 0) && auto.weak === (v ? v.weak : 0));
  ok('自动带数-复习词(莱特纳+21天)对齐', auto.leitnerWords === (v ? v.leitnerWords : 0) && auto.plan21Words === (v ? v.plan21Words : 0));
  ok('自动带数-文章句对齐', auto.articleSentences === (v ? v.articleSentences : 0));
} else console.log('  (当前教师无课程，自动带数样例跳过)');

/* ---- 5. 教师归属 / 课程隔离 ---- */
const otherCourse = (S.db.courses || []).find(c => c.teacherId && c.teacherId !== TID);
if (otherCourse) throws('他教师课程-自动带数被拒', () => S.courseRecordAutoData(otherCourse.id), '不是当前教师');
const otherStudent = (S.db.students || []).find(s => { const r = S.activeRelationOfStudent(s.id); return !r || r.teacherId !== TID; });
if (otherStudent) throws('他学员-到期摘要被拒', () => S.teacherDueReviewSummary(otherStudent.id), '不在你当前负责');
/* 概览不泄漏他教师课程 */
ok('今日概览不包含他教师课程', ov.courses.every(c => c.teacherId === TID || !c.teacherId));

/* ---- 6. 报告状态统计（工作台/教学记录用） ---- */
const rs = S.reportStat(TID);
ok('报告统计含 draft/submitted/published', typeof rs.draft === 'number' && typeof rs.submitted === 'number' && typeof rs.published === 'number', JSON.stringify(rs));

console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败');
process.exit(fail ? 1 : 0);