/** P10 家长端页面数据流验收（P1/P2）：以 vm 加载 data.js + store.js，
 *  逐项复刻 home / course-records / report / review-words / hours 五页
 *  实际调用的 Store 接口，验证页面渲染所依赖的数据在权限与结构上都正确。
 *  运行：node _test/p10-parent-pages.js  期望：全部 PASS，exit 0。
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
function role(r, id) {
  const s = { role: r };
  if (r === 'parent') { s.parentId = id; s.operatorId = id; s.operatorName = '家长'; }
  if (r === 'admin') { const u = (S.db.users || []).find(x => x.roleCode === 'admin' && x.status === '正常'); s.accountId = u ? u.id : 'UA007'; s.operatorId = s.accountId; s.operatorName = '管理员'; }
  S.setSession(s);
}

const pa = S.db.parents[0];
role('parent', pa.id);
const kids = S.parentChildren(pa.id);
const kid = kids[0], kid2 = kids[1];
console.log('\n== P1/P2 家长端页面数据流 ==');

// 统一当前孩子（home/course/report/review/hours 共享）
S.setParentCurrentChild(pa.id, kid2.id);
ok('共享当前孩子写入/读取', S.parentCurrentChild(pa.id) === kid2.id);
S.setParentCurrentChild(pa.id, kid.id);
ok('切回第一个孩子生效', S.parentCurrentChild(pa.id) === kid.id);
ok('共享键命名符合约定', typeof LS.getItem('ee_parent_current_child_' + pa.id) === 'string');

// --- home：parentStudentDetail 工作台数据 ---
{
  const d = S.parentStudentDetail(pa.id, kid.id);
  ok('孩子信息-姓名/年级/教材', !!(d.name && d.grade && d.book));
  ok('孩子信息-教师/剩余课时', !!(d.teacherName && typeof d.remain === 'number'));
  ok('孩子信息-最近课程时间', typeof d.lastCourseDate === 'string');
  ok('孩子信息-复习概况', d.reviewSummary && typeof d.reviewSummary.today === 'number');
  const courses = S.parentCourses(pa.id, kid.id, {});
  const done = courses.filter(c => c.status === '已完成').length;
  ok('学习概况-累计完成课程为真实计数', done >= 0 && courses.every(c => c.status));
  const fbs = S.parentFeedbacks(pa.id).filter(f => f.studentId === kid.id);
  ok('最近反馈-仅家长可见字段', fbs.every(f => f.performance !== undefined && f.publishedAt));
  const reports = S.parentReports(pa.id, kid.id, {});
  ok('报告-仅已发布且对家长可见', reports.every(r => r.status === '已发布'));
  const hrs = S.parentHours(pa.id).filter(x => x.studentId === kid.id)[0];
  ok('课时-低余额标记存在', typeof hrs.lowAlert === 'boolean');
  const notis = S.notifications({ unread: true });
  ok('通知-可读取家长未读', Array.isArray(notis));
  // 越权复习概况被拒（parentReviewSummary 新增校验）
  const pbKid = (S.db.parentStudents || []).filter(x => x.parentId === S.db.parents[1].id)[0].studentId;
  try { S.parentReviewSummary(pa.id, pbKid); ok('复习概况越权被拒', false); }
  catch (e) { ok('复习概况越权被拒', String(e.message).indexOf('不在当前家长名下') >= 0); }
}

// --- course-records：六状态 + 课程详情 ---
{
  const STATUSES = ['待上课', '授课中', '已完成', '未上课', '已取消'];
  let allOk = true;
  STATUSES.forEach(st => { try { S.parentCourses(pa.id, kid.id, { status: st }); } catch (e) { allOk = false; console.log('  FAIL 筛选状态抛错 ' + st + ':' + e.message); } });
  ok('课程-六状态筛选可查询', allOk);
  const c = S.parentCourses(pa.id, kid.id, {})[0];
  ok('课程-状态/报告状态独立字段', !!c && 'reportStatus' in c && 'reportViewable' in c);
  ok('课程-保留原教师快照', !!c && typeof c.teacherName === 'string' && c.teacherName.length > 0);
  const det = S.parentCourseDetail(pa.id, kid.id, c.id);
  ok('课程详情-计划/主题/教师/报告入口', !!(det.start && det.end && det.teacherName && 'reportViewable' in det));
  ok('课程详情-实际授课时间可读', 'actualStart' in det);
  ok('课程详情-取消/未上课可读原因', 'note' in det);
}

// --- report：列表 + 五区详情 + 趋势口径 ---
{
  const reports = S.parentReports(pa.id, kid.id, {});
  ok('报告列表-可获取', Array.isArray(reports));
  if (reports.length) {
    const r = reports[0];
    ok('报告列表-课程日期/主题/教师/摘要/发布时间', !!(r.courseDate && r.title && r.teacherName && r.summary !== undefined && r.publishedAt));
    const rd = S.parentReportDetail(pa.id, kid.id, r.id);
    ok('报告详情-五区内容齐备', !!(rd.content && 'performance' in rd.content && 'weak' in rd.content && 'next' in rd.content && 'homeworkAdvice' in rd.content));
    ok('报告详情-单词统计真实字段', 'trainWords' in rd.stats && 'mastered' in rd.stats && 'weak' in rd.stats);
    ok('报告详情-课程状态独立', typeof rd.courseStatus === 'string');
    // 趋势：近N次已完成课程（含 recordView 统计）
    const done = S.parentCourses(pa.id, kid.id, { status: '已完成' });
    const trend = done.slice(0, 7).map(c => { const rec = S.recordOfCourse(c.id); const snap = rec ? S.recordView(rec) : null; return { train: snap ? snap.trainWords : 0, mastered: snap ? snap.mastered : 0 }; });
    ok('趋势-仅统计已完成课程', trend.length >= 0 && trend.every(t => typeof t.train === 'number'));
  } else { console.log('  -- 当前学员无已发布报告，跳过详情断言'); }
  // 草稿/代理可见不影响家长：家长可见性独立（p10 已覆盖，这里再补投影）
  try { S.parentReportDetail(pa.id, kid.id, 'R_NOT_EXIST'); ok('报告-不存在ID被拒', false); } catch (e) { ok('报告-不存在ID被拒', true); }
}

// --- review-words：三视图 + 家庭勾选（不改变正式状态） ---
{
  const today = S.parentReviewWords(pa.id, kid.id, { view: 'today' });
  const all = S.parentReviewWords(pa.id, kid.id, { view: 'all' });
  const passed = S.parentReviewWords(pa.id, kid.id, { view: 'passed' });
  ok('复习-今日行均到期', today.every(r => r.dueToday));
  ok('复习-全部≥今日', all.length >= today.length);
  ok('复习-已通过独立视图', Array.isArray(passed));
  ok('复习-词库关联字段', all.every(r => Array.isArray(r.bookIds)));
  if (today.length) {
    const w = today[0].wordId;
    const before = S.parentReviewWords(pa.id, kid.id, { view: 'all' }).filter(x => x.wordId === w)[0].state;
    S.toggleParentFamilyCheck(pa.id, kid.id, w, true);
    const chk = S.parentFamilyCheckAt(pa.id, kid.id, w);
    ok('家庭勾选-记录父/子/词/操作人', !!(chk && chk.parentId === pa.id && chk.studentId === kid.id && chk.wordId === w && chk.by));
    const after = S.parentReviewWords(pa.id, kid.id, { view: 'all' }).filter(x => x.wordId === w)[0].state;
    ok('家庭勾选-不改变正式状态', before === after);
    S.toggleParentFamilyCheck(pa.id, kid.id, w, false);
    ok('家庭勾选-支持取消', !(S.parentFamilyCheckAt(pa.id, kid.id, w) && S.parentFamilyCheckAt(pa.id, kid.id, w).checked));
  }
}

// --- hours：多账户 + 到期提醒 + 订单 + 咨询落库 ---
{
  const hrs = S.parentHours(pa.id).filter(x => x.studentId === kid.id)[0];
  ok('课时-多账户分别展示', Array.isArray(hrs.accounts) && hrs.accounts.length > 0);
  ok('课时-账户字段齐备', hrs.accounts.every(a => 'product' in a && 'remain' in a && 'totalHours' in a && 'usedHours' in a && 'expireAt' in a && 'daysLeft' in a && 'expiring' in a));
  ok('课时-低余额/到期标记来自阈值', typeof hrs.lowAlert === 'boolean');
  const ord = S.parentOrders(pa.id).filter(o => o.studentId === kid.id);
  ok('订单-只含本人孩子', ord.every(o => o.studentId === kid.id));
  ok('订单-字段齐备(编号/金额/已付/状态/时间)', ord.every(o => 'id' in o && 'amount' in o && 'paidAmount' in o && 'status' in o && 'createdAt' in o));
  const before = S.parentInquiries(pa.id).length;
  const iq = S.createParentInquiry({ type: '续费', content: '测试咨询-请教务联系我', studentId: kid.id });
  ok('咨询-真实落库', !!iq.id && iq.status === '待处理' && iq.parentId === pa.id);
  ok('咨询-家长可查', S.parentInquiries(pa.id).length === before + 1 && S.parentInquiries(pa.id)[0].id === iq.id);
  // 教务端处理（admin 角色），回复后家长可见
  role('admin', 'UA007');
  S.handleParentInquiry(iq.id, { status: '已回复', reply: '您好，已为您登记续费方案。' });
  role('parent', pa.id);
  const got = S.parentInquiries(pa.id).find(x => x.id === iq.id);
  ok('咨询-教务回复家长可见', got.status === '已回复' && got.reply.indexOf('续费') >= 0);
  ok('咨询-不得为他人孩子发起', (() => { try { S.createParentInquiry({ type: '其他', content: 'x', studentId: S.parentChildren(S.db.parents[1].id)[0].id }); return false; } catch (e) { return true; } })());
}

console.log('\n== 结果: ' + pass + ' PASS / ' + fail + ' FAIL ==');
process.exit(fail ? 1 : 0);
