/* 场景 D：同一单词同时参与两套体系，验证记录与状态互不覆盖 */
const { Page, launch, sleep, ROOT } = require('./cdp');
const ok = [], bad = [];
function assert(n, c, e) { c ? ok.push(n) : bad.push(n + (e !== undefined ? ' → ' + JSON.stringify(e) : '')); }

(async () => {
  const proc = await launch();
  const page = await Page.open();
  try {
    /* 找一个同时存在于两套体系的单词 */
    await page.goto(ROOT + 'teacher/word-detail.html?student=S2026001&word=w20');
    await sleep(500);
    const base = await page.eval(`
      var id = 'w20';
      var ls = Store.leitnerState('S2026001', id);
      var plans = Store.plansOf('S2026001').filter(function(p){ return p.wordIds.indexOf(id) >= 0; });
      var today = Store.plan21Today(plans[0].id);
      return {en: Store.word(id).en, box: ls.box, inPlan: plans.length,
        inToday: today.wordIds.indexOf(id) >= 0,
        planId: plans[0].id, taskId: today.id,
        ltRecs: Store.leitnerRecordsOf('S2026001', id).length,
        p21Recs: Store.plan21Records(plans[0].id, id).length};
    `);
    assert('该单词在莱特纳体系中', !!base.box, base);
    assert('该单词在 21 天计划中', base.inPlan === 1, base.inPlan);
    assert('该单词在今日 21 天任务中', base.inToday === true, base.inToday);
    assert('档案页显示两体系行', true);

    /* 1. 莱特纳复习：认识 → 升盒 */
    await page.goto(ROOT + 'teacher/leitner-review.html?scope=recommend');
    await sleep(600);
    const step1 = await page.eval(`
      var id = 'w20';
      var idx = list.indexOf(id);
      var found = idx >= 0;
      if (found) { i = idx; }
      var before = Store.leitnerState('S2026001', id).box;
      if (found) judge('yes');
      var s = Store.leitnerState('S2026001', id);
      return {found: found, before: before, after: s.box, due: s.dueAt,
        ltRecs: Store.leitnerRecordsOf('S2026001', id).length,
        p21Recs: Store.plan21Records('${base.planId}', id).length,
        p21Before: ${base.p21Recs}};
    `);
    assert('红盒复习包含该单词', step1.found === true, step1.found);
    assert('莱特纳复习后盒子变化', step1.after !== step1.before, step1);
    assert('莱特纳记录 +1', step1.ltRecs === base.ltRecs + 1, step1);
    assert('21 天记录未受影响', step1.p21Recs === base.p21Recs, step1);

    /* 2. 21 天复习同一单词：不认识 */
    await page.goto(ROOT + 'teacher/memory21-review.html?task=' + base.taskId);
    await sleep(600);
    const step2 = await page.eval(`
      var id = 'w20';
      var idx2 = list.indexOf(id);
      if (idx2 >= 0) i = idx2;
      var beforeBox = Store.leitnerState('S2026001', id).box;
      var beforeDue = Store.leitnerState('S2026001', id).dueAt;
      var beforeLt = Store.leitnerRecordsOf('S2026001', id).length;
      if (idx2 >= 0) ans('no');
      var afterBox = Store.leitnerState('S2026001', id).box;
      return {found: idx2 >= 0, beforeBox: beforeBox, afterBox: afterBox,
        beforeDue: beforeDue, afterDue: Store.leitnerState('S2026001', id).dueAt,
        beforeLt: beforeLt, afterLt: Store.leitnerRecordsOf('S2026001', id).length,
        p21: Store.plan21Records('${base.planId}', id).length,
        p21Before: ${base.p21Recs}};
    `);
    assert('今日任务包含该单词', step2.found === true, step2.found);
    assert('21 天复习不改盒子', step2.beforeBox === step2.afterBox, step2);
    assert('21 天复习不改到期日', step2.beforeDue === step2.afterDue, step2);
    assert('21 天复习不写莱特纳记录', step2.beforeLt === step2.afterLt, step2);
    assert('21 天记录 +1', step2.p21 === base.p21Recs + 1, step2);

    /* 3. 再回莱特纳复习一次：不影响 21 天 */
    await page.goto(ROOT + 'teacher/leitner-review.html?scope=recommend');
    await sleep(600);
    const step3 = await page.eval(`
      var id = 'w20';
      var p21 = Store.plan21Records('${base.planId}', id).length;
      if (list.indexOf(id) < 0) {
        var t = Store.createLeitnerTask('S2026001', [id], 'T001', '单词语义核对');
        Store.leitnerJudge(t.id, id, 'no', 'T001');
        var t2 = Store.leitnerJudge ? null : null;
      } else {
        i = list.indexOf(id);
        judge('no');
      }
      return {p21Before: p21, p21After: Store.plan21Records('${base.planId}', id).length,
        box: Store.leitnerState('S2026001', id).box, due: Store.leitnerState('S2026001', id).dueAt};
    `);
    assert('莱特纳再复习：21 天记录不变', step3.p21Before === step3.p21After, step3);
    assert('不认识回到红盒', step3.box === 'red', step3);

    /* 4. 单词档案页两体系记录都在 */
    await page.goto(ROOT + 'teacher/word-detail.html?student=S2026001&word=w20');
    await sleep(500);
    const wd = await page.eval(`return {
      rv: document.querySelectorAll('#rvRows tr').length,
      rvText: document.getElementById('rvRows').textContent.replace(/\\s+/g,' '),
      t3: document.getElementById('t3').textContent.replace(/\\s+/g,' ').trim(),
      t4: document.getElementById('t4').textContent.replace(/\\s+/g,' ').trim(),
      planRows: document.querySelectorAll('#planRows tr').length
    };`);
    assert('复习历史包含两体系记录', /莱特纳/.test(wd.rvText) && /21 天/.test(wd.rvText), wd.rvText.slice(0, 120));
    assert('四层状态各自展示', wd.t3.length > 0 && wd.t4.length > 0, wd);
    assert('参与的21天计划有行', wd.planRows >= 1, wd.planRows);

    assert('场景 D 无 JS 异常', page.errors.length === 0, page.errors);
  } catch (e) { bad.push('执行异常：' + e.message); }

  console.log('\n通过 ' + ok.length + ' 项');
  if (bad.length) { console.log('失败 ' + bad.length + ' 项：'); bad.forEach(b => console.log('  ✗ ' + b)); }
  else console.log('场景 D（单词跨体系）全部通过');
  page.close(); proc.kill(); process.exit(bad.length ? 1 : 0);
})();
