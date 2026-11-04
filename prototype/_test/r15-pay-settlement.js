/** 第十二轮 · 教师课时费与月度结算 数据层验收（场景 1-12）
 *  运行：node _test/r15-pay-settlement.js
 */
const vm = require('node:vm'), fs = require('fs');
const DATA = fs.readFileSync('assets/js/data.js', 'utf8');
const STORE = fs.readFileSync('assets/js/store.js', 'utf8');

let pass = 0, fail = 0;
function ok(n, c, x) { if (c) { pass++; console.log('  PASS ' + n + (x !== undefined ? '  (' + x + ')' : '')); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? '  (' + x + ')' : '')); } }
function throws(n, fn, sub) { try { fn(); fail++; console.log('  FAIL ' + n + '  — 未抛错'); } catch (e) { const m = String((e && e.message) || e); if (!sub || m.indexOf(sub) >= 0) { pass++; console.log('  PASS ' + n + '  (' + m + ')'); } else { fail++; console.log('  FAIL ' + n + '  — 错误不符:' + m); } } }

function fresh() {
  const mem = {};
  const LS = { getItem: k => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); }, removeItem: k => { delete mem[k]; } };
  const ctx = { console, localStorage: LS, sessionStorage: LS, Date, Math, JSON, Object, Array, String, Number, setTimeout };
  ctx.globalThis = ctx; ctx.window = ctx; vm.createContext(ctx);
  vm.runInContext(DATA, ctx, { filename: 'data.js' });
  vm.runInContext(STORE, ctx, { filename: 'store.js' });
  const S = ctx.Store;
  const au = (S.db.users || []).find(x => x.roleCode === 'admin');
  S.setSession({ role: 'admin', accountId: au ? au.id : '', operatorId: au ? au.id : 'admin', operatorName: '管理员' });
  return S;
}
function readyTeachers(S) { return (S.db.teachers || []).filter(t => t.cooperationStatus === '可授课'); }
function rule(S, tid, ct, yuan, from) { return S.createPayRule({ teacherId: tid, courseType: ct, pricingMode: '按小时', unitPrice: yuan, effectiveFrom: from || '2026-01-01' }); }
let fid = 0;
function pushFee(S, o) {
  const id = 'TLF-X' + (++fid);
  S.db.teacherLessonFees.push({
    id: id, teacherId: o.teacherId, studentId: o.studentId || 'S', courseId: o.courseId || ('CX' + fid),
    teacherName: '', courseDate: o.date, courseType: o.ct, lessonMode: '一对一',
    scheduledStart: o.date + ' 09:00', scheduledEnd: o.date + ' 10:00',
    actualStart: o.date + ' 09:00', actualEnd: o.date + ' 10:00',
    payableMinutes: 60, payableHours: 1, pricingMode: '按小时', unitPriceCents: o.unit || 8000,
    amountCents: o.amountCents, ruleId: '', ruleSnapshot: null,
    status: o.status || '待结算', settlementId: '', exceptionReason: '', createdAt: o.date + ' 10:00'
  });
  return id;
}

/* ---------------- 场景 1：体验课正常完成 ---------------- */
console.log('\n== 场景1 体验课完成计费 ==');
{
  const S = fresh(); const T = readyTeachers(S)[0]; const stu = S.db.students[0];
  rule(S, T.id, '体验课', 80);
  const D = S.TODAY;
  const c = S.createCourse({ studentId: stu.id, teacherId: T.id, date: D, start: '20:00', end: '21:00', courseType: '体验课', lessonMode: '一对一' });
  c.actualStart = D + ' 20:00'; c.actualEnd = D + ' 21:00'; c.status = '已完成'; S.save();
  const fee = S.generateLessonFee(c.id).fee;
  ok('体验课课时费=8000分', fee.amountCents === 8000, fee.amountCents);
  ok('课时费归属该教师', fee.teacherId === T.id);
  ok('课程计费状态=已计费', S.course(c.id).teacherFeeState === '已计费');
  ok('未扣学员课时不影响计费', S.course(c.id).deductState !== '已扣课' || fee.amountCents > 0);
}

