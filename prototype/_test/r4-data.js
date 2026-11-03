/* ============================================================
   第四轮迭代验收（数据层）：词库批量导入与资源入库
   ------------------------------------------------------------
   覆盖：
     一、三段式模型（基础单词 / 词库 / 关联）与种子一致性
     二、表头同义识别（不猜列、跳过封面页）
     三、字段校验与三类重复（文件内 / 本词库 / 跨词库）
     四、文件级原子入库（成功、失败、回滚）
     五、批次记录与失败行导出
     六、词库 CRUD（改名 / 启停 / 排序 / 移除关联 / 编辑基础单词）
     七、与教学域隔离（学员状态、复习任务不被词库改动影响）
     八、持久化（刷新后词库与关系仍在）
   数据来源：_test/fixtures 下由 make-fixtures.js 生成的真实 .xlsx / .xls
   运行：node prototype/_test/r4-data.js
   ============================================================ */
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const XLSX = require('../assets/vendor/xlsx.full.min.js');

const root = path.join(__dirname, '..', 'assets', 'js') + path.sep;
const dataSrc = fs.readFileSync(root + 'data.js', 'utf8');
const storeSrc = fs.readFileSync(root + 'store.js', 'utf8');
const FIX = path.join(__dirname, 'fixtures');

const mem = {};
const localStorage = {
  getItem: k => (k in mem ? mem[k] : null),
  setItem: (k, v) => { mem[k] = String(v); },
  removeItem: k => { delete mem[k]; }
};

function boot() {
  const sandbox = { console, localStorage, Date, JSON, Math, Object, Array, String, Number, isFinite, parseInt, parseFloat };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(dataSrc, sandbox);
  vm.runInContext(storeSrc, sandbox);
  return sandbox.Store;
}

const ok = [];
const bad = [];
function assert(name, cond, extra) {
  if (cond) ok.push(name);
  else bad.push(name + (extra !== undefined ? ' → ' + JSON.stringify(extra) : ''));
}
function throws(fn, kw) {
  try { fn(); return false; } catch (e) { return kw ? e.message.indexOf(kw) >= 0 : true; }
}

/* 真实读取 Excel 文件 → 页面里同样的二维数组 */
function readFixture(name, sheetName) {
  const wb = XLSX.read(fs.readFileSync(path.join(FIX, name)), { type: 'buffer' });
  const sn = sheetName || wb.SheetNames[0];
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, raw: false, defval: '', blankrows: true });
  return { wb, sheetNames: wb.SheetNames.slice(), sheetName: sn, rows };
}

/* 按文件自动识别表头 → 组装 analyzeImport 的入参（与 import.html 的逻辑一致） */
function inputOf(name, S, opt) {
  opt = opt || {};
  /* 与 import.html 一致：默认挑第一个能识别出完整表头的工作表 */
  let f = readFixture(name, opt.sheetName);
  if (!opt.sheetName) {
    for (const sn of f.sheetNames) {
      const t = readFixture(name, sn);
      if (S.detectHeader(t.rows).complete) { f = t; break; }
    }
  }
  const h = S.detectHeader(f.rows);
  return {
    fileName: name, fileSize: 1000, sheetName: f.sheetName,
    headerRow: h.row, dataStartRow: opt.dataStartRow || (h.row ? h.row + 1 : 1),
    mapping: opt.mapping || h.mapping, rows: f.rows,
    targetBookId: opt.targetBookId || ''
  };
}

/* ============================================================
   一、三段式模型与种子一致性
   ============================================================ */
