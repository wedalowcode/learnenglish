/* ============================================================
   第二轮 UI 级验收：教师操作 → Store 写入 → 页面刷新 → 其他页读取 → 状态一致
   运行：node prototype/_test/r2-ui.js
   ============================================================ */
const { Page, launch, sleep, ROOT } = require('./cdp');
const ok = [], bad = [];
function assert(n, c, e) { c ? ok.push(n) : bad.push(n + (e !== undefined ? ' → ' + JSON.stringify(e) : '')); }

(async () => {
  const proc = await launch();
  const page = await Page.open();
  try {
    /* ============================================================
       一、21 天复习：判断 → 刷新 → 修正 → 历史保留
       ============================================================ */
    await page.goto(ROOT + 'teacher/memory21-review.html?student=S2026001');
    await sleep(500);

    const t0 = await page.eval(`return {id: task.id, n: list.length, wid: list[0], prog: document.getElementById('prog').textContent.replace(/\\s/g,'')};`);
    assert('21天: 今日节点 12 词', t0.n === 12, t0.n);
    assert('21天: 初始进度 0/12', t0.prog === '0/12', t0.prog);

    // 首次判断
    await page.eval(`ans('yes');`);
    await sleep(200);
    const after1 = await page.eval(`return {
      done: Store.plan21TaskStat(task.id).done,
      recs: Store.plan21TaskRecords(task.id).filter(function(r){return r.wordId==='${t0.wid}';}).length,
      prog: document.getElementById('prog').textContent.replace(/\\s/g,'')
    };`);
    assert('21天: 判断后唯一完成数=1', after1.done === 1, after1.done);
    assert('21天: 该词 1 条首次记录', after1.recs === 1, after1.recs);
    assert('21天: 进度刷新为 1/12', after1.prog === '1/12', after1.prog);

    // 刷新页面（真实 reload）
    await page.goto(ROOT + 'teacher/memory21-review.html?task=' + t0.id);
    await sleep(500);
    const reload = await page.eval(`return {
      done: Store.plan21TaskStat(task.id).done,
      prog: document.getElementById('prog').textContent.replace(/\\s/g,''),
      hasRec: !!Store.plan21FirstRecord(task.id, '${t0.wid}')
    };`);
    assert('21天: 刷新后完成数保持', reload.done === 1, reload.done);
    assert('21天: 刷新后进度保持 1/12', reload.prog === '1/12', reload.prog);
    assert('21天: 刷新后首判记录仍在', reload.hasRec === true);

    // 修正：走独立接口，保留历史
    await page.eval(`
      i = 0; render();
      openFix('${t0.wid}');
      document.querySelector('input[name=fxRes][value=no]').checked = true;
      document.getElementById('fx_note').value = '学员当时口误，实际不认识';
      doFix();
    `);
    await sleep(250);
    const fix = await page.eval(`return {
      all: Store.plan21TaskRecords(task.id).filter(function(r){return r.wordId==='${t0.wid}';}).length,
      eff: Store.plan21Effective(task.id)['${t0.wid}'].result,
      first: Store.plan21FirstRecord(task.id, '${t0.wid}').result,
      done: Store.plan21TaskStat(task.id).done,
      corr: Store.plan21TaskStat(task.id).corrections
    };`);
    assert('21天: 修正后该词 2 条记录', fix.all === 2, fix.all);
    assert('21天: 原始结果仍为 yes', fix.first === 'yes', fix.first);
    assert('21天: 当前有效结果=no', fix.eff === 'no', fix.eff);
    assert('21天: 修正不虚增完成数', fix.done === 1, fix.done);
    assert('21天: 修正计数=1', fix.corr === 1, fix.corr);

    // 判断界面不再提供普通判断按钮（只能修正）
    const ui = await page.eval(`i = 0; render(); return {
      judgeRows: document.querySelectorAll('.judge-row').length,
      fixBtn: /修正本次判断/.test(document.getElementById('stage').textContent)
    };`);
    assert('21天: 已判词不再出现普通判断按钮', ui.judgeRows === 0, ui.judgeRows);
    assert('21天: 已判词提供修正入口', ui.fixBtn === true);

    /* ============================================================
       二、莱特纳复习：重复判断被阻止 + 修正不重复推进
       ============================================================ */
    await page.goto(ROOT + 'teacher/leitner-review.html?student=S2026001&scope=red');
    await sleep(600);
    const L = await page.eval(`return {id: task.id, n: list.length, wid: list[0], box: Store.leitnerState('S2026001', list[0]).box};`);
    assert('莱特纳: 红盒任务 6 词', L.n === 6, L.n);
    assert('莱特纳: 起始盒子=红', L.box === 'red', L.box);

    await page.eval(`judge('yes');`);
    await sleep(200);
    const L1 = await page.eval(`return {
      box: Store.leitnerState('S2026001','${L.wid}').box,
      recs: Store.leitnerTaskRecords(task.id).filter(function(r){return r.wordId==='${L.wid}';}).length,
      done: Store.leitnerTaskStat(task.id).done
    };`);
    assert('莱特纳: 认识 → 升到黄盒1', L1.box === 'Y1', L1.box);
    assert('莱特纳: 该词 1 条记录', L1.recs === 1, L1.recs);
    assert('莱特纳: 完成数=1', L1.done === 1, L1.done);

    // 判断界面不再有普通判断按钮
    const Lui = await page.eval(`i = 0; render(); return {
      judgeRows: document.querySelectorAll('.judge-row').length,
      fixBtn: /修正本次判断/.test(document.getElementById('stage').textContent)
    };`);
    assert('莱特纳: 已判词无普通判断按钮', Lui.judgeRows === 0, Lui.judgeRows);
    assert('莱特纳: 已判词有修正入口', Lui.fixBtn === true);

    // 修正为不认识 → 应回红盒，而不是从 Y1 再推到 Y2
    await page.eval(`
      openFix('${L.wid}');
      document.querySelector('input[name=fxRes][value=no]').checked = true;
      previewFix();
      document.getElementById('fx_note').value = '认读错误，实际不认识';
      doFix();
    `);
    await sleep(250);
    const L2 = await page.eval(`return {
      box: Store.leitnerState('S2026001','${L.wid}').box,
      recs: Store.leitnerTaskRecords(task.id).filter(function(r){return r.wordId==='${L.wid}';}).length,
      done: Store.leitnerTaskStat(task.id).done,
      corr: Store.leitnerTaskStat(task.id).corrections,
      eff: Store.leitnerTaskRecords(task.id).filter(function(r){return r.wordId==='${L.wid}';}).slice(-1)[0]
    };`);
    assert('莱特纳: 修正后回红盒（未累计推进）', L2.box === 'red', L2.box);
    assert('莱特纳: 修正后 2 条记录', L2.recs === 2, L2.recs);
    assert('莱特纳: 修正不虚增完成数', L2.done === 1, L2.done);
    assert('莱特纳: 修正记录标 correction', L2.eff.correction === true);
    assert('莱特纳: 修正记录保留原值', L2.eff.correctionFrom === 'yes', L2.eff.correctionFrom);

    // 提前结束 → 已判记录保留，未完成仍到期
    await page.eval(`openEnd();
      document.getElementById('em_reason').value = '本节时间结束';
      doEnd();`);
    await sleep(300);
    const L3 = await page.eval(`return {
      status: Store.leitnerTask(task.id).status,
      done: Store.leitnerTaskStat(task.id).done,
      remain: Store.leitnerTask(task.id).remainWordIds.length,
      text: document.getElementById('stage').textContent.replace(/\\s+/g,' ')
    };`);
    assert('莱特纳: 未复习完 → 已中断', L3.status === '已中断', L3.status);
    assert('莱特纳: 已判 1 词保留', L3.done === 1, L3.done);
    assert('莱特纳: 剩余 5 词保留为未完成', L3.remain === 5, L3.remain);
    assert('莱特纳: 完成页声明不影响 21 天', /不影响\s*21\s*天/.test(L3.text), L3.text.slice(0, 80));

    // 刷新后状态一致
    await page.goto(ROOT + 'teacher/leitner-review.html?task=' + L.id);
    await sleep(500);
    const L4 = await page.eval(`return {status: task.status, done: Store.leitnerTaskStat(task.id).done};`);
    assert('莱特纳: 刷新后仍为已中断', L4.status === '已中断', L4.status);
    assert('莱特纳: 刷新后完成数一致', L4.done === 1, L4.done);

    // 盒子页读到同一状态
    await page.goto(ROOT + 'teacher/leitner.html?student=S2026001');
    await sleep(500);
    const Lpage = await page.eval(`return {
      box: (Store.leitnerState('S2026001','${L.wid}')||{}).box,
      hist: document.querySelectorAll('#histRows tr').length
    };`);
    assert('莱特纳: 盒子页与任务页状态一致', Lpage.box === 'red', Lpage.box);
    assert('莱特纳: 盒子页有复习历史', Lpage.hist >= 1, Lpage.hist);

    /* ============================================================
       四、家长端复习词表：来源 Store + 勾选持久化
       ============================================================ */
    await page.goto(ROOT + 'parent/review-words.html?student=S2026001');
    await sleep(500);
    const P = await page.eval(`return {
      rows: document.querySelectorAll('#rows tr').length,
      expect: Store.reviewWords('S2026001', {}).length,
      cnt: document.getElementById('mCnt').textContent,
      hasTbd: /待复习|暂不确定/.test(document.getElementById('rows').textContent)
    };`);
    assert('家长端: 行数=Store 派生数量', P.rows === P.expect, P.rows + ' vs ' + P.expect);
    assert('家长端: 计数一致', String(P.cnt) === String(P.expect), P.cnt);
    assert('家长端: 展示真实复习状态', P.hasTbd === true);

    // 切体系筛选，行数应变化
    const P2 = await page.eval(`document.getElementById('fSys').value='leitner'; render();
      return {rows: document.querySelectorAll('#rows tr').length, expect: Store.reviewWords('S2026001',{system:'leitner'}).length};`);
    assert('家长端: 体系筛选生效', P2.rows === P2.expect, P2.rows + ' vs ' + P2.expect);

    // 勾选家庭复习 → 刷新后保留，且不改正式状态
    const P3 = await page.eval(`
      document.getElementById('fSys').value='all'; render();
      var first = document.querySelector('#rows .check-box');
      var wid = Store.reviewWords('S2026001', {})[0].wordId;
      var stBefore = Store.wordState('S2026001', wid).state;
      first.click();
      return {wid: wid, stBefore: stBefore, checked: Store.familyCheck('S2026001', wid).checked,
        stAfter: Store.wordState('S2026001', wid).state};
    `);
    assert('家长端: 勾选已写入辅助表', P3.checked === true);
    assert('家长端: 勾选不改变正式状态', P3.stAfter === P3.stBefore, P3.stBefore + ' → ' + P3.stAfter);

    await page.goto(ROOT + 'parent/review-words.html?student=S2026001');
    await sleep(500);
    const P4 = await page.eval(`return {
      checked: Store.familyCheck('S2026001','${P3.wid}').checked,
      domOn: /✓/.test(document.querySelector('#rows .check-box').textContent)
    };`);
    assert('家长端: 刷新后勾选保留', P4.checked === true);
    assert('家长端: 刷新后界面勾选一致', P4.domOn === true);

    /* ============================================================
       六、跨页一致性：21 天记录 + 莱特纳记录 + 档案
       ============================================================ */
    await page.goto(ROOT + 'teacher/word-detail.html?student=S2026001&word=' + L.wid);
    await sleep(500);
    const D = await page.eval(`return {
      text: document.getElementById('stage') ? '' : document.body.textContent.replace(/\\s+/g,' '),
      leitner: Store.leitnerRecordsOf('S2026001','${L.wid}').length,
      box: (Store.leitnerState('S2026001','${L.wid}')||{}).box
    };`);
    assert('档案: 单词详情可读莱特纳记录', D.leitner >= 2, D.leitner);
    assert('档案: 盒状态与复习页一致', D.box === 'red', D.box);

    /* ============================================================
       三、训练提交：全部通过时不建空计划
       ============================================================ */
    await page.goto(ROOT + 'teacher/word-training-setup.html?student=S2026001');
    await sleep(500);
    const prep = await page.eval(`
      var t = Store.startTrainTask({studentId:'S2026001', teacherId:'T001', wordbookId:'WB001'});
      var ws = Store.wordsOfBook('WB001');
      ws.forEach(function(w){ Store.prescreenAnswer(t.id, w.id, false); });
      var r = Store.finishPrescreen(t.id);
      r.queue.forEach(function(id){ Store.trainJudge(t.id, id, 'yes', 'en2cn', 0); });
      Store.toFinalStage(t.id);
      r.queue.forEach(function(id){ Store.finalJudge(t.id, id, 'yes'); });
      return {id: t.id, queue: r.queue.length, plans: Store.plansOf('S2026001').length};
    `);
    assert('训练: 队列 23 词', prep.queue === 23, prep.queue);

    await page.goto(ROOT + 'teacher/word-training.html?task=' + prep.id);
    await sleep(500);
    const fd = await page.eval(`return {
      view: view,
      text: document.getElementById('stage').textContent.replace(/\\s+/g,' '),
      cbs: document.querySelectorAll('#cb_leitner, #cb_21, #cb_green').length
    };`);
    assert('训练: 进入结果确认页', fd.view === 'finalDone', fd.view);
    assert('训练: 提示没有待复习单词', /没有待复习单词/.test(fd.text), fd.text.slice(0, 90));
    assert('训练: 提交后可写入', fd.cbs === 3, fd.cbs);

    // 真实点击提交（不勾选任何体系）
    await page.eval(`submitAll();`);
    await sleep(400);
    const sum = await page.eval(`return {
      view: view,
      status: Store.trainTask('${prep.id}').status,
      noReview: Store.trainTask('${prep.id}').joins.empty,
      plans: Store.plansOf('S2026001').length,
      text: document.getElementById('stage').textContent.replace(/\\s+/g,' ')
    };`);
    assert('训练: 提交后进入汇总页', sum.view === 'summary', sum.view);
    assert('训练: 任务标记已完成', sum.status === '已完成', sum.status);
    assert('训练: 标记本次无需复习', sum.noReview === true);
    assert('训练: 未创建空 21 天计划', sum.plans === prep.plans, sum.plans + ' vs ' + prep.plans);
    assert('训练: 汇总页说明未创建计划', /没有待复习单词/.test(sum.text), sum.text.slice(0, 90));

    // 刷新后仍是汇总页，且不能重复提交
    await page.goto(ROOT + 'teacher/word-training.html?task=' + prep.id);
    await sleep(500);
    const again = await page.eval(`return {view: view, status: task.status};`);
    assert('训练: 刷新后仍为已完成', again.status === '已完成', again.status);
    assert('训练: 刷新后仍在汇总页', again.view === 'summary', again.view);

    // 学员档案能看到结果
    await page.goto(ROOT + 'teacher/student-profile.html?student=S2026001');
    await sleep(600);
    const prof = await page.eval(`return {
      taskRows: document.querySelectorAll('#taskRows tr').length,
      articleRows: document.querySelectorAll('#articleRows tr').length,
      articleHasData: /My First Day at School/.test(document.getElementById('articleRows').textContent)
    };`);
    assert('档案: 训练任务表有数据', prof.taskRows >= 1, prof.taskRows);
    assert('档案: 文章训练表读真实数据', prof.articleHasData === true);
    assert('档案: 文章训练有记录', prof.articleRows >= 1, prof.articleRows);

    /* ============================================================
       五、课时冲正：真实新增流水 + 账户余额 + 原流水保留
       ============================================================ */
    await page.goto(ROOT + 'admin/hour-flow.html');
    await sleep(500);
    const F0 = await page.eval(`return {
      flows: Store.flows().length,
      rows: document.querySelectorAll('#rows tr').length,
      bal: Store.account('ACC-2026-0004').remain
    };`);
    assert('冲正: 流水列表渲染', F0.rows >= 10, F0.rows);

    // 对 FL20261029006（孙浩宇 -1 课时）冲正
    await page.eval(`
      openRev('FL20261029006');
      document.getElementById('rv_hours').value = 1;
      document.getElementById('rv_reason').value = '课程取消';
      document.getElementById('rv_note').value = '课程 C20261029005 实际未上课，冲回 1 课时';
      doRev();
    `);
    await sleep(400);
    const F1 = await page.eval(`return {
      flows: Store.flows().length,
      bal: Store.account('ACC-2026-0004').remain,
      newFlow: Store.flows().filter(function(f){return f.type==='扣课冲正' && f.ref.indexOf('FL20261029006')>=0;})[0],
      orig: Store.flow('FL20261029006'),
      revRows: document.querySelectorAll('#revRows tr').length,
      revText: document.getElementById('revRows').textContent.replace(/\\s+/g,' ')
    };`);
    assert('冲正: 流水 +1', F1.flows === F0.flows + 1, F1.flows);
    assert('冲正: 余额 +1', F1.bal === F0.bal + 1, F1.bal);
    assert('冲正: 新流水方向相反', !!F1.newFlow && F1.newFlow.delta === 1);
    assert('冲正: 新流水记录前后余额', F1.newFlow.before === F0.bal && F1.newFlow.after === F0.bal + 1);
    assert('冲正: 原流水保留', F1.orig.delta === -1 && F1.orig.after === F0.bal);
    assert('冲正: 冲正记录表新增 1 行', F1.revRows === 1, F1.revRows);
    assert('冲正: 记录含原因与操作人', /课程取消/.test(F1.revText) && /张敏/.test(F1.revText));

    // 刷新后仍在
    await page.goto(ROOT + 'admin/hour-flow.html');
    await sleep(500);
    const F2 = await page.eval(`return {
      flows: Store.flows().length,
      bal: Store.account('ACC-2026-0004').remain,
      revRows: document.querySelectorAll('#revRows tr').length,
      btn: (document.querySelector('#rows tr td.ops')||{}).textContent || ''
    };`);
    assert('冲正: 刷新后流水仍在', F2.flows === F1.flows, F2.flows);
    assert('冲正: 刷新后余额一致', F2.bal === F1.bal, F2.bal);
    assert('冲正: 刷新后冲正记录仍在', F2.revRows === 1, F2.revRows);

    // 再次冲正同一笔 → 必须被拒绝
    const F3 = await page.eval(`try { Store.reverseFlow('FL20261029006', 1, '课程取消', '重复冲正', '张敏'); return 'no-error'; }
      catch(e) { return e.message; }`);
    assert('冲正: 重复全额冲正被拒绝', /已全额冲正/.test(F3), F3);

  } finally {
    try { page.close(); } catch (e) {}
    try { proc.kill(); } catch (e) {}
  }

  console.log('');
  if (bad.length) {
    console.log('失败 ' + bad.length + ' 项：');
    bad.forEach(b => console.log('  ✗ ' + b));
    console.log('');
  }
  console.log('通过 ' + ok.length + ' / ' + (ok.length + bad.length) + ' 项');
  console.log(bad.length ? '存在失败断言' : '第二轮 UI 链路全部通过');
  process.exit(bad.length ? 1 : 0);
})();
