/** 第十轮 UI 验收：教师工作台 → 课程工作台 → 词库选择 → 初筛追加（真实浏览器）
 *  运行：node _test/r11-teacher-ui.js
 *  说明：使用 _test/cdp 启动 Chrome，file:// 打开原型页面。
 */
const { Page, launch, sleep, ROOT } = require('./cdp');
const ok = [], bad = [];
function assert(name, cond, extra) {
  if (cond) ok.push(name); else bad.push(name + (extra !== undefined ? ' → ' + JSON.stringify(extra) : ''));
}

(async () => {
  const proc = await launch();
  const page = await Page.open();
  const gotoTeacher = async url => {
    await page.goto(ROOT + url);
    await page.eval(`Store.setSession({role:'teacher', teacherId:'T001', operatorName:'李婉'});`);
    await page.goto(ROOT + url);
    await sleep(200);
  };
  try {
    /* 1. 教师工作台：今日课程、状态、会议链接、无脱课入口 */
    await gotoTeacher('teacher/workbench.html');
    const wb = await page.eval(`return {
      title: document.getElementById('pageTitle') ? document.getElementById('pageTitle').textContent : '',
      rows: document.querySelectorAll('#todayCourses tr').length,
      text: document.body.innerText,
      html: document.body.innerHTML,
      grade: (Store.student('S2026001') || {}).grade,
      anchors: Array.from(document.querySelectorAll('a[href*="meeting.tencent.com"]')).map(a => a.href)
    };`);
    assert('工作台显示今日课程 3 节', wb.rows === 3, wb.rows);
    assert('工作台含上课时间段', /09:00|10:15|19:00/.test(wb.text));
    assert('工作台含学员与年级', /陈可欣|付嘉禾/.test(wb.text) && wb.text.indexOf(wb.grade) >= 0,
      wb.grade);
    assert('工作台显示真实腾讯会议链接', wb.anchors.length >= 1 && /^https:\/\/meeting\.tencent\.com\//.test(wb.anchors[0]), wb.anchors);
    assert('工作台不再有脱离课程直接开始单词训练入口', wb.html.indexOf('word-training-setup') < 0);
    const copyBtn = await page.eval(`return document.querySelectorAll('[data-copy]').length;`);
    assert('会议链接支持复制', copyBtn >= 1, copyBtn);

    /* 2. 课程工作台：课程上下文、会议链接、训练入口带 course */
    await gotoTeacher('teacher/course-workbench.html?course=C20261104001');
    const cw = await page.eval(`return {
      sub: document.getElementById('sub').textContent,
      meeting: document.getElementById('meetingBox').textContent,
      links: Array.from(document.querySelectorAll('a')).map(a => a.getAttribute('href') || '')
    };`);
    assert('课程工作台展示课程编号与时间', /C20261104001/.test(cw.sub) && /09:00|10:00/.test(cw.sub), cw.sub);
    assert('课程工作台展示腾讯会议', /meeting\.tencent\.com|待教务补充/.test(cw.meeting), cw.meeting);
    assert('单词训练入口携带 course', cw.links.some(h => h.indexOf('word-training-setup.html?course=C20261104001') >= 0));

    /* 3. 词库选择页：无学员下拉、无数量配置、多选词库 */
    await gotoTeacher('teacher/word-training-setup.html?course=C20261104001');
    const setup = await page.eval(`return {
      stuSelect: !!document.querySelector('select#student, select#studentSel'),
      targetInput: !!document.getElementById('targetCount'),
      quick: Array.from(document.querySelectorAll('button')).filter(b => /^(30|40|45)$/.test(b.textContent.trim())).length,
      checkboxes: document.querySelectorAll('#rows input[type=checkbox]').length,
      rows: document.querySelectorAll('#rows tr').length,
      disabled: document.getElementById('startBtn').disabled,
      text: document.body.innerText
    };`);
    assert('词库选择页不允许切换学员', !setup.stuSelect);
    assert('词库选择页没有训练数量输入', !setup.targetInput);
    assert('词库选择页没有 30/40/45 快捷按钮', setup.quick === 0, setup.quick);
    assert('已开通词库以复选框展示', setup.rows >= 1 && setup.checkboxes === setup.rows, setup.checkboxes);
    assert('未选词库时不能开始', setup.disabled === true);
    assert('页面说明 5/45 固定规则', /最低/.test(setup.text) && /45/.test(setup.text));

    const start1 = await page.eval(`
      var cb = document.querySelector('#rows input[type=checkbox]');
      cb.checked = true; cb.onchange();
      return {sel: Object.keys(selected).length, disabled: document.getElementById('startBtn').disabled};
    `);
    assert('勾选词库后可开始筛查', start1.sel === 1 && start1.disabled === false, start1);

    await page.eval(`
      var before = Store.db.trainTasks.filter(function(t){return t.studentId==='S2026001' && t.status!=='已完成' && t.status!=='已取消';}).length;
      window.__before = before;
      startPrescreen();
    `);
    await sleep(600);
    const url1 = await page.eval(`return location.href;`);
    assert('一次提交两个以上词库的入口带任务与课程',
      /word-training-prescreen\.html\?task=TR\d+&course=C20261104001/.test(url1), url1);
    const taskInfo = await page.eval(`return {
      id: task.id, books: task.wordbookIds.slice(), uniq: new Set(task.wordIds).size, total: task.wordIds.length,
      tasks: Store.db.trainTasks.filter(function(t){return t.studentId==='S2026001' && t.status!=='已完成' && t.status!=='已取消';}).length,
      before: window.__before
    };`);
    assert('同一学员只创建一个未完成任务', taskInfo.tasks === 1, taskInfo);
    assert('任务按基础 Word ID 去重', taskInfo.uniq === taskInfo.total, taskInfo.uniq + '/' + taskInfo.total);

    /* 4. 初筛页：不足 5 提示 + 批量追加词库 */
    await page.eval(`for (var i=0;i<3;i++) answer(cands[i].id, false);`);
    await sleep(300);
    const less5 = await page.eval(`return {
      unknown: Store.prescreenTaskStat(task.id).unknown,
      tip: document.getElementById('genTip').textContent.replace(/\\s+/g,' ').trim(),
      canStart: Store.prescreenTaskStat(task.id).canStart,
      hasTarget: /本次目标|可调 5/.test(document.getElementById('stats').textContent)
    };`);
    assert('不足 5 个显示还差数量与补充提示', /还差 2 个/.test(less5.tip) && /其他词库/.test(less5.tip), less5.tip);
    assert('不足 5 个不能开始', less5.canStart === false);
    assert('统计卡不再出现可调整目标', !less5.hasTarget, less5.hasTarget);

    /* 追加第二个已授权词库：先由管理员授权 WB003，再回教师会话刷新 */
    await page.eval(`
      var u = Store.db.users.filter(function(x){return x.roleCode==='admin';})[0];
      Store.setSession({role:'admin', accountId:u.id, operatorId:u.id, operatorName:'管理员'});
      Store.grantWordbook('S2026001','WB003',{reason:'第十轮 UI 批量追加验收'});
      Store.setSession({role:'teacher', teacherId:'T001', operatorName:'李婉'});
    `);
    await page.goto(ROOT + 'teacher/word-training-prescreen.html?task=' + taskInfo.id + '&course=C20261104001');
    await sleep(300);
    const addArea = await page.eval(`return {
      rows: document.querySelectorAll('#addBookBox .add-row').length,
      checked: document.querySelectorAll('#addBookBox input[type=checkbox]').length
    };`);
    assert('筛查页展示可追加的其他已授权词库', addArea.rows >= 1 && addArea.checked >= 1, addArea);
    await page.eval(`
      var cb = document.querySelector('#addBookBox input[type=checkbox]');
      cb.checked = true; cb.onchange();
      addBooks();
    `);
    await sleep(400);
    const afterAdd = await page.eval(`return {
      books: Store.trainTask(task.id).wordbookIds.slice(),
      prescreens: Store.db.prescreens.filter(function(p){return p.taskId===task.id;}).length,
      tasks: Store.db.trainTasks.filter(function(t){return t.studentId==='S2026001' && t.status!=='已完成' && t.status!=='已取消';}).length,
      filter: bookFilter
    };`);
    assert('批量追加第二个词库成功', afterAdd.books.length === 2, afterAdd.books);
    assert('追加后任务未重建', afterAdd.tasks === 1, afterAdd.tasks);
    assert('追加后已判断结果保留', afterAdd.prescreens === 3, afterAdd.prescreens);
    assert('追加后切到全部词库视图', afterAdd.filter === '', afterAdd.filter);

    /* 5. 继续筛到第 5 个 → 可开始 → 生成队列（不弹确认，5 个全部入队） */
    await page.eval(`
      var done = Store.db.prescreens.filter(function(p){return p.taskId===task.id;}).map(function(p){return p.wordId;});
      var rest = cands.filter(function(c){return done.indexOf(c.id)<0 && !c.excluded;});
      answer(rest[0].id, false); answer(rest[1].id, false);
    `);
    await sleep(300);
    const at5 = await page.eval(`return {
      unknown: Store.prescreenTaskStat(task.id).unknown,
      canStart: Store.prescreenTaskStat(task.id).canStart,
      tip: document.getElementById('genTip').textContent.replace(/\\s+/g,' ').trim()
    };`);
    assert('筛到第 5 个后可以开始', at5.unknown === 5 && at5.canStart === true, at5);
    assert('达到最低数量提示可继续筛查最多 45', /满足最低训练数量/.test(at5.tip) && /45/.test(at5.tip), at5.tip);
    await page.eval(`generate();`);
    await sleep(400);
    const result = await page.eval(`return {
      visible: !document.getElementById('resultArea').classList.contains('hidden'),
      queue: document.getElementById('rQueue').textContent,
      remain: document.getElementById('rRemain').textContent,
      alert: document.getElementById('resAlert').textContent.replace(/\\s+/g,' ').trim(),
      phase: Store.trainTask(task.id).phase
    };`);
    assert('刚好 5 个生成训练队列', result.visible && result.queue === '5' && result.remain === '0', result);
    assert('无「差几个/凑数」多余提示', !/差 |凑数/.test(result.alert), result.alert);
    assert('任务进入强化训练阶段', result.phase === '强化训练', result.phase);

    assert('页面无 JS 异常', page.errors.length === 0, page.errors);
  } catch (e) {
    bad.push('执行异常：' + e.message);
  }
  console.log('\n通过 ' + ok.length + ' 项');
  if (bad.length) { console.log('失败 ' + bad.length + ' 项：'); bad.forEach(b => console.log('  ✗ ' + b)); }
  else console.log('第十轮教师流程 UI 全部通过');
  page.close(); proc.kill();
  process.exit(bad.length ? 1 : 0);
})();
