/* 场景 C：21 天计划创建 → 时间轴 → 执行今日复习 → 进度；并验证不影响莱特纳 */
const { Page, launch, sleep, ROOT } = require('./cdp');
const ok = [], bad = [];
function assert(n, c, e) { c ? ok.push(n) : bad.push(n + (e !== undefined ? ' → ' + JSON.stringify(e) : '')); }

(async () => {
  const proc = await launch();
  const page = await Page.open();
  try {
    await page.goto(ROOT + 'teacher/memory21.html');
    await sleep(500);

    const s0 = await page.eval(`return {
      plans: Store.plansOf('S2026001').length,
      todayTotal: Store.plan21Progress(Store.plan21('PN20261024001')).todayTotal,
      rate: Store.plan21Progress(Store.plan21('PN20261024001')).rate,
      day: Store.plan21Progress(Store.plan21('PN20261024001')).currentDay,
      cards: document.querySelectorAll('#statCards .stat').length,
      days: document.querySelectorAll('#days .day').length,
      todayRows: document.querySelectorAll('#todayWords tr').length
    };`);
    assert('种子计划 1 个', s0.plans === 1, s0.plans);
    assert('今日任务 12 个', s0.todayTotal === 12, s0.todayTotal);
    assert('完成率 87.5%', s0.rate === 87.5, s0.rate);
    assert('当前第 10 天', s0.day === 10, s0.day);
    assert('时间轴 21 天', s0.days === 21, s0.days);
    assert('今日任务列表 12 行', s0.todayRows === 12, s0.todayRows);

    /* 验证同名词在两体系并存 */
    const rel = await page.eval(`return {
      total: document.getElementById('relTotal').textContent,
      both: document.getElementById('relBoth').textContent,
      only: document.getElementById('relOnly').textContent
    };`);
    assert('计划 23 词', /23/.test(rel.total), rel);
    assert('同时在莱特纳 18 个', /18/.test(rel.both), rel);
    assert('仅 21 天 5 个', /5/.test(rel.only), rel);

    /* 创建新计划（走真实表单） */
    await page.eval(`
      openPlanModal();
      document.getElementById('npName').value = '测试计划 A';
      document.getElementById('npStart').value = '2026-11-02';
      document.querySelector('input[name=scope][value=book]').checked = true;
      previewScope();
      createPlan();
    `);
    await sleep(800);
    const newPlan = await page.eval(`
      var plans = Store.plansOf('S2026001');
      var p = plans.filter(function(x){return x.name === '测试计划 A';})[0];
      return {n: plans.length, id: p ? p.id : null, words: p ? p.wordIds.length : 0,
        nodes: p ? Store.plan21Tasks(p.id).length : 0,
        todayTask: p ? !!Store.plan21Today(p.id) : false};
    `);
    assert('新计划已创建', newPlan.n === 2, newPlan.n);
    assert('新计划 23 词', newPlan.words === 23, newPlan.words);
    assert('按配置生成节点', newPlan.nodes >= 10, newPlan.nodes);
    assert('新计划有今日任务', newPlan.todayTask === true, newPlan.todayTask);

    /* 进入今日任务并完成 */
    await page.goto(ROOT + 'teacher/memory21.html?student=S2026001&plan=' + newPlan.id);
    await sleep(500);
    const href = await page.eval(`return document.getElementById('goReview').href;`);
    await page.goto(href);
    await sleep(600);

    const before = await page.eval(`
      var p = Store.plan21(task.planId);
      return {todayTotal: task.wordIds.length, day: task.day,
        leitner: JSON.stringify(Store.leitnerStates('S2026001').map(function(s){return [s.wordId,s.box,s.dueAt];}))};
    `);
    assert('今日任务有单词', before.todayTotal > 0, before.todayTotal);

    /* 全部判为认识，验证节点完成 */
    await page.eval(`
      var guard = 0;
      while (guard < 40) {
        var done = Store.plan21Records(task.planId).filter(function(r){return r.taskId===task.id;}).length;
        if (done >= list.length) break;
        ans('yes');
        guard++;
      }
    `);
    await sleep(400);
    const after = await page.eval(`
      var p = Store.plan21(task.planId);
      return {status: task.status,
        recs: Store.plan21Records(task.planId).filter(function(r){return r.taskId===task.id;}).length,
        total: task.wordIds.length,
        rate: Store.plan21Progress(p).rate,
        leitner: JSON.stringify(Store.leitnerStates('S2026001').map(function(s){return [s.wordId,s.box,s.dueAt];})),
        text: document.getElementById('stage').textContent.replace(/\\s+/g,' ').slice(0,160)};
    `);
    assert('节点标记已完成', after.status === '已完成', after.status);
    assert('单词级记录齐全', after.recs === after.total, after);
    assert('完成页提示不影响莱特纳', /不影响莱特纳盒子状态/.test(after.text), after.text.slice(0, 80));
    assert('莱特纳状态未被改动', after.leitner === before.leitner, 'leitner 变化');

    /* 回到计划页看进度 */
    await page.goto(ROOT + 'teacher/memory21.html?student=S2026001&plan=' + newPlan.id);
    await sleep(500);
    const prog = await page.eval(`return {
      todayDone: document.querySelectorAll('#statCards .stat-value')[4].textContent.replace(/\\s/g,''),
      hist: document.querySelectorAll('#histRows tr').length,
      timelineDone: document.querySelectorAll('#days .day.done').length
    };`);
    assert('今日已完成已刷新', parseInt(prog.todayDone) >= after.total, prog.todayDone);
    assert('历史记录出现', prog.hist >= 1, prog.hist);
    assert('时间轴出现完成节点', prog.timelineDone >= 1, prog.timelineDone);

    assert('场景 C 无 JS 异常', page.errors.length === 0, page.errors);
  } catch (e) {
    try { console.log('ERR URL=', await page.eval('return location.href;'));
          console.log('ERR Store=', await page.eval('return typeof Store;'));
          console.log('ERR errs=', page.errors); } catch (x) {}
    bad.push('执行异常：' + e.message);
  }

  console.log('\n通过 ' + ok.length + ' 项');
  if (bad.length) { console.log('失败 ' + bad.length + ' 项：'); bad.forEach(b => console.log('  ✗ ' + b)); }
  else console.log('场景 C（21 天复习闭环）全部通过');
  page.close(); proc.kill(); process.exit(bad.length ? 1 : 0);
})();