/* ---------------- 场景 2：正式课完成计费（与扣课独立） ---------------- */
console.log('\n== 场景2 正式课完成计费 ==');
{
  const S = fresh(); const T = readyTeachers(S)[0]; const stu = S.db.students[0];
  rule(S, T.id, '正式课', 100);
  const D = S.TODAY;
  const now = new Date();
  const pad2 = n => String(n).padStart(2, '0');
  let minsAgo = now.getHours() * 60 + now.getMinutes() - 60; if (minsAgo < 0) minsAgo = 0;
  const startHm = pad2(Math.floor(minsAgo / 60)) + ':' + pad2(minsAgo % 60);
  const c = S.createCourse({ studentId: stu.id, teacherId: T.id, date: D, start: '21:00', end: '22:00', courseType: '正式课', lessonMode: '一对一' });
  S.openCourse(c.id, { allowDone: true });
  S.course(c.id).actualStart = D + ' ' + startHm; S.save();
  const r = S.finishCourse(c.id, { policy: '保留', by: '教师' });
  ok('finishCourse 生成课时费', r.fee && r.fee.amountCents > 0, r.fee && r.fee.amountCents);
  const flows = S.db.flows.filter(f => f.courseId === c.id && Number(f.delta) < 0);
  ok('学员扣课独立记账', flows.length === 1, flows.length);
  ok('课时费与扣课是两条账务', r.fee.teacherId === T.id && flows[0].studentId === stu.id);
}

/* ---------------- 场景 3：取消课程 ---------------- */
console.log('\n== 场景3 取消不生成计费 ==');
{
  const S = fresh(); const T = readyTeachers(S)[0]; const stu = S.db.students[0];
  rule(S, T.id, '正式课', 100);
  const c = S.createCourse({ studentId: stu.id, teacherId: T.id, date: S.TODAY, start: '22:00', end: '23:00', courseType: '正式课' });
  S.cancelCourse(c.id, '家长临时取消');
  ok('取消课程不生成课时费', S.generateLessonFee(c.id).ok === false && !S.db.teacherLessonFees.some(f => f.courseId === c.id));
  ok('取消课程不扣学员课时', S.db.flows.filter(f => f.courseId === c.id).length === 0);
}

/* ---------------- 场景 4：未上课 ---------------- */
console.log('\n== 场景4 未上课不生成计费 ==');
{
  const S = fresh(); const T = readyTeachers(S)[0]; const stu = S.db.students[0];
  rule(S, T.id, '正式课', 100);
  const c = S.createCourse({ studentId: stu.id, teacherId: T.id, date: S.TODAY, start: '22:00', end: '23:00', courseType: '正式课' });
  c.status = '未上课'; c.missedReason = '学员临时请假'; S.save();
  ok('未上课不生成课时费', S.generateLessonFee(c.id).ok === false && !S.db.teacherLessonFees.some(f => f.courseId === c.id));
  ok('未上课原因保留', S.course(c.id).missedReason === '学员临时请假');
  ok('未上课不扣课时', S.db.flows.filter(f => f.courseId === c.id).length === 0);
}

/* ---------------- 场景 5：规则版本 ---------------- */
console.log('\n== 场景5 计费规则版本 ==');
{
  const S = fresh(); const T = readyTeachers(S)[0]; const stu = S.db.students[0];
  const oldR = rule(S, T.id, '体验课', 80, '2026-11-01');
  function feeAt(date) {
    const c = S.createCourse({ studentId: stu.id, teacherId: T.id, date: date, start: '06:00', end: '07:00', courseType: '体验课' });
    c.actualStart = date + ' 06:00'; c.actualEnd = date + ' 07:00'; c.status = '已完成'; S.save();
    return S.generateLessonFee(c.id).fee;
  }
  const fNov = feeAt('2026-11-15');
  const newR = rule(S, T.id, '体验课', 90, '2026-12-01');
  const fDec = feeAt('2026-12-15');
  ok('11月按旧规则 8000', fNov.amountCents === 8000, fNov.amountCents);
  ok('12月按新规则 9000', fDec.amountCents === 9000, fDec.amountCents);
  ok('旧规则被截断到 11-30', S.payRule(oldR.id).effectiveTo === '2026-11-30', S.payRule(oldR.id).effectiveTo);
  ok('11月历史金额不随新规则变化', S.db.teacherLessonFees.filter(f => f.id === fNov.id)[0].amountCents === 8000);
  ok('生效规则按日期命中', S.activePayRule(T.id, '体验课', '2026-11-15').id === oldR.id && S.activePayRule(T.id, '体验课', '2026-12-15').id === newR.id);
  throws('已用规则禁止改价', () => S.updatePayRule(oldR.id, { unitPriceCents: 1 }), '已用于历史计费');
}

