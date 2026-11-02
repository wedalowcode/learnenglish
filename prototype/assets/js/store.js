/* ============================================================
   统一模拟数据层 Store —— 第一轮迭代新增
   ------------------------------------------------------------
   设计约束（对应任务书第七节）：
   1. 全站学习域只读写这一份数据，页面不得再自建数组。
   2. 通过 localStorage 持久化；不可用时降级 sessionStorage；再降级内存。
      因此刷新页面、跨页跳转都能恢复同一任务。
   3. 五层数据严格分开存储，互不覆盖：
        基础单词 words            （词库资源）
        学员单词状态 studentWordStates（学员档案）
        莱特纳状态 leitnerStates   （盒子）
        21 天计划 plans21 + plan21Tasks + plan21Records
        训练过程 trainTasks + trainDetails + prescreens
   4. 所有写操作立即持久化，写前置校验（防重复提交、防越权越界）。
   依赖：data.js 中的 DB（仅用于基础人员/商品/课程等既有演示数据）
   ============================================================ */
(function () {
  'use strict';

  var W = typeof window !== 'undefined' ? window : globalThis;
  var KEY = 'ee_proto_store_v2';
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

    return {
      version: 2,
      today: TODAY,
      meta: {
        seq: {
          TR: 0, LT: 0, P21: 0, LS: 20, PR: 0, TD: 0, LO: 0, SW: 40, P21R: 400
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
        if (o && o.version === 2) { db = o; return db; }
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

  /** 记录一次单词判断（强化训练阶段） */
  function trainJudge(taskId, wordId, result, mode, groupIndex) {
    var t = trainTask(taskId);
    if (!t) throw new Error('任务不存在');
    if (t.status !== '强化训练中') throw new Error('任务不在强化训练阶段');
    var at = stamp();
    t.results[wordId] = { result: result, mode: mode || t.mode, groupIndex: groupIndex, at: at, corrected: false };
    db.trainDetails.push({
      id: 'TD' + seq('TD', 4),
      taskId: taskId, studentId: t.studentId, wordId: wordId,
      groupIndex: groupIndex, mode: mode || t.mode, round: 1,
      result: result, at: at, teacherId: t.teacherId, correction: false
    });
    setWordState(t.studentId, wordId, '待最后复习', { lastTrainAt: at, lastTaskId: taskId });
    save();
    return t;
  }

  /**
   * 误判修正：追加一条新记录，不覆盖原始记录（PRD 11.9）
   */
  function trainCorrect(taskId, wordId, result, note, groupIndex) {
    var t = trainTask(taskId);
    if (!t) throw new Error('任务不存在');
    var old = t.results[wordId];
    if (!old) throw new Error('该单词尚无判断记录');
    var at = stamp();
    var round = detailsOf(taskId).filter(function (d) { return d.wordId === wordId; }).length + 1;
    db.trainDetails.push({
      id: 'TD' + seq('TD', 4),
      taskId: taskId, studentId: t.studentId, wordId: wordId,
      groupIndex: groupIndex === undefined ? old.groupIndex : groupIndex,
      mode: old.mode, round: round,
      result: result, at: at, teacherId: t.teacherId,
      correction: true, correctionFrom: old.result, correctionNote: note || ''
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
    if (!t) return null;
    t.status = '已中断';
    t.interruptReason = reason || '';
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
    if (!t) return null;
    t.status = '已取消';
    t.finishedAt = stamp();
    save();
    return t;
  }

  /** 进入最后一轮复习 */
  function toFinalStage(taskId) {
    var t = trainTask(taskId);
    if (!t) return null;
    var missing = (t.queueWordIds || []).filter(function (id) { return !t.results[id]; });
    if (missing.length) return { ok: false, missing: missing };
    t.status = '最后一轮复习中';
    t.finalIndex = 0;
    save();
    return { ok: true, task: t };
  }

  function finalJudge(taskId, wordId, result) {
    var t = trainTask(taskId);
    if (!t) throw new Error('任务不存在');
    if (t.status !== '最后一轮复习中') throw new Error('任务不在最后一轮复习阶段');
    t.finalResults[wordId] = { result: result, at: stamp(), correctedFrom: null };
    save();
    return t;
  }

  function finalCorrect(taskId, wordId, result) {
    var t = trainTask(taskId);
    var old = t.finalResults[wordId];
    if (!old) throw new Error('该单词尚无最后复习判断');
    t.finalResults[wordId] = { result: result, at: stamp(), correctedFrom: old.result };
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

  function createLeitnerTask(studentId, wordIds, teacherId, source) {
    var t = {
      id: 'LT' + TODAY.replace(/-/g, '') + seq('LT', 2),
      studentId: studentId,
      teacherId: teacherId || 'T001',
      wordIds: wordIds.slice(),
      boxes: [],
      source: source || '系统推荐',
      createdAt: stamp(),
      status: '进行中',
      completedAt: null,
      stats: null
    };
    wordIds.forEach(function (id) {
      var s = leitnerState(studentId, id);
      if (s && t.boxes.indexOf(s.box) < 0) t.boxes.push(s.box);
    });
    db.leitnerTasks.push(t);
    save();
    return t;
  }

  function leitnerTask(id) {
    return db.leitnerTasks.filter(function (t) { return t.id === id; })[0] || null;
  }

  /**
   * 复习一个单词：记录独立复习记录，并按"当前配置"更新盒状态
   * 注意：只写莱特纳状态，绝不触碰 21 天数据
   */
  function leitnerJudge(taskId, wordId, result, teacherId) {
    var t = leitnerTask(taskId);
    if (!t) throw new Error('复习任务不存在');
    if (t.status !== '进行中') throw new Error('该复习任务已完成');
    var s = leitnerState(t.studentId, wordId);
    if (!s) throw new Error('单词不在莱特纳体系中');

    var from = s.box;
    var to = from, nextDue = s.dueAt;
    var cfg = db.leitnerConfig;

    if (from === 'green') {
      // 绿盒以教师手动管理为主，不按固定间隔自动移动
      to = 'green';
      nextDue = null;
    } else {
      var rule = from === 'red' ? cfg.red : cfg.yellow.filter(function (y) { return y.id === from; })[0];
      if (rule) {
        var target = result === 'yes' ? rule.onCorrect : rule.onWrong;
        if (target === 'graduated') { to = 'graduated'; nextDue = null; }
        else {
          to = target;
          var meta = boxMeta(target);
          var gap = meta && meta.intervalDays ? meta.intervalDays : 1;
          nextDue = addDays(TODAY, gap);
        }
      }
    }

    s.box = to;
    s.dueAt = nextDue;
    s.lastReviewAt = stamp();
    s.lastResult = result === 'yes' ? '认识' : result === 'mid' ? '暂不确定' : '不认识';
    s.manualToday = false;

    db.leitnerRecords.push({
      id: 'LR' + seq('LR', 4),
      taskId: taskId, studentId: t.studentId, wordId: wordId,
      boxFrom: from, boxTo: to, result: result, nextDue: nextDue,
      at: stamp(), teacherId: teacherId || t.teacherId, applyMode: '按配置'
    });

    // 学员单词档案同步（只反映"待复习/本次通过"，不改变 21 天）
    setWordState(t.studentId, wordId,
      result === 'yes' ? '本次通过' : result === 'mid' ? '暂不确定' : '待复习',
      { note: '莱特纳 ' + boxName(to) });

    save();
    return { from: from, to: to, nextDue: nextDue };
  }

  function finishLeitnerTask(taskId, teacherId) {
    var t = leitnerTask(taskId);
    if (!t) return null;
    var recs = db.leitnerRecords.filter(function (r) { return r.taskId === taskId; });
    t.status = '已完成';
    t.completedAt = stamp();
    t.stats = {
      total: t.wordIds.length,
      done: recs.length,
      yes: recs.filter(function (r) { return r.result === 'yes'; }).length,
      no: recs.filter(function (r) { return r.result === 'no'; }).length,
      mid: recs.filter(function (r) { return r.result === 'mid'; }).length
    };
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

  function plan21Progress(plan) {
    var tasks = plan21Tasks(plan.id);
    var elapsed = tasks.filter(function (t) { return t.date <= TODAY && t.wordIds.length; });
    var totalWords = elapsed.reduce(function (n, t) { return n + t.wordIds.length; }, 0);
    var doneWords = 0;
    elapsed.forEach(function (t) {
      doneWords += plan21Records(plan.id).filter(function (r) { return r.taskId === t.id; }).length;
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
      todayDone: todayTask ? plan21Records(plan.id).filter(function (r) { return r.taskId === todayTask.id; }).length : 0,
      currentDay: (function () {
        var t = tasks.filter(function (x) { return x.date === TODAY; })[0];
        if (t) return t.day;
        var past = tasks.filter(function (x) { return x.date < TODAY; });
        return past.length ? past[past.length - 1].day : 1;
      })()
    };
  }

  /** 创建计划：按配置生成 21 天时间轴，每个计划拥有独立单词清单 */
  function create21Plan(opt) {
    var cfg = db.config.plan21Strategy;
    var ids = opt.wordIds.slice();
    var start = opt.startDate || TODAY;
    var plan = {
      id: 'PN' + start.replace(/-/g, '') + seq('P21', 2),
      studentId: opt.studentId,
      name: opt.name || (opt.studentId + ' 记忆计划'),
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
      var list = [];
      for (var k = 0; k < cnt; k++) list.push(ids[(offset + k) % ids.length]);
      db.plan21Tasks.push({
        id: 'P21T' + seq('P21', 4),
        planId: plan.id, day: d, date: date, wordIds: list,
        status: date === TODAY ? 'today' : date < TODAY ? 'plan' : 'plan',
        completedAt: null, teacherId: opt.by || 'T001'
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

  function plan21Judge(taskId, wordId, result, teacherId) {
    var t = plan21Task(taskId);
    if (!t) throw new Error('任务不存在');
    var plan = plan21(t.planId);
    if (!plan) throw new Error('计划不存在');
    var at = stamp();
    var round = plan21Records(t.planId, wordId).length + 1;
    db.plan21Records.push({
      id: 'P21R' + seq('P21R', 4),
      taskId: taskId, planId: t.planId, studentId: plan.studentId,
      wordId: wordId, day: t.day, result: result, at: at,
      teacherId: teacherId || 'T001', round: round
    });
    // 只更新计划节点状态，绝不触碰莱特纳
    var done = plan21Records(t.planId).filter(function (r) { return r.taskId === taskId; }).length;
    if (done >= t.wordIds.length) {
      t.status = 'done';
      t.completedAt = at;
    } else {
      t.status = 'today';
    }
    save();
    return t;
  }

  function finish21Task(taskId) {
    var t = plan21Task(taskId);
    if (!t) return null;
    var done = plan21Records(t.planId).filter(function (r) { return r.taskId === taskId; }).length;
    t.status = done >= t.wordIds.length ? 'done' : (t.date < TODAY ? 'miss' : 'today');
    t.completedAt = stamp();
    save();
    return t;
  }

  /* ---------------- 训练收尾：加入复习体系 ---------------- */
  /**
   * @param {string} taskId
   * @param {{joinLeitner:boolean, joinPlan21:boolean, joinGreen:boolean, by?:string}} opt
   */
  function completeTask(taskId, opt) {
    var t = trainTask(taskId);
    if (!t) throw new Error('任务不存在');
    if (t.submitted || t.status === '已完成') {
      return { ok: false, reason: '该训练任务已提交，不能重复提交' };
    }
    var unanswered = (t.queueWordIds || []).filter(function (id) { return !t.finalResults[id]; });
    if (unanswered.length) {
      return { ok: false, reason: '还有 ' + unanswered.length + ' 个单词未做最后复习判断' };
    }

    t.submitted = true;
    t.status = '已完成';
    t.finishedAt = stamp();

    var pass = [], review = [], mid = [];
    t.queueWordIds.forEach(function (id) {
      var r = t.finalResults[id].result;
      if (r === 'yes') { pass.push(id); setWordState(t.studentId, id, '本次通过', { lastTaskId: taskId, note: '最后复习通过' }); }
      else if (r === 'mid') { mid.push(id); setWordState(t.studentId, id, '暂不确定', { lastTaskId: taskId, note: '最后复习暂不确定' }); }
      else { review.push(id); setWordState(t.studentId, id, '待复习', { lastTaskId: taskId, note: '最后复习不认识' }); }
    });

    // 需要复习的单词 = 不认识 + 暂不确定（PRD 11.7），通过的单词不加入
    var need = review.concat(mid);
    t.joins = { leitner: [], plan21: [], planIds: [], green: [] };

    if (opt.joinLeitner) {
      need.forEach(function (id) {
        var s = leitnerState(t.studentId, id);
        if (s) {
          // 已在体系中：绿盒由教师手动管理，只加到今日复习；其余回到红盒重新开始
          if (s.box === 'green') { s.manualToday = true; }
          else if (s.box !== 'graduated') { s.box = 'red'; s.dueAt = TODAY; s.lastResult = '待复习'; }
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
      var plan = create21Plan({
        studentId: t.studentId,
        name: (t.finishedAt || TODAY).slice(5, 10).replace('-', '/') + ' 训练加入 · ' + (t.wordbookName || '词库'),
        startDate: TODAY,
        wordIds: need,
        by: opt.by || '李婉',
        note: '来源训练任务 ' + t.id
      });
      t.joins.plan21 = need.slice();
      t.joins.planIds = [plan.id];
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
      pass: pass.length, review: review.length, mid: mid.length,
      need: need.length,
      joins: t.joins
    };
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
    pauseTask: pauseTask, resumeTask: resumeTask, endTask: endTask, cancelTask: cancelTask,
    toFinalStage: toFinalStage, finalJudge: finalJudge, finalCorrect: finalCorrect,
    completeTask: completeTask,
    /* 莱特纳 */
    leitnerConfig: leitnerConfig, boxMeta: boxMeta, boxName: boxName,
    leitnerStates: leitnerStates, leitnerState: leitnerState, leitnerBoxWords: leitnerBoxWords,
    leitnerDue: leitnerDue, isDue: isDue, leitnerOps: leitnerOps,
    addToGreen: addToGreen, removeFromGreen: removeFromGreen, moveBox: moveBox,
    createLeitnerTask: createLeitnerTask, leitnerTask: leitnerTask,
    leitnerJudge: leitnerJudge, finishLeitnerTask: finishLeitnerTask,
    leitnerRecordsOf: leitnerRecordsOf, leitnerTasksOf: leitnerTasksOf,
    /* 21 天 */
    plansOf: plansOf, plan21: plan21, plan21Tasks: plan21Tasks, plan21Task: plan21Task,
    plan21Today: plan21Today, plan21Records: plan21Records, plan21Progress: plan21Progress,
    create21Plan: create21Plan, plan21Judge: plan21Judge, finish21Task: finish21Task,
    /* 统计 */
    stats: stats,
    /* 工具 */
    addDays: addDays, stamp: stamp, clone: clone
  };

  load();
  W.Store = Store;
})();
