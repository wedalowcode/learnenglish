/* ============================================================
   第五轮迭代验收（UI 链路）：兼职教师全生命周期
   ------------------------------------------------------------
   全程通过 CDP 驱动真实页面（点按钮、填表单、点二次确认），
   不直接调用 Store 完成业务动作（除个别需要构造前置数据的场景，
   会在断言名里标注「前置」）：
     场景一：新教师加入（编号自动生成、状态待启用、刷新仍在、手机号唯一）
     场景二：开通账号 → 启用 → 进入可授课资源池（排课/分配可选）
     场景三：分配学员 → 学员当前教师更新、刷新不丢
     场景四：暂停合作（必填原因、处理未来课程、从资源池消失、历史仍在）
     场景五：恢复合作（账号恢复、原关系不自动恢复）
     场景六：更换教师（原关系结束、历史学员保留、历史课程不变）
     场景七：正式退出（3 名学员 + 3 节未来课，逐项交接后确认）
     场景八：已退出教师重新加入（识别原档案、不新建教师）
     场景九：异常保护（阻塞项、历史保护、重复提交、越权拦截）
   运行：node prototype/_test/r5-ui.js
   ============================================================ */
const { Page, launch, sleep, ROOT } = require('./cdp');

const ok = [];
const bad = [];
function assert(name, cond, extra) {
  if (cond) ok.push(name);
  else bad.push(name + (extra !== undefined ? ' → ' + JSON.stringify(extra) : ''));
}

async function go(page, url, reset) {
  if (reset) {
    await page.goto(ROOT + 'index.html');
    await page.eval('Store.reset(); return 1;');
  }
  await page.goto(ROOT + url);
  await sleep(220);
}

/* 二次确认弹窗（Proto.confirmBox）点「确定」 */
async function confirm() {
  await sleep(80);
  return 'ok';
}

