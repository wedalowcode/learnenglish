/* 第三轮视觉 QA：把关键页面截到 _test/shots/ */
const { Page, launch, sleep, ROOT } = require('./cdp');

(async () => {
  const proc = await launch();
  const page = await Page.open();
  const out = [];
  try {
    /* 预热：重置到种子数据 */
    await page.goto(ROOT + 'teacher/workbench.html');
    await sleep(300);
    await page.eval(`Store.reset(); return 1;`);

    /* 找出今天一节未完成的课，作为课程工作台的主体 */
    const cid = await page.eval(`
      var c = Store.coursesOfTeacher('T001', Store.TODAY).filter(function(x){return x.status !== '已完成';})[0];
      if (!c) return '';
      Store.openCourse(c.id);
      /* 造一点本节课的教学动作，让汇总不是空的 */
      var bk = Store.db.wordbooks.filter(function(b){return b.wordCount > 0;})[0];
      var t = Store.startTrainTask({studentId: c.studentId, teacherId: 'T001', wordbookId: bk.id, courseId: c.id});
      Store.linkTask(c.id, 'train', t.id);
      t.wordIds.slice(0, 8).forEach(function(id){ Store.prescreenAnswer(t.id, id, false); });
      var fr = Store.finishPrescreen(t.id);
      fr.queue.slice(0, 5).forEach(function(id, i){ Store.trainJudge(t.id, id, i % 2 ? 'no' : 'yes', 'en2cn', 0, c.id); });
      var due = Store.leitnerDueDetail(c.studentId);
      if (due.items.length) {
        var lt = Store.createLeitnerTask(c.studentId, due.items.slice(0, 3).map(function(x){return x.wordId;}), 'T001', '系统推荐', c.id);
        Store.linkTask(c.id, 'leitner', lt.id);
        Store.leitnerJudge(lt.id, lt.wordIds[0], 'yes', 'T001', c.id);
      }
      return c.id;`);
    console.log('课程号', cid);

    const shots = [
      ['01-工作台', 'teacher/workbench.html'],
      ['02-课程工作台', 'teacher/course-workbench.html?course=' + cid],
      ['03-单词学习全景', 'teacher/word-detail.html?student=S2026001&word='],
      ['04-莱特纳今日推荐', 'teacher/leitner.html?student=S2026001&course=' + cid],
      ['05-21天今日理由', 'teacher/memory21.html?student=S2026001&course=' + cid],
      ['07-教学记录', 'teacher/teaching-record.html'],
      ['08-家长课程记录', 'parent/course-records.html']
    ];

    /* 单词全景需要一个真实 wordId */
    const wid = await page.eval(`
      var s = Store.leitnerStates('S2026001').filter(function(x){return x.box !== 'graduated';})[0];
      return s ? s.wordId : '';`);
    const list = shots.map(s => s[1].indexOf('word=') > 0 ? [s[0], s[1] + wid] : s);

    for (const [name, url] of list) {
      await page.goto(ROOT + url);
      await sleep(600);
      const f = await page.shot(name);
      out.push(f);
      console.log('✓', name, '→', f);
    }

    /* 文章训练：进入逐句阶段，展示教师判定区 */
    await page.goto(ROOT + 'teacher/article-training.html?student=S2026001&course=' + cid);
    await sleep(500);
    await page.eval(`
      pick('AR001'); return 1;`);
    await sleep(400);
    await page.eval(`
      confirmListen(); return 1;`);
    await sleep(400);
    await page.eval(`
      markRead();
      verdict('掌握'); return 1;`);
    await sleep(900);
    await page.eval(`
      nextS(); markRead(); verdict('待加强'); return 1;`);
    await sleep(900);
    await page.eval(`
      nextS(); markRead(); return 1;`);
    await sleep(2600);
    out.push(await page.shot('06-文章训练判定'));
    console.log('✓ 06-文章训练判定');

    await page.eval(`stage='summary'; render(); return 1;`);
    await sleep(300);
    out.push(await page.shot('06b-文章训练总结'));
    console.log('✓ 06b-文章训练总结');

    /* 完成课程 → 报告页（编辑中）→ 提交 → 发布 → 家长已发布 */
    await page.goto(ROOT + 'teacher/course-workbench.html?course=' + cid);
    await sleep(500);
    const rid = await page.eval(`
      var r = Store.finishCourse('${cid}', {policy: '保留', by: 'T001', note: '本节完成单词训练前三组，剩余下节课继续。'});
      return r.ok ? r.report.id : '';`);
    console.log('报告号', rid);

    await page.goto(ROOT + 'teacher/course-report.html?report=' + rid);
    await sleep(600);
    out.push(await page.shot('09-报告-编辑中'));
    console.log('✓ 09-报告-编辑中');

    await page.eval(`
      document.getElementById('f1').value = '本节状态不错，能主动跟读，遇到长单词会自己拆分音节。';
      document.getElementById('f2').value = 'th 音还不稳，thought / three 容易读成 s 开头。';
      document.getElementById('f3').value = '下节课先用 10 分钟复习剩余 3 个单词，再做文章训练。';
      doSubmit(); return 1;`);
    await sleep(400);
    out.push(await page.shot('10-报告-已提交'));
    console.log('✓ 10-报告-已提交');

    await page.eval(`doPublish(); return 1;`);
    await sleep(300);
    await page.eval(`document.getElementById('__c_ok').click(); return 1;`);
    await sleep(400);
    out.push(await page.shot('11-报告-已发布'));
    console.log('✓ 11-报告-已发布');

    await page.goto(ROOT + 'parent/report.html?report=' + rid);
    await sleep(600);
    out.push(await page.shot('12-家长-已发布报告'));
    console.log('✓ 12-家长-已发布报告');

    /* 未发布门控 */
    const draft = await page.eval(`
      var r = Store.reportsOf('S2026001').filter(function(x){return x.status !== '已发布';})[0];
      return r ? r.id : '';`);
    if (draft) {
      await page.goto(ROOT + 'parent/report.html?report=' + draft);
      await sleep(600);
      out.push(await page.shot('13-家长-报告整理中'));
      console.log('✓ 13-家长-报告整理中');
    }

    console.log('\n共 ' + out.length + ' 张，页面异常 ' + page.errors.length + ' 条');
    if (page.errors.length) console.log(page.errors.slice(0, 3));
  } catch (e) {
    console.log('ERR', e.message);
  }
  page.close(); proc.kill();
})();