(function modelShape() {
  const S = boot();
  const d = S.db;
  /* 存储版本随迭代递增：第四轮为 5，第五轮加入教师域后为 6 */
  assert('存储版本不低于 5（当前 ' + d.version + '）', d.version >= 5, d.version);
  assert('三张表都存在', Array.isArray(d.words) && Array.isArray(d.wordbooks) && Array.isArray(d.wordbookWords));
  assert('导入批次表存在', Array.isArray(d.importBatches) && Array.isArray(d.importJobs));

  assert('基础单词字段齐全',
    d.words.every(w => w.id && w.en && Array.isArray(w.mean) && 'ph' in w && 'pos' in w
      && 'audio' in w && w.status && w.createdAt && w.updatedAt));
  assert('词库字段齐全',
    d.wordbooks.every(b => b.id && b.name && b.category && 'bookVersion' in b && 'schoolStage' in b
      && 'grade' in b && 'term' in b && 'organization' in b && 'description' in b
      && 'sourceFile' in b && typeof b.wordCount === 'number' && b.status && b.createdAt));
  assert('关联字段齐全',
    d.wordbookWords.every(x => x.id && x.wordbookId && x.wordId && typeof x.seq === 'number'
      && 'sourceFile' in x && 'sourceRow' in x && x.createdAt));

  assert('词库不再自带 wordIds / hasWords / count',
    d.wordbooks.every(b => b.wordIds === undefined && b.hasWords === undefined && b.count === undefined));
  assert('词库不再冗余 book / unit 字段',
    d.wordbooks.every(b => b.book === undefined && b.unit === undefined));
  assert('基础单词不再冗余教材归属',
    d.words.every(w => w.book === undefined && w.grade === undefined && w.unit === undefined));

  const ens = d.words.map(w => w.en.toLowerCase());
  assert('基础单词按英文唯一（忽略大小写）', new Set(ens).size === ens.length);

  let linkOk = true, seqOk = true, countOk = true;
  const seen = new Set();
  d.wordbookWords.forEach(x => {
    const k = x.wordbookId + '|' + x.wordId;
    if (seen.has(k)) linkOk = false;
    seen.add(k);
    if (!d.wordbooks.some(b => b.id === x.wordbookId)) linkOk = false;
    if (!d.words.some(w => w.id === x.wordId)) linkOk = false;
  });
  assert('无重复关联、无孤儿关联', linkOk);
  d.wordbooks.forEach(b => {
    const links = d.wordbookWords.filter(x => x.wordbookId === b.id)
      .sort((a, c) => a.seq - c.seq);
    links.forEach((x, i) => { if (x.seq !== i + 1) seqOk = false; });
    if (b.wordCount !== links.length) countOk = false;
  });
  assert('每个词库内 seq 从 1 连续', seqOk);
  assert('wordCount 与关联数一致', countOk);

  const family = S.wordByEn('family');
  const inBooks = S.wordbooksOfWord(family.id).map(b => b.id).sort().join(',');
  assert('同名单词只建一条基础单词', d.words.filter(w => w.en === 'family').length === 1);
  assert('同名单词可属于多个词库', inBooks === 'WB001,WB002', inBooks);
  assert('种子词库都有真实单词', d.wordbooks.every(b => b.wordCount > 0),
    d.wordbooks.map(b => b.id + ':' + b.wordCount).join(' '));
  assert('被停用的种子词库仍保留词表', S.wordbook('WB006').wordCount === 20);

  const st = S.wordbookStat('WB001');
  assert('词库统计按关联计算', st.wordCount === 23, st.wordCount);
  assert('词库统计识别缺音频', st.noAudio === 23, st.noAudio);
  assert('词库统计识别多释义', st.multiMean > 0, st.multiMean);
})();

/* ============================================================
   二、表头同义识别
   ============================================================ */
