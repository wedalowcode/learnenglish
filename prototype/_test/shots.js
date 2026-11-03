/* 生成关键页面截图（复用真实交互后的状态） */
const fs = require('fs');
const { Page, launch, sleep, ROOT } = require('./cdp');

(async () => {
  const proc = await launch();
  const page = await Page.open();
  const dir = 'D:/低代码/英语一对一教学软件/prototype/_shots/';
  if (!fs.existsSync(dir)) fs.mkdirSync(dir);

  async function shot(name) {
    const r = await page.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
    fs.writeFileSync(dir + name + '.png', Buffer.from(r.result.data, 'base64'));
    console.log('shot', name);
  }

  // 预筛选结果
  await page.goto(ROOT + 'teacher/word-training-setup.html');
  await page.eval(`selected='WB001'; render(); start();`);
  await sleep(700);
  const tid = await page.eval(`return task.id;`);
  await page.eval(`for(var k=0;k<9;k++) answer(true); for(var k=9;k<23;k++) answer(false);`);
  await sleep(400);
  await shot('01-prescreen-result');

  // 训练页
  await page.eval(`goTraining();`);
  await sleep(700);
  await shot('02-training-group');
  await page.eval(`judge('yes');judge('yes');judge('yes');judge('no');judge('no');`);
  await sleep(300);
  await shot('03-training-groupdone');

  // 跑完
  await page.eval(`
    for (var g=1; g<groups.length; g++){ gi=g; wi=0; view='group';
      Store.setTaskPos(task.id,{groupIndex:g,wordIndex:0});
      for (var k=0;k<groups[g].length;k++){ judge(k<3?'yes':'no'); } }
    nextGroup();
  `);
  await sleep(300);
  await shot('04-final-stage');
  await page.eval(`
    var n=0; while(view==='final' && n<40){ var id=ids[task.finalIndex||0];
      finalJudge(task.results[id].result==='yes'?'yes':'no'); n++; }
  `);
  await sleep(300);
  await shot('05-summary');

  // 档案与复习
  for (const [f, name] of [
    ['teacher/word-detail.html?student=S2026001&word=w13', '06-word-detail'],
    ['teacher/student-profile.html?student=S2026001', '07-profile'],
    ['teacher/leitner.html?student=S2026001', '08-leitner'],
    ['teacher/memory21.html?student=S2026001', '09-memory21'],
    ['teacher/word-training-setup.html', '10-setup']
  ]) {
    await page.goto(ROOT + f);
    await sleep(500);
    await shot(name);
  }

  // 莱特纳复习页
  await page.goto(ROOT + 'teacher/leitner-review.html?student=S2026001&scope=recommend');
  await sleep(600);
  await shot('11-leitner-review');

  // 推荐预览
  await page.goto(ROOT + 'teacher/leitner.html?student=S2026001');
  await sleep(400);
  await page.eval(`openRecommend();`);
  await sleep(200);
  await shot('12-recommend');

  console.log('errors', page.errors);
  page.close(); proc.kill(); process.exit(0);
})();
