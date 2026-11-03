/* ============================================================
   统一模拟数据层 Store
   ------------------------------------------------------------
   第一轮：建立学习域唯一数据源。
   第二轮：加固业务完整性（judge/correct 分离、唯一 wordId 计数）。
   第三轮：从「功能闭环」转向「课程闭环」。
   第六轮（本版）在第五轮教师资源池之上补上「学员接单与教学资源分配」，原则：
     1. 四个环节彼此独立，任何一环都不能用「一个教师 ID 字段」代替整条业务链：
        教师响应（意向）→ 教务确认（人选）→ 管理员分配（正式师生关系）→ 词库申请与授权（资源权限）。
     2. TeacherStudent 仍然是「谁现在负责谁」的唯一事实来源；
        TeacherResponse 只表达接单意向，StudentWordbook 只表达资源授权，两者都不产生师生关系。
     3. 需求状态、响应状态、申请状态、授权状态四套词表互不推导；
        不根据响应数量自动判断需求完成，需求只能被「管理员正式分配」推进到已完成。
     4. 每一步业务动作都写操作流水（只追加），记录责任人、时间、原因与结果；
        确认可以撤销、响应可以撤回、授权可以停用，但不允许删除历史。
     5. 权限在 Store 写操作入口校验：教务不能正式分配，管理员不能确认教师，
        教师只能响应对自己开放的需求、只能为自己负责的学员申请词库。
   第五轮补上「兼职教师全生命周期」，原则：
     1. 教师是机构持续维护的教学资源，不是一次性创建、使用、删除的员工记录：
        档案永不物理删除，退出只是合作状态的一种。
     2. 教师档案与登录账号分离：teachers.accountId ↔ users.teacherId，
        账号状态（未开通/正常/已禁用）不参与教师合作状态判断。
     3. 教师—学员关系独立成表 teacherStudents，是「谁现在负责谁」的唯一事实来源；
        students.teacher / teacherName 只是派生缓存，供旧页面读取。
     4. 合作状态、课程状态、账号状态三套词表互不混用；
        历史课程永不被教师资料变更或改派覆盖。
     5. 教师的每次状态变更都写合作流水 + 资料变更记录，只追加不覆盖。
   第四轮原则（继续有效）补上「资源入库」这一环：
     5. 一份 Excel = 一个词库；批量导入是最主要的词库来源，不是单文件演示。
     6. 词库模型拆成三段：基础单词 words ↔ 关联 wordbookWords ↔ 词库 wordbooks。
        基础单词按英文唯一，跨词库同名单词只增加关联，绝不重复建基础单词。
     7. 词库内排序（seq）、来源文件、原始行号都记在关联上，不写在基础单词上。
     8. 导入以「文件」为原子单位：先算完整计划再一次性写入，失败回滚；
        一个文件失败不影响其他文件已经入库的词库。
     9. 导入永不改写学员学习状态：只补基础单词的空字段，不覆盖已有内容。
   第三轮原则（继续有效）：
     1. 课程是所有教学行为的上下文：每条判断记录都归属到当时那节课。
     2. 任务型对象只用一套状态词表：未开始 / 进行中 / 已完成 / 已中断 / 已取消。
        模块内阶段（预筛选、强化训练、最后复习）放在 phase，不再混进 status。
     3. 聚合层 courseRecords 只存「关联 + 汇总快照」，不复制教学明细。
     4. 课程状态与教学报告状态完全分离，报告未发布家长不可见。
   分层存储（互不覆盖）：
     接单域 学员需求 studentDemands / 教师响应 teacherResponses / 需求流水 studentDemandLogs
     资源授权 词库申请 studentWordbookRequests / 学员词库 studentWordbooks
     教师 teachers / 登录账号 users / 师生关系 teacherStudents
     合作流水 teacherCooperations / 资料变更 teacherChanges
     基础单词 words / 词库 wordbooks / 关联 wordbookWords / 导入批次 importBatches + importJobs
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
  var KEY = 'ee_proto_store_v7';
  var VERSION = 7;
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

  /* ============================================================
     教师域：三套互不混用的状态词表
     ------------------------------------------------------------
     合作状态 = 这个人和机构是什么关系（人事事实）
     账号状态 = 这个人的登录凭证能不能用（系统事实）
     课程状态 = 某一节课进行到哪一步（业务事实）
     三者不允许互相推导：暂停合作不代表课程已取消，
     账号被禁用也不代表合作已结束。
     ============================================================ */
  var COOP = {
    PENDING: '待启用', READY: '可授课', PAUSED: '暂停合作', EXITED: '已退出'
  };
  var COOP_STATUS = [COOP.PENDING, COOP.READY, COOP.PAUSED, COOP.EXITED];
  var COOP_TONE = { '待启用': 'amber', '可授课': 'green', '暂停合作': 'blue', '已退出': 'slate' };

  var ACCOUNT = { NONE: '未开通', OK: '正常', DISABLED: '已禁用' };
  var ACCOUNT_STATUS = [ACCOUNT.NONE, ACCOUNT.OK, ACCOUNT.DISABLED];
  var ACCOUNT_TONE = { '未开通': 'slate', '正常': 'green', '已禁用': 'red' };

  /* 师生关系状态 */
  var REL = { ACTIVE: '当前有效', ENDED: '已结束' };

  /* 合作流水动作：前五个是业务主流程，后三个是账号侧事件 */
  var COOP_ACTION = {
    CREATED: 'CREATED', ACTIVATED: 'ACTIVATED', PAUSED: 'PAUSED',
    RESUMED: 'RESUMED', EXITED: 'EXITED', REJOINED: 'REJOINED',
    ACCOUNT_OPENED: 'ACCOUNT_OPENED', ACCOUNT_ENABLED: 'ACCOUNT_ENABLED',
    ACCOUNT_DISABLED: 'ACCOUNT_DISABLED'
  };
  var COOP_ACTION_LABEL = {
    CREATED: '创建档案', ACTIVATED: '启用为可授课', PAUSED: '暂停合作',
    RESUMED: '恢复合作', EXITED: '正式退出合作', REJOINED: '重新加入',
    ACCOUNT_OPENED: '开通登录账号', ACCOUNT_ENABLED: '恢复登录账号',
    ACCOUNT_DISABLED: '禁用登录账号'
  };

  var TEACHER_GRADES = ['一年级', '二年级', '三年级', '四年级', '五年级',
    '六年级', '七年级', '八年级', '九年级'];
  var TEACHER_TEXTBOOKS = ['人教版', '外研版', '译林版', '北师大版', '沪教牛津版', '其他'];
  var TEACHING_TAGS = ['自然拼读', '词汇', '阅读', '语法', '听说', '写作', '中考冲刺', '低年级启蒙'];
  var WEEKDAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
  var PERIODS = ['上午', '下午', '晚上'];
  var PERIOD_TIME = { '上午': '08:30-11:30', '下午': '13:30-17:30', '晚上': '18:30-21:00' };

  /* 角色与权限：页面隐藏按钮只是体验层，真正拦截在 Store 的每个写操作入口 */
  var PERMS = {
    'teacher.view': ['admin', 'staff', 'ops'],
    'teacher.create': ['admin', 'staff'],
    'teacher.edit': ['admin', 'staff'],
    'teacher.account': ['admin', 'staff', 'ops'],
    'teacher.activate': ['admin', 'staff'],
    'teacher.pause': ['admin', 'staff'],
    'teacher.resume': ['admin', 'staff'],
    'teacher.exit': ['admin', 'staff'],
    'teacher.assign': ['admin', 'staff', 'ops'],
    'teacher.stats': ['admin', 'staff', 'ops'],
    'self.records': ['admin', 'staff', 'ops', 'teacher'],

    /* ---- 学员接单与教学资源分配 ---- */
    'demand.view': ['admin', 'staff', 'ops'],          /* 查看全部需求 */
    'demand.create': ['admin', 'staff'],
    'student.create': ['admin', 'staff'],              /* 新学员先建档，再发需求 */
    'demand.edit': ['admin', 'staff'],
    'demand.publish': ['admin', 'staff'],
    'demand.cancel': ['admin', 'staff'],
    'demand.confirm': ['admin', 'staff'],              /* 教务确认最终教师 */
    'demand.open': ['teacher'],                        /* 教师查看开放给自己的需求 */
    'response.submit': ['teacher'],                    /* 教师响应 / 暂不接单 / 撤回 */
    'response.viewAll': ['admin', 'staff', 'ops'],
    'student.assignFinal': ['admin', 'ops'],           /* 管理员正式分配 */
    'wordbookRequest.create': ['teacher'],
    'wordbookRequest.review': ['admin', 'ops'],
    'studentWordbook.view': ['admin', 'staff', 'ops', 'teacher'],
    'studentWordbook.manage': ['admin', 'ops']
  };
  var ROLE_LABEL = { admin: '老板', staff: '教务负责人', ops: '管理员', teacher: '教师' };
  var session = { role: 'admin', operatorName: '张敏', operatorId: '张敏', teacherId: '' };

  /* ============================================================
     学员接单与教学资源分配：四套状态词表
     ------------------------------------------------------------
     业务流程里的四个环节彼此独立，任何一个都不能用「一个教师 ID 字段」代替：
       1. 教师响应 TeacherResponse —— 表达接单意向（不是师生关系）
       2. 教务确认（写回需求 selectedTeacherId / confirmedBy） —— 决定人选（仍不是师生关系）
       3. 管理员分配（TeacherStudent） —— 正式建立师生负责关系，唯一事实来源
       4. 词库申请与授权（StudentWordbookRequest → StudentWordbook） —— 学员获得的资源权限
     四套词表分开：
       需求 DEMAND / 响应 RESP / 申请 WBR / 授权 SWB
     ============================================================ */
  var DEMAND = {
    DRAFT: '草稿',
    OPEN: '待接单',
    BIDDING: '接单中',
    CONFIRM: '待教务确认',
    ASSIGN: '待管理员分配',
    DONE: '已完成分配',
    CANCELLED: '已取消'
  };
  var DEMAND_STATUS = [DEMAND.DRAFT, DEMAND.OPEN, DEMAND.BIDDING, DEMAND.CONFIRM,
    DEMAND.ASSIGN, DEMAND.DONE, DEMAND.CANCELLED];
  var DEMAND_TONE = {
    '草稿': 'slate', '待接单': 'blue', '接单中': 'amber', '待教务确认': 'purple',
    '待管理员分配': 'cyan', '已完成分配': 'green', '已取消': 'red'
  };
  /* 教师可见（可以响应）的需求状态：只有还没被教务确认掉的公开需求 */
  var DEMAND_OPEN_STATUS = [DEMAND.OPEN, DEMAND.BIDDING];

  var RESP = {
    YES: '已响应',
    NO: '暂不接单',
    WITHDRAWN: '已撤回',
    SELECTED: '已选中',
    NOT_SELECTED: '未选中'
  };
  var RESP_STATUS = [RESP.YES, RESP.NO, RESP.WITHDRAWN, RESP.SELECTED, RESP.NOT_SELECTED];
  var RESP_TONE = {
    '已响应': 'blue', '暂不接单': 'slate', '已撤回': 'amber', '已选中': 'green', '未选中': 'red'
  };
  /* 有效响应 = 仍参与人选的响应（教务确认前可撤回） */
  var RESP_VALID = [RESP.YES, RESP.SELECTED, RESP.NOT_SELECTED];

  var DECLINE_REASONS = ['时间不合适', '年级不匹配', '教材不熟悉', '当前学员数量较多', '其他原因'];

  var WBR = { PENDING: '待审核', APPROVED: '已通过', REJECTED: '已驳回', CANCELLED: '已取消' };
  var WBR_STATUS = [WBR.PENDING, WBR.APPROVED, WBR.REJECTED, WBR.CANCELLED];
  var WBR_TONE = { '待审核': 'amber', '已通过': 'green', '已驳回': 'red', '已取消': 'slate' };

  var SWB = { ACTIVE: '已授权', DISABLED: '已停用' };
  var SWB_STATUS = [SWB.ACTIVE, SWB.DISABLED];
  var SWB_TONE = { '已授权': 'green', '已停用': 'slate' };

  /* 需求操作流水动作（只追加，不修改） */
  var DEMAND_ACTION = {
    CREATED: 'CREATED', PUBLISHED: 'PUBLISHED', WITHDRAWN: 'WITHDRAWN',
    RESPONDED: 'RESPONDED', DECLINED: 'DECLINED', RESPONSE_WITHDRAWN: 'RESPONSE_WITHDRAWN',
    CONFIRM_STARTED: 'CONFIRM_STARTED', CONFIRMED: 'CONFIRMED', CONFIRM_REVOKED: 'CONFIRM_REVOKED',
    ASSIGNED: 'ASSIGNED', CANCELLED: 'CANCELLED', UPDATED: 'UPDATED'
  };
  var DEMAND_ACTION_LABEL = {
    CREATED: '创建需求', PUBLISHED: '发布需求', WITHDRAWN: '撤回发布',
    RESPONDED: '教师响应', DECLINED: '教师暂不接单', RESPONSE_WITHDRAWN: '教师撤回响应',
    CONFIRM_STARTED: '进入教务确认', CONFIRMED: '教务确认教师', CONFIRM_REVOKED: '撤销确认',
    ASSIGNED: '管理员正式分配', CANCELLED: '取消需求', UPDATED: '编辑需求'
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

  /* ---------------- 会话身份持久化 ----------------
     教师端每个页面的「我是谁」只能来自登录会话，不能从 URL 的学员编号反推。
     会话在同标签页内跨页面延续，保证「接单 → 词库申请 → 开始教学」identity 不变。 */
  var SESSION_KEY = 'ee_proto_session_v7';
  /* 只持久化「当前登录教师」这一个身份事实，不持久化角色：
     角色由各页面调用 setSession 显式声明，避免教师会话污染管理端权限判断。 */
  function saveSession() {
    try { SS.setItem(SESSION_KEY, JSON.stringify({ teacherId: session.teacherId || '' })); } catch (e) { /* 静默 */ }
  }
  function restoreSession() {
    try {
      var raw = SS.getItem(SESSION_KEY);
      if (!raw) return;
      var o = JSON.parse(raw);
      if (!o || typeof o !== 'object') return;
      if (o.teacherId) {
        session.teacherId = o.teacherId;
        session.operatorName = session.operatorName || '';
      }
    } catch (e) { /* 损坏则用默认会话 */ }
  }

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

    /* 1. 三段式词库模型：基础单词 words / 词库 wordbooks / 关联 wordbookWords
       一个词库 = 一份来源 Excel。基础单词按英文唯一，同一单词出现在多个词库时
       只建一条基础单词，多出来的只是关联记录（多对多）。 */
    var words = [];
    var wordbooks = [];
    var wordbookWords = [];
    var wordByEn = {};

    function meanOf(w) {
      if (w.mean && w.mean.length) return clone(w.mean);
      var parts = String(w.cn || '').split(/[；;]/)
        .map(function (x) { return x.trim(); })
        .filter(function (x) { return !!x; });
      if (!parts.length) parts = [''];
      return parts.map(function (cn) { return { pos: w.pos || '', cn: cn }; });
    }

    (B.wordbookSeeds || []).forEach(function (b) {
      var at = b.createdAt || '2026-08-20 10:00';
      var wb = {
        id: b.id, name: b.name, category: b.category || '其他',
        bookVersion: b.bookVersion || '', schoolStage: b.schoolStage || '',
        grade: b.grade || '', term: b.term || '', organization: b.organization || '',
        description: b.description || '', sourceFile: b.sourceFile || '',
        wordCount: 0, status: b.status || '启用',
        createdAt: at, updatedAt: at
      };
      (b.words || []).forEach(function (w, i) {
        var en = String(w.en || '').trim();
        if (!en) return;
        var enKey = en.toLowerCase();
        var base = wordByEn[enKey];
        if (!base) {
          base = {
            id: 'w' + pad(words.length + 1, 2),
            en: en, ph: w.ph || '', mean: meanOf(w), pos: w.pos || '',
            audio: w.audio || '', status: '启用',
            createdAt: at, updatedAt: at
          };
          words.push(base);
          wordByEn[enKey] = base;
        }
        wordbookWords.push({
          id: 'WW' + pad(wordbookWords.length + 1, 4),
          wordbookId: wb.id, wordId: base.id, seq: i + 1,
          sourceFile: wb.sourceFile, sourceRow: i + 2, createdAt: at
        });
        wb.wordCount++;
      });
      wordbooks.push(wb);
    });

    function wid(en) {
      var base = wordByEn[String(en).toLowerCase()];
      return base ? base.id : null;
    }
    /* 学员的 21 天计划与单词档案只针对 WB001（其余词库尚未被使用） */
    var wb1Ids = wordbookWords.filter(function (x) { return x.wordbookId === 'WB001'; })
      .sort(function (a, b) { return a.seq - b.seq; })
      .map(function (x) { return x.wordId; });
    var wb1Words = wb1Ids.map(function (id) {
      return words.filter(function (w) { return w.id === id; })[0];
    }).filter(Boolean);

    /* 2. 教师资源池：档案 / 登录账号 / 合作流水 / 师生关系
       账号与档案分开建表：一个老师可能暂时没有账号（待启用），
       也可能账号被禁用了但档案仍然「暂停合作」而不是「已退出」。 */
    var teachers = [];
    var users = [];
    var teacherStudents = [];
    var teacherCooperations = [];
    var teacherChanges = [];

    (B.teachers || []).forEach(function (t) {
      var avail = (t.availability || []).map(function (a, i) {
        return { id: 'TAV' + pad(i + 1, 3), weekday: a.weekday, period: a.period, note: a.note || '' };
      });
      var acc = t.account || null;
      if (acc) {
        users.push({
          id: acc.id, loginName: acc.loginName || t.phone, phone: t.phone,
          passwordHash: '', mustChangePassword: true,
          status: acc.status || ACCOUNT.OK, roleId: acc.roleId || 'teacher',
          teacherId: t.id,
          openedAt: acc.openedAt || '', openedBy: acc.openedBy || '',
          disabledAt: acc.disabledAt || '',
          createdAt: acc.openedAt || t.createdAt, updatedAt: acc.disabledAt || acc.openedAt || t.createdAt
        });
      }
      teachers.push({
        id: t.id, code: t.code || t.id, name: t.name, phone: t.phone,
        gender: t.gender || '', school: t.school || '', major: t.major || '',
        education: t.education || '', introduction: t.introduction || '', remark: t.remark || '',
        grades: (t.grades || []).slice(), textbooks: (t.textbooks || []).slice(),
        teachingTags: (t.teachingTags || []).slice(),
        teachingExperience: t.teachingExperience || '', teachingStyle: t.teachingStyle || '',
        availability: avail,
        cooperationStatus: t.cooperationStatus || COOP.PENDING,
        accountId: acc ? acc.id : '',
        firstCooperationAt: t.firstCooperationAt || '',
        lastCooperationStartAt: t.lastCooperationStartAt || '',
        cooperationEndAt: t.cooperationEndAt || '',
        pauseInfo: t.pauseInfo ? clone(t.pauseInfo) : null,
        rejoinCount: t.rejoinCount || 0,
        createdBy: t.createdBy || '张敏',
        createdAt: t.createdAt || '2026-01-01 09:00',
        updatedAt: t.updatedAt || t.createdAt || '2026-01-01 09:00'
      });
    });

    (B.teacherStudentSeeds || []).forEach(function (r, i) {
      teacherStudents.push({
        id: 'TS' + pad(i + 1, 3),
        teacherId: r.teacherId, studentId: r.studentId,
        startAt: r.startAt || TODAY, endAt: r.endAt || '',
        status: r.endAt ? REL.ENDED : REL.ACTIVE,
        assignReason: r.assignReason || '', endReason: r.endReason || '',
        attention: '', createdBy: r.createdBy || '张敏',
        createdAt: (r.startAt || TODAY) + ' 09:00'
      });
    });

    var coopSeq = 0;
    (B.teachers || []).forEach(function (t) {
      (t.coop || []).forEach(function (c) {
        coopSeq++;
        teacherCooperations.push({
          id: 'TCH' + pad(coopSeq, 3), teacherId: t.id, action: c.action,
          reason: c.reason || '', effectiveAt: c.at || t.createdAt || TODAY,
          operatorId: c.operator || '张敏', operatorName: c.operator || '张敏',
          remark: c.remark || '', createdAt: c.at || t.createdAt || TODAY
        });
      });
    });

    /* 3. 学员接单域：需求 / 响应 / 需求流水 / 词库申请 / 学员词库授权
       这几张表是「意向 → 确认 → 分配 → 授权」四个环节各自的事实来源，
       任何一环都不去改写 TeacherStudent —— 只有正式分配会写关系表。 */
    var demandSeq = 0, respSeq = 0, wbrSeq = 0, swbSeq = 0, dlogSeq = 0;
    var studentDemands = [];
    var teacherResponses = [];
    var studentDemandLogs = [];
    var studentWordbookRequests = [];
    var studentWordbooks = [];

    (B.studentDemandSeeds || []).forEach(function (d) {
      demandSeq++;
      studentDemands.push({
        id: d.id, code: d.code || d.id, studentId: d.studentId,
        grade: d.grade || '', textbook: d.textbook || '',
        learningNeeds: toList(d.learningNeeds),
        currentLevel: d.currentLevel || '',
        expectedSchedule: {
          weekday: toList((d.expectedSchedule || {}).weekday),
          periods: toList((d.expectedSchedule || {}).periods),
          weeklyLessons: (d.expectedSchedule || {}).weeklyLessons || 0
        },
        expectedStartAt: d.expectedStartAt || '',
        specialRequirements: d.specialRequirements || '',
        remark: d.remark || '',
        status: d.status || DEMAND.DRAFT,
        publishedBy: d.publishedBy || '', publishedAt: d.publishedAt || '',
        selectedTeacherId: d.selectedTeacherId || '',
        confirmedBy: d.confirmedBy || '', confirmedAt: d.confirmedAt || '',
        confirmReason: d.confirmReason || '',
        assignedAt: d.assignedAt || '', assignedBy: d.assignedBy || '',
        cancelReason: d.cancelReason || '',
        createdBy: d.publishedBy || '陈静',
        createdAt: d.createdAt || stamp(), updatedAt: d.updatedAt || d.createdAt || stamp()
      });
    });

    (B.teacherResponseSeeds || []).forEach(function (r) {
      respSeq++;
      var d = studentDemands.filter(function (x) { return x.id === r.demandId; })[0];
      var t = (B.teachers || []).filter(function (x) { return x.id === r.teacherId; })[0];
      teacherResponses.push({
        id: 'TRS' + pad(respSeq, 3), demandId: r.demandId, teacherId: r.teacherId,
        status: r.status || RESP.YES,
        remark: r.remark || '', declineReason: r.declineReason || '',
        respondedAt: r.respondedAt || '', withdrawnAt: '', withdrawReason: '',
        createdAt: r.respondedAt || (d ? d.createdAt : stamp()), updatedAt: r.respondedAt || stamp()
      });
      void t;
    });

    (B.studentDemandLogSeeds || []).forEach(function (l) {
      dlogSeq++;
      studentDemandLogs.push({
        id: 'DL' + pad(dlogSeq, 3), demandId: l.demandId, action: l.action,
        detail: l.detail || '', operatorName: l.operator || '系统',
        operatorId: l.operator || '系统', from: '', to: '', at: l.at || stamp(),
        createdAt: l.at || stamp()
      });
    });

    (B.studentWordbookRequestSeeds || []).forEach(function (r) {
      wbrSeq++;
      studentWordbookRequests.push({
        id: r.id, studentId: r.studentId, teacherId: r.teacherId, wordbookId: r.wordbookId,
        reason: r.reason || '', plan: r.plan || '', status: r.status || WBR.PENDING,
        requestedAt: r.requestedAt || stamp(),
        reviewedBy: r.reviewedBy || '', reviewedAt: r.reviewedAt || '',
        reviewRemark: r.reviewRemark || '',
        createdAt: r.requestedAt || stamp(), updatedAt: r.reviewedAt || r.requestedAt || stamp()
      });
    });

    (B.studentWordbookSeeds || []).forEach(function (w) {
      swbSeq++;
      studentWordbooks.push({
        id: 'SW' + pad(swbSeq, 3), studentId: w.studentId, wordbookId: w.wordbookId,
        requestId: w.requestId || '', requestedByTeacherId: w.requestedByTeacherId || '',
        status: w.status || SWB.ACTIVE,
        approvedBy: w.approvedBy || '王敏', approvedAt: w.approvedAt || stamp(),
        disabledBy: w.disabledBy || '', disabledAt: w.disabledAt || '',
        disableReason: w.disableReason || '', remark: w.remark || '',
        createdAt: w.approvedAt || stamp(), updatedAt: w.disabledAt || w.approvedAt || stamp()
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
    var planWordIds = wb1Ids.slice();
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
    wb1Words.forEach(function (w, i) {
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
      reviewDefaults: { joinLeitner: false, joinPlan21: false, joinGreen: false },
      /* 机构策略：启用门槛、暂停时是否禁用登录、退出是否必须清空学员与未来课程 */
      teacher: {
        activationRequired: ['basic', 'account', 'grades'],
        pauseDisableLogin: true,
        exitRequireNoStudents: true,
        exitRequireNoCourses: true,
        maxStudentsPerTeacher: 6
      }
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
          AT: ATS, ATD: 0, FV: 0, FC: 0, CR: CRS, RP: RPS,
          WB: wordbooks.length, WW: wordbookWords.length, IB: 0, IJ: 0,
          TC: teachers.reduce(function (m, t) {
            var x = /^T(\d+)$/.exec(t.code);
            return x ? Math.max(m, Number(x[1])) : m;
          }, 0),
          UA: users.length, TS: teacherStudents.length, TCH: coopSeq, TCL: 0,
          SD: demandSeq, TRS: respSeq, DL: dlogSeq, WBR: wbrSeq, SWB: swbSeq
        },
        builtAt: stamp()
      },
      students: clone(B.students || []),
      teachers: teachers,
      users: users,
      teacherStudents: teacherStudents,
      teacherCooperations: teacherCooperations,
      teacherChanges: teacherChanges,
      studentDemands: studentDemands,
      teacherResponses: teacherResponses,
      studentDemandLogs: studentDemandLogs,
      studentWordbookRequests: studentWordbookRequests,
      studentWordbooks: studentWordbooks,
      parents: clone(B.parents || []),
      words: words,
      wordbooks: wordbooks,
      wordbookWords: wordbookWords,
      importBatches: [],
      importJobs: [],
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
    d.importBatches = d.importBatches || [];
    d.importJobs = d.importJobs || [];
    d.meta = d.meta || { seq: {} };
    d.meta.seq = d.meta.seq || {};
    d.config = d.config || {};
    d.config.teacher = d.config.teacher || {
      activationRequired: ['basic', 'account', 'grades'],
      pauseDisableLogin: true,
      exitRequireNoStudents: true,
      exitRequireNoCourses: true,
      maxStudentsPerTeacher: 6
    };

    var stuByName = {}, teaByName = {};
    (d.students || []).forEach(function (s) { stuByName[s.name] = s.id; });
    (d.teachers || []).forEach(function (t) { teaByName[t.name] = t.id; });

    /* 词库三段式模型（v4 → v5 收敛）
       v4 把 wordIds / hasWords / book / unit 直接挂在词库上，
       v5 拆成「基础单词 + 词库 + 关联」三张表：词库不再自带单词 ID 数组。 */
    d.words = d.words || [];
    d.wordbooks = d.wordbooks || [];
    d.wordbookWords = d.wordbookWords || [];
    var WBNOW = TODAY + ' 09:00';
    d.words.forEach(function (w) {
      if (!w.mean || !w.mean.length) {
        w.mean = [{ pos: w.pos || '', cn: w.cn || '' }];
      }
      delete w.cn; delete w.book; delete w.grade; delete w.unit;
      w.ph = w.ph || ''; w.pos = w.pos || ''; w.audio = w.audio || '';
      w.status = w.status || '启用';
      w.createdAt = w.createdAt || WBNOW;
      w.updatedAt = w.updatedAt || w.createdAt;
    });
    d.wordbooks.forEach(function (b) {
      if (b.bookVersion === undefined) b.bookVersion = b.book || '';
      if (b.organization === undefined) b.organization = b.unit ? '按单元' : '';
      if (b.category === undefined) b.category = b.bookVersion ? '教材' : '其他';
      delete b.book; delete b.unit; delete b.hasWords; delete b.wordIds; delete b.count;
      b.bookVersion = b.bookVersion || ''; b.schoolStage = b.schoolStage || '';
      b.grade = b.grade || ''; b.term = b.term || '';
      b.organization = b.organization || ''; b.description = b.description || '';
      b.sourceFile = b.sourceFile || '';
      b.status = b.status === '停用' ? '停用' : '启用';
      b.createdAt = b.createdAt || WBNOW;
      b.updatedAt = b.updatedAt || b.createdAt;
      if (typeof b.wordCount !== 'number') b.wordCount = 0;
    });
    /* 关联表：旧字段 bookId → wordbookId；丢弃指向已不存在对象的孤儿关联；同库同词去重 */
    var linkSeen = {};
    d.wordbookWords = d.wordbookWords.filter(function (x) {
      if (!x) return false;
      if (x.wordbookId === undefined) x.wordbookId = x.bookId;
      delete x.bookId;
      var wb = d.wordbooks.filter(function (b) { return b.id === x.wordbookId; })[0];
      var wd = d.words.filter(function (w) { return w.id === x.wordId; })[0];
      if (!wb || !wd) return false;
      var k = x.wordbookId + '|' + x.wordId;
      if (linkSeen[k]) return false;
      linkSeen[k] = 1;
      if (typeof x.seq !== 'number') x.seq = 0;
      x.id = x.id || ('WW' + (d.wordbookWords.length + 1));
      x.sourceFile = x.sourceFile || '';
      if (typeof x.sourceRow !== 'number') x.sourceRow = 0;
      x.createdAt = x.createdAt || WBNOW;
      return true;
    });
    /* 每个词库内 seq 连续，wordCount 以关联表为唯一口径 */
    d.wordbooks.forEach(function (b) {
      var links = d.wordbookWords.filter(function (x) { return x.wordbookId === b.id; })
        .sort(function (a, c) { return a.seq - c.seq; });
      links.forEach(function (x, i) { x.seq = i + 1; });
      b.wordCount = links.length;
    });
    d.meta.seq.WB = Math.max(d.meta.seq.WB || 0, d.wordbooks.length);
    d.meta.seq.WW = Math.max(d.meta.seq.WW || 0, d.wordbookWords.length);
    d.meta.seq.IB = d.meta.seq.IB || 0;
    d.meta.seq.IJ = d.meta.seq.IJ || 0;

    /* 教师资源池（v5 → v6 收敛）
       v5 的教师只有「在职 / 停用」两个状态，年级与教材是顿号字符串，
       另有 students / monthCourses 等静态展示数字直接写在档案上。
       v6 把它们拆开：
         人事事实 → cooperationStatus（待启用 / 可授课 / 暂停合作 / 已退出）
         系统事实 → users.status（未开通 / 正常 / 已禁用）
         业务事实 → 由 courses + teacherStudents 实时计算，不再存静态数字
       旧字段 books / join / status / students / monthCourses / monthHours 一律丢弃。 */
    d.students = d.students || [];
    d.teachers = d.teachers || [];
    d.users = d.users || [];
    d.teacherStudents = d.teacherStudents || [];
    d.teacherCooperations = d.teacherCooperations || [];
    d.teacherChanges = d.teacherChanges || [];

    function splitList(v) {
      if (Array.isArray(v)) {
        return v.map(function (x) { return String(x || '').trim(); }).filter(Boolean);
      }
      return String(v == null ? '' : v).split(/[、,，\/]+/)
        .map(function (x) { return x.trim(); }).filter(Boolean);
    }

    var codeMax = 0;
    d.teachers.forEach(function (t) {
      t.code = String(t.code || t.id || '').trim() || ('T' + pad(d.teachers.indexOf(t) + 1, 3));
      t.name = String(t.name || '').trim();
      t.phone = String(t.phone || '');
      t.gender = t.gender || ''; t.school = t.school || ''; t.major = t.major || '';
      t.education = t.education || ''; t.introduction = t.introduction || ''; t.remark = t.remark || '';
      t.grades = splitList(t.grades);
      t.textbooks = splitList(t.textbooks !== undefined ? t.textbooks : t.books);
      t.teachingTags = splitList(t.teachingTags);
      t.teachingExperience = t.teachingExperience || '';
      t.teachingStyle = t.teachingStyle || '';
      var legacyStatus = t.status;
      delete t.books; delete t.join; delete t.status;
      delete t.students; delete t.monthCourses; delete t.monthHours;

      if (!Array.isArray(t.availability)) t.availability = [];
      t.availability = t.availability.filter(function (a) {
        return a && WEEKDAYS.indexOf(a.weekday) >= 0 && PERIODS.indexOf(a.period) >= 0;
      });
      t.availability.forEach(function (a, i) {
        a.id = a.id || ('TAV' + pad(i + 1, 3));
        a.note = a.note || '';
      });

      /* 合作状态归一：旧「停用」收敛为「暂停合作」（退出必须有人工原因与交接记录） */
      if (COOP_STATUS.indexOf(t.cooperationStatus) < 0) {
        t.cooperationStatus = legacyStatus === '停用' ? COOP.PAUSED : COOP.READY;
      }
      t.accountId = t.accountId || '';
      t.firstCooperationAt = t.firstCooperationAt || '';
      t.lastCooperationStartAt = t.lastCooperationStartAt || t.firstCooperationAt || '';
      t.cooperationEndAt = t.cooperationEndAt || '';
      if (t.cooperationStatus !== COOP.PAUSED) t.pauseInfo = null;
      else if (!t.pauseInfo) {
        t.pauseInfo = { reason: '', startAt: t.updatedAt || TODAY, expectResumeAt: '', remark: '', by: '' };
      }
      t.rejoinCount = t.rejoinCount || 0;
      t.createdBy = t.createdBy || '';
      t.createdAt = t.createdAt || (TODAY + ' 09:00');
      t.updatedAt = t.updatedAt || t.createdAt;
      var cm = /^T(\d+)$/.exec(t.code);
      if (cm) codeMax = Math.max(codeMax, Number(cm[1]));
    });

    d.users.forEach(function (u) {
      u.loginName = u.loginName || u.phone || '';
      u.phone = u.phone || '';
      u.passwordHash = u.passwordHash || '';
      if (u.mustChangePassword === undefined) u.mustChangePassword = true;
      u.status = ACCOUNT_STATUS.indexOf(u.status) >= 0 ? u.status : ACCOUNT.OK;
      u.roleId = u.roleId || 'teacher';
      u.teacherId = u.teacherId || '';
      u.createdAt = u.createdAt || (TODAY + ' 09:00');
      u.updatedAt = u.updatedAt || u.createdAt;
    });

    /* 每条教师档案最多一个有效账号；孤儿账号解绑而不是删除 */
    var accOwner = {};
    d.users.forEach(function (u) {
      if (!u.teacherId) return;
      if (accOwner[u.teacherId]) { u.teacherId = ''; return; }
      accOwner[u.teacherId] = u.id;
    });
    d.teachers.forEach(function (t) {
      if (t.accountId && !d.users.some(function (u) { return u.id === t.accountId; })) t.accountId = '';
      if (!t.accountId && accOwner[t.id]) t.accountId = accOwner[t.id];
    });

    /* 师生关系归一：同一学员同一时间只允许一条有效关系 */
    var activeBest = {};
    d.teacherStudents.forEach(function (r) {
      if (!r || r.endAt) return;
      var cur = activeBest[r.studentId];
      if (!cur || String(r.startAt || '') > String(cur.startAt || '')) activeBest[r.studentId] = r;
    });
    var tsSeq = 0;
    d.teacherStudents = d.teacherStudents.filter(function (r) {
      if (!r) return false;
      var t = d.teachers.filter(function (x) { return x.id === r.teacherId; })[0];
      if (!t) return false;                       // 教师不存在则丢弃（学生可缺，历史仍需保留）
      r.startAt = r.startAt || TODAY;
      r.endAt = r.endAt || '';
      if (!r.endAt && activeBest[r.studentId] && activeBest[r.studentId] !== r) {
        r.endAt = r.startAt;
        r.endReason = r.endReason || '关系归一：同一学员存在多条有效关系，保留最近一条';
      }
      r.status = r.endAt ? REL.ENDED : REL.ACTIVE;
      if (r.endAt && r.endAt < r.startAt) r.endAt = r.startAt;
      r.assignReason = r.assignReason || '';
      r.endReason = r.endReason || '';
      r.attention = r.attention || '';
      r.createdBy = r.createdBy || '';
      r.createdAt = r.createdAt || (r.startAt + ' 09:00');
      tsSeq++;
      r.id = r.id || ('TS' + pad(tsSeq, 3));
      return true;
    });

    /* students.teacher / teacherName 是派生缓存：以有效关系为唯一口径重算，
       保证旧页面读到的「当前教师」与关系表永远一致 */
    d.students.forEach(function (s) {
      var act = null;
      d.teacherStudents.forEach(function (r) {
        if (r.studentId === s.id && r.status === REL.ACTIVE) act = r;
      });
      var tt = act ? d.teachers.filter(function (x) { return x.id === act.teacherId; })[0] : null;
      s.teacher = tt ? tt.id : '';
      s.teacherName = tt ? tt.name : '未分配';
    });

    var coopSeqN = 0;
    d.teacherCooperations = d.teacherCooperations.filter(function (c) {
      if (!c) return false;
      if (!d.teachers.some(function (t) { return t.id === c.teacherId; })) return false;
      c.action = COOP_ACTION[c.action] ? c.action : COOP_ACTION.CREATED;
      c.reason = c.reason || '';
      c.effectiveAt = c.effectiveAt || c.createdAt || (TODAY + ' 09:00');
      c.operatorId = c.operatorId || '';
      c.operatorName = c.operatorName || c.operatorId || '';
      c.remark = c.remark || '';
      c.createdAt = c.createdAt || c.effectiveAt;
      coopSeqN++;
      c.id = c.id || ('TCH' + pad(coopSeqN, 3));
      return true;
    });

    var tclSeq = 0;
    d.teacherChanges = d.teacherChanges.filter(function (c) {
      if (!c) return false;
      if (!d.teachers.some(function (t) { return t.id === c.teacherId; })) return false;
      c.fieldName = c.fieldName || '';
      c.oldValue = c.oldValue === undefined ? '' : c.oldValue;
      c.newValue = c.newValue === undefined ? '' : c.newValue;
      c.operatorId = c.operatorId || '';
      c.createdAt = c.createdAt || (TODAY + ' 09:00');
      tclSeq++;
      c.id = c.id || ('TCL' + pad(tclSeq, 3));
      return true;
    });

    d.meta.seq.TC = Math.max(d.meta.seq.TC || 0, codeMax);
    d.meta.seq.TAV = Math.max(d.meta.seq.TAV || 0,
      d.teachers.reduce(function (n, t) { return n + t.availability.length; }, 0));
    d.meta.seq.UA = Math.max(d.meta.seq.UA || 0, d.users.length);
    d.meta.seq.TS = Math.max(d.meta.seq.TS || 0, d.teacherStudents.length);
    d.meta.seq.TCH = Math.max(d.meta.seq.TCH || 0, d.teacherCooperations.length);
    d.meta.seq.TCL = Math.max(d.meta.seq.TCL || 0, d.teacherChanges.length);

    /* ============================================================
       学员接单域收敛（v6 → v7）
       ------------------------------------------------------------
       老数据里没有这五张表，一律补空数组；
       已有的则统一字段、统一状态词表、统一编号序列，
       并做三件一致性修复：
         1. 需求选了教师但状态还停在接单中 → 推到待管理员分配
         2. 需求已完成分配但 selectedTeacherId 为空 → 用关系反查补上
         3. 同一学员同一词库多条有效授权 → 只保留最近一条，其余置为已停用
       ============================================================ */
    d.studentDemands = d.studentDemands || [];
    d.teacherResponses = d.teacherResponses || [];
    d.studentDemandLogs = d.studentDemandLogs || [];
    d.studentWordbookRequests = d.studentWordbookRequests || [];
    d.studentWordbooks = d.studentWordbooks || [];

    var demandById = {};
    d.studentDemands.forEach(function (x) {
      x.code = x.code || x.id;
      x.learningNeeds = toList(x.learningNeeds);
      x.expectedSchedule = x.expectedSchedule || {};
      x.expectedSchedule.weekday = toList(x.expectedSchedule.weekday);
      x.expectedSchedule.periods = toList(x.expectedSchedule.periods);
      x.expectedSchedule.weeklyLessons = Number(x.expectedSchedule.weeklyLessons) || 0;
      if (DEMAND_STATUS.indexOf(x.status) < 0) x.status = DEMAND.DRAFT;
      ['currentLevel', 'expectedStartAt', 'specialRequirements', 'remark',
        'publishedBy', 'publishedAt', 'selectedTeacherId', 'confirmedBy', 'confirmedAt',
        'confirmReason', 'assignedAt', 'assignedBy', 'cancelReason', 'createdBy'
      ].forEach(function (k) { x[k] = x[k] || ''; });
      x.createdAt = x.createdAt || stamp();
      x.updatedAt = x.updatedAt || x.createdAt;
      demandById[x.id] = x;
      return true;
    });

    var respSeen = {};
    d.teacherResponses = d.teacherResponses.filter(function (r) {
      if (!demandById[r.demandId]) return false;             /* 孤儿响应丢弃 */
      if (RESP_STATUS.indexOf(r.status) < 0) r.status = RESP.YES;
      r.remark = r.remark || '';
      r.declineReason = r.declineReason || '';
      r.withdrawnAt = r.withdrawnAt || '';
      r.withdrawReason = r.withdrawReason || '';
      r.respondedAt = r.respondedAt || stamp();
      r.createdAt = r.createdAt || r.respondedAt;
      r.updatedAt = r.updatedAt || r.respondedAt;
      /* 同一教师对同一需求只能有一条有效响应：重复的保留最近一条 */
      if (RESP_VALID.indexOf(r.status) >= 0) {
        var key = r.demandId + '|' + r.teacherId;
        if (respSeen[key]) {
          if (!respSeen[key].updatedAt || respSeen[key].updatedAt < r.updatedAt) respSeen[key] = r;
          return false;
        }
        respSeen[key] = r;
      }
      return true;
    });

    d.studentDemandLogs.forEach(function (l) {
      l.action = DEMAND_ACTION[l.action] ? l.action : DEMAND_ACTION.CREATED;
      l.detail = l.detail || '';
      l.operatorName = l.operatorName || '系统';
      l.operatorId = l.operatorId || l.operatorName;
      l.at = l.at || l.createdAt || stamp();
      l.createdAt = l.createdAt || l.at;
      return true;
    });

    d.studentWordbookRequests.forEach(function (r) {
      if (WBR_STATUS.indexOf(r.status) < 0) r.status = WBR.PENDING;
      ['reason', 'plan', 'reviewedBy', 'reviewedAt', 'reviewRemark'].forEach(function (k) {
        r[k] = r[k] || '';
      });
      r.requestedAt = r.requestedAt || stamp();
      r.createdAt = r.createdAt || r.requestedAt;
      r.updatedAt = r.updatedAt || r.reviewedAt || r.requestedAt;
      return true;
    });

    var swbSeen = {};
    d.studentWordbooks.forEach(function (w) {
      if (SWB_STATUS.indexOf(w.status) < 0) w.status = SWB.ACTIVE;
      ['requestId', 'requestedByTeacherId', 'disabledBy', 'disabledAt',
        'disableReason', 'remark'].forEach(function (k) { w[k] = w[k] || ''; });
      w.approvedBy = w.approvedBy || '王敏';
      w.approvedAt = w.approvedAt || stamp();
      w.createdAt = w.createdAt || w.approvedAt;
      w.updatedAt = w.updatedAt || w.disabledAt || w.approvedAt;
      if (w.status === SWB.ACTIVE) {
        var sk = w.studentId + '|' + w.wordbookId;
        if (swbSeen[sk]) {
          /* 同一学员同一词库只允许一条有效授权，历史授权保留为已停用 */
          if ((swbSeen[sk].approvedAt || '') < (w.approvedAt || '')) {
            swbSeen[sk].status = SWB.DISABLED;
            swbSeen[sk].disabledAt = swbSeen[sk].disabledAt || w.approvedAt;
            swbSeen[sk].disableReason = swbSeen[sk].disableReason || '系统归一：同一词库重复授权，保留最新一条';
            swbSeen[sk] = w;
          } else {
            w.status = SWB.DISABLED;
            w.disabledAt = w.disabledAt || swbSeen[sk].approvedAt;
            w.disableReason = w.disableReason || '系统归一：同一词库重复授权，保留最新一条';
          }
        } else {
          swbSeen[sk] = w;
        }
      }
      return true;
    });

    /* 需求与关系的一致性修复 */
    d.studentDemands.forEach(function (x) {
      if (x.status === DEMAND.DONE && !x.selectedTeacherId) {
        var rel = d.teacherStudents.filter(function (r) {
          return r.studentId === x.studentId && r.demandId === x.id;
        })[0];
        if (rel) x.selectedTeacherId = rel.teacherId;
      }
      if (x.selectedTeacherId && (x.status === DEMAND.OPEN || x.status === DEMAND.BIDDING)) {
        x.status = DEMAND.ASSIGN;
      }
      return true;
    });

    d.meta.seq = d.meta.seq || {};
    /* 需求编号形如 D20261102008：字母 + 8 位日期 + 3 位流水，只取后 3 位进序列 */
    d.meta.seq.SD = Math.max.apply(null, [d.meta.seq.SD || 0, d.studentDemands.length]
      .concat(d.studentDemands.map(function (x) {
        var m = /^D\d{8}(\d{3,})$/.exec(x.code || '');
        return m ? Number(m[1]) : 0;
      })));
    d.meta.seq.TRS = Math.max(d.meta.seq.TRS || 0, d.teacherResponses.length);
    d.meta.seq.DL = Math.max(d.meta.seq.DL || 0, d.studentDemandLogs.length);
    d.meta.seq.WBR = Math.max(d.meta.seq.WBR || 0, d.studentWordbookRequests.length);
    d.meta.seq.SWB = Math.max(d.meta.seq.SWB || 0, d.studentWordbooks.length);

    /* 课程 */
    d.courses.forEach(function (c) {
      c.studentId = c.studentId || stuByName[c.student] || '';
      c.teacherId = c.teacherId || teaByName[c.teacher] || '';
      /* 课程必须自带教师快照：教师改名/换号后，历史课仍然显示当时的授课教师 */
      if (!c.teacherName) c.teacherName = c.teacher || '';
      if (c.teacherCode === undefined) {
        var ct = d.teachers.filter(function (x) { return x.id === c.teacherId; })[0];
        c.teacherCode = ct ? ct.code : '';
      }
      if (!Array.isArray(c.reassignLogs)) c.reassignLogs = [];
      if (!Array.isArray(c.changeLogs)) c.changeLogs = [];
      c.needsAdjust = !!c.needsAdjust;
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

  /**
   * v6 → v7 一次性迁移。
   * v7 只新增了接单域 5 张表，旧集合结构未变，因此按「同名字段原样搬运、
   * 缺失集合用种子补齐」的方式迁移，历史演示数据（学员/教师/词库/课程/训练）全部保留。
   * 无论迁移是否成功，都不删除 ee_proto_store_v6 —— 它同时充当原始备份。
   * 返回 null 表示没有可迁移的旧数据。
   */
  var LEGACY_KEY = 'ee_proto_store_v6';
  var MIGRATABLE_KEYS = ['students', 'teachers', 'users', 'teacherStudents', 'teacherCooperations',
    'teacherChanges', 'parents', 'words', 'wordbooks', 'wordbookWords', 'importBatches', 'importJobs',
    'prescreens', 'trainTasks', 'trainDetails', 'studentWordStates', 'leitnerStates', 'leitnerConfig',
    'leitnerTasks', 'leitnerRecords', 'leitnerOps', 'plans21', 'plan21Tasks', 'plan21Records',
    'articleTasks', 'articleTaskDetails', 'courses', 'courseRecords', 'reports', 'flows', 'accounts',
    'flowReversals', 'familyChecks'];

  function loadLegacyV6() {
    var raw = null;
    try { raw = SS.getItem(LEGACY_KEY); } catch (e) { return null; }
    if (!raw) return null;
    var old;
    try { old = JSON.parse(raw); } catch (e) { old = null; }
    if (!old || typeof old !== 'object') {
      /* 旧数据损坏：保留原 key 不动，退回种子并明确提示 */
      try { console.warn('[Store] ' + LEGACY_KEY + ' 无法解析，已保留原始数据作为备份，演示数据重置为 v7 种子'); } catch (e) { }
      return null;
    }
    var seed = buildSeed();
    var out = normalizeDb(seed);
    var moved = [], reset = [];
    MIGRATABLE_KEYS.forEach(function (k) {
      if (!Array.isArray(old[k])) { reset.push(k); return; }
      /* 只搬运结构一致的数组：两侧都存在该集合才覆盖，避免把 v6 的未知结构塞进 v7 */
      if (!Array.isArray(seed[k])) { reset.push(k); return; }
      out[k] = clone(old[k]);
      moved.push(k);
    });
    out.version = VERSION;
    out.meta = out.meta || {};
    out.meta.migration = {
      from: 'v6', to: 'v7', at: stamp(),
      strategy: '按集合搬运 + 缺失集合用种子补齐；v6 原始数据保留在 ' + LEGACY_KEY,
      carried: moved, seeded: reset
    };
    try {
      console.info('[Store] 已从 v6 迁移本地演示数据：保留 ' + moved.length + ' 个集合，' +
        reset.length + ' 个集合用种子补齐；' + LEGACY_KEY + ' 已保留为备份');
    } catch (e) { }
    return normalizeDb(out);
  }

  function load() {
    restoreSession();
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
    var legacy = loadLegacyV6();
    if (legacy) { db = legacy; save(); return db; }
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
  function wordByEn(en) {
    var k = String(en || '').trim().toLowerCase();
    return db.words.filter(function (w) { return String(w.en).toLowerCase() === k; })[0] || null;
  }

  function wordsOfBook(bookId) {
    var b = wordbook(bookId);
    if (!b) return [];
    return db.wordbookWords
      .filter(function (x) { return x.wordbookId === bookId; })
      .sort(function (a, c) { return a.seq - c.seq; })
      .map(function (x) { return word(x.wordId); })
      .filter(Boolean);
  }

  /** 词库内单词视图：基础单词 + 本词库内的排序 / 来源 / 关联 ID */
  function bookWords(bookId) {
    if (!wordbook(bookId)) return [];
    return db.wordbookWords
      .filter(function (x) { return x.wordbookId === bookId; })
      .sort(function (a, c) { return a.seq - c.seq; })
      .map(function (x) {
        var w = word(x.wordId);
        if (!w) return null;
        return {
          id: w.id, en: w.en, ph: w.ph, mean: w.mean, pos: w.pos, audio: w.audio,
          status: w.status, createdAt: w.createdAt, updatedAt: w.updatedAt,
          linkId: x.id, seq: x.seq, sourceFile: x.sourceFile, sourceRow: x.sourceRow
        };
      })
      .filter(Boolean);
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
    if (bk.status !== '启用') throw new Error('词库已停用，不能用于新建训练');
    if (!bookLinkCount(bk.id)) throw new Error('该词库还没有单词，请先到资源中心导入词表');
    /* 教师只能在「学员已获授权」的词库上开训练；未授权请先到接单中心提交词库申请 */
    if (session.role === 'teacher' && !isAuthorized(opt.studentId, bk.id)) {
      throw bizError('NOT_AUTHORIZED',
        '学员还没有词库「' + bk.name + '」的有效授权，不能用它开始训练；请先到接单中心提交词库申请');
    }

    // 同一学员同一词库存在未完成任务时，直接复用，避免出现两个并行任务
    var ex = activeTask(opt.studentId, bk.id);
    if (ex) {
      if (opt.courseId && !ex.courseId) ex.courseId = opt.courseId;
      return ex;
    }

    var ids = opt.rangeWordIds || wordsOfBook(bk.id).map(function (w) { return w.id; });
    var t = {
      id: 'TR' + TODAY.replace(/-/g, '') + seq('TR', 2),
      studentId: opt.studentId,
      teacherId: opt.teacherId || sessionTeacherId(),
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
      teacherId: opt.teacherId || sessionTeacherId(),
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

  /* ============================================================
     词库（资源域）与批量导入
     ------------------------------------------------------------
     模型：基础单词 words ↔ 关联 wordbookWords ↔ 词库 wordbooks
     规则（与业务口径一一对应）：
       1. 一份 Excel 默认对应一个词库，文件名为默认词库名。
       2. 基础单词按英文唯一；跨词库同名单词只增加关联，不重复建基础单词。
       3. 同一词库内不重复关联；词库内排序独立（seq），互不影响。
       4. 从词库移除单词只删关联，不删基础单词；学员学习状态不随词库关系变化。
       5. 导入以「文件」为原子单位：先算完整计划，再一次性写入；
          写入过程中任何异常回滚到导入前快照，绝不留「半个词库」。
     ============================================================ */

  var WB_CATEGORIES = ['教材', '考纲', '课程体系', '拓展', '其他'];
  var WB_STAGES = ['小学', '初中', '高中'];
  var WB_STATUS = ['启用', '停用'];
  var WB_ORG = ['全册', '按年级', '按单元', '按主题', '按词频', '其他'];

  /* 表头同义词：只做「同义识别」，不做位置猜测。
     认不出来的列一律留空，由用户手动映射。 */
  var HEADER_SYNONYMS = {
    en: ['英文', '单词', 'word', 'words', '词汇', '英文单词', '英语', 'english', '单词英文', '单词/短语'],
    ph: ['音标', 'phonetic', 'phonetics', 'ipa', '发音', '国际音标', '音标(ipa)'],
    pos: ['词性', 'pos', 'partofspeech', '词类', '词性标注'],
    cn: ['中文', '释义', 'meaning', '翻译', '中文释义', '汉语', '词义', '意思', '解释', '中文意思', '中文翻译'],
    audio: ['音频', 'audio', '音频文件', '发音文件', '语音', '音频名', '音频文件名']
  };
  var HEADER_KEYS = ['en', 'ph', 'pos', 'cn', 'audio'];
  var FIELD_LABEL = { en: '英文单词', ph: '音标', pos: '词性', cn: '中文释义', audio: '音频' };

  function normHeader(v) {
    return String(v == null ? '' : v).trim().toLowerCase()
      .replace(/[\s\u3000:：()（）\[\]【】*＊\/]/g, '');
  }
  function headerMatch(cell) {
    var n = normHeader(cell);
    if (!n) return null;
    for (var i = 0; i < HEADER_KEYS.length; i++) {
      var k = HEADER_KEYS[i], list = HEADER_SYNONYMS[k];
      for (var j = 0; j < list.length; j++) {
        if (n === normHeader(list[j])) return k;
      }
    }
    return null;
  }

  /** 在前 12 行里找表头行：命中同义词最多的那一行，且必须认出英文列或释义列 */
  function detectHeader(rows) {
    rows = rows || [];
    var limit = Math.min(rows.length, 12);
    var best = { row: 0, mapping: {}, score: 0, mappingLabels: [] };
    for (var r = 0; r < limit; r++) {
      var cells = rows[r] || [];
      var map = {}, score = 0;
      for (var c = 0; c < cells.length; c++) {
        var k = headerMatch(cells[c]);
        if (k && map[k] === undefined) { map[k] = c; score++; }
      }
      if (map.en === undefined && map.cn === undefined) continue;
      if (score > best.score) best = { row: r + 1, mapping: map, score: score, mappingLabels: cells.map(function (x) { return String(x == null ? '' : x).trim(); }) };
    }
    best.complete = (best.mapping.en !== undefined && best.mapping.cn !== undefined);
    return best;
  }

  /** 「n. 名字；v. 命名」→ 多释义数组 */
  function splitMean(cn, pos) {
    var raw = String(cn == null ? '' : cn).replace(/\r/g, '\n');
    var parts = raw.split(/[；;、\n]+/).map(function (x) { return x.trim(); })
      .filter(function (x) { return !!x; });
    var out = [];
    parts.forEach(function (p) {
      var m = p.match(/^([a-zA-Z]{1,5}\.)\s*(.+)$/);
      if (m) out.push({ pos: m[1], cn: m[2].trim() });
      else out.push({ pos: pos || '', cn: p });
    });
    return out;
  }

  function isEnglishWord(s) {
    return /^[A-Za-z][A-Za-z'’\-.\s]*$/.test(String(s || '').trim());
  }
  function isPhonetic(s) {
    var t = String(s || '').trim();
    if (!t) return true;
    return /^\/.+\/$/.test(t) || /^\[.+\]$/.test(t);
  }
  function cellText(v) {
    return String(v == null ? '' : v).replace(/\u00a0/g, ' ').trim();
  }

  /**
   * 解析结果分析（只读，不写库）
   * input: { fileName, sheetName, headerRow, dataStartRow, mapping, rows, targetBookId }
   * rows: 原始二维数组（含表头与说明行），下标 0 对应 Excel 第 1 行
   */
  function analyzeImport(input) {
    input = input || {};
    var rows = input.rows || [];
    var mapping = input.mapping || {};
    var headerRow = Number(input.headerRow || 0);
    var dataStartRow = Number(input.dataStartRow || 0) || (headerRow + 1) || 1;

    var target = input.targetBookId ? wordbook(input.targetBookId) : null;
    var inBook = {};
    if (target) {
      db.wordbookWords.forEach(function (x) { if (x.wordbookId === target.id) inBook[x.wordId] = 1; });
    }
    var byEn = {};
    db.words.forEach(function (w) { byEn[String(w.en).toLowerCase()] = w; });

    var seenFile = {};
    var stat = {
      parsedRows: 0, emptyRows: 0, newWords: 0, existingWords: 0,
      dupInFile: 0, inBook: 0, missingRequired: 0, badFormat: 0,
      phoneticWarn: 0, validRows: 0,
      /* 可选字段缺失：允许为空，但要让人看得见 */
      missingPh: 0, missingPos: 0, missingAudio: 0
    };
    function countOptional() {
      if (!ph) stat.missingPh++;
      if (!pos) stat.missingPos++;
      if (!audio) stat.missingAudio++;
    }
    var entries = [], rowResults = [], issues = [], failedRows = [], fillCandidates = [];

    function pick(cells, k) {
      var idx = mapping[k];
      if (idx === undefined || idx === null || idx === '') return '';
      return cellText(cells[idx]);
    }
    for (var r = dataStartRow; r <= rows.length; r++) {
      var cells = rows[r - 1] || [];
      var en = pick(cells, 'en'), ph = pick(cells, 'ph'), pos = pick(cells, 'pos'),
          cn = pick(cells, 'cn'), audio = pick(cells, 'audio');

      if (!en && !cn && !ph && !pos && !audio) { stat.emptyRows++; continue; }
      stat.parsedRows++;

      var line = {
        sheetRow: r, en: en, ph: ph, pos: pos, cn: cn, audio: audio,
        raw: cells.slice(0, 8).map(function (x) { return cellText(x); }).join(' | ')
      };

      if (!en || !cn) {
        line.status = 'missing';
        line.note = !en && !cn ? '英文单词与中文释义都为空'
          : !en ? '缺少英文单词' : '缺少中文释义';
        stat.missingRequired++;
        issues.push({ row: r, level: 'error', type: 'missing', message: line.note, en: en, cn: cn });
        failedRows.push({ row: r, en: en, cn: cn, reason: line.note, raw: line.raw });
        rowResults.push(line);
        continue;
      }
      if (!isEnglishWord(en)) {
        line.status = 'bad';
        line.note = '英文单词格式异常（含数字、汉字或非法字符）';
        stat.badFormat++;
        issues.push({ row: r, level: 'error', type: 'format', message: line.note, en: en, cn: cn });
        failedRows.push({ row: r, en: en, cn: cn, reason: line.note, raw: line.raw });
        rowResults.push(line);
        continue;
      }
      if (!isPhonetic(ph)) {
        line.phWarn = true;
        stat.phoneticWarn++;
        issues.push({ row: r, level: 'warn', type: 'phonetic', message: '音标格式异常（建议形如 /neɪm/）：' + ph, en: en, cn: cn });
      }

      var key = en.toLowerCase();
      if (seenFile[key]) {
        line.status = 'dup';
        line.note = '文件内重复（首见第 ' + seenFile[key] + ' 行）';
        stat.dupInFile++;
        failedRows.push({ row: r, en: en, cn: cn, reason: line.note, raw: line.raw });
        rowResults.push(line);
        continue;
      }
      seenFile[key] = r;

      var mean = splitMean(cn, pos);
      var base = byEn[key];

      /* B 类重复：目标词库里已经有这个词 → 跳过重复关联（不新增、也不计入可入库） */
      if (base && inBook[base.id]) {
        stat.existingWords++;
        stat.inBook++;
        line.status = 'inBook';
        line.wordId = base.id;
        line.note = '本词库已存在该单词，跳过重复关联';
        countOptional();
        rowResults.push(line);
        continue;
      }

      stat.validRows++;
      countOptional();
      if (base) {
        /* C 类重复：系统其他词库已有该基础单词 → 复用基础单词，只新增本词库关联 */
        stat.existingWords++;
        line.status = 'existing';
        line.wordId = base.id;
        line.note = '系统已有该基础单词，复用并新增词库关联';
        entries.push({ status: 'existing', wordId: base.id, en: base.en, ph: ph, pos: pos, cn: cn, mean: mean, audio: audio, sheetRow: r });
        var fills = {};
        if (!base.ph && ph) fills.ph = ph;
        if (!base.audio && audio) fills.audio = audio;
        if ((!base.mean || !base.mean.length) && mean.length) fills.mean = mean;
        if (Object.keys(fills).length) {
          fillCandidates.push({
            wordId: base.id, en: base.en, row: r,
            missing: (!base.ph && ph ? ['音标'] : []).concat(!base.audio && audio ? ['音频'] : []).concat((!base.mean || !base.mean.length) && mean.length ? ['释义'] : []),
            fills: fills
          });
        }
      } else {
        stat.newWords++;
        line.status = 'new';
        line.note = '新增基础单词';
        entries.push({ status: 'new', wordId: null, en: en, ph: ph, pos: pos, cn: cn, mean: mean, audio: audio, sheetRow: r });
        byEn[key] = { id: null, en: en };   // 同文件内后出现的同名行按重复处理
      }
      rowResults.push(line);
    }

    /* 同一文件内出现两次的新词：第一次已算 new，第二次会走到 dup 分支，无需额外处理 */
    var level = (stat.missingRequired + stat.badFormat) > 0 ? 'warn' : 'ok';
    return {
      ok: entries.length > 0,
      fileName: input.fileName || '',
      sheetName: input.sheetName || '',
      headerRow: headerRow, dataStartRow: dataStartRow, mapping: mapping,
      targetBookId: target ? target.id : '',
      level: level,
      stats: stat,
      entries: entries,
      rows: rowResults,
      issues: issues,
      failedRows: failedRows,
      fillCandidates: fillCandidates,
      parsedRows: stat.parsedRows,
      validRows: entries.length,
      newWords: stat.newWords,
      existingWords: stat.existingWords,
      dupInFile: stat.dupInFile,
      inBook: stat.inBook,
      missingRequired: stat.missingRequired,
      badFormat: stat.badFormat
    };
  }

  /* ---------------- 词库读写 ---------------- */

  function bookLinkCount(bookId) {
    return db.wordbookWords.filter(function (x) { return x.wordbookId === bookId; }).length;
  }

  function wordbookStat(bookId) {
    var list = bookWords(bookId);
    var withPh = 0, withAudio = 0, multi = 0, noPh = 0, noAudio = 0;
    var ids = {};
    list.forEach(function (w) {
      ids[w.id] = 1;
      if (w.ph) withPh++; else noPh++;
      if (w.audio) withAudio++; else noAudio++;
      if (w.mean && w.mean.length > 1) multi++;
    });
    var users = {};
    db.trainTasks.forEach(function (t) {
      if (t.wordbookId === bookId && t.studentId) users[t.studentId] = 1;
    });
    /* 有单词档案的学员也算「使用中」：词库可能只被初筛过、还没建训练任务 */
    db.studentWordStates.forEach(function (s) {
      if (ids[s.wordId]) users[s.studentId] = 1;
    });
    return {
      wordCount: list.length,
      withPh: withPh, noPh: noPh,
      withAudio: withAudio, noAudio: noAudio,
      multiMean: multi,
      students: Object.keys(users).length,
      activeTasks: db.trainTasks.filter(function (t) { return t.wordbookId === bookId && isOpen(t.status); }).length
    };
  }

  function searchWordbooks(f) {
    f = f || {};
    var kw = String(f.kw || '').trim().toLowerCase();
    var list = db.wordbooks.filter(function (b) {
      if (kw && String(b.name).toLowerCase().indexOf(kw) < 0
        && String(b.sourceFile || '').toLowerCase().indexOf(kw) < 0) return false;
      if (f.category && b.category !== f.category) return false;
      if (f.schoolStage && b.schoolStage !== f.schoolStage) return false;
      if (f.bookVersion && b.bookVersion !== f.bookVersion) return false;
      if (f.grade && b.grade !== f.grade) return false;
      if (f.status && b.status !== f.status) return false;
      return true;
    });
    return list.sort(function (a, c) {
      if (a.createdAt === c.createdAt) return a.id < c.id ? 1 : -1;
      return a.createdAt < c.createdAt ? 1 : -1;
    });
  }

  function wordbookFacets() {
    function uniq(arr) {
      var seen = {}, out = [];
      arr.forEach(function (x) { if (x && !seen[x]) { seen[x] = 1; out.push(x); } });
      return out.sort();
    }
    return {
      categories: uniq(db.wordbooks.map(function (b) { return b.category; })),
      schoolStages: uniq(db.wordbooks.map(function (b) { return b.schoolStage; })),
      bookVersions: uniq(db.wordbooks.map(function (b) { return b.bookVersion; })),
      grades: uniq(db.wordbooks.map(function (b) { return b.grade; }))
    };
  }

  function createWordbook(meta) {
    meta = meta || {};
    var name = String(meta.name || '').trim();
    if (!name) fail('词库名称不能为空');
    if (db.wordbooks.some(function (b) { return b.name === name; })) fail('已存在同名词库：' + name);
    var at = stamp();
    var b = {
      id: 'WB' + seq('WB', 3), name: name,
      category: meta.category || '其他',
      bookVersion: meta.bookVersion || '', schoolStage: meta.schoolStage || '',
      grade: meta.grade || '', term: meta.term || '', organization: meta.organization || '',
      description: meta.description || '', sourceFile: meta.sourceFile || '',
      wordCount: 0, status: '启用', createdAt: at, updatedAt: at
    };
    db.wordbooks.push(b);
    save();
    return b;
  }

  var WB_EDITABLE = ['name', 'category', 'bookVersion', 'schoolStage', 'grade', 'term',
    'organization', 'description', 'status'];

  function updateWordbook(id, patch) {
    var b = wordbook(id);
    if (!b) fail('词库不存在');
    patch = patch || {};
    if (patch.name !== undefined) {
      var name = String(patch.name).trim();
      if (!name) fail('词库名称不能为空');
      if (db.wordbooks.some(function (x) { return x.id !== id && x.name === name; })) fail('已存在同名词库：' + name);
      b.name = name;
    }
    WB_EDITABLE.forEach(function (k) {
      if (k === 'name' || k === 'status') return;
      if (patch[k] !== undefined) b[k] = String(patch[k] || '').trim();
    });
    if (patch.status !== undefined) {
      if (WB_STATUS.indexOf(patch.status) < 0) fail('词库状态不合法');
      b.status = patch.status;
    }
    b.updatedAt = stamp();
    save();
    return b;
  }

  function setWordbookStatus(id, status) {
    return updateWordbook(id, { status: status });
  }

  function updateWord(wordId, patch) {
    var w = word(wordId);
    if (!w) fail('单词不存在');
    patch = patch || {};
    if (patch.en !== undefined) {
      var en = String(patch.en).trim();
      if (!en) fail('英文单词不能为空');
      if (!isEnglishWord(en)) fail('英文单词格式异常：' + en);
      var dup = db.words.filter(function (x) {
        return x.id !== wordId && String(x.en).toLowerCase() === en.toLowerCase();
      })[0];
      if (dup) fail('已存在同一基础单词：' + dup.en + '（' + dup.id + '）');
      w.en = en;
    }
    if (patch.ph !== undefined) w.ph = String(patch.ph || '').trim();
    if (patch.pos !== undefined) w.pos = String(patch.pos || '').trim();
    if (patch.audio !== undefined) w.audio = String(patch.audio || '').trim();
    if (patch.status !== undefined) w.status = patch.status === '停用' ? '停用' : '启用';
    if (patch.mean !== undefined) {
      var mean = patch.mean;
      if (typeof mean === 'string') mean = splitMean(mean, patch.pos || w.pos);
      if (!mean || !mean.length || !String(mean[0].cn || '').trim()) fail('中文释义不能为空');
      w.mean = mean;
    }
    w.updatedAt = stamp();
    save();
    return w;
  }

  /** 从词库移除某个单词：只删关联；基础单词与其他词库的关联保持不动 */
  function removeWordFromBook(bookId, wordId) {
    var b = wordbook(bookId);
    if (!b) fail('词库不存在');
    var idx = -1;
    db.wordbookWords.forEach(function (x, i) {
      if (x.wordbookId === bookId && x.wordId === wordId) idx = i;
    });
    if (idx < 0) fail('该单词不在本词库中');
    db.wordbookWords.splice(idx, 1);
    renumberBook(bookId);
    b.wordCount = bookLinkCount(bookId);
    b.updatedAt = stamp();
    /* 基础单词保留：可能被其他词库或历史任务引用 */
    var usedTimes = db.wordbookWords.filter(function (x) { return x.wordId === wordId; }).length;
    save();
    return { wordbookId: bookId, wordId: wordId, remainingLinks: usedTimes, wordKept: true };
  }

  /** 写操作后重排 seq，保证 1..n 连续 */
  function renumberBook(bookId) {
    db.wordbookWords.filter(function (x) { return x.wordbookId === bookId; })
      .sort(function (a, c) { return a.seq - c.seq; })
      .forEach(function (x, i) { x.seq = i + 1; });
  }

  function moveWordInBook(bookId, wordId, delta) {
    var b = wordbook(bookId);
    if (!b) fail('词库不存在');
    var links = db.wordbookWords.filter(function (x) { return x.wordbookId === bookId; })
      .sort(function (a, c) { return a.seq - c.seq; });
    var i = -1;
    links.forEach(function (x, k) { if (x.wordId === wordId) i = k; });
    if (i < 0) fail('该单词不在本词库中');
    var j = i + delta;
    if (j < 0 || j >= links.length) return { ok: false, reason: '已到边界' };
    var a = links[i], c = links[j];
    var t = a.seq; a.seq = c.seq; c.seq = t;
    renumberBook(bookId);
    b.updatedAt = stamp();
    save();
    return { ok: true, seq: bookWords(bookId).filter(function (w) { return w.id === wordId; })[0].seq };
  }

  function addWordToBook(bookId, data) {
    var b = wordbook(bookId);
    if (!b) fail('词库不存在');
    data = data || {};
    var en = String(data.en || '').trim();
    if (!en) fail('英文单词不能为空');
    if (!isEnglishWord(en)) fail('英文单词格式异常：' + en);
    var mean = data.mean !== undefined ? data.mean : splitMean(data.cn, data.pos);
    if (!mean || !mean.length || !String(mean[0].cn || '').trim()) fail('中文释义不能为空');
    var key = en.toLowerCase();
    var base = db.words.filter(function (w) { return String(w.en).toLowerCase() === key; })[0];
    var at = stamp();
    var created = false;
    if (!base) {
      created = true;
      base = {
        id: 'w' + pad(db.words.length + 1, 2), en: en, ph: String(data.ph || '').trim(),
        mean: mean, pos: String(data.pos || '').trim(), audio: String(data.audio || '').trim(),
        status: '启用', createdAt: at, updatedAt: at
      };
      db.words.push(base);
    }
    var exists = db.wordbookWords.filter(function (x) {
      return x.wordbookId === bookId && x.wordId === base.id;
    })[0];
    if (exists) fail('该单词已在本词库中');
    db.wordbookWords.push({
      id: 'WW' + seq('WW', 4), wordbookId: bookId, wordId: base.id,
      seq: bookLinkCount(bookId) + 1, sourceFile: '人工添加', sourceRow: 0, createdAt: at
    });
    b.wordCount = bookLinkCount(bookId);
    b.updatedAt = at;
    save();
    return { wordbookId: bookId, wordId: base.id, created: created };
  }

  function wordbooksOfWord(wordId) {
    var ids = db.wordbookWords.filter(function (x) { return x.wordId === wordId; })
      .map(function (x) { return x.wordbookId; });
    return db.wordbooks.filter(function (b) { return ids.indexOf(b.id) >= 0; });
  }

  /* ---------------- 导入批次与任务 ---------------- */

  function importBatches() {
    return db.importBatches.slice().sort(function (a, c) {
      return a.createdAt < c.createdAt ? 1 : -1;
    });
  }
  function importBatch(id) {
    return db.importBatches.filter(function (b) { return b.id === id; })[0] || null;
  }
  function importJobs() {
    return db.importJobs.slice().sort(function (a, c) {
      return a.createdAt < c.createdAt ? 1 : -1;
    });
  }
  function importJob(id) {
    return db.importJobs.filter(function (j) { return j.id === id; })[0] || null;
  }
  function importJobsOf(bookId) {
    return importJobs().filter(function (j) { return j.wordbookId === bookId; });
  }

  function startImportBatch(opt) {
    opt = opt || {};
    var at = stamp();
    var b = {
      id: 'IB' + seq('IB', 4),
      operatorId: opt.operatorId || 'A001',
      operatorName: opt.operatorName || '张敏',
      createdAt: at, finishedAt: null,
      status: '进行中',
      fileCount: opt.fileCount || 0,
      okCount: 0, failCount: 0,
      parsedRows: 0, newWords: 0, newLinks: 0, skipped: 0, failed: 0,
      note: opt.note || ''
    };
    db.importBatches.push(b);
    save();
    return b;
  }

  /** 用已入库的任务重算批次汇总，避免页面自己累加出错 */
  function finishImportBatch(batchId) {
    var b = importBatch(batchId);
    if (!b) fail('导入批次不存在');
    var jobs = db.importJobs.filter(function (j) { return j.batchId === batchId; });
    b.okCount = jobs.filter(function (j) { return j.status === '已入库'; }).length;
    b.failCount = jobs.filter(function (j) { return j.status === '失败'; }).length;
    b.parsedRows = jobs.reduce(function (n, j) { return n + (j.stats.parsedRows || 0); }, 0);
    b.newWords = jobs.reduce(function (n, j) { return n + (j.stats.newWords || 0); }, 0);
    b.newLinks = jobs.reduce(function (n, j) { return n + (j.stats.newLinks || 0); }, 0);
    b.skipped = jobs.reduce(function (n, j) { return n + (j.stats.skipped || 0); }, 0);
    b.failed = jobs.reduce(function (n, j) { return n + (j.stats.failed || 0); }, 0);
    b.finishedAt = stamp();
    b.status = b.failCount === 0 ? '已完成' : (b.okCount === 0 ? '全部失败' : '部分失败');
    save();
    return b;
  }

  /**
   * 入库：以「一个文件」为原子单位
   * input  同 analyzeImport
   * meta   { batchId, wordbookId（继续导入时传）, name, category, bookVersion,
   *          schoolStage, grade, term, organization, description, operatorId, operatorName }
   * opts   { fillMissing: true }  是否用新导入的数据补齐已有基础单词缺失的音标/音频/释义
   * 返回   { ok, reason?, wordbookId, jobId, stats, analysis }
   */
  function commitImport(input, meta, opts) {
    meta = meta || {}; opts = opts || {};
    var an = analyzeImport(input);
    if (an.mapping.en === undefined || an.mapping.en === null || an.mapping.en === '') {
      return { ok: false, reason: '未识别出英文单词列，无法入库', analysis: an };
    }
    if (an.mapping.cn === undefined || an.mapping.cn === null || an.mapping.cn === '') {
      return { ok: false, reason: '未识别出中文释义列，无法入库', analysis: an };
    }
    if (!an.entries.length) {
      return { ok: false, reason: '没有可入库的有效单词（缺必填 ' + an.missingRequired + ' 行，重复 ' + an.dupInFile + ' 行）', analysis: an };
    }
    var target = meta.wordbookId ? wordbook(meta.wordbookId) : null;
    if (meta.wordbookId && !target) return { ok: false, reason: '目标词库不存在', analysis: an };

    var name = String(meta.name || '').trim()
      || String(input.fileName || '').replace(/\.(xlsx|xls|csv)$/i, '').trim();
    if (!name && !target) return { ok: false, reason: '词库名称不能为空', analysis: an };

    var snap = JSON.stringify(db);
    var createdWords = 0, createdLinks = 0, filled = 0;
    try {
      var at = stamp();
      var wb = target;
      if (!wb) {
        wb = {
          id: 'WB' + seq('WB', 3), name: name,
          category: meta.category || '其他',
          bookVersion: meta.bookVersion || '', schoolStage: meta.schoolStage || '',
          grade: meta.grade || '', term: meta.term || '', organization: meta.organization || '',
          description: meta.description || '', sourceFile: input.fileName || '',
          wordCount: 0, status: '启用', createdAt: at, updatedAt: at
        };
        db.wordbooks.push(wb);
      } else {
        if (meta.name && String(meta.name).trim() !== wb.name) wb.name = String(meta.name).trim();
        ['category', 'bookVersion', 'schoolStage', 'grade', 'term', 'organization', 'description'].forEach(function (k) {
          if (meta[k] !== undefined && meta[k] !== '') wb[k] = String(meta[k]).trim();
        });
        if (!wb.sourceFile) wb.sourceFile = input.fileName || '';
      }

      var nextSeq = bookLinkCount(wb.id);
      an.entries.forEach(function (e) {
        var base;
        if (e.status === 'existing') {
          base = word(e.wordId);
          if (!base) throw new Error('基础单词不存在：' + e.en);
          if (opts.fillMissing !== false) {
            var changed = false;
            if (!base.ph && e.ph) { base.ph = e.ph; changed = true; }
            if (!base.audio && e.audio) { base.audio = e.audio; changed = true; }
            if ((!base.mean || !base.mean.length) && e.mean.length) { base.mean = e.mean; changed = true; }
            if (changed) { base.updatedAt = at; filled++; }
          }
        } else {
          base = {
            id: 'w' + pad(db.words.length + 1, 2),
            en: e.en, ph: e.ph || '', mean: e.mean, pos: e.pos || '',
            audio: e.audio || '', status: '启用', createdAt: at, updatedAt: at
          };
          db.words.push(base);
          createdWords++;
        }
        nextSeq++;
        db.wordbookWords.push({
          id: 'WW' + seq('WW', 4), wordbookId: wb.id, wordId: base.id, seq: nextSeq,
          sourceFile: input.fileName || '', sourceRow: e.sheetRow || 0, createdAt: at
        });
        createdLinks++;
      });

      wb.wordCount = bookLinkCount(wb.id);
      wb.updatedAt = at;

      var stats = {
        parsedRows: an.parsedRows,
        validRows: an.validRows,
        newWords: createdWords,
        newLinks: createdLinks,
        existingWords: an.existingWords,
        dupInFile: an.dupInFile,
        inBook: an.inBook,
        missingRequired: an.missingRequired,
        badFormat: an.badFormat,
        skipped: an.dupInFile + an.inBook,
        failed: an.missingRequired + an.badFormat,
        filled: filled
      };
      var job = {
        id: 'IJ' + seq('IJ', 4),
        batchId: meta.batchId || '',
        wordbookId: wb.id,
        wordbookName: wb.name,
        fileName: input.fileName || '',
        fileSize: input.fileSize || 0,
        sheetName: input.sheetName || '',
        headerRow: input.headerRow || 0,
        dataStartRow: an.dataStartRow,
        mapping: an.mapping,
        operatorId: meta.operatorId || 'A001',
        operatorName: meta.operatorName || '张敏',
        createdAt: at,
        status: '已入库',
        stats: stats,
        failedRows: an.failedRows,
        issues: an.issues.slice(0, 50)
      };
      db.importJobs.push(job);
      save();
      return { ok: true, wordbookId: wb.id, jobId: job.id, stats: stats, analysis: an };
    } catch (e) {
      db = JSON.parse(snap);       // 回滚：不留半个词库
      return { ok: false, reason: '写入失败，已回滚：' + e.message, analysis: an };
    }
  }

  /** 记录一次失败的文件（解析阶段就挂了，没有产生任何写入） */
  function recordImportFailure(input, reason, meta) {
    meta = meta || {};
    var at = stamp();
    var job = {
      id: 'IJ' + seq('IJ', 4),
      batchId: meta.batchId || '',
      wordbookId: '', wordbookName: '',
      fileName: (input && input.fileName) || '',
      fileSize: (input && input.fileSize) || 0,
      sheetName: (input && input.sheetName) || '',
      headerRow: 0, dataStartRow: 0, mapping: {},
      operatorId: meta.operatorId || 'A001',
      operatorName: meta.operatorName || '张敏',
      createdAt: at, status: '失败',
      stats: {
        parsedRows: 0, validRows: 0, newWords: 0, newLinks: 0, existingWords: 0,
        dupInFile: 0, inBook: 0, missingRequired: 0, badFormat: 0,
        skipped: 0, failed: 0, filled: 0
      },
      failedRows: (input && input.failedRows) || [],
      issues: [],
      error: reason || '未知错误'
    };
    db.importJobs.push(job);
    save();
    return job;
  }

  /** 失败行 CSV（带 BOM，Excel 直接打开不乱码） */
  function failedRowsCsv(jobId) {
    var job = importJob(jobId);
    if (!job) fail('导入记录不存在');
    var head = ['行号', '英文', '中文释义', '失败原因', '原始行'];
    var lines = [head.join(',')];
    function esc(v) {
      var s = String(v == null ? '' : v);
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }
    (job.failedRows || []).forEach(function (r) {
      lines.push([r.row, r.en, r.cn, r.reason, r.raw].map(esc).join(','));
    });
    if (!job.failedRows || !job.failedRows.length) {
      lines.push(['', '', '', job.error || '无失败行', ''].map(esc).join(','));
    }
    return '\ufeff' + lines.join('\r\n');
  }

  /* ============================================================
     教师资源池：兼职教师全生命周期
     ------------------------------------------------------------
     新教师录入 → 资料完善 → 开通账号 → 启用（可授课）→ 分配学员 → 排课授课
                → 暂停合作 ⇄ 恢复合作
                → 正式退出合作（学员与课程交接）→ 重新加入（复用原档案）
     关键约束（与验收场景一一对应）：
       · 教师编号全局唯一；同机构手机号唯一；档案永不物理删除。
       · 同一学员同一时间最多一条「当前有效」负责关系。
       · 历史课程永不被教师资料变更或改派覆盖。
       · 有学员关系或有未来有效课程时，退出流程必须先把它们处理掉。
       · 每个写操作都在 Store 内部校验角色，页面隐藏按钮只是体验层。
     ============================================================ */

  var MONTH = TODAY.slice(0, 7);
  var EDITABLE_FIELDS = ['name', 'phone', 'gender', 'school', 'major', 'education',
    'introduction', 'remark', 'grades', 'textbooks', 'teachingTags',
    'teachingExperience', 'teachingStyle', 'availability'];

  /* ---------- 会话与权限 ---------- */
  function setSession(s) {
    s = s || {};
    if (s.role) session.role = s.role;
    if (s.operatorName) { session.operatorName = s.operatorName; session.operatorId = s.operatorName; }
    if (s.operatorId) session.operatorId = s.operatorId;
    /* 教师身份单独记：教师端所有「我的 / 自己的」判断都靠它，不靠姓名猜 */
    if ('teacherId' in s) session.teacherId = s.teacherId || '';
    saveSession();
    return clone(session);
  }
  function currentSession() { return clone(session); }
  function can(action) { return (PERMS[action] || []).indexOf(session.role) >= 0; }
  function assertCan(action) {
    if (!can(action)) {
      var e = new Error('当前角色（' + (ROLE_LABEL[session.role] || session.role) +
        '）无权执行该操作：' + action);
      e.code = 'FORBIDDEN';
      e.action = action;
      throw e;
    }
  }
  function bizError(code, msg, data) {
    var e = new Error(msg);
    e.code = code;
    e.data = data || null;
    return e;
  }

  /* ---------- 小工具 ---------- */
  function toList(v) {
    if (Array.isArray(v)) {
      return v.map(function (x) { return String(x == null ? '' : x).trim(); }).filter(Boolean);
    }
    return String(v == null ? '' : v).split(/[、,，\/]+/)
      .map(function (x) { return x.trim(); }).filter(Boolean);
  }
  function minutesOf(c) {
    var a = String(c.start || '0:0').split(':'), b = String(c.end || '0:0').split(':');
    var m = (Number(b[0]) * 60 + Number(b[1])) - (Number(a[0]) * 60 + Number(a[1]));
    return m > 0 ? m : 0;
  }
  function courseHours(c) { return Math.round(minutesOf(c) / 60 * 10) / 10; }
  function isCourseDone(c) { return c.status === COURSE_STATUS.DONE; }
  function round1(n) { return Math.round(n * 10) / 10; }

  /* ---------- 查询 ---------- */
  function teachers() { return db.teachers; }
  function teacherByPhone(phone) {
    var p = String(phone || '').trim();
    if (!p) return null;
    return db.teachers.filter(function (t) { return t.phone === p; })[0] || null;
  }
  function teacherByCode(code) {
    var c = String(code || '').trim();
    return db.teachers.filter(function (t) { return t.code === c; })[0] || null;
  }
  function accountOf(teacherId) {
    var t = teacher(teacherId);
    if (t && t.accountId) {
      var u = db.users.filter(function (x) { return x.id === t.accountId; })[0];
      if (u) return u;
    }
    return db.users.filter(function (u) { return u.teacherId === teacherId; })[0] || null;
  }
  function accountStatusOf(teacherId) {
    var u = accountOf(teacherId);
    return u ? u.status : ACCOUNT.NONE;
  }
  function userById(id) { return db.users.filter(function (u) { return u.id === id; })[0] || null; }

  function teacherFacets() {
    var g = {}, b = {}, sc = {};
    db.teachers.forEach(function (t) {
      t.grades.forEach(function (x) { g[x] = (g[x] || 0) + 1; });
      t.textbooks.forEach(function (x) { b[x] = (b[x] || 0) + 1; });
      if (t.school) sc[t.school] = (sc[t.school] || 0) + 1;
    });
    return {
      grades: TEACHER_GRADES.filter(function (x) { return g[x]; }),
      textbooks: TEACHER_TEXTBOOKS.filter(function (x) { return b[x]; }),
      schools: Object.keys(sc).sort()
    };
  }

  function teacherStat(id) {
    var t = teacher(id);
    if (!t) return null;
    var courses = db.courses.filter(function (c) { return c.teacherId === id; });
    var done = courses.filter(isCourseDone);
    var monthDone = done.filter(function (c) { return String(c.date).slice(0, 7) === MONTH; });
    var cancelled = courses.filter(function (c) { return c.status === COURSE_STATUS.CANCELLED; }).length;
    var missed = courses.filter(function (c) { return c.status === COURSE_STATUS.MISSED; }).length;
    var rels = db.teacherStudents.filter(function (r) { return r.teacherId === id; });
    var act = rels.filter(function (r) { return r.status === REL.ACTIVE; });
    var stuSet = {};
    rels.forEach(function (r) { stuSet[r.studentId] = 1; });
    var sorted = done.slice().sort(function (a, b) {
      return (a.date + a.start) < (b.date + b.start) ? 1 : -1;
    });
    var months = {};
    done.forEach(function (c) {
      var k = String(c.date).slice(0, 7);
      months[k] = months[k] || { count: 0, hours: 0 };
      months[k].count++;
      months[k].hours = round1(months[k].hours + courseHours(c));
    });
    var settled = done.length + cancelled + missed;
    var reports = db.reports.filter(function (r) { return r.teacherId === id; });
    return {
      id: id, code: t.code, name: t.name,
      cooperationStatus: t.cooperationStatus, accountStatus: accountStatusOf(id),
      currentStudents: act.length,
      totalStudents: Object.keys(stuSet).length,
      courses: courses.length,
      doneCourses: done.length,
      doneHours: round1(done.reduce(function (n, c) { return n + courseHours(c); }, 0)),
      monthCourses: monthDone.length,
      monthHours: round1(monthDone.reduce(function (n, c) { return n + courseHours(c); }, 0)),
      cancelledCourses: cancelled,
      missedCourses: missed,
      completionRate: settled ? Math.round(done.length / settled * 100) : 0,
      lastCourseAt: sorted.length ? sorted[0].date : '',
      futureCourses: futureCoursesOf(id).length,
      monthsBy: months,
      reportCount: reports.length,
      draftReports: reports.filter(function (r) { return r.status === REPORT_STATUS.DRAFT; }).length
    };
  }

  function teacherOverview() {
    var o = { total: db.teachers.length, ready: 0, pending: 0, paused: 0, exited: 0,
      teachingThisMonth: 0, activeAccounts: 0, draftReports: 0 };
    db.teachers.forEach(function (t) {
      if (t.cooperationStatus === COOP.READY) o.ready++;
      else if (t.cooperationStatus === COOP.PENDING) o.pending++;
      else if (t.cooperationStatus === COOP.PAUSED) o.paused++;
      else if (t.cooperationStatus === COOP.EXITED) o.exited++;
    });
    var set = {};
    db.courses.forEach(function (c) {
      if (isCourseDone(c) && String(c.date).slice(0, 7) === MONTH && c.teacherId) set[c.teacherId] = 1;
    });
    o.teachingThisMonth = Object.keys(set).length;
    o.activeAccounts = db.users.filter(function (u) { return u.status === ACCOUNT.OK; }).length;
    o.draftReports = db.reports.filter(function (r) { return r.status === REPORT_STATUS.DRAFT; }).length;
    return o;
  }

  var COOP_ORDER = {};
  COOP_STATUS.forEach(function (s, i) { COOP_ORDER[s] = i; });

  /** 教师列表查询：所有筛选条件都作用在真实数据上，不写死任何统计 */
  function searchTeachers(q) {
    q = q || {};
    var kw = String(q.kw || '').trim().toLowerCase();
    var list = db.teachers.filter(function (t) {
      var stat = teacherStat(t.id);
      if (kw && !(t.name.toLowerCase().indexOf(kw) >= 0 ||
        t.phone.indexOf(kw) >= 0 || String(t.code).toLowerCase().indexOf(kw) >= 0)) return false;
      if (q.grade && t.grades.indexOf(q.grade) < 0) return false;
      if (q.textbook && t.textbooks.indexOf(q.textbook) < 0) return false;
      if (q.coop && t.cooperationStatus !== q.coop) return false;
      if (q.account && stat.accountStatus !== q.account) return false;
      if (q.school && t.school !== q.school) return false;
      if (q.students === 'zero' && stat.currentStudents !== 0) return false;
      if (q.students === 'low' && !(stat.currentStudents >= 1 && stat.currentStudents <= 2)) return false;
      if (q.students === 'high' && stat.currentStudents < 3) return false;
      if (q.recent === 'month' && !(stat.lastCourseAt && stat.lastCourseAt.slice(0, 7) === MONTH)) return false;
      if (q.recent === 'd30' && !(stat.lastCourseAt && stat.lastCourseAt >= addDays(TODAY, -30))) return false;
      if (q.recent === 'never' && stat.lastCourseAt) return false;
      if (q.joinFrom && (!t.lastCooperationStartAt || t.lastCooperationStartAt < q.joinFrom)) return false;
      if (q.joinTo && (!t.lastCooperationStartAt || t.lastCooperationStartAt > q.joinTo)) return false;
      return true;
    });
    list.sort(function (a, b) {
      var d = (COOP_ORDER[a.cooperationStatus] || 0) - (COOP_ORDER[b.cooperationStatus] || 0);
      return d !== 0 ? d : (a.code < b.code ? -1 : 1);
    });
    return list.map(function (t) {
      var out = clone(t);
      out.stat = teacherStat(t.id);
      return out;
    });
  }

  /**
   * 可授课教师池：排课 / 分配学员的唯一候选来源。
   * 硬约束只有一条——暂停合作与已退出教师永远不出现（不能作为普通可选项）。
   * 年级 / 教材 / 可授课时间属于「优先条件」：匹配的排在前面并给出命中标记，
   * 不匹配的仍然保留在后面，由人工判断（避免小学员因年级字段微差而无候选可用）。
   * opt.strict = true 时退化为「只看匹配项」，用于纯推荐场景。
   */
  function teacherPool(opt) {
    opt = opt || {};
    var wantTime = !!(opt.weekday && opt.period);
    var list = db.teachers.filter(function (t) {
      return t.cooperationStatus === COOP.READY;
    }).map(function (t) {
      var gHit = !opt.grade || t.grades.indexOf(opt.grade) >= 0;
      var bHit = !opt.textbook || t.textbooks.indexOf(opt.textbook) >= 0;
      var tHit = !wantTime || t.availability.some(function (a) {
        return a.weekday === opt.weekday && a.period === opt.period;
      });
      var score = (opt.grade && gHit ? 3 : 0) +
        (opt.textbook && bHit ? 2 : 0) +
        (wantTime && tHit ? 2 : 0);
      var miss = [];
      if (opt.grade && !gHit) miss.push('年级不符');
      if (opt.textbook && !bHit) miss.push('教材不符');
      if (wantTime && !tHit) miss.push('时间不符');
      return {
        teacher: t, stat: teacherStat(t.id), score: score,
        match: { grade: gHit, textbook: bHit, time: tHit },
        miss: miss, full: miss.length === 0
      };
    });
    if (opt.strict) list = list.filter(function (x) { return x.full; });
    return list.sort(function (a, b) {
      if (b.score !== a.score) return b.score - a.score;
      return a.stat.currentStudents - b.stat.currentStudents;
    });
  }

  function teacherRanking(opt) {
    opt = opt || {};
    return db.teachers.filter(function (t) {
      return opt.includeExited ? true : t.cooperationStatus !== COOP.EXITED;
    }).map(function (t) { return teacherStat(t.id); })
      .sort(function (a, b) { return b.monthCourses - a.monthCourses || b.doneCourses - a.doneCourses; })
      .slice(0, opt.limit || 5);
  }

  function availabilityText(t) {
    if (typeof t === 'string') t = teacher(t);
    if (!t || !t.availability || !t.availability.length) return '未设置';
    var map = {};
    t.availability.forEach(function (a) {
      map[a.weekday] = map[a.weekday] || [];
      if (map[a.weekday].indexOf(a.period) < 0) map[a.weekday].push(a.period);
    });
    return WEEKDAYS.filter(function (d) { return map[d]; }).map(function (d) {
      return d + ' ' + PERIODS.filter(function (p) { return map[d].indexOf(p) >= 0; }).join('/');
    }).join('；');
  }

  function normalizeAvailability(list) {
    var out = [], seen = {};
    (list || []).forEach(function (a) {
      if (!a) return;
      var w, p, note = '';
      if (typeof a === 'string') {
        var parts = a.split('|');
        w = parts[0]; p = parts[1];
      } else { w = a.weekday; p = a.period; note = a.note || ''; }
      if (WEEKDAYS.indexOf(w) < 0 || PERIODS.indexOf(p) < 0) return;
      var k = w + '|' + p;
      if (seen[k]) return;
      seen[k] = 1;
      out.push({ id: 'TAV' + seq('TAV', 3), weekday: w, period: p, note: note });
    });
    return out;
  }

  /* ---------- 师生关系 ---------- */
  function relationsOfTeacher(id, status) {
    return db.teacherStudents.filter(function (r) {
      return r.teacherId === id && (!status || r.status === status);
    }).sort(function (a, b) { return a.startAt < b.startAt ? 1 : -1; });
  }
  function currentRelationsOf(id) { return relationsOfTeacher(id, REL.ACTIVE); }
  function historyRelationsOf(id) { return relationsOfTeacher(id, REL.ENDED); }
  function activeRelationOfStudent(studentId) {
    return db.teacherStudents.filter(function (r) {
      return r.studentId === studentId && r.status === REL.ACTIVE;
    })[0] || null;
  }
  function relationsOfStudent(studentId) {
    return db.teacherStudents.filter(function (r) { return r.studentId === studentId; })
      .sort(function (a, b) { return a.startAt < b.startAt ? 1 : -1; });
  }
  function currentStudentsOf(id) {
    return currentRelationsOf(id).map(function (r) {
      var s = student(r.studentId);
      if (!s) return null;
      var last = db.courses.filter(function (c) {
        return c.studentId === s.id && isCourseDone(c);
      }).sort(function (a, b) { return a.date < b.date ? 1 : -1; })[0];
      return {
        student: s, relation: r, remain: s.remain,
        lastCourseAt: last ? last.date : '',
        futureCourses: db.courses.filter(function (c) {
          return c.studentId === s.id && c.date >= TODAY &&
            (c.status === COURSE_STATUS.PENDING || c.status === COURSE_STATUS.ONGOING);
        }).length
      };
    }).filter(Boolean);
  }
  function historyStudentsOf(id) {
    return historyRelationsOf(id).map(function (r) {
      var s = student(r.studentId);
      var done = db.courses.filter(function (c) {
        return c.studentId === r.studentId && c.teacherId === id && isCourseDone(c) &&
          c.date >= r.startAt && (!r.endAt || c.date <= r.endAt);
      }).length;
      return {
        student: s || { id: r.studentId, name: r.studentId, grade: '—', remain: 0, status: '—' },
        relation: r, doneCourses: done
      };
    });
  }
  function syncStudentCache(studentId) {
    var s = student(studentId);
    if (!s) return;
    var act = activeRelationOfStudent(studentId);
    var t = act ? teacher(act.teacherId) : null;
    s.teacher = t ? t.id : '';
    s.teacherName = t ? t.name : '未分配';
  }

  function futureCoursesOf(id) {
    return db.courses.filter(function (c) {
      return c.teacherId === id && c.date >= TODAY &&
        (c.status === COURSE_STATUS.PENDING || c.status === COURSE_STATUS.ONGOING);
    }).sort(function (a, b) { return (a.date + a.start) < (b.date + b.start) ? -1 : 1; });
  }
  function pendingRecordsOf(id) {
    return db.courseRecords.filter(function (r) {
      return r.teacherId === id && isOpen(r.status);
    });
  }
  function teacherAlerts(id) {
    var act = currentRelationsOf(id);
    return {
      future: futureCoursesOf(id).length,
      students: act.length,
      attention: act.filter(function (r) { return !!r.attention; }).length,
      drafts: db.reports.filter(function (r) {
        return r.teacherId === id && r.status === REPORT_STATUS.DRAFT;
      }).length,
      needsAdjust: db.courses.filter(function (c) { return c.teacherId === id && c.needsAdjust; }).length
    };
  }

  /* ---------- 启用 / 退出前置检查 ---------- */
  function activationCheck(id) {
    var t = teacher(id);
    if (!t) return null;
    var acc = accountOf(id);
    var items = [
      { key: 'basic', label: '姓名与手机号已填写', ok: !!t.name && /^1[3-9]\d{9}$/.test(t.phone) },
      /* 账号「存在」即算准备就绪；被禁用的账号会在启用时自动恢复登录 */
      { key: 'account', label: '登录账号已开通', ok: !!acc,
        hint: acc ? ('账号状态：' + acc.status) : '需先开通登录账号' },
      { key: 'grades', label: '已填写擅长年级', ok: t.grades.length > 0 },
      { key: 'textbooks', label: '已填写擅长教材', ok: t.textbooks.length > 0 },
      { key: 'availability', label: '已填写可授课时间', ok: t.availability.length > 0 },
      { key: 'capability', label: '教学经验或教学特点已填写', ok: !!(t.teachingExperience || t.teachingStyle) }
    ];
    var required = (db.config.teacher && db.config.teacher.activationRequired) ||
      ['basic', 'account', 'grades'];
    var missing = items.filter(function (x) { return required.indexOf(x.key) >= 0 && !x.ok; });
    return {
      teacher: t, items: items, required: required,
      ready: missing.length === 0,
      missing: missing.map(function (x) { return x.label; }),
      accountStatus: acc ? acc.status : ACCOUNT.NONE,
      status: t.cooperationStatus
    };
  }

  function exitCheck(id) {
    var t = teacher(id);
    if (!t) return null;
    var students = currentStudentsOf(id);
    var future = futureCoursesOf(id);
    var todayPending = db.courses.filter(function (c) {
      return c.teacherId === id && c.date === TODAY &&
        (c.status === COURSE_STATUS.PENDING || c.status === COURSE_STATUS.ONGOING);
    });
    var drafts = db.reports.filter(function (r) {
      return r.teacherId === id &&
        (r.status === REPORT_STATUS.DRAFT || r.status === REPORT_STATUS.SUBMITTED);
    });
    var anomalies = db.courses.filter(function (c) {
      return c.teacherId === id && isCourseDone(c) && c.deductState === '扣课异常';
    });
    var blocks = [];
    if (students.length) {
      blocks.push({ key: 'students', count: students.length,
        label: '当前还有 ' + students.length + ' 名学员由该教师负责，需先转交或解除关系' });
    }
    if (future.length) {
      blocks.push({ key: 'courses', count: future.length,
        label: '还有 ' + future.length + ' 节未来有效课程未处理，需先改派、取消或标记待调整' });
    }
    return {
      teacher: t, students: students, futureCourses: future, todayPending: todayPending,
      pendingRecords: pendingRecordsOf(id), draftReports: drafts, anomalies: anomalies,
      accountStatus: accountStatusOf(id),
      blocks: blocks, ready: blocks.length === 0
    };
  }

  /* ---------- 写操作：留痕工具 ---------- */
  function logCoop(teacherId, action, opt) {
    opt = opt || {};
    var c = {
      id: 'TCH' + seq('TCH', 3), teacherId: teacherId,
      action: COOP_ACTION[action] ? action : COOP_ACTION.CREATED,
      reason: opt.reason || '',
      effectiveAt: opt.effectiveAt || (TODAY + ' ' + clock()),
      operatorId: session.operatorId, operatorName: session.operatorName,
      remark: opt.remark || '', createdAt: stamp()
    };
    db.teacherCooperations.push(c);
    return c;
  }
  function logChange(teacherId, field, oldV, newV, opt) {
    function s(v) {
      if (v == null) return '';
      if (Array.isArray(v)) {
        return v.map(function (x) {
          return (x && typeof x === 'object')
            ? String(x.weekday || '') + String(x.period || '') + (x.note ? '（' + x.note + '）' : '')
            : String(x);
        }).filter(Boolean).join('、');
      }
      return String(v);
    }
    var o = s(oldV), n = s(newV);
    if (o === n) return null;
    var c = {
      id: 'TCL' + seq('TCL', 3), teacherId: teacherId, fieldName: field,
      oldValue: o, newValue: n, operatorId: session.operatorName,
      createdAt: stamp(), remark: (opt && opt.remark) || ''
    };
    db.teacherChanges.push(c);
    return c;
  }

  function enableAccount(teacherId, reason) {
    var u = accountOf(teacherId);
    if (!u) return null;
    try {
      u.status = ACCOUNT.OK;
      u.disabledAt = '';
      u.updatedAt = stamp();
    } catch (e) {
      throw bizError('ACCOUNT_ENABLE_FAILED', '教师账号启用失败，操作已中止：' + e.message);
    }
    logCoop(teacherId, COOP_ACTION.ACCOUNT_ENABLED, { reason: reason || '恢复登录账号', remark: '登录名 ' + u.loginName });
    return u;
  }
  function disableAccount(teacherId, reason) {
    var u = accountOf(teacherId);
    if (!u) return null;
    if (u.status === ACCOUNT.DISABLED) return u;
    try {
      u.status = ACCOUNT.DISABLED;
      u.disabledAt = stamp();
      u.updatedAt = stamp();
    } catch (e) {
      /* 账号没能真正禁用时绝不允许把教师标记成已退出/已暂停 */
      throw bizError('ACCOUNT_DISABLE_FAILED', '教师账号禁用失败，操作已中止：' + e.message);
    }
    logCoop(teacherId, COOP_ACTION.ACCOUNT_DISABLED, { reason: reason || '禁用登录账号' });
    return u;
  }

  /* ---------- 新增 / 编辑 ---------- */
  function createTeacher(input, opt) {
    assertCan('teacher.create');
    input = input || {};
    opt = opt || {};
    var name = String(input.name || '').trim();
    var phone = String(input.phone || '').trim();
    if (!name) throw bizError('NAME_REQUIRED', '请填写教师姓名');
    if (name.length > 20) throw bizError('NAME_INVALID', '教师姓名不能超过 20 个字');
    if (!/^1[3-9]\d{9}$/.test(phone)) throw bizError('PHONE_INVALID', '手机号格式不正确（应以 1 开头的 11 位号码）');

    var exist = teacherByPhone(phone);
    if (exist) {
      if (exist.cooperationStatus === COOP.EXITED) {
        throw bizError('PHONE_EXITED',
          '手机号 ' + phone + ' 属于已退出合作的教师「' + exist.name + '」（' + exist.code +
          '）。同一自然人不能重复建档，请查看原档案并选择「重新加入」。',
          { teacher: exist });
      }
      throw bizError('PHONE_DUPLICATE',
        '手机号 ' + phone + ' 已被教师「' + exist.name + '」（' + exist.code + '）使用',
        { teacher: exist });
    }

    var n = Number(db.meta.seq.TC || 0) + 1;
    while (db.teachers.some(function (t) { return t.code === 'T' + pad(n, 3); })) n++;
    db.meta.seq.TC = n;
    var code = 'T' + pad(n, 3);
    var now = stamp();
    var t = {
      id: code, code: code, name: name, phone: phone,
      gender: input.gender || '', school: String(input.school || '').trim(),
      major: String(input.major || '').trim(), education: input.education || '',
      introduction: String(input.introduction || '').trim(),
      remark: String(input.remark || '').trim(),
      grades: toList(input.grades), textbooks: toList(input.textbooks),
      teachingTags: toList(input.teachingTags),
      teachingExperience: String(input.teachingExperience || '').trim(),
      teachingStyle: String(input.teachingStyle || '').trim(),
      availability: normalizeAvailability(input.availability),
      cooperationStatus: COOP.PENDING, accountId: '',
      firstCooperationAt: '', lastCooperationStartAt: '', cooperationEndAt: '',
      pauseInfo: null, rejoinCount: 0,
      createdBy: session.operatorName, createdAt: now, updatedAt: now
    };
    db.teachers.push(t);
    logCoop(t.id, COOP_ACTION.CREATED, {
      reason: opt.reason || '新教师录入（待启用）',
      effectiveAt: now, remark: opt.remark || ''
    });
    save();
    return t;
  }

  function updateTeacher(id, patch, opt) {
    assertCan('teacher.edit');
    var t = teacher(id);
    if (!t) throw bizError('NOT_FOUND', '教师不存在');
    patch = patch || {};
    opt = opt || {};
    var changes = 0;

    if (patch.name !== undefined) {
      var nm = String(patch.name || '').trim();
      if (!nm) throw bizError('NAME_REQUIRED', '教师姓名不能为空');
      if (nm.length > 20) throw bizError('NAME_INVALID', '教师姓名不能超过 20 个字');
      if (nm !== t.name) {
        logChange(id, 'name', t.name, nm, opt);
        t.name = nm;
        /* 姓名是展示缓存：课程与学员上冗余的姓名同步刷新，
           但历史课程的 teacherId / 授课事实不变 */
        db.courses.forEach(function (c) { if (c.teacherId === id) c.teacher = nm; });
        db.students.forEach(function (s) { if (s.teacher === id) s.teacherName = nm; });
        changes++;
      }
    }
    if (patch.phone !== undefined) {
      var ph = String(patch.phone || '').trim();
      if (!/^1[3-9]\d{9}$/.test(ph)) throw bizError('PHONE_INVALID', '手机号格式不正确');
      var ex = teacherByPhone(ph);
      if (ex && ex.id !== id) {
        throw bizError(ex.cooperationStatus === COOP.EXITED ? 'PHONE_EXITED' : 'PHONE_DUPLICATE',
          '手机号 ' + ph + ' 已被教师「' + ex.name + '」（' + ex.code + '）使用', { teacher: ex });
      }
      if (ph !== t.phone) {
        logChange(id, 'phone', t.phone, ph, opt);
        t.phone = ph;
        var acc = accountOf(id);
        if (acc) { acc.phone = ph; acc.loginName = ph; acc.updatedAt = stamp(); }
        changes++;
      }
    }
    ['gender', 'school', 'major', 'education', 'introduction', 'remark',
      'teachingExperience', 'teachingStyle'].forEach(function (f) {
      if (patch[f] === undefined) return;
      var v = String(patch[f] || '');
      if (v !== (t[f] || '')) { logChange(id, f, t[f], v, opt); t[f] = v; changes++; }
    });
    ['grades', 'textbooks', 'teachingTags'].forEach(function (f) {
      if (patch[f] === undefined) return;
      var v = toList(patch[f]);
      if (v.join('、') !== (t[f] || []).join('、')) {
        logChange(id, f, t[f], v, opt); t[f] = v; changes++;
      }
    });
    if (patch.availability !== undefined) {
      var av = normalizeAvailability(patch.availability);
      var key = function (list) {
        return list.map(function (x) { return x.weekday + '|' + x.period; }).sort().join(',');
      };
      if (key(av) !== key(t.availability)) {
        logChange(id, 'availability', t.availability, av, opt);
        t.availability = av;
        changes++;
      }
    }
    t.updatedAt = stamp();
    save();
    return { teacher: t, changes: changes };
  }

  function setAvailability(id, slots, opt) {
    return updateTeacher(id, { availability: slots }, opt);
  }

  /* ---------- 账号 ---------- */
  function openTeacherAccount(id, opt) {
    assertCan('teacher.account');
    opt = opt || {};
    var t = teacher(id);
    if (!t) throw bizError('NOT_FOUND', '教师不存在');
    if (t.cooperationStatus === COOP.EXITED) {
      throw bizError('TEACHER_EXITED', '该教师已退出合作，请先「重新加入」再开通账号');
    }
    var exist = accountOf(id);
    if (exist) {
      throw bizError('ACCOUNT_EXISTS',
        '该教师已开通账号（登录名 ' + exist.loginName + '），无需重复开通', { account: exist });
    }
    if (!t.phone) throw bizError('PHONE_REQUIRED', '请先填写手机号，手机号即登录名');
    if (db.users.some(function (u) { return u.loginName === t.phone; })) {
      throw bizError('LOGIN_DUPLICATE', '登录名（手机号）已被其他账号占用');
    }
    var now = stamp();
    var u = {
      id: 'UA' + seq('UA', 3), loginName: t.phone, phone: t.phone,
      /* 原型不保存明文口令，也不伪造哈希：真实系统在此写入加密凭据 */
      passwordHash: '', mustChangePassword: true,
      status: ACCOUNT.OK, roleId: 'teacher', teacherId: t.id,
      openedAt: now, openedBy: session.operatorName, disabledAt: '',
      inviteChannel: opt.inviteChannel || '短信邀请',
      createdAt: now, updatedAt: now
    };
    db.users.push(u);
    t.accountId = u.id;
    t.updatedAt = now;
    logCoop(t.id, COOP_ACTION.ACCOUNT_OPENED, {
      reason: '为教师开通登录账号',
      effectiveAt: now, remark: '登录名 ' + u.loginName + '，角色 teacher'
    });
    logChange(t.id, 'accountId', '', u.id);
    save();
    return u;
  }

  /* ---------- 账号状态（单独入口，便于权限与留痕统一校验） ---------- */
  function setAccountStatus(teacherId, status, opt) {
    assertCan('teacher.account');
    opt = opt || {};
    var u = accountOf(teacherId);
    if (!u) throw bizError('NO_ACCOUNT', '该教师还没有登录账号');
    if (status !== ACCOUNT.OK && status !== ACCOUNT.DISABLED) {
      throw bizError('BAD_STATUS', '账号状态只能设置为「正常」或「已禁用」');
    }
    if (u.status === status) return u;
    if (status === ACCOUNT.OK) enableAccount(teacherId, opt.reason || '手动启用账号');
    else disableAccount(teacherId, opt.reason || '手动禁用账号');
    save();
    return u;
  }

  /* ---------- 启用 / 暂停 / 恢复 ---------- */
  function activateTeacher(id, opt) {
    assertCan('teacher.activate');
    opt = opt || {};
    var t = teacher(id);
    if (!t) throw bizError('NOT_FOUND', '教师不存在');
    if (t.cooperationStatus === COOP.READY) throw bizError('ALREADY_READY', '该教师已是「可授课」状态');
    if (t.cooperationStatus === COOP.PAUSED) throw bizError('IS_PAUSED', '该教师处于暂停合作，请使用「恢复合作」');
    if (t.cooperationStatus === COOP.EXITED) throw bizError('IS_EXITED', '该教师已退出合作，请先「重新加入」再启用');

    var chk = activationCheck(id);
    if (!chk.ready) {
      throw bizError('NOT_READY', '还不能启用：' + chk.missing.join('；'), { check: chk });
    }
    var eff = opt.effectiveAt || TODAY;
    t.cooperationStatus = COOP.READY;
    t.lastCooperationStartAt = eff;
    if (!t.firstCooperationAt) t.firstCooperationAt = eff;
    t.cooperationEndAt = '';
    t.pauseInfo = null;
    t.updatedAt = stamp();
    var u = accountOf(id);
    if (u && u.status !== ACCOUNT.OK) enableAccount(id, '随教师启用恢复账号登录');
    logCoop(id, COOP_ACTION.ACTIVATED, {
      reason: opt.reason || '资料与账号就绪，进入可授课资源池',
      effectiveAt: eff + ' ' + clock(), remark: opt.remark || ''
    });
    save();
    return { teacher: t, check: chk };
  }

  function pauseTeacher(id, opt) {
    assertCan('teacher.pause');
    opt = opt || {};
    var t = teacher(id);
    if (!t) throw bizError('NOT_FOUND', '教师不存在');
    if (t.cooperationStatus === COOP.PAUSED) throw bizError('ALREADY_PAUSED', '该教师已处于暂停合作');
    if (t.cooperationStatus !== COOP.READY) throw bizError('NOT_READY_STATE', '只有「可授课」的教师才能暂停合作');
    var reason = String(opt.reason || '').trim();
    if (!reason) throw bizError('REASON_REQUIRED', '请填写暂停原因');

    var future = futureCoursesOf(id);
    var plan = opt.courses || {};
    var unhandled = future.filter(function (c) { return !plan[c.id]; });
    if (unhandled.length) {
      throw bizError('COURSES_UNHANDLED',
        '还有 ' + unhandled.length + ' 节未来有效课程未处理，请先逐节决定「保留 / 改派 / 取消」',
        { courses: future });
    }
    future.forEach(function (c) {
      var p = plan[c.id];
      if (p.action === 'reassign') {
        var nt = teacher(p.toTeacherId);
        if (!nt) throw bizError('TARGET_NOT_FOUND', '课程 ' + c.id + ' 指定的接替教师不存在');
        if (nt.id === id) throw bizError('TARGET_SELF', '课程 ' + c.id + ' 不能改派给本人');
        if (nt.cooperationStatus !== COOP.READY) {
          throw bizError('TARGET_NOT_READY', '接替教师「' + nt.name + '」当前不是可授课状态');
        }
      } else if (p.action !== 'cancel' && p.action !== 'keep') {
        throw bizError('BAD_ACTION', '课程 ' + c.id + ' 的处理方式无效：' + p.action);
      }
    });

    var snap = JSON.stringify(db);
    try {
      future.forEach(function (c) {
        var p = plan[c.id];
        if (p.action === 'reassign') {
          reassignCourse(c.id, p.toTeacherId, { reason: p.reason || '教师暂停合作，课程改派' });
        } else if (p.action === 'cancel') {
          cancelCourse(c.id, '教师暂停合作，课程取消');
        } else {
          c.needsAdjust = true;
          c.note = (c.note ? c.note + '；' : '') + '教师暂停合作，本课待教务确认';
        }
      });
      t.cooperationStatus = COOP.PAUSED;
      t.pauseInfo = {
        reason: reason, startAt: opt.startAt || TODAY,
        expectResumeAt: opt.expectResumeAt || '', remark: opt.remark || '',
        by: session.operatorName, at: stamp()
      };
      t.updatedAt = stamp();
      if (!db.config.teacher || db.config.teacher.pauseDisableLogin !== false) {
        disableAccount(id, '教师暂停合作，按机构策略禁用登录');
      }
      /* 当前学员关系保留，只打关注标记：暂停不等于解除归属 */
      db.teacherStudents.forEach(function (r) {
        if (r.teacherId === id && r.status === REL.ACTIVE) {
          r.attention = '教师暂停合作，需教务关注' +
            (opt.expectResumeAt ? '（预计 ' + opt.expectResumeAt + ' 恢复）' : '');
        }
      });
      logCoop(id, COOP_ACTION.PAUSED, {
        reason: reason, effectiveAt: (opt.startAt || TODAY) + ' ' + clock(),
        remark: (opt.remark || '') + (opt.expectResumeAt ? '；预计恢复 ' + opt.expectResumeAt : '')
      });
      save();
      return { teacher: t, future: future, students: currentStudentsOf(id) };
    } catch (e) {
      db = JSON.parse(snap);
      throw bizError(e.code || 'PAUSE_FAILED', '暂停合作未完成，已回滚：' + e.message, e.data);
    }
  }

  function resumeTeacher(id, opt) {
    assertCan('teacher.resume');
    opt = opt || {};
    var t = teacher(id);
    if (!t) throw bizError('NOT_FOUND', '教师不存在');
    if (t.cooperationStatus !== COOP.PAUSED) throw bizError('NOT_PAUSED', '只有「暂停合作」的教师才能恢复合作');
    var useSameAccount = opt.useSameAccount !== false;
    var eff = opt.effectiveAt || TODAY;
    var snap = JSON.stringify(db);
    try {
      t.cooperationStatus = COOP.READY;
      t.pauseInfo = null;
      t.cooperationEndAt = '';
      t.lastCooperationStartAt = eff;
      t.updatedAt = stamp();
      if (useSameAccount) enableAccount(id, '教师恢复合作，重新启用账号登录');
      /* 暂停期间被教务解除的关系不会自动恢复；仍然有效的关系清掉关注标记 */
      db.teacherStudents.forEach(function (r) {
        if (r.teacherId === id && r.status === REL.ACTIVE) r.attention = '';
      });
      logCoop(id, COOP_ACTION.RESUMED, {
        reason: opt.reason || '暂停结束，恢复合作',
        effectiveAt: eff + ' ' + clock(),
        remark: (opt.remark || '') + (useSameAccount ? '' : '；未沿用原账号，需重新开通')
      });
      save();
      return { teacher: t, students: currentStudentsOf(id) };
    } catch (e) {
      db = JSON.parse(snap);
      throw bizError(e.code || 'RESUME_FAILED', '恢复合作未完成，已回滚：' + e.message, e.data);
    }
  }

  /* ---------- 正式退出 / 重新加入 ---------- */
  function exitTeacher(id, plan, opt) {
    assertCan('teacher.exit');
    plan = plan || {};
    opt = opt || {};
    var t = teacher(id);
    if (!t) throw bizError('NOT_FOUND', '教师不存在');
    if (t.cooperationStatus === COOP.EXITED) throw bizError('ALREADY_EXITED', '该教师已退出合作');

    var chk = exitCheck(id);
    var byStudent = {}, byCourse = {};
    (plan.students || []).forEach(function (p) { byStudent[p.studentId] = p; });
    (plan.courses || []).forEach(function (p) { byCourse[p.courseId] = p; });

    var stuSkip = chk.students.filter(function (x) {
      var p = byStudent[x.student.id];
      return !p || !p.action || p.action === 'skip';
    });
    if (stuSkip.length) {
      throw bizError('REMAIN_STUDENTS',
        '还有 ' + stuSkip.length + ' 名学员的负责关系未处理，不能完成退出',
        { students: chk.students, skip: stuSkip });
    }
    var ctSkip = chk.futureCourses.filter(function (c) { return !byCourse[c.id]; });
    if (ctSkip.length) {
      throw bizError('REMAIN_COURSES',
        '还有 ' + ctSkip.length + ' 节未来课程未处理，不能完成退出',
        { courses: chk.futureCourses });
    }

    function checkTarget(nt, name) {
      if (!nt) throw bizError('TARGET_NOT_FOUND', (name || '') + '指定的接替教师不存在');
      if (nt.id === id) throw bizError('TARGET_SELF', (name || '') + '不能把学员或课程转交给本人');
      if (nt.cooperationStatus !== COOP.READY) {
        throw bizError('TARGET_NOT_READY', (name || '') + '接替教师「' + nt.name + '」当前不是可授课状态');
      }
    }
    chk.students.forEach(function (x) {
      var p = byStudent[x.student.id];
      if (p.action === 'reassign') {
        if (!String(p.reason || '').trim()) {
          throw bizError('REASON_REQUIRED', '学员「' + x.student.name + '」的调整原因必填');
        }
        checkTarget(teacher(p.toTeacherId), '学员「' + x.student.name + '」的');
      } else if (p.action !== 'release') {
        throw bizError('BAD_ACTION', '学员「' + x.student.name + '」的处理方式无效：' + p.action);
      }
    });
    chk.futureCourses.forEach(function (c) {
      var p = byCourse[c.id];
      if (p.action === 'reassign') checkTarget(teacher(p.toTeacherId), '课程 ' + c.id + ' 的');
      else if (p.action !== 'cancel' && p.action !== 'keep') {
        throw bizError('BAD_ACTION', '课程 ' + c.id + ' 的处理方式无效：' + p.action);
      }
    });

    var snap = JSON.stringify(db);
    var exitAt = opt.exitAt || TODAY;
    var stats = { transferred: 0, released: 0, coursesReassigned: 0, coursesCancelled: 0, coursesPending: 0 };
    /* 退出前记下所有已完成课程的授课教师：退出流程只允许动未来课程 */
    var historyBefore = {};
    db.courses.forEach(function (c) { if (isCourseDone(c)) historyBefore[c.id] = c.teacherId; });
    try {
      chk.students.forEach(function (x) {
        var p = byStudent[x.student.id];
        if (p.action === 'reassign') {
          transferStudent(x.student.id, p.toTeacherId, {
            reason: p.reason, endReason: '原教师退出合作，转交新教师', effectiveAt: exitAt
          });
          stats.transferred++;
        } else {
          releaseStudent(x.student.id, {
            reason: p.reason || '原教师退出合作，学员进入待分配', effectiveAt: exitAt
          });
          stats.released++;
        }
      });
      chk.futureCourses.forEach(function (c) {
        var p = byCourse[c.id];
        if (p.action === 'reassign') {
          reassignCourse(c.id, p.toTeacherId, { reason: p.reason || '原教师退出合作，课程改派' });
          stats.coursesReassigned++;
        } else if (p.action === 'cancel') {
          cancelCourse(c.id, '原教师退出合作，课程取消');
          stats.coursesCancelled++;
        } else {
          c.needsAdjust = true;
          c.note = (c.note ? c.note + '；' : '') + '原教师退出合作，本课待教务调整';
          stats.coursesPending++;
        }
      });
      /* 已完成课程只做保护性断言，绝不在这里改写任何历史授课教师 */
      Object.keys(historyBefore).forEach(function (cid) {
        var cc = course(cid);
        if (!cc || cc.teacherId !== historyBefore[cid]) {
          throw bizError('HISTORY_BROKEN', '历史课程 ' + cid + ' 的授课教师被意外修改，操作已回滚');
        }
      });
      t.cooperationStatus = COOP.EXITED;
      t.cooperationEndAt = exitAt;
      t.pauseInfo = null;
      t.updatedAt = stamp();
      disableAccount(id, '教师退出合作，禁用登录');
      logCoop(id, COOP_ACTION.EXITED, {
        reason: String(opt.reason || '').trim() || '正式结束合作',
        effectiveAt: exitAt + ' ' + clock(),
        remark: (opt.remark || '') + '；学员转交 ' + stats.transferred + ' 人，解除 ' + stats.released +
          ' 人；课程改派 ' + stats.coursesReassigned + ' 节，取消 ' + stats.coursesCancelled +
          ' 节，待调整 ' + stats.coursesPending + ' 节'
      });
      save();
      return { ok: true, teacher: t, stats: stats, check: chk };
    } catch (e) {
      db = JSON.parse(snap);
      throw bizError(e.code || 'EXIT_FAILED', '退出合作未完成，已回滚到退出前状态：' + e.message, e.data);
    }
  }

  function rejoinTeacher(id, opt) {
    assertCan('teacher.exit');
    opt = opt || {};
    var t = teacher(id);
    if (!t) throw bizError('NOT_FOUND', '教师不存在');
    if (t.cooperationStatus !== COOP.EXITED) throw bizError('NOT_EXITED', '只有「已退出」的教师可以重新加入');
    t.cooperationStatus = COOP.PENDING;
    t.rejoinCount = (t.rejoinCount || 0) + 1;
    t.lastCooperationStartAt = '';
    t.cooperationEndAt = '';
    t.updatedAt = stamp();
    logCoop(id, COOP_ACTION.REJOINED, {
      reason: opt.reason || '已退出教师重新加入，复用原档案（第 ' + (t.rejoinCount + 1) + ' 次合作）',
      effectiveAt: (opt.effectiveAt || TODAY) + ' ' + clock(), remark: opt.remark || ''
    });
    save();
    return t;
  }

  /* ---------- 学员分配 / 更换 / 解除 ---------- */
  function assignStudent(teacherId, studentId, opt) {
    assertCan('teacher.assign');
    opt = opt || {};
    var t = teacher(teacherId);
    if (!t) throw bizError('NOT_FOUND', '教师不存在');
    if (t.cooperationStatus !== COOP.READY) {
      throw bizError('TEACHER_NOT_READY', '教师「' + t.name + '」当前不是可授课状态，不能分配学员');
    }
    var s = student(studentId);
    if (!s) throw bizError('STUDENT_NOT_FOUND', '学员不存在');
    var cur = activeRelationOfStudent(studentId);
    if (cur) {
      if (cur.teacherId === teacherId) {
        throw bizError('DUPLICATE', '学员「' + s.name + '」已由该教师负责，无需重复分配', { relation: cur });
      }
      var ot = teacher(cur.teacherId);
      throw bizError('STUDENT_HAS_TEACHER',
        '学员「' + s.name + '」当前由「' + (ot ? ot.name : cur.teacherId) +
        '」负责，请先解除原关系或使用「更换教师」', { teacher: ot, relation: cur });
    }
    var reason = String(opt.reason || '').trim();
    if (!reason) throw bizError('REASON_REQUIRED', '请填写分配原因');
    var r = {
      id: 'TS' + seq('TS', 3), teacherId: teacherId, studentId: studentId,
      startAt: opt.startAt || TODAY, endAt: '', status: REL.ACTIVE,
      assignReason: reason, endReason: '', attention: '',
      demandId: opt.demandId || '', responseId: opt.responseId || '',
      createdBy: session.operatorName, createdAt: stamp()
    };
    db.teacherStudents.push(r);
    syncStudentCache(studentId);
    t.updatedAt = stamp();
    save();
    return r;
  }

  function transferStudent(studentId, toTeacherId, opt) {
    assertCan('teacher.assign');
    opt = opt || {};
    var s = student(studentId);
    if (!s) throw bizError('STUDENT_NOT_FOUND', '学员不存在');
    var nt = teacher(toTeacherId);
    if (!nt) throw bizError('NOT_FOUND', '接替教师不存在');
    if (nt.cooperationStatus !== COOP.READY) {
      throw bizError('TEACHER_NOT_READY', '接替教师「' + nt.name + '」当前不是可授课状态');
    }
    var cur = activeRelationOfStudent(studentId);
    if (cur && cur.teacherId === toTeacherId) {
      throw bizError('DUPLICATE', '学员「' + s.name + '」已由「' + nt.name + '」负责，无需重复调整');
    }
    var reason = String(opt.reason || '').trim();
    if (!reason) throw bizError('REASON_REQUIRED', '请填写调整原因');
    var from = null;
    if (cur) {
      cur.endAt = opt.effectiveAt || TODAY;
      cur.status = REL.ENDED;
      cur.endReason = opt.endReason || reason;
      cur.attention = '';
      from = cur;
    }
    var r = {
      id: 'TS' + seq('TS', 3), teacherId: toTeacherId, studentId: studentId,
      startAt: opt.effectiveAt || TODAY, endAt: '', status: REL.ACTIVE,
      assignReason: reason, endReason: '', attention: '',
      demandId: opt.demandId || '', responseId: opt.responseId || '',
      createdBy: session.operatorName, createdAt: stamp()
    };
    db.teacherStudents.push(r);
    syncStudentCache(studentId);
    nt.updatedAt = stamp();
    save();
    return { from: from, to: r };
  }

  function releaseStudent(studentId, opt) {
    assertCan('teacher.assign');
    opt = opt || {};
    var s = student(studentId);
    if (!s) throw bizError('STUDENT_NOT_FOUND', '学员不存在');
    var cur = activeRelationOfStudent(studentId);
    if (!cur) throw bizError('NO_RELATION', '学员「' + s.name + '」当前没有负责教师');
    var reason = String(opt.reason || '').trim();
    if (!reason) throw bizError('REASON_REQUIRED', '请填写解除关系的原因');
    cur.endAt = opt.effectiveAt || TODAY;
    cur.status = REL.ENDED;
    cur.endReason = reason;
    cur.attention = '';
    syncStudentCache(studentId);
    save();
    return cur;
  }

  /* ---------- 课程改派 / 取消 ---------- */
  function reassignCourse(courseId, toTeacherId, opt) {
    assertCan('teacher.assign');
    opt = opt || {};
    var c = course(courseId);
    if (!c) throw bizError('NOT_FOUND', '课程不存在');
    /* 历史保护：已完成、已取消、已标记未上课的课程一律不允许改授课教师 */
    if (c.status === COURSE_STATUS.DONE) {
      throw bizError('COURSE_DONE', '课程 ' + c.id + ' 已完成，不能修改原授课教师');
    }
    if (c.status === COURSE_STATUS.CANCELLED) {
      throw bizError('COURSE_CANCELLED', '课程 ' + c.id + ' 已取消，不能改派');
    }
    if (c.status === COURSE_STATUS.MISSED) {
      throw bizError('COURSE_MISSED', '课程 ' + c.id + ' 已标记未上课，请先处理课程状态');
    }
    var nt = teacher(toTeacherId);
    if (!nt) throw bizError('NOT_FOUND', '接替教师不存在');
    if (nt.cooperationStatus !== COOP.READY) {
      throw bizError('TARGET_NOT_READY', '接替教师「' + nt.name + '」当前不是可授课状态');
    }
    if (c.teacherId === nt.id) throw bizError('SAME_TEACHER', '课程已由「' + nt.name + '」授课');
    var from = teacher(c.teacherId);
    c.reassignLogs.push({
      fromTeacherId: c.teacherId, fromName: from ? from.name : c.teacherName,
      toTeacherId: nt.id, toName: nt.name,
      reason: opt.reason || '', by: session.operatorName, at: stamp()
    });
    c.teacherId = nt.id;
    c.teacher = nt.name;
    c.teacherName = nt.name;
    c.teacherCode = nt.code;
    c.needsAdjust = false;
    save();
    return c;
  }

  function cancelCourse(courseId, reason, opt) {
    assertCan('teacher.assign');
    opt = opt || {};
    var c = course(courseId);
    if (!c) throw bizError('NOT_FOUND', '课程不存在');
    if (c.status === COURSE_STATUS.DONE) throw bizError('COURSE_DONE', '已完成课程不能取消');
    if (c.status === COURSE_STATUS.CANCELLED) return c;
    c.status = COURSE_STATUS.CANCELLED;
    c.cancelReason = reason || '';
    c.cancelledAt = stamp();
    c.cancelledBy = session.operatorName;
    c.deductState = '未扣课';
    c.deduct = '未扣课';
    c.needsAdjust = false;
    save();
    return c;
  }

  /* ---------- 历史查询 ---------- */
  function cooperationsOf(id) {
    return db.teacherCooperations.filter(function (c) { return c.teacherId === id; })
      .sort(function (a, b) { return a.effectiveAt < b.effectiveAt ? -1 : 1; });
  }
  function changeLogsOf(id) {
    return db.teacherChanges.filter(function (c) { return c.teacherId === id; })
      .sort(function (a, b) { return a.createdAt < b.createdAt ? 1 : -1; });
  }
  function users() { return db.users; }
  function usersOfRole(roleId) {
    return db.users.filter(function (u) { return u.roleId === roleId; });
  }

  /* ============================================================
     学员接单与教学资源分配
     ------------------------------------------------------------
     这条链上有四个环节，每个环节都有自己的表、自己的状态、自己的责任人：
       1. StudentDemand          需求本身（教务发，教务管）
       2. TeacherResponse        教师接单意向（教师本人提交，只表达意向）
       3. TeacherStudent         正式师生关系（只有管理员「正式分配」才能创建）
       4. StudentWordbookRequest → StudentWordbook  资源授权（教师申请、管理员开通）
     禁止事项（都在下面的写操作里用断言守住）：
       · 教师响应不能改变学员当前教师
       · 教务确认不能绕过管理员直接建立师生关系
       · 管理员分配必须复用 assignStudent / transferStudent，不能另建一套关系
       · 词库授权只记录权限，不写训练进度；停用授权不删任何历史
     ============================================================ */

  /* ---------- 会话里的教师身份 ---------- */
  function sessionTeacherId() {
    if (session.teacherId) return session.teacherId;
    var t = db.teachers.filter(function (x) { return x.name === session.operatorName; })[0];
    return t ? t.id : '';
  }
  /** 演示环境没有真实登录页：未设置会话教师时，用第一位「可授课」教师作为默认身份 */
  function defaultTeacherId() {
    var t = db.teachers.filter(function (x) { return x.cooperationStatus === COOP.READY; })[0] ||
      db.teachers[0];
    return t ? t.id : '';
  }
  /** 教师角色只能操作自己的数据：把越权挡在 Store 里，而不是靠页面隐藏按钮 */
  function assertSelfTeacher(teacherId) {
    if (session.role !== 'teacher') return teacherId;
    var self = sessionTeacherId();
    if (!self) throw bizError('NO_TEACHER_CONTEXT', '当前教师登录态无法识别，请重新进入接单中心');
    if (teacherId && teacherId !== self) {
      throw bizError('FORBIDDEN', '教师只能查看和操作自己的数据');
    }
    return self;
  }
  /** 教师只能碰自己负责的学员 */
  function assertMyStudent(studentId) {
    if (session.role !== 'teacher') return;
    var self = assertSelfTeacher();
    var rel = activeRelationOfStudent(studentId);
    if (!rel || rel.teacherId !== self) {
      throw bizError('FORBIDDEN', '该学员不在你当前负责的学员名单中');
    }
  }

  /* ---------- 新学员建档（发布需求的前置步骤，不重复建同一个学员） ---------- */
  function createStudent(input, opt) {
    assertCan('student.create');
    input = input || {};
    opt = opt || {};
    var name = String(input.name || '').trim();
    if (!name) throw bizError('NAME_REQUIRED', '请填写学员姓名');
    var grade = String(input.grade || '').trim();
    if (!grade) throw bizError('GRADE_REQUIRED', '请选择年级');
    var phone = String(input.phone || '').trim();
    if (phone && !/^1[3-9]\d{9}$/.test(phone)) throw bizError('PHONE_INVALID', '手机号格式不正确');
    /* 同名同年级视为同一个人：需求发布不能变成「重复建档」的入口 */
    var dup = db.students.filter(function (s) {
      return s.name === name && s.grade === grade;
    })[0];
    if (dup) {
      throw bizError('STUDENT_EXISTS',
        '已存在同名同年级学员「' + dup.name + '」（' + dup.id + '），请直接选择该学员，不要重复建档',
        { student: dup });
    }
    if (phone) {
      var dupPhone = db.students.filter(function (s) { return s.phone === phone; })[0];
      if (dupPhone) {
        throw bizError('PHONE_DUPLICATE',
          '手机号 ' + phone + ' 已被学员「' + dupPhone.name + '」（' + dupPhone.id + '）使用',
          { student: dupPhone });
      }
    }
    var maxN = db.students.reduce(function (m, s) {
      var x = /^S(\d{7})$/.exec(s.id);
      return x ? Math.max(m, Number(x[1])) : m;
    }, 0);
    var id = 'S' + (maxN + 1);
    while (db.students.some(function (s) { return s.id === id; })) {
      maxN++;
      id = 'S' + (maxN + 1);
    }
    var s = {
      id: id, name: name,
      gender: input.gender || '男',
      grade: grade,
      parent: input.parent || '', parentName: String(input.parentName || '').trim(),
      phone: phone,
      teacher: '', teacherName: '未分配',
      /* 建档不赠送课时：课时只能来自订单生效或有权限的课时调整流水 */
      product: input.product || '',
      remain: Number(input.remain) || 0,
      status: '在读', created: TODAY,
      book: input.book || '', school: String(input.school || '').trim(),
      source: input.source || '其他',
      words: { total: 0, mastered: 0, review: 0 },
      lastCourse: '', lastContent: ''
    };
    db.students.push(s);
    save();
    return s;
  }

  /* ---------- 需求：查询 ---------- */
  function demandOf(id) {
    return db.studentDemands.filter(function (x) { return x.id === id || x.code === id; })[0] || null;
  }
  function demandOfStudent(studentId) {
    return db.studentDemands.filter(function (x) { return x.studentId === studentId; })
      .sort(function (a, b) { return a.createdAt < b.createdAt ? 1 : -1; });
  }
  function responseOf(demandId, teacherId) {
    var list = db.teacherResponses.filter(function (r) {
      return r.demandId === demandId && r.teacherId === teacherId;
    });
    if (!list.length) return null;
    /* 有效响应优先，其次最近一条 */
    var valid = list.filter(function (r) { return RESP_VALID.indexOf(r.status) >= 0; })[0];
    return valid || list.sort(function (a, b) { return a.updatedAt < b.updatedAt ? 1 : -1; })[0];
  }
  function responsesOfDemand(demandId) {
    return db.teacherResponses
      .filter(function (r) { return r.demandId === demandId; })
      .map(function (r) {
        var t = teacher(r.teacherId);
        return {
          response: r, teacher: t,
          stat: t ? teacherStat(t.id) : null,
          valid: RESP_VALID.indexOf(r.status) >= 0
        };
      })
      .sort(function (a, b) {
        var w = { '已选中': 0, '已响应': 1, '未选中': 2, '暂不接单': 3, '已撤回': 4 };
        var d = (w[a.response.status] || 9) - (w[b.response.status] || 9);
        return d !== 0 ? d : (a.response.respondedAt < b.response.respondedAt ? -1 : 1);
      });
  }
  function responsesOfTeacher(teacherId) {
    teacherId = assertSelfTeacher(teacherId);
    return db.teacherResponses
      .filter(function (r) { return r.teacherId === teacherId; })
      .map(function (r) {
        var d = demandOf(r.demandId);
        return { response: r, demand: d, student: d ? student(d.studentId) : null };
      })
      .sort(function (a, b) { return a.response.respondedAt < b.response.respondedAt ? 1 : -1; });
  }
  function demandLogsOf(id) {
    return db.studentDemandLogs.filter(function (l) { return l.demandId === id; })
      .sort(function (a, b) { return a.at < b.at ? -1 : 1; });
  }

  var DEMAND_ORDER = {};
  DEMAND_STATUS.forEach(function (s, i) { DEMAND_ORDER[s] = i; });

  /** 需求列表：教务/老板/管理员用，支持状态、学员、年级、教材、发布时间、响应数筛选 */
  function demands(q) {
    q = q || {};
    var list = db.studentDemands.filter(function (x) {
      if (q.status && x.status !== q.status) return false;
      if (q.studentId && x.studentId !== q.studentId) return false;
      if (q.grade && x.grade !== q.grade) return false;
      if (q.textbook && x.textbook !== q.textbook) return false;
      if (q.publishedBy && x.publishedBy !== q.publishedBy) return false;
      if (q.from && x.createdAt.slice(0, 10) < q.from) return false;
      if (q.to && x.createdAt.slice(0, 10) > q.to) return false;
      if (q.kw) {
        var s = student(x.studentId);
        var hay = [x.code, x.grade, x.textbook, x.learningNeeds.join(' '),
          s ? s.name : '', s ? s.id : ''].join(' ').toLowerCase();
        if (hay.indexOf(String(q.kw).toLowerCase()) < 0) return false;
      }
      return true;
    });
    return list.map(function (x) { return demandView(x); }).sort(function (a, b) {
      var d = (DEMAND_ORDER[a.demand.status] || 0) - (DEMAND_ORDER[b.demand.status] || 0);
      if (q.status) d = 0;
      return d !== 0 ? d : (a.demand.createdAt < b.demand.createdAt ? 1 : -1);
    });
  }

  /** 一条需求的完整视图：需求 + 学员 + 响应统计 + 已选教师 + 分配结果 */
  function demandView(x) {
    if (typeof x === 'string') x = demandOf(x);
    if (!x) return null;
    var resp = responsesOfDemand(x.id);
    var valid = resp.filter(function (r) { return r.valid; });
    var sel = x.selectedTeacherId ? teacher(x.selectedTeacherId) : null;
    var st = student(x.studentId);
    var rel = st ? activeRelationOfStudent(st.id) : null;
    return {
      demand: clone(x), student: st, responses: resp,
      responseCount: resp.length, validCount: valid.length,
      respondedCount: resp.filter(function (r) { return r.response.status === RESP.YES ||
        r.response.status === RESP.SELECTED || r.response.status === RESP.NOT_SELECTED; }).length,
      declinedCount: resp.filter(function (r) { return r.response.status === RESP.NO; }).length,
      selectedTeacher: sel,
      currentTeacher: rel ? teacher(rel.teacherId) : null,
      relation: rel,
      isChange: !!rel,
      logs: demandLogsOf(x.id)
    };
  }

  function demandStat() {
    var m = {};
    DEMAND_STATUS.forEach(function (s) { m[s] = 0; });
    db.studentDemands.forEach(function (x) { m[x.status] = (m[x.status] || 0) + 1; });
    return {
      total: db.studentDemands.length, byStatus: m,
      draft: m[DEMAND.DRAFT] || 0, open: m[DEMAND.OPEN] || 0,
      bidding: m[DEMAND.BIDDING] || 0, confirm: m[DEMAND.CONFIRM] || 0,
      assign: m[DEMAND.ASSIGN] || 0, done: m[DEMAND.DONE] || 0,
      cancelled: m[DEMAND.CANCELLED] || 0,
      respondedTotal: db.teacherResponses.filter(function (r) {
        return r.status === RESP.YES || r.status === RESP.SELECTED || r.status === RESP.NOT_SELECTED;
      }).length
    };
  }

  /**
   * 教师视角的需求投影（最小信息集）。
   * 只返回：需求本体（去掉内部确认/分配字段）+ 学员 name/grade/book 等必要字段 + 响应人数。
   * 不返回：家长手机号、其他教师的响应备注、内部操作流水、当前负责教师。
   * 注意：原型阶段这个过滤在前端做；真实上线必须把该投影落在服务端接口，
   * 教师端 API 不应下发完整需求对象，否则前端过滤只是一层可被绕过的展示逻辑。
   */
  function teacherDemandView(demandId) {
    var x = typeof demandId === 'string' ? demandOf(demandId) : demandId;
    if (!x) return null;
    var st = student(x.studentId);
    var resp = db.teacherResponses.filter(function (r) { return r.demandId === x.id; });
    var demand = {
      id: x.id, code: x.code, studentId: x.studentId,
      grade: x.grade, textbook: x.textbook, learningNeeds: x.learningNeeds,
      currentLevel: x.currentLevel, expectedSchedule: x.expectedSchedule,
      expectedStartAt: x.expectedStartAt, specialRequirements: x.specialRequirements,
      remark: x.remark, status: x.status,
      publishedAt: x.publishedAt, createdAt: x.createdAt, updatedAt: x.updatedAt
    };
    return {
      demand: demand,
      student: st ? { id: st.id, name: st.name, grade: st.grade, book: st.book } : null,
      responseCount: resp.length,
      respondedCount: resp.filter(function (r) {
        return r.status === RESP.YES || r.status === RESP.SELECTED || r.status === RESP.NOT_SELECTED;
      }).length,
      validCount: resp.filter(function (r) { return RESP_VALID.indexOf(r.status) >= 0; }).length
    };
  }

  /**
   * 教师可见的开放需求：只有已发布、还没被教务确认掉的。
   * 暂停 / 已退出 / 待启用 的教师看不到待接单需求（业务上也不允许响应）。
   * 返回的是 teacherDemandView 投影，不是教务用的完整 demandView。
   */
  function openDemandsFor(teacherId) {
    teacherId = assertSelfTeacher(teacherId);
    var t = teacher(teacherId);
    if (!t) throw bizError('NOT_FOUND', '教师不存在');
    if (t.cooperationStatus !== COOP.READY) return [];
    return db.studentDemands
      .filter(function (x) { return DEMAND_OPEN_STATUS.indexOf(x.status) >= 0; })
      .map(function (x) { return teacherDemandView(x); })
      .sort(function (a, b) {
        /* 与我能力匹配的排前面：年级 → 教材 → 响应时间 */
        var sa = 0, sb = 0;
        if (a.demand.grade && t.grades.indexOf(a.demand.grade) >= 0) sa += 2;
        if (a.demand.textbook && t.textbooks.indexOf(a.demand.textbook) >= 0) sa += 1;
        if (b.demand.grade && t.grades.indexOf(b.demand.grade) >= 0) sb += 2;
        if (b.demand.textbook && t.textbooks.indexOf(b.demand.textbook) >= 0) sb += 1;
        if (sb !== sa) return sb - sa;
        return a.demand.publishedAt < b.demand.publishedAt ? 1 : -1;
      });
  }
  /** 匹配提示：不阻止响应，只告诉教师「匹配/不匹配」 */
  function demandMatchFor(demandId, teacherId) {
    var x = demandOf(demandId), t = teacher(teacherId);
    if (!x || !t) return null;
    var gradeOk = !!x.grade && t.grades.indexOf(x.grade) >= 0;
    var bookOk = !!x.textbook && t.textbooks.indexOf(x.textbook) >= 0;
    var timeOk = x.expectedSchedule.weekday.length
      ? x.expectedSchedule.weekday.every(function (w) {
        return x.expectedSchedule.periods.some(function (p) {
          return t.availability.some(function (a) { return a.weekday === w && a.period === p; });
        });
      }) : true;
    return {
      grade: gradeOk, textbook: bookOk, time: timeOk,
      miss: [gradeOk ? '' : '年级不符', bookOk ? '' : '教材不符', timeOk ? '' : '时间不符'].filter(Boolean),
      score: (gradeOk ? 3 : 0) + (bookOk ? 2 : 0) + (timeOk ? 1 : 0)
    };
  }

  /* ---------- 需求：写操作 ---------- */
  function logDemand(demandId, action, detail, extra) {
    extra = extra || {};
    var l = {
      id: 'DL' + seq('DL', 3), demandId: demandId,
      action: DEMAND_ACTION[action] ? action : DEMAND_ACTION.UPDATED,
      detail: detail || '',
      operatorId: session.operatorId, operatorName: session.operatorName,
      from: extra.from || '', to: extra.to || '',
      at: stamp(), createdAt: stamp()
    };
    db.studentDemandLogs.push(l);
    return l;
  }

  function demandNeeds(x) {
    return toList(x.learningNeeds);
  }

  function createDemand(input, opt) {
    assertCan('demand.create');
    input = input || {};
    opt = opt || {};
    var s = student(input.studentId);
    if (!s) throw bizError('STUDENT_NOT_FOUND', '请选择一位已有学员档案');
    /* 同一学员不允许同时有两条「进行中」的需求，避免重复发布造成重复分配 */
    var dup = db.studentDemands.filter(function (x) {
      return x.studentId === s.id && [DEMAND.OPEN, DEMAND.BIDDING, DEMAND.CONFIRM, DEMAND.ASSIGN].indexOf(x.status) >= 0;
    })[0];
    if (dup) {
      throw bizError('DEMAND_EXISTS',
        '学员「' + s.name + '」已有一条进行中的需求（' + dup.code + ' · ' + dup.status + '），不能重复发布',
        { demand: dup });
    }
    var needs = toList(input.learningNeeds);
    if (!needs.length) throw bizError('NEEDS_REQUIRED', '请至少选择一项学习需求');
    var grade = String(input.grade || s.grade || '').trim();
    if (!grade) throw bizError('GRADE_REQUIRED', '请填写年级');
    var textbook = String(input.textbook || s.book || '').trim();
    if (!textbook) throw bizError('TEXTBOOK_REQUIRED', '请填写教材');
    var sch = input.expectedSchedule || {};
    var weekday = toList(sch.weekday);
    var periods = toList(sch.periods);
    if (!weekday.length || !periods.length) {
      throw bizError('SCHEDULE_REQUIRED', '请填写期望上课时间（至少一个星期与一个时段）');
    }
    var publish = opt.publish !== false && input.publish !== false;

    var n = seq('SD', 3);
    var code = 'D' + TODAY.replace(/-/g, '') + n;
    while (db.studentDemands.some(function (x) { return x.code === code; })) {
      code = 'D' + TODAY.replace(/-/g, '') + seq('SD', 3);
    }
    var now = stamp();
    var x = {
      id: code, code: code, studentId: s.id,
      grade: grade, textbook: textbook, learningNeeds: needs,
      currentLevel: String(input.currentLevel || '').trim(),
      expectedSchedule: {
        weekday: weekday, periods: periods,
        weeklyLessons: Number(sch.weeklyLessons) || 0
      },
      expectedStartAt: input.expectedStartAt || '',
      specialRequirements: String(input.specialRequirements || '').trim(),
      remark: String(input.remark || '').trim(),
      status: publish ? DEMAND.OPEN : DEMAND.DRAFT,
      publishedBy: publish ? session.operatorName : '',
      publishedAt: publish ? now : '',
      selectedTeacherId: '', confirmedBy: '', confirmedAt: '', confirmReason: '',
      assignedAt: '', assignedBy: '', cancelReason: '',
      createdBy: session.operatorName,
      createdAt: now, updatedAt: now
    };
    db.studentDemands.push(x);
    logDemand(x.id, DEMAND_ACTION.CREATED,
      '创建需求：' + grade + ' · ' + textbook + ' · ' + needs.join('/'), { to: x.status });
    if (publish) {
      logDemand(x.id, DEMAND_ACTION.PUBLISHED, '发布到待接单需求池', { from: DEMAND.DRAFT, to: DEMAND.OPEN });
    }
    save();
    return x;
  }

  /**
   * 建档 + 发布需求：一次事务。
   * 先把需求表单完整校验一遍（学习需求 / 年级 / 教材 / 期望时间都是必填），
   * 全部通过后再写学员与需求；任一步失败整体回滚，绝不留下「只有档案、没有需求」的孤立学员。
   * 课时同样不赠送：新学员 remain = 0，必须等订单或调整流水产生课时。
   */
  function createStudentWithDemand(payload) {
    assertCan('student.create');
    payload = payload || {};
    var stu = payload.student || {};
    var demand = payload.demand || {};
    var name = String(stu.name || payload.name || '').trim();
    var stuGrade = String(stu.grade || '').trim();
    var needs = toList(demand.learningNeeds);
    var grade = String(demand.grade || stuGrade || '').trim();
    var textbook = String(demand.textbook || '').trim();
    var sch = demand.expectedSchedule || {};
    var weekday = toList(sch.weekday);
    var periods = toList(sch.periods);

    /* 前置校验：与 createDemand 同口径，且在建档之前完成 */
    if (!name) throw bizError('NAME_REQUIRED', '请填写学员姓名');
    if (!stuGrade) throw bizError('GRADE_REQUIRED', '请选择年级');
    if (!needs.length) throw bizError('NEEDS_REQUIRED', '请至少选择一项学习需求');
    if (!grade) throw bizError('GRADE_REQUIRED', '请填写需求年级');
    if (!textbook) throw bizError('TEXTBOOK_REQUIRED', '请填写教材');
    if (!weekday.length || !periods.length) {
      throw bizError('SCHEDULE_REQUIRED', '请填写期望上课时间（至少一个星期与一个时段）');
    }

    var snap = JSON.stringify(db);
    try {
      var s = createStudent({
        name: name, gender: stu.gender || '男', grade: stuGrade,
        phone: stu.phone || payload.phone || '',
        parent: stu.parent || '', parentName: stu.parentName || '',
        book: textbook, school: stu.school || '', source: stu.source || '其他',
        /* 建档不赠送课时 */
        product: '', remain: 0
      });
      var x = createDemand(Object.assign({ studentId: s.id }, demand, {
        grade: grade, textbook: textbook,
        learningNeeds: needs, expectedSchedule: sch
      }), { publish: payload.publish !== false });
      return { student: s, demand: x };
    } catch (e) {
      db = JSON.parse(snap);
      save();
      throw bizError(e.code || 'CREATE_FAILED',
        '建档与需求创建未完成，已整体回滚：' + e.message, e.data);
    }
  }

  var DEMAND_EDITABLE = ['grade', 'textbook', 'learningNeeds', 'currentLevel', 'expectedSchedule',
    'expectedStartAt', 'specialRequirements', 'remark'];
  function updateDemand(id, patch) {
    assertCan('demand.edit');
    var x = demandOf(id);
    if (!x) throw bizError('NOT_FOUND', '需求不存在');
    if (x.status === DEMAND.DONE) throw bizError('DEMAND_DONE', '已完成分配的需求不能修改，请新建需求');
    if (x.status === DEMAND.CANCELLED) throw bizError('DEMAND_CANCELLED', '已取消的需求不能修改');
    patch = patch || {};
    var changed = [];
    DEMAND_EDITABLE.forEach(function (k) {
      if (!(k in patch)) return;
      if (k === 'learningNeeds') {
        var v = toList(patch[k]);
        if (v.join('|') !== x.learningNeeds.join('|')) { x.learningNeeds = v; changed.push('学习需求'); }
      } else if (k === 'expectedSchedule') {
        var s = patch[k] || {};
        var wd = toList(s.weekday), pd = toList(s.periods);
        if (wd.join('|') !== x.expectedSchedule.weekday.join('|') ||
          pd.join('|') !== x.expectedSchedule.periods.join('|')) {
          x.expectedSchedule = { weekday: wd, periods: pd, weeklyLessons: Number(s.weeklyLessons) || x.expectedSchedule.weeklyLessons };
          changed.push('期望上课时间');
        }
      } else {
        var nv = String(patch[k] == null ? '' : patch[k]).trim();
        if (nv !== x[k]) { x[k] = nv; changed.push(k); }
      }
    });
    if (changed.length) {
      x.updatedAt = stamp();
      logDemand(x.id, DEMAND_ACTION.UPDATED, '编辑需求：' + changed.join('、'));
      save();
    }
    return x;
  }

  function publishDemand(id, opt) {
    assertCan('demand.publish');
    opt = opt || {};
    var x = demandOf(id);
    if (!x) throw bizError('NOT_FOUND', '需求不存在');
    if (x.status !== DEMAND.DRAFT && x.status !== DEMAND.OPEN) {
      throw bizError('BAD_STATUS', '当前状态（' + x.status + '）不能发布');
    }
    if (x.status === DEMAND.OPEN) {
      /* 重新发布通知：不改状态，只留一条流水，让「又催了一次」这件事有记录 */
      logDemand(x.id, DEMAND_ACTION.PUBLISHED, opt.reason || '重新发布通知（需求仍在需求池中）');
      x.updatedAt = stamp();
      save();
      return x;
    }
    var from = x.status;
    x.status = DEMAND.OPEN;
    x.publishedBy = session.operatorName;
    x.publishedAt = stamp();
    x.updatedAt = x.publishedAt;
    logDemand(x.id, DEMAND_ACTION.PUBLISHED, opt.reason || '发布到待接单需求池', { from: from, to: x.status });
    save();
    return x;
  }

  function withdrawDemand(id, opt) {
    assertCan('demand.publish');
    opt = opt || {};
    var reason = String(opt.reason || '').trim();
    if (!reason) throw bizError('REASON_REQUIRED', '撤回发布必须填写原因');
    var x = demandOf(id);
    if (!x) throw bizError('NOT_FOUND', '需求不存在');
    if (DEMAND_OPEN_STATUS.indexOf(x.status) < 0) {
      throw bizError('BAD_STATUS', '只有待接单 / 接单中的需求可以撤回，当前为「' + x.status + '」');
    }
    var from = x.status;
    x.status = DEMAND.DRAFT;
    x.updatedAt = stamp();
    logDemand(x.id, DEMAND_ACTION.WITHDRAWN, '撤回发布：' + reason, { from: from, to: x.status });
    save();
    return x;
  }

  function cancelDemand(id, opt) {
    assertCan('demand.cancel');
    opt = opt || {};
    var reason = String(opt.reason || '').trim();
    if (!reason) throw bizError('REASON_REQUIRED', '取消需求必须填写原因');
    var x = demandOf(id);
    if (!x) throw bizError('NOT_FOUND', '需求不存在');
    if (x.status === DEMAND.DONE) {
      throw bizError('DEMAND_DONE', '已完成分配的需求不能取消，如需调整请走教师更换流程');
    }
    if (x.status === DEMAND.CANCELLED) throw bizError('ALREADY_CANCELLED', '该需求已经取消');
    var from = x.status;
    var snap = JSON.stringify(db);
    try {
      x.status = DEMAND.CANCELLED;
      x.cancelReason = reason;
      x.updatedAt = stamp();
      /* 取消需求不清空响应历史：把它们标记为已取消影响面之外的状态保持不变，
         只有「已选中」退回「已响应」，避免出现选中了一个已取消的需求 */
      db.teacherResponses.forEach(function (r) {
        if (r.demandId !== x.id) return;
        if (r.status === RESP.SELECTED) r.status = RESP.YES;
        r.updatedAt = stamp();
      });
      logDemand(x.id, DEMAND_ACTION.CANCELLED, '取消需求：' + reason, { from: from, to: x.status });
      save();
      return x;
    } catch (e) {
      db = JSON.parse(snap);
      throw bizError(e.code || 'CANCEL_FAILED', '取消需求失败，已回滚：' + e.message);
    }
  }

  /** 教务开始确认：待接单 / 接单中 → 待教务确认（只是一个「进入比较」的动作） */
  function startConfirm(id) {
    assertCan('demand.confirm');
    var x = demandOf(id);
    if (!x) throw bizError('NOT_FOUND', '需求不存在');
    if (x.status === DEMAND.CONFIRM) return x;
    if (DEMAND_OPEN_STATUS.indexOf(x.status) < 0) {
      throw bizError('BAD_STATUS', '当前状态（' + x.status + '）不能进入教务确认');
    }
    var valid = responsesOfDemand(x.id).filter(function (r) { return r.valid; });
    if (!valid.length) {
      throw bizError('NO_RESPONSE', '还没有教师响应，无法进入确认环节');
    }
    var from = x.status;
    x.status = DEMAND.CONFIRM;
    x.updatedAt = stamp();
    logDemand(x.id, DEMAND_ACTION.CONFIRM_STARTED,
      '教务开始比较 ' + valid.length + ' 位响应教师', { from: from, to: x.status });
    save();
    return x;
  }

  /** 确认前检查：作为提示 + 业务校验，年级/教材不匹配不永久禁止，但必须填说明 */
  function confirmCheck(demandId, teacherId) {
    var x = demandOf(demandId);
    var t = teacher(teacherId);
    if (!x || !t) return null;
    var v = demandView(x);
    var m = demandMatchFor(demandId, teacherId);
    var acc = accountStatusOf(t.id);
    var maxStu = (db.config.teacher && db.config.teacher.maxStudentsPerTeacher) || 6;
    var items = [
      { key: 'coop', label: '教师处于可授课状态', ok: t.cooperationStatus === COOP.READY,
        value: t.cooperationStatus, blocking: true,
        hint: t.cooperationStatus === COOP.READY ? '' : '暂停合作 / 已退出 / 待启用的教师不能确认为最终人选' },
      { key: 'account', label: '教师登录账号正常', ok: acc === ACCOUNT.OK, value: acc, blocking: true,
        hint: acc === ACCOUNT.OK ? '' : '账号「' + acc + '」时教师无法登录教学端，必须先恢复账号才能确认' },
      { key: 'students', label: '当前学员数量合理', ok: (v && teacherStat(t.id).currentStudents < maxStu),
        value: teacherStat(t.id).currentStudents + ' / ' + maxStu, blocking: false,
        hint: '超过 ' + maxStu + ' 人时排课压力较大，请确认能保证课时' },
      { key: 'grade', label: '擅长年级与需求匹配', ok: !!(m && m.grade),
        value: x.grade + ' ⇄ ' + (t.grades.join('/') || '未填写'), blocking: false,
        hint: m && !m.grade ? '教师没有标注 ' + x.grade + '，仍可确认但需要说明' : '' },
      { key: 'textbook', label: '擅长教材与需求匹配', ok: !!(m && m.textbook),
        value: x.textbook + ' ⇄ ' + (t.textbooks.join('/') || '未填写'), blocking: false,
        hint: m && !m.textbook ? '教师没有标注 ' + x.textbook + '，仍可确认但需要说明' : '' },
      { key: 'time', label: '可授课时间覆盖期望时间', ok: !!(m && m.time),
        value: x.expectedSchedule.weekday.join('/') + ' ' + x.expectedSchedule.periods.join('/'),
        blocking: false,
        hint: m && !m.time ? '教师可授课时间：' + availabilityText(t) : '' }
    ];
    var blockingMissing = items.filter(function (i) { return i.blocking && !i.ok; });
    var adviseMissing = items.filter(function (i) { return !i.blocking && !i.ok; });
    return {
      demand: x, teacher: t, items: items,
      blocking: blockingMissing, advisory: adviseMissing,
      /* 阻断项没有 = 可以确认；只有建议项缺失时，必须填写说明 */
      can: blockingMissing.length === 0,
      needReason: adviseMissing.length > 0,
      match: m, accountStatus: acc
    };
  }

  /** 教务确认最终教师：写需求，不写师生关系 */
  function confirmDemand(id, teacherId, opt) {
    assertCan('demand.confirm');
    opt = opt || {};
    var x = demandOf(id);
    if (!x) throw bizError('NOT_FOUND', '需求不存在');
    if (x.status === DEMAND.DONE) throw bizError('DEMAND_DONE', '该需求已完成分配，不能再确认教师');
    if (x.status === DEMAND.CANCELLED) throw bizError('DEMAND_CANCELLED', '该需求已取消');
    if (x.status === DEMAND.ASSIGN) {
      throw bizError('ALREADY_CONFIRMED',
        '该需求已确认「' + (teacher(x.selectedTeacherId) || {}).name + '」，等待管理员正式分配；如需改选请先撤销确认');
    }
    var chk = confirmCheck(id, teacherId);
    if (!chk) throw bizError('NOT_FOUND', '教师不存在');
    if (!chk.can) {
      throw bizError('TEACHER_NOT_READY',
        '「' + chk.teacher.name + '」当前不满足确认条件：' +
        chk.blocking.map(function (i) { return i.label + '（' + i.value + '）'; }).join('；'),
        { check: chk });
    }
    var reason = String(opt.reason || '').trim();
    if (!reason) {
      throw bizError('REASON_REQUIRED',
        chk.needReason ? '该教师有 ' + chk.advisory.length + ' 项条件不匹配，确认理由必填' : '请填写确认理由');
    }
    var resp = responseOf(id, teacherId);
    if (!resp || [RESP.YES, RESP.SELECTED].indexOf(resp.status) < 0) {
      throw bizError('NO_VALID_RESPONSE',
        '「' + chk.teacher.name + '」没有有效响应，不能直接确认为人选');
    }
    var from = x.status;
    var snap = JSON.stringify(db);
    try {
      if (from !== DEMAND.CONFIRM) {
        logDemand(x.id, DEMAND_ACTION.CONFIRM_STARTED, '教务开始比较响应教师', { from: from, to: DEMAND.CONFIRM });
      }
      x.selectedTeacherId = teacherId;
      x.confirmedBy = session.operatorName;
      x.confirmedAt = stamp();
      x.confirmReason = reason;
      x.status = DEMAND.ASSIGN;
      x.updatedAt = x.confirmedAt;
      /* 未被选中的响应保留，只标记结果 —— 不删除任何一条响应历史 */
      db.teacherResponses.forEach(function (r) {
        if (r.demandId !== x.id) return;
        if (r.teacherId === teacherId) { r.status = RESP.SELECTED; r.updatedAt = stamp(); }
        else if (r.status === RESP.YES || r.status === RESP.SELECTED) {
          r.status = RESP.NOT_SELECTED; r.updatedAt = stamp();
        }
      });
      logDemand(x.id, DEMAND_ACTION.CONFIRMED,
        '教务确认「' + chk.teacher.name + '」：' + reason, { from: DEMAND.CONFIRM, to: x.status });
      save();
      return demandView(x);
    } catch (e) {
      db = JSON.parse(snap);
      throw bizError(e.code || 'CONFIRM_FAILED', '确认教师失败，已回滚：' + e.message);
    }
  }

  /** 撤销确认：回到教师选择环节，历史全部保留 */
  function revokeConfirm(id, opt) {
    assertCan('demand.confirm');
    opt = opt || {};
    var reason = String(opt.reason || '').trim();
    if (!reason) throw bizError('REASON_REQUIRED', '撤销确认必须填写原因');
    var x = demandOf(id);
    if (!x) throw bizError('NOT_FOUND', '需求不存在');
    if (x.status !== DEMAND.ASSIGN) {
      throw bizError('BAD_STATUS', '只有「待管理员分配」的需求可以撤销确认，当前为「' + x.status + '」');
    }
    var snap = JSON.stringify(db);
    try {
      var prev = x.selectedTeacherId;
      var prevName = (teacher(prev) || {}).name || '—';
      x.selectedTeacherId = '';
      x.confirmedBy = '';
      x.confirmedAt = '';
      x.confirmReason = '';
      x.status = DEMAND.CONFIRM;
      x.updatedAt = stamp();
      db.teacherResponses.forEach(function (r) {
        if (r.demandId !== x.id) return;
        if (r.status === RESP.SELECTED) r.status = RESP.YES;         /* 回到「已响应」，仍可被重新选择 */
        else if (r.status === RESP.NOT_SELECTED) r.status = RESP.YES;
        r.updatedAt = stamp();
      });
      logDemand(x.id, DEMAND_ACTION.CONFIRM_REVOKED,
        '撤销对「' + prevName + '」的确认：' + reason, { from: DEMAND.ASSIGN, to: x.status });
      save();
      return demandView(x);
    } catch (e) {
      db = JSON.parse(snap);
      throw bizError(e.code || 'REVOKE_FAILED', '撤销确认失败，已回滚：' + e.message);
    }
  }

  /* ---------- 教师响应 ---------- */
  function checkRespondable(x, teacherId) {
    if (!x) throw bizError('NOT_FOUND', '需求不存在');
    if (x.status === DEMAND.DRAFT) throw bizError('NOT_PUBLISHED', '该需求还没有发布，暂不开放响应');
    if (DEMAND_OPEN_STATUS.indexOf(x.status) < 0) {
      throw bizError('DEMAND_CLOSED',
        '该需求当前为「' + x.status + '」，已不再接受新的响应');
    }
    var t = teacher(teacherId);
    if (!t) throw bizError('NOT_FOUND', '教师不存在');
    if (t.cooperationStatus !== COOP.READY) {
      throw bizError('TEACHER_NOT_READY',
        '教师「' + t.name + '」当前为「' + t.cooperationStatus + '」，只有可授课教师能接单');
    }
    var exist = responseOf(x.id, teacherId);
    if (exist && RESP_VALID.indexOf(exist.status) >= 0) {
      throw bizError('DUPLICATE_RESPONSE',
        '你已经响应过这条需求（' + exist.status + '），无需重复提交', { response: exist });
    }
    return { demand: x, teacher: t, exist: exist };
  }

  function respondDemand(demandId, opt) {
    assertCan('response.submit');
    opt = opt || {};
    var tid = assertSelfTeacher(opt.teacherId || sessionTeacherId());
    if (!tid) throw bizError('NO_TEACHER_CONTEXT', '无法识别当前教师，请重新进入接单中心');
    var x = demandOf(demandId);
    var c = checkRespondable(x, tid);
    var remark = String(opt.remark || '').trim();
    var snap = JSON.stringify(db);
    try {
      var r;
      if (c.exist && c.exist.status === RESP.NO) {
        /* 之前拒绝了，现在改主意：复用同一条记录，保留原始拒绝原因 */
        r = c.exist;
        r.status = RESP.YES;
        r.respondedAt = stamp();
        r.updatedAt = r.respondedAt;
        r.remark = remark || r.remark;
      } else {
        r = {
          id: 'TRS' + seq('TRS', 3), demandId: x.id, teacherId: tid,
          status: RESP.YES, remark: remark, declineReason: '',
          respondedAt: stamp(), withdrawnAt: '', withdrawReason: '',
          createdAt: stamp(), updatedAt: stamp()
        };
        db.teacherResponses.push(r);
      }
      if (x.status === DEMAND.OPEN) x.status = DEMAND.BIDDING;
      x.updatedAt = stamp();
      logDemand(x.id, DEMAND_ACTION.RESPONDED,
        '教师「' + c.teacher.name + '」响应' + (remark ? '：' + remark : ''), { to: x.status });
      save();
      return r;
    } catch (e) {
      db = JSON.parse(snap);
      throw bizError(e.code || 'RESPOND_FAILED', '提交响应失败，已回滚：' + e.message);
    }
  }

  function declineDemand(demandId, opt) {
    assertCan('response.submit');
    opt = opt || {};
    var tid = assertSelfTeacher(opt.teacherId || sessionTeacherId());
    if (!tid) throw bizError('NO_TEACHER_CONTEXT', '无法识别当前教师');
    var reason = String(opt.declineReason || opt.reason || '').trim();
    if (!reason) throw bizError('REASON_REQUIRED', '请选择暂不接单的原因');
    if (DECLINE_REASONS.indexOf(reason) < 0 && reason !== '其他原因') {
      /* 自定义原因也允许，但必须写清楚 */
      if (reason.length < 4) throw bizError('REASON_REQUIRED', '请把「其他原因」写清楚');
    }
    var x = demandOf(demandId);
    var c = checkRespondable(x, tid);
    var snap = JSON.stringify(db);
    try {
      var r = c.exist;
      if (r) {
        r.status = RESP.NO;
        r.declineReason = reason;
        r.remark = String(opt.remark || '').trim() || r.remark;
        r.respondedAt = stamp();
        r.updatedAt = r.respondedAt;
      } else {
        r = {
          id: 'TRS' + seq('TRS', 3), demandId: x.id, teacherId: tid,
          status: RESP.NO, remark: String(opt.remark || '').trim(), declineReason: reason,
          respondedAt: stamp(), withdrawnAt: '', withdrawReason: '',
          createdAt: stamp(), updatedAt: stamp()
        };
        db.teacherResponses.push(r);
      }
      x.updatedAt = stamp();
      logDemand(x.id, DEMAND_ACTION.DECLINED,
        '教师「' + c.teacher.name + '」暂不接单：' + reason, { to: x.status });
      save();
      return r;
    } catch (e) {
      db = JSON.parse(snap);
      throw bizError(e.code || 'DECLINE_FAILED', '提交失败，已回滚：' + e.message);
    }
  }

  function withdrawResponse(demandId, opt) {
    assertCan('response.submit');
    opt = opt || {};
    var tid = assertSelfTeacher(opt.teacherId || sessionTeacherId());
    if (!tid) throw bizError('NO_TEACHER_CONTEXT', '无法识别当前教师');
    var x = demandOf(demandId);
    if (!x) throw bizError('NOT_FOUND', '需求不存在');
    if ([DEMAND.ASSIGN, DEMAND.DONE, DEMAND.CANCELLED].indexOf(x.status) >= 0) {
      throw bizError('DEMAND_CLOSED', '需求已进入「' + x.status + '」，不能撤回响应');
    }
    var r = responseOf(x.id, tid);
    if (!r || r.status !== RESP.YES) {
      throw bizError('NO_RESPONSE', '当前没有可以撤回的接单意向');
    }
    var reason = String(opt.reason || '').trim();
    if (!reason) throw bizError('REASON_REQUIRED', '撤回响应必须填写原因');
    var snap = JSON.stringify(db);
    try {
      r.status = RESP.WITHDRAWN;
      r.withdrawnAt = stamp();
      r.withdrawReason = reason;
      r.updatedAt = r.withdrawnAt;
      /* 撤回后如果没有任何有效响应了，需求回到「待接单」——但需求本身不会被自动关闭 */
      var still = responsesOfDemand(x.id).filter(function (y) { return y.valid; });
      if (!still.length && x.status === DEMAND.BIDDING) x.status = DEMAND.OPEN;
      x.updatedAt = stamp();
      var t = teacher(tid);
      logDemand(x.id, DEMAND_ACTION.RESPONSE_WITHDRAWN,
        '教师「' + (t ? t.name : tid) + '」撤回响应：' + reason, { to: x.status });
      save();
      return r;
    } catch (e) {
      db = JSON.parse(snap);
      throw bizError(e.code || 'WITHDRAW_FAILED', '撤回失败，已回滚：' + e.message);
    }
  }

  /* ---------- 管理员：待分配任务与正式分配 ---------- */
  function assignTasks(q) {
    q = q || {};
    return db.studentDemands.filter(function (x) {
      if (q.status === 'all') return x.status === DEMAND.ASSIGN || x.status === DEMAND.DONE;
      return x.status === DEMAND.ASSIGN;
    }).map(function (x) { return demandView(x); })
      .sort(function (a, b) { return a.demand.confirmedAt < b.demand.confirmedAt ? 1 : -1; });
  }

  /** 正式分配前检查：管理员点「分配」时看到的六项 */
  function assignCheck(demandId) {
    var x = demandOf(demandId);
    if (!x) return null;
    var t = x.selectedTeacherId ? teacher(x.selectedTeacherId) : null;
    var s = student(x.studentId);
    var rel = s ? activeRelationOfStudent(s.id) : null;
    var curT = rel ? teacher(rel.teacherId) : null;
    var acc = t ? accountStatusOf(t.id) : ACCOUNT.NONE;
    var items = [
      { key: 'demand', label: '需求处于待管理员分配', ok: x.status === DEMAND.ASSIGN,
        value: x.status, blocking: true },
      { key: 'selected', label: '教务已确认最终教师', ok: !!t, value: t ? t.name : '未确认', blocking: true },
      { key: 'coop', label: '教师仍处于可授课状态', ok: !!t && t.cooperationStatus === COOP.READY,
        value: t ? t.cooperationStatus : '—', blocking: true,
        hint: t && t.cooperationStatus !== COOP.READY ? '教师已不是可授课状态，请退回教务重新确认' : '' },
      { key: 'account', label: '教师登录账号正常', ok: acc === ACCOUNT.OK, value: acc, blocking: true,
        hint: acc !== ACCOUNT.OK ? '账号不可用时教师无法登录教学端，请先恢复账号' : '' },
      { key: 'student', label: '学员档案存在', ok: !!s, value: s ? s.name : '—', blocking: true },
      { key: 'relation', label: '学员当前负责教师', ok: true,
        value: curT ? curT.name + '（分配后结束原关系）' : '未分配（分配后新建关系）',
        blocking: false, change: !!curT && !!t && curT.id !== t.id,
        same: !!curT && !!t && curT.id === t.id }
    ];
    var blocking = items.filter(function (i) { return i.blocking && !i.ok; });
    return {
      demand: x, teacher: t, student: s, currentTeacher: curT, relation: rel,
      accountStatus: acc, items: items, blocking: blocking,
      isChange: !!curT && !!t && curT.id !== t.id,
      alreadySame: !!curT && !!t && curT.id === t.id,
      can: blocking.length === 0 && !(!!curT && !!t && curT.id === t.id)
    };
  }

  /**
   * 管理员正式分配：唯一能创建 TeacherStudent 的入口。
   * 原子性：先快照，任何一步失败整体回滚，绝不出现「关系建了、需求还待分配」。
   */
  function assignDemand(demandId, opt) {
    assertCan('student.assignFinal');
    opt = opt || {};
    var x = demandOf(demandId);
    if (!x) throw bizError('NOT_FOUND', '需求不存在');
    if (x.status === DEMAND.DONE) throw bizError('DEMAND_DONE', '该需求已完成分配，不能重复分配');
    if (x.status === DEMAND.CANCELLED) throw bizError('DEMAND_CANCELLED', '该需求已取消');
    if (x.status !== DEMAND.ASSIGN) {
      throw bizError('NOT_READY_TO_ASSIGN',
        '教务还没有确认最终教师（当前状态「' + x.status + '」），管理员不能跳过确认直接分配');
    }
    var chk = assignCheck(demandId);
    if (chk.blocking.length) {
      throw bizError('ASSIGN_BLOCKED', chk.blocking.map(function (i) { return i.label; }).join('；'),
        { check: chk });
    }
    if (chk.alreadySame) {
      throw bizError('ALREADY_ASSIGNED', '学员「' + chk.student.name + '」当前已经由「' +
        chk.teacher.name + '」负责，无需重复分配');
    }
    var reason = String(opt.reason || '').trim() ||
      ('需求 ' + x.code + ' 正式分配' + (chk.isChange ? '（更换教师）' : ''));
    var snap = JSON.stringify(db);
    try {
      var rel;
      if (chk.isChange) {
        /* 已有负责教师：必须走「原关系结束 + 新关系创建」，不允许直接覆盖 */
        var res = transferStudent(x.studentId, chk.teacher.id, {
          reason: reason,
          endReason: '需求 ' + x.code + ' 确认更换教师，原关系结束',
          effectiveAt: opt.effectiveAt || TODAY,
          demandId: x.id
        });
        rel = res.to;
        /* 被结束的旧关系同样记上需求编号，保证「换了谁、因为哪条需求」可追溯 */
        if (res.from) res.from.demandId = x.id;
      } else {
        rel = assignStudent(chk.teacher.id, x.studentId, {
          reason: reason, startAt: opt.effectiveAt || TODAY, demandId: x.id
        });
      }
      /* 关系建好之后再推进需求；两步在同一事务里，任何一步失败都整体回滚 */
      var from = x.status;
      x.status = DEMAND.DONE;
      x.assignedAt = stamp();
      x.assignedBy = session.operatorName;
      x.updatedAt = x.assignedAt;
      logDemand(x.id, DEMAND_ACTION.ASSIGNED,
        '管理员正式分配：' + chk.student.name + ' → ' + chk.teacher.name +
        (chk.isChange ? '（原负责教师 ' + chk.currentTeacher.name + ' 的关系已结束）' : '') +
        '，关系 ' + rel.id, { from: from, to: x.status });
      save();
      return {
        ok: true, demand: x, relation: rel, teacher: chk.teacher,
        student: chk.student, isChange: chk.isChange,
        prevTeacher: chk.currentTeacher, check: chk
      };
    } catch (e) {
      db = JSON.parse(snap);
      throw bizError(e.code || 'ASSIGN_FAILED',
        '正式分配未完成，已回滚到分配前状态：' + e.message, e.data);
    }
  }

  /* ---------- 词库申请 ---------- */
  function wordbookRequestOf(id) {
    return db.studentWordbookRequests.filter(function (r) { return r.id === id; })[0] || null;
  }
  function requestView(r) {
    var s = student(r.studentId), t = teacher(r.teacherId), b = wordbook(r.wordbookId);
    var auth = db.studentWordbooks.filter(function (w) {
      return w.studentId === r.studentId && w.wordbookId === r.wordbookId && w.status === SWB.ACTIVE;
    })[0];
    return { request: r, student: s, teacher: t, wordbook: b, authorized: !!auth, auth: auth };
  }
  function wordbookRequests(q) {
    q = q || {};
    return db.studentWordbookRequests.filter(function (r) {
      if (q.status && r.status !== q.status) return false;
      if (q.studentId && r.studentId !== q.studentId) return false;
      if (q.teacherId) {
        var tid = assertSelfTeacher(q.teacherId);
        if (r.teacherId !== tid) return false;
      }
      if (q.wordbookId && r.wordbookId !== q.wordbookId) return false;
      if (q.kw) {
        var s = student(r.studentId), b = wordbook(r.wordbookId), t = teacher(r.teacherId);
        var hay = [r.id, s ? s.name : '', b ? b.name : '', t ? t.name : '', r.reason]
          .join(' ').toLowerCase();
        if (hay.indexOf(String(q.kw).toLowerCase()) < 0) return false;
      }
      return true;
    }).map(requestView).sort(function (a, b) {
      var w = { '待审核': 0, '已通过': 1, '已驳回': 2, '已取消': 3 };
      var d = (w[a.request.status] || 9) - (w[b.request.status] || 9);
      return d !== 0 ? d : (a.request.requestedAt < b.request.requestedAt ? 1 : -1);
    });
  }
  function wordbookRequestStat() {
    var m = {};
    WBR_STATUS.forEach(function (s) { m[s] = 0; });
    db.studentWordbookRequests.forEach(function (r) { m[r.status] = (m[r.status] || 0) + 1; });
    return {
      total: db.studentWordbookRequests.length, byStatus: m,
      pending: m[WBR.PENDING] || 0, approved: m[WBR.APPROVED] || 0,
      rejected: m[WBR.REJECTED] || 0, cancelled: m[WBR.CANCELLED] || 0
    };
  }

  /** 申请前检查：学员归属 / 词库可用 / 是否已授权 / 是否已有待审申请 */
  function requestCheck(studentId, wordbookId) {
    var s = student(studentId), b = wordbook(wordbookId);
    var rel = s ? activeRelationOfStudent(s.id) : null;
    var auth = db.studentWordbooks.filter(function (w) {
      return w.studentId === studentId && w.wordbookId === wordbookId && w.status === SWB.ACTIVE;
    })[0];
    var pending = db.studentWordbookRequests.filter(function (r) {
      return r.studentId === studentId && r.wordbookId === wordbookId && r.status === WBR.PENDING;
    })[0];
    var ok = !!s && !!b && b.status === '启用' && !auth && !pending;
    var why = !s ? '学员不存在'
      : !b ? '词库不存在'
        : b.status !== '启用' ? '词库当前不可用（' + b.status + '）'
          : auth ? '已授权该词库' : pending ? '已有待审核申请' : '';
    return {
      student: s, wordbook: b, relation: rel, teacher: rel ? teacher(rel.teacherId) : null,
      authorized: !!auth, auth: auth, pending: pending, ok: ok, reason: why
    };
  }

  /** 教师提交词库申请：可一次提交多个词库，每个词库一条申请记录 */
  function createWordbookRequests(input, opt) {
    assertCan('wordbookRequest.create');
    input = input || {};
    opt = opt || {};
    var tid = assertSelfTeacher(input.teacherId || sessionTeacherId());
    if (!tid) throw bizError('NO_TEACHER_CONTEXT', '无法识别当前教师');
    var s = student(input.studentId);
    if (!s) throw bizError('STUDENT_NOT_FOUND', '请选择学员');
    assertMyStudent(s.id);
    var ids = toList(input.wordbookIds);
    if (!ids.length) throw bizError('WORDBOOK_REQUIRED', '请至少选择一个词库');
    var reason = String(input.reason || '').trim();
    if (!reason) throw bizError('REASON_REQUIRED', '请填写申请原因');
    /* 先整体校验，再写入：不允许出现「前两个词库申请成功、第三个失败」的半成品 */
    var bad = [];
    ids.forEach(function (wid) {
      var c = requestCheck(s.id, wid);
      if (!c.ok) bad.push({ wordbookId: wid, wordbook: c.wordbook, reason: c.reason });
    });
    if (bad.length) {
      throw bizError('REQUEST_INVALID',
        bad.map(function (b) {
          return (b.wordbook ? b.wordbook.name : b.wordbookId) + '：' + b.reason;
        }).join('；'), { invalid: bad });
    }
    var snap = JSON.stringify(db);
    try {
      var out = [];
      ids.forEach(function (wid) {
        var r = {
          id: 'WR' + TODAY.replace(/-/g, '') + seq('WBR', 3),
          studentId: s.id, teacherId: tid, wordbookId: wid,
          reason: reason, plan: String(input.plan || '').trim(),
          status: WBR.PENDING, requestedAt: stamp(),
          reviewedBy: '', reviewedAt: '', reviewRemark: '',
          createdAt: stamp(), updatedAt: stamp()
        };
        db.studentWordbookRequests.push(r);
        out.push(r);
      });
      save();
      return out;
    } catch (e) {
      db = JSON.parse(snap);
      throw bizError(e.code || 'REQUEST_FAILED', '提交词库申请失败，已回滚：' + e.message);
    }
  }

  function cancelWordbookRequest(id, opt) {
    assertCan('wordbookRequest.create');
    opt = opt || {};
    var r = wordbookRequestOf(id);
    if (!r) throw bizError('NOT_FOUND', '申请不存在');
    assertSelfTeacher(r.teacherId);
    if (r.status !== WBR.PENDING) {
      throw bizError('BAD_STATUS', '只有「待审核」的申请可以取消，当前为「' + r.status + '」');
    }
    var reason = String(opt.reason || '').trim();
    if (!reason) throw bizError('REASON_REQUIRED', '取消申请必须填写原因');
    r.status = WBR.CANCELLED;
    r.reviewRemark = '教师自行取消：' + reason;
    r.reviewedBy = session.operatorName;
    r.reviewedAt = stamp();
    r.updatedAt = r.reviewedAt;
    save();
    return r;
  }

  /**
   * 审核词库申请：通过即创建 StudentWordbook 授权。
   * 一条申请要么「审核结果 + 授权记录」都成立，要么都不成立。
   */
  function reviewWordbookRequest(id, opt) {
    assertCan('wordbookRequest.review');
    opt = opt || {};
    var approve = !!opt.approve;
    var remark = String(opt.remark || '').trim();
    if (!approve && !remark) throw bizError('REASON_REQUIRED', '驳回申请必须填写驳回原因');
    var r = wordbookRequestOf(id);
    if (!r) throw bizError('NOT_FOUND', '申请不存在');
    if (r.status !== WBR.PENDING) {
      throw bizError('BAD_STATUS', '该申请已经是「' + r.status + '」，不能重复审核');
    }
    var s = student(r.studentId), b = wordbook(r.wordbookId);
    if (!s) throw bizError('STUDENT_NOT_FOUND', '申请对应的学员不存在');
    if (!b) throw bizError('WORDBOOK_NOT_FOUND', '申请对应的词库不存在');
    var snap = JSON.stringify(db);
    try {
      var grant = null;
      if (approve) {
        if (b.status !== '启用') {
          throw bizError('WORDBOOK_DISABLED', '词库「' + b.name + '」当前为「' + b.status + '」，不能开通');
        }
        var exist = db.studentWordbooks.filter(function (w) {
          return w.studentId === r.studentId && w.wordbookId === r.wordbookId && w.status === SWB.ACTIVE;
        })[0];
        if (exist) {
          throw bizError('ALREADY_AUTHORIZED',
            '学员「' + s.name + '」已经拥有词库「' + b.name + '」的有效授权，无需重复开通');
        }
        grant = {
          id: 'SW' + seq('SWB', 3), studentId: r.studentId, wordbookId: r.wordbookId,
          requestId: r.id, requestedByTeacherId: r.teacherId,
          status: SWB.ACTIVE,
          approvedBy: session.operatorName, approvedAt: stamp(),
          disabledBy: '', disabledAt: '', disableReason: '',
          remark: remark || ('由申请 ' + r.id + ' 审核通过'),
          createdAt: stamp(), updatedAt: stamp()
        };
        db.studentWordbooks.push(grant);
      }
      r.status = approve ? WBR.APPROVED : WBR.REJECTED;
      r.reviewedBy = session.operatorName;
      r.reviewedAt = stamp();
      r.reviewRemark = remark || (approve ? '同意开通' : '');
      r.updatedAt = r.reviewedAt;
      save();
      return { request: r, grant: grant, approved: approve };
    } catch (e) {
      db = JSON.parse(snap);
      throw bizError(e.code || 'REVIEW_FAILED', '审核失败，已回滚：' + e.message, e.data);
    }
  }

  /** 批量审核：要么全部生效，要么一条都不动 */
  function batchReviewWordbookRequests(ids, opt) {
    assertCan('wordbookRequest.review');
    opt = opt || {};
    ids = toList(ids);
    if (!ids.length) throw bizError('NOTHING_SELECTED', '请先勾选要处理的申请');
    if (!opt.approve && !String(opt.remark || '').trim()) {
      throw bizError('REASON_REQUIRED', '批量驳回必须填写原因');
    }
    var snap = JSON.stringify(db);
    var done = [];
    try {
      ids.forEach(function (id) {
        done.push(reviewWordbookRequest(id, opt));
      });
      save();
      return done;
    } catch (e) {
      db = JSON.parse(snap);
      throw bizError(e.code || 'BATCH_FAILED',
        '批量审核未完成，' + ids.length + ' 条申请全部回滚：' + e.message, e.data);
    }
  }

  /* ---------- 学员词库授权 ---------- */
  function studentWordbooksOf(studentId) {
    if (session.role === 'teacher') assertMyStudent(studentId);
    return db.studentWordbooks.filter(function (w) { return w.studentId === studentId; })
      .map(function (w) {
        var b = wordbook(w.wordbookId);
        return {
          auth: w, wordbook: b,
          teacher: w.requestedByTeacherId ? teacher(w.requestedByTeacherId) : null,
          request: w.requestId ? wordbookRequestOf(w.requestId) : null
        };
      })
      .sort(function (a, b) {
        var d = (a.auth.status === SWB.ACTIVE ? 0 : 1) - (b.auth.status === SWB.ACTIVE ? 0 : 1);
        return d !== 0 ? d : (a.auth.approvedAt < b.auth.approvedAt ? 1 : -1);
      });
  }
  /** 教师教学端唯一可用的词库来源：只有「已授权」的 */
  function authorizedWordbooksOf(studentId) {
    if (session.role === 'teacher') assertMyStudent(studentId);
    return db.studentWordbooks
      .filter(function (w) { return w.studentId === studentId && w.status === SWB.ACTIVE; })
      .map(function (w) {
        var b = wordbook(w.wordbookId);
        return b ? { auth: w, wordbook: b } : null;
      })
      .filter(function (x) { return !!x; });
  }
  function isAuthorized(studentId, wordbookId) {
    return db.studentWordbooks.some(function (w) {
      return w.studentId === studentId && w.wordbookId === wordbookId && w.status === SWB.ACTIVE;
    });
  }
  /** 管理员主动开通（不经过申请）：必须写原因 */
  function grantWordbook(studentId, wordbookId, opt) {
    assertCan('studentWordbook.manage');
    opt = opt || {};
    var s = student(studentId), b = wordbook(wordbookId);
    if (!s) throw bizError('STUDENT_NOT_FOUND', '学员不存在');
    if (!b) throw bizError('WORDBOOK_NOT_FOUND', '词库不存在');
    if (b.status !== '启用') throw bizError('WORDBOOK_DISABLED', '词库「' + b.name + '」当前不可用');
    var reason = String(opt.reason || '').trim();
    if (!reason) throw bizError('REASON_REQUIRED', '主动开通词库必须填写开通原因');
    var exist = db.studentWordbooks.filter(function (w) {
      return w.studentId === studentId && w.wordbookId === wordbookId && w.status === SWB.ACTIVE;
    })[0];
    if (exist) throw bizError('ALREADY_AUTHORIZED', '学员「' + s.name + '」已拥有「' + b.name + '」的有效授权');
    var g = {
      id: 'SW' + seq('SWB', 3), studentId: studentId, wordbookId: wordbookId,
      requestId: opt.requestId || '', requestedByTeacherId: opt.teacherId || '',
      status: SWB.ACTIVE, approvedBy: session.operatorName, approvedAt: stamp(),
      disabledBy: '', disabledAt: '', disableReason: '',
      remark: '管理员主动开通：' + reason,
      createdAt: stamp(), updatedAt: stamp()
    };
    db.studentWordbooks.push(g);
    save();
    return g;
  }

  function disableStudentWordbook(id, opt) {
    assertCan('studentWordbook.manage');
    opt = opt || {};
    var w = db.studentWordbooks.filter(function (x) { return x.id === id; })[0];
    if (!w) throw bizError('NOT_FOUND', '授权记录不存在');
    if (w.status === SWB.DISABLED) throw bizError('ALREADY_DISABLED', '该授权已经是停用状态');
    var reason = String(opt.reason || '').trim();
    if (!reason) throw bizError('REASON_REQUIRED', '停用词库授权必须填写原因');
    w.status = SWB.DISABLED;
    w.disabledBy = session.operatorName;
    w.disabledAt = stamp();
    w.disableReason = reason;
    w.updatedAt = w.disabledAt;
    save();
    return w;
  }

  function enableStudentWordbook(id, opt) {
    assertCan('studentWordbook.manage');
    opt = opt || {};
    var w = db.studentWordbooks.filter(function (x) { return x.id === id; })[0];
    if (!w) throw bizError('NOT_FOUND', '授权记录不存在');
    if (w.status === SWB.ACTIVE) throw bizError('ALREADY_ACTIVE', '该授权已经是启用状态');
    var dup = db.studentWordbooks.filter(function (x) {
      return x.id !== id && x.studentId === w.studentId && x.wordbookId === w.wordbookId &&
        x.status === SWB.ACTIVE;
    })[0];
    if (dup) throw bizError('ALREADY_AUTHORIZED', '该学员已有这个词库的有效授权，无需重新启用');
    w.status = SWB.ACTIVE;
    w.disabledBy = '';
    w.disabledAt = '';
    w.disableReason = '';
    w.remark = (w.remark ? w.remark + '；' : '') + '重新启用：' + (String(opt.reason || '').trim() || '管理员操作');
    w.updatedAt = stamp();
    save();
    return w;
  }

  /** 全机构授权记录：授权记录页用 */
  function wordbookGrants(q) {
    q = q || {};
    return db.studentWordbooks.filter(function (w) {
      if (q.status && w.status !== q.status) return false;
      if (q.studentId && w.studentId !== q.studentId) return false;
      if (q.wordbookId && w.wordbookId !== q.wordbookId) return false;
      if (q.kw) {
        var s = student(w.studentId), b = wordbook(w.wordbookId);
        var hay = [s ? s.name : '', b ? b.name : '', w.approvedBy, w.requestId].join(' ').toLowerCase();
        if (hay.indexOf(String(q.kw).toLowerCase()) < 0) return false;
      }
      return true;
    }).map(function (w) {
      var b = wordbook(w.wordbookId);
      return {
        auth: w, wordbook: b, student: student(w.studentId),
        teacher: w.requestedByTeacherId ? teacher(w.requestedByTeacherId) : null
      };
    }).sort(function (a, b) { return a.auth.approvedAt < b.auth.approvedAt ? 1 : -1; });
  }

  function wordbookGrantStat() {
    var active = db.studentWordbooks.filter(function (w) { return w.status === SWB.ACTIVE; }).length;
    var disabled = db.studentWordbooks.filter(function (w) { return w.status === SWB.DISABLED; }).length;
    var stu = {};
    db.studentWordbooks.forEach(function (w) {
      if (w.status === SWB.ACTIVE) stu[w.studentId] = 1;
    });
    return {
      total: db.studentWordbooks.length, active: active, disabled: disabled,
      students: Object.keys(stu).length,
      mine: session.role === 'teacher' ? 0 : 0
    };
  }

  /** 教师在教学中能选的词库（按学员授权过滤），没有授权时给出去申请的引导 */
  function teachingWordbooks(studentId) {
    var list = authorizedWordbooksOf(studentId)
      .filter(function (x) { return x.wordbook.status === '启用'; })
      .map(function (x) { return x.wordbook; });
    return list;
  }

  /* ---------- 跨域统计：给首页/工作台用 ---------- */
  function demandPipeline() {
    var st = demandStat();
    return {
      total: st.total,
      /* 四个环节各自「还压着多少事」，用于工作台待办 */
      toRespond: st.open + st.bidding,
      toConfirm: st.confirm,
      toAssign: st.assign,
      done: st.done,
      cancelled: st.cancelled,
      draft: st.draft,
      pendingRequests: wordbookRequestStat().pending
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
    /* 教师资源池：查询 */
    teachers: teachers, teacherByPhone: teacherByPhone, teacherByCode: teacherByCode,
    teacherStat: teacherStat, teacherOverview: teacherOverview, teacherFacets: teacherFacets,
    searchTeachers: searchTeachers, teacherPool: teacherPool, teacherRanking: teacherRanking,
    teacherAlerts: teacherAlerts, availabilityText: availabilityText,
    accountOf: accountOf, accountStatusOf: accountStatusOf, userById: userById,
    users: users, usersOfRole: usersOfRole,
    /* 教师资源池：生命周期 */
    createTeacher: createTeacher, updateTeacher: updateTeacher, setAvailability: setAvailability,
    openTeacherAccount: openTeacherAccount, setAccountStatus: setAccountStatus,
    activateTeacher: activateTeacher,
    pauseTeacher: pauseTeacher, resumeTeacher: resumeTeacher,
    exitTeacher: exitTeacher, rejoinTeacher: rejoinTeacher,
    activationCheck: activationCheck, exitCheck: exitCheck,
    /* 教师资源池：师生关系与课程交接 */
    relationsOfTeacher: relationsOfTeacher, currentRelationsOf: currentRelationsOf,
    historyRelationsOf: historyRelationsOf, activeRelationOfStudent: activeRelationOfStudent,
    relationsOfStudent: relationsOfStudent, currentStudentsOf: currentStudentsOf,
    historyStudentsOf: historyStudentsOf, futureCoursesOf: futureCoursesOf,
    assignStudent: assignStudent, transferStudent: transferStudent, releaseStudent: releaseStudent,
    reassignCourse: reassignCourse, cancelCourse: cancelCourse,
    cooperationsOf: cooperationsOf, changeLogsOf: changeLogsOf, pendingRecordsOf: pendingRecordsOf,
    /* ---------- 学员接单与教学资源分配 ---------- */
    createStudent: createStudent, createStudentWithDemand: createStudentWithDemand,
    demandOf: demandOf, demands: demands, demandView: demandView, demandStat: demandStat,
    teacherDemandView: teacherDemandView,
    demandOfStudent: demandOfStudent, demandLogsOf: demandLogsOf,
    responsesOfDemand: responsesOfDemand, responsesOfTeacher: responsesOfTeacher,
    responseOf: responseOf, openDemandsFor: openDemandsFor, demandMatchFor: demandMatchFor,
    createDemand: createDemand, updateDemand: updateDemand, publishDemand: publishDemand,
    withdrawDemand: withdrawDemand, cancelDemand: cancelDemand, startConfirm: startConfirm,
    confirmCheck: confirmCheck, confirmDemand: confirmDemand, revokeConfirm: revokeConfirm,
    respondDemand: respondDemand, declineDemand: declineDemand, withdrawResponse: withdrawResponse,
    assignTasks: assignTasks, assignCheck: assignCheck, assignDemand: assignDemand,
    wordbookRequests: wordbookRequests, wordbookRequestOf: wordbookRequestOf,
    wordbookRequestStat: wordbookRequestStat, requestCheck: requestCheck,
    createWordbookRequests: createWordbookRequests, cancelWordbookRequest: cancelWordbookRequest,
    reviewWordbookRequest: reviewWordbookRequest, batchReviewWordbookRequests: batchReviewWordbookRequests,
    studentWordbooksOf: studentWordbooksOf, authorizedWordbooksOf: authorizedWordbooksOf,
    isAuthorized: isAuthorized, grantWordbook: grantWordbook,
    disableStudentWordbook: disableStudentWordbook, enableStudentWordbook: enableStudentWordbook,
    wordbookGrants: wordbookGrants, wordbookGrantStat: wordbookGrantStat,
    teachingWordbooks: teachingWordbooks, demandPipeline: demandPipeline,
    DEMAND: DEMAND, DEMAND_STATUS: DEMAND_STATUS, DEMAND_TONE: DEMAND_TONE,
    DEMAND_OPEN_STATUS: DEMAND_OPEN_STATUS, DEMAND_ACTION: DEMAND_ACTION,
    DEMAND_ACTION_LABEL: DEMAND_ACTION_LABEL, DECLINE_REASONS: DECLINE_REASONS,
    RESP: RESP, RESP_STATUS: RESP_STATUS, RESP_TONE: RESP_TONE,
    WBR: WBR, WBR_STATUS: WBR_STATUS, WBR_TONE: WBR_TONE,
    SWB: SWB, SWB_STATUS: SWB_STATUS, SWB_TONE: SWB_TONE,
    /* 教师资源池：权限 */
    setSession: setSession, currentSession: currentSession, can: can, assertCan: assertCan,
    sessionTeacherId: sessionTeacherId, defaultTeacherId: defaultTeacherId,
    PERMS: PERMS, ROLE_LABEL: ROLE_LABEL,
    COOP: COOP, COOP_STATUS: COOP_STATUS, COOP_TONE: COOP_TONE, COOP_ACTION: COOP_ACTION,
    COOP_ACTION_LABEL: COOP_ACTION_LABEL, ACCOUNT: ACCOUNT, ACCOUNT_STATUS: ACCOUNT_STATUS,
    ACCOUNT_TONE: ACCOUNT_TONE, REL: REL, TEACHER_GRADES: TEACHER_GRADES,
    TEACHER_TEXTBOOKS: TEACHER_TEXTBOOKS, TEACHING_TAGS: TEACHING_TAGS,
    WEEKDAYS: WEEKDAYS, PERIODS: PERIODS, PERIOD_TIME: PERIOD_TIME,
    courseHours: courseHours,
    wordbooks: wordbooks, wordbook: wordbook, word: word, wordByEn: wordByEn,
    wordsOfBook: wordsOfBook, bookWords: bookWords, bookLinkCount: bookLinkCount,
    wordbookStat: wordbookStat, searchWordbooks: searchWordbooks, wordbookFacets: wordbookFacets,
    createWordbook: createWordbook, updateWordbook: updateWordbook,
    setWordbookStatus: setWordbookStatus, updateWord: updateWord,
    removeWordFromBook: removeWordFromBook, moveWordInBook: moveWordInBook,
    addWordToBook: addWordToBook, wordbooksOfWord: wordbooksOfWord,
    WB_CATEGORIES: WB_CATEGORIES, WB_STAGES: WB_STAGES, WB_STATUS: WB_STATUS, WB_ORG: WB_ORG,
    /* 批量导入 */
    detectHeader: detectHeader, analyzeImport: analyzeImport, commitImport: commitImport,
    recordImportFailure: recordImportFailure, startImportBatch: startImportBatch,
    finishImportBatch: finishImportBatch, importBatches: importBatches, importBatch: importBatch,
    importJobs: importJobs, importJob: importJob, importJobsOf: importJobsOf,
    failedRowsCsv: failedRowsCsv, splitMean: splitMean, isEnglishWord: isEnglishWord,
    headerMatch: headerMatch,
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