(function headerDetect() {
  const S = boot();

  const f1 = readFixture('WOWEnglish-全季.xlsx');
  const h1 = S.detectHeader(f1.rows);
  assert('识别标准表头', h1.row === 1 && h1.complete, h1);
  assert('英文列映射正确', h1.mapping.en === 0, h1.mapping);
  assert('中文列映射正确', h1.mapping.cn === 3, h1.mapping);
  assert('音频列映射正确', h1.mapping.audio === 4, h1.mapping);

  /* 前两行是封面与说明，表头在第 3 行 */
  const f2 = readFixture('小学考纲词库.xlsx');
  const h2 = S.detectHeader(f2.rows);
  assert('跳过封面与说明行，表头在第 4 行', h2.row === 4, h2.row);
  assert('英文同义词「英文」被识别', h2.mapping.en === 0 && h2.mapping.cn === 3, h2.mapping);

  /* 英文表头 */
  const f3 = readFixture('初中超前词汇.xlsx', '词汇表');
  const h3 = S.detectHeader(f3.rows);
  assert('英文表头 Word / Meaning 被识别', h3.row === 1 && h3.mapping.en === 0 && h3.mapping.cn === 3, h3);

  /* 说明页不能被当成数据 */
  const f4 = readFixture('初中超前词汇.xlsx', '说明');
  const h4 = S.detectHeader(f4.rows);
  assert('说明页识别不出表头（不猜列）', h4.row === 0 && !h4.complete, h4);

  /* 只有一列的封面也不能被当成数据 */
  const f5 = readFixture('外研社版中学英语(全).xlsx');
  const h5 = S.detectHeader(f5.rows);
  assert('封面上没有表头时不乱认', h5.complete === false, h5);

  /* 缺中文列：只能认出英文，complete 必须为 false */
  const rowsNoCn = [['单词', '音标'], ['apple', '/ˈæpl/']];
  const h6 = S.detectHeader(rowsNoCn);
  assert('只有英文列时不认为表头完整', h6.mapping.en === 0 && h6.complete === false, h6);

  /* 同义词大小写 / 空格 / 括号 */
  const rowsOdd = [['  Word  ', 'Phonetic', 'pos', ' 中文翻译 ']];
  const h7 = S.detectHeader(rowsOdd);
  assert('表头忽略空格与大小写', h7.complete && h7.mapping.cn === 3, h7.mapping);
})();

/* ============================================================
   三、字段校验与三类重复
   ============================================================ */
