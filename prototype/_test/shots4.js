/* 第四轮视觉走查：批量导入 / 词库列表 / 词库详情 的真实状态截图 */
const fs = require('fs');
const path = require('path');
const { Page, launch, sleep, ROOT } = require('./cdp');

const FIX = path.join(__dirname, 'fixtures');
const f = n => path.join(FIX, n);

async function setFiles(page, selector, files) {
  const doc = await page.send('DOM.getDocument', { depth: -1 });
  const q = await page.send('DOM.querySelector', { nodeId: doc.result.root.nodeId, selector });
  await page.send('DOM.setFileInputFiles', { files, nodeId: q.result.nodeId });
}

(async () => {
  const proc = await launch();
  const page = await Page.open();
  await page.send('DOM.enable');

  await page.goto(ROOT + 'resource/import.html');
  await page.eval('Store.reset(); return 1;');
  await page.goto(ROOT + 'resource/import.html');
  await sleep(300);

  const out = [];
  out.push(await page.shot('20-导入-空状态'));

  /* 一批文件（含坏文件） */
  await setFiles(page, '#fileInput', [
    f('WOWEnglish-全季.xlsx'), f('小学考纲词库.xlsx'), f('初中超前词汇.xlsx')
  ]);
  await sleep(1500);
  out.push(await page.shot('21-导入-三个文件解析完成'));

  /* 文件明细分弹窗 */
  await page.eval(`showDetail(document.querySelector('.fcard').id.replace('card-','')); return 1;`);
  await sleep(400);
  out.push(await page.shot('22-导入-解析明细弹窗'));
  await page.eval(`Proto.closeModal('detailModal'); return 1;`);

  /* 入库结果 */
  await page.eval(`document.getElementById('importAllBtn').click(); return 1;`);
  await sleep(1600);
  out.push(await page.shot('23-导入-入库结果'));

  /* 第二批：含重复与坏文件 */
  await page.goto(ROOT + 'resource/import.html');
  await setFiles(page, '#fileInput', [
    f('人教版一年级起点.xlsx'), f('外研社版中学英语(全).xlsx'), f('人教版初中英语(全).xlsx')
  ]);
  await sleep(1500);
  out.push(await page.shot('24-导入-重复与坏文件'));

  await page.eval(`document.getElementById('importAllBtn').click(); return 1;`);
  await sleep(1600);
  out.push(await page.shot('25-导入-部分成功结果'));

  /* 词库列表 */
  await page.goto(ROOT + 'resource/wordbook-list.html');
  await sleep(600);
  out.push(await page.shot('26-词库列表'));

  /* 词库详情 */
  const id = await page.eval(`
    var b = Store.wordbooks().filter(function(x){return x.name === 'WOWEnglish 全季';})[0]
         || Store.wordbooks().filter(function(x){return /WOWEnglish/.test(x.name);})[0];
    return b.id;`);
  await page.goto(ROOT + 'resource/wordbook-detail.html?id=' + id);
  await sleep(600);
  out.push(await page.shot('27-词库详情-单词列表'));

  await page.eval(`document.querySelector('[data-pane="p3"]').click(); return 1;`);
  await sleep(300);
  out.push(await page.shot('28-词库详情-导入记录'));

  console.log(out.join('\n'));
  console.log('errors', page.errors);
  page.close();
  proc.kill();
})();
