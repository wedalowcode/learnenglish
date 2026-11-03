/* 第二轮页面视觉核对截图 */
const fs = require('fs');
const { Page, launch, sleep, ROOT } = require('./cdp');

(async () => {
  const proc = await launch();
  const page = await Page.open();
  const dir = 'D:/低代码/英语一对一教学软件/prototype/_shots2/';
  if (!fs.existsSync(dir)) fs.mkdirSync(dir);

  async function shot(n) {
    const r = await page.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
    fs.writeFileSync(dir + n + '.png', Buffer.from(r.result.data, 'base64'));
    console.log('shot', n);
  }

  // 首页第二轮卡片
  await page.goto(ROOT + 'index.html');
  await sleep(600);
  await shot('01-index-round2');

  // 21 天复习：已判 + 修正入口
  await page.goto(ROOT + 'teacher/memory21-review.html?student=S2026001');
  await sleep(600);
  await page.eval(`ans('yes'); ans('yes'); i=0; render();`);
  await sleep(300);
  await shot('02-p21-judged');

  // 21 天修正弹窗
  await page.eval(`openFix(list[0]);`);
  await sleep(300);
  await shot('03-p21-fix-modal');

  // 21 天完成页（含修正标记）
  await page.eval(`
    Proto.closeModal('fixModal');
    var n=0; while(Store.plan21TaskStat(task.id).remain>0 && n<20){
      var f=Store.plan21TaskStat(task.id).remainWordIds[0];
      ans('no'); if(task.finalIndex===undefined){}
      n++;
    }
    renderDone();
  `);
  await sleep(400);
  await shot('04-p21-done');

  // 莱特纳复习：已判 + 修正
  await page.goto(ROOT + 'teacher/leitner-review.html?student=S2026001&scope=red');
  await sleep(700);
  await page.eval(`judge('yes'); judge('no'); i=0; render();`);
  await sleep(300);
  await shot('05-leitner-judged');
  await page.eval(`openFix(list[0]); document.querySelector('input[name=fxRes][value=no]').checked=true; previewFix();`);
  await sleep(300);
  await shot('06-leitner-fix-modal');
  await page.eval(`Proto.closeModal('fixModal'); finishNow();`);
  await sleep(400);
  await shot('07-leitner-done');

  // 训练结果确认页（全部通过 → 空复习提示）
  await page.goto(ROOT + 'teacher/word-training-setup.html?student=S2026001');
  await sleep(500);
  const tid = await page.eval(`
    var t = Store.startTrainTask({studentId:'S2026001', teacherId:'T001', wordbookId:'WB001'});
    var ws = Store.wordsOfBook('WB001');
    ws.forEach(function(w){ Store.prescreenAnswer(t.id, w.id, w.id < 'w10'); });
    var r = Store.finishPrescreen(t.id);
    r.queue.forEach(function(id){ Store.trainJudge(t.id, id, 'yes', 'en2cn', 0); });
    Store.toFinalStage(t.id);
    r.queue.forEach(function(id){ Store.finalJudge(t.id, id, 'yes'); });
    return t.id;
  `);
  await page.goto(ROOT + 'teacher/word-training.html?task=' + tid);
  await sleep(600);
  await shot('08-train-empty-review');
  await page.eval(`submitAll();`);
  await sleep(500);
  await shot('09-train-summary-empty');

  // 文章训练
  await page.goto(ROOT + 'teacher/article-training.html?student=S2026001');
  await sleep(500);
  await shot('10-article-select');
  await page.eval(`pick('AR001');`);
  await sleep(500);
  await shot('11-article-listen');
  await page.eval(`confirmListen(); playSentence(document.querySelector('.audio-btn')); viewCn(); markSentence('通过');`);
  await sleep(500);
  await shot('12-article-sentence');
  await page.eval(`si=7; stage='summary'; render();`);
  await sleep(400);
  await shot('13-article-summary');

  // 家长端
  await page.goto(ROOT + 'parent/review-words.html?student=S2026001');
  await sleep(600);
  await shot('14-parent-words');

  // 课时冲正
  await page.goto(ROOT + 'admin/hour-flow.html');
  await sleep(600);
  await shot('15-hour-flow');
  await page.eval(`openRev('FL20261029006');`);
  await sleep(300);
  await shot('16-hour-rev-modal');
  await page.eval(`
    document.getElementById('rv_hours').value=1;
    document.getElementById('rv_reason').value='课程取消';
    document.getElementById('rv_note').value='课程 C20261029005 实际未上课，冲回 1 课时';
    doRev();
  `);
  await sleep(500);
  await shot('17-hour-after-rev');

  // 单词档案（含修正标记）
  await page.goto(ROOT + 'teacher/word-detail.html?student=S2026001&word=w13');
  await sleep(600);
  await page.eval(`document.querySelectorAll('.tab')[3].click();`);
  await sleep(300);
  await shot('18-word-detail-history');

  console.log('errors', page.errors);
  page.close(); proc.kill(); process.exit(0);
})();