/* ---------------- 场景 6：教师改派 ---------------- */
console.log('\n== 场景6 教师改派归属 ==');
{
  const S = fresh(); const Rs = readyTeachers(S); const T1 = Rs[0], T2 = Rs[1] || Rs[0]; const stu = S.db.students[0];
  rule(S, T1.id, '正式课', 100); rule(S, T2.id, '正式课', 120);
  const c = S.createCourse({ studentId: stu.id, teacherId: T1.id, date: S.TODAY, start: '06:00', end: '07:00', courseType: '正式课' });
  S.updateCourse(c.id, { teacherId: T2.id, reason: '教师临时调整' });
  ok('未完成课程可改派', S.course(c.id).teacherId === T2.id);
  let fee1 = S.generateLessonFee(c.id);
  ok('改派后未完成不生成', fee1.ok === false);
  const cc = S.course(c.id); cc.actualStart = S.TODAY + ' 06:00'; cc.actualEnd = S.TODAY + ' 07:00'; cc.status = '已完成'; S.save();
  const fee2 = S.generateLessonFee(c.id).fee;
  ok('按实际授课教师计费(T2)', fee2.teacherId === T2.id && fee2.amountCents === 12000, fee2.teacherId + '/' + fee2.amountCents);
  ok('原教师未产生该课计费', !S.db.teacherLessonFees.some(f => f.courseId === c.id && f.teacherId === T1.id));
  throws('已完成课程禁止改派', () => S.updateCourse(c.id, { teacherId: T1.id }), '已完成课程不能修改');
}

/* ---------------- 场景 7：重复完成幂等 ---------------- */
console.log('\n== 场景7 重复完成幂等 ==');
{
  const S = fresh(); const T = readyTeachers(S)[0]; const stu = S.db.students[0];
  rule(S, T.id, '体验课', 80);
  const c = S.createCourse({ studentId: stu.id, teacherId: T.id, date: S.TODAY, start: '20:00', end: '21:00', courseType: '体验课' });
  S.openCourse(c.id, { allowDone: true });
  S.course(c.id).actualStart = S.TODAY + ' 20:00'; S.save();
  const r1 = S.finishCourse(c.id, { policy: '保留' });
  const r2 = S.finishCourse(c.id, { policy: '保留' });
  ok('重复完成被拒', r1.ok === true && r2.ok === false);
  ok('课时费仅 1 条', S.db.teacherLessonFees.filter(f => f.courseId === c.id).length === 1);
  ok('扣课仅 1 次', S.db.flows.filter(f => f.courseId === c.id && Number(f.delta) < 0).length === 1);
  ok('报告仅 1 份', S.db.reports.filter(x => x.courseId === c.id).length === 1);
}

/* ---------------- 场景 8：月度结算 ---------------- */
console.log('\n== 场景8 月度结算可追溯不重入 ==');
{
  const S = fresh(); const T = readyTeachers(S)[0];
  const P = S.currentSettlementPeriod('2026-12-20');
  for (let i = 0; i < 3; i++) pushFee(S, { teacherId: T.id, date: '2026-11-25', ct: '体验课', amountCents: 8000 });
  for (let i = 0; i < 18; i++) pushFee(S, { teacherId: T.id, date: '2026-11-26', ct: '正式课', amountCents: 10000, unit: 10000 });
  const g = S.generateSettlements({ periodStart: P.periodStart, periodEnd: P.periodEnd });
  ok('生成 1 张结算单', g.created.length === 1, g.created.length);
  const s = g.created[0];
  ok('体验课 3 节/24000', s.experienceCount === 3 && s.experienceAmountCents === 24000, s.experienceCount + '/' + s.experienceAmountCents);
  ok('正式课 18 节/180000', s.formalCount === 18 && s.formalAmountCents === 180000, s.formalCount + '/' + s.formalAmountCents);
  ok('应付总额 204000', s.totalAmountCents === 204000, s.totalAmountCents);
  const items = S.settlementItemsOf(s.id);
  ok('明细 21 条且可追溯课程', items.length === 21 && items.every(it => it.courseId && it.feeId), items.length);
  ok('明细回写课时费已结算', S.db.teacherLessonFees.filter(f => f.settlementId === s.id && f.status === '已结算').length === 21);
  const g2 = S.generateSettlements({ periodStart: P.periodStart, periodEnd: P.periodEnd });
  ok('再次生成不重复纳入', g2.created.length === 0 && S.db.teacherSettlements.filter(x => x.teacherId === T.id && x.periodStart === P.periodStart).length === 1);
}

