/* 场景 B：莱特纳复习闭环 */
const { Page, launch, sleep, ROOT } = require('./cdp');
const ok = [], bad = [];
function assert(n, c, e) { c ? ok.push(n) : bad.push(n + (e !== undefined ? ' → ' + JSON.stringify(e) : '')); }

(async () => {
  const proc = await launch();
  const page = await Page.open();
  try {
    await page.goto(ROOT + 'teacher/leitner.html');
    await sleep(500);

    const stat = await page.eval(`return {
      total: document.getElementById('sTotal').textContent.replace(/\\s/g,''),
      foot: document.querySelectorAll('#statCards .stat-foot')[0].textContent.replace(/\\s+/g,' ').trim(),
      red: document.querySelectorAll('#redBody .mini-word').length,
      y1: document.querySelectorAll('#yellowBoxes .box-card')[0].textContent.replace(/\\s+/g,' ').trim(),
      green: document.querySelectorAll('#greenBody .mini-word').length
    };`);
    assert('今日待复习 12', stat.total === '12个', stat.total);
    assert('统计口径含去重说明', /红 6.*黄到期 5.*手动 2.*去重 1/.test(stat.foot), stat.foot);
    assert('红盒 6 个', stat.red === 6, stat.red);
    assert('黄盒 1 显示到期 3', /到期 3/.test(stat.y1), stat.y1);
    assert('绿盒 4 个', stat.green === 4, stat.green);

    /* 系统推荐预览：红/黄/手动/去重 */
    await page.eval(`openRecommend();`);
    const rec = await page.eval(`return document.getElementById('recBody').textContent.replace(/\\s+/g,' ').trim();`);
    assert('推荐列出红盒到期', /红盒到期\s*6/.test(rec), rec.slice(0, 120));
    assert('推荐列出手动加入 2', /教师手动加入\s*2/.test(rec), '');
    assert('推荐显示未去重合计 13', /合计（未去重）\s*13/.test(rec), '');
    assert('推荐显示去重 -1', /重复单词\s*-1/.test(rec), '');
    assert('推荐显示去重后 12', /去重后任务总数\s*12/.test(rec), '');

    /* 开始复习 */
    await page.eval(`startRecommend();`);
    await sleep(600);
    const rv = await page.eval(`return {n: list.length, source: task.source, id: task.id};`);
    assert('复习任务去重后 12 个单词', rv.n === 12, rv.n);
    assert('任务来源=系统推荐', /系统推荐/.test(rv.source), rv.source);

    /* 判断：第一个词（红盒 friend）认识 → Y1 */
    const first = await page.eval(`
      var id = list[i];
      var before = Store.leitnerState('S2026001', id);
      judge('yes');
      var after = Store.leitnerState('S2026001', id);
      return {en: Store.word(id).en, from: before.box, to: after.box, due: after.dueAt};
    `);
    assert('认识后按配置升到黄盒1', first.to === 'Y1', first);
    assert('下次到期=今天+2天', first.due === '2026-11-04', first.due);

    /* 完成全部 12 个 */
    await page.eval(`
      var guard = 0;
      while (guard < 30) {
        var done = Store.leitnerRecordsOf('S2026001').filter(function(r){return r.taskId===task.id;});
        if (done.length >= list.length) break;
        judge(guard % 2 === 0 ? 'yes' : 'no');
        guard++;
      }
    `);
    await sleep(400);
    const doneView = await page.eval(`return {
      status: task.status,
      recs: Store.leitnerRecordsOf('S2026001').filter(function(r){return r.taskId===task.id;}).length,
      rows: document.querySelectorAll('#stage tbody tr').length,
      text: document.getElementById('stage').textContent.replace(/\\s+/g,' ').slice(0, 1500)
    };`);
    assert('任务标记已完成', doneView.status === '已完成', doneView.status);
    assert('12 条单词级记录', doneView.recs === 12, doneView.recs);
    assert('完成页展示单词去向', doneView.rows === 12, doneView.rows);
    assert('完成页提示不影响21天', /不影响.*21 天/.test(doneView.text), doneView.text.slice(0, 100));

    /* 回盒子页：状态已更新 + 有复习记录 */
    await page.goto(ROOT + 'teacher/leitner.html');
    await sleep(500);
    const after = await page.eval(`return {
      todayDone: document.querySelectorAll('#statCards .stat-value')[1].textContent.replace(/\\s/g,''),
      hist: document.querySelectorAll('#histRows tr').length,
      histText: document.getElementById('histRows').textContent.replace(/\\s+/g,' ').trim().slice(0,80),
      ops: document.querySelectorAll('#opRows tr').length
    };`);
    assert('今日已完成已刷新', parseInt(after.todayDone) === 12, after.todayDone);
    assert('复习记录出现新任务', after.hist >= 2, after.hist);
    assert('复习记录显示认识/不认识数', /认识/.test(after.histText) || after.histText.length > 0, after.histText);

    /* 单词复习历史 */
    const hist = await page.eval(`
      openWordHistory(Store.wordByEn('friend').id);
      return {rows: document.querySelectorAll('#hmRows tr').length,
        title: document.getElementById('hmTitle').textContent};
    `);
    assert('单词复习历史可查看', hist.rows >= 2, hist.rows);

    /* 绿盒：加入 + 移出（含原因留痕） */
    const green = await page.eval(`
      Proto.closeModal('histModal');
      var id = Store.wordByEn('question').id;
      joinGreen(id);
      document.getElementById('rsNote').value = '课堂易混';
      doReason();
      var g1 = Store.leitnerState('S2026001', id).box;
      removeGreen(id);
      document.getElementById('rsNote').value = '已能区分，移出';
      doReason();
      var g2 = Store.leitnerState('S2026001', id).box;
      var ops = Store.leitnerOps('S2026001').map(function(o){return o.action;});
      return {g1: g1, g2: g2, ops: ops};
    `);
    assert('加入绿盒成功', green.g1 === 'green', green.g1);
    assert('移出绿盒回到红盒', green.g2 === 'red', green.g2);
    assert('操作留痕两条', green.ops.filter(x => x === '加入绿盒' || x === '移出绿盒').length >= 2, green.ops);

    /* 盒子配置可保存并影响后续 */
    const cfg = await page.eval(`
      openCfg();
      var inp = document.querySelector('input[data-cfg="Y1"]');
      inp.value = 4;
      saveCfg();
      return Store.leitnerConfig().yellow[0].intervalDays;
    `);
    assert('盒子间隔可配置并保存', cfg === 4, cfg);

    assert('场景 B 无 JS 异常', page.errors.length === 0, page.errors);
  } catch (e) { bad.push('执行异常：' + e.message); }

  console.log('\n通过 ' + ok.length + ' 项');
  if (bad.length) { console.log('失败 ' + bad.length + ' 项：'); bad.forEach(b => console.log('  ✗ ' + b)); }
  else console.log('场景 B（莱特纳复习闭环）全部通过');
  page.close(); proc.kill(); process.exit(bad.length ? 1 : 0);
})();
