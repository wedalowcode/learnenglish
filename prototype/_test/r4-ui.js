/* ============================================================
   第四轮迭代验收（UI 链路）：真实上传 Excel → 生成词库 → 刷新后仍在
   ------------------------------------------------------------
   用 CDP 的 DOM.setFileInputFiles 把 fixtures 里的真实 .xlsx / .xls
   喂给 <input type=file>，走完整的页面流程（不是直接调 Store）：
     场景一：一次选 3 个文件 → 3 个词库，各自单词正确
     场景二：第二批含已有单词 → 复用基础单词，原词库排序与学员状态不变
     场景三：文件内重复 → 跳过 3 行，不重复关联
     场景四：一个坏文件 + 两个正常文件 → 独立失败，其他照常入库，失败行可下载
     场景五：刷新页面后词库、关联、导入历史仍在；教师端能选到这些词库
   运行：node prototype/_test/r4-ui.js
   ============================================================ */
const path = require('path');
const fs = require('fs');
const { Page, launch, sleep, ROOT } = require('./cdp');

const FIX = path.join(__dirname, 'fixtures');
const f = n => path.join(FIX, n);

const ok = [];
const bad = [];
function assert(name, cond, extra) {
  if (cond) ok.push(name);
  else bad.push(name + (extra !== undefined ? ' → ' + JSON.stringify(extra) : ''));
}

/* 把真实文件塞进 <input type=file>，触发页面自己的 change 处理 */
async function setFiles(page, selector, files) {
  const doc = await page.send('DOM.getDocument', { depth: -1 });
  const q = await page.send('DOM.querySelector', { nodeId: doc.result.root.nodeId, selector });
  if (!q.result || !q.result.nodeId) throw new Error('找不到文件输入框 ' + selector);
  await page.send('DOM.setFileInputFiles', { files, nodeId: q.result.nodeId });
}

function cards(page) {
  return page.eval(`
    return [].slice.call(document.querySelectorAll('.fcard')).map(function (c) {
      var ms = {};
      [].slice.call(c.querySelectorAll('.ms')).forEach(function (m) {
        ms[m.querySelector('.k').textContent.trim()] = m.querySelector('.v').textContent.replace(/\\s+/g, '');
      });
      var nm = c.querySelector('input[id^="nm-"]');
      return {
        name: nm ? nm.value : '',
        title: c.querySelector('.fname').textContent.replace(/\\s+/g, ' ').trim(),
        sub: c.querySelector('.fsub').textContent.replace(/\\s+/g, ' ').trim(),
        stats: ms
      };
    });`);
}