/* ---------------- 场景 9：异议处理 ---------------- */
console.log('\n== 场景9 教师异议 ==');
{
  const S = fresh(); const T = readyTeachers(S)[0];
  const P = S.currentSettlementPeriod('2026-12-20');
  pushFee(S, { teacherId: T.id, date: '2026-11-25', ct: '体验课', amountCents: 8000 });
  const g = S.generateSettlements({ periodStart: P.periodStart, periodEnd: P.periodEnd });
  const sid = g.created[0].id;
  const tu = (S.db.users || []).find(x => x.roleCode === 'teacher' && (x.teacherId === T.id || x.profileId === T.id));
  S.setSession({ role: 'teacher', teacherId: T.id, operatorId: T.id, operatorName: '教师', accountId: tu ? tu.id : '' });
  const d = S.addSettlementDispute({ settlementId: sid, type: '时长异议', reason: '实际授课 90 分钟', expectAmountCents: 4000 });
  ok('教师可提异议', d.status === '待处理');
  const feeBefore = JSON.stringify(S.db.teacherLessonFees[0]);
  const au = (S.db.users || []).find(x => x.roleCode === 'admin');
  S.setSession({ role: 'admin', accountId: au ? au.id : '', operatorId: au ? au.id : 'admin', operatorName: '管理员' });
  S.handleSettlementDispute(d.id, { status: '已处理', opinion: '核查属实', createAdjustment: true, adjustDir: '补发', adjustAmountCents: 4000 });
  ok('机构处理异议并生成调整', S.db.teacherSettlementDisputes.filter(x => x.id === d.id)[0].status === '已处理' && S.settlementAdjustmentsOf(sid).length === 1);
  ok('原始计费记录未被覆盖', JSON.stringify(S.db.teacherLessonFees[0]) === feeBefore);
  ok('调整未审核前不计入', S.settlementOf(sid).totalAmountCents === 8000, S.settlementOf(sid).totalAmountCents);
  const adjId = S.settlementAdjustmentsOf(sid)[0].id;
  S.reviewSettlementAdjustment(adjId, true, '通过');
  ok('调整审核后计入 12000', S.settlementOf(sid).totalAmountCents === 12000, S.settlementOf(sid).totalAmountCents);
}

/* ---------------- 场景 10：部分付款 ---------------- */
console.log('\n== 场景10 部分付款 ==');
{
  const S = fresh(); const T = readyTeachers(S)[0];
  const P = S.currentSettlementPeriod('2026-12-20');
  for (let i = 0; i < 3; i++) pushFee(S, { teacherId: T.id, date: '2026-11-25', ct: '体验课', amountCents: 8000 });
  for (let i = 0; i < 19; i++) pushFee(S, { teacherId: T.id, date: '2026-11-26', ct: '正式课', amountCents: 10000, unit: 10000 });
  const sid = S.generateSettlements({ periodStart: P.periodStart, periodEnd: P.periodEnd }).created[0].id;
  const tu = (S.db.users || []).find(x => x.roleCode === 'teacher' && (x.teacherId === T.id || x.profileId === T.id));
  S.setSession({ role: 'teacher', teacherId: T.id, operatorId: T.id, operatorName: '教师', accountId: tu ? tu.id : '' });
  S.teacherConfirmSettlement(sid);
  const au = (S.db.users || []).find(x => x.roleCode === 'admin');
  S.setSession({ role: 'admin', accountId: au ? au.id : '', operatorId: au ? au.id : 'admin', operatorName: '管理员' });
  ok('应付 214000（2140元）', S.settlementOf(sid).totalAmountCents === 214000, S.settlementOf(sid).totalAmountCents);
  S.addSettlementPayment({ settlementId: sid, amountCents: 100000, paymentDate: '2026-12-20' });
  ok('首付 1000 元→部分付款', S.settlementOf(sid).status === '部分付款' && S.settlementOf(sid).paidAmountCents === 100000, S.settlementOf(sid).status);
  S.addSettlementPayment({ settlementId: sid, amountCents: 114000, paymentDate: '2026-12-21' });
  ok('补付 1140→已付款', S.settlementOf(sid).status === '已付款' && S.settlementOf(sid).unpaidAmountCents === 0, S.settlementOf(sid).status);
  ok('付款记录可逐笔查询(2 笔)', S.settlementPaymentsOf(sid).length === 2);
  throws('超付被拒', () => S.addSettlementPayment({ settlementId: sid, amountCents: 1 }), '不能超过应付');
}