(function validation() {
  const S = boot();

  /* 缺必填 + 格式异常 + 音标异常 */
  const bad = inputOf('外研版一年级起点.xlsx', S);
  const ab = S.analyzeImport(bad);
  assert('解析行数按非空行统计', ab.parsedRows === 5, ab.parsedRows);
  assert('缺中文释义被标为 missing', ab.rows.filter(r => r.status === 'missing').length === 0, ab.rows.map(r => r.status));
  assert('音标缺斜杠只警告不拦下', ab.issues.some(i => i.type === 'phonetic' && i.level === 'warn'), ab.issues);
  assert('含数字的英文被拦下', ab.badFormat === 1 && ab.rows.some(r => r.status === 'bad' && r.en === 'abc123'), ab.badFormat);
  assert('音标为空的单词仍可导入', ab.entries.some(e => e.en === 'museum' && !e.ph));
  assert('可选字段缺失单独统计（音标 1 / 词性 0 / 音频 4）',
    ab.stats.missingPh === 1 && ab.stats.missingPos === 0 && ab.stats.missingAudio === ab.stats.validRows,
    ab.stats);

  /* 文件内重复 */
  const dup = inputOf('人教版一年级起点.xlsx', S);
  const ad = S.analyzeImport(dup);
  assert('识别文件内重复 3 行', ad.dupInFile === 3, ad.dupInFile);
  assert('重复行不进入可入库清单', ad.entries.length === 7, ad.entries.map(e => e.en));
  assert('重复行给出首见行号', ad.rows.filter(r => r.status === 'dup')
    .every(r => /首见第 \d+ 行/.test(r.note)), ad.rows.filter(r => r.status === 'dup').map(r => r.note));

  /* 跨词库已有（name / nice / meet / friend 已在 WB001） */
  const ex = inputOf('新初一单词.xlsx', S);
  const ae = S.analyzeImport(ex);
  assert('跨词库已有单词被识别', ae.existingWords === 4, ae.existingWords);
  assert('已有单词不重复计入新增', ae.newWords === 6, ae.newWords);
  assert('已有单词带原基础单词 ID', ae.entries.filter(e => e.status === 'existing')
    .every(e => e.wordId === S.wordByEn(e.en).id), ae.entries.filter(e => e.status === 'existing'));

  /* 本词库已有：向 WB001 追加导入 name */
  const inBook = inputOf('新初一单词.xlsx', S, { targetBookId: 'WB001' });
  const ai = S.analyzeImport(inBook);
  assert('目标词库已有单词单独计数', ai.inBook === 4, ai.inBook);
  assert('本词库已有行不重复建关联', ai.entries.every(e => e.status !== 'inBook'), ai.entries.length);

  /* 缺中文释义的行 */
  const part = inputOf('人教版初中英语(全).xlsx', S);
  const ap = S.analyzeImport(part);
  assert('缺中文释义 3 行被识别', ap.missingRequired === 3, ap.missingRequired);
  assert('缺必填行进入失败清单', ap.failedRows.length === 3, ap.failedRows.length);
  assert('其余 7 行可入库', ap.entries.length === 7, ap.entries.length);
  assert('失败行带原因', ap.failedRows.every(r => /缺少中文释义/.test(r.reason)), ap.failedRows);

  /* 多释义拆分 */
  const mean = S.splitMean('n. 名字\nv. 命名', '');
  assert('多释义按换行拆开并识别词性前缀', mean.length === 2 && mean[0].pos === 'n.' && mean[1].cn === '命名', mean);
  const mean2 = S.splitMean('橙子；橘子', 'n.');
  assert('多释义按分号拆开并继承词性', mean2.length === 2 && mean2[0].pos === 'n.', mean2);

  /* 空数据行不计入解析行数 */
  const withBlank = {
    fileName: 'x.xlsx', sheetName: 'S', headerRow: 1, dataStartRow: 2,
    mapping: { en: 0, cn: 1 }, rows: [['单词', '中文'], ['a', '一'], ['', ''], ['b', '二']]
  };
  const abl = S.analyzeImport(withBlank);
  assert('空行不计入解析行数', abl.parsedRows === 2, abl.parsedRows);
  assert('空行单独计数', abl.stats.emptyRows === 1, abl.stats.emptyRows);
})();

/* ============================================================
   四、文件级原子入库
   ============================================================ */
