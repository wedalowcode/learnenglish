/* ============================================================
   统一模拟数据层 Store
   ------------------------------------------------------------
   第一轮：建立学习域唯一数据源。
   第二轮（本版）加固业务完整性，原则：
     1. 所有业务校验在 Store 层执行，页面按钮不作为防线。
     2. 首次判断与误判修正严格分离（judge / correct 两套接口）。
     3. 历史记录只追加、不覆盖；修正保留原结果、新结果、时间、教师、原因。
     4. 完成进度一律按「唯一 wordId」计数，不允许用原始记录条数。
     5. 任何 ok:true 都代表数据已真实写入并已持久化。
   分层存储（互不覆盖）：
     基础单词 words / 词库 wordbooks / 关系 wordbookWords
     学员状态 studentWordStates
     莱特纳 leitnerStates + leitnerConfig + leitnerTasks + leitnerRecords + leitnerOps
     21 天 plans21 + plan21Tasks + plan21Records
     训练 trainTasks + trainDetails + prescreens
     文章训练 articleTasks + articleTaskDetails
     财务 flows + accounts + flowReversals
     家长辅助 familyChecks（不改变正式学习状态）
   依赖：data.js 中的 DB（人员/商品/课程/词库资源等基础演示数据）
   ============================================================ */
(function () {
  'use strict';

  var W = typeof window !== 'undefined' ? window : globalThis;
  var KEY = 'ee_proto_store_v3';
  var VERSION = 3;
  var TODAY = '2026-11-02';

  /* ---------------- 存储适配（三级降级） ---------------- */
  var SS = (function () {
    var mem = {};
    function probe(name) {
      try {
        var s = W[name];
        if (!s) return null;
        s.setItem('__p', '1');
        s.removeItem('__p');
        return s;
      } catch (e) { return null; }
    }
    var st = probe('localStorage') || probe('sessionStorage');
    W.__STORE_BACKEND = st ? (st === W.localStorage ? 'localStorage' : 'sessionStorage') : 'memory';
    if (st) return st;
    return {
      getItem: function (k) { return Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null; },
      setItem: function (k, v) { mem[k] = String(v); },
      removeItem: function (k) { delete mem[k]; }
    };
  })();

  /* ---------------- 小工具 ---------------- */
  function pad(n, len) { n = String(n); while (n.length < len) n = '0' + n; return n; }

  function addDays(dateStr, n) {
    var p = String(dateStr).split('-');
    var d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
    d.setDate(d.getDate() + n);
    return d.getFullYear() + '-' + pad(d.getMonth() + 1, 2) + '-' + pad(d.getDate(), 2);
  }

  function clock() {
    var now = new Date();
    return pad(now.getHours(), 2) + ':' + pad(now.getMinutes(), 2);
  }

  function stamp(dateStr) { return (dateStr || TODAY) + ' ' + clock(); }

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  /* ---------------- 校验工具 ---------------- */
  /** 业务错误：统一抛 Error，页面 catch 后提示，绝不静默通过 */
  function fail(msg) { throw new Error(msg); }
  function isStr(v) { return typeof v === 'string' && v.length > 0; }

  /** 去重并过滤无效单词 ID（用于队列 / 计划 / 任务生成） */
  function cleanWordIds(ids) {
    var seen = {}, out = [];
    (ids || []).forEach(function (id) {
      if (!isStr(id) || seen[id]) return;
      var w = db.words.filter(function (x) { return x.id === id; })[0];
      if (!w) return;              // 丢弃 undefined / 不存在的 ID
      seen[id] = 1; out.push(id);
    });
    return out;
  }

  /** 按 wordId 去重后的记录条数（完成度唯一口径） */
  function uniqWordCount(records) {
    var seen = {}, n = 0;
    records.forEach(function (r) {
      if (!seen[r.wordId]) { seen[r.wordId] = 1; n++; }
    });
    return n;
  }

  function uniqWordIds(records) {
    var seen = {}, out = [];
    records.forEach(function (r) {
      if (!seen[r.wordId]) { seen[r.wordId] = 1; out.push(r.wordId); }
    });
    return out;
  }

  /* ---------------- 初始数据 ---------------- */
  function buildSeed() {
    var B = W.DB || {};
    var DBwords = B.words || [];

    /* 1. 基础单词（词库资源层，与学员状态无关） */
    var words = DBwords.map(function (w, i) {
      return {
        id: 'w' + pad(i + 1, 2),
        en: w.en,
        ph: w.ph,
        mean: clone(w.mean),
        pos: w.mean.map(function (m) { return m.pos; }).join('/'),
        book: '人教版', grade: '七年级', unit: 'Unit 1',
        audio: 'https://cdn.example.com/audio/' + w.en + '.mp3',
        status: '启用'
      };
    });
    var wordByEn = {};
    words.forEach(function (w) { wordByEn[w.en] = w.id; });
    function wid(en) { return wordByEn[en] || null; }

    /* 2. 词库 + 词库单词关系（仅 WB001 内置真实词表，其余为占位说明） */
    var wordbooks = (B.books || []).map(function (b) {
      var has = b.id === 'WB001';
      return {
        id: b.id, name: b.name, book: b.book, grade: b.grade, term: b.term,
        unit: b.unit, count: b.count, status: b.status,
        hasWords: has,
        wordIds: has ? words.map(function (w) { return w.id; }) : []
      };
    });
    var wordbookWords = [];
    wordbooks.forEach(function (b) {
      b.wordIds.forEach(function (id, i) {
        wordbookWords.push({ bookId: b.id, wordId: id, seq: i + 1 });
      });
    });

    /* 3. 莱特纳初始状态：18 个单词分布在 红6 / 黄8 / 绿4 */
    // 备注：原型内置的是"当前状态快照"，红盒 6 个单词有一次 10-31 的复习记录，
    //       黄盒单词为训练加入后尚未复习（因此 lastReviewAt 为空）。
    var leitnerSeed = [
      /* 红盒：10-31 复习后答错/未确认，留在红盒 */
      { en: 'friend',   box: 'red', result: '不认识',   last: '2026-10-31', due: '2026-11-01', added: '2026-10-28' },
      { en: 'question', box: 'red', result: '不认识',   last: '2026-10-31', due: '2026-11-01', added: '2026-10-28' },
      { en: 'answer',   box: 'red', result: '暂不确定', last: '2026-10-31', due: '2026-11-02', added: '2026-10-28' },
      { en: 'library',  box: 'red', result: '不认识',   last: '2026-10-31', due: '2026-11-02', added: '2026-10-28' },
      { en: 'family',   box: 'red', result: '不认识',   last: '2026-10-31', due: '2026-11-02', added: '2026-10-28' },
      { en: 'not',      box: 'red', result: '不认识',   last: '2026-10-31', due: '2026-11-02', added: '2026-10-28' },
      /* 黄盒 1（间隔 2 天） */
      { en: 'classroom', box: 'Y1', due: '2026-11-02', added: '2026-10-31' },
      { en: 'class',     box: 'Y1', due: '2026-11-02', added: '2026-10-31', manualToday: true },
      { en: 'look',      box: 'Y1', due: '2026-11-02', added: '2026-10-31' },
      { en: 'first',     box: 'Y1', due: '2026-11-04', added: '2026-10-31' },
      /* 黄盒 2（间隔 5 天） */
      { en: 'name',  box: 'Y2', due: '2026-11-06', added: '2026-10-28', manualToday: true },
      { en: 'nice',  box: 'Y2', due: '2026-11-05', added: '2026-10-28' },
      /* 黄盒 3（间隔 10 天） */
      { en: 'meet',  box: 'Y3', due: '2026-11-02', added: '2026-10-24' },
      { en: 'too',   box: 'Y3', due: '2026-11-01', added: '2026-10-24' },
      /* 绿盒（教师自主管理） */
      { en: 'happy', box: 'green', reason: '课堂易混淆（与 happy/sad 冲突）', added: '2026-10-26' },
      { en: 'he',    box: 'green', reason: '与 she 混用', added: '2026-10-26' },
      { en: 'no',    box: 'green', reason: '发音相近（no / not）', added: '2026-10-24' },
      { en: 'your',  box: 'green', reason: '与 you 混用', added: '2026-10-22' }
    ];

    var leitnerStates = [];
    leitnerSeed.forEach(function (s, i) {
      var id = wid(s.en);
      if (!id) return;
      leitnerStates.push({
        id: 'LS' + pad(i + 1, 3),
        studentId: 'S2026001',
        wordId: id,
        box: s.box,
        addedAt: s.added,
        dueAt: s.due || null,
        lastReviewAt: s.last || null,
        lastResult: s.result || '待复习',
        manualToday: !!s.manualToday,
        reason: s.reason || '',
        source: s.box === 'green' ? '教师手动加入' : '训练加入',
        sourceTaskId: null,
        by: '李婉'
      });
    });

    /* 4. 莱特纳盒配置（可配置项，当前取值为机构暂定值） */
    var leitnerConfig = {
      red: { id: 'red', name: '红盒子', intervalDays: 1, onCorrect: 'Y1', onWrong: 'red', enabled: true },
      yellow: [
        { id: 'Y1', name: '黄盒 1', seq: 1, intervalDays: 2, onCorrect: 'Y2', onWrong: 'red', enabled: true },
        { id: 'Y2', name: '黄盒 2', seq: 2, intervalDays: 5, onCorrect: 'Y3', onWrong: 'red', enabled: true },
        { id: 'Y3', name: '黄盒 3', seq: 3, intervalDays: 10, onCorrect: 'graduated', onWrong: 'red', enabled: true }
      ],
      green: { id: 'green', name: '绿盒子', intervalDays: null, onCorrect: 'green', onWrong: 'green', enabled: true, manual: true },
      dueRule: '每日 00:00 统一判定',
      confirmed: false
    };

    /* 5. 一条历史莱特纳复习任务（10-31，仅红盒 6 个单词） */
    var ltTaskId = 'LT20261031001';
    var redIds = leitnerStates.filter(function (s) { return s.box === 'red'; }).map(function (s) { return s.wordId; });
    var leitnerTasks = [{
      id: ltTaskId,
      studentId: 'S2026001',
      teacherId: 'T001',
      boxes: ['red'],
      wordIds: redIds,
      source: '红盒子',
      createdAt: '2026-10-31 19:40',
      status: '已完成',
      completedAt: '2026-10-31 19:58',
      stats: { total: redIds.length, yes: 0, no: 5, mid: 1 }
    }];
    var leitnerRecords = redIds.map(function (id, i) {
      var s = leitnerStates.filter(function (x) { return x.wordId === id; })[0];
      return {
        id: 'LR' + pad(i + 1, 3),
        taskId: ltTaskId,
        studentId: 'S2026001',
        wordId: id,
        boxFrom: 'red',
        boxTo: 'red',
        result: s.lastResult === '暂不确定' ? 'mid' : 'no',
        nextDue: s.dueAt,
        at: '2026-10-31 19:' + pad(41 + i, 2),
        teacherId: 'T001',
        applyMode: '按配置'
      };
    });

    /* 6. 21 天计划（23 词，含 18 个与莱特纳重叠 + 5 个仅 21 天） */
    var planId = 'PN20261024001';
    var planWordIds = words.map(function (w) { return w.id; });
    var nodeCounts = [23, 23, 18, 0, 16, 0, 14, 14, 0, 12, 0, 10, 0, 10, 0, 8, 0, 8, 0, 6, 6];
    var nodeDone = { 1: 23, 2: 23, 3: 18, 5: 16, 7: 11, 8: 14 };
    var plan21Tasks = [];
    var plan21Records = [];
    var recSeq = 0;
    for (var d = 1; d <= 21; d++) {
      var cnt = nodeCounts[d - 1];
      var date = addDays('2026-10-24', d - 1);
      var ids = [];
      if (cnt > 0) {
        var offset = d <= 2 ? 0 : ((d - 1) * 2) % planWordIds.length;
        for (var k = 0; k < cnt; k++) ids.push(planWordIds[(offset + k) % planWordIds.length]);
      }
      var done = nodeDone[d] || 0;
      var status = 'plan';
      if (cnt === 0) status = 'rest';
      else if (done >= cnt) status = 'done';
      else if (date === TODAY) status = 'today';
      else if (date < TODAY) status = 'miss';
      var taskId = 'P21T' + pad(d, 3);
      plan21Tasks.push({
        id: taskId, planId: planId, day: d, date: date, wordIds: ids,
        status: status, completedAt: done > 0 ? date + ' 20:10' : null,
        teacherId: 'T001'
      });
      for (var j = 0; j < done; j++) {
        recSeq++;
        plan21Records.push({
          id: 'P21R' + pad(recSeq, 4),
          taskId: taskId, planId: planId, studentId: 'S2026001',
          wordId: ids[j], day: d, result: j < done ? 'yes' : 'no',
          at: date + ' 20:0' + (j % 10), teacherId: 'T001', round: 1
        });
      }
    }

    var plans21 = [{
      id: planId,
      studentId: 'S2026001',
      name: '11 月记忆强化计划',
      startDate: '2026-10-24',
      strategy: '机构默认 21 天策略',
      status: '进行中',
      wordIds: planWordIds,
      createdBy: '李婉',
      createdAt: '2026-10-24 18:30',
      note: 'Unit 1 词表整体过一遍'
    }];

    /* 7. 学员单词档案（由莱特纳 + 21 天成员关系推导，保证口径一致） */
    var studentWordStates = [];
    words.forEach(function (w, i) {
      var ls = leitnerStates.filter(function (s) { return s.wordId === w.id; })[0];
      var st = '未训练', at = null, note = '';
      if (ls) {
        if (ls.box === 'red') {
          st = ls.lastResult === '暂不确定' ? '暂不确定' : '待复习';
        } else {
          st = '本次通过';
        }
        at = ls.addedAt;
        note = '莱特纳 ' + (ls.box === 'red' ? '红盒' : ls.box === 'green' ? '绿盒' : '黄盒');
      } else {
        st = '待复习';
        at = '2026-10-24';
        note = '仅 21 天计划';
      }
      studentWordStates.push({
        id: 'SW' + pad(i + 1, 3),
        studentId: 'S2026001',
        wordId: w.id,
        state: st,
        prescreenKnown: null,
        lastTrainAt: null,
        lastTaskId: null,
        note: note.replace(/^；/, '')
      });
    });

    /* 8. 计划配置（明确标注为待业务确认，不写死为正式规则） */
    var config = {
      trainCap: 45,
      groupSize: 5,
      plan21Strategy: {
        name: '机构默认 21 天策略',
        nodeDays: [1, 2, 3, 5, 7, 8, 10, 12, 14, 16, 18, 20, 21],
        ratios: [1, 1, .78, .70, .61, .52, .52, .43, .43, .35, .35, .26, .26],
        dailyCap: 23,
        wrongExtra: false,
        shiftOnInterrupt: false,
        archiveAfter: false,
        confirmed: false
      },
      reviewDefaults: { joinLeitner: false, joinPlan21: false, joinGreen: false }
    };

    /* 9. 文章训练：一条历史完成任务（与学员档案中"最近训练"口径一致） */
    var articleTasks = [];
    var articleTaskDetails = [];
    var ATS = 0;
    (function () {
      var a = (B.articles || [])[0];
      if (!a) return;
      var sents = B.sentences || [];
      ATS = 1;
      var tid = 'AT20261030001';
      articleTasks.push({
        id: tid, studentId: 'S2026001', teacherId: 'T001',
        articleId: a.id, articleName: a.name, courseId: '',
        startedAt: '2026-10-30 19:02', finishedAt: '2026-10-30 19:26',
        audioDone: true, totalSentences: sents.length, doneSentences: sents.length,
        evaluation: '听读流利，第 3、6 句连读需加强。', note: '',
        status: '已完成', by: '李婉'
      });
      sents.forEach(function (s, i) {
        articleTaskDetails.push({
          id: 'ATD' + pad(i + 1, 4), taskId: tid,
          studentId: 'S2026001', sentenceId: 'S' + pad(s.i, 2), seq: s.i,
          en: s.en, audioPlayed: true, cnViewed: i === 2 || i === 5,
          readDone: true, teacherConfirm: '通过',
          at: '2026-10-30 19:' + pad(5 + i, 2), teacherId: 'T001'
        });
      });
    })();

    /* 10. 财务：课时账户与流水（来自 data.js 基础演示数据，此后由 Store 维护） */
    var flows = clone(B.flows || []);
    var accounts = clone(B.accounts || []);

    return {
      version: VERSION,
      today: TODAY,
      meta: {
        seq: {
          TR: 0, LT: 0, P21: 0, LS: 20, PR: 0, TD: 0, LO: 0, SW: 40, P21R: 400,
          AT: ATS, ATD: 0, FV: 0, FC: 0
        },
        builtAt: stamp()
      },
      students: clone(B.students || []),
      teachers: clone(B.teachers || []),
      parents: clone(B.parents || []),
      words: words,
      wordbooks: wordbooks,
      wordbookWords: wordbookWords,
      prescreens: [],
      trainTasks: [],
      trainDetails: [],
      studentWordStates: studentWordStates,
      leitnerStates: leitnerStates,
      leitnerConfig: leitnerConfig,
      leitnerTasks: leitnerTasks,
      leitnerRecords: leitnerRecords,
      leitnerOps: [],
      plans21: plans21,
      plan21Tasks: plan21Tasks,
      plan21Records: plan21Records,
      articleTasks: articleTasks,
      articleTaskDetails: articleTaskDetails,
      flows: flows,
      accounts: accounts,
      flowReversals: [],
      familyChecks: [],
      config: config
    };
  }

  /* ---------------- 载入 / 保存 ---------------- */
  var db = null;

  function load() {
    try {
      var raw = SS.getItem(KEY);
      if (raw) {
        var o = JSON.parse(raw);
        if (o && o.version === VERSION && Array.isArray(o.words) && o.words.length) { db = o; return db; }
      }
    } catch (e) { /* 损坏则重建 */ }
    db = buildSeed();
    save();
    return db;
  }

  function save() {
    try { SS.setItem(KEY, JSON.stringify(db)); } catch (e) { /* 容量/权限异常静默 */ }
  }

  function reset() {
    db = buildSeed();
    save();
    return db;
  }

  function seq(k, width) {
    db.meta.seq[k] = (db.meta.seq[k] || 0) + 1;
    return pad(db.meta.seq[k], width || 3);
  }

  /* ---------------- 查询：基础 ---------------- */
  function students() { return db.students; }
  function student(id) { return db.students.filter(function (s) { return s.id === id; })[0] || null; }
  function teacher(id) { return db.teachers.filter(function (t) { return t.id === id; })[0] || null; }
  function wordbooks() { return db.wordbooks; }
  function wordbook(id) { return db.wordbooks.filter(function (b) { return b.id === id; })[0] || null; }
  function word(id) { return db.words.filter(function (w) { return w.id === id; })[0] || null; }
  function wordByEn(en) { return db.words.filter(function (w) { return w.en === en; })[0] || null; }

  function wordsOfBook(bookId) {
    var b = wordbook(bookId);
    if (!b) return [];
    return b.wordIds.map(function (id) { return word(id); }).filter(Boolean);
  }

  function groupsOf(ids, size) {
    size = size || db.config.groupSize;
    var out = [];
    for (var i = 0; i < ids.length; i += size) out.push(ids.slice(i, i + size));
    return out;
  }

  /* ---------------- 查询：学员单词档案 ---------------- */
  function stateKey(studentId, wordId) { return studentId + ':' + wordId; }

  function wordState(studentId, wordId) {
    return db.studentWordStates.filter(function (s) {
      return s.studentId === studentId && s.wordId === wordId;
    })[0] || null;
  }

  function ensureWordState(studentId, wordId) {
    var s = wordState(studentId, wordId);
    if (!s) {
      s = {
        id: 'SW' + seq('SW', 3), studentId: studentId, wordId: wordId,
        state: '未训练', prescreenKnown: null, lastTrainAt: null, lastTaskId: null, note: ''
      };
      db.studentWordStates.push(s);
    }
    return s;
  }

  function setWordState(studentId, wordId, state, extra) {
    var s = ensureWordState(studentId, wordId);
    s.state = state;
    if (extra) {
      if (extra.prescreenKnown !== undefined) s.prescreenKnown = extra.prescreenKnown;
      if (extra.lastTrainAt) s.lastTrainAt = extra.lastTrainAt;
      if (extra.lastTaskId) s.lastTaskId = extra.lastTaskId;
      if (extra.note !== undefined) s.note = extra.note;
    }
    return s;
  }

  function wordStates(studentId) {
    return db.studentWordStates.filter(function (s) { return s.studentId === studentId; });
  }

  /* ---------------- 训练任务 ---------------- */
  var ACTIVE = ['预筛选中', '强化训练中', '最后一轮复习中', '已中断'];

  function trainTask(id) {
    return db.trainTasks.filter(function (t) { return t.id === id; })[0] || null;
  }

  function activeTask(studentId, bookId) {
    return db.trainTasks.filter(function (t) {
      return t.studentId === studentId
        && ACTIVE.indexOf(t.status) >= 0
        && (!bookId || t.wordbookId === bookId);
    }).sort(function (a, b) { return a.createdAt < b.createdAt ? 1 : -1; })[0] || null;
  }

  function tasksOf(studentId) {
    return db.trainTasks.filter(function (t) { return t.studentId === studentId; })
      .sort(function (a, b) { return a.createdAt < b.createdAt ? 1 : -1; });
  }

  /**
   * 创建训练任务（进入预筛选阶段）
   * @param {{studentId,teacherId,wordbookId,rangeWordIds?}} opt
   */
  function startTrainTask(opt) {
    var bk = wordbook(opt.wordbookId);
    if (!bk) throw new Error('词库不存在');
    if (!bk.hasWords) throw new Error('该词库在原型中未内置单词清单');

    // 同一学员同一词库存在未完成任务时，直接复用，避免出现两个并行任务
    var ex = activeTask(opt.studentId, bk.id);
    if (ex) return ex;

    var ids = opt.rangeWordIds || bk.wordIds.slice();
    var t = {
      id: 'TR' + TODAY.replace(/-/g, '') + seq('TR', 2),
      studentId: opt.studentId,
      teacherId: opt.teacherId || 'T001',
      wordbookId: bk.id,
      wordbookName: bk.name,
      createdAt: stamp(),
      status: '预筛选中',
      wordIds: ids,              // 本次候选（词库全部/选定范围）
      knownWordIds: [],           // 初筛认识
      queueWordIds: [],           // 进入强化训练
      remainWordIds: [],          // 超出 45 上限，保留待训练
      prescreen: {},              // wordId -> {known, at}
      groupSize: db.config.groupSize,
      groupIndex: 0,
      wordIndex: 0,
      results: {},                // wordId -> {result, mode, groupIndex, at, corrected}
      finalResults: {},           // wordId -> {result, at, correctedFrom}
      finalIndex: 0,
      mode: 'en2cn',
      pausedAt: null,
      finishedAt: null,
      interruptReason: '',
      joins: { leitner: [], plan21: [], planIds: [], green: [] },
      submitted: false
    };
    db.trainTasks.push(t);
    save();
    return t;
  }

  /** 逐词保存预筛选结果（认识 / 不认识 必须显式作答） */
  function prescreenAnswer(taskId, wordId, known) {
    var t = trainTask(taskId);
    if (!t) throw new Error('任务不存在');
    if (t.status !== '预筛选中') throw new Error('当前阶段不允许修改预筛选结果');
    var at = stamp();
    t.prescreen[wordId] = { known: !!known, at: at };
    // 预筛选记录独立成表（任务级 + 学员级都能追溯）
    db.prescreens.push({
      id: 'PS' + seq('PR', 4),
      taskId: taskId, studentId: t.studentId, wordbookId: t.wordbookId,
      wordId: wordId, known: !!known, at: at, teacherId: t.teacherId
    });
    setWordState(t.studentId, wordId,
      known ? '初筛认识' : '待强化训练',
      { prescreenKnown: !!known, lastTaskId: taskId });
    save();
    return t;
  }

  /**
   * 结束预筛选，生成训练队列
   * 规则：认识的单词不入队；不认识的按词库顺序取前 45 个；其余保留待训练
   */
  function finishPrescreen(taskId) {
    var t = trainTask(taskId);
    if (!t) throw new Error('任务不存在');

    var order = t.wordIds;
    var known = [], unknown = [], unscreened = [];
    order.forEach(function (id) {
      var p = t.prescreen[id];
      if (!p) { unscreened.push(id); return; }
      (p.known ? known : unknown).push(id);
    });

    var cap = db.config.trainCap;
    var queue = unknown.slice(0, cap);
    var remain = unknown.slice(cap);

    t.knownWordIds = known;
    t.queueWordIds = queue;
    t.remainWordIds = remain;
    t.screenedCount = known.length + unknown.length;
    t.unscreenedWordIds = unscreened;
    t.status = '强化训练中';
    t.groupIndex = 0;
    t.wordIndex = 0;

    // 队列内单词进入「待强化训练」，队列外仍保留待强化（不进本次）
    remain.forEach(function (id) {
      setWordState(t.studentId, id, '待强化训练', { lastTaskId: taskId });
    });
    save();

    return {
      bookTotal: order.length,
      screened: known.length + unknown.length,
      unscreened: unscreened.length,
      known: known.length,
      unknown: unknown.length,
      queue: queue,
      remain: remain,
      groups: groupsOf(queue, t.groupSize)
    };
  }

  function queueOf(t) {
    return (t.queueWordIds || []).map(function (id) { return word(id); }).filter(Boolean);
  }

  function groupsOfTask(t) { return groupsOf(t.queueWordIds || [], t.groupSize); }

  function detailsOf(taskId) {
    return db.trainDetails.filter(function (d) { return d.taskId === taskId; });
  }

  /** 某学员某单词的预筛选历史（跨任务） */
  function prescreensOf(studentId, wordId) {
    return db.prescreens.filter(function (p) {
      return p.studentId === studentId && p.wordId === wordId;
    }).sort(function (a, b) { return a.at < b.at ? 1 : -1; });
  }

  /** 某学员某单词的强化训练明细（跨任务，含修正） */
  function trainDetailsOf(studentId, wordId) {
    return db.trainDetails.filter(function (d) {
      return d.studentId === studentId && d.wordId === wordId;
    }).sort(function (a, b) { return a.at < b.at ? 1 : -1; });
  }

  /** 某学员某单词的最后一轮复习判断（跨任务） */
  function finalReviewsOf(studentId, wordId) {
    var out = [];
    db.trainTasks.forEach(function (t) {
      if (t.studentId !== studentId) return;
      var r = t.finalResults && t.finalResults[wordId];
      if (r) out.push({ taskId: t.id, result: r.result, at: r.at, correctedFrom: r.correctedFrom, status: t.status });
    });
    return out.sort(function (a, b) { return a.at < b.at ? 1 : -1; });
  }

  /** 某任务某单词的首次强化训练明细（不含修正） */
  function trainFirstDetail(taskId, wordId) {
    return db.trainDetails.filter(function (d) {
      return d.taskId === taskId && d.wordId === wordId && !d.correction;
    })[0] || null;
  }

  /** 任务进度统计：强化训练与最后一轮分别按唯一 wordId 计数 */
  function trainTaskStat(taskId) {
    var t = trainTask(taskId);
    if (!t) return null;
    var q = t.queueWordIds || [];
    var trained = q.filter(function (id) { return !!trainFirstDetail(taskId, id); });
    var finaled = q.filter(function (id) { return !!(t.finalResults && t.finalResults[id]); });
    return {
      taskId: taskId,
      queue: q.length,
      trained: trained.length,
      trainedMissing: q.filter(function (id) { return !trainFirstDetail(taskId, id); }),
      finaled: finaled.length,
      finalMissing: q.filter(function (id) { return !(t.finalResults && t.finalResults[id]); }),
      corrections: db.trainDetails.filter(function (d) {
        return d.taskId === taskId && d.correction;
      }).length,
      details: db.trainDetails.filter(function (d) { return d.taskId === taskId; }).length
    };
  }

  /**
   * 强化训练判断（首次判断专用）
   * 校验：任务处于强化训练阶段、单词属于本次队列、同任务同词只能一条首次记录
   */
  function trainJudge(taskId, wordId, result, mode, groupIndex) {
    var t = trainTask(taskId);
    if (!t) fail('训练任务不存在');
    if (t.status === '已中断') fail('任务已中断，请先恢复训练后再操作');
    if (t.status === '已取消') fail('任务已取消，不能继续操作');
    if (t.status !== '强化训练中') fail('当前阶段不允许提交强化训练结果');
    if (t.submitted || t.status === '已完成') fail('任务已提交，不能修改判断结果');

    if ((t.queueWordIds || []).indexOf(wordId) < 0) fail('该单词不属于本次训练队列，不能提交');
    if (!result || ['yes', 'no', 'mid'].indexOf(result) < 0) fail('判断结果不合法');

    if (trainFirstDetail(taskId, wordId)) {
      fail('该单词已判断过，如需修改请使用「误判修正」');
    }

    var at = stamp();
    t.results[wordId] = { result: result, mode: mode || t.mode, groupIndex: groupIndex, at: at, corrected: false };
    db.trainDetails.push({
      id: 'TD' + seq('TD', 4),
      taskId: taskId, studentId: t.studentId, wordId: wordId,
      groupIndex: groupIndex, mode: mode || t.mode, round: 1,
      result: result, at: at, teacherId: t.teacherId,
      correction: false
    });
    setWordState(t.studentId, wordId, '待最后复习', { lastTrainAt: at, lastTaskId: taskId });
    save();
    return t;
  }

  /**
   * 误判修正：追加一条新记录，不覆盖原始记录（PRD 11.9）
   * 校验：必须已提交过首次判断；必须填写原因；已提交任务禁止修改
   */
  function trainCorrect(taskId, wordId, result, note, groupIndex) {
    var t = trainTask(taskId);
    if (!t) fail('训练任务不存在');
    if (t.submitted || t.status === '已完成') fail('任务已提交，不能修改判断结果');
    if (t.status === '已取消') fail('任务已取消，不能修改判断结果');
    if (!result || ['yes', 'no', 'mid'].indexOf(result) < 0) fail('修正结果不合法');
    if (!isStr(note) || !note.trim()) fail('误判修正必须填写原因');
    if ((t.queueWordIds || []).indexOf(wordId) < 0) fail('该单词不属于本次训练队列');

    var first = trainFirstDetail(taskId, wordId);
    if (!first) fail('该单词尚无判断记录，请先做首次判断');

    var all = db.trainDetails.filter(function (d) {
      return d.taskId === taskId && d.wordId === wordId;
    });
    var old = all[all.length - 1];
    if (old.result === result) fail('修正结果与原结果相同，无需修正');

    var at = stamp();
    var round = all.length + 1;

    db.trainDetails.push({
      id: 'TD' + seq('TD', 4),
      taskId: taskId, studentId: t.studentId, wordId: wordId,
      groupIndex: groupIndex === undefined ? old.groupIndex : groupIndex,
      mode: old.mode, round: round,
      result: result, at: at, teacherId: t.teacherId,
      correction: true, correctionFrom: old.result,
      originalResult: first.result, correctionNote: note.trim()
    });
    t.results[wordId] = { result: result, mode: old.mode, groupIndex: old.groupIndex, at: at, corrected: true };
    t.corrections = (t.corrections || 0) + 1;
    save();
    return t;
  }

  function setTaskPos(taskId, patch) {
    var t = trainTask(taskId);
    if (!t) return null;
    Object.keys(patch).forEach(function (k) { t[k] = patch[k]; });
    save();
    return t;
  }

  /** 暂停 / 保存退出：状态不变，仅记录暂停时间，可恢复 */
  function pauseTask(taskId) {
    var t = trainTask(taskId);
    if (!t) return null;
    t.pausedAt = stamp();
    t.resumeCount = (t.resumeCount || 0);
    save();
    return t;
  }

  function resumeTask(taskId) {
    var t = trainTask(taskId);
    if (!t) return null;
    t.pausedAt = null;
    t.resumeCount = (t.resumeCount || 0) + 1;
    t.lastResumeAt = stamp();
    if (t.status === '已中断') t.status = t.finalIndex > 0 || Object.keys(t.finalResults).length ? '最后一轮复习中' : '强化训练中';
    save();
    return t;
  }

  /** 中途结束：已产生的记录保留，未完成单词仍为待训练 */
  function endTask(taskId, reason, note) {
    var t = trainTask(taskId);
    if (!t) fail('训练任务不存在');
    if (t.submitted || t.status === '已完成') fail('任务已提交，不能再改为中断');
    if (t.status === '已取消') fail('任务已取消，不能再改为中断');
    if (!isStr(reason) || !reason.trim()) fail('中断训练必须填写原因');
    t.status = '已中断';
    t.interruptReason = reason;
    t.interruptNote = note || '';
    t.finishedAt = stamp();
    // 未完成单词：没有判断结果的一律回到「待强化训练」
    (t.queueWordIds || []).forEach(function (id) {
      if (!t.results[id]) setWordState(t.studentId, id, '待强化训练', { lastTaskId: taskId });
    });
    save();
    return t;
  }

  function cancelTask(taskId) {
    var t = trainTask(taskId);
    if (!t) fail('训练任务不存在');
    if (t.submitted || t.status === '已完成') fail('任务已提交，不能取消');
    t.status = '已取消';
    t.finishedAt = stamp();
    save();
    return t;
  }

  /** 进入最后一轮复习：必须所有队列单词都完成强化训练判断 */
  function toFinalStage(taskId) {
    var t = trainTask(taskId);
    if (!t) fail('训练任务不存在');
    if (t.status === '已中断') return { ok: false, reason: '任务已中断，请先恢复训练', missing: [] };
    if (t.status === '已完成' || t.submitted) return { ok: false, reason: '任务已提交', missing: [] };
    var missing = (t.queueWordIds || []).filter(function (id) { return !trainFirstDetail(taskId, id); });
    if (missing.length) return { ok: false, missing: missing, reason: '还有 ' + missing.length + ' 个单词未完成强化训练判断' };
    t.status = '最后一轮复习中';
    t.finalIndex = 0;
    save();
    return { ok: true, task: t };
  }

  /**
   * 最后一轮复习判断（首次判断专用）
   * 校验：阶段正确、单词属于本次队列、同词不可重复首次判断
   */
  function finalJudge(taskId, wordId, result) {
    var t = trainTask(taskId);
    if (!t) fail('训练任务不存在');
    if (t.status === '已中断') fail('任务已中断，请先恢复训练后再操作');
    if (t.status !== '最后一轮复习中') fail('当前阶段不允许提交最后一轮复习结果');
    if (t.submitted) fail('任务已提交，不能修改判断结果');
    if ((t.queueWordIds || []).indexOf(wordId) < 0) fail('该单词不属于本次训练队列');
    if (!result || ['yes', 'no', 'mid'].indexOf(result) < 0) fail('判断结果不合法');

    if (t.finalResults[wordId]) {
      fail('该单词已完成最后复习判断，如需修改请使用「修正」');
    }

    // 最后一轮只能处理已通过强化训练的词
    if (!trainFirstDetail(taskId, wordId)) fail('该单词尚未完成强化训练判断，不能进入最后复习');

    t.finalResults[wordId] = { result: result, at: stamp(), correctedFrom: null, corrections: 0 };
    save();
    return t;
  }

  /** 最后一轮复习修正：必填原因，保留原值 */
  function finalCorrect(taskId, wordId, result, note) {
    var t = trainTask(taskId);
    if (!t) fail('训练任务不存在');
    if (t.submitted) fail('任务已提交，不能修改判断结果');
    if (t.status !== '最后一轮复习中') fail('当前阶段不允许修改最后复习结果');
    if (!result || ['yes', 'no', 'mid'].indexOf(result) < 0) fail('修正结果不合法');
    if (!isStr(note) || !note.trim()) fail('修正必须填写原因');
    var old = t.finalResults[wordId];
    if (!old) fail('该单词尚无最后复习判断，请先做首次判断');
    if (old.result === result) fail('修正结果与原结果相同，无需修正');

    t.finalResults[wordId] = {
      result: result, at: stamp(), correctedFrom: old.result,
      corrections: (old.corrections || 0) + 1,
      correctionLog: (old.correctionLog || []).concat([{
        from: old.result, to: result, note: note.trim(), at: stamp(), by: t.teacherId
      }])
    };
    t.corrections = (t.corrections || 0) + 1;
    save();
    return t;
  }

  /* ---------------- 莱特纳 ---------------- */
  function leitnerConfig() { return db.leitnerConfig; }

  function boxMeta(boxId) {
    var c = db.leitnerConfig;
    if (boxId === 'red') return c.red;
    if (boxId === 'green') return c.green;
    if (boxId === 'graduated') return { id: 'graduated', name: '已毕业', intervalDays: null };
    return c.yellow.filter(function (y) { return y.id === boxId; })[0] || null;
  }

  function boxName(boxId) {
    var m = boxMeta(boxId);
    return m ? m.name : boxId;
  }

  function leitnerStates(studentId) {
    return db.leitnerStates.filter(function (s) { return s.studentId === studentId; });
  }

  function leitnerState(studentId, wordId) {
    return db.leitnerStates.filter(function (s) {
      return s.studentId === studentId && s.wordId === wordId;
    })[0] || null;
  }

  function isDue(s) {
    if (!s || s.box === 'graduated') return false;
    return !!s.dueAt && s.dueAt <= TODAY;
  }

  /**
   * 今日待复习
   *   来源 1：红盒到期
   *   来源 2：黄盒到期（按配置间隔算出的到期日 ≤ 今天）
   *   来源 3：教师手动加入今日复习（不受到期日限制）
   * 三个来源可能指向同一个单词，按 wordId 去重后生成实际任务
   */
  function leitnerDue(studentId) {
    var list = leitnerStates(studentId);
    var red = list.filter(function (s) { return s.box === 'red' && isDue(s); });
    var yellow = db.leitnerConfig.yellow.map(function (y) {
      return { box: y, words: list.filter(function (s) { return s.box === y.id && isDue(s); }) };
    });
    var green = list.filter(function (s) { return s.box === 'green'; });
    var manual = list.filter(function (s) { return s.manualToday && s.box !== 'graduated'; });

    var seen = {}, union = [];
    function push(arr) {
      arr.forEach(function (s) { if (!seen[s.wordId]) { seen[s.wordId] = 1; union.push(s); } });
    }
    push(red);
    yellow.forEach(function (y) { push(y.words); });
    push(manual);

    var yellowDue = yellow.reduce(function (n, y) { return n + y.words.length; }, 0);
    var rawTotal = red.length + yellowDue + manual.length;

    return {
      red: red,
      yellow: yellow,
      yellowDue: yellowDue,
      green: green,
      manual: manual,
      union: union,
      rawTotal: rawTotal,
      dedupTotal: union.length,
      dedupRemoved: rawTotal - union.length
    };
  }

  function leitnerBoxWords(studentId, box) {
    return leitnerStates(studentId).filter(function (s) { return s.box === box; });
  }

  function leitnerOps(studentId) {
    return db.leitnerOps.filter(function (o) { return o.studentId === studentId; })
      .sort(function (a, b) { return a.at < b.at ? 1 : -1; });
  }

  function logOp(studentId, wordId, action, fromBox, toBox, reason, by, taskId) {
    var o = {
      id: 'LO' + seq('LO', 4),
      studentId: studentId, wordId: wordId, action: action,
      fromBox: fromBox || null, toBox: toBox || null,
      reason: reason || '', by: by || '李婉', at: stamp(), taskId: taskId || null
    };
    db.leitnerOps.push(o);
    return o;
  }

  /** 加入绿盒（教师自主，必须记录原因） */
  function addToGreen(studentId, wordId, reason, by) {
    var s = leitnerState(studentId, wordId);
    var from = s ? s.box : null;
    if (!s) {
      s = {
        id: 'LS' + seq('LS', 3), studentId: studentId, wordId: wordId, box: 'green',
        addedAt: TODAY, dueAt: null, lastReviewAt: null, lastResult: '待复习',
        manualToday: false, reason: reason, source: '教师手动加入', sourceTaskId: null, by: by || '李婉'
      };
      db.leitnerStates.push(s);
    } else {
      s.box = 'green';
      s.dueAt = null;
      s.reason = reason;
      s.by = by || '李婉';
      s.addedAt = TODAY;
    }
    logOp(studentId, wordId, '加入绿盒', from, 'green', reason, by);
    save();
    return s;
  }

  /** 移出绿盒（回到红盒 or 直接指定目标盒） */
  function removeFromGreen(studentId, wordId, reason, by, target) {
    var s = leitnerState(studentId, wordId);
    if (!s || s.box !== 'green') return null;
    var to = target || 'red';
    s.box = to;
    s.dueAt = TODAY;
    s.manualToday = true;
    s.reason = reason;
    logOp(studentId, wordId, '移出绿盒', 'green', to, reason, by);
    save();
    return s;
  }

  /** 手动移动（任意盒 → 任意盒），必填原因 */
  function moveBox(studentId, wordId, targetBox, reason, by) {
    var s = leitnerState(studentId, wordId);
    if (!s) return null;
    var from = s.box;
    s.box = targetBox;
    if (targetBox === 'green') s.dueAt = null;
    else s.dueAt = targetBox === 'red' ? TODAY : addDays(TODAY, (boxMeta(targetBox) || {}).intervalDays || 1);
    logOp(studentId, wordId, '手动移动', from, targetBox, reason, by);
    save();
    return s;
  }

  /**
   * 按「原盒子 + 结果 + 当前配置」计算目标盒子与下次到期
   * 抽出来是为了让首次判断与修正共用同一套算法：
   * 修正必须以任务开始前的原盒子为基准重算，不能在已推进的盒子上再推一次。
   */
  function calcLeitnerTarget(fromBox, result) {
    var cfg = db.leitnerConfig;
    if (fromBox === 'green') {
      return { to: 'green', nextDue: null, note: '绿盒由教师手动管理，不按固定间隔移动' };
    }
    var rule = fromBox === 'red' ? cfg.red
      : cfg.yellow.filter(function (y) { return y.id === fromBox; })[0];
    if (!rule) return { to: fromBox, nextDue: TODAY };
    var target = result === 'yes' ? rule.onCorrect : rule.onWrong;
    if (target === 'graduated') return { to: 'graduated', nextDue: null };
    var meta = boxMeta(target);
    var gap = meta && meta.intervalDays ? meta.intervalDays : 1;
    return { to: target, nextDue: addDays(TODAY, gap) };
  }

  function leitnerFirstRecord(taskId, wordId) {
    return db.leitnerRecords.filter(function (r) {
      return r.taskId === taskId && r.wordId === wordId && !r.correction;
    })[0] || null;
  }

  function leitnerTaskRecords(taskId) {
    return db.leitnerRecords.filter(function (r) { return r.taskId === taskId; });
  }

  /** 任务统计：完成数按唯一 wordId，修正不增加完成数 */
  function leitnerTaskStat(taskId) {
    var t = leitnerTask(taskId);
    if (!t) return null;
    var recs = leitnerTaskRecords(taskId);
    var firsts = recs.filter(function (r) { return !r.correction; });
    var doneIds = uniqWordIds(firsts).filter(function (id) { return t.wordIds.indexOf(id) >= 0; });
    var yes = 0, no = 0, mid = 0;
    doneIds.forEach(function (id) {
      var eff = recs.filter(function (r) { return r.wordId === id; });
      var r = eff[eff.length - 1];
      if (r.result === 'yes') yes++; else if (r.result === 'mid') mid++; else no++;
    });
    return {
      taskId: taskId,
      total: t.wordIds.length,
      done: doneIds.length,
      remain: t.wordIds.length - doneIds.length,
      remainWordIds: t.wordIds.filter(function (id) {
        return !firsts.some(function (r) { return r.wordId === id; });
      }),
      records: recs.length,
      corrections: recs.filter(function (r) { return r.correction; }).length,
      yes: yes, no: no, mid: mid,
      complete: t.wordIds.length > 0 && doneIds.length >= t.wordIds.length
    };
  }

  /**
   * 莱特纳单词判断（首次判断专用）
   * 校验：任务存在且进行中、单词属于本任务、同任务同词只能一条首次记录
   */
  function leitnerJudge(taskId, wordId, result, teacherId) {
    var t = leitnerTask(taskId);
    if (!t) fail('复习任务不存在');
    if (t.status !== '进行中') fail('该复习任务已结束，不能继续提交');
    if (!result || ['yes', 'no', 'mid'].indexOf(result) < 0) fail('判断结果不合法');
    if (t.wordIds.indexOf(wordId) < 0) fail('该单词不属于本次复习任务，不能提交');

    var s = leitnerState(t.studentId, wordId);
    if (!s) fail('该单词不在莱特纳体系中');

    if (leitnerFirstRecord(taskId, wordId)) {
      fail('该单词本轮已判断过，如需修改请使用「修正」');
    }

    var from = s.box;
    var calc = calcLeitnerTarget(from, result);

    s.box = calc.to;
    s.dueAt = calc.nextDue;
    s.lastReviewAt = stamp();
    s.lastResult = result === 'yes' ? '认识' : result === 'mid' ? '暂不确定' : '不认识';
    s.manualToday = false;

    db.leitnerRecords.push({
      id: 'LR' + seq('LR', 4),
      taskId: taskId, studentId: t.studentId, wordId: wordId,
      boxFrom: from, boxTo: calc.to, result: result, nextDue: calc.nextDue,
      at: stamp(), teacherId: teacherId || t.teacherId, applyMode: '按配置',
      round: 1, correction: false
    });

    // 学员单词档案同步（只反映"待复习/本次通过"，不改变 21 天）
    setWordState(t.studentId, wordId,
      result === 'yes' ? '本次通过' : result === 'mid' ? '暂不确定' : '待复习',
      { note: '莱特纳 ' + boxName(calc.to) });

    save();
    return { from: from, to: calc.to, nextDue: calc.nextDue, result: result };
  }

  /**
   * 莱特纳复习修正（独立接口）
   * 关键：以首次记录里的 boxFrom 为基准重算目标盒子，
   *       而不是在当前（已被推进的）盒子上再推一次，避免盒子被重复推进。
   */
  function leitnerCorrect(taskId, wordId, result, note, teacherId) {
    var t = leitnerTask(taskId);
    if (!t) fail('复习任务不存在');
    if (!result || ['yes', 'no', 'mid'].indexOf(result) < 0) fail('修正结果不合法');
    if (!isStr(note) || !note.trim()) fail('修正必须填写原因');
    if (!isStr(teacherId)) fail('修正必须记录操作教师');

    var first = leitnerFirstRecord(taskId, wordId);
    if (!first) fail('该单词本轮尚无判断记录，请先做首次判断');

    var all = db.leitnerRecords.filter(function (r) {
      return r.taskId === taskId && r.wordId === wordId;
    });
    var eff = all[all.length - 1];          // 当前有效记录（可能是上一次修正）
    if (eff.result === result) fail('修正结果与原结果相同，无需修正');

    var s = leitnerState(t.studentId, wordId);
    if (!s) fail('该单词不在莱特纳体系中');

    // 基于「本轮开始前的原盒子」重算，而不是当前盒子
    var calc = calcLeitnerTarget(first.boxFrom, result);
    var beforeBox = s.box;

    s.box = calc.to;
    s.dueAt = calc.nextDue;
    s.lastReviewAt = stamp();
    s.lastResult = result === 'yes' ? '认识' : result === 'mid' ? '暂不确定' : '不认识';
    s.manualToday = false;

    var round = all.length + 1;

    db.leitnerRecords.push({
      id: 'LR' + seq('LR', 4),
      taskId: taskId, studentId: t.studentId, wordId: wordId,
      boxFrom: first.boxFrom, boxTo: calc.to, result: result, nextDue: calc.nextDue,
      at: stamp(), teacherId: teacherId, applyMode: '修正（按配置重算）',
      round: round, correction: true,
      correctionFrom: eff.result, correctionNote: note.trim(),
      originalResult: first.result, boxBeforeCorrect: beforeBox
    });

    setWordState(t.studentId, wordId,
      result === 'yes' ? '本次通过' : result === 'mid' ? '暂不确定' : '待复习',
      { note: '莱特纳 ' + boxName(calc.to) });

    t.corrections = (t.corrections || 0) + 1;
    save();
    return {
      from: first.boxFrom, to: calc.to, nextDue: calc.nextDue,
      result: result, boxBeforeCorrect: beforeBox, round: round
    };
  }

  function finishLeitnerTask(taskId, teacherId) {
    var t = leitnerTask(taskId);
    if (!t) fail('复习任务不存在');
    if (t.status === '已完成') {
      return { ok: false, reason: '该复习任务已完成，不能重复提交', stat: leitnerTaskStat(taskId) };
    }
    var stat = leitnerTaskStat(taskId);
    t.status = '已完成';
    t.completedAt = stamp();
    t.remainWordIds = stat.remainWordIds.slice();
    t.interrupted = !stat.complete;
    t.stats = {
      total: stat.total, done: stat.done, records: stat.records,
      yes: stat.yes, no: stat.no, mid: stat.mid, corrections: stat.corrections
    };
    save();
    return { ok: true, task: t, stat: stat };
  }

  function leitnerTask(id) {
    return db.leitnerTasks.filter(function (t) { return t.id === id; })[0] || null;
  }

  /**
   * 创建莱特纳复习任务
   * 校验：单词必须属于该学员的莱特纳体系；去重；拒绝空任务
   */
  function createLeitnerTask(studentId, wordIds, teacherId, source) {
    if (!isStr(studentId)) fail('必须指定学员');
    var ids = cleanWordIds(wordIds).filter(function (id) {
      return !!leitnerState(studentId, id);
    });
    if (!ids.length) fail('没有可复习的莱特纳单词，不能创建空任务');

    var t = {
      id: 'LT' + TODAY.replace(/-/g, '') + seq('LT', 2),
      studentId: studentId,
      teacherId: teacherId || 'T001',
      wordIds: ids,
      boxes: [],
      source: source || '系统推荐',
      createdAt: stamp(),
      status: '进行中',
      completedAt: null,
      remainWordIds: [],
      corrections: 0,
      stats: null
    };
    ids.forEach(function (id) {
      var s = leitnerState(studentId, id);
      if (s && t.boxes.indexOf(s.box) < 0) t.boxes.push(s.box);
    });
    db.leitnerTasks.push(t);
    save();
    return t;
  }

  function leitnerRecordsOf(studentId, wordId) {
    return db.leitnerRecords.filter(function (r) {
      return r.studentId === studentId && (!wordId || r.wordId === wordId);
    }).sort(function (a, b) { return a.at < b.at ? 1 : -1; });
  }

  function leitnerTasksOf(studentId) {
    return db.leitnerTasks.filter(function (t) { return t.studentId === studentId; })
      .sort(function (a, b) { return a.createdAt < b.createdAt ? 1 : -1; });
  }

  /* ---------------- 21 天 ---------------- */
  function plansOf(studentId) {
    return db.plans21.filter(function (p) { return p.studentId === studentId; })
      .sort(function (a, b) { return a.startDate < b.startDate ? 1 : -1; });
  }
  function plan21(id) { return db.plans21.filter(function (p) { return p.id === id; })[0] || null; }
  function plan21Tasks(planId) {
    return db.plan21Tasks.filter(function (t) { return t.planId === planId; })
      .sort(function (a, b) { return a.day - b.day; });
  }
  function plan21Task(id) { return db.plan21Tasks.filter(function (t) { return t.id === id; })[0] || null; }

  function plan21Today(planId) {
    return plan21Tasks(planId).filter(function (t) { return t.date === TODAY && t.wordIds.length; })[0] || null;
  }

  function plan21Records(planId, wordId) {
    return db.plan21Records.filter(function (r) {
      return r.planId === planId && (!wordId || r.wordId === wordId);
    });
  }

  /** 某节点的全部记录（含修正） */
  function plan21TaskRecords(taskId) {
    return db.plan21Records.filter(function (r) { return r.taskId === taskId; });
  }

  /** 某节点某单词的首次判断记录（不含修正） */
  function plan21FirstRecord(taskId, wordId) {
    return db.plan21Records.filter(function (r) {
      return r.taskId === taskId && r.wordId === wordId && !r.correction;
    })[0] || null;
  }

  /** 某节点有效结果：取每个 wordId 最后写入的一条（修正记录后写，自然覆盖为有效值） */
  function plan21Effective(taskId) {
    var byWord = {};
    plan21TaskRecords(taskId).forEach(function (r) { byWord[r.wordId] = r; });
    return byWord;
  }

  /**
   * 节点统计：完成度一律按唯一 wordId 计算，绝不用原始记录条数
   * 修正记录不会增加完成数（同一个 wordId 只算一个）
   */
  function plan21TaskStat(taskId) {
    var t = plan21Task(taskId);
    if (!t) return null;
    var recs = plan21TaskRecords(taskId);
    var eff = plan21Effective(taskId);
    var doneIds = Object.keys(eff).filter(function (id) { return t.wordIds.indexOf(id) >= 0; });
    var yes = 0, no = 0, mid = 0;
    doneIds.forEach(function (id) {
      var r = eff[id].result;
      if (r === 'yes') yes++; else if (r === 'mid') mid++; else no++;
    });
    return {
      taskId: taskId,
      total: t.wordIds.length,          // 本节点应复习单词数
      done: doneIds.length,             // 已判断的唯一单词数
      remain: t.wordIds.length - doneIds.length,
      remainWordIds: t.wordIds.filter(function (id) { return !eff[id]; }),
      records: recs.length,             // 原始记录条数（含修正），仅作审计
      corrections: recs.filter(function (r) { return r.correction; }).length,
      yes: yes, no: no, mid: mid,
      complete: t.wordIds.length > 0 && doneIds.length >= t.wordIds.length
    };
  }

  function plan21Progress(plan) {
    var tasks = plan21Tasks(plan.id);
    var elapsed = tasks.filter(function (t) { return t.date <= TODAY && t.wordIds.length; });
    var totalWords = elapsed.reduce(function (n, t) { return n + t.wordIds.length; }, 0);
    // 完成数按唯一 wordId 累计（同一节点修正或重复写入不会虚增）
    var doneWords = 0;
    elapsed.forEach(function (t) {
      doneWords += plan21TaskStat(t.id).done;
    });
    var todayTask = plan21Today(plan.id);
    return {
      tasks: tasks,
      elapsedTasks: elapsed.length,
      totalWords: totalWords,
      doneWords: doneWords,
      rate: totalWords ? Math.round(doneWords / totalWords * 1000) / 10 : 0,
      todayTask: todayTask,
      todayTotal: todayTask ? todayTask.wordIds.length : 0,
      todayDone: todayTask ? plan21TaskStat(todayTask.id).done : 0,
      currentDay: (function () {
        var t = tasks.filter(function (x) { return x.date === TODAY; })[0];
        if (t) return t.day;
        var past = tasks.filter(function (x) { return x.date < TODAY; });
        return past.length ? past[past.length - 1].day : 1;
      })()
    };
  }

  /**
   * 创建计划：按配置生成 21 天时间轴，每个计划拥有独立单词清单
   * 校验：拒绝空清单、去重、过滤无效单词 ID；节点内只允许有效且不重复的单词
   */
  function create21Plan(opt) {
    opt = opt || {};
    if (!isStr(opt.studentId)) fail('必须指定学员');
    var stu = student(opt.studentId);
    if (!stu) fail('学员不存在');

    var ids = cleanWordIds(opt.wordIds);
    if (!ids.length) fail('没有可加入计划的单词，不能创建空计划');

    var cfg = db.config.plan21Strategy;
    var start = opt.startDate || TODAY;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) fail('开始日期格式不正确');

    var plan = {
      id: 'PN' + start.replace(/-/g, '') + seq('P21', 2),
      studentId: opt.studentId,
      name: opt.name || (stu.name + ' 记忆计划'),
      startDate: start,
      strategy: opt.strategy || cfg.name,
      status: '进行中',
      wordIds: ids,
      createdBy: opt.by || '李婉',
      createdAt: stamp(),
      note: opt.note || ''
    };
    db.plans21.push(plan);

    cfg.nodeDays.forEach(function (d, i) {
      var ratio = cfg.ratios[i] === undefined ? .5 : cfg.ratios[i];
      var cnt = Math.min(cfg.dailyCap, Math.max(1, Math.round(ids.length * ratio)));
      var date = addDays(start, d - 1);
      var offset = ((d - 1) * 3) % Math.max(ids.length, 1);
      var raw = [];
      for (var k = 0; k < cnt; k++) raw.push(ids[(offset + k) % ids.length]);
      db.plan21Tasks.push({
        id: 'P21T' + seq('P21', 4),
        planId: plan.id, day: d, date: date,
        wordIds: cleanWordIds(raw),   // 节点内不允许 undefined / 重复 ID
        status: date === TODAY ? 'today' : 'plan',
        completedAt: null, remainWordIds: [], teacherId: opt.by || 'T001'
      });
    });

    // 单词进入学员档案的待复习（若尚未在体系中）
    ids.forEach(function (id) {
      var s = wordState(opt.studentId, id);
      if (!s || s.state === '未训练') {
        setWordState(opt.studentId, id, '待复习', { note: '21 天计划 ' + plan.name });
      }
    });

    save();
    return plan;
  }

  /**
   * 21 天单词判断（首次判断专用）
   * 校验：
   *   1. 节点存在且属于有效计划
   *   2. 单词必须属于本节点清单
   *   3. 节点必须处于允许操作的状态（已完成节点禁止普通提交）
   *   4. 同一节点同一 wordId 只能有一条首次判断记录，已判断必须走 plan21Correct
   */
  function plan21Judge(taskId, wordId, result, teacherId) {
    var t = plan21Task(taskId);
    if (!t) fail('复习节点不存在');
    var plan = plan21(t.planId);
    if (!plan) fail('计划不存在');
    if (!result || ['yes', 'no', 'mid'].indexOf(result) < 0) fail('判断结果不合法');

    if (!t.wordIds || !t.wordIds.length) fail('该节点没有需要复习的单词');
    if (t.wordIds.indexOf(wordId) < 0) fail('该单词不属于本次复习节点，不能提交');

    if (t.status === 'done') fail('本节点已完成，如需修改请使用「修正」');
    if (t.status === 'rest') fail('休息节点不能提交复习结果');
    if (plan.status === '已完成' || plan.status === '已取消') fail('计划已结束，不能继续提交');

    if (plan21FirstRecord(taskId, wordId)) {
      fail('该单词本节点已判断过，如需修改请使用「修正」');
    }

    var at = stamp();
    db.plan21Records.push({
      id: 'P21R' + seq('P21R', 4),
      taskId: taskId, planId: t.planId, studentId: plan.studentId,
      wordId: wordId, day: t.day, result: result, at: at,
      teacherId: teacherId || 'T001', round: 1, correction: false
    });

    // 节点状态按唯一 wordId 数量重算
    var stat = plan21TaskStat(taskId);
    if (stat.complete) {
      t.status = 'done';
      t.completedAt = at;
      t.remainWordIds = [];
    } else {
      t.status = 'today';
      t.completedAt = null;
      t.remainWordIds = stat.remainWordIds;
    }
    save();
    return t;
  }

  /**
   * 21 天复习修正（独立接口）
   * 只追加新记录，不删除、不覆盖原始记录；原记录的 result 保持原值
   * @param {string} note 修正原因，必填
   */
  function plan21Correct(taskId, wordId, result, note, teacherId) {
    var t = plan21Task(taskId);
    if (!t) fail('复习节点不存在');
    var plan = plan21(t.planId);
    if (!plan) fail('计划不存在');
    if (!result || ['yes', 'no', 'mid'].indexOf(result) < 0) fail('修正结果不合法');
    if (!isStr(note) || !note.trim()) fail('修正必须填写原因');
    if (!isStr(teacherId)) fail('修正必须记录操作教师');

    if (t.wordIds.indexOf(wordId) < 0) fail('该单词不属于本次复习节点');

    var first = plan21FirstRecord(taskId, wordId);
    if (!first) fail('该单词本节点尚无判断记录，请先做首次判断');

    var all = db.plan21Records.filter(function (r) {
      return r.taskId === taskId && r.wordId === wordId;
    });
    var eff = all[all.length - 1];
    if (eff.result === result) fail('修正结果与原结果相同，无需修正');

    var at = stamp();
    var round = all.length + 1;

    db.plan21Records.push({
      id: 'P21R' + seq('P21R', 4),
      taskId: taskId, planId: t.planId, studentId: plan.studentId,
      wordId: wordId, day: t.day, result: result, at: at,
      teacherId: teacherId, round: round,
      correction: true, correctionFrom: eff.result,
      originalResult: first.result, correctionNote: note.trim()
    });

    // 修正不改变完成度（唯一 wordId 不变），只刷新节点状态
    var stat = plan21TaskStat(taskId);
    if (stat.complete) { t.status = 'done'; t.completedAt = t.completedAt || at; t.remainWordIds = []; }
    save();
    return { task: t, from: eff.result, to: result, round: round, stat: stat };
  }

  /**
   * 结束节点（提前结束 / 收尾）
   * 已完成节点不允许再次普通结束；提前结束时未完成单词保留为未完成
   */
  function finish21Task(taskId, opt) {
    var t = plan21Task(taskId);
    if (!t) fail('复习节点不存在');
    opt = opt || {};
    var stat = plan21TaskStat(taskId);

    if (t.status === 'done' && !opt.reopen) {
      return { ok: false, reason: '本节点已完成，不能重复结束', stat: stat, task: t };
    }

    var at = stamp();
    t.remainWordIds = stat.remainWordIds.slice();
    t.interrupted = !stat.complete;
    t.finishedAt = at;
    if (stat.complete) {
      t.status = 'done';
      t.completedAt = t.completedAt || at;
    } else {
      // 未完成：保留剩余单词，按日期决定是漏做还是今日未完成
      t.status = t.date < TODAY ? 'miss' : 'today';
      t.completedAt = null;
      t.interruptReason = opt.reason || '';
    }
    save();
    return { ok: true, task: t, stat: stat, complete: stat.complete };
  }

  /* ---------------- 训练收尾：加入复习体系 ---------------- */
  /**
   * 提交训练结果并（可选）加入复习体系
   * 校验链：
   *   1. 任务存在、未提交、阶段为最后一轮复习、未中断
   *   2. 所有队列单词都有强化训练首次判断
   *   3. 所有队列单词都有最后复习判断
   * 全部通过后才置 submitted，避免"提示成功但没写入"
   * 本次没有待复习单词时：不建空计划、不建空莱特纳任务
   *
   * @param {string} taskId
   * @param {{joinLeitner:boolean, joinPlan21:boolean, joinGreen:boolean, by?:string}} opt
   */
  function completeTask(taskId, opt) {
    opt = opt || {};
    var t = trainTask(taskId);
    if (!t) fail('训练任务不存在');
    if (t.submitted || t.status === '已完成') {
      return { ok: false, reason: '该训练任务已提交，不能重复提交' };
    }
    if (t.status === '已中断') {
      return { ok: false, reason: '任务已中断，请先恢复训练完成后再提交' };
    }
    if (t.status !== '最后一轮复习中') {
      return { ok: false, reason: '请先完成最后一轮复习再提交' };
    }

    var stat = trainTaskStat(taskId);
    if (!stat.queue) return { ok: false, reason: '本次任务没有训练队列，不能提交' };
    if (stat.trainedMissing.length) {
      return { ok: false, reason: '还有 ' + stat.trainedMissing.length + ' 个单词未完成强化训练判断' };
    }
    if (stat.finalMissing.length) {
      return { ok: false, reason: '还有 ' + stat.finalMissing.length + ' 个单词未做最后复习判断' };
    }

    var pass = [], review = [], mid = [];
    t.queueWordIds.forEach(function (id) {
      var r = t.finalResults[id].result;
      if (r === 'yes') { pass.push(id); setWordState(t.studentId, id, '本次通过', { lastTaskId: taskId, note: '最后复习通过' }); }
      else if (r === 'mid') { mid.push(id); setWordState(t.studentId, id, '暂不确定', { lastTaskId: taskId, note: '最后复习暂不确定' }); }
      else { review.push(id); setWordState(t.studentId, id, '待复习', { lastTaskId: taskId, note: '最后复习不认识' }); }
    });

    // 需要复习的单词 = 不认识 + 暂不确定（PRD 11.7），通过的单词不加入
    var need = cleanWordIds(review.concat(mid));
    t.joins = { leitner: [], plan21: [], planIds: [], green: [] };
    t.submitted = true;
    t.status = '已完成';
    t.finishedAt = stamp();

    var warnings = [];

    /* 空复习：本次全部通过，不创建任何空计划 / 空任务 / 含 undefined 的清单 */
    if (!need.length) {
      t.joins.empty = true;
      save();
      return {
        ok: true, task: t, noReview: true,
        pass: pass.length, review: 0, mid: 0, need: 0,
        joins: t.joins,
        message: '本次全部单词均已通过，没有待复习单词，无需加入复习体系'
      };
    }
    t.joins.empty = false;

    if (opt.joinLeitner) {
      need.forEach(function (id) {
        var s = leitnerState(t.studentId, id);
        if (s) {
          // 已在体系中：绿盒由教师手动管理，只加到今日复习；其余回到红盒重新开始
          if (s.box === 'green') { s.manualToday = true; }
          else {
            s.box = 'red'; s.dueAt = TODAY; s.lastResult = '待复习'; s.manualToday = false;
          }
        } else {
          db.leitnerStates.push({
            id: 'LS' + seq('LS', 3), studentId: t.studentId, wordId: id,
            box: 'red', addedAt: TODAY, dueAt: TODAY,
            lastReviewAt: null, lastResult: '待复习', manualToday: false,
            reason: '', source: '训练加入', sourceTaskId: taskId, by: opt.by || '李婉'
          });
          logOp(t.studentId, id, '训练加入红盒', null, 'red', '训练任务 ' + t.id, opt.by || '李婉', taskId);
        }
      });
      t.joins.leitner = need.slice();
    }

    if (opt.joinPlan21) {
      try {
        var plan = create21Plan({
          studentId: t.studentId,
          name: (t.finishedAt || TODAY).slice(5, 10).replace('-', '/') + ' 训练加入',
          startDate: TODAY,
          wordIds: need,
          by: opt.by || '李婉',
          note: '来源训练任务 ' + t.id
        });
        t.joins.plan21 = need.slice();
        t.joins.planIds = [plan.id];
      } catch (e) {
        warnings.push('21 天计划未创建：' + e.message);
      }
    }

    if (opt.joinGreen) {
      need.forEach(function (id) {
        var s = leitnerState(t.studentId, id);
        if (s && s.box === 'green') return;
        addToGreen(t.studentId, id, '训练最后复习未通过（任务 ' + t.id + '）', opt.by || '李婉');
      });
      t.joins.green = need.slice();
    }

    save();
    return {
      ok: true,
      task: t,
      noReview: false,
      pass: pass.length, review: review.length, mid: mid.length,
      need: need.length,
      joins: t.joins,
      warnings: warnings
    };
  }

  /* ---------------- 文章训练 ---------------- */
  function articleTask(id) {
    return db.articleTasks.filter(function (t) { return t.id === id; })[0] || null;
  }

  function articleTasksOf(studentId) {
    return db.articleTasks.filter(function (t) { return t.studentId === studentId; })
      .sort(function (a, b) { return a.startedAt < b.startedAt ? 1 : -1; });
  }

  function articleTaskDetails(taskId) {
    return db.articleTaskDetails.filter(function (d) { return d.taskId === taskId; })
      .sort(function (a, b) { return a.seq - b.seq; });
  }

  function articleActiveTask(studentId, articleId) {
    return db.articleTasks.filter(function (t) {
      return t.studentId === studentId && t.articleId === articleId && t.status === '进行中';
    }).sort(function (a, b) { return a.startedAt < b.startedAt ? 1 : -1; })[0] || null;
  }

  /**
   * 开始（或恢复）一次文章训练
   * @param {{studentId,teacherId,articleId,articleName,courseId?,sentences:[{i,en,cn}]}} opt
   */
  function startArticleTask(opt) {
    opt = opt || {};
    if (!isStr(opt.studentId)) fail('必须指定学员');
    if (!isStr(opt.articleId)) fail('必须指定文章');
    if (!student(opt.studentId)) fail('学员不存在');

    var ex = articleActiveTask(opt.studentId, opt.articleId);
    if (ex) return ex;   // 同一学员同一文章有未完成任务时直接恢复，不重复建

    var sents = (opt.sentences || []).map(function (s, i) {
      return { id: 'S' + pad(s.i || i + 1, 2), seq: s.i || i + 1, en: s.en, cn: s.cn };
    });
    if (!sents.length) fail('该文章没有句子数据，无法开始训练');

    var t = {
      id: 'AT' + TODAY.replace(/-/g, '') + seq('AT', 3),
      studentId: opt.studentId,
      teacherId: opt.teacherId || 'T001',
      articleId: opt.articleId,
      articleName: opt.articleName || opt.articleId,
      courseId: opt.courseId || '',
      startedAt: stamp(),
      finishedAt: null,
      audioDone: false,
      totalSentences: sents.length,
      doneSentences: 0,
      evaluation: '',
      note: '',
      status: '进行中',
      endReason: '',
      sentences: sents,
      by: opt.by || '李婉'
    };
    db.articleTasks.push(t);
    // 句子明细先落空记录，保证"刷新后能恢复未完成句子"
    sents.forEach(function (s) {
      db.articleTaskDetails.push({
        id: 'ATD' + seq('ATD', 5),
        taskId: t.id, studentId: t.studentId,
        sentenceId: s.id, seq: s.seq, en: s.en,
        audioPlayed: false, cnViewed: false, readDone: false,
        teacherConfirm: '', at: null, teacherId: t.teacherId
      });
    });
    save();
    return t;
  }

  function articleDetail(taskId, sentenceId) {
    return db.articleTaskDetails.filter(function (d) {
      return d.taskId === taskId && d.sentenceId === sentenceId;
    })[0] || null;
  }

  /**
   * 记录单句操作（播放音频 / 查看中文 / 跟读完成 / 教师确认）
   * 只写文章训练自己的表，绝不触碰单词掌握状态
   */
  function articleSentenceLog(taskId, sentenceId, patch) {
    var t = articleTask(taskId);
    if (!t) fail('文章训练任务不存在');
    if (t.status !== '进行中') fail('该训练已结束，不能继续记录');
    var d = articleDetail(taskId, sentenceId);
    if (!d) fail('该句子不属于本次训练');

    patch = patch || {};
    ['audioPlayed', 'cnViewed', 'readDone'].forEach(function (k) {
      if (patch[k] !== undefined) d[k] = !!patch[k];
    });
    if (patch.teacherConfirm !== undefined) d.teacherConfirm = patch.teacherConfirm;
    d.at = stamp();
    d.teacherId = patch.teacherId || d.teacherId;

    var done = articleTaskDetails(taskId).filter(function (x) { return x.readDone; }).length;
    t.doneSentences = done;
    save();
    return d;
  }

  function setArticleAudioDone(taskId, done) {
    var t = articleTask(taskId);
    if (!t) fail('文章训练任务不存在');
    if (t.status !== '进行中') fail('该训练已结束，不能修改');
    t.audioDone = !!done;
    save();
    return t;
  }

  /**
   * 保存/结束文章训练
   * 提前结束时：已记录句子保留，未完成句子保持未完成，不静默补齐
   */
  function finishArticleTask(taskId, opt) {
    opt = opt || {};
    var t = articleTask(taskId);
    if (!t) fail('文章训练任务不存在');
    if (t.status !== '进行中') {
      return { ok: false, reason: '该文章训练已结束，不能重复提交', task: t };
    }
    t.doneSentences = articleTaskDetails(taskId).filter(function (x) { return x.readDone; }).length;
    t.evaluation = opt.evaluation || t.evaluation || '';
    t.note = opt.note || t.note || '';
    t.finishedAt = stamp();
    t.status = t.doneSentences >= t.totalSentences && t.audioDone ? '已完成' : '提前结束';
    t.endReason = opt.endReason || '';
    save();
    return {
      ok: true, task: t,
      total: t.totalSentences, done: t.doneSentences,
      remain: t.totalSentences - t.doneSentences
    };
  }

  /* ---------------- 财务：课时流水与冲正 ---------------- */
  function flows() { return db.flows; }
  function flow(id) { return db.flows.filter(function (f) { return f.id === id; })[0] || null; }
  function accounts() { return db.accounts; }
  function account(id) { return db.accounts.filter(function (a) { return a.id === id; })[0] || null; }

  /** 允许冲正的流水类型：只有"导致课时减少"的类型可以冲回 */
  var REVERSIBLE = ['正常扣课', '课时调整'];
  function reversibleCheck(f) {
    if (!f) return { ok: false, reason: '原流水不存在' };
    if (REVERSIBLE.indexOf(f.type) < 0) return { ok: false, reason: '该类型流水不允许冲正（仅扣课类可冲正）' };
    if (f.delta >= 0) return { ok: false, reason: '该流水不是扣减流水，无需冲正' };
    return { ok: true };
  }

  function reversedHours(flowId) {
    return db.flowReversals
      .filter(function (r) { return r.flowId === flowId; })
      .reduce(function (n, r) { return n + r.hours; }, 0);
  }

  /**
   * 课时冲正：新增一条方向相反的流水，原流水永久保留
   * 校验：原流水存在 → 类型允许 → 冲正额 ≤ 剩余可冲正额（禁止重复全额冲正）
   */
  function reverseFlow(flowId, hours, reason, note, by) {
    var f = flow(flowId);
    var chk = reversibleCheck(f);
    if (!chk.ok) fail(chk.reason);

    var h = Number(hours);
    if (!isFinite(h) || h <= 0) fail('冲正课时数必须大于 0');
    if (!isStr(reason) || !reason.trim()) fail('必须选择冲正原因');
    if (!isStr(note) || !note.trim()) fail('必须填写冲正原因说明');
    if (!isStr(by)) fail('必须记录操作人');

    var cap = Math.abs(f.delta);
    var used = reversedHours(flowId);
    var left = cap - used;
    if (left <= 0) fail('该流水已全额冲正，不能重复冲正');
    if (h > left) fail('冲正课时数不能超过可冲正上限（' + left + ' 课时）');

    var acc = account(f.account);
    if (!acc) fail('原流水对应的课时账户不存在');

    var before = acc.remain;
    var after = before + h;
    var at = stamp();
    var nf = {
      id: 'FL' + TODAY.replace(/-/g, '') + pad(db.meta.seq.FV + 1, 3),
      student: f.student,
      account: f.account,
      type: '扣课冲正',
      delta: h,
      before: before,
      after: after,
      ref: f.id + ' 冲正',
      op: by,
      time: at,
      note: reason + '｜' + note.trim() + '｜关联原流水 ' + f.id
    };
    db.meta.seq.FV = (db.meta.seq.FV || 0) + 1;
    db.flows.unshift(nf);

    // 更新账户余额与已用课时
    acc.remain = after;
    acc.used = Math.max(0, (acc.used || 0) - h);

    db.flowReversals.push({
      id: 'RV' + pad(db.meta.seq.FV, 4),
      flowId: flowId,
      newFlowId: nf.id,
      account: f.account,
      hours: h,
      reason: reason,
      note: note.trim(),
      by: by,
      at: at,
      before: before,
      after: after
    });

    save();
    return { flow: nf, account: acc, reversedTotal: used + h, remaining: cap - used - h };
  }

  function reversalsOf(flowId) {
    return db.flowReversals.filter(function (r) { return r.flowId === flowId; })
      .sort(function (a, b) { return a.at < b.at ? 1 : -1; });
  }

  /* ---------------- 家长端：复习词表（派生 + 辅助勾选） ---------------- */
  /**
   * 家长端待复习单词表：完全由 Store 派生，不再使用页面私有数组
   * @param {string} studentId
   * @param {{system?:'all'|'leitner'|'plan21', bookId?:string, includePassed?:boolean}} opt
   */
  function reviewWords(studentId, opt) {
    opt = opt || {};
    var system = opt.system || 'all';
    var rows = [];
    var planIds = {};

    // 来源 1：莱特纳体系（未毕业的单词）
    if (system === 'all' || system === 'leitner') {
      leitnerStates(studentId).forEach(function (s) {
        if (s.box === 'graduated') return;
        rows.push({
          wordId: s.wordId, systems: ['莱特纳'],
          leitnerBox: s.box, leitnerBoxName: boxName(s.box),
          dueAt: s.dueAt, lastResult: s.lastResult || '待复习'
        });
      });
    }

    // 来源 2：21 天计划单词
    if (system === 'all' || system === 'plan21') {
      plansOf(studentId).forEach(function (p) {
        if (p.status === '已取消') return;
        p.wordIds.forEach(function (wid) {
          var hit = rows.filter(function (r) { return r.wordId === wid; })[0];
          if (hit) {
            if (hit.systems.indexOf('21 天') < 0) hit.systems.push('21 天');
          } else {
            rows.push({ wordId: wid, systems: ['21 天'], leitnerBox: null, dueAt: null, lastResult: '待复习' });
          }
          planIds[wid] = 1;
        });
      });
    }

    // 补全单词信息 + 学员状态
    rows = rows.map(function (r) {
      var w = word(r.wordId);
      var st = wordState(studentId, r.wordId);
      return {
        wordId: r.wordId,
        en: w ? w.en : r.wordId,
        ph: w ? w.ph : '',
        cn: w ? w.mean.map(function (m) { return m.cn; }).join('；') : '',
        unit: w ? (w.grade + ' ' + w.unit) : '',
        bookNames: wordbookNamesOf(r.wordId),
        bookIds: wordbookIdsOf(r.wordId),
        systems: r.systems,
        state: st ? st.state : '未训练',
        leitnerBox: r.leitnerBox,
        leitnerBoxName: r.leitnerBox ? boxName(r.leitnerBox) : '',
        dueAt: r.dueAt,
        lastResult: r.lastResult,
        inPlan21: !!planIds[r.wordId]
      };
    });

    // 词库筛选
    if (isStr(opt.bookId)) {
      rows = rows.filter(function (r) { return r.bookIds.indexOf(opt.bookId) >= 0; });
    }
    // 默认排除已通过（家长复习表聚焦"要复习的"）
    if (!opt.includePassed) {
      rows = rows.filter(function (r) { return r.state !== '本次通过'; });
    }

    // 待复习优先，其次暂不确定，再按字母
    var rank = { '待复习': 0, '暂不确定': 1, '待强化训练': 2, '待最后复习': 3, '初筛认识': 4, '本次通过': 5, '未训练': 6 };
    rows.sort(function (a, b) {
      var d = (rank[a.state] === undefined ? 9 : rank[a.state]) - (rank[b.state] === undefined ? 9 : rank[b.state]);
      if (d) return d;
      return a.en < b.en ? -1 : a.en > b.en ? 1 : 0;
    });

    return rows;
  }

  function wordbookIdsOf(wordId) {
    return db.wordbookWords.filter(function (x) { return x.wordId === wordId; })
      .map(function (x) { return x.bookId; });
  }
  function wordbookNamesOf(wordId) {
    return wordbookIdsOf(wordId).map(function (id) {
      var b = wordbook(id); return b ? b.name : id;
    });
  }

  /** 家庭复习勾选：只写辅助表，不改变任何正式学习状态 */
  function familyCheck(studentId, wordId) {
    return db.familyChecks.filter(function (c) {
      return c.studentId === studentId && c.wordId === wordId && c.date === TODAY;
    })[0] || null;
  }

  function familyChecksOf(studentId) {
    return db.familyChecks.filter(function (c) {
      return c.studentId === studentId && c.date === TODAY;
    });
  }

  function toggleFamilyCheck(studentId, wordId, checked, by) {
    if (!isStr(studentId) || !isStr(wordId)) fail('参数不完整');
    var c = familyCheck(studentId, wordId);
    if (checked) {
      if (!c) {
        db.familyChecks.push({
          id: 'FC' + seq('FC', 4),
          studentId: studentId, wordId: wordId, date: TODAY,
          checked: true, at: stamp(), by: by || '家长'
        });
      } else {
        c.checked = true; c.at = stamp();
      }
    } else if (c) {
      c.checked = false; c.at = stamp();
    }
    save();
    return familyCheck(studentId, wordId);
  }

  /* ---------------- 统计 ---------------- */
  function stats(studentId) {
    var sts = wordStates(studentId);
    var byState = {};
    sts.forEach(function (s) { byState[s.state] = (byState[s.state] || 0) + 1; });
    var ls = leitnerStates(studentId).filter(function (s) { return s.box !== 'graduated'; });
    var due = leitnerDue(studentId);
    var plans = plansOf(studentId);
    var planWordIds = {};
    plans.forEach(function (p) { p.wordIds.forEach(function (id) { planWordIds[id] = 1; }); });
    var both = ls.filter(function (s) { return planWordIds[s.wordId]; });
    return {
      stateTotal: sts.length,
      byState: byState,
      review: (byState['待复习'] || 0) + (byState['暂不确定'] || 0),
      passed: byState['本次通过'] || 0,
      prescreenKnown: byState['初筛认识'] || 0,
      toTrain: (byState['待强化训练'] || 0) + (byState['待最后复习'] || 0) + (byState['强化训练中'] || 0),
      leitnerTotal: ls.length,
      leitnerRed: ls.filter(function (s) { return s.box === 'red'; }).length,
      leitnerYellow: ls.filter(function (s) { return s.box.charAt(0) === 'Y'; }).length,
      leitnerGreen: ls.filter(function (s) { return s.box === 'green'; }).length,
      leitnerDue: due.dedupTotal,
      planCount: plans.length,
      planWordCount: Object.keys(planWordIds).length,
      bothCount: both.length,
      onlyPlan: Object.keys(planWordIds).filter(function (id) {
        return !ls.some(function (s) { return s.wordId === id; });
      }).length
    };
  }

  /* ---------------- 对外 ---------------- */
  var Store = {
    TODAY: TODAY,
    backend: W.__STORE_BACKEND,
    init: function () { return load(); },
    get db() { return db; },
    save: save,
    reset: reset,
    /* 基础 */
    students: students, student: student, teacher: teacher,
    wordbooks: wordbooks, wordbook: wordbook, word: word, wordByEn: wordByEn, wordsOfBook: wordsOfBook,
    /* 档案 */
    wordState: wordState, wordStates: wordStates, setWordState: setWordState, ensureWordState: ensureWordState,
    /* 训练 */
    trainTask: trainTask, tasksOf: tasksOf, activeTask: activeTask, startTrainTask: startTrainTask,
    prescreenAnswer: prescreenAnswer, finishPrescreen: finishPrescreen,
    queueOf: queueOf, groupsOfTask: groupsOfTask, groupsOf: groupsOf, detailsOf: detailsOf,
    prescreensOf: prescreensOf, trainDetailsOf: trainDetailsOf, finalReviewsOf: finalReviewsOf,
    trainJudge: trainJudge, trainCorrect: trainCorrect, setTaskPos: setTaskPos,
    trainTaskStat: trainTaskStat, trainFirstDetail: trainFirstDetail,
    pauseTask: pauseTask, resumeTask: resumeTask, endTask: endTask, cancelTask: cancelTask,
    toFinalStage: toFinalStage, finalJudge: finalJudge, finalCorrect: finalCorrect,
    completeTask: completeTask,
    /* 莱特纳 */
    leitnerConfig: leitnerConfig, boxMeta: boxMeta, boxName: boxName,
    leitnerStates: leitnerStates, leitnerState: leitnerState, leitnerBoxWords: leitnerBoxWords,
    leitnerDue: leitnerDue, isDue: isDue, leitnerOps: leitnerOps,
    addToGreen: addToGreen, removeFromGreen: removeFromGreen, moveBox: moveBox,
    createLeitnerTask: createLeitnerTask, leitnerTask: leitnerTask,
    leitnerJudge: leitnerJudge, leitnerCorrect: leitnerCorrect, finishLeitnerTask: finishLeitnerTask,
    leitnerTaskStat: leitnerTaskStat, leitnerFirstRecord: leitnerFirstRecord,
    leitnerTaskRecords: leitnerTaskRecords,
    leitnerRecordsOf: leitnerRecordsOf, leitnerTasksOf: leitnerTasksOf,
    /* 21 天 */
    plansOf: plansOf, plan21: plan21, plan21Tasks: plan21Tasks, plan21Task: plan21Task,
    plan21Today: plan21Today, plan21Records: plan21Records, plan21Progress: plan21Progress,
    plan21TaskRecords: plan21TaskRecords, plan21TaskStat: plan21TaskStat,
    plan21Effective: plan21Effective, plan21FirstRecord: plan21FirstRecord,
    create21Plan: create21Plan, plan21Judge: plan21Judge,
    plan21Correct: plan21Correct, finish21Task: finish21Task,
    /* 文章训练 */
    articleTask: articleTask, articleTasksOf: articleTasksOf, articleTaskDetails: articleTaskDetails,
    articleActiveTask: articleActiveTask, startArticleTask: startArticleTask,
    articleSentenceLog: articleSentenceLog, setArticleAudioDone: setArticleAudioDone,
    finishArticleTask: finishArticleTask,
    /* 财务 */
    flows: flows, flow: flow, accounts: accounts, account: account,
    reverseFlow: reverseFlow, reversalsOf: reversalsOf, reversedHours: reversedHours,
    reversibleCheck: reversibleCheck,
    /* 家长端 */
    reviewWords: reviewWords, familyCheck: familyCheck, familyChecksOf: familyChecksOf,
    toggleFamilyCheck: toggleFamilyCheck,
    /* 统计 */
    stats: stats,
    /* 工具 */
    addDays: addDays, stamp: stamp, clone: clone,
    cleanWordIds: cleanWordIds, uniqWordCount: uniqWordCount, uniqWordIds: uniqWordIds
  };

  load();
  W.Store = Store;
})();
