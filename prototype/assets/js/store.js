/* ============================================================
   统一模拟数据层 Store
   ------------------------------------------------------------
   第一轮：建立学习域唯一数据源。
   第二轮：加固业务完整性（judge/correct 分离、唯一 wordId 计数）。
   第三轮（本版）从「功能闭环」转向「课程闭环」，原则：
     1. 课程是所有教学行为的上下文：每条判断记录都归属到当时那节课。
     2. 任务型对象只用一套状态词表：未开始 / 进行中 / 已完成 / 已中断 / 已取消。
        模块内阶段（预筛选、强化训练、最后复习）放在 phase，不再混进 status。
     3. 聚合层 courseRecords 只存「关联 + 汇总快照」，不复制教学明细。
     4. 课程状态与教学报告状态完全分离，报告未发布家长不可见。
   分层存储（互不覆盖）：
     基础单词 words / 词库 wordbooks / 关系 wordbookWords
     学员状态 studentWordStates
     莱特纳 leitnerStates + leitnerConfig + leitnerTasks + leitnerRecords + leitnerOps
     21 天 plans21 + plan21Tasks + plan21Records
     训练 trainTasks + trainDetails + prescreens
     文章训练 articleTasks + articleTaskDetails
     课程 courses + courseRecords + reports
     财务 flows + accounts + flowReversals
     家长辅助 familyChecks（不改变正式学习状态）
   依赖：data.js 中的 DB（人员/商品/课程/词库资源等基础演示数据）
   ============================================================ */