(function atomicImport() {
  const S = boot();
  S.reset();
  const before = {
    words: S.db.words.length, books: S.db.wordbooks.length, links: S.db.wordbookWords.length,
    states: S.db.studentWordStates.length, leitner: S.db.leitnerStates.length
  };

  const r = S.commitImport(inputOf('WOWEnglish-全季.xlsx', S), { name: 'WOWEnglish 全季词库', category: '课程体系' });
  assert('文件入库成功', r.ok === true, r.reason);
  const bk = S.wordbook(r.wordbookId);
  assert('创建了一个词库', S.db.wordbooks.length === before.books + 1);
  assert('词库名可改（不强制等于文件名）', bk.name === 'WOWEnglish 全季词库', bk.name);
  assert('词库记录来源文件', bk.sourceFile === 'WOWEnglish-全季.xlsx', bk.sourceFile);
  assert('词库分类被写入', bk.category === '课程体系', bk.category);
  assert('词库可留空教材信息', bk.bookVersion === '' && bk.grade === '');
  assert('12 个单词全部关联', bk.wordCount === 12, bk.wordCount);
  /* grape 已经存在于「人教版九年级 U3」词库 → 复用基础单词，不算新增 */
  assert('复用已有基础单词（grape）', r.stats.existingWords === 1 && r.stats.newWords === 11, r.stats);
  assert('新增关联仍是 12 条', r.stats.newLinks === 12, r.stats);
  assert('grape 现在属于两个词库',
    S.wordbooksOfWord(S.wordByEn('grape').id).map(x => x.id).sort().join(',') === 'WB006,' + bk.id);
  assert('关联记录来源行号', S.bookWords(bk.id).every(w => w.sourceRow >= 2 && w.sourceFile === bk.sourceFile));
  assert('词库内排序连续', S.bookWords(bk.id).map(w => w.seq).join(',') === Array.from({ length: 12 }, (_, i) => i + 1).join(','));

  const job = S.importJob(r.jobId);
  assert('导入任务记录字段齐全',
    job.id && job.batchId !== undefined && job.fileName && job.operatorId && job.createdAt
      && job.wordbookId === bk.id && typeof job.stats.parsedRows === 'number'
      && typeof job.stats.newWords === 'number' && typeof job.stats.newLinks === 'number'
      && typeof job.stats.skipped === 'number' && typeof job.stats.failed === 'number',
    job && Object.keys(job));

  /* 文件内重复：3 行跳过 */
  const d = S.commitImport(inputOf('人教版一年级起点.xlsx', S), { name: '颜色词库' });
  assert('含重复的文件仍入库成功', d.ok === true, d.reason);
  assert('重复的 3 行被跳过', d.stats.skipped === 3, d.stats);
  assert('只建立 7 条关联', S.wordbook(d.wordbookId).wordCount === 7, S.wordbook(d.wordbookId).wordCount);
  assert('词库内没有重复单词', (() => {
    const ids = S.bookWords(d.wordbookId).map(w => w.id);
    return new Set(ids).size === ids.length;
  })());

  /* 无有效内容 → 不写库 */
  const before2 = S.db.wordbooks.length;
  const noData = S.commitImport({
    fileName: '空文件.xlsx', sheetName: '封面', headerRow: 0, dataStartRow: 1,
    mapping: {}, rows: [['外研社版中学英语（全）'], ['整理中']]
  }, { name: '空文件' });
  assert('缺列/空数据文件不入库', noData.ok === false, noData);
  assert('失败时不产生词库', S.db.wordbooks.length === before2);

  /* 回滚：写入过程中抛错必须整文件回退 */
  const before3 = {
    words: S.db.words.length, books: S.db.wordbooks.length, links: S.db.wordbookWords.length
  };
  const realPush = S.db.wordbookWords.push;
  S.db.wordbookWords.push = function () { throw new Error('模拟写入失败'); };
  const rb = S.commitImport(inputOf('初中超前词汇.xlsx', S), { name: '回滚测试' });
  S.db.wordbookWords.push = realPush;
  assert('写入异常被捕获并回滚', rb.ok === false && /回滚/.test(rb.reason), rb.reason);
  assert('回滚后没有残留词库', S.db.wordbooks.length === before3.books, S.db.wordbooks.length);
  assert('回滚后没有残留基础单词', S.db.words.length === before3.words, S.db.words.length);
  assert('回滚后关联数不变', S.db.wordbookWords.length === before3.links, S.db.wordbookWords.length);

  /* 学员学习状态完全没被导入影响 */
  assert('导入不改动学员单词档案', S.db.studentWordStates.length === before.states);
  assert('导入不改动莱特纳状态', S.db.leitnerStates.length === before.leitner);

  /* 补齐已有单词的空字段：只补空，不覆盖 */
  const target = S.wordByEn('name');
  target.audio = '';
  target.ph = '/neɪm/';
  const fill = S.commitImport(inputOf('新初一单词.xlsx', S), { name: '新初一词库' }, { fillMissing: true });
  assert('复用已有单词不新建', fill.ok && S.db.words.filter(w => w.en.toLowerCase() === 'name').length === 1);
  assert('补齐只填空字段', S.wordbook(fill.wordbookId).wordCount === 10, S.wordbook(fill.wordbookId).wordCount);

  /* 关闭补齐时保持原样 */
  const before4 = S.db.words.length;
  S.commitImport(inputOf('人教版中学-按单元.xlsx', S), { name: '按单元词库' }, { fillMissing: false });
  assert('部分单词跨文件复用不新增', S.db.words.length > before4);
})();

