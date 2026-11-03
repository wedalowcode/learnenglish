/* 第五阶段：词库申请与授权 · 真实点击验证（覆盖验收场景 7 / 8 / 10） */
const { Page, launch, sleep, ROOT } = require('./cdp');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? ' → ' + JSON.stringify(extra) : '')); }
}
/* 统一账号后身份只能来自真实账号：按角色显式登录，不再依赖旧 ?as= 演示兜底 */
async function loginAs(p, role) {
  return p.eval(`var a=Store.roleAccounts(${JSON.stringify(role)}).filter(x=>x.available)[0];
    if(!a) return false;
    Store.setSession({role:${JSON.stringify(role)},accountId:a.accountId,operatorName:a.name,
      operatorId:a.profileId,teacherId:'',agentId:'',parentId:''});return true;`);
}

(async () => {
  const proc = await launch();
  const p = await Page.open();
  try {
    /* ================= 场景 7：正常词库申请（教师申请 → 管理员审核 → 授权 → 教师可用） ================= */
    await p.goto(ROOT + 'admin/wordbook-request.html?tab=pending&as=ops');
    await loginAs(p, 'ops');
    let r = await p.eval(`
      var st = Store.wordbookRequestStat();
      var gs = Store.wordbookGrantStat();
      return { pending: st.pending, grants: gs.total };`);
    const g0 = r.grants;
    ok('初始待审核 2 条 / 授权 ' + g0 + ' 条', r.pending === 2 && g0 >= 8, r);

    /* 审核通过种子申请 WR20261101001（陈可欣 · WB002） */
    r = await p.eval(`
      var out = Store.reviewWordbookRequest('WR20261101001', { approve: true, remark: '同意，按教材进度开通' });
      var g = Store.wordbookGrantStat();
      return { status: out.request.status, reviewedBy: out.request.reviewedBy, reviewedAt: !!out.request.reviewedAt,
               grant: out.grant && { by: out.grant.approvedBy, from: out.grant.requestId,
                 teacher: out.grant.requestedByTeacherId }, total: g.total };`);
    ok('通过后申请状态「已通过」', r.status === '已通过', r.status);
    ok('记录审核人王敏与时间', r.reviewedBy === '王敏' && r.reviewedAt === true, r);
    ok('授权记录带申请号与申请教师', r.grant && r.grant.from === 'WR20261101001' && r.grant.teacher === 'T001', r.grant);
    ok('授权总数 +1', r.total === g0 + 1, { g0: g0, now: r.total });

    /* 授权后教师立即可用 */
    r = await p.eval(`
      Store.setSession({role:'teacher', operatorName:'李婉', teacherId:'T001'});
      var books = Store.teachingWordbooks('S2026001').map(b=>b.id);
      var canTrain = false;
      try { var t = Store.startTrainTask({ studentId:'S2026001', teacherId:'T001', wordbookId:'WB002' });
            canTrain = !!t.id; Store.cancelTask(t.id); } catch(e){ canTrain = e.message; }
      Store.setSession({role:'ops', operatorName:'王敏'});
      return { books: books, canTrain: canTrain };`);
    ok('授权后教学可用词库包含 WB002', r.books.indexOf('WB002') >= 0, r.books);
    ok('教师能直接用新授权词库开训练', r.canTrain === true, r.canTrain);

    /* 教师再提交两条申请（WB003 + WB004） */
    await p.eval(`
      Store.setSession({role:'teacher', operatorName:'李婉', teacherId:'T001'});
      Store.createWordbookRequests({ studentId:'S2026001', wordbookIds:['WB003','WB004'],
        reason:'11 月开始 Unit 2 之后加练', plan:'先初筛再按错词建莱特纳' });
      Store.setSession({role:'ops', operatorName:'王敏'});`);
    await p.goto(ROOT + 'admin/wordbook-request.html?tab=pending&as=ops');
    await loginAs(p, 'ops');
    r = await p.eval(`return Store.wordbookRequestStat();`);
    ok('教师提交两条后待审核变 3', r.pending === 3, r.pending);

    /* ================= 场景 8：重复申请被识别 ================= */
    r = await p.eval(`
      Store.setSession({role:'teacher', operatorName:'李婉', teacherId:'T001'});
      var out = { err: '' };
      try { Store.createWordbookRequests({ studentId:'S2026001', wordbookIds:['WB001','WB006'], reason:'再申请' }); }
      catch (e) { out.err = e.message; }
      Store.setSession({role:'ops', operatorName:'王敏'});
      return out;`);
    ok('重复申请提示已授权该词库', /已授权/.test(r.err), r.err);

    /* ================= 驳回必填原因 + 批量审核原子性 ================= */
    r = await p.eval(`
      var req = Store.wordbookRequests({ status:'待审核' })
        .filter(x => x.request.studentId === 'S2026001' && x.request.wordbookId === 'WB003')[0];
      var out = { emptyErr: '' };
      try { Store.reviewWordbookRequest(req.request.id, { approve: false, remark: '' }); }
      catch (e) { out.emptyErr = e.message; }
      var g1 = Store.wordbookGrantStat().total;
      var res = Store.reviewWordbookRequest(req.request.id, { approve: false, remark: 'WB003 与当前教材进度不符，暂不开通' });
      var g2 = Store.wordbookGrantStat().total;
      out.status = res.request.status; out.g1 = g1; out.g2 = g2; out.remark = res.request.reviewRemark;
      return out;`);
    ok('驳回不填原因被拦', /原因/.test(r.emptyErr), r.emptyErr);
    ok('填原因后驳回成功且授权数不变', r.status === '已驳回' && r.g1 === r.g2, r);
    ok('驳回原因写入审核记录', /WB003/.test(r.remark), r.remark);

    /* 批量：先给管理员开通 WB004，再批量通过含 WB004 的申请 → 整体回滚 */
    await p.eval(`
      Store.grantWordbook('S2026001', 'WB004', { reason: '管理员先单独开通了 WB004' });`);
    r = await p.eval(`
      var req = Store.wordbookRequests({ status:'待审核' })
        .filter(x => x.request.studentId === 'S2026001' && x.request.wordbookId === 'WB004')[0];
      var g1 = Store.wordbookGrantStat().total;
      var pend1 = Store.wordbookRequestStat().pending;
      var out = { err: '' };
      try { Store.batchReviewWordbookRequests([req.request.id], { approve: true }); } catch (e) { out.err = e.message; }
      var g2 = Store.wordbookGrantStat().total;
      var pend2 = Store.wordbookRequestStat().pending;
      var still = Store.wordbookRequestOf(req.request.id).status;
      return { err: out.err, g1: g1, g2: g2, pend1: pend1, pend2: pend2, still: still };`);
    ok('批量含已授权词库时整体失败', /已经拥有|ALREADY_AUTHORIZED/.test(r.err), r.err);
    ok('授权数与待审核数都没变（原子回滚）', r.g1 === r.g2 && r.pend1 === r.pend2, r);
    ok('该申请仍是待审核', r.still === '待审核', r.still);

    /* 页面上真实勾选 + 批量开通 WB005 的新申请 */
    await p.eval(`
      Store.setSession({role:'teacher', operatorName:'李婉', teacherId:'T001'});
      Store.createWordbookRequests({ studentId:'S2026001', wordbookIds:['WB005'], reason:'六年级衔接词汇' });
      Store.setSession({role:'ops', operatorName:'王敏'});`);
    await p.goto(ROOT + 'admin/wordbook-request.html?tab=pending&as=ops');
    await loginAs(p, 'ops');
    r = await p.eval(`
      var boxes = [...document.querySelectorAll('#reqRows input[type=checkbox]')];
      var target = boxes.find(b => b.dataset.id && Store.wordbookRequestOf(b.dataset.id).wordbookId === 'WB005');
      target.checked = true; updateSelTip();
      var tip = document.getElementById('selTip').textContent;
      var out = S.batchReviewWordbookRequests([target.dataset.id], { approve: true });
      return { tip: tip, opened: out.length };`);
    ok('勾选提示已选 1 条', /已选 1/.test(r.tip), r.tip);
    ok('页面批量开通成功', r.opened === 1, r.opened);

    /* ================= 授权记录：停用 / 启用 / 历史保留 ================= */
    await p.goto(ROOT + 'admin/wordbook-request.html?tab=grant&as=ops');
    await loginAs(p, 'ops');
    r = await p.eval(`
      var g = Store.wordbookGrants({ studentId:'S2026001', wordbookId:'WB002' })[0];
      var out = {};
      try { Store.disableStudentWordbook(g.auth.id, { reason: '' }); } catch (e) { out.emptyErr = e.message; }
      Store.disableStudentWordbook(g.auth.id, { reason: 'Unit 2 暂停，先专注教材词表' });
      var after = Store.wordbookGrants({ studentId:'S2026001', wordbookId:'WB002' })[0];
      out.status = after.auth.status; out.by = after.auth.disabledBy; out.reason = after.auth.disableReason;
      out.totalKept = Store.wordbookGrantStat().total;
      try { Store.disableStudentWordbook(g.auth.id, { reason: '再停' }); } catch (e) { out.dupErr = e.message; }
      return out;`);
    ok('停用不填原因被拦', /原因/.test(r.emptyErr), r.emptyErr);
    ok('停用后状态已停用且记录人/原因', r.status === '已停用' && r.by === '王敏' && /Unit 2/.test(r.reason), r);
    ok('停用不删除记录（总数不变）', r.totalKept === g0 + 3, r.totalKept);
    ok('重复停用被拒', /已经是停用/.test(r.dupErr), r.dupErr);

    /* 教师训练端：停用后不能再开新训练 */
    r = await p.eval(`
      Store.setSession({role:'teacher', operatorName:'李婉', teacherId:'T001'});
      var books = Store.teachingWordbooks('S2026001').map(b=>b.id);
      var err = '';
      try { Store.startTrainTask({ studentId:'S2026001', teacherId:'T001', wordbookId:'WB002' }); }
      catch (e) { err = e.message; }
      Store.setSession({role:'ops', operatorName:'王敏'});
      return { books: books, err: err };`);
    ok('停用后教师可用词库不含 WB002', r.books.indexOf('WB002') < 0, r.books);
    ok('用停用词库开训练被拒', /授权/.test(r.err), r.err);

    /* ================= 学员详情词库授权区 ================= */
    await p.goto(ROOT + 'admin/student-detail.html?id=S2026001');
    r = await p.eval(`
      document.querySelector('[data-pane="p7"]').click();
      return { title: document.querySelector('.page-title').textContent.trim().slice(0,4),
               rows: document.querySelectorAll('#wbRows tr').length,
               count: document.getElementById('wbCount').textContent };`);
    ok('学员详情头部随 id 刷新（陈可欣）', r.title.indexOf('陈可欣') === 0, r.title);
    ok('词库授权区有记录', r.rows >= 1, r.rows);
    ok('授权 tab 计数徽标与记录一致', +r.count === r.rows, { count: r.count, rows: r.rows });
    await p.shot('p6-14-学员详情词库授权');

    /* 主动开通 */
    r = await p.eval(`
      openGrant();
      var opts = [...document.querySelectorAll('#g_wb option')].length;
      var out = { opts: opts, emptyErr: '' };
      try { Store.setWordbookStatus('WB006','启用');Store.grantWordbook('S2026001', 'WB006', { reason: '' }); } catch (e) { out.emptyErr = e.message; }
      var g1 = Store.studentWordbooksOf('S2026001').length;
      Store.grantWordbook('S2026001', 'WB006', { reason: '家长购买新教材，需配套练习' });
      var g2 = Store.studentWordbooksOf('S2026001');
      var newest = g2.find(x => x.auth.wordbookId === 'WB006');
      out.ok = g2.length === g1 + 1 && newest.auth.approvedBy === '张敏' &&
               /管理员主动开通/.test(newest.auth.remark);
      try { Store.grantWordbook('S2026001', 'WB006', { reason: '再开' }); } catch (e) { out.dupErr = e.message; }
      return out;`);
    ok('主动开通不填原因被拦', /原因/.test(r.emptyErr), r.emptyErr);
    ok('主动开通记录操作人与原因', r.ok === true, r);
    ok('重复开通被拒', /已经拥有|有效授权/.test(r.dupErr), r.dupErr);

    /* ================= 训练设置页：授权过滤 + 空态引导 ================= */
    await p.goto(ROOT + 'teacher/word-training-setup.html?student=S2026001');
    r = await p.eval(`
      var active = Store.studentWordbooksOf('S2026001').filter(x=>x.auth.status==='已授权').length;
      return { active: active, rows: document.querySelectorAll('#rows tr').length };`);
    ok('训练设置只显示已授权词库', r.rows === r.active, r);

    /* 全部停用后出现申请引导 */
    await p.eval(`
      Store.setSession({role:'ops', operatorName:'王敏'});
      Store.studentWordbooksOf('S2026001').filter(x => x.auth.status === '已授权')
        .forEach(x => Store.disableStudentWordbook(x.auth.id, { reason: '测试：全部停用' }));
      Store.setSession({role:'teacher', operatorName:'李婉', teacherId:'T001'});`);
    await p.goto(ROOT + 'teacher/word-training-setup.html?student=S2026001');
    r = await p.eval(`return { txt: document.getElementById('rows').innerText.replace(/\\s+/g,' ') };`);
    ok('无授权时显示申请引导', /词库申请/.test(r.txt) && /还没有任何词库授权/.test(r.txt), r.txt.slice(0, 200));
    await p.shot('p6-16-无授权引导');

    /* 历史训练数据不受停用影响 */
    r = await p.eval(`
      var tasks = Store.tasksOf('S2026001').length;
      var states = Store.wordStates('S2026001').length;
      return { tasks: tasks, states: states };`);
    ok('停用不影响历史训练数据（任务 ' + r.tasks + ' / 单词状态 ' + r.states + '）',
      r.tasks > 0 && r.states > 0, r);

    /* 恢复一条授权，训练设置恢复 */
    await p.eval(`
      Store.setSession({role:'ops', operatorName:'王敏'});
      Store.studentWordbooksOf('S2026001').filter(x => x.auth.status === '已停用' && x.auth.wordbookId === 'WB001')
        .forEach(x => Store.enableStudentWordbook(x.auth.id, { reason: '恢复教材词表使用' }));`);
    await p.goto(ROOT + 'teacher/word-training-setup.html?student=S2026001');
    r = await p.eval(`return { rows: document.querySelectorAll('#rows tr').length };`);
    ok('重新启用后训练设置恢复', r.rows === 1, r.rows);

    /* 我的学员：申请词库入口 */
    await p.goto(ROOT + 'teacher/my-students.html');
    r = await p.eval(`return document.getElementById('page').innerText.includes('申请词库');`);
    ok('我的学员页有「申请词库」入口', r === true, r);

    console.log('\n  控制台异常:', p.errors.length ? p.errors : '无');
    console.log(`\n  结果: ${pass} 通过 / ${fail} 失败`);
  } catch (e) {
    console.error('运行失败:', e.message);
    fail++;
  } finally { p.close(); proc.kill(); }
  process.exit(fail ? 1 : 0);
})();
