/* 场景 A：单词训练闭环（真实页面交互） */
const { Page, launch, sleep, ROOT } = require('./cdp');

const ok = [], bad = [];
function assert(name, cond, extra) {
  if (cond) ok.push(name); else bad.push(name + (extra !== undefined ? ' → ' + JSON.stringify(extra) : ''));
}

(async () => {
  const proc = await launch();
  const page = await Page.open();

  try {
    /* 1. 课程上下文的词库选择 → 创建任务（第十轮：必须带 course，且需真实教师会话） */
    await page.goto(ROOT + 'teacher/word-training-setup.html?course=C20261104001');
    await page.eval(`Store.setSession({role:'teacher', teacherId:'T001', operatorName:'李婉'});`);
    await page.goto(ROOT + 'teacher/word-training-setup.html?course=C20261104001');
    const rows = await page.eval(`return document.querySelectorAll('#rows tr').length;`);
    assert('词库列表有数据', rows > 0, rows);

    await page.eval(`selected={WB001:true}; startPrescreen();`);
    await sleep(600);
    const url1 = await page.eval(`return location.href;`);
    assert('进入预筛选并带任务号与课程', /word-training-prescreen\.html\?task=TR\d+&course=C20261104001/.test(url1), url1);

    const taskId = await page.eval(`return task.id;`);
    const taskStatus = await page.eval(`return Store.trainTask(${JSON.stringify(taskId)}).status;`);
    assert('任务状态=未开始（预筛选阶段）', taskStatus === '未开始', taskStatus);

    /* 2. 逐词作答：前 9 认识，其余不认识，然后生成队列 */
    await page.eval(`
      cands.forEach(function(c, k){ answer(c.id, k < 9); });
      generate();
    `);
    await sleep(400);

    const res = await page.eval(`return {
      book: document.getElementById('rPool').textContent,
      known: document.getElementById('rKnown').textContent,
      queue: document.getElementById('rQueue').textContent,
      remain: document.getElementById('rRemain').textContent,
      groups: document.getElementById('groupPlan').textContent.replace(/\\s+/g,' ').trim(),
      foot: document.getElementById('groupFoot').textContent,
      sumQueue: document.getElementById('stats').textContent
    };`);
    assert('页面显示候选池 23', res.book === '23', res.book);
    assert('页面显示初筛认识 9', res.known === '9', res.known);
    assert('页面显示训练队列 14', res.queue === '14', res.queue);
    assert('页面显示剩余待训练 0', res.remain === '0', res.remain);
    assert('分组显示 5/5/4', /第 1 组 · 5 个.*第 2 组 · 5 个.*第 3 组 · 4 个/.test(res.groups), res.groups);
    assert('分组合计不写死', res.foot.indexOf('5 + 5 + 4 = 14') >= 0, res.foot);

    /* 3. 校验不认识的才入队 */
    const q = await page.eval(`
      var t = Store.trainTask(task.id);
      var known = t.knownWordIds.map(function(id){return Store.word(id).en;});
      var queue = t.queueWordIds.map(function(id){return Store.word(id).en;});
      return {known: known, queue: queue, overlap: known.filter(function(x){return queue.indexOf(x)>=0;})};
    `);
    assert('认识 9 个', q.known.length === 9, q.known.length);
    assert('队列 14 个', q.queue.length === 14, q.queue.length);
    assert('认识的单词不在队列中', q.overlap.length === 0, q.overlap);
    assert('队列词都是不认识的', q.queue.indexOf('he') >= 0 && q.queue.indexOf('name') < 0, q.queue);

    /* 4. 进入分组训练 */
    await page.eval(`goTraining();`);
    await sleep(600);
    const gi0 = await page.eval(`return {gi: gi, groups: groups.map(function(g){return g.length;}), sub: document.getElementById('topSub').textContent};`);
    assert('训练页分组 5/5/4', JSON.stringify(gi0.groups) === '[5,5,4]', gi0.groups);

    /* 5. 第 1 组：3 认识 2 不认识 */
    await page.eval(`
      judge('yes'); judge('yes'); judge('yes'); judge('no'); judge('no');
    `);
    await sleep(300);
    let v = await page.eval(`return {view: view, gi: gi};`);
    assert('第 1 组完成后进入组完成页', v.view === 'groupDone', v.view);

    /* 6. 刷新页面验证恢复 */
    await page.goto(ROOT + 'teacher/word-training.html?task=' + taskId + '&course=C20261104001');
    await sleep(500);
    const restored = await page.eval(`return {view: view, gi: gi, done: Object.keys(task.results).length, status: task.status, phase: task.phase};`);
    assert('刷新后仍在同一任务', restored.status === '进行中' && restored.phase === '强化训练', restored.status + '/' + restored.phase);
    assert('刷新后已判断 5 个', restored.done === 5, restored.done);
    assert('刷新后恢复到组完成视图', restored.view === 'groupDone', restored.view);

    /* 7. 误判修正（追加记录） */
    const fixInfo = await page.eval(`
      var first = groups[0][0];
      openFix(first);
      document.querySelector('input[name=fixTo][value=no]').checked = true;
      document.getElementById('fixNote').value = '课上误点';
      doFix();
      var dets = Store.detailsOf(task.id).filter(function(d){return d.wordId===first;});
      return {n: dets.length, first: dets[0].result, second: dets[1].result, corrected: dets[1].correction,
        state: task.results[first].result, view: view};
    `);
    assert('修正后明细 2 条', fixInfo.n === 2, fixInfo.n);
    assert('原始记录保留为认识', fixInfo.first === 'yes', fixInfo.first);
    assert('追加记录为不认识且标记修正', fixInfo.second === 'no' && fixInfo.corrected === true, fixInfo);
    assert('当前生效结果为修正值', fixInfo.state === 'no', fixInfo.state);

    /* 8. 完成剩余组 */
    await page.eval(`
      for (var g=1; g<groups.length; g++){
        gi=g; wi=0; view='group';
        Store.setTaskPos(task.id,{groupIndex:g,wordIndex:0});
        var arr = groups[g].slice();
        for (var k=0;k<arr.length;k++){ judge(k<3?'yes':'no'); }
      }
    `);
    await sleep(300);
    v = await page.eval(`return {view: view, gi: gi};`);
    assert('最后一组完成后在组完成页', v.view === 'groupDone' && v.gi === 2, v);

    /* 9. 进入最后一轮复习 */
    await page.eval(`nextGroup();`);
    await sleep(300);
    v = await page.eval(`return {view: view, status: task.status, phase: task.phase};`);
    assert('进入最后一轮复习', v.view === 'final' && v.status === '进行中' && v.phase === '最后复习', v.status + '/' + v.phase);

    /* 10. 未完成最后复习时提交应被拒绝 */
    const guard = await page.eval(`return Store.completeTask(task.id, {joinLeitner:true}).ok;`);
    assert('缺最后复习不许提交', guard === false, guard);

    /* 11. 完成最后复习 */
    await page.eval(`
      var n = 0;
      while (view === 'final' && n < 40) {
        var idx = task.finalIndex || 0;
        var id = ids[idx];
        var r = task.results[id].result;
        finalJudge(r === 'yes' ? 'yes' : 'no');
        n++;
      }
    `);
    await sleep(300);
    v = await page.eval(`return {view: view, final: Object.keys(task.finalResults).length};`);
    assert('最后复习覆盖全部队列', v.final === 14, v.final);
    assert('进入结果确认页', v.view === 'finalDone', v.view);

    /* 12. 勾选加入两套体系并提交 */
    await page.eval(`
      document.getElementById('cb_leitner').checked = true;
      document.getElementById('cb_21').checked = true;
      document.getElementById('cb_green').checked = false;
      submitAll();
    `);
    await sleep(400);
    const summary = await page.eval(`
      return {view: view, status: task.status,
        leitner: task.joins.leitner.length, plan: task.joins.plan21.length, planIds: task.joins.planIds,
        known: task.knownWordIds.length};
    `);
    assert('提交成功进入完成页', summary.view === 'summary', summary.view);
    assert('任务状态=已完成', summary.status === '已完成', summary.status);
    assert('初筛认识 9 个未入队', summary.known === 9, summary.known);
    assert('待复习单词加入莱特纳', summary.leitner > 0, summary.leitner);
    assert('生成独立 21 天计划', summary.planIds.length === 1, summary.planIds);

    /* 13. 防重复提交 */
    const dupMsg = await page.eval(`
      var r = Store.completeTask(task.id, {joinLeitner:true});
      return {ok: r.ok, reason: r.reason};
    `);
    assert('防重复提交', dupMsg.ok === false, dupMsg);

    /* 14. 一致性：档案 / 盒子 / 单词档案读到同一结果 */
    const consist = await page.eval(`
      var t = Store.trainTask(task.id);
      var fail = t.queueWordIds.filter(function(id){return Store.wordState('S2026001', id).state === '待复习';});
      var pass = t.queueWordIds.filter(function(id){return Store.wordState('S2026001', id).state === '本次通过';});
      var inRed = fail.filter(function(id){ var s = Store.leitnerState('S2026001', id); return s && s.box === 'red'; });
      var reviewable = fail.filter(function(id){ var s = Store.leitnerState('S2026001', id); return s && (Store.isDue(s) || s.manualToday); });
      var notIn = fail.filter(function(id){ return !Store.leitnerState('S2026001', id); });
      return {fail: fail.length, pass: pass.length, inRed: inRed.length,
        reviewable: reviewable.length, notIn: notIn.length};
    `);
    assert('不通过→待复习状态', consist.fail > 0, consist.fail);
    assert('不通过→全部进入莱特纳体系', consist.notIn === 0, consist);
    assert('不通过→今日均可复习', consist.reviewable === consist.fail, consist);
    assert('不通过→多数回到红盒', consist.inRed >= consist.fail - 1, consist);
    assert('通过与待复习之和=队列', consist.fail + consist.pass === 14, consist);

    /* 15. 单词档案页 */
    await page.goto(ROOT + 'teacher/word-detail.html?student=S2026001&word=w13');
    await sleep(500);
    const wd = await page.eval(`return {
      en: document.getElementById('wEn').textContent,
      dup: document.getElementById('c2').textContent,
      t2: document.getElementById('t2').textContent.replace(/\\s+/g,' ').trim(),
      rows: document.querySelectorAll('#tdRows tr').length
    };`);
    assert('单词档案显示单词', wd.en === 'friend', wd.en);
    assert('单词档案有强化训练记录', wd.rows > 0, wd.rows);
    assert('单词档案显示学员状态', wd.t2.length > 0, wd.t2);

    assert('场景 A 无 JS 异常', page.errors.length === 0, page.errors);
  } catch (e) {
    bad.push('执行异常：' + e.message);
  }

  console.log('\n通过 ' + ok.length + ' 项');
  if (bad.length) { console.log('失败 ' + bad.length + ' 项：'); bad.forEach(b => console.log('  ✗ ' + b)); }
  else console.log('场景 A（单词训练闭环）全部通过');
  page.close();
  proc.kill();
  process.exit(bad.length ? 1 : 0);
})();