/* ============================================================
   五、批次与失败行
   ============================================================ */
(function batchAndReport() {
  const S = boot();
  S.reset();
  const b = S.startImportBatch({ operatorId: 'A001', operatorName: '张敏', fileCount: 3 });
  assert('批次创建成功', !!b.id && b.status === '进行中', b);

  const r1 = S.commitImport(inputOf('WOWEnglish-全季.xlsx', S), { batchId: b.id, operatorName: '张敏' });
  const r2 = S.commitImport(inputOf('小学考纲词库.xlsx', S), { batchId: b.id, operatorName: '张敏' });
  const failJob = S.recordImportFailure(
    { fileName: '外研社版中学英语(全).xlsx', fileSize: 100 },
    '工作表里没有表头，也没有数据行', { batchId: b.id, operatorName: '张敏' });

  const fin = S.finishImportBatch(b.id);
  assert('批次统计成功文件数', fin.okCount === 2, fin.okCount);
  assert('批次统计失败文件数', fin.failCount === 1, fin.failCount);
  assert('批次状态为部分失败', fin.status === '部分失败', fin.status);
  assert('批次汇总单词数（11 + 10）', fin.newWords === 21, fin.newWords);
  assert('批次汇总关联数（12 + 10）', fin.newLinks === 22, fin.newLinks);

  assert('失败任务也留了记录', S.importJob(failJob.id).status === '失败');
  assert('失败任务记录了原因', /没有表头/.test(S.importJob(failJob.id).error));

  /* 部分入库 + 失败行 CSV */
  const rp = S.commitImport(inputOf('人教版初中英语(全).xlsx', S), { batchId: b.id });
  assert('部分入库仍成功', rp.ok === true, rp.reason);
  assert('部分入库统计失败行', rp.stats.failed === 3, rp.stats);
  assert('部分入库统计跳过', rp.stats.skipped === 0, rp.stats);
  const csv = S.failedRowsCsv(rp.jobId);
  assert('失败行 CSV 带 BOM', csv.charCodeAt(0) === 0xfeff);
  assert('失败行 CSV 有表头', csv.indexOf('行号,英文,中文释义,失败原因') > 0);
  assert('失败行 CSV 含 3 行数据', csv.replace(/^\ufeff/, '').trim().split('\r\n').length === 4,
    csv.replace(/^\ufeff/, '').trim().split('\r\n').length);

  const jobs = S.importJobs();
  assert('导入任务按时间倒序', jobs.length >= 4 && jobs[0].createdAt >= jobs[jobs.length - 1].createdAt);
  assert('词库能查自己的导入历史', S.importJobsOf(rp.wordbookId).length === 1);
})();

/* ============================================================
   六、词库 CRUD
   ============================================================ */