/* ---------------- 场景 11：300 名教师规模 ---------------- */
console.log('\n== 场景11 300 教师规模 ==');
{
  const S = fresh();
  const P = S.currentSettlementPeriod('2026-12-20');
  const t0 = Date.now();
  for (let i = 0; i < 300; i++) {
    const tid = 'T-SCALE-' + i;
    S.db.teachers.push({ id: tid, code: 'TS' + i, name: '规模教师' + i, cooperationStatus: '可合作' });
    pushFee(S, { teacherId: tid, date: '2026-11-25', ct: '体验课', amountCents: 8000 });
    pushFee(S, { teacherId: tid, date: '2026-11-26', ct: '正式课', amountCents: 10000, unit: 10000 });
  }
  const g = S.generateSettlements({ periodStart: P.periodStart, periodEnd: P.periodEnd });
  const dt = Date.now() - t0;
  ok('生成 300 张结算单', g.created.length === 300, g.created.length);
  ok('每张金额 18000 汇总正确', g.created.every(s => s.totalAmountCents === 18000));
  ok('结算耗时 < 5s', dt < 5000, dt + 'ms');
  const st = S.settlementStat({ periodStart: P.periodStart, periodEnd: P.periodEnd });
  ok('统计人数 300/总额 5400000', st.teachers === 300 && st.totalAmountCents === 5400000, st.teachers + '/' + st.totalAmountCents);
  const t1 = Date.now();
  S.settlementList({ periodStart: P.periodStart, periodEnd: P.periodEnd });
  ok('列表查询 < 1s', (Date.now() - t1) < 1000, (Date.now() - t1) + 'ms');
}

/* ---------------- 场景 12：结算边界 ---------------- */
console.log('\n== 场景12 结算边界 ==');
{
  const S = fresh(); const T = readyTeachers(S)[0];
  const p20 = S.currentSettlementPeriod('2026-12-20');
  const p21 = S.currentSettlementPeriod('2026-12-21');
  ok('20日周期=11-21~12-20', p20.periodStart === '2026-11-21' && p20.periodEnd === '2026-12-20', p20.periodStart + '~' + p20.periodEnd);
  ok('21日周期=12-21~01-20', p21.periodStart === '2026-12-21' && p21.periodEnd === '2027-01-20', p21.periodStart + '~' + p21.periodEnd);
  pushFee(S, { teacherId: T.id, date: '2026-12-20', ct: '体验课', amountCents: 8000 });
  pushFee(S, { teacherId: T.id, date: '2026-12-21', ct: '体验课', amountCents: 8000 });
  const g = S.generateSettlements({ periodStart: p20.periodStart, periodEnd: p20.periodEnd });
  ok('20日当天课程纳入本期', g.created[0].experienceCount === 1, g.created[0].experienceCount);
  ok('21日课程不进入本期(仍待结算)', S.db.teacherLessonFees.filter(f => f.courseDate === '2026-12-21' && f.status === '待结算').length === 1);
  // 补录同周期遗漏课程
  pushFee(S, { teacherId: T.id, date: '2026-12-01', ct: '体验课', amountCents: 8000 });
  const g2 = S.generateSettlements({ periodStart: p20.periodStart, periodEnd: p20.periodEnd });
  ok('已关闭周期补录不重复建单', g2.created.length === 0 && g2.skipped.length === 1);
  ok('补录明细保留待结算(走补充/调整)', S.db.teacherLessonFees.filter(f => f.courseDate === '2026-12-01' && f.status === '待结算').length === 1);
  // 21日课程进入下期
  const g3 = S.generateSettlements({ periodStart: p21.periodStart, periodEnd: p21.periodEnd });
  ok('下期纳入 21 日课程', g3.created.length === 1 && g3.created[0].experienceCount === 1, g3.created.length);
}

console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败');
process.exit(fail ? 1 : 0);