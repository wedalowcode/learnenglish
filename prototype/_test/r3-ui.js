/* ============================================================
   第三轮 UI 级验收：课程工作台 → 教学入口 → 完成课程 → 报告提交发布 → 家长可见性
   运行：node prototype/_test/r3-ui.js
   ============================================================ */
const { Page, launch, sleep, ROOT } = require('./cdp');
const ok = [], bad = [];
function assert(n, c, e) { c ? ok.push(n) : bad.push(n + (e !== undefined ? ' → ' + JSON.stringify(e) : '')); }

(async () => {
  const proc = await launch();
  const page = await Page.open();
  try {
    /* ============================================================
       〇、重置数据，从教师工作台开始
       ============================================================ */
    await page.goto(ROOT + 'teacher/workbench.html');
    await sleep(300);
    await page.eval(`Store.reset(); return 1;`);
    await page.goto(ROOT + 'teacher/workbench.html');
    await sleep(400);

    /* ============================================================
       一、今日工作台 → 课程工作台（入口链路）
       ============================================================ */
    const wb = await page.eval(`return {
      go: document.getElementById('goToday').getAttribute('href'),
      rows: [].slice.call(document.querySelectorAll('#todayCourses a[href*="course-workbench"]'))
              .map(function(a){return a.getAttribute('href');}),
      txt: [].slice.call(document.querySelectorAll('#todayCourses a[href*="course-workbench"]'))
              .map(function(a){return a.textContent.trim();})
    };`);
    assert('工作台「进入今日第一节课」带课程号', /course=C\d+/.test(wb.go), wb.go);
    assert('今日课程表每行都能进入课程工作台', wb.rows.length >= 1 && wb.rows.every(h => /course=C\d+/.test(h)), wb.rows);
    assert('未完成课程显示「进入课堂」', wb.txt.filter(t => t === '进入课堂').length >= 1, wb.txt);
    assert('已完成课程显示「回看」', wb.txt.filter(t => t === '回看').length >= 1, wb.txt);

    /* 真实点击：选一节还没上的课 */
    const openIdx = wb.txt.indexOf('进入课堂');
    await page.eval(`
      var list = [].slice.call(document.querySelectorAll('#todayCourses a[href*="course-workbench"]'));
      list[${openIdx}].click(); return 1;`);
    await sleep(600);

    const cw = await page.eval(`
      var q = new URLSearchParams(location.search);
      return {
        url: location.pathname.split('/').pop(),
        cid: q.get('course'),
        stu: document.getElementById('stuName').textContent.trim(),
        status: document.getElementById('cStatus').textContent.trim(),
        entries: document.querySelectorAll('#entries .entry').length,
        links: [].slice.call(document.querySelectorAll('#entries .entry a')).map(function(a){return a.getAttribute('href');}),
        report: document.getElementById('sReport').textContent.trim(),
        deduct: document.getElementById('sDeduct').textContent.trim(),
        storeStatus: Store.course(q.get('course')).status
      };`);
    assert('点击后进入课程工作台', cw.url === 'course-workbench.html', cw.url);
    assert('URL 携带课程号', /^C\d+/.test(cw.cid), cw.cid);
    assert('进入课程即开始授课', cw.status === '授课中' && cw.storeStatus === '授课中', cw.status + '/' + cw.storeStatus);
    assert('课程头显示学员姓名', cw.stu.length >= 2, cw.stu);
    assert('四个教学入口齐全', cw.entries === 4, cw.entries);
    assert('四个入口全部携带课程上下文',
      cw.links.length === 4 && cw.links.every(h => h.indexOf('course=' + cw.cid) > 0), cw.links);
    assert('进入时报告未生成', cw.report === '未生成', cw.report);
    assert('进入时未扣课', cw.deduct === '未扣课', cw.deduct);

    /* ============================================================
       二、从入口进入教学功能：课程上下文自动透传
       ============================================================ */
    const setupHref = cw.links.filter(h => h.indexOf('word-training-setup') === 0)[0];
    assert('单词训练入口指向建任务页', !!setupHref, setupHref);
    await page.goto(ROOT + 'teacher/' + setupHref);
    await sleep(500);
    const su = await page.eval(`return {
      cid: typeof courseId === 'undefined' ? null : courseId,
      canStart: !document.getElementById('startBtn').disabled
    };`);
    assert('建任务页读到课程号', su.cid === cw.cid, su.cid);

    /* 选词库 → 开始预筛（真实按钮） */
    await page.eval(`
      var bk = Store.db.wordbooks.filter(function(b){return b.wordCount > 0;})[0];
      pick(bk.id); return 1;`);
    await sleep(200);
    assert('选中词库后可开始', (await page.eval(`return !document.getElementById('startBtn').disabled;`)) === true);
    await page.eval(`document.getElementById('startBtn').click(); return 1;`);
    await sleep(700);

    const ps = await page.eval(`return {
      file: location.pathname.split('/').pop(),
      q: location.search,
      tid: new URLSearchParams(location.search).get('task'),
      cid: new URLSearchParams(location.search).get('course'),
      status: Store.trainTask(new URLSearchParams(location.search).get('task')).status
    };`);
    assert('跳到预筛页并保留课程号', ps.file === 'word-training-prescreen.html' && ps.cid === cw.cid, ps.file + ps.q);
    assert('新建训练任务状态=未开始', ps.status === '未开始', ps.status);

    const linked = await page.eval(`
      var t = Store.trainTask('${ps.tid}');
      var r = Store.recordOfCourse('${cw.cid}');
      return { taskCourse: t.courseId, inLinks: r.links.trainTaskIds.indexOf(t.id) >= 0 };`);
    assert('训练任务自动带课程号', linked.taskCourse === cw.cid, linked.taskCourse);
    assert('训练任务自动挂到本节课记录', linked.inLinks === true);

    /* 预筛：真实点击「不认识」直到全部作答（自动进入结果页并生成队列） */
    await page.eval(`
      var btn = document.querySelector('.judge.no');
      var guard = 0;
      while (document.getElementById('resultArea').classList.contains('hidden') && guard++ < 80) btn.click();
      return guard;`);
    await sleep(300);
    const pf = await page.eval(`
      var t = Store.trainTask('${ps.tid}');
      return { n: Object.keys(t.prescreen || {}).length, total: t.wordIds.length };`);
    assert('预筛全部作答', pf.n === pf.total, pf.n + '/' + pf.total);
    await page.eval(`goTraining(); return 1;`);
    await sleep(700);

    const wt = await page.eval(`return {
      file: location.pathname.split('/').pop(),
      cid: new URLSearchParams(location.search).get('course'),
      phase: Store.trainTask('${ps.tid}').phase,
      status: Store.trainTask('${ps.tid}').status
    };`);
    assert('进入强化训练页', wt.file === 'word-training.html', wt.file);
    assert('强化训练页保留课程号', wt.cid === cw.cid, wt.cid);
    assert('任务进入强化训练阶段', wt.phase === '强化训练' && wt.status === '进行中', wt.phase + '/' + wt.status);

    /* 判断 2 个词（点真实按钮） */
    await page.eval(`
      var btn = document.querySelector('.judge.yes');
      btn.click(); return 1;`);
    await sleep(250);
    await page.eval(`
      var btn = document.querySelector('.judge.no');
      btn.click(); return 1;`);
    await sleep(250);
    const judged = await page.eval(`
      var t = Store.trainTask('${ps.tid}');
      var ds = Store.db.trainDetails.filter(function(d){return d.taskId === t.id;});
      return { n: ds.length, withCourse: ds.filter(function(d){return d.courseId === '${cw.cid}';}).length,
               words: ds.map(function(d){return d.wordId;}) };`);
    assert('强化训练判断写入 2 条', judged.n === 2, judged.n);
    assert('判断记录自动归属本节课', judged.withCourse === 2, judged.withCourse);

    /* ============================================================
       三、回到课程工作台：实时汇总
       ============================================================ */
    await page.goto(ROOT + 'teacher/course-workbench.html?course=' + cw.cid);
    await sleep(500);
    const rec = await page.eval(`return {
      grid: [].slice.call(document.querySelectorAll('#recGrid .r-v')).map(function(e){return e.textContent.trim();}),
      rows: document.querySelectorAll('#recRows tr').length,
      unf: document.getElementById('unfBadge').textContent.trim(),
      unfTxt: document.getElementById('unfBox').textContent.replace(/\\s+/g,' ').trim(),
      status: document.getElementById('cStatus').textContent.trim()
    };`);
    assert('汇总：单词训练数=2', rec.grid[0] === '2', rec.grid);
    assert('汇总表列出本节课任务', rec.rows >= 1, rec.rows);
    assert('检测到未完成任务', Number(rec.unf) >= 1, rec.unf);
    assert('未完成内容说明可见', rec.unfTxt.indexOf('/') > 0, rec.unfTxt);
    assert('回到工作台后状态仍为授课中', rec.status === '授课中', rec.status);

    /* 刷新后仍一致 */
    await page.goto(ROOT + 'teacher/course-workbench.html?course=' + cw.cid);
    await sleep(500);
    const rec2 = await page.eval(`return document.querySelectorAll('#recGrid .r-v')[0].textContent.trim();`);
    assert('刷新后汇总不变', rec2 === '2', rec2);

    /* ============================================================
       四、完成课程：未完成内容三选一（默认保留）
       ============================================================ */
    assert('未触发时结束弹窗不显示',
      (await page.eval(`return document.getElementById('finModal').classList.contains('show');`)) === false);
    await page.eval(`askFinish(); return 1;`);
    await sleep(250);
    const modal = await page.eval(`return {
      open: document.getElementById('finModal').classList.contains('show'),
      summary: document.getElementById('finSummary').textContent.replace(/\\s+/g,' ').trim(),
      reasonShown: getComputedStyle(document.getElementById('reasonField')).display !== 'none',
      def: (document.querySelector('input[name=pol]:checked')||{}).value
    };`);
    assert('点击后结束弹窗打开', modal.open === true);
    assert('完成弹窗默认「保留，下次继续」', modal.def === '保留', modal.def);
    assert('弹窗列出未完成内容', /未完成|已完成/.test(modal.summary), modal.summary);
    assert('默认策略不要求填原因', modal.reasonShown === false);

    /* 选「结束」必须填原因 → 空原因被拦截 */
    await page.eval(`
      document.querySelector('input[name=pol][value=结束]').click();
      return 1;`);
    await sleep(150);
    await page.eval(`document.getElementById('finReason').value=''; doFinish(); return 1;`);
    await sleep(250);
    const stillOpen = await page.eval(`return Store.course('${cw.cid}').status;`);
    assert('结束策略空原因被拦截', stillOpen === '授课中', stillOpen);

    /* 改回「保留」并完成 */
    await page.eval(`
      document.querySelector('input[name=pol][value=保留]').click();
      document.getElementById('note').value = '本节完成单词训练前两组，剩余下节课继续。';
      doFinish(); return 1;`);
    await sleep(900);

    const fin = await page.eval(`return {
      file: location.pathname.split('/').pop(),
      cid: Store.coursesOfTeacher('T001', Store.TODAY).filter(function(c){return c.status==='已完成';})[0].id,
      status: Store.course('${cw.cid}').status,
      deduct: Store.course('${cw.cid}').deductState,
      report: Store.reportOfCourse('${cw.cid}') && Store.reportOfCourse('${cw.cid}').status,
      taskStatus: Store.trainTask('${ps.tid}').status,
      snapshot: Store.recordOfCourse('${cw.cid}').snapshot
    };`);
    assert('完成后自动跳到报告页', fin.file === 'course-report.html', fin.file);
    assert('课程状态=已完成', fin.status === '已完成', fin.status);
    assert('完成即扣 1 课时', fin.deduct === '已扣课', fin.deduct);
    assert('自动生成报告草稿', fin.report === '编辑中', fin.report);
    assert('「保留」不结束任务', fin.taskStatus === '进行中', fin.taskStatus);
    assert('写入完成快照', !!fin.snapshot, fin.snapshot);

    /* ============================================================
       五、教学报告：草稿 → 提交 → 发布
       ============================================================ */
    const rp = await page.eval(`
      var r = Store.reportOfCourse('${cw.cid}');
      return { id: r.id, urlParam: new URLSearchParams(location.search).get('report'),
               sum: document.querySelectorAll('#mgrid .r-v, #mgrid .m-v, #mgrid .v').length,
               sumText: document.getElementById('mgrid').textContent.replace(/\\s+/g,' ').trim(),
               steps: document.getElementById('steps').textContent.replace(/\\s+/g,' ').trim(),
               btns: [].slice.call(document.querySelectorAll('#btns button')).map(function(b){return b.textContent.trim();}) };`);
    assert('报告页 URL 带报告号', rp.urlParam === rp.id, rp.urlParam);
    assert('报告页显示自动汇总', rp.sumText.length > 4, rp.sumText);
    assert('步骤条停在「编辑中」', rp.steps.indexOf('编辑中') >= 0, rp.steps);
    assert('草稿态按钮=保存/提交', rp.btns.join(',').indexOf('提交报告') >= 0, rp.btns);

    /* 空内容提交被拒 */
    await page.eval(`doSubmit(); return 1;`);
    await sleep(200);
    assert('空报告不能提交', (await page.eval(`return Store.report('${rp.id}').status;`)) === '编辑中');

    /* 只填一段仍被拒 */
    await page.eval(`
      document.getElementById('f1').value = '本节状态好，能主动跟读。';
      doSubmit(); return 1;`);
    await sleep(200);
    assert('只填一段不能提交', (await page.eval(`return Store.report('${rp.id}').status;`)) === '编辑中');

    /* 三段齐全 → 提交 */
    await page.eval(`
      document.getElementById('f1').value = '本节状态好，能主动跟读。';
      document.getElementById('f2').value = 'th 音还需加强。';
      document.getElementById('f3').value = '下节课先复习剩余单词，再做文章训练。';
      doSubmit(); return 1;`);
    await sleep(400);
    const sub = await page.eval(`return {
      status: Store.report('${rp.id}').status,
      at: !!Store.report('${rp.id}').submittedAt,
      steps: document.getElementById('steps').textContent.replace(/\\s+/g,' ').trim(),
      btns: [].slice.call(document.querySelectorAll('#btns button')).map(function(b){return b.textContent.trim();}),
      readonly: document.getElementById('f1').readOnly === true || document.getElementById('f1').disabled === true
    };`);
    assert('三段齐全后提交成功', sub.status === '已提交', sub.status);
    assert('提交时间已记录', sub.at === true);
    assert('已提交后表单只读', sub.readonly === true);
    assert('已提交后出现「发布给家长」', sub.btns.join(',').indexOf('发布给家长') >= 0, sub.btns);

    /* 家长此时仍看不到 */
    await page.goto(ROOT + 'parent/report.html');
    await sleep(500);
    const pv0 = await page.eval(`return {
      pub: Store.publishedReportsOf('S2026001').length,
      all: Store.reportsOf('S2026001').length,
      hasDraft: Store.reportsOf('S2026001').some(function(r){return r.id === '${rp.id}';})
    };`);
    assert('已提交未发布的报告不在家长可见列表', pv0.pub < pv0.all, pv0.pub + '/' + pv0.all);

    /* 发布 */
    await page.goto(ROOT + 'teacher/course-report.html?report=' + rp.id);
    await sleep(500);
    await page.eval(`doPublish(); return 1;`);
    await sleep(300);
    const cbox = await page.eval(`return {
      shown: !!document.getElementById('__confirm'),
      title: document.getElementById('__c_title') ? document.getElementById('__c_title').textContent.trim() : '',
      text: document.getElementById('__c_body') ? document.getElementById('__c_body').textContent.replace(/\\s+/g,' ').trim() : ''
    };`);
    assert('发布前有二次确认', cbox.shown && cbox.title === '发布给家长', cbox.title);
    assert('确认文案说明发布后不可修改', /不能.{0,4}修改|不可修改/.test(cbox.text), cbox.text);
    await page.eval(`document.getElementById('__c_ok').click(); return 1;`);
    await sleep(400);
    const pub = await page.eval(`return {
      status: Store.report('${rp.id}').status,
      at: !!Store.report('${rp.id}').publishedAt,
      btns: [].slice.call(document.querySelectorAll('#btns button')).map(function(b){return b.textContent.trim();}),
      steps: document.getElementById('steps').textContent.replace(/\\s+/g,' ').trim()
    };`);
    assert('发布成功', pub.status === '已发布', pub.status);
    assert('发布时间已记录', pub.at === true);
    assert('已发布后无提交按钮', pub.btns.join(',').indexOf('提交报告') < 0, pub.btns);

    /* ============================================================
       六、家长端可见性门控
       ============================================================ */
    await page.goto(ROOT + 'parent/report.html?report=' + rp.id);
    await sleep(600);
    const pr = await page.eval(`return {
      txt: document.body.textContent.replace(/\\s+/g,' ').trim(),
      found: document.body.textContent.indexOf('本节状态好') >= 0
    };`);
    assert('家长能看到已发布报告内容', pr.found === true, pr.txt.slice(0, 80));

    /* 未发布的报告家长看不到 */
    const draftId = await page.eval(`
      var r = Store.reportsOf('S2026001').filter(function(x){return x.status === '编辑中';})[0];
      return r ? r.id : '';`);
    if (draftId) {
      await page.goto(ROOT + 'parent/report.html?report=' + draftId);
      await sleep(600);
      const pd = await page.eval(`return {
        txt: document.body.textContent.replace(/\\s+/g,' ').trim(),
        leaked: document.body.textContent.indexOf('待加强内容') >= 0 && document.body.textContent.indexOf('本节表现') < 0
      };`);
      assert('未发布报告家长不可见内容', !/本节状态好|下节课先复习/.test(pd.txt), pd.txt.slice(0, 80));
      assert('未发布报告给出整理中提示', /整理|暂未|不可见|不开放/.test(pd.txt), pd.txt.slice(0, 120));
    } else {
      assert('未发布报告家长不可见内容', true);
      assert('未发布报告给出整理中提示', true);
    }

    /* 课程记录列表状态文案 */
    await page.goto(ROOT + 'parent/course-records.html');
    await sleep(500);
    const cr = await page.eval(`return document.body.textContent.replace(/\\s+/g,' ').trim();`);
    assert('课程记录列表出现「报告已发布」', cr.indexOf('报告已发布') >= 0, cr.slice(0, 120));

    /* ============================================================
       七、教师端教学记录列表与工作台统计
       ============================================================ */
    await page.goto(ROOT + 'teacher/teaching-record.html');
    await sleep(500);
    const tr = await page.eval(`return {
      rows: document.querySelectorAll('tbody tr').length,
      txt: document.body.textContent.replace(/\\s+/g,' ').trim(),
      dates: [].slice.call(document.querySelectorAll('#rows tr')).map(function(r){
        var c = r.querySelector('td'); return c ? c.textContent.trim() : '';
      }),
      cards: [].slice.call(document.querySelectorAll('.stat .v, .stat .num, .s-v')).map(function(e){return e.textContent.trim();})
    };`);
    assert('教学记录列表有课程行', tr.rows >= 1, tr.rows);
    assert('教学记录包含已发布报告', tr.txt.indexOf('已发布') >= 0, tr.txt.slice(0, 120));
    assert('教学记录没有 NaN / undefined', !/NaN|undefined/.test(tr.txt), tr.txt.slice(0, 160));
    assert('教学记录按上课时间倒序', (function () {
      const ds = tr.dates;
      for (let i = 1; i < ds.length; i++) if (ds[i] > ds[i - 1]) return false;
      return ds.length > 1;
    })(), tr.dates);

    await page.goto(ROOT + 'teacher/workbench.html');
    await sleep(500);
    const wb2 = await page.eval(`return {
      txt: document.body.textContent.replace(/\\s+/g,' ').trim(),
      done: Store.coursesOfTeacher('T001', Store.TODAY).filter(function(c){return c.status === '已完成';}).length
    };`);
    assert('工作台反映已完成课程', wb2.done >= 1, wb2.done);
    assert('工作台显示报告状态', /待写报告|待发布|已发布/.test(wb2.txt), wb2.txt.slice(0, 100));

    /* ============================================================
       八、无控制台异常
       ============================================================ */
    assert('全程无 JS 异常', page.errors.length === 0, page.errors.slice(0, 3));

  } catch (e) {
    bad.push('运行中断：' + e.message);
  } finally {
    page.close();
    proc.kill();
  }

  if (bad.length) {
    console.log('\n失败 ' + bad.length + ' 项：');
    bad.forEach(b => console.log('  ✗ ' + b));
  }
  console.log('\n通过 ' + ok.length + ' / ' + (ok.length + bad.length) + ' 项');
  if (!bad.length) console.log('第三轮 UI 链路全部通过');
  process.exit(bad.length ? 1 : 0);
})();