(function crud() {
  const S = boot();
  S.reset();

  const b = S.createWordbook({ name: '手动空词库' });
  assert('可手建空词库（只填名称）', b.id && b.wordCount === 0 && b.category === '其他', b);
  assert('重名被拒绝', throws(() => S.createWordbook({ name: '手动空词库' }), '已存在'));
  assert('空名称被拒绝', throws(() => S.createWordbook({ name: '   ' }), '不能为空'));

  S.updateWordbook(b.id, { name: '手动空词库-改', grade: '七年级', bookVersion: '人教版' });
  assert('词库可改名与补字段', S.wordbook(b.id).name === '手动空词库-改' && S.wordbook(b.id).grade === '七年级');
  S.setWordbookStatus(b.id, '停用');
  assert('词库可停用', S.wordbook(b.id).status === '停用');
  S.setWordbookStatus(b.id, '启用');
  assert('词库可启用', S.wordbook(b.id).status === '启用');

  /* 排序只影响本词库 */
  const before2 = S.bookWords('WB002').map(w => w.en).join(',');
  const first = S.bookWords('WB001')[0];
  S.moveWordInBook('WB001', first.id, 1);
  assert('词库内可调整排序', S.bookWords('WB001')[1].id === first.id, S.bookWords('WB001').map(w => w.seq));
  assert('调整排序不影响其他词库', S.bookWords('WB002').map(w => w.en).join(',') === before2);
  assert('排序调整后 seq 仍连续',
    S.bookWords('WB001').map(w => w.seq).join(',') === Array.from({ length: 23 }, (_, i) => i + 1).join(','));
  S.moveWordInBook('WB001', first.id, -1);   // 还原

  /* 移除关联：只删关联 */
  const family = S.wordByEn('family');
  const statesBefore = JSON.stringify(S.db.studentWordStates.filter(s => s.wordId === family.id));
  const rm = S.removeWordFromBook('WB001', family.id);
  assert('移除后本词库少一个词', S.wordbook('WB001').wordCount === 22, S.wordbook('WB001').wordCount);
  assert('基础单词没有被删除', !!S.word(family.id));
  assert('其他词库的关联保留', S.wordbooksOfWord(family.id).map(x => x.id).join(',') === 'WB002');
  assert('移除不改变学员学习状态',
    JSON.stringify(S.db.studentWordStates.filter(s => s.wordId === family.id)) === statesBefore);
  assert('移除后 seq 补齐', S.bookWords('WB001').every((w, i) => w.seq === i + 1));
  assert('重复移除会报错', throws(() => S.removeWordFromBook('WB001', family.id), '不在本词库'));

  /* 编辑基础单词：同库同步、跨库同步、冲突拒绝 */
  const name = S.wordByEn('name');
  S.updateWord(name.id, { mean: [{ pos: 'n.', cn: '名字；名称' }] });
  assert('修改基础单词在两个词库同时生效',
    S.bookWords('WB001').filter(w => w.id === name.id)[0].mean[0].cn === '名字；名称');
  assert('改英文与已有单词冲突要报错',
    throws(() => S.updateWord(name.id, { en: 'nice' }), '已存在同一基础单词'));
  assert('空释义被拒绝', throws(() => S.updateWord(name.id, { mean: '   ' }), '不能为空'));

  /* 手动加单词：复用已有基础单词 */
  const before3 = S.db.words.length;
  const add = S.addWordToBook('WB005', { en: 'name', cn: '名字', pos: 'n.' });
  assert('手动加词复用已有基础单词', add.created === false && S.db.words.length === before3);
  assert('手动加词建立关联', S.wordbook('WB005').wordCount === 13, S.wordbook('WB005').wordCount);
  assert('同一个词不能重复加进同一词库',
    throws(() => S.addWordToBook('WB005', { en: 'name', cn: '名字' }), '已在本词库'));

  /* 筛选 */
  assert('按分类筛选', S.searchWordbooks({ category: '教材' }).every(x => x.category === '教材'));
  assert('按学段筛选', S.searchWordbooks({ schoolStage: '小学' }).every(x => x.schoolStage === '小学'));
  assert('按版本筛选', S.searchWordbooks({ bookVersion: '外研版' }).length === 2,
    S.searchWordbooks({ bookVersion: '外研版' }).length);
  assert('按状态筛选', S.searchWordbooks({ status: '停用' }).every(x => x.status === '停用'));
  assert('按文件名也能搜到', S.searchWordbooks({ kw: 'U2词汇' }).length === 1,
    S.searchWordbooks({ kw: 'U2词汇' }).map(x => x.name));
})();

/* ============================================================
   七、与教学域隔离
   ============================================================ */