(function () {
  'use strict';

  var W = typeof window !== 'undefined' ? window : globalThis;
  var KEY = 'ee_proto_store_v4';
  var VERSION = 4;
  var TODAY = '2026-11-02';

  /* ---------------- 统一状态词表 ----------------
     所有「任务型对象」（训练任务 / 莱特纳任务 / 21 天节点 / 文章训练 / 课程）
     共用这五个状态，禁止再用布尔字段拼凑业务状态
     （例如 已完成 + interrupted:true 这种自相矛盾的组合）。
     模块内部的阶段（预筛选 / 强化训练 / 最后复习）属于 phase，不属于 status。 */
  var STATUS = {
    PENDING: '未开始',
    ACTIVE: '进行中',
    DONE: '已完成',
    INTERRUPTED: '已中断',
    CANCELLED: '已取消'
  };
  var STATUS_TONE = {
    '未开始': 'slate', '进行中': 'blue', '已完成': 'green', '已中断': 'amber', '已取消': 'red'
  };
  /** 允许继续操作的状态（未开始 / 进行中 / 已中断可恢复） */
  var OPEN_STATUS = [STATUS.PENDING, STATUS.ACTIVE, STATUS.INTERRUPTED];
  function isActive(s) { return s === STATUS.ACTIVE; }
  function isOpen(s) { return OPEN_STATUS.indexOf(s) >= 0; }
  function isDone(s) { return s === STATUS.DONE; }
  function statusTone(s) { return STATUS_TONE[s] || 'slate'; }

  /* 课程状态（与任务状态分开，因为课程有「授课中」这一业务语义） */
  var COURSE_STATUS = {
    PENDING: '待上课', ONGOING: '授课中', DONE: '已完成', MISSED: '未上课', CANCELLED: '已取消'
  };
  /* 教学报告状态：课程完成后不会自动对家长公开 */
  var REPORT_STATUS = {
    NONE: '未生成', DRAFT: '编辑中', SUBMITTED: '已提交', PUBLISHED: '已发布'
  };

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

    /* 11. 课程：从机构域基础数据接管为可写表，此后课程状态由 Store 维护 */
    var courses = clone(B.courses || []);

    /* 12. 课程教学记录（聚合层）：只存关联与完成时汇总快照，不复制教学明细 */
    var courseRecords = [];
    var reports = [];
    var CRS = 0, RPS = 0;

    /* 12.1 一节历史课（10-31 已完成）——记录 + 已发布报告，供家长端查看 */
    (function () {
      var c = courses.filter(function (x) { return x.id === 'C20261031001'; })[0];
      if (!c) return;
      CRS = 1; RPS = 1;
      courseRecords.push({
        id: 'CR20261031001', courseId: c.id,
        studentId: 'S2026001', teacherId: 'T001',
        planStart: c.date + ' ' + c.start, planEnd: c.date + ' ' + c.end,
        actualStart: c.date + ' 19:00', actualEnd: c.date + ' 20:02',
        status: STATUS.DONE,
        links: { trainTaskIds: [], leitnerTaskIds: [], plan21TaskIds: [], articleTaskIds: [] },
        snapshot: {
          courseId: c.id,
          trainWords: 23, trainRecords: 23,
          leitnerWords: 8, leitnerRecords: 8,
          plan21Words: 8, plan21Records: 8,
          articleCount: 1, articleSentences: 8,
          articleMastered: 6, articleWeak: 2,
          mastered: 21, weak: 9, totalActions: 47, empty: false
        },
        unfinishedPolicy: '保留', unfinished: [],
        teacherNote: '本节点读速度提升明显，连读仍需巩固。',
        reportId: 'RP20261101001',
        createdAt: c.date + ' 19:00', updatedAt: c.date + ' 20:02'
      });
      reports.push({
        id: 'RP20261101001', courseId: c.id, recordId: 'CR20261031001',
        studentId: 'S2026001', teacherId: 'T001', courseDate: c.date,
        title: 'Unit 3 词汇 + 短文精读',
        status: REPORT_STATUS.PUBLISHED,
        content: {
          performance: '本节完成 Unit 3 词汇强化 23 个，短文《My First Day at School》8 句跟读。最后复习 8 个词的发音与拼写明显稳定。',
          weak: '第 3、6 句连读不自然；question / answer 的重音位置需再练。',
          next: '下节课先做 8 个待复习单词的莱特纳复习，再进入 Unit 4 新词预筛。'
        },
        createdAt: c.date + ' 20:05', submittedAt: c.date + ' 20:12', publishedAt: c.date + ' 20:15',
        submittedBy: 'T001', publishedBy: 'T001'
      });
    })();

    /* 12.2 今天 09:00 那节课（已完成授课，报告仍在编辑中——家长不可见） */
    (function () {
      var c = courses.filter(function (x) { return x.id === 'C20261102001'; })[0];
      if (!c) return;
      CRS++; RPS++;
      courseRecords.push({
        id: 'CR20261102001', courseId: c.id,
        studentId: 'S2026001', teacherId: 'T001',
        planStart: c.date + ' ' + c.start, planEnd: c.date + ' ' + c.end,
        actualStart: c.date + ' 09:00', actualEnd: c.date + ' 10:05',
        status: STATUS.DONE,
        links: { trainTaskIds: [], leitnerTaskIds: [], plan21TaskIds: [], articleTaskIds: [] },
        snapshot: {
          courseId: c.id,
          trainWords: 14, trainRecords: 14,
          leitnerWords: 6, leitnerRecords: 6,
          plan21Words: 0, plan21Records: 0,
          articleCount: 0, articleSentences: 0,
          articleMastered: 0, articleWeak: 0,
          mastered: 11, weak: 3, totalActions: 20, empty: false
        },
        unfinishedPolicy: '保留', unfinished: [],
        teacherNote: '本节课按计划完成，family / question 两个词反复出错。',
        reportId: 'RP20261102001',
        createdAt: c.date + ' 09:00', updatedAt: c.date + ' 10:05'
      });
      reports.push({
        id: 'RP20261102001', courseId: c.id, recordId: 'CR20261102001',
        studentId: 'S2026001', teacherId: 'T001', courseDate: c.date,
        title: 'Unit 1 词汇强化（第 2 轮）',
        status: REPORT_STATUS.DRAFT,
        content: { performance: '', weak: '', next: '' },
        createdAt: c.date + ' 10:06', submittedAt: null, publishedAt: null,
        submittedBy: '', publishedBy: ''
      });
    })();

    return {
      version: VERSION,
      today: TODAY,
      meta: {
        seq: {
          TR: 0, LT: 0, P21: 0, LS: 20, PR: 0, TD: 0, LO: 0, SW: 40, P21R: 400,
          AT: ATS, ATD: 0, FV: 0, FC: 0, CR: CRS, RP: RPS
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
      courses: courses,
      courseRecords: courseRecords,
      reports: reports,
      flows: flows,
      accounts: accounts,
      flowReversals: [],
      familyChecks: [],
      config: config
    };
  }

  /* ---------------- 数据规范化 ----------------
     把任何来源的旧状态收敛到统一词表。buildSeed 与 load 都会跑一遍，
     保证「内存里不存在第二套状态语义」。
     旧 → 新 映射：
       预筛选中 / 强化训练中 / 最后一轮复习中 → 进行中 + phase
       提前结束 → 已中断（原因保留在 endReason）
       已完成 + interrupted:true → 已中断（布尔字段直接丢弃）
       21 天 today / plan / miss / rest → status + dateState 两个独立维度 */
  function normalizeDb(d) {
    d.courses = d.courses || [];
    d.courseRecords = d.courseRecords || [];
    d.reports = d.reports || [];
    d.meta = d.meta || { seq: {} };
    d.meta.seq = d.meta.seq || {};

    var stuByName = {}, teaByName = {};
    (d.students || []).forEach(function (s) { stuByName[s.name] = s.id; });
    (d.teachers || []).forEach(function (t) { teaByName[t.name] = t.id; });

    /* 课程 */
    d.courses.forEach(function (c) {
      c.studentId = c.studentId || stuByName[c.student] || '';
      c.teacherId = c.teacherId || teaByName[c.teacher] || '';
      if (c.status === '待处理') {          // 旧语义：扣课异常，本质是「课上完了但课时没扣成」
        c.status = COURSE_STATUS.DONE;
        c.deductState = '扣课异常';
      }
      if (!c.deductState) c.deductState = c.deduct === '已扣课' ? '已扣课' : '未扣课';
      if (c.status === '未上课') c.deductState = '未扣课';
      if (c.status === '已取消') c.deductState = '未扣课';
      c.recordId = c.recordId || '';
    });

    /* 训练任务 */
    (d.trainTasks || []).forEach(function (t) {
      var legacy = t.status;
      if (legacy === '预筛选中') { t.status = STATUS.PENDING; t.phase = '预筛选'; }
      else if (legacy === '强化训练中') { t.status = STATUS.ACTIVE; t.phase = '强化训练'; }
      else if (legacy === '最后一轮复习中') { t.status = STATUS.ACTIVE; t.phase = '最后复习'; }
      else if (legacy === '已中断') { t.status = STATUS.INTERRUPTED; t.phase = t.phase || '强化训练'; }
      else if (legacy === '已取消') { t.status = STATUS.CANCELLED; t.phase = t.phase || '强化训练'; }
      else if (legacy === '已完成') { t.status = STATUS.DONE; t.phase = '已提交'; }
      if (!t.phase) t.phase = '预筛选';
      if (!t.status) t.status = STATUS.PENDING;
      delete t.submitted;                    // 由 status 表达，不再保留布尔
      t.courseId = t.courseId || '';
    });

    /* 莱特纳任务 */
    (d.leitnerTasks || []).forEach(function (t) {
      if (t.status === '已完成' && t.interrupted) t.status = STATUS.INTERRUPTED;
      if (!t.status || t.status === '进行中') t.status = t.completedAt ? STATUS.DONE : STATUS.ACTIVE;
      if (t.status === '未完成') t.status = STATUS.ACTIVE;
      delete t.interrupted;                  // 禁止用布尔字段拼凑业务状态
      t.courseId = t.courseId || '';
    });

    /* 21 天节点：status 是生命周期，dateState 是排期，两者不再混用 */
    (d.plan21Tasks || []).forEach(function (t) {
      var doneIds = {};
      (d.plan21Records || []).forEach(function (r) {
        if (r.taskId === t.id) doneIds[r.wordId] = 1;
      });
      var done = Object.keys(doneIds).length;
      var total = (t.wordIds || []).length;
      if (t.status === 'done') t.status = STATUS.DONE;
      else if (t.status === 'rest') t.status = total ? STATUS.PENDING : STATUS.PENDING;
      else if (t.status === 'miss') t.status = done > 0 ? STATUS.INTERRUPTED : STATUS.PENDING;
      else if (t.status === 'today') t.status = done > 0 ? STATUS.ACTIVE : STATUS.PENDING;
      else if (t.status === 'plan') t.status = STATUS.PENDING;
      if (done >= total && total > 0) t.status = STATUS.DONE;
      t.dateState = !total ? '休息'
        : isDone(t.status) ? '已完成'
        : t.date === TODAY ? '今日'
        : t.date < TODAY ? '已逾期'
        : '未到期';
      t.courseId = t.courseId || '';
    });

    /* 文章训练 */
    (d.articleTasks || []).forEach(function (t) {
      if (t.status === '提前结束') t.status = STATUS.INTERRUPTED;
      if (!t.status) t.status = STATUS.ACTIVE;
      t.courseId = t.courseId || '';
      (d.articleTaskDetails || []).forEach(function (x) {
        if (x.taskId !== t.id) return;
        if (x.verdict === undefined) x.verdict = x.teacherConfirm === '通过' ? '掌握' : '';
        x.verdictLog = x.verdictLog || [];
      });
    });

    /* 记录级 courseId：没有归属课程的旧记录保留空串，不做假归属 */
    ['trainDetails', 'leitnerRecords', 'plan21Records', 'prescreens'].forEach(function (k) {
      (d[k] || []).forEach(function (r) { if (r.courseId === undefined) r.courseId = ''; });
    });

    /* 课程记录与报告互指 */
    var SNAP_KEYS = ['trainWords', 'trainRecords', 'leitnerWords', 'leitnerRecords',
      'plan21Words', 'plan21Records', 'articleCount', 'articleSentences',
      'articleMastered', 'articleWeak', 'mastered', 'weak', 'totalActions'];
    d.courseRecords.forEach(function (r) {
      r.links = r.links || { trainTaskIds: [], leitnerTaskIds: [], plan21TaskIds: [], articleTaskIds: [] };
      var c = d.courses.filter(function (x) { return x.id === r.courseId; })[0];
      if (c) c.recordId = r.id;
      if (r.reportId) {
        var rp = d.reports.filter(function (x) { return x.id === r.reportId; })[0];
        if (rp) rp.recordId = r.id;
      }
      /* 旧快照字段不全时补 0，避免页面出现 NaN / undefined */
      if (r.snapshot) {
        SNAP_KEYS.forEach(function (k) {
          if (typeof r.snapshot[k] !== 'number') r.snapshot[k] = 0;
        });
        if (r.snapshot.courseId === undefined) r.snapshot.courseId = r.courseId;
      }
    });

    return d;
  }

  /* ---------------- 载入 / 保存 ---------------- */
  var db = null;

  function load() {
    try {
      var raw = SS.getItem(KEY);
      if (raw) {
        var o = JSON.parse(raw);
        if (o && o.version === VERSION && Array.isArray(o.words) && o.words.length) {
          db = normalizeDb(o);
          return db;
        }
      }
    } catch (e) { /* 损坏则重建 */ }
    db = normalizeDb(buildSeed());
    save();
    return db;
  }

  function save() {
    try { SS.setItem(KEY, JSON.stringify(db)); } catch (e) { /* 容量/权限异常静默 */ }
  }

  function reset() {
    db = normalizeDb(buildSeed());
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
  function trainTask(id) {
    return db.trainTasks.filter(function (t) { return t.id === id; })[0] || null;
  }

  /** 未关闭的任务（未开始 / 进行中 / 已中断可恢复） */
  function activeTask(studentId, bookId) {
    return db.trainTasks.filter(function (t) {
      return t.studentId === studentId
        && isOpen(t.status)
        && (!bookId || t.wordbookId === bookId);
    }).sort(function (a, b) { return a.createdAt < b.createdAt ? 1 : -1; })[0] || null;
  }

  function tasksOf(studentId) {
    return db.trainTasks.filter(function (t) { return t.studentId === studentId; })
      .sort(function (a, b) { return a.createdAt < b.createdAt ? 1 : -1; });
  }

  /**
   * 创建训练任务（进入预筛选阶段）
   * @param {{studentId,teacherId,wordbookId,rangeWordIds?,courseId?}} opt
   */
  function startTrainTask(opt) {
    var bk = wordbook(opt.wordbookId);
    if (!bk) throw new Error('词库不存在');
    if (!bk.hasWords) throw new Error('该词库在原型中未内置单词清单');

    // 同一学员同一词库存在未完成任务时，直接复用，避免出现两个并行任务
    var ex = activeTask(opt.studentId, bk.id);
    if (ex) {
      if (opt.courseId && !ex.courseId) ex.courseId = opt.courseId;
      return ex;
    }

    var ids = opt.rangeWordIds || bk.wordIds.slice();
    var t = {
      id: 'TR' + TODAY.replace(/-/g, '') + seq('TR', 2),
      studentId: opt.studentId,
      teacherId: opt.teacherId || 'T001',
      courseId: opt.courseId || '',
      wordbookId: bk.id,
      wordbookName: bk.name,
      createdAt: stamp(),
      status: STATUS.PENDING,     // 统一状态：已创建但还没有任何教学动作
      phase: '预筛选',             // 模块内阶段（预筛选 / 强化训练 / 最后复习 / 已提交）
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
      joins: { leitner: [], plan21: [], planIds: [], green: [] }
    };
    db.trainTasks.push(t);
    save();
    return t;
  }

  /** 逐词保存预筛选结果（认识 / 不认识 必须显式作答） */
  function prescreenAnswer(taskId, wordId, known) {
    var t = trainTask(taskId);
    if (!t) throw new Error('任务不存在');
    if (t.phase !== '预筛选') throw new Error('当前阶段不允许修改预筛选结果');
    if (isDone(t.status)) throw new Error('任务已提交，不能修改预筛选结果');
    if (t.status === STATUS.CANCELLED) throw new Error('任务已取消，不能继续操作');
    var at = stamp();
    t.prescreen[wordId] = { known: !!known, at: at };
    if (t.status === STATUS.PENDING || t.status === STATUS.INTERRUPTED) t.status = STATUS.ACTIVE;
    // 预筛选记录独立成表（任务级 + 学员级都能追溯）
    db.prescreens.push({
      id: 'PS' + seq('PR', 4),
      taskId: taskId, studentId: t.studentId, wordbookId: t.wordbookId,
      wordId: wordId, known: !!known, at: at, teacherId: t.teacherId,
      courseId: t.courseId || ''
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
    t.status = STATUS.ACTIVE;
    t.phase = '强化训练';
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
   * 校验：任务处于「进行中 + 强化训练」、单词属于本次队列、同任务同词只能一条首次记录
   */
  function trainJudge(taskId, wordId, result, mode, groupIndex, courseId) {
    var t = trainTask(taskId);
    if (!t) fail('训练任务不存在');
    if (isDone(t.status)) fail('任务已提交，不能修改判断结果');
    if (t.status === STATUS.CANCELLED) fail('任务已取消，不能继续操作');
    if (t.status === STATUS.INTERRUPTED) fail('任务已中断，请先恢复训练后再操作');
    if (t.phase !== '强化训练') fail('当前阶段不允许提交强化训练结果（当前：' + t.phase + '）');

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
      courseId: courseId || '',
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
  function trainCorrect(taskId, wordId, result, note, groupIndex, courseId) {
    var t = trainTask(taskId);
    if (!t) fail('训练任务不存在');
    if (isDone(t.status)) fail('任务已提交，不能修改判断结果');
    if (t.status === STATUS.CANCELLED) fail('任务已取消，不能修改判断结果');
    if (t.status === STATUS.INTERRUPTED) fail('任务已中断，请先恢复训练后再修正');
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
      courseId: courseId || '',
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
    if (isDone(t.status)) fail('任务已提交，不能恢复');
    if (t.status === STATUS.CANCELLED) fail('任务已取消，不能恢复');
    t.pausedAt = null;
    t.resumeCount = (t.resumeCount || 0) + 1;
    t.lastResumeAt = stamp();
    if (t.status === STATUS.INTERRUPTED) t.status = STATUS.ACTIVE;  // phase 保持不变
    save();
    return t;
  }

  /**
   * 中途结束
   * 状态改为「已中断」（不再出现「已完成 + interrupted:true」这种自相矛盾的数据），
   * 已产生的记录保留，未完成单词仍为待训练，剩余数量落到 remainWordIds。
   */
  function endTask(taskId, reason, note) {
    var t = trainTask(taskId);
    if (!t) fail('训练任务不存在');
    if (isDone(t.status)) fail('任务已提交，不能再改为中断');
    if (t.status === STATUS.CANCELLED) fail('任务已取消，不能再改为中断');
    if (!isStr(reason) || !reason.trim()) fail('中断训练必须填写原因');
    var stat = trainTaskStat(taskId);
    t.status = STATUS.INTERRUPTED;
    t.interruptReason = reason.trim();
    t.interruptNote = note || '';
    t.finishedAt = stamp();
    t.remainWordIds = stat ? (stat.trainedMissing || []).concat(stat.finalMissing || []).filter(function (v, i, a) {
      return a.indexOf(v) === i;
    }) : [];
    t.endStats = stat ? { queue: stat.queue, trained: stat.trained, finaled: stat.finaled } : null;
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
    if (isDone(t.status)) fail('任务已提交，不能取消');
    if (t.status === STATUS.CANCELLED) fail('任务已取消，不能重复取消');
    t.status = STATUS.CANCELLED;
    t.finishedAt = stamp();
    save();
    return t;
  }

  /** 进入最后一轮复习：必须所有队列单词都完成强化训练判断 */
  function toFinalStage(taskId) {
    var t = trainTask(taskId);
    if (!t) fail('训练任务不存在');
    if (t.status === STATUS.INTERRUPTED) return { ok: false, reason: '任务已中断，请先恢复训练', missing: [] };
    if (isDone(t.status)) return { ok: false, reason: '任务已提交', missing: [] };
    var missing = (t.queueWordIds || []).filter(function (id) { return !trainFirstDetail(taskId, id); });
    if (missing.length) return { ok: false, missing: missing, reason: '还有 ' + missing.length + ' 个单词未完成强化训练判断' };
    t.status = STATUS.ACTIVE;
    t.phase = '最后复习';
    t.finalIndex = 0;
    save();
    return { ok: true, task: t };
  }

  /**
   * 最后一轮复习判断（首次判断专用）
   * 校验：阶段正确、单词属于本次队列、同词不可重复首次判断
   */
  function finalJudge(taskId, wordId, result, courseId) {
    var t = trainTask(taskId);
    if (!t) fail('训练任务不存在');
    if (t.status === STATUS.INTERRUPTED) fail('任务已中断，请先恢复训练后再操作');
    if (t.status === STATUS.CANCELLED) fail('任务已取消，不能继续操作');
    if (isDone(t.status)) fail('任务已提交，不能修改判断结果');
    if (t.phase !== '最后复习') fail('当前阶段不允许提交最后一轮复习结果');
    if ((t.queueWordIds || []).indexOf(wordId) < 0) fail('该单词不属于本次训练队列');
    if (!result || ['yes', 'no', 'mid'].indexOf(result) < 0) fail('判断结果不合法');

    if (t.finalResults[wordId]) {
      fail('该单词已完成最后复习判断，如需修改请使用「修正」');
    }

    // 最后一轮只能处理已通过强化训练的词
    if (!trainFirstDetail(taskId, wordId)) fail('该单词尚未完成强化训练判断，不能进入最后复习');

    t.finalResults[wordId] = {
      result: result, at: stamp(), correctedFrom: null, corrections: 0,
      courseId: courseId || ''
    };
    save();
    return t;
  }

  /** 最后一轮复习修正：必填原因，保留原值 */
  function finalCorrect(taskId, wordId, result, note, courseId) {
    var t = trainTask(taskId);
    if (!t) fail('训练任务不存在');
    if (isDone(t.status)) fail('任务已提交，不能修改判断结果');
    if (t.status === STATUS.INTERRUPTED) fail('任务已中断，请先恢复训练后再修正');
    if (t.phase !== '最后复习') fail('当前阶段不允许修改最后复习结果');
    if (!result || ['yes', 'no', 'mid'].indexOf(result) < 0) fail('修正结果不合法');
    if (!isStr(note) || !note.trim()) fail('修正必须填写原因');
    var old = t.finalResults[wordId];
    if (!old) fail('该单词尚无最后复习判断，请先做首次判断');
    if (old.result === result) fail('修正结果与原结果相同，无需修正');

    t.finalResults[wordId] = {
      result: result, at: stamp(), correctedFrom: old.result,
      corrections: (old.corrections || 0) + 1,
      /* 误判修正继承被修正记录所属的课程，除非显式指定 */
      courseId: courseId || old.courseId || '',
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

  /** 盒子所处阶段序号：红盒 0 → 黄盒 1/2/3 → 绿盒 4 */
  function boxStage(boxId) {
    if (boxId === 'red') return 0;
    var y = db.leitnerConfig.yellow.filter(function (x) { return x.id === boxId; })[0];
    if (y) return y.seq;
    if (boxId === 'green') return db.leitnerConfig.yellow.length + 1;
    return 0;
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
  function leitnerJudge(taskId, wordId, result, teacherId, courseId) {
    var t = leitnerTask(taskId);
    if (!t) fail('复习任务不存在');
    if (isDone(t.status)) fail('该复习任务已完成，不能继续提交');
    if (t.status === STATUS.CANCELLED) fail('该复习任务已取消，不能继续提交');
    if (t.status === STATUS.INTERRUPTED) fail('该复习任务已中断，请先恢复后再操作');
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
      courseId: courseId || '',
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
  function leitnerCorrect(taskId, wordId, result, note, teacherId, courseId) {
    var t = leitnerTask(taskId);
    if (!t) fail('复习任务不存在');
    if (t.status === STATUS.CANCELLED) fail('复习任务已取消，不能修正');
    if (!isStr(note) || !note.trim()) fail('修正必须填写原因');
    if (!isStr(teacherId)) fail('修正必须记录操作教师');
    if (!result || ['yes', 'no', 'mid'].indexOf(result) < 0) fail('修正结果不合法');

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
      courseId: courseId || '',
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

  /**
   * 结束莱特纳复习任务
   * 全部单词判完 → 已完成；还有剩余 → 已中断（记录原因与剩余数量），
   * 不再使用「已完成 + interrupted:true」这种自相矛盾的组合。
   */
  function finishLeitnerTask(taskId, teacherId, opt) {
    opt = opt || {};
    var t = leitnerTask(taskId);
    if (!t) fail('复习任务不存在');
    if (isDone(t.status)) {
      return { ok: false, reason: '该复习任务已完成，不能重复提交', stat: leitnerTaskStat(taskId) };
    }
    if (t.status === STATUS.CANCELLED) {
      return { ok: false, reason: '该复习任务已取消，不能提交', stat: leitnerTaskStat(taskId) };
    }
    var stat = leitnerTaskStat(taskId);
    t.remainWordIds = stat.remainWordIds.slice();
    t.stats = {
      total: stat.total, done: stat.done, records: stat.records,
      yes: stat.yes, no: stat.no, mid: stat.mid, corrections: stat.corrections
    };
    t.completedAt = stamp();
    t.closedBy = teacherId || t.teacherId;
    if (stat.complete) {
      t.status = STATUS.DONE;
      t.interruptReason = '';
    } else {
      if (!isStr(opt.reason) || !opt.reason.trim()) fail('还有 ' + stat.remain + ' 个单词未复习，必须填写中断原因');
      t.status = STATUS.INTERRUPTED;
      t.interruptReason = opt.reason.trim();
    }
    save();
    return { ok: true, task: t, stat: stat, complete: stat.complete };
  }

  /** 恢复中断的莱特纳任务：状态回到进行中，已判记录不变 */
  function resumeLeitnerTask(taskId) {
    var t = leitnerTask(taskId);
    if (!t) fail('复习任务不存在');
    if (t.status !== STATUS.INTERRUPTED) fail('只有已中断的复习任务可以恢复');
    t.status = STATUS.ACTIVE;
    t.interruptReason = '';
    save();
    return t;
  }

  function leitnerTask(id) {
    return db.leitnerTasks.filter(function (t) { return t.id === id; })[0] || null;
  }

  /**
   * 创建莱特纳复习任务
   * 校验：单词必须属于该学员的莱特纳体系；去重；拒绝空任务
   */
  function createLeitnerTask(studentId, wordIds, teacherId, source, courseId) {
    if (!isStr(studentId)) fail('必须指定学员');
    var ids = cleanWordIds(wordIds).filter(function (id) {
      return !!leitnerState(studentId, id);
    });
    if (!ids.length) fail('没有可复习的莱特纳单词，不能创建空任务');

    var t = {
      id: 'LT' + TODAY.replace(/-/g, '') + seq('LT', 2),
      studentId: studentId,
      teacherId: teacherId || 'T001',
      courseId: courseId || '',
      wordIds: ids,
      boxes: [],
      source: source || '系统推荐',
      createdAt: stamp(),
      status: STATUS.ACTIVE,
      completedAt: null,
      interruptReason: '',
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

  /** 节点排期状态（与生命周期 status 分开：一个说「做到哪一步」，一个说「该哪天做」） */
  function nodeDateState(t) {
    var total = (t.wordIds || []).length;
    if (!total) return '休息';
    if (isDone(t.status)) return '已完成';
    if (t.date === TODAY) return '今日';
    if (t.date < TODAY) return '已逾期';
    return '未到期';
  }

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
      status: t.status,
      dateState: t.dateState,
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
        status: STATUS.PENDING,
        dateState: date === TODAY ? '今日' : date < TODAY ? '已逾期' : '未到期',
        courseId: opt.courseId || '',
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
  function plan21Judge(taskId, wordId, result, teacherId, courseId) {
    var t = plan21Task(taskId);
    if (!t) fail('复习节点不存在');
    var plan = plan21(t.planId);
    if (!plan) fail('计划不存在');
    if (!result || ['yes', 'no', 'mid'].indexOf(result) < 0) fail('判断结果不合法');

    if (!t.wordIds || !t.wordIds.length) fail('该节点没有需要复习的单词');
    if (t.wordIds.indexOf(wordId) < 0) fail('该单词不属于本次复习节点，不能提交');

    if (isDone(t.status)) fail('本节点已完成，如需修改请使用「修正」');
    if (t.status === STATUS.CANCELLED) fail('本节点已取消，不能继续提交');
    if (t.dateState === '休息') fail('休息节点不能提交复习结果');
    if (plan.status === '已完成' || plan.status === '已取消') fail('计划已结束，不能继续提交');

    if (plan21FirstRecord(taskId, wordId)) {
      fail('该单词本节点已判断过，如需修改请使用「修正」');
    }

    var at = stamp();
    db.plan21Records.push({
      id: 'P21R' + seq('P21R', 4),
      taskId: taskId, planId: t.planId, studentId: plan.studentId,
      wordId: wordId, day: t.day, result: result, at: at,
      teacherId: teacherId || 'T001', round: 1, correction: false,
      courseId: courseId || ''
    });

    // 节点状态按唯一 wordId 数量重算
    var stat = plan21TaskStat(taskId);
    if (stat.complete) {
      t.status = STATUS.DONE;
      t.completedAt = at;
      t.remainWordIds = [];
    } else {
      t.status = STATUS.ACTIVE;
      t.completedAt = null;
      t.remainWordIds = stat.remainWordIds;
    }
    t.dateState = nodeDateState(t);
    save();
    return t;
  }

  /**
   * 21 天复习修正（独立接口）
   * 只追加新记录，不删除、不覆盖原始记录；原记录的 result 保持原值
   * @param {string} note 修正原因，必填
   */
  function plan21Correct(taskId, wordId, result, note, teacherId, courseId) {
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
      courseId: courseId || '',
      correction: true, correctionFrom: eff.result,
      originalResult: first.result, correctionNote: note.trim()
    });

    // 修正不改变完成度（唯一 wordId 不变），只刷新节点状态
    var stat = plan21TaskStat(taskId);
    if (stat.complete) { t.status = STATUS.DONE; t.completedAt = t.completedAt || at; t.remainWordIds = []; }
    t.dateState = nodeDateState(t);
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

    if (isDone(t.status) && !opt.reopen) {
      return { ok: false, reason: '本节点已完成，不能重复结束', stat: stat, task: t };
    }
    if (t.status === STATUS.CANCELLED) {
      return { ok: false, reason: '本节点已取消，不能结束', stat: stat, task: t };
    }

    var at = stamp();
    t.remainWordIds = stat.remainWordIds.slice();
    t.finishedAt = at;
    t.closedBy = opt.by || t.teacherId || '';
    if (stat.complete) {
      t.status = STATUS.DONE;
      t.completedAt = t.completedAt || at;
      t.interruptReason = '';
    } else {
      // 未完成即「已中断」：保留剩余单词，逾期与否由 dateState 单独表达
      t.status = STATUS.INTERRUPTED;
      t.completedAt = null;
      t.interruptReason = (opt.reason && opt.reason.trim()) || '本节课程结束，剩余单词下次继续';
    }
    t.dateState = nodeDateState(t);
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
    if (isDone(t.status)) {
      return { ok: false, reason: '该训练任务已提交，不能重复提交' };
    }
    if (t.status === STATUS.CANCELLED) {
      return { ok: false, reason: '任务已取消，不能提交' };
    }
    if (t.status === STATUS.INTERRUPTED) {
      return { ok: false, reason: '任务已中断，请先恢复训练完成后再提交' };
    }
    if (t.phase !== '最后复习') {
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
    t.status = STATUS.DONE;
    t.phase = '已提交';
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
      return t.studentId === studentId && t.articleId === articleId && isActive(t.status);
    }).sort(function (a, b) { return a.startedAt < b.startedAt ? 1 : -1; })[0] || null;
  }

  /** 文章任务统计：跟读完成数 / 教师判定掌握 / 待加强 */
  function articleTaskStat(taskId) {
    var t = articleTask(taskId);
    if (!t) return null;
    var ds = articleTaskDetails(taskId);
    var read = ds.filter(function (d) { return d.readDone; });
    var mastered = ds.filter(function (d) { return d.verdict === '掌握'; });
    var weak = ds.filter(function (d) { return d.verdict === '待加强'; });
    var judged = ds.filter(function (d) { return d.verdict === '掌握' || d.verdict === '待加强'; });
    return {
      taskId: taskId,
      status: t.status,
      total: t.totalSentences,
      done: read.length,          // 已完成跟读（做了什么）
      remain: t.totalSentences - read.length,
      mastered: mastered.length,  // 教师确认掌握（学得怎么样）
      weak: weak.length,
      judged: judged.length,
      unjudged: t.totalSentences - judged.length,
      audioDone: !!t.audioDone,
      complete: read.length >= t.totalSentences && !!t.audioDone
    };
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
      status: STATUS.ACTIVE,
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
        teacherConfirm: '', verdict: '', verdictNote: '', verdictLog: [],
        courseId: t.courseId,
        at: null, teacherId: t.teacherId
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
   * 记录单句操作（播放音频 / 查看中文 / 跟读完成）与教师判定（掌握 / 待加强）
   * 只写文章训练自己的表，绝不触碰单词掌握状态
   * @param {{audioPlayed?,cnViewed?,readDone?,teacherConfirm?,verdict?,verdictNote?,teacherId?}} patch
   */
  function articleSentenceLog(taskId, sentenceId, patch) {
    var t = articleTask(taskId);
    if (!t) fail('文章训练任务不存在');
    if (!isActive(t.status)) fail('该训练已结束，不能继续记录');
    var d = articleDetail(taskId, sentenceId);
    if (!d) fail('该句子不属于本次训练');

    patch = patch || {};
    ['audioPlayed', 'cnViewed', 'readDone'].forEach(function (k) {
      if (patch[k] !== undefined) d[k] = !!patch[k];
    });
    if (patch.teacherConfirm !== undefined) d.teacherConfirm = patch.teacherConfirm;

    /* 教师判定：未训练 / 已练习 / 掌握 / 待加强 —— 只记录判定结果，不改单词档案 */
    if (patch.verdict !== undefined) {
      if (['', '掌握', '待加强'].indexOf(patch.verdict) < 0) fail('教师判定只能是「掌握」或「待加强」');
      if (patch.verdict && d.verdict !== patch.verdict) {
        d.verdictLog = d.verdictLog || [];
        d.verdictLog.push({
          from: d.verdict || '未判定', to: patch.verdict,
          note: (patch.verdictNote || '').trim(), at: stamp(),
          by: patch.teacherId || t.teacherId
        });
      }
      d.verdict = patch.verdict;
    }
    if (patch.verdictNote !== undefined) d.verdictNote = patch.verdictNote;
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
    if (!isActive(t.status)) fail('该训练已结束，不能修改');
    t.audioDone = !!done;
    save();
    return t;
  }

  /**
   * 保存/结束文章训练
   * 全部句子跟读完 + 完整音频完成 → 已完成；否则 → 已中断（原因必填），
   * 已记录句子保留，未完成句子保持未完成，不静默补齐。
   */
  function finishArticleTask(taskId, opt) {
    opt = opt || {};
    var t = articleTask(taskId);
    if (!t) fail('文章训练任务不存在');
    if (!isActive(t.status)) {
      return { ok: false, reason: '该文章训练已结束，不能重复提交', task: t };
    }
    var stat = articleTaskStat(taskId);
    t.doneSentences = stat.done;
    t.evaluation = opt.evaluation || t.evaluation || '';
    t.note = opt.note || t.note || '';
    t.finishedAt = stamp();
    t.closedBy = opt.by || t.teacherId || '';
    t.endReason = opt.endReason || '';
    if (stat.complete) {
      t.status = STATUS.DONE;
    } else {
      if (!isStr(t.endReason) || !t.endReason.trim()) fail('还有 ' + stat.remain + ' 句未完成，必须填写结束原因');
      t.status = STATUS.INTERRUPTED;
    }
    save();
    return {
      ok: true, task: t,
      total: t.totalSentences, done: t.doneSentences,
      remain: t.totalSentences - t.doneSentences,
      mastered: stat.mastered, weak: stat.weak,
      complete: stat.complete
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

  /* ---------------- 课程：教师端所有教学行为的上下文 ---------------- */
  function courses() { return db.courses; }
  function course(id) { return db.courses.filter(function (c) { return c.id === id; })[0] || null; }
  function coursesOf(studentId) {
    return db.courses.filter(function (c) { return c.studentId === studentId; })
      .sort(function (a, b) { return (a.date + a.start) < (b.date + b.start) ? 1 : -1; });
  }
  function coursesOfTeacher(teacherId, date) {
    return db.courses.filter(function (c) {
      return (!teacherId || c.teacherId === teacherId) && (!date || c.date === date);
    }).sort(function (a, b) { return a.start < b.start ? -1 : 1; });
  }
  function courseStat(teacherId, date) {
    var list = coursesOfTeacher(teacherId, date);
    var by = {};
    list.forEach(function (c) { by[c.status] = (by[c.status] || 0) + 1; });
    return {
      total: list.length, by: by,
      done: by[COURSE_STATUS.DONE] || 0,
      pending: by[COURSE_STATUS.PENDING] || 0,
      ongoing: by[COURSE_STATUS.ONGOING] || 0
    };
  }

  function courseRecord(recordId) {
    return db.courseRecords.filter(function (r) { return r.id === recordId; })[0] || null;
  }
  function recordOfCourse(courseId) {
    return db.courseRecords.filter(function (r) { return r.courseId === courseId; })[0] || null;
  }
  function recordsOfTeacher(teacherId) {
    return db.courseRecords.filter(function (r) { return r.teacherId === teacherId; })
      .sort(function (a, b) { return a.planStart < b.planStart ? 1 : -1; });
  }

  /**
   * 进入课程工作台：课程从「待上课」变为「授课中」，同时建立（或复用）课程教学记录
   * 进入课堂本身不扣课时——扣课时发生在完成课程时
   */
  function openCourse(courseId, opt) {
    opt = opt || {};
    var c = course(courseId);
    if (!c) fail('课程不存在');
    if (c.status === COURSE_STATUS.CANCELLED) fail('该课程已取消，不能进入');
    if (c.status === COURSE_STATUS.MISSED) fail('该课程标记为未上课，不能进入授课');
    if (c.status === COURSE_STATUS.DONE && !opt.allowDone) {
      var done = recordOfCourse(courseId);
      return { ok: false, reason: '本节课已完成', course: c, record: done, report: done ? report(done.reportId) : null };
    }

    if (c.status === COURSE_STATUS.PENDING) {
      c.status = COURSE_STATUS.ONGOING;
      c.actualStart = stamp();
    }

    var r = recordOfCourse(courseId);
    if (!r) {
      r = {
        id: 'CR' + courseId.replace(/\D/g, '').slice(0, 8) + seq('CR', 2),
        courseId: c.id, studentId: c.studentId, teacherId: c.teacherId,
        planStart: c.date + ' ' + c.start, planEnd: c.date + ' ' + c.end,
        actualStart: c.actualStart || stamp(), actualEnd: null,
        status: STATUS.ACTIVE,
        links: { trainTaskIds: [], leitnerTaskIds: [], plan21TaskIds: [], articleTaskIds: [] },
        snapshot: null, unfinishedPolicy: '', unfinished: [],
        teacherNote: '', reportId: '',
        createdAt: stamp(), updatedAt: stamp()
      };
      db.courseRecords.push(r);
      c.recordId = r.id;
    }
    save();
    return { ok: true, course: c, record: r, report: r.reportId ? report(r.reportId) : null };
  }

  /** 关联教学任务到本节课（同一任务只关联一次） */
  function linkTask(courseId, kind, taskId) {
    var r = recordOfCourse(courseId);
    if (!r || !taskId) return null;
    var key = kind === 'train' ? 'trainTaskIds'
      : kind === 'leitner' ? 'leitnerTaskIds'
      : kind === 'plan21' ? 'plan21TaskIds' : 'articleTaskIds';
    r.links[key] = r.links[key] || [];
    if (r.links[key].indexOf(taskId) < 0) r.links[key].push(taskId);
    r.updatedAt = stamp();
    save();
    return r;
  }

  /**
   * 本节课教学记录汇总（实时计算，不落库）
   * 依据是每条判断记录上的 courseId —— 任务可以跨课继续，但记录归属于当时那节课
   */
  function recordSummary(recordOrId) {
    var r = typeof recordOrId === 'string' ? courseRecord(recordOrId) : recordOrId;
    if (!r) return null;
    var cid = r.courseId;

    var td = db.trainDetails.filter(function (d) { return d.courseId === cid; });
    var lr = db.leitnerRecords.filter(function (x) { return x.courseId === cid; });
    var pr = db.plan21Records.filter(function (x) { return x.courseId === cid; });
    var at = db.articleTasks.filter(function (x) { return x.courseId === cid; });
    var ads = db.articleTaskDetails.filter(function (x) { return x.courseId === cid; });

    var trainIds = uniqWordIds(td);
    var leitnerIds = uniqWordIds(lr);
    var planIds = uniqWordIds(pr);

    // 有效结果：同一单词取最后一条判断
    var effL = {}, effP = {};
    lr.forEach(function (x) { effL[x.wordId] = x; });
    pr.forEach(function (x) { effP[x.wordId] = x; });

    var mastered = [], weak = [];
    Object.keys(effL).forEach(function (id) { (effL[id].result === 'yes' ? mastered : weak).push(id); });
    Object.keys(effP).forEach(function (id) {
      var v = effP[id].result === 'yes' ? mastered : weak;
      if (v.indexOf(id) < 0) v.push(id);
    });
    ads.forEach(function (d) {
      if (d.verdict === '掌握' && mastered.indexOf(d.sentenceId) < 0) mastered.push(d.sentenceId);
      if (d.verdict === '待加强' && weak.indexOf(d.sentenceId) < 0) weak.push(d.sentenceId);
    });

    return {
      courseId: cid,
      trainWords: trainIds.length,
      trainRecords: td.length,
      leitnerWords: leitnerIds.length,
      leitnerRecords: lr.length,
      plan21Words: planIds.length,
      plan21Records: pr.length,
      articleCount: at.length,
      articleSentences: ads.filter(function (x) { return x.readDone; }).length,
      articleMastered: ads.filter(function (x) { return x.verdict === '掌握'; }).length,
      articleWeak: ads.filter(function (x) { return x.verdict === '待加强'; }).length,
      mastered: mastered.length,
      weak: weak.length,
      totalActions: td.length + lr.length + pr.length + ads.filter(function (x) { return x.readDone; }).length,
      empty: !(td.length || lr.length || pr.length || ads.filter(function (x) { return x.readDone; }).length)
    };
  }

  /**
   * 页面统一口径：课程已完成 → 读完成时的快照（不再随明细变化）
   *               课程进行中 → 实时汇总
   * 避免同一节课在报告页与工作台显示出两套数字。
   */
  function recordView(recordOrId) {
    var r = typeof recordOrId === 'string' ? courseRecord(recordOrId) : recordOrId;
    if (!r) return null;
    if (r.status === STATUS.DONE && r.snapshot) return r.snapshot;
    return recordSummary(r);
  }

  /** 本节课程里还没做完的教学任务 */
  function courseUnfinished(courseId) {
    var c = course(courseId);
    if (!c) return { items: [], total: 0 };
    var items = [];

    db.trainTasks.forEach(function (t) {
      if (t.courseId !== courseId || !isOpen(t.status)) return;
      var s = trainTaskStat(t.id);
      items.push({
        kind: 'train', taskId: t.id, label: '单词训练 · ' + t.wordbookName,
        total: s.queue, done: s.trained, remain: s.queue - s.trained,
        status: t.status, phase: t.phase,
        unit: '个单词', raw: t
      });
    });
    db.leitnerTasks.forEach(function (t) {
      if (t.courseId !== courseId || !isOpen(t.status)) return;
      var s = leitnerTaskStat(t.id);
      items.push({
        kind: 'leitner', taskId: t.id, label: '莱特纳复习',
        total: s.total, done: s.done, remain: s.remain,
        status: t.status, unit: '个单词', raw: t
      });
    });
    db.plan21Tasks.forEach(function (t) {
      if (t.courseId !== courseId || !isOpen(t.status) || !t.wordIds.length) return;
      var s = plan21TaskStat(t.id);
      items.push({
        kind: 'plan21', taskId: t.id, label: '21 天复习 · 第 ' + t.day + ' 天',
        total: s.total, done: s.done, remain: s.remain,
        status: t.status, unit: '个单词', raw: t
      });
    });
    db.articleTasks.forEach(function (t) {
      if (t.courseId !== courseId || !isActive(t.status)) return;
      var s = articleTaskStat(t.id);
      items.push({
        kind: 'article', taskId: t.id, label: '文章训练 · 《' + t.articleName + '》',
        total: s.total, done: s.done, remain: s.remain,
        status: t.status, unit: '句', raw: t
      });
    });

    return { items: items, total: items.length };
  }

  /** 关闭单个未完成任务：结束（保留已做记录）或取消（不再执行） */
  function closeUnfinished(item, policy, reason, by) {
    if (item.kind === 'train') {
      if (policy === '取消') { item.raw.status = STATUS.CANCELLED; item.raw.finishedAt = stamp(); }
      else endTask(item.taskId, reason, '');
    } else if (item.kind === 'leitner') {
      if (policy === '取消') { item.raw.status = STATUS.CANCELLED; item.raw.completedAt = stamp(); }
      else finishLeitnerTask(item.taskId, by, { reason: reason });
    } else if (item.kind === 'plan21') {
      if (policy === '取消') { item.raw.status = STATUS.CANCELLED; item.raw.completedAt = stamp(); }
      else finish21Task(item.taskId, { reason: reason, by: by });
    } else if (item.kind === 'article') {
      if (policy === '取消') { item.raw.status = STATUS.CANCELLED; item.raw.finishedAt = stamp(); }
      else finishArticleTask(item.taskId, { endReason: reason, by: by });
    }
  }

  /** 完成课程时扣 1 课时（余额不足不阻断授课，但标记扣课异常并提示教务） */
  function deductCourse(courseId, by) {
    var c = course(courseId);
    if (!c) fail('课程不存在');
    var stu = student(c.studentId);
    if (!stu) return { ok: false, reason: '课程未关联有效学员，无法扣课' };
    var acc = db.accounts.filter(function (a) { return a.student === stu.name; })[0];
    if (!acc) {
      c.deductState = '扣课异常';
      save();
      return { ok: false, reason: '该学员没有课时账户' };
    }
    if (acc.remain < 1) {
      c.deductState = '扣课异常';
      save();
      return { ok: false, reason: '课时余额不足（剩余 ' + acc.remain + ' 课时），已标记扣课异常' };
    }
    var before = acc.remain;
    acc.remain = before - 1;
    acc.used = (acc.used || 0) + 1;
    var f = {
      id: 'FL' + TODAY.replace(/-/g, '') + ('000' + (db.flows.length + 1)).slice(-3),
      student: stu.name, account: acc.id, type: '正常扣课',
      delta: -1, before: before, after: acc.remain,
      ref: c.id + ' 课程完成', op: by || '系统', time: stamp(),
      note: '课程完成后自动扣课', courseId: c.id
    };
    db.flows.push(f);
    c.deductState = '已扣课';
    c.deduct = '已扣课';
    save();
    return { ok: true, flow: f, account: acc, remaining: acc.remain };
  }

  /**
   * 完成本节课
   * 流程：检测未完成 → 按策略处理 → 写汇总快照 → 扣课时 → 生成教学报告（编辑中）
   * @param {{policy?:'保留'|'结束'|'取消', note?:string, reason?:string, by?:string}} opt
   */
  function finishCourse(courseId, opt) {
    opt = opt || {};
    var c = course(courseId);
    if (!c) fail('课程不存在');

    /* 参数校验先于状态校验：非法入参属于调用方错误，任何状态下都应直接抛出 */
    var policy = opt.policy || '保留';
    if (['保留', '结束', '取消'].indexOf(policy) < 0) fail('未完成内容的处理方式不合法');

    if (c.status === COURSE_STATUS.CANCELLED) return { ok: false, reason: '课程已取消，不能完成' };
    if (c.status === COURSE_STATUS.MISSED) return { ok: false, reason: '课程标记为未上课，不能完成' };
    if (c.status === COURSE_STATUS.DONE) return { ok: false, reason: '本节课已完成，不能重复完成', record: recordOfCourse(courseId) };

    var unf = courseUnfinished(courseId);
    var reason = (opt.reason && opt.reason.trim()) || '本节课程结束';

    if (policy !== '保留') {
      unf.items.forEach(function (it) { closeUnfinished(it, policy, reason, opt.by || c.teacher || '教师'); });
    }

    var r = recordOfCourse(courseId);
    if (!r) {
      r = openCourse(courseId, { allowDone: true }).record;
    }
    r.status = STATUS.DONE;
    r.actualEnd = stamp();
    r.unfinishedPolicy = policy;
    r.unfinished = unf.items.map(function (it) {
      var s = null;
      if (it.kind === 'train') s = trainTaskStat(it.taskId);
      else if (it.kind === 'leitner') s = leitnerTaskStat(it.taskId);
      else if (it.kind === 'plan21') s = plan21TaskStat(it.taskId);
      else s = articleTaskStat(it.taskId);
      return {
        kind: it.kind, taskId: it.taskId, label: it.label,
        total: it.total, done: it.done, remain: it.remain,
        status: it.raw.status
      };
    });
    r.teacherNote = opt.note === undefined ? (r.teacherNote || '') : opt.note;
    r.snapshot = recordSummary(r);
    r.updatedAt = stamp();

    c.status = COURSE_STATUS.DONE;
    c.actualEnd = r.actualEnd;
    c.recordId = r.id;

    var deduct = deductCourse(courseId, opt.by || c.teacher || '系统');

    var rp = report(r.reportId);
    if (!rp) {
      rp = {
        id: 'RP' + courseId.replace(/\D/g, '').slice(0, 8) + seq('RP', 2),
        courseId: c.id, recordId: r.id, studentId: c.studentId, teacherId: c.teacherId,
        courseDate: c.date, title: (c.subject || '本节课程') + ' · ' + c.date,
        status: REPORT_STATUS.DRAFT,
        content: { performance: '', weak: '', next: '' },
        createdAt: stamp(), submittedAt: null, publishedAt: null,
        submittedBy: '', publishedBy: ''
      };
      db.reports.push(rp);
      r.reportId = rp.id;
    }
    save();
    return {
      ok: true, course: c, record: r, report: rp, deduct: deduct,
      unfinished: unf.items, policy: policy,
      warnings: deduct.ok ? [] : [deduct.reason]
    };
  }

  /* ---------------- 教学报告：课程完成后不自动对家长公开 ---------------- */
  function reports() { return db.reports; }
  function report(id) { return db.reports.filter(function (r) { return r.id === id; })[0] || null; }
  function reportOfCourse(courseId) {
    return db.reports.filter(function (r) { return r.courseId === courseId; })[0] || null;
  }
  function reportsOf(studentId) {
    return db.reports.filter(function (r) { return r.studentId === studentId; })
      .sort(function (a, b) { return a.courseDate < b.courseDate ? 1 : -1; });
  }
  /** 家长可见的只有「已发布」 */
  function publishedReportsOf(studentId) {
    return reportsOf(studentId).filter(function (r) { return r.status === REPORT_STATUS.PUBLISHED; });
  }
  function reportStat(teacherId) {
    var list = db.reports.filter(function (r) { return !teacherId || r.teacherId === teacherId; });
    var by = {};
    list.forEach(function (r) { by[r.status] = (by[r.status] || 0) + 1; });
    return { total: list.length, by: by, draft: by[REPORT_STATUS.DRAFT] || 0, submitted: by[REPORT_STATUS.SUBMITTED] || 0, published: by[REPORT_STATUS.PUBLISHED] || 0 };
  }

  function saveReportDraft(reportId, patch, by) {
    var rp = report(reportId);
    if (!rp) fail('报告不存在');
    if (rp.status === REPORT_STATUS.PUBLISHED) fail('报告已发布，不能再修改');
    patch = patch || {};
    ['performance', 'weak', 'next'].forEach(function (k) {
      if (patch[k] !== undefined) rp.content[k] = patch[k];
    });
    if (patch.title !== undefined) rp.title = patch.title;
    rp.updatedAt = stamp();
    rp.updatedBy = by || rp.teacherId;
    save();
    return rp;
  }

  /** 提交报告：课程必须已完成，三段内容不能为空 */
  function submitReport(reportId, by) {
    var rp = report(reportId);
    if (!rp) fail('报告不存在');
    if (rp.status === REPORT_STATUS.PUBLISHED) return { ok: false, reason: '报告已发布，不能重复提交' };
    if (rp.status === REPORT_STATUS.SUBMITTED) return { ok: false, reason: '报告已提交，等待发布', report: rp };
    var c = course(rp.courseId);
    if (!c || c.status !== COURSE_STATUS.DONE) fail('课程尚未完成，不能提交教学报告');

    var miss = [];
    if (!isStr(rp.content.performance) || !rp.content.performance.trim()) miss.push('本节表现');
    if (!isStr(rp.content.weak) || !rp.content.weak.trim()) miss.push('待加强内容');
    if (!isStr(rp.content.next) || !rp.content.next.trim()) miss.push('下节课建议');
    if (miss.length) fail('请先填写：' + miss.join('、'));

    rp.status = REPORT_STATUS.SUBMITTED;
    rp.submittedAt = stamp();
    rp.submittedBy = by || rp.teacherId;
    save();
    return { ok: true, report: rp };
  }

  /** 发布给家长：必须先提交 */
  function publishReport(reportId, by) {
    var rp = report(reportId);
    if (!rp) fail('报告不存在');
    if (rp.status === REPORT_STATUS.PUBLISHED) return { ok: false, reason: '报告已发布', report: rp };
    if (rp.status !== REPORT_STATUS.SUBMITTED) fail('报告尚未提交，不能直接发布');
    rp.status = REPORT_STATUS.PUBLISHED;
    rp.publishedAt = stamp();
    rp.publishedBy = by || rp.teacherId;
    save();
    return { ok: true, report: rp };
  }

  /* ---------------- 复习来源：解释「为什么今天要复习这些词」 ---------------- */
  function leitnerDueDetail(studentId) {
    var items = [], seen = {};
    leitnerStates(studentId).forEach(function (s) {
      if (s.box === 'graduated') return;
      if (seen[s.wordId]) return;
      var group = '', reason = '';
      if (s.box === 'red') {
        group = 'red'; reason = '红盒未掌握，今日必复习';
      } else if (isDue(s)) {
        group = 'yellow'; reason = '达到复习间隔（' + (s.dueAt || '今日') + ' 到期）';
      } else if (s.manualToday) {
        group = 'manual'; reason = '教师手动加入今日复习';
      } else if (s.dueAt && s.dueAt < TODAY) {
        group = 'yellow'; reason = '已逾期（' + s.dueAt + ' 应复习）';
      }
      if (!group) return;
      seen[s.wordId] = 1;
      items.push({
        wordId: s.wordId, group: group, reason: reason,
        box: s.box, boxName: boxName(s.box),
        boxStage: boxStage(s.box),
        dueAt: s.dueAt, lastResult: s.lastResult || ''
      });
    });
    return {
      items: items,
      red: items.filter(function (i) { return i.group === 'red'; }),
      yellow: items.filter(function (i) { return i.group === 'yellow'; }),
      manual: items.filter(function (i) { return i.group === 'manual'; }),
      total: items.length
    };
  }

  function plan21TodaySummary(studentId) {
    var plans = plansOf(studentId).filter(function (p) { return p.status === '进行中'; });
    if (!plans.length) {
      return { hasPlan: false, planId: '', day: 0, due: 0, done: 0, remain: 0, overdueTasks: 0, overdueWords: 0 };
    }
    var plan = plans[0];
    var tasks = plan21Tasks(plan.id);
    var today = tasks.filter(function (t) { return t.date === TODAY && t.wordIds.length; })[0];
    var overdue = tasks.filter(function (t) {
      return t.date < TODAY && t.wordIds.length && !isDone(t.status);
    });
    var prog = plan21Progress(plan);
    var due = today ? today.wordIds.length : 0;
    var done = today ? plan21TaskStat(today.id).done : 0;
    return {
      hasPlan: true, planId: plan.id, planName: plan.name,
      day: prog.currentDay, totalDays: 21,
      due: due, done: done, remain: Math.max(0, due - done),
      todayTaskId: today ? today.id : '',
      overdueTasks: overdue.length,
      overdueWords: overdue.reduce(function (n, t) { return n + plan21TaskStat(t.id).remain; }, 0),
      rate: prog.rate
    };
  }

  /* ---------------- 单词学习全景：先看「现在什么状态」，再看「过去发生了什么」 ---------------- */
  function wordPanorama(studentId, wordId) {
    var w = word(wordId);
    if (!w) return null;
    var st = wordState(studentId, wordId);
    var ls = leitnerState(studentId, wordId);
    var ps = plansOf(studentId).filter(function (p) { return p.status === '进行中'; });
    var inPlan = null;
    ps.forEach(function (p) {
      if (p.wordIds.indexOf(wordId) < 0 || inPlan) return;
      var nodes = plan21Tasks(p.id).filter(function (t) { return t.wordIds.indexOf(wordId) >= 0; });
      var nextNode = nodes.filter(function (t) { return !isDone(t.status) && t.date >= TODAY; })[0]
        || nodes.filter(function (t) { return !isDone(t.status); })[0];
      inPlan = {
        planId: p.id, planName: p.name,
        day: plan21Progress(p).currentDay,
        nodes: nodes.length,
        doneNodes: nodes.filter(function (t) { return isDone(t.status); }).length,
        nextDate: nextNode ? nextNode.date : '',
        nextDay: nextNode ? nextNode.day : 0
      };
    });

    var lastTrain = db.trainDetails.filter(function (d) {
      return d.studentId === studentId && d.wordId === wordId;
    }).sort(function (a, b) { return a.at < b.at ? 1 : -1; })[0] || null;

    /* 时间轴：预筛 → 强化 → 最后复习 → 莱特纳 → 21 天 → 教师调整，统一按时间倒序 */
    var tl = [];
    db.prescreens.filter(function (p) { return p.studentId === studentId && p.wordId === wordId; })
      .forEach(function (p) {
        tl.push({ at: p.at, type: '预筛选', text: p.known ? '预筛选：认识，未进入训练队列' : '预筛选：不认识，进入强化训练', tone: p.known ? 'green' : 'blue' });
      });
    db.trainDetails.filter(function (d) { return d.studentId === studentId && d.wordId === wordId; })
      .forEach(function (d) {
        var label = d.result === 'yes' ? '认识' : d.result === 'mid' ? '暂不确定' : '不认识';
        if (d.correction) {
          tl.push({ at: d.at, type: '强化训练 · 修正', text: '由「' + zh(d.correctionFrom) + '」修正为「' + label + '」，原因：' + (d.correctionNote || '—'), tone: 'amber' });
        } else {
          tl.push({ at: d.at, type: '强化训练', text: '教师判断：' + label, tone: d.result === 'yes' ? 'green' : 'amber' });
        }
      });
    db.trainTasks.filter(function (t) { return t.studentId === studentId; }).forEach(function (t) {
      var r = t.finalResults && t.finalResults[wordId];
      if (!r) return;
      tl.push({ at: r.at, type: '最后复习', text: '教师判断：' + zh(r.result), tone: r.result === 'yes' ? 'green' : 'amber' });
    });
    db.leitnerRecords.filter(function (r) { return r.studentId === studentId && r.wordId === wordId; })
      .forEach(function (r) {
        tl.push({
          at: r.at, type: '莱特纳复习',
          text: (r.correction ? '修正：' : '') + boxName(r.boxFrom) + ' → ' + boxName(r.boxTo) + '（' + zh(r.result) + '）' + (r.correctionNote ? '，原因：' + r.correctionNote : ''),
          tone: r.result === 'yes' ? 'green' : 'amber'
        });
      });
    db.leitnerOps.filter(function (o) { return o.studentId === studentId && o.wordId === wordId; })
      .forEach(function (o) {
        tl.push({ at: o.at || o.time, type: '教师调整', text: o.action + (o.fromBox ? '：' + boxName(o.fromBox) + ' → ' + boxName(o.toBox) : '') + (o.reason ? '，原因：' + o.reason : ''), tone: 'slate' });
      });
    db.plan21Records.filter(function (r) { return r.studentId === studentId && r.wordId === wordId; })
      .forEach(function (r) {
        tl.push({
          at: r.at, type: '21 天 · 第 ' + r.day + ' 天',
          text: (r.correction ? '修正：' : '') + '教师判断：' + zh(r.result) + (r.correctionNote ? '，原因：' + r.correctionNote : ''),
          tone: r.result === 'yes' ? 'green' : 'amber'
        });
      });
    tl.sort(function (a, b) { return a.at < b.at ? 1 : -1; });

    return {
      word: w,
      state: st ? st.state : '未训练',
      note: st ? st.note : '',
      leitner: ls && ls.box !== 'graduated' ? {
        inSystem: true, box: ls.box, boxName: boxName(ls.box),
        stage: boxStage(ls.box),
        dueAt: ls.dueAt, lastResult: ls.lastResult || '',
        overdue: !!(ls.dueAt && ls.dueAt < TODAY)
      } : { inSystem: false },
      plan21: inPlan,
      lastTrain: lastTrain ? {
        at: lastTrain.at, result: lastTrain.result,
        taskId: lastTrain.taskId, corrected: !!lastTrain.correction
      } : null,
      timeline: tl
    };
  }

  function zh(v) { return v === 'yes' ? '认识' : v === 'mid' ? '暂不确定' : '不认识'; }

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
    leitnerConfig: leitnerConfig, boxMeta: boxMeta, boxName: boxName, boxStage: boxStage,
    leitnerStates: leitnerStates, leitnerState: leitnerState, leitnerBoxWords: leitnerBoxWords,
    leitnerDue: leitnerDue, isDue: isDue, leitnerOps: leitnerOps,
    addToGreen: addToGreen, removeFromGreen: removeFromGreen, moveBox: moveBox,
    createLeitnerTask: createLeitnerTask, leitnerTask: leitnerTask,
    leitnerJudge: leitnerJudge, leitnerCorrect: leitnerCorrect, finishLeitnerTask: finishLeitnerTask,
    resumeLeitnerTask: resumeLeitnerTask,
    leitnerTaskStat: leitnerTaskStat, leitnerFirstRecord: leitnerFirstRecord,
    leitnerTaskRecords: leitnerTaskRecords,
    leitnerRecordsOf: leitnerRecordsOf, leitnerTasksOf: leitnerTasksOf,
    leitnerDueDetail: leitnerDueDetail,
    /* 21 天 */
    plansOf: plansOf, plan21: plan21, plan21Tasks: plan21Tasks, plan21Task: plan21Task,
    plan21Today: plan21Today, plan21Records: plan21Records, plan21Progress: plan21Progress,
    plan21TaskRecords: plan21TaskRecords, plan21TaskStat: plan21TaskStat,
    plan21Effective: plan21Effective, plan21FirstRecord: plan21FirstRecord,
    create21Plan: create21Plan, plan21Judge: plan21Judge,
    plan21Correct: plan21Correct, finish21Task: finish21Task,
    plan21TodaySummary: plan21TodaySummary,
    /* 文章训练 */
    articleTask: articleTask, articleTasksOf: articleTasksOf, articleTaskDetails: articleTaskDetails,
    articleActiveTask: articleActiveTask, startArticleTask: startArticleTask,
    articleSentenceLog: articleSentenceLog, setArticleAudioDone: setArticleAudioDone,
    articleDetail: articleDetail,
    finishArticleTask: finishArticleTask, articleTaskStat: articleTaskStat,
    /* 课程与报告 */
    courses: courses, course: course, coursesOf: coursesOf, coursesOfTeacher: coursesOfTeacher,
    courseStat: courseStat, courseRecord: courseRecord, recordOfCourse: recordOfCourse,
    recordsOfTeacher: recordsOfTeacher, openCourse: openCourse, linkTask: linkTask,
    recordSummary: recordSummary, recordView: recordView, courseUnfinished: courseUnfinished,
    finishCourse: finishCourse, deductCourse: deductCourse,
    reports: reports, report: report, reportOfCourse: reportOfCourse, reportsOf: reportsOf,
    publishedReportsOf: publishedReportsOf, reportStat: reportStat,
    saveReportDraft: saveReportDraft, submitReport: submitReport, publishReport: publishReport,
    /* 单词全景 */
    wordPanorama: wordPanorama,
    /* 财务 */
    flows: flows, flow: flow, accounts: accounts, account: account,
    reverseFlow: reverseFlow, reversalsOf: reversalsOf, reversedHours: reversedHours,
    reversibleCheck: reversibleCheck,
    /* 家长端 */
    reviewWords: reviewWords, familyCheck: familyCheck, familyChecksOf: familyChecksOf,
    toggleFamilyCheck: toggleFamilyCheck,
    /* 状态词表 */
    STATUS: STATUS, COURSE_STATUS: COURSE_STATUS, REPORT_STATUS: REPORT_STATUS,
    statusTone: statusTone, isOpen: isOpen, isDone: isDone, isActive: isActive,
    /* 统计 */
    stats: stats,
    /* 工具 */
    addDays: addDays, stamp: stamp, clone: clone,
    cleanWordIds: cleanWordIds, uniqWordCount: uniqWordCount, uniqWordIds: uniqWordIds
  };

  load();
  W.Store = Store;
})();