(async () => {
  const proc = await launch();
  const page = await Page.open();
  await page.send('DOM.enable');

  /* 干净起点：重置数据层后重新进页面 */
  await page.goto(ROOT + 'resource/import.html');
  await page.eval('Store.reset(); return 1;');
  await page.goto(ROOT + 'resource/import.html');

  const base = await page.eval(`return {
    books: Store.wordbooks().length,
    words: Store.db.words.length,
    links: Store.db.wordbookWords.length,
    wb1seq: Store.bookWords('WB001').map(function(w){return w.seq + ':' + w.en;}).join(','),
    states: JSON.stringify(Store.db.studentWordStates.map(function(s){return s.wordId + ':' + s.state;})),
    leitner: JSON.stringify(Store.db.leitnerStates.map(function(s){return s.wordId + ':' + s.box;}))
  };`);

  /* ============================================================
     场景一：一次选 3 个文件，生成 3 个词库
     ============================================================ */
  await setFiles(page, '#fileInput', [
    f('WOWEnglish-全季.xlsx'), f('小学考纲词库.xlsx'), f('初中超前词汇.xlsx')
  ]);
  await sleep(1400);

  const c1 = await cards(page);
  assert('场景一：页面上出现 3 个文件卡片', c1.length === 3, c1.length);
  assert('场景一：文件名默认作为词库名',
    c1[0].name === 'WOWEnglish-全季' && c1[1].name === '小学考纲词库' && c1[2].name === '初中超前词汇',
    c1.map(x => x.name));
  assert('场景一：三份文件都解析就绪', c1.every(x => x.title.indexOf('就绪') >= 0), c1.map(x => x.title));
  assert('场景一：解析行数正确',
    c1[0].stats['解析行数'] === '12行' && c1[1].stats['解析行数'] === '10行' && c1[2].stats['解析行数'] === '10行',
    c1.map(x => x.stats['解析行数']));
  assert('场景一：第 2 个文件自动跳过封面找到数据', c1[1].sub.indexOf('表头第 4 行') >= 0, c1[1].sub);
  assert('场景一：多工作表文件自动选中的是数据表', c1[2].sub.indexOf('当前「词汇表」') >= 0, c1[2].sub);
  assert('场景一：有效单词数与解析行数一致',
    c1.every(x => x.stats['有效单词'].replace('个', '') === x.stats['解析行数'].replace('行', '')),
    c1.map(x => x.stats));

  /* 入库前改词库名（验证「允许入库前修改名称」） */
  await page.eval(`
    var el = document.querySelectorAll('input[id^="nm-"]')[0];
    el.value = 'WOWEnglish 全季词库';
    el.dispatchEvent(new Event('input'));
    return el.value;`);
  const c1b = await cards(page);
  assert('场景一：入库前可改词库名称', c1b[0].name === 'WOWEnglish 全季词库', c1b[0].name);

  await page.eval(`document.getElementById('importAllBtn').click(); return 1;`);
  await sleep(1200);

  const after1 = await page.eval(`return {
    books: Store.wordbooks().length,
    result: document.getElementById('resultBody').innerText.replace(/\\s+/g,' ').trim(),
    created: Store.wordbooks().filter(function(b){return ['WOWEnglish 全季词库','小学考纲词库','初中超前词汇'].indexOf(b.name) >= 0;})
      .map(function(b){return {name:b.name, count:b.wordCount, file:b.sourceFile};})
  };`);
  assert('场景一：一次导入生成 3 个词库', after1.books === base.books + 3, after1.books);
  assert('场景一：3 个词库名称正确', after1.created.length === 3, after1.created);
  assert('场景一：每个词库单词数正确',
    after1.created.map(b => b.count).sort((a, b) => a - b).join(',') === '10,10,12',
    after1.created.map(b => b.name + ':' + b.count));
  assert('场景一：词库记录来源文件', after1.created.every(b => /\.xlsx$/.test(b.file)));

  /* 词库详情只看自己的单词 */
  const detailId = await page.eval(`
    return Store.wordbooks().filter(function(b){return b.name === 'WOWEnglish 全季词库';})[0].id;`);
  await page.goto(ROOT + 'resource/wordbook-detail.html?id=' + detailId);
  await sleep(500);
  const det = await page.eval(`return {
    title: document.getElementById('bkName').textContent.trim(),
    rows: document.querySelectorAll('#wordRows tr').length,
    first: [].slice.call(document.querySelectorAll('#wordRows .w-en')).map(function(e){return e.textContent.trim();}),
    stat: document.getElementById('sCount').textContent.replace(/\\s+/g,''),
    hasOther: document.body.innerText.indexOf('sister') >= 0 || document.body.innerText.indexOf('vacation') >= 0
  };`);
  assert('场景一：详情页按 ID 打开正确词库', det.title === 'WOWEnglish 全季词库', det.title);
  assert('场景一：详情页只显示本词库 12 个单词', det.rows === 12, det.rows);
  assert('场景一：详情页单词来自本词库', det.first[0] === 'apple' && det.first[11] === 'watermelon', det.first);
  assert('场景一：详情页不混入其他词库的单词', det.hasOther === false);

  /* ============================================================
     场景二：第二批包含已有单词
     ============================================================ */
  await page.goto(ROOT + 'resource/import.html');
  await setFiles(page, '#fileInput', [f('新初一单词.xlsx'), f('人教版中学-按单元.xlsx')]);
  await sleep(1300);

  const before2 = await page.eval(`return { words: Store.db.words.length,
    wb1seq: Store.bookWords('WB001').map(function(w){return w.seq + ':' + w.en;}).join(',') };`);

  const c2 = await cards(page);
  assert('场景二：两个文件都解析就绪', c2.length === 2 && c2.every(x => x.title.indexOf('就绪') >= 0), c2.map(x => x.title));
  assert('场景二：识别出已有基础单词 4 个', c2[0].stats['已存在单词'] === '4个', c2[0].stats);
  assert('场景二：新增基础单词只有 6 个', c2[0].stats['新增基础单词'] === '6个', c2[0].stats);

  await page.eval(`document.getElementById('importAllBtn').click(); return 1;`);
  await sleep(1200);

  const after2 = await page.eval(`return {
    words: Store.db.words.length,
    reuseInBatch: (function(){
      var b2 = Store.wordbooks().filter(function(b){return b.name === '人教版中学-按单元';})[0];
      var j = Store.importJobsOf(b2.id)[0];
      return j.stats.existingWords;
    })(),
    names: Store.wordbooks().map(function(b){return b.name + ':' + b.wordCount;}).join(' | '),
    wb1seq: Store.bookWords('WB001').map(function(w){return w.seq + ':' + w.en;}).join(','),
    states: JSON.stringify(Store.db.studentWordStates.map(function(s){return s.wordId + ':' + s.state;})),
    leitner: JSON.stringify(Store.db.leitnerStates.map(function(s){return s.wordId + ':' + s.box;})),
    dupBase: Store.db.words.filter(function(w){return w.en === 'welcome';}).length,
    welcomeBooks: Store.wordbooksOfWord(Store.wordByEn('welcome').id).length
  };`);
  assert('场景二：已存在的基础单词不重复创建', after2.dupBase === 1, after2.dupBase);
  assert('场景二：新增基础单词只有 11 个', after2.words === before2.words + 11, after2.words - before2.words);
  assert('场景二：同一批里后一个文件复用前一个文件新增的单词', after2.reuseInBatch === 3, after2.reuseInBatch);
  assert('场景二：同一个单词可以进入多个词库', after2.welcomeBooks === 2, after2.welcomeBooks);
  assert('场景二：原有词库排序不受影响', after2.wb1seq === before2.wb1seq);
  assert('场景二：原有学员学习状态不受影响', after2.states === base.states);
  assert('场景二：莱特纳状态不受影响', after2.leitner === base.leitner);

  /* ============================================================
     场景三：文件内部重复
     ============================================================ */
  await page.goto(ROOT + 'resource/import.html');
  await setFiles(page, '#fileInput', [f('人教版一年级起点.xlsx')]);
  await sleep(1000);

  const c3 = await cards(page);
  assert('场景三：识别出文件内重复 3 行', c3[0].stats['文件内重复'] === '3行', c3[0].stats);
  assert('场景三：有效单词只有 7 个', c3[0].stats['有效单词'] === '7个', c3[0].stats);
  assert('场景三：重复行在页面上有说明', 
    await page.eval(`return document.querySelector('.fcard').innerText.indexOf('文件内重复') >= 0;`));

  await page.eval(`document.getElementById('importAllBtn').click(); return 1;`);
  await sleep(1000);

  const after3 = await page.eval(`
    var b = Store.wordbooks().filter(function(x){return x.name === '人教版一年级起点';})[0];
    var ids = Store.bookWords(b.id).map(function(w){return w.id;});
    var job = Store.importJobsOf(b.id)[0];
    return { count: b.wordCount, uniq: new Set(ids).size, ids: ids.length,
             skipped: job.stats.skipped, failed: job.stats.failed };`);
  assert('场景三：词库只写入 7 个单词', after3.count === 7, after3.count);
  assert('场景三：不会重复关联同一个单词', after3.uniq === after3.ids, after3);
  assert('场景三：导入结果记录跳过 3 条', after3.skipped === 3, after3.skipped);

  /* ============================================================
     场景四：一个坏文件 + 两个正常文件
     ============================================================ */
  await page.goto(ROOT + 'resource/import.html');
  await setFiles(page, '#fileInput', [
    f('外研社版中学英语(全).xlsx'), f('人教版初中英语(全).xlsx'), f('新七年级上.xls')
  ]);
  await sleep(1400);

  const c4 = await cards(page);
  assert('场景四：坏文件单独显示需要处理', c4[0].title.indexOf('需要处理') >= 0, c4[0].title);
  assert('场景四：坏文件不影响其他文件就绪',
    c4[1].title.indexOf('就绪') >= 0 && c4[2].title.indexOf('就绪') >= 0, c4.map(x => x.title));
  assert('场景四：部分缺字段的文件显示缺必填 3 行', c4[1].stats['缺失必填'] === '3行', c4[1].stats);
  assert('场景四：.xls 老格式也能解析', c4[2].stats['解析行数'] === '8行', c4[2].stats);

  const booksBefore4 = await page.eval('return Store.wordbooks().length;');
  await page.eval(`document.getElementById('importAllBtn').click(); return 1;`);
  await sleep(1200);

  const after4 = await page.eval(`
    var bad = Store.wordbooks().filter(function(b){return b.name.indexOf('外研社版中学英语') === 0;});
    var part = Store.wordbooks().filter(function(b){return b.name === '人教版初中英语(全)';})[0];
    var okBook = Store.wordbooks().filter(function(b){return b.name === '新七年级上';})[0];
    var failJob = Store.importJobs().filter(function(j){return j.status === '失败';})[0];
    var partJob = Store.importJobsOf(part.id)[0];
    return {
      books: Store.wordbooks().length,
      badCreated: bad.length,
      partCount: part ? part.wordCount : -1,
      okCount: okBook ? okBook.wordCount : -1,
      partFailed: partJob ? partJob.stats.failed : -1,
      failJob: failJob ? { file: failJob.fileName, error: failJob.error } : null,
      csv: failJob ? Store.failedRowsCsv(failJob.id).slice(0, 60) : '',
      partCsv: Store.failedRowsCsv(partJob.id).split('\\r\\n').length,
      dlEnabled: !document.getElementById('dlBtn').disabled
    };`);
  assert('场景四：坏文件没有创建词库', after4.badCreated === 0, after4.badCreated);
  assert('场景四：另外两个文件正常入库', after4.books === booksBefore4 + 2, after4.books);
  assert('场景四：缺字段文件写入 7 个单词', after4.partCount === 7, after4.partCount);
  assert('场景四：.xls 文件写入 8 个单词', after4.okCount === 8, after4.okCount);
  assert('场景四：失败行数量正确（3 行）', after4.partFailed === 3, after4.partFailed);
  assert('场景四：失败文件留下记录与原因',
    after4.failJob && /未识别出|没有表头|没有数据/.test(after4.failJob.error), after4.failJob);
  assert('场景四：可以下载错误报告', after4.csv.length > 0 && after4.csv.indexOf('行号') > 0, after4.csv);
  assert('场景四：失败行 CSV 有 3 行数据', after4.partCsv === 4, after4.partCsv);
  assert('场景四：下载按钮可用', after4.dlEnabled === true);

  /* 已成功词库没有被坏文件破坏 */
  const intact = await page.eval(`
    var part = Store.wordbooks().filter(function(b){return b.name === '人教版初中英语(全)';})[0];
    return { count: part.wordCount, words: Store.bookWords(part.id).map(function(w){return w.en;}).join(',') };`);
  assert('场景四：成功词库内容完整', intact.count === 7 && intact.words.indexOf('spring') === 0, intact);

  /* ============================================================
     场景五：刷新后仍在 + 教师端可选
     ============================================================ */
  const snap = await page.eval(`return {
    books: Store.wordbooks().length,
    links: Store.db.wordbookWords.length,
    words: Store.db.words.length,
    jobs: Store.importJobs().length,
    sample: (function(){
      var b = Store.wordbooks().filter(function(x){return x.name === '人教版初中英语(全)';})[0];
      return { id: b.id, list: Store.bookWords(b.id).map(function(w){return w.en;}).join(',') };
    })()
  };`);

  await page.goto(ROOT + 'resource/import.html');
  await sleep(400);
  const reloaded = await page.eval(`return {
    books: Store.wordbooks().length,
    links: Store.db.wordbookWords.length,
    words: Store.db.words.length,
    jobs: Store.importJobs().length,
    sample: Store.bookWords('${snap.sample.id}').map(function(w){return w.en;}).join(','),
    listNames: (function(){
      var ids = Store.wordbooks().map(function(b){return b.name;});
      return ids;
    })()
  };`);
  assert('场景五：刷新后词库数量不变', reloaded.books === snap.books, reloaded.books);
  assert('场景五：刷新后关联数不变', reloaded.links === snap.links, reloaded.links);
  assert('场景五：刷新后基础单词数不变', reloaded.words === snap.words, reloaded.words);
  assert('场景五：刷新后导入历史仍在', reloaded.jobs === snap.jobs, reloaded.jobs);
  assert('场景五：刷新后词库详情内容一致', reloaded.sample === snap.sample.list, reloaded.sample);
  assert('场景五：导入的词库都在列表里',
    reloaded.listNames.indexOf('WOWEnglish 全季词库') >= 0
    && reloaded.listNames.indexOf('人教版一年级起点') >= 0
    && reloaded.listNames.indexOf('新七年级上') >= 0, reloaded.listNames);

  /* 词库列表页 */
  await page.goto(ROOT + 'resource/wordbook-list.html');
  await sleep(500);
  const list = await page.eval(`return {
    rows: document.querySelectorAll('#rows tr').length,
    txt: document.getElementById('rows').innerText,
    total: document.getElementById('totalTip').textContent
  };`);
  assert('场景五：词库列表从 Store 读取', list.rows === reloaded.books, [list.rows, reloaded.books]);
  assert('场景五：列表能看到导入的词库', list.txt.indexOf('WOWEnglish 全季词库') >= 0);

  /* 教师端选词库（第六轮起：训练设置页只列「该学员已授权」的词库，
     导入的词库需要管理员授权后才会出现在教师端） */
  await page.goto(ROOT + 'teacher/word-training-setup.html?student=S2026001');
  await sleep(600);
  const teach = await page.eval(`return {
    txt: document.getElementById('rows') ? document.getElementById('rows').innerText : '',
    rows: document.querySelectorAll('#rows tr').length
  };`);
  assert('场景五：教师端默认只列已授权词库', teach.txt.indexOf('WOWEnglish 全季词库') < 0, teach.rows);
  assert('场景五：教师端不列停用词库', teach.txt.indexOf('人教版 九年级上 Unit 3 词汇') < 0);

  /* 管理员授权导入词库后，教师端即可选到 */
  await page.eval(`(function(){
    Store.setSession({ role:'ops', operatorName:'王敏' });
    var b = Store.wordbooks().filter(function(x){ return x.name === 'WOWEnglish 全季词库'; })[0];
    if (b) Store.grantWordbook('S2026001', b.id, { reason: '第四轮回归：授权导入词库给教师使用' });
    Store.setSession({ role:'teacher', operatorName:'李婉', teacherId:'T001' });
  })();`);
  await page.goto(ROOT + 'teacher/word-training-setup.html?student=S2026001');
  await sleep(600);
  const teach2 = await page.eval(`return {
    txt: document.getElementById('rows') ? document.getElementById('rows').innerText : '',
    rows: document.querySelectorAll('#rows tr').length
  };`);
  assert('场景五：授权后教师端能选到导入的词库', teach2.txt.indexOf('WOWEnglish 全季词库') >= 0, teach2.rows);

  /* 控制台异常 */
  assert('全流程无页面异常', page.errors.length === 0, page.errors.slice(0, 3));

  page.close();
  proc.kill();

  console.log('\n第四轮 UI 链路验收');
  console.log('  通过 ' + ok.length + ' 项');
  if (bad.length) {
    console.log('  失败 ' + bad.length + ' 项：');
    bad.forEach(b => console.log('   ✗ ' + b));
    process.exit(1);
  }
  console.log('  全部通过');
})();