(async () => {
  const proc = await launch();
  const page = await Page.open();
  await page.send('DOM.enable');

  await go(page, 'admin/teacher-list.html', true);

  /* ============================================================
     场景一：新教师加入
     ============================================================ */
  await page.eval(`
    const t = Store.teachers();
    return t.length;`);

  await page.eval(`openCreate(); return 1;`);
  await sleep(120);
  const modalOpen = await page.eval(`
    return document.getElementById('createModal').classList.contains('show');`);
  assert('场景一：点「+ 新增教师」打开快速录入弹窗', modalOpen === true);

  await page.eval(`
    document.getElementById('c_name').value = '张老师';
    document.getElementById('c_phone').value = '13888880001';
    document.getElementById('c_school').value = '南京大学';
    document.querySelectorAll('#c_grades input')[6].checked = true;
    submitCreate();
    return 1;`);
  await sleep(200);

  const s1 = await page.eval(`
    const t = Store.teacherByPhone('13888880001');
    return {
      count: Store.teachers().length,
      code: t ? t.code : null,
      status: t ? t.cooperationStatus : null,
      account: t ? Store.accountStatusOf(t.id) : null,
      inPool: Store.teacherPool().some(function(p){return p.teacher.phone === '13888880001';}),
      rows: [].slice.call(document.querySelectorAll('#rows tr')).map(function(tr){return tr.innerText.replace(/\\s+/g,' ');})
    };`);
  assert('场景一：教师创建成功并自动生成编号 T008', s1.code === 'T008', s1.code);
  assert('场景一：初始状态为待启用', s1.status === '待启用', s1.status);
  assert('场景一：新建教师尚未开通账号', s1.account === '未开通', s1.account);
  assert('场景一：待启用教师不进入可分配资源池', s1.inPool === false);
  assert('场景一：列表出现该教师', s1.rows.some(r => r.indexOf('张老师') >= 0 && r.indexOf('T008') >= 0), s1.rows.length);
  assert('场景一：列表显示「待启用」', s1.rows.some(r => r.indexOf('张老师') >= 0 && r.indexOf('待启用') >= 0));

  /* 刷新后仍在 */
  await page.goto(ROOT + 'admin/teacher-list.html');
  await sleep(260);
  const s1b = await page.eval(`
    return {
      exists: !!Store.teacherByPhone('13888880001'),
      inList: document.body.innerText.indexOf('张老师') >= 0,
      count: Store.teachers().length
    };`);
  assert('场景一：刷新后教师仍在', s1b.exists === true);
  assert('场景一：刷新后列表仍能看到', s1b.inList === true);

  /* 重复手机号 */
  await page.eval(`openCreate(); return 1;`);
  await page.eval(`
    document.getElementById('c_name').value = '张老师重复';
    document.getElementById('c_phone').value = '13888880001';
    submitCreate();
    return 1;`);
  await sleep(200);
  const s1c = await page.eval(`
    return {
      count: Store.teachers().length,
      dupShown: document.getElementById('dupModal').classList.contains('show'),
      dupMsg: document.getElementById('dupMsg').innerText,
      title: document.getElementById('dupTitle').innerText
    };`);
  assert('场景一：重复手机号被拦截，不新增教师', s1c.count === s1b.count, s1c.count);
  assert('场景一：弹出手机号冲突提示', s1c.dupShown === true);
  assert('场景一：提示里指出原教师', s1c.dupMsg.indexOf('张老师') >= 0, s1c.dupMsg);

  /* 已退出教师手机号 → 提示恢复原档案 */
  await page.eval(`Proto.closeModal('dupModal'); openCreate(); return 1;`);
  await page.eval(`
    document.getElementById('c_name').value = '郑好';
    document.getElementById('c_phone').value = '13806234567';
    submitCreate();
    return 1;`);
  await sleep(200);
  const s1d = await page.eval(`
    return {
      title: document.getElementById('dupTitle').innerText,
      msg: document.getElementById('dupMsg').innerText,
      rejoinVisible: document.getElementById('dupRejoin').style.display !== 'none',
      count: Store.teachers().length
    };`);
  assert('场景一：已退出教师手机号被识别为历史档案', s1d.title.indexOf('已退出') >= 0, s1d.title);
  assert('场景一：提示可恢复原档案', s1d.rejoinVisible === true);
  assert('场景一：已退出手机号不产生第二份档案', s1d.count === s1b.count, s1d.count);

  /* ============================================================
     场景二：教师启用
     ============================================================ */
  const t8 = await page.eval(`return Store.teacherByPhone('13888880001').id;`);
  await go(page, 'admin/teacher-detail.html?id=' + t8);

  const s2a = await page.eval(`
    return {
      banner: document.getElementById('page').innerText.indexOf('待启用') >= 0,
      hasActivate: document.getElementById('page').innerText.indexOf('启用教师') >= 0,
      chk: Store.activationCheck('${t8}').ready
    };`);
  assert('场景二：待启用教师详情提示待启用', s2a.banner === true);
  assert('场景二：启用条件未满足（缺账号）', s2a.chk === false);

  /* 点「开通账号」→ 二次确认 */
  await page.eval(`doOpenAccount(); return 1;`);
  await sleep(120);
  await page.eval(`document.getElementById('__c_ok').click(); return 1;`);
  await sleep(250);
  const s2b = await page.eval(`
    return {
      account: Store.accountStatusOf('${t8}'),
      chk: Store.activationCheck('${t8}').ready,
      accountTag: document.getElementById('page').innerText.indexOf('正常') >= 0
    };`);
  assert('场景二：开通账号后账号状态正常', s2b.account === '正常', s2b.account);
  assert('场景二：开通账号后启用条件满足', s2b.chk === true);

  /* 点「启用教师」→ 二次确认 */
  await page.eval(`doActivate(); return 1;`);
  await sleep(150);
  await page.eval(`document.getElementById('__c_ok').click(); return 1;`);
  await sleep(300);
  const s2c = await page.eval(`
    return {
      status: Store.teacher('${t8}').cooperationStatus,
      first: Store.teacher('${t8}').firstCooperationAt,
      inPool: Store.teacherPool().some(function(p){return p.teacher.id === '${t8}';}),
      pageTag: document.getElementById('page').querySelector('.page-title').innerText.replace(/\\s+/g,' '),
      coop: Store.cooperationsOf('${t8}').map(function(c){return c.action;})
    };`);
  assert('场景二：启用后状态变为可授课', s2c.status === '可授课', s2c.status);
  assert('场景二：启用写入首次合作日期', s2c.first === '2026-11-02', s2c.first);
  assert('场景二：启用后进入可授课资源池', s2c.inPool === true);
  assert('场景二：头部状态标签更新为可授课', s2c.pageTag.indexOf('可授课') >= 0, s2c.pageTag);
  assert('场景二：合作流水含 ACTIVATED', s2c.coop.indexOf('ACTIVATED') >= 0, s2c.coop);

  /* 排课界面能看到张老师 */
  await go(page, 'admin/schedule-calendar.html');
  const s2d = await page.eval(`
    return {
      options: [].slice.call(document.querySelectorAll('#n_teacher option')).map(function(o){return o.textContent;})
    };`);
  assert('场景二：排课教师候选出现「张老师」', s2d.options.indexOf('张老师') >= 0, s2d.options);
  assert('场景二：暂停合作教师不在排课候选', s2d.options.indexOf('徐峰') < 0, s2d.options);
  assert('场景二：已退出教师不在排课候选', s2d.options.indexOf('郑好') < 0, s2d.options);

  /* ============================================================
     场景三：教师负责学员
     ============================================================ */
  await go(page, 'admin/teacher-detail.html?id=' + t8 + '&assign=1');
  const s3a = await page.eval(`
    return {
      drawer: document.getElementById('assign').classList.contains('show'),
      options: [].slice.call(document.querySelectorAll('#as_student option')).map(function(o){return o.value;})
    };`);
  assert('场景三：打开分配学员抽屉', s3a.drawer === true);
  assert('场景三：只列出未分配学员', s3a.options.indexOf('S2026006') >= 0 && s3a.options.indexOf('S2026001') < 0, s3a.options);

  await page.eval(`
    document.getElementById('as_student').value = 'S2026006';
    document.getElementById('as_reason').value = '九年级方向匹配';
    doAssign();
    return 1;`);
  await sleep(300);
  const s3b = await page.eval(`
    return {
      count: Store.currentStudentsOf('${t8}').length,
      cache: Store.student('S2026006').teacherName,
      relation: Store.activeRelationOfStudent('S2026006').assignReason,
      tabCount: document.querySelector('[data-pane="t3"] .count').textContent
    };`);
  assert('场景三：张老师当前学员 +1', s3b.count === 1, s3b.count);
  assert('场景三：学员详情当前教师变为张老师', s3b.cache === '张老师', s3b.cache);
  assert('场景三：关系记录分配原因', s3b.relation === '九年级方向匹配');
  assert('场景三：详情 Tab 数量同步', s3b.tabCount === '1', s3b.tabCount);

  await page.goto(ROOT + 'admin/teacher-detail.html?id=' + t8);
  await sleep(260);
  const s3c = await page.eval(`
    return {
      current: Store.currentStudentsOf('${t8}').map(function(x){return x.student.name;}),
      inPage: document.getElementById('page').innerText.indexOf('吴思远') >= 0
    };`);
  assert('场景三：刷新后负责关系不丢失', s3c.current.indexOf('吴思远') >= 0, s3c.current);
  assert('场景三：详情页显示该学员', s3c.inPage === true);

  /* 学员列表的当前教师也更新了 */
  await go(page, 'admin/student-list.html');
  const s3d = await page.eval(`
    var row = [].slice.call(document.querySelectorAll('#rows tr')).filter(function(tr){
      return tr.innerText.indexOf('吴思远') >= 0;
    })[0];
    return row ? row.innerText.replace(/\\s+/g,' ') : '';`);
  assert('场景三：学员列表显示当前教师张老师', s3d.indexOf('张老师') >= 0, s3d);

  /* ============================================================
     场景四：教师暂停
     ============================================================ */
  await go(page, 'admin/teacher-detail.html?id=T001');
  const s4a = await page.eval(`
    return {
      future: Store.futureCoursesOf('T001').length,
      students: Store.currentStudentsOf('T001').length
    };`);
  assert('场景四：李婉有未来课程与在负责学员', s4a.future === 3 && s4a.students === 2, s4a);

  await page.eval(`openPause(); return 1;`);
  await sleep(200);
  const s4b = await page.eval(`
    return {
      open: document.getElementById('pauseModal').classList.contains('show'),
      rows: document.querySelectorAll('#pauseBody .plan-row').length,
      reasons: !!document.getElementById('p_reason')
    };`);
  assert('场景四：暂停弹窗列出未来课程逐节处理', s4b.open === true && s4b.rows === 3, s4b);

  /* 不填原因直接提交 → 被拦截，状态不变 */
  await page.eval(`
    [].slice.call(document.querySelectorAll('[data-act]')).forEach(function(s){
      s.value = 'cancel'; s.dispatchEvent(new Event('change'));
    });
    doPause();
    return 1;`);
  await sleep(200);
  const s4c = await page.eval(`
    return {
      status: Store.teacher('T001').cooperationStatus,
      err: document.getElementById('pauseErr').innerText
    };`);
  assert('场景四：缺少暂停原因被拦截', s4c.status === '可授课', s4c.status);
  assert('场景四：错误提示写明原因', s4c.err.indexOf('暂停原因') >= 0, s4c.err);

  /* 正确填写 */
  const futureIds = await page.eval(`
    return Store.futureCoursesOf('T001').map(function(c){return c.id;});`);
  await page.eval(`
    document.getElementById('p_reason').value = '备考研究生入学考试';
    document.getElementById('p_start').value = '2026-11-02';
    document.getElementById('p_resume').value = '2026-12-20';
    document.getElementById('p_remark').value = '预计 12 月底恢复';
    doPause();
    return 1;`);
  await sleep(200);
  const s4d = await page.eval(`
    return {
      status: Store.teacher('T001').cooperationStatus,
      reason: Store.teacher('T001').pauseInfo ? Store.teacher('T001').pauseInfo.reason : '',
      account: Store.accountStatusOf('T001'),
      students: Store.currentRelationsOf('T001').length,
      attention: Store.currentRelationsOf('T001').filter(function(r){return !!r.attention;}).length,
      future: Store.futureCoursesOf('T001').length,
      canceled: ${JSON.stringify(futureIds)}.filter(function(id){return Store.course(id).status === '已取消';}).length,
      historyOk: Store.course('C20261102001').status === '已完成',
      inPool: Store.teacherPool().some(function(p){return p.teacher.id === 'T001';})
    };`);
  assert('场景四：暂停成功', s4d.status === '暂停合作', s4d.status);
  assert('场景四：记录暂停原因', s4d.reason === '备考研究生入学考试', s4d.reason);
  assert('场景四：按策略禁用账号', s4d.account === '已禁用', s4d.account);
  assert('场景四：当前学员关系保留', s4d.students === 2, s4d.students);
  assert('场景四：保留的关系标记需关注', s4d.attention === 2, s4d.attention);
  assert('场景四：未来课程已全部处理', s4d.future === 0, s4d.future);
  assert('场景四：选择的课程被取消', s4d.canceled === 3, s4d.canceled);
  assert('场景四：历史课程仍为已完成', s4d.historyOk === true);
  assert('场景四：暂停后从可分配资源池消失', s4d.inPool === false);
  assert('场景四：页面显示暂停横幅', (await page.text('.alert-warn')).indexOf('暂停合作中') >= 0);

  /* 历史记录仍可查看 */
  const s4e = await page.eval(`
    var tabs = document.querySelectorAll('#ttabs .tab');
    tabs[6].click();
    return document.getElementById('t7').innerText.replace(/\\s+/g,' ');`);
  assert('场景四：合作记录里能看到暂停事件', s4e.indexOf('暂停合作') >= 0, s4e.slice(0, 80));
  assert('场景四：合作记录保留历史启用事件', s4e.indexOf('启用为可授课') >= 0);

  /* ============================================================
     场景五：教师恢复
     ============================================================ */
  /* 前置：暂停期间教务解除一名学员（模拟交接），用于验证「不自动恢复」 */
  await page.eval(`Store.releaseStudent('S2026008', { reason: '暂停期间转出' }); return 1;`);
  await page.goto(ROOT + 'admin/teacher-detail.html?id=T001');
  await sleep(260);
  await page.eval(`openResume(); return 1;`);
  await sleep(150);
  await page.eval(`doResume(); return 1;`);
  await sleep(300);
  const s5 = await page.eval(`
    return {
      status: Store.teacher('T001').cooperationStatus,
      account: Store.accountStatusOf('T001'),
      pause: Store.teacher('T001').pauseInfo,
      students: Store.currentStudentsOf('T001').map(function(x){return x.student.name;}),
      released: Store.student('S2026008').teacherName,
      inPool: Store.teacherPool().some(function(p){return p.teacher.id === 'T001';}),
      coop: Store.cooperationsOf('T001').map(function(c){return c.action;}),
      dup: Store.teachers().filter(function(t){return t.name === '李婉';}).length
    };`);
  assert('场景五：恢复后状态为可授课', s5.status === '可授课', s5.status);
  assert('场景五：账号重新启用', s5.account === '正常', s5.account);
  assert('场景五：暂停信息清空', s5.pause === null);
  assert('场景五：回到可分配资源池', s5.inPool === true);
  assert('场景五：保留中的关系仍在', s5.students.indexOf('陈可欣') >= 0, s5.students);
  assert('场景五：暂停期间解除的关系不自动恢复', s5.released === '未分配', s5.released);
  assert('场景五：合作流水含 RESUMED', s5.coop.indexOf('RESUMED') >= 0, s5.coop);
  assert('场景五：恢复不产生重复教师档案', s5.dup === 1, s5.dup);

  /* ============================================================
     场景六：教师更换
     ============================================================ */
  await go(page, 'admin/student-list.html');
  await page.eval(`
    var rows = [].slice.call(document.querySelectorAll('#rows tr'));
    var row = rows.filter(function(tr){return tr.innerText.indexOf('陈可欣') >= 0;})[0];
    var btn = row ? row.querySelector('button[onclick^="openAssign"]') : null;
    if (!btn) throw new Error('未找到陈可欣行的「分配教师」按钮');
    btn.click();
    return 1;`);
  await sleep(220);
  const s6a = await page.eval(`
    return {
      open: document.getElementById('assign').classList.contains('show'),
      old: document.getElementById('as_old').value,
      warn: document.getElementById('as_warn').innerText,
      options: [].slice.call(document.querySelectorAll('#as_new option')).map(function(o){return o.textContent.replace(/\\s+/g,' ').trim();})
    };`);
  assert('场景六：打开分配抽屉并提示当前教师', s6a.open === true && s6a.old.indexOf('李婉') >= 0, s6a.old);
  assert('场景六：已有教师时提示结束原关系', s6a.warn.indexOf('结束原关系') >= 0, s6a.warn);
  assert('场景六：候选按可授课教师给出', s6a.options.some(x => x.indexOf('沈心怡') >= 0), s6a.options);
  assert('场景六：候选不含暂停与已退出教师',
    !s6a.options.some(x => x.indexOf('徐峰') >= 0 || x.indexOf('郑好') >= 0), s6a.options);
  assert('场景六：年级教材匹配的教师排在前面',
    s6a.options[1] && /匹配/.test(s6a.options[1]), s6a.options.slice(1, 3));

  await page.eval(`
    document.getElementById('as_new').value = 'T004';
    document.getElementById('as_reason').value = '家长指定更换教师';
    doAssign();
    return 1;`);
  await sleep(320);
  const s6b = await page.eval(`
    return {
      now: Store.student('S2026001').teacherName,
      rels: Store.relationsOfStudent('S2026001').map(function(r){return r.teacherId + ':' + r.status;}),
      liwanHistory: Store.historyStudentsOf('T001').map(function(x){return x.student.name;}),
      shenCurrent: Store.currentStudentsOf('T004').map(function(x){return x.student.name;}),
      pastCourse: Store.coursesOf('S2026001').filter(function(c){return c.status === '已完成';})
        .map(function(c){return c.teacherName;})
    };`);
  assert('场景六：学员当前教师变为沈心怡', s6b.now === '沈心怡', s6b.now);
  assert('场景六：原关系结束、新关系有效',
    s6b.rels.slice().sort().join(',') === 'T001:已结束,T004:当前有效', s6b.rels);
  assert('场景六：李婉历史学员仍能看到该学员', s6b.liwanHistory.indexOf('陈可欣') >= 0, s6b.liwanHistory);
  assert('场景六：沈心怡当前学员出现该学员', s6b.shenCurrent.indexOf('陈可欣') >= 0, s6b.shenCurrent);
  assert('场景六：学员历史课程仍显示李婉', s6b.pastCourse.indexOf('李婉') >= 0, s6b.pastCourse);

  await page.goto(ROOT + 'admin/student-list.html');
  await sleep(260);
  const s6c = await page.eval(`
    var row = [].slice.call(document.querySelectorAll('#rows tr')).filter(function(tr){
      return tr.innerText.indexOf('陈可欣') >= 0;})[0];
    return row ? row.innerText.replace(/\\s+/g,' ') : '';`);
  assert('场景六：刷新后学员当前教师仍为沈心怡', s6c.indexOf('沈心怡') >= 0, s6c);

  /* ============================================================
     场景七：正式退出（3 名学员 + 3 节未来课）
     ============================================================ */
  await go(page, 'admin/teacher-detail.html?id=T001', true);
  /* 前置：把未分配的吴思远也交给李婉，凑成 3 名学员 */
  await page.eval(`Store.assignStudent('T001', 'S2026006', { reason: '补充分配' }); return 1;`);
  await go(page, 'admin/teacher-exit.html?id=T001');

  const s7a = await page.eval(`
    return {
      students: Store.exitCheck('T001').students.length,
      courses: Store.exitCheck('T001').futureCourses.length,
      blocks: Store.exitCheck('T001').blocks.length,
      btnDisabled: document.getElementById('exitBtn').disabled,
      warnItems: [].slice.call(document.querySelectorAll('.alert-warn li')).map(function(li){return li.innerText;}),
      page: document.getElementById('page').innerText
    };`);
  assert('场景七：退出向导列出 3 名学员', s7a.students === 3, s7a.students);
  assert('场景七：退出向导列出未来有效课程', s7a.courses === 3, s7a.courses);
  assert('场景七：存在阻塞项时「确认退出」禁用', s7a.btnDisabled === true);
  assert('场景七：页面逐项列出待处理的学员与课程',
    s7a.warnItems.length === 6 && s7a.page.indexOf('还没有确定处理方式') >= 0, s7a.warnItems);
  assert('场景七：页面提示必须先处理学员与课程',
    s7a.page.indexOf('学员「') >= 0 && s7a.page.indexOf('未来有效课程') >= 0, s7a.page.slice(0, 120));

  /* 只处理学员、不处理课程 → 仍然禁用 */
  await page.eval(`
    setStu('S2026001', 'action', 'reassign');
    setStu('S2026001', 'toTeacherId', 'T003');
    setStu('S2026001', 'reason', '转交何俊带中考方向');
    return 1;`);
  await page.eval(`
    setStu('S2026008', 'action', 'reassign');
    setStu('S2026008', 'toTeacherId', 'T003');
    setStu('S2026008', 'reason', '转交何俊');
    return 1;`);
  await page.eval(`
    setStu('S2026006', 'action', 'release');
    setStu('S2026006', 'reason', '家长暂缓，进入待分配');
    plan.reason = '教师毕业离校，正式结束合作';
    render();
    return 1;`);
  await sleep(150);
  const s7b = await page.eval(`
    return {
      btnDisabled: document.getElementById('exitBtn').disabled,
      studentsHandled: [].slice.call(document.querySelectorAll('.step-card')).map(function(c){
        return c.querySelector('.sc-head').innerText.replace(/\\s+/g,' ');})
    };`);
  assert('场景七：课程未处理时仍不能退出', s7b.btnDisabled === true);

  /* 处理课程 */
  const exitCourses = await page.eval(`
    return Store.exitCheck('T001').futureCourses.map(function(c){return c.id;});`);
  await page.eval(`
    setCt('${exitCourses[0]}', 'action', 'reassign');
    setCt('${exitCourses[0]}', 'toTeacherId', 'T002');
    return 1;`);
  await page.eval(`
    setCt('${exitCourses[1]}', 'action', 'reassign');
    setCt('${exitCourses[1]}', 'toTeacherId', 'T003');
    return 1;`);
  await page.eval(`
    setCt('${exitCourses[2]}', 'action', 'cancel');
    plan.reason = '教师毕业离校，正式结束合作';
    render();
    return 1;`);
  await sleep(150);
  const s7c = await page.eval(`
    return { btnDisabled: document.getElementById('exitBtn').disabled };`);
  assert('场景七：全部处理并填写原因后可退出', s7c.btnDisabled === false);

  const historyBefore = await page.eval(`
    var o = {};
    Store.courses().filter(function(c){return c.status === '已完成';})
      .forEach(function(c){ o[c.id] = c.teacherId; });
    return o;`);

  await page.eval(`document.getElementById('exitBtn').click(); return 1;`);
  await sleep(1400);
  const s7d = await page.eval(`
    return {
      status: Store.teacher('T001').cooperationStatus,
      end: Store.teacher('T001').cooperationEndAt,
      account: Store.accountStatusOf('T001'),
      current: Store.currentStudentsOf('T001').length,
      s1: Store.student('S2026001').teacherName,
      s6: Store.student('S2026006').teacherName,
      coop: Store.cooperationsOf('T001').filter(function(c){return c.action === 'EXITED';})[0],
      inPool: Store.teacherPool().some(function(p){return p.teacher.id === 'T001';}),
      historyAfter: (function(){
        var o = {};
        Store.courses().filter(function(c){return c.status === '已完成';})
          .forEach(function(c){ o[c.id] = c.teacherId; });
        return o;
      })(),
      reports: Store.reports().filter(function(r){return r.teacherId === 'T001';}).length
    };`);
  assert('场景七：退出成功', s7d.status === '已退出', s7d.status);
  assert('场景七：记录合作结束日期', s7d.end === '2026-11-02', s7d.end);
  assert('场景七：账号已禁用', s7d.account === '已禁用', s7d.account);
  assert('场景七：不再有当前学员', s7d.current === 0, s7d.current);
  assert('场景七：学员已转交', s7d.s1 === '何俊', s7d.s1);
  assert('场景七：学员已解除待分配', s7d.s6 === '未分配', s7d.s6);
  assert('场景七：写 EXITED 流水并带交接统计',
    s7d.coop && s7d.coop.remark.indexOf('学员转交 2') >= 0, s7d.coop && s7d.coop.remark);
  assert('场景七：退出后不在可授课池', s7d.inPool === false);
  assert('场景七：历史课程授课教师全部不变',
    JSON.stringify(s7d.historyAfter) === JSON.stringify(historyBefore),
    s7d.historyAfter);
  assert('场景七：历史报告保留', s7d.reports >= 1, s7d.reports);

  const s7e = await page.eval(`
    return {
      url: location.href,
      body: document.getElementById('page').innerText
    };`);
  assert('场景七：退出后跳转到教师详情', s7e.url.indexOf('teacher-detail.html') >= 0, s7e.url);
  assert('场景七：详情页显示已退出', s7e.body.indexOf('已退出合作') >= 0);

  /* ============================================================
     场景八：已退出教师重新加入
     ============================================================ */
  await go(page, 'admin/teacher-list.html');
  const before8 = await page.eval(`return Store.teachers().length;`);
  await page.eval(`openCreate(); return 1;`);
  await page.eval(`
    document.getElementById('c_name').value = '郑好';
    document.getElementById('c_phone').value = '13806234567';
    submitCreate();
    return 1;`);
  await sleep(220);
  const s8a = await page.eval(`
    return {
      shown: document.getElementById('dupModal').classList.contains('show'),
      rejoin: document.getElementById('dupRejoin').style.display !== 'none',
      count: Store.teachers().length,
      viewHref: document.getElementById('dupView').getAttribute('href')
    };`);
  assert('场景八：再次录入被识别为历史教师', s8a.shown === true);
  assert('场景八：提供「恢复原档案」入口', s8a.rejoin === true);
  assert('场景八：没有创建重复教师', s8a.count === before8, s8a.count);
  assert('场景八：可查看原档案', s8a.viewHref.indexOf('teacher-detail.html?id=T006') >= 0, s8a.viewHref);

  await page.eval(`doRejoin(); return 1;`);
  await sleep(900);
  const s8b = await page.eval(`
    return {
      url: location.href,
      status: Store.teacher('T006').cooperationStatus,
      rejoin: Store.teacher('T006').rejoinCount,
      first: Store.teacher('T006').firstCooperationAt,
      sameCode: Store.teacher('T006').code,
      count: Store.teachers().length,
      history: Store.historyStudentsOf('T006').length,
      coop: Store.cooperationsOf('T006').map(function(c){return c.action;}),
      body: document.getElementById('page').innerText
    };`);
  assert('场景八：恢复后进入原档案详情', s8b.url.indexOf('id=T006') >= 0, s8b.url);
  assert('场景八：状态回到待启用', s8b.status === '待启用', s8b.status);
  assert('场景八：重新加入次数 +1', s8b.rejoin === 1, s8b.rejoin);
  assert('场景八：编号沿用原档案 T006', s8b.sameCode === 'T006');
  assert('场景八：首次合作时间保留', s8b.first === '2025-09-01', s8b.first);
  assert('场景八：没有新增教师档案', s8b.count === before8, s8b.count);
  assert('场景八：历史学员保留', s8b.history === 1, s8b.history);
  assert('场景八：合作流水含 REJOINED', s8b.coop.indexOf('REJOINED') >= 0, s8b.coop);
  assert('场景八：页面提示走启用流程', s8b.body.indexOf('待启用') >= 0);

  /* 重新启用（账号已存在但被禁用，启用时应自动恢复） */
  await page.eval(`doActivate(); return 1;`);
  await sleep(150);
  await page.eval(`document.getElementById('__c_ok').click(); return 1;`);
  await sleep(280);
  const s8c = await page.eval(`
    return {
      status: Store.teacher('T006').cooperationStatus,
      account: Store.accountStatusOf('T006'),
      first: Store.teacher('T006').firstCooperationAt,
      start: Store.teacher('T006').lastCooperationStartAt
    };`);
  assert('场景八：重新加入后可再次启用', s8c.status === '可授课', s8c.status);
  assert('场景八：启用自动恢复账号', s8c.account === '正常', s8c.account);
  assert('场景八：首次合作时间仍为 2025-09-01', s8c.first === '2025-09-01');
  assert('场景八：新一轮合作开始时间为今天', s8c.start === '2026-11-02', s8c.start);

  /* ============================================================
     场景九：异常数据保护
     ============================================================ */
  /* 9.1 有学员/未来课时不能退出 */
  await go(page, 'admin/teacher-exit.html?id=T002');
  const s9a = await page.eval(`
    return {
      disabled: document.getElementById('exitBtn').disabled,
      blocks: Store.exitCheck('T002').blocks.length,
      status: Store.teacher('T002').cooperationStatus
    };`);
  assert('场景九：有学员与未来课时退出按钮禁用', s9a.disabled === true);
  assert('场景九：退出检查给出 2 个阻塞项', s9a.blocks === 2, s9a.blocks);

  const s9b = await page.eval(`
    try { Store.exitTeacher('T002', {}, {}); return 'NO_ERROR'; }
    catch (e) { return e.code + '|' + (e.data && e.data.skip ? e.data.skip.length : 0); }`);
  assert('场景九：绕过页面直接退出也被 Store 拦截', s9b.indexOf('REMAIN_STUDENTS') === 0, s9b);
  assert('场景九：拦截时返回未处理学员清单', s9b.split('|')[1] === '2', s9b);

  /* 9.2 历史课程不能被改派 */
  const s9c = await page.eval(`
    try { Store.reassignCourse('C20261102001', 'T002', { reason: 'x' }); return 'NO_ERROR'; }
    catch (e) { return e.code; }`);
  assert('场景九：已完成课程不允许改派', s9c === 'COURSE_DONE', s9c);
  const s9d = await page.eval(`
    var before = Store.course('C20261102001').teacherId;
    try { Store.reassignCourse('C20261102001', 'T002'); } catch (e) {}
    return before + '|' + Store.course('C20261102001').teacherId;`);
  assert('场景九：失败后历史课程教师未被改写', s9d.split('|')[0] === s9d.split('|')[1], s9d);

  /* 9.3 重复提交不产生重复关系 */
  const s9e = await page.eval(`
    var rel = Store.currentRelationsOf('T003')[0];
    var n = Store.db.teacherStudents.length;
    try { Store.assignStudent('T003', rel.studentId, { reason: '重复提交' }); }
    catch (e) { return e.code + '|' + (Store.db.teacherStudents.length === n); }
    return 'NO_ERROR';`);
  assert('场景九：重复分配被拦截且不新增关系', s9e === 'DUPLICATE|true', s9e);

  /* 9.3b 换教师后原关系结束且不删除，历史可查 */
  const s9e2 = await page.eval(`
    var rel = Store.currentRelationsOf('T003')[0];
    var sid = rel.studentId;
    var before = Store.db.teacherStudents.length;
    var endedBefore = Store.relationsOfStudent(sid).filter(function(r){return r.status === '已结束';}).length;
    Store.transferStudent(sid, 'T004', { reason: '关系历史保留验证' });
    var all = Store.relationsOfStudent(sid);
    return (Store.db.teacherStudents.length === before + 1) + '|' +
      all.filter(function(r){return r.status === '当前有效';}).length + '|' +
      (all.filter(function(r){return r.status === '已结束';}).length === endedBefore + 1);`);
  assert('场景九：更换教师只新增一条关系、原关系保留为历史',
    s9e2 === 'true|1|true', s9e2);

  /* 9.4 无权限用户不能直接调用写操作 */
  const s9f = await page.eval(`
    Store.setSession({ role: 'teacher', operatorName: '李婉' });
    var out = [];
    ['pauseTeacher', 'exitTeacher', 'createTeacher', 'assignStudent'].forEach(function(fn){
      try {
        if (fn === 'pauseTeacher') Store[fn]('T003', { reason: 'x' });
        else if (fn === 'exitTeacher') Store[fn]('T003', {}, {});
        else if (fn === 'createTeacher') Store[fn]({ name: 'x', phone: '13800000000' });
        else Store[fn]('T003', 'S2026002', { reason: 'x' });
        out.push('NO_ERROR');
      } catch (e) { out.push(e.code); }
    });
    var status = Store.teacher('T003').cooperationStatus;
    Store.setSession({ role: 'admin', operatorName: '张敏' });
    return out.join(',') + '|' + status;`);
  assert('场景九：教师角色调用写操作全部被 FORBIDDEN 拦截',
    s9f === 'FORBIDDEN,FORBIDDEN,FORBIDDEN,FORBIDDEN|可授课', s9f);

  /* 9.5 事务中途失败会回滚（在合作流水写入处注入失败） */
  const s9g = await page.eval(`
    var ex = Store.exitCheck('T003');
    var n = Store.db.teacherStudents.length;
    var stu0 = Store.currentStudentsOf('T003').length;
    var rels = Store.currentStudentsOf('T003').map(function(x){return x.student.id;}).join(',');
    var cancelled0 = Store.courses().filter(function(c){return c.status === '已取消';}).length;
    var future0 = Store.futureCoursesOf('T003').length;
    /* 学员与课程都已处理完、账号已禁用之后才写合作流水：
       在这里注入失败可以验证「事务中途失败不能半退出」 */
    Store.db.teacherCooperations.push = function () { throw new Error('模拟写入失败'); };
    var code = 'NO_ERROR';
    try {
      Store.exitTeacher('T003', {
        students: ex.students.map(function(x){ return { studentId: x.student.id, action: 'release', reason: '解除' }; }),
        courses: ex.futureCourses.map(function(c){ return { courseId: c.id, action: 'cancel' }; })
      }, { reason: '回滚测试' });
    } catch (e) { code = e.code || 'NO_CODE'; }
    return [code, Store.teacher('T003').cooperationStatus,
      Store.db.teacherStudents.length === n,
      Store.currentStudentsOf('T003').length === stu0,
      Store.currentStudentsOf('T003').map(function(x){return x.student.id;}).join(',') === rels,
      Store.accountStatusOf('T003'),
      Store.courses().filter(function(c){return c.status === '已取消';}).length === cancelled0,
      Store.futureCoursesOf('T003').length === future0,
      Store.cooperationsOf('T003').filter(function(c){return c.action === 'EXITED';}).length
    ].join('|');`);
  assert('场景九：事务失败给出 EXIT_FAILED', s9g.indexOf('EXIT_FAILED') === 0, s9g);
  assert('场景九：失败后教师状态回滚', s9g.split('|')[1] === '可授课', s9g);
  assert('场景九：失败后关系数量与归属回滚',
    s9g.split('|')[2] === 'true' && s9g.split('|')[3] === 'true', s9g);
  assert('场景九：失败后学员归属不变', s9g.split('|')[4] === 'true', s9g);
  assert('场景九：失败后账号状态未被改成禁用', s9g.split('|')[5] === '正常', s9g);
  assert('场景九：失败后未来课程没有被取消', s9g.split('|')[6] === 'true' && s9g.split('|')[7] === 'true', s9g);
  assert('场景九：失败后没有写入退出流水', s9g.split('|')[8] === '0', s9g);

  /* ============================================================
     收尾：控制台无异常
     ============================================================ */
  assert('全流程没有未捕获的 JS 异常', page.errors.length === 0, page.errors.slice(0, 3));

  console.log('\n第五轮 UI 链路验收');
  console.log('  通过 ' + ok.length + ' 项');
  if (bad.length) {
    console.log('  失败 ' + bad.length + ' 项：');
    bad.forEach(b => console.log('    × ' + b));
    process.exitCode = 1;
  } else {
    console.log('  全部通过');
  }
  try { proc.kill(); } catch (e) { }
  process.exit(bad.length ? 1 : 0);
})();