(function isolation() {
  const S = boot();
  S.reset();
  const plan = S.db.plans21[0];
  const planWords = plan.wordIds.slice();
  const stateSnap = JSON.stringify(S.db.studentWordStates);
  const leitnerSnap = JSON.stringify(S.db.leitnerStates);

  /* 往 WB001 追加导入一批单词（含已有单词） */
  S.commitImport(inputOf('新初一单词.xlsx', S, { targetBookId: 'WB001' }), { wordbookId: 'WB001' });

  assert('导入后 21 天计划成员不变', plan.wordIds.join(',') === planWords.join(','));
  assert('导入后学员单词档案不变', JSON.stringify(S.db.studentWordStates) === stateSnap);
  assert('导入后莱特纳状态不变', JSON.stringify(S.db.leitnerStates) === leitnerSnap);

  /* 新建训练任务只能选启用的词库 */
  const enabled = S.wordbooks().filter(b => b.status === '启用' && b.wordCount > 0);
  assert('训练可选词库包含导入进来的', enabled.length >= 2, enabled.map(b => b.id));

  /* 训练任务队列按词库内排序生成 */
  const task = S.startTrainTask({ studentId: 'S2026001', teacherId: 'T001', wordbookId: 'WB002' });
  const expect = S.bookWords('WB002').slice(0, task.wordIds.length).map(w => w.id);
  assert('训练队列按词库内 seq 生成', task.wordIds.join(',') === expect.join(','), task.wordIds.length);

  /* 调整词库排序后，已建任务队列不变 */
  const q = task.wordIds.slice();
  const first = S.bookWords('WB002')[0];
  S.moveWordInBook('WB002', first.id, 1);
  assert('调整词库排序不影响已建任务队列', task.wordIds.join(',') === q.join(','));
})();

/* ============================================================
   八、持久化（模拟刷新）
   ============================================================ */
(function persistence() {
  const S1 = boot();
  S1.reset();
  const r1 = S1.commitImport(inputOf('小学考纲词库.xlsx', S1), { name: '小学考纲词库' });
  const r2 = S1.commitImport(inputOf('初中超前词汇.xlsx', S1), { name: '初中超前词汇', category: '拓展' });
  const b1 = S1.wordbook(r1.wordbookId), b2 = S1.wordbook(r2.wordbookId);
  const w1 = S1.bookWords(b1.id).map(w => w.en).join(',');
  const jobs = S1.importJobs().length;

  /* 重新 boot = 刷新页面 */
  const S2 = boot();
  const nb1 = S2.wordbook(b1.id), nb2 = S2.wordbook(b2.id);
  assert('刷新后词库仍在', !!nb1 && !!nb2);
  assert('刷新后词库名称一致', nb1.name === '小学考纲词库' && nb2.name === '初中超前词汇');
  assert('刷新后单词数量一致', nb1.wordCount === 10 && nb2.wordCount === 10, [nb1.wordCount, nb2.wordCount]);
  assert('刷新后关联单词一致', S2.bookWords(nb1.id).map(w => w.en).join(',') === w1);
  assert('刷新后基础单词数一致', S2.db.words.length === S1.db.words.length);
  assert('刷新后导入记录仍在', S2.importJobs().length === jobs, S2.importJobs().length);
  assert('刷新后导入记录字段完好',
    S2.importJobs().every(j => j.wordbookId && j.stats && typeof j.stats.newLinks === 'number'));
  assert('刷新后分类等信息一致', nb2.category === '拓展');

  /* 刷新后再导入一次，seq 从末尾续上 */
  S2.commitImport(inputOf('新七年级上.xls', S2), { wordbookId: nb1.id });
  const seqs = S2.bookWords(nb1.id).map(w => w.seq);
  assert('续导入后 seq 连续', seqs.join(',') === Array.from({ length: 18 }, (_, i) => i + 1).join(','), seqs.length);
  assert('.xls 老格式也能入库', S2.wordbook(nb1.id).wordCount === 18);
})();

/* ============================================================ */
console.log('\n第四轮数据层验收');
console.log('  通过 ' + ok.length + ' 项');
if (bad.length) {
  console.log('  失败 ' + bad.length + ' 项：');
  bad.forEach(b => console.log('   ✗ ' + b));
  process.exit(1);
}
console.log('  全部通过');
