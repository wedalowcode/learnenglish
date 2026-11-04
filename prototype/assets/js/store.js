/* ============================================================
   统一模拟数据层 Store
   ------------------------------------------------------------
   第一轮：建立学习域唯一数据源。
   第二轮：加固业务完整性（judge/correct 分离、唯一 wordId 计数）。
   第三轮：从「功能闭环」转向「课程闭环」。
   第七轮：代理获客、报名收款、课时入账与续费全流程线上化。
     1. 代理归属（agentId）、维护归属（followerId）、成交归属（order.agentId）分三处留痕，
        任何一次归属变更都写 leadLogs，不覆盖原归属。
     2. 报名订单必须「管理员确认收款」后才生成课时账户与流水；
        新建家长 / 学员永远不产生课时（remain 初始 0）。
     3. 收款确认 + 课时入账 + 线索成交 + 续费机会关闭在同一个事务里完成，失败整体回滚。
     4. 代理只能看自己负责的客户、自己客户的已发布学习反馈与续费机会；
        家长只能看自己孩子的订单、课时余额（聚合值）与已发布报告，内部流水一律不可见。
     5. 佣金只保留规则与预估接口（未结算占位），企微机器人与第三方支付同样只留接口。
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
  var KEY = 'ee_proto_store_v9';
  var VERSION = 9;
  var LEGACY_KEY_V8 = 'ee_proto_store_v8';
  var LEGACY_KEY_V7 = 'ee_proto_store_v7';
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
     单词训练域：三种教学状态必须分开（第九轮）
     ------------------------------------------------------------
     1. 初筛结果      SCREEN  记录孩子「原本是否认识」，认识即进绿盒并留初筛印记
     2. 强化训练过程  DISPLAY 只记录教师带读了几轮展示，不判断掌握
     3. 最后复习结果  FINAL   教师按孩子最后反应判断，结果进入复习体系
     三者不允许互相替代：
       · 初筛认识 ≠ 掌握（本次通过才叫掌握）
       · 展示三轮完成 ≠ 掌握
       · 最后复习不认识而被放进绿盒 ≠ 初筛认识（screeningStatus 不变）
     ============================================================ */
  var SCREEN = { KNOWN: '已认识', UNKNOWN: '不认识', NONE: '' };
  var SCREEN_TONE = { '已认识': 'green', '不认识': 'red', '': 'slate' };
  /** 绿盒来源：区分「初筛认识 / 教师手动 / 训练最后复习」，三者不合并 */
  var SCREEN_SOURCE = { PRESCREEN: '初筛认识', MANUAL: '教师手动加入', TRAIN_FINAL: '训练最后复习' };
  /** 展示循环：0 未开始 → 1 显示英文 → 2 显示中文 → 3 隐藏英文与中文并标记本轮完成 */
  var DISPLAY_STEP = { NONE: 0, EN: 1, CN: 2, DONE: 3 };
  var DISPLAY_LABEL = { 0: '未开始', 1: '显示英文', 2: '显示中文', 3: '本轮完成' };
  var TRAIN_GROUP_SIZE = 5;
  /** 单次训练目标数量：默认 45，教师可调，本轮将上限收口固定为 45（超出直接拒绝） */
  var TARGET_RANGE = { min: 5, max: 45, def: 45 };
  /* 复习检测最终结果语义：底层存储沿用全量三态（历史 yes/mid/no），对外统一为 mastery 三态。
     只做映射，不重写历史值。 */
  var MASTERY = { MASTERED: 'mastered', NEEDS_PRACTICE: 'needs_practice', NOT_MASTERED: 'not_mastered' };
  var MASTERY_LABEL = { mastered: '已掌握', needs_practice: '待加强', not_mastered: '未掌握' };
  function mapResult(r) {
    return r === 'yes' ? MASTERY.MASTERED
      : r === 'mid' ? MASTERY.NEEDS_PRACTICE
        : r === 'no' ? MASTERY.NOT_MASTERED
          : '';
  }
  function mapMasteryToResult(m) {
    return m === MASTERY.MASTERED ? 'yes'
      : m === MASTERY.NEEDS_PRACTICE ? 'mid'
        : m === MASTERY.NOT_MASTERED ? 'no'
          : '';
  }
  var PHASE = { PRESCREEN: '预筛选', DISPLAY: '强化训练', FINAL: '最后复习', DONE: '已提交' };

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
    'studentWordbook.manage': ['admin', 'ops'],

    /* ---- 第七轮：代理获客与报名续费 ---- */
    'lead.viewAll': ['admin', 'staff', 'ops'],
    'lead.viewSelf': ['agent'],
    'lead.create': ['admin', 'staff', 'agent'],
    'lead.follow': ['admin', 'staff', 'agent'],
    'lead.convert': ['admin', 'staff', 'agent'],
    'lead.assign': ['admin', 'staff'],                  /* 归属调整只给机构 */
    'order.viewAll': ['admin', 'staff', 'ops'],
    'order.viewSelf': ['agent', 'parent'],              /* 代理 / 家长只看自己的 */
    'order.create': ['admin', 'staff', 'agent'],
    'order.review': ['admin', 'ops'],
    'payment.confirm': ['admin', 'ops'],                /* 收款确认 → 课时入账 */
    'lesson.adjust': ['admin', 'ops'],
    'agent.viewAll': ['admin', 'staff', 'ops'],
    'agent.manage': ['admin', 'staff'],
    'agent.recruit': ['admin', 'staff'],
    'agent.review': ['admin', 'staff'],
    'renewal.viewAll': ['admin', 'staff', 'ops'],
    'renewal.viewSelf': ['agent'],
    'renewal.handle': ['admin', 'staff', 'agent'],
    'feedback.create': ['admin', 'staff', 'teacher'],
    'feedback.viewSelf': ['agent', 'parent', 'teacher']
  };
  var ROLE_LABEL = { admin: '老板', staff: '教务负责人', ops: '管理员', teacher: '教师', agent: '代理', parent: '家长' };
  /* 内部角色的固定演示身份：页面只声明 role 时按角色重置操作人，
     避免跨页持久化后把上一个角色的操作人带到新角色（如管理员页显示代理姓名）。 */
  var ROLE_DEFAULT_OPERATOR = { admin: '张敏', staff: '陈静', ops: '王敏' };
  var session = {
    role: 'admin', operatorName: '张敏', operatorId: '张敏', accountId: '',
    teacherId: '', agentId: '', parentId: ''
  };

  /* ============================================================
     第八轮：系统管理域（角色 / 权限 / 数据范围 / 审计 / 字典 / 通知 / 机构）
     ------------------------------------------------------------
     权限编码是唯一事实来源：页面菜单、Store 写操作、数据读取都查同一份
     rolePermissions；静态 PERMS 只用于没有迁移到新编码的历史动作兜底。
     ============================================================ */
  var ROLE_SEED = [
    { code: 'admin', name: '机构管理员', description: '老板/机构负责人，拥有全部业务与系统权限', dataScope: 'ALL', system: true },
    { code: 'staff', name: '教务负责人', description: '负责线索、学员、教师与教务确认，不参与正式分配与收款确认', dataScope: 'ALL', system: true },
    { code: 'ops', name: '管理员', description: '负责正式分配、词库授权、订单收款与系统配置', dataScope: 'ALL', system: true },
    { code: 'teacher', name: '教师', description: '只能查看自己负责的学员、课程与报告，并响应开放需求', dataScope: 'ASSIGNED', system: true },
    { code: 'agent', name: '代理', description: '只能查看自己名下客户、订单、续费与反馈', dataScope: 'OWN', system: true },
    { code: 'parent', name: '家长', description: '只能查看自己孩子的课程、课时与已发布报告', dataScope: 'RELATED', system: true }
  ];
  var DATA_SCOPE_LABEL = { ALL: '全部数据', ASSIGNED: '仅本人负责的学员', OWN: '仅本人客户/订单', RELATED: '仅本人孩子' };
  var DATA_SCOPE_STATUS = ['ALL', 'ASSIGNED', 'OWN', 'RELATED', 'SELF'];

  /* 权限目录：module 用于角色详情分组，type=view 的权限额外决定菜单可见性 */
  var PERMISSION_SEED = [
    /* 客户管理 */
    ['lead.view.own', '客户管理', '查看本人客户', '仅本人负责或来源归属于自己的线索', 'view'],
    ['lead.view.all', '客户管理', '查看全部客户', '查看机构全部线索与客户', 'view'],
    ['lead.create', '客户管理', '新建客户线索', '录入新客户并记录来源', 'action'],
    ['lead.follow', '客户管理', '客户跟进', '登记跟进记录、调整意向', 'action'],
    ['lead.convert', '客户管理', '客户转报名', '把意向客户转为报名订单', 'action'],
    ['lead.transfer', '客户管理', '客户归属移交', '变更线索负责人/成交代理', 'action'],
    ['lead.resolve_dispute', '客户管理', '客户归属争议处理', '裁定重复报备的归属', 'action'],
    /* 家长与学员 */
    ['parent.view', '家长与学员', '查看家长档案', '查看家长与学员关联', 'view'],
    ['parent.create', '家长与学员', '新建家长档案', '建立家长账号与孩子关系', 'action'],
    ['parent.edit', '家长与学员', '编辑家长档案', '修改联系方式与关系', 'action'],
    ['student.view', '家长与学员', '查看学员档案', '按数据范围查看学员', 'view'],
    ['student.create', '家长与学员', '新建学员档案', '建档不产生课时', 'action'],
    ['student.edit', '家长与学员', '编辑学员档案', '修改年级、教材等信息', 'action'],
    /* 教师管理 */
    ['teacher.view', '教师管理', '查看教师档案', '查看教师资源池与状态', 'view'],
    ['teacher.create', '教师管理', '新建教师档案', '教师档案永不物理删除', 'action'],
    ['teacher.edit', '教师管理', '编辑教师档案', '修改可授课程与联系方式', 'action'],
    ['teacher.activate', '教师管理', '启用教师', '把待启用教师设为可授课', 'action'],
    ['teacher.suspend', '教师管理', '暂停合作', '保留档案并暂停排课', 'action'],
    ['teacher.restore', '教师管理', '恢复合作', '恢复可授课状态', 'action'],
    ['teacher.exit', '教师管理', '教师退出', '结束合作但保留历史', 'action'],
    ['teacher.assign_student', '教师管理', '正式分配教师', '建立师生负责关系（仅管理员）', 'action'],
    /* 学员需求 */
    ['demand.view', '学员需求', '查看学员需求', '按数据范围查看需求池', 'view'],
    ['demand.create', '学员需求', '创建学员需求', '为已建档学员发起接单', 'action'],
    ['demand.publish', '学员需求', '发布学员需求', '向教师开放接单', 'action'],
    ['demand.respond', '学员需求', '教师响应需求', '接单意向的提交与撤回', 'action'],
    ['demand.confirm', '学员需求', '教务确认人选', '确认最终教师但不等同分配', 'action'],
    ['demand.revoke_confirm', '学员需求', '撤销教务确认', '撤销确认并保留流水', 'action'],
    ['demand.assign', '学员需求', '正式分配学员', '把学员正式分配给教师', 'action'],
    /* 教学资源 */
    ['wordbook.view', '教学资源', '查看词库', '查看词库与授权记录', 'view'],
    ['wordbook.create', '教学资源', '新建词库', '创建空词库并导入', 'action'],
    ['wordbook.edit', '教学资源', '编辑词库', '维护单词与排序', 'action'],
    ['wordbook.request', '教学资源', '申请词库授权', '教师为负责学员申请词库', 'action'],
    ['wordbook.review', '教学资源', '审核词库申请', '通过或驳回教师申请', 'action'],
    ['wordbook.grant', '教学资源', '开通词库授权', '为学员开通词库权限', 'action'],
    ['wordbook.revoke', '教学资源', '撤销词库授权', '停用授权但不删历史', 'action'],
    /* 订单与财务 */
    ['order.view.own', '订单与财务', '查看本人订单', '代理/家长查看自己的订单', 'view'],
    ['order.view.all', '订单与财务', '查看全部订单', '查看机构全部订单', 'view'],
    ['order.create', '订单与财务', '创建报名订单', '代理或教务发起报名', 'action'],
    ['order.review', '订单与财务', '审核订单', '审核报名订单信息', 'action'],
    ['order.cancel', '订单与财务', '取消订单', '取消未生效订单并留痕', 'action'],
    ['payment.record', '订单与财务', '登记收款', '登记线下收款待确认', 'action'],
    ['payment.confirm', '订单与财务', '确认收款', '确认到账并触发课时入账', 'action'],
    ['payment.reject', '订单与财务', '驳回收款', '驳回收款登记并保留原因', 'action'],
    ['payment.refund', '订单与财务', '退款处理', '受理退款申请与审批', 'action'],
    /* 课时账户 */
    ['lesson_account.view', '课时账户', '查看课时账户', '按数据范围查看余额与流水', 'view'],
    ['lesson_account.adjust', '课时账户', '调整课时', '增减课时必须写流水', 'action'],
    ['lesson_account.deduct', '课时账户', '扣减课时', '课程完成时扣减课时', 'action'],
    ['lesson_account.reverse', '课时账户', '课时冲正', '冲正错误流水', 'action'],
    /* 教学与报告 */
    ['lesson.view.own', '教学与报告', '查看本人课程', '教师查看自己的课程', 'view'],
    ['lesson.view.all', '教学与报告', '查看全部课程', '教务/管理员查看全部课程', 'view'],
    ['lesson.record', '教学与报告', '提交教学记录', '记录课堂表现', 'action'],
    ['lesson.complete', '教学与报告', '完成课程', '课程完成并扣减课时', 'action'],
    ['report.create', '教学与报告', '创建报告', '生成课后学习报告', 'action'],
    ['report.submit', '教学与报告', '提交报告', '提交报告待发布', 'action'],
    ['report.publish', '教学与报告', '发布报告', '发布后家长才可见', 'action'],
    ['report.view.own', '教学与报告', '查看本人报告', '按数据范围查看报告', 'view'],
    ['report.view.all', '教学与报告', '查看全部报告', '查看机构全部报告', 'view'],
    /* 续费管理 */
    ['renewal.view.own', '续费管理', '查看本人续费机会', '代理查看自己客户的续费机会', 'view'],
    ['renewal.view.all', '续费管理', '查看全部续费机会', '查看机构全部续费机会', 'view'],
    ['renewal.follow', '续费管理', '续费跟进', '跟进并记录结果', 'action'],
    ['renewal.create_order', '续费管理', '续费转订单', '把续费机会转为订单', 'action'],
    /* 系统管理 */
    ['account.view', '系统管理', '查看账号', '查看统一账号列表', 'view'],
    ['account.create', '系统管理', '开通账号', '为已有人员档案开通登录账号', 'action'],
    ['account.edit', '系统管理', '编辑账号', '修改角色、登录名为账号', 'action'],
    ['account.disable', '系统管理', '启用/禁用账号', '禁用后无法切换为该身份', 'action'],
    ['account.reset_credential', '系统管理', '重置登录凭证', '重置密码并标记需修改', 'action'],
    ['role.view', '系统管理', '查看角色', '查看角色与成员', 'view'],
    ['role.edit', '系统管理', '编辑角色', '新建/维护角色', 'action'],
    ['permission.configure', '系统管理', '配置角色权限', '修改菜单与操作权限', 'action'],
    ['audit.view', '系统管理', '查看审计日志', '按对象/操作人追溯业务单据', 'view'],
    ['dictionary.manage', '系统管理', '字典管理', '维护业务下拉选项', 'action'],
    ['notification.manage', '系统管理', '通知规则管理', '维护通知模板与接收规则', 'action'],
    ['organization.manage', '系统管理', '机构设置', '维护机构、课时预警与通知参数', 'action']
  ];

  var DEFAULT_PERM = {
    admin: {
      all: true, dataScope: 'ALL'
    },
    staff: {
      codes: ['lead.view.own', 'lead.view.all', 'lead.create', 'lead.follow', 'lead.convert', 'lead.transfer',
        'parent.view', 'parent.create', 'parent.edit', 'student.view', 'student.create', 'student.edit',
        'teacher.view', 'teacher.create', 'teacher.edit', 'teacher.activate', 'teacher.suspend',
        'teacher.restore', 'teacher.exit', 'demand.view', 'demand.create', 'demand.publish',
        'demand.confirm', 'demand.revoke_confirm', 'wordbook.view', 'order.view.all', 'order.create',
        'order.cancel', 'lesson_account.view', 'lesson.view.all', 'report.create', 'report.submit',
        'report.publish', 'report.view.all', 'renewal.view.all', 'renewal.follow', 'renewal.create_order',
        'account.view', 'account.create', 'account.edit', 'account.reset_credential', 'audit.view'],
      dataScope: 'ALL'
    },
    ops: {
      codes: ['lead.view.all', 'lead.resolve_dispute', 'parent.view', 'student.view', 'teacher.view',
        'teacher.assign_student', 'demand.view', 'demand.assign', 'wordbook.view', 'wordbook.review',
        'wordbook.grant', 'wordbook.revoke', 'order.view.all', 'order.review', 'order.cancel',
        'payment.record', 'payment.confirm', 'payment.reject', 'payment.refund',
        'lesson_account.view', 'lesson_account.adjust', 'lesson_account.deduct', 'lesson_account.reverse',
        'lesson.view.all', 'report.view.all', 'report.publish', 'renewal.view.all',
        'account.view', 'account.create', 'account.edit', 'account.disable', 'account.reset_credential',
        'role.view', 'audit.view', 'dictionary.manage', 'notification.manage', 'organization.manage'],
      dataScope: 'ALL'
    },
    teacher: {
      codes: ['student.view', 'demand.view', 'demand.respond', 'wordbook.view',
        'wordbook.request', 'lesson.view.own', 'lesson.record', 'lesson.complete', 'report.create',
        'report.submit', 'report.view.own', 'lesson_account.view'],
      dataScope: 'ASSIGNED'
    },
    agent: {
      codes: ['lead.view.own', 'lead.create', 'lead.follow', 'lead.convert', 'student.view',
        'order.view.own', 'order.create', 'renewal.view.own', 'renewal.follow', 'renewal.create_order',
        'report.view.own'],
      dataScope: 'OWN'
    },
    parent: {
      codes: ['student.view', 'order.view.own', 'lesson.view.own', 'lesson_account.view', 'report.view.own'],
      dataScope: 'RELATED'
    }
  };

  /* 历史动作 → 新权限编码：rolePermissions 修改后立即影响这些写操作 */
  var ACTION_PERM = {
    'teacher.view': 'teacher.view', 'teacher.create': 'teacher.create', 'teacher.edit': 'teacher.edit',
    'teacher.account': 'account.create', 'teacher.activate': 'teacher.activate',
    'teacher.pause': 'teacher.suspend', 'teacher.resume': 'teacher.restore', 'teacher.exit': 'teacher.exit',
    'teacher.assign': 'teacher.assign_student', 'teacher.stats': 'teacher.view',
    'self.records': 'lesson.view.own',
    'demand.view': 'demand.view', 'demand.create': 'demand.create', 'demand.edit': 'demand.create',
    'demand.publish': 'demand.publish', 'demand.cancel': 'demand.publish',
    'demand.confirm': 'demand.confirm', 'demand.open': 'demand.respond',
    'response.submit': 'demand.respond', 'response.viewAll': 'demand.view',
    'student.assignFinal': 'teacher.assign_student',
    'wordbookRequest.create': 'wordbook.request', 'wordbookRequest.review': 'wordbook.review',
    'studentWordbook.view': 'wordbook.view', 'studentWordbook.manage': 'wordbook.grant',
    'lead.viewAll': 'lead.view.all', 'lead.viewSelf': 'lead.view.own', 'lead.create': 'lead.create',
    'lead.follow': 'lead.follow', 'lead.convert': 'lead.convert', 'lead.assign': 'lead.transfer',
    'order.viewAll': 'order.view.all', 'order.viewSelf': 'order.view.own', 'order.create': 'order.create',
    'order.review': 'order.review', 'payment.confirm': 'payment.confirm',
    'lesson.adjust': 'lesson_account.adjust',
    'renewal.viewAll': 'renewal.view.all', 'renewal.viewSelf': 'renewal.view.own',
    'renewal.handle': 'renewal.follow', 'feedback.create': 'report.create',
    'feedback.viewSelf': 'report.view.own',
    'parent.view': 'parent.view', 'parent.create': 'parent.create', 'parent.edit': 'parent.edit',
    'inquiry.handle': 'parent.view',
    'audit.view': 'audit.view'
  };

  /* 字典类型：业务表单的唯一选项来源 */
  var DICT_TYPE_SEED = [
    { code: 'lead_channel', name: '获客渠道', description: '客户线索的来源渠道' },
    { code: 'lead_level', name: '客户意向等级', description: '线索意向分级' },
    { code: 'follow_type', name: '跟进方式', description: '客户跟进记录的联系方式' },
    { code: 'agent_type', name: '代理类型', description: '代理合作方式' },
    { code: 'pay_method', name: '支付方式', description: '收款登记的支付渠道' },
    { code: 'grade', name: '学员年级', description: '学员档案与需求使用的年级' },
    { code: 'textbook', name: '教材版本', description: '学员与教师使用的教材' },
    { code: 'relation', name: '家长关系', description: '家长与学员的关系' },
    { code: 'decline_reason', name: '教师不接单原因', description: '教师拒绝需求的常见原因' }
  ];
  var DICT_ITEM_SEED = {
    lead_channel: ['转介绍', '地推', '公众号', '电话咨询', '代理推荐', '其他'],
    lead_level: ['高', '中', '低'],
    follow_type: ['电话', '微信', '面谈', '短信'],
    agent_type: ['个人代理', '合作机构', '内部转介绍'],
    pay_method: ['微信', '支付宝', '银行转账', '现金', 'POS'],
    grade: ['一年级', '二年级', '三年级', '四年级', '五年级', '六年级', '七年级', '八年级', '九年级'],
    textbook: ['人教版', '外研版', '译林版', '北师大版', '沪教牛津版', '其他'],
    relation: ['父亲', '母亲', '祖父母', '其他监护人'],
    decline_reason: ['时间不合适', '年级不匹配', '教材不熟悉', '当前学员数量较多', '其他原因']
  };

  /* 通知规则：事件 → 模板 → 接收人；业务代码只调用 notify(event, payload) */
  var NOTIFY_RULE_SEED = [
    { event: 'LEAD_ASSIGNED', name: '新客户分配', role: 'agent', title: '你有一个新客户：{leadName}',
      content: '客户「{leadName}」已分配给你，请及时跟进。', business: 'lead' },
    { event: 'LEAD_TRANSFER', name: '客户归属变更', role: 'agent', title: '客户归属已调整：{leadName}',
      content: '客户「{leadName}」的负责人已调整为 {agentName}。', business: 'lead' },
    { event: 'ORDER_REVIEW', name: '报名订单待审核', role: 'admin', title: '新报名订单待审核：{orderNo}',
      content: '学员「{studentName}」提交报名订单，金额 {amount} 元，请审核。', business: 'order' },
    { event: 'PAYMENT_REGISTERED', name: '收款待确认', role: 'admin', title: '收款待确认：{orderNo}',
      content: '订单「{orderNo}」登记收款 {amount} 元，请确认到账后入账。', business: 'order' },
    { event: 'PAYMENT_CONFIRMED', name: '收款确认成功（代理）', role: 'agent', title: '收款已确认：{orderNo}',
      content: '订单「{orderNo}」的收款 {amount} 元已确认，课时已入账。', business: 'order' },
    { event: 'PAYMENT_CONFIRMED', name: '收款确认成功（家长）', role: 'parent', title: '孩子的报名已生效',
      content: '订单「{orderNo}」的收款已确认，{studentName} 的课时已入账。', business: 'order' },
    { event: 'DEMAND_PUBLISHED', name: '新学员需求', role: 'teacher', title: '新的学员需求待响应',
      content: '学员「{studentName}」的需求已发布，请前往接单中心查看。', business: 'demand' },
    { event: 'DEMAND_CONFIRMED', name: '需求已确认人选', role: 'teacher', title: '你被教务确认为意向人选',
      content: '学员「{studentName}」的需求已确认你为人选，等待管理员正式分配。', business: 'demand' },
    { event: 'DEMAND_ASSIGNED', name: '学员正式分配', role: 'teacher', title: '你已正式负责学员：{studentName}',
      content: '学员「{studentName}」已正式分配给你，请查看学员档案并准备课程。', business: 'demand' },
    { event: 'DEMAND_WAIT_ASSIGN', name: '需求待正式分配', role: 'admin', title: '需求待正式分配：{studentName}',
      content: '学员「{studentName}」的需求已由教务确认，请完成正式分配。', business: 'demand' },
    { event: 'WORD_REQUEST', name: '词库申请待审核', role: 'ops', title: '新的词库开通申请',
      content: '教师「{teacherName}」为学员「{studentName}」申请词库，请审核。', business: 'wordbookRequest' },
    { event: 'WORD_GRANTED', name: '词库授权结果', role: 'teacher', title: '词库申请已通过',
      content: '学员「{studentName}」的词库申请已通过，可以开始训练。', business: 'wordbookRequest' },
    { event: 'WORD_REJECTED', name: '词库申请驳回', role: 'teacher', title: '词库申请未通过',
      content: '学员「{studentName}」的词库申请未通过，请查看审核备注。', business: 'wordbookRequest' },
    { event: 'REPORT_PUBLISHED', name: '学习报告已发布', role: 'parent', title: '新的学习报告：{studentName}',
      content: '孩子「{studentName}」的课后学习报告已发布，点击查看。', business: 'report' },
    { event: 'LESSON_LOW', name: '课时不足提醒', role: 'agent', title: '客户课时不足：{studentName}',
      content: '学员「{studentName}」剩余课时 {remain} 节，请提醒续费。', business: 'renewal' },
    { event: 'RENEWAL_CREATED', name: '续费机会生成', role: 'agent', title: '新的续费机会：{studentName}',
      content: '学员「{studentName}」触发了续费机会（{sourceType}），请跟进。', business: 'renewal' },
    { event: 'PARENT_INQUIRY', name: '家长咨询待处理', role: 'admin', title: '新的家长咨询待处理：{parentName}',
      content: '家长「{parentName}」发起咨询（{type}）：{content}，请处理。', business: 'parentInquiry' },
    { event: 'PARENT_INQUIRY_REPLIED', name: '咨询已回复', role: 'parent', title: '你的咨询已回复',
      content: '你的咨询「{type}」已由教务回复，点击查看。', business: 'parentInquiry' }
  ];

  var ORG_SEED = {
    name: '启航英语', campus: '城东校区', address: '杭州市上城区城东路 88 号 3 楼',
    contactPhone: '0571-88886666', contactEmail: 'admin@qihang-english.cn',
    workingHours: '周一至周日 09:00-21:00',
    lessonAlertThreshold: 5, expireAlertDays: 14,
    allowAgentRegisterPayment: false, defaultTimezone: 'Asia/Shanghai'
  };

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

  /* ============================================================
     第七轮词表：代理 / 线索 / 订单 / 收款 / 课时 / 续费
     ------------------------------------------------------------
     这五套状态彼此独立，不允许用「一个布尔字段」推导：
       线索状态 lead.status      —— 客户跟进到了哪一步
       订单状态 order.status     —— 报名/续费单走到哪一步
       收款状态 payment.status   —— 钱有没有真的到账
       课时账户 accounts.status  —— 课时还能不能用
       续费机会 renewal.status   —— 这个客户是否已经转成续费单
     课时只能由「已确认收款」的订单或有权限的课时调整流水产生。
     ============================================================ */
  var LEAD = {
    NEW: '新线索', TO_CONTACT: '待联系', FOLLOWING: '跟进中',
    INTENT: '意向明确', DEAL: '已成交', INVALID: '无效', CLOSED: '已关闭'
  };
  var LEAD_STATUS = [LEAD.NEW, LEAD.TO_CONTACT, LEAD.FOLLOWING, LEAD.INTENT, LEAD.DEAL, LEAD.INVALID, LEAD.CLOSED];
  var LEAD_TONE = {
    '新线索': 'slate', '待联系': 'amber', '跟进中': 'blue', '意向明确': 'purple',
    '已成交': 'green', '无效': 'slate', '已关闭': 'slate'
  };
  /* 允许的状态推进：只能往前，不能从终态回退；归属调整不改变状态本身 */
  var LEAD_NEXT = {
    '新线索': [LEAD.TO_CONTACT, LEAD.FOLLOWING, LEAD.INVALID],
    '待联系': [LEAD.FOLLOWING, LEAD.INVALID, LEAD.CLOSED],
    '跟进中': [LEAD.INTENT, LEAD.DEAL, LEAD.INVALID, LEAD.CLOSED],
    '意向明确': [LEAD.DEAL, LEAD.INVALID, LEAD.CLOSED],
    '已成交': [], '无效': [], '已关闭': []
  };
  var LEAD_LEVELS = ['高', '中', '低'];
  var LEAD_CHANNELS = ['公众号', '转介绍', '地推', '电话咨询', '代理推荐', '其他'];

  var ORDER = { PENDING: '待审核', REVIEWED: '待收款', CREDITED: '已入账', REFUNDED: '已退款', CANCELLED: '已取消' };
  var ORDER_STATUS = [ORDER.PENDING, ORDER.REVIEWED, ORDER.CREDITED, ORDER.REFUNDED, ORDER.CANCELLED];
  var ORDER_TONE = {
    '待审核': 'amber', '待收款': 'blue', '已入账': 'green', '已退款': 'red', '已取消': 'slate'
  };
  var ORDER_TYPE = { NEW: '新签', RENEW: '续费' };

  var PAY = { PENDING: '待确认', CONFIRMED: '已确认', REVERSED: '已冲正' };
  var PAY_STATUS = [PAY.PENDING, PAY.CONFIRMED, PAY.REVERSED];
  var PAY_METHODS = ['微信', '支付宝', '银行转账', '现金'];

  /* 收款登记状态：登记 ≠ 入账，只有「已确认」才生成 payments 与课时 */
  var PAY_REG = { PENDING: '待确认', CONFIRMED: '已确认', REJECTED: '已驳回' };
  var PAY_REG_STATUS = [PAY_REG.PENDING, PAY_REG.CONFIRMED, PAY_REG.REJECTED];

  /* 重复报备争议：待裁定 / 已裁定 */
  var DISPUTE = { OPEN: '待裁定', RESOLVED: '已裁定' };
  var DISPUTE_STATUS = [DISPUTE.OPEN, DISPUTE.RESOLVED];

  /* 退款申请：待审核 / 已通过 / 已驳回 */
  var REFUND = { PENDING: '待审核', APPROVED: '已通过', REJECTED: '已驳回' };
  var REFUND_STATUS = [REFUND.PENDING, REFUND.APPROVED, REFUND.REJECTED];

  var AGENT_STATUS = ['待审核', '启用', '停用'];
  var AGENT_TONE = { '待审核': 'amber', '启用': 'green', '停用': 'slate' };
  var AGENT_TYPES = ['个人代理', '合作机构', '内部转介绍'];

  var RENEWAL = {
    PENDING: '待跟进', FOLLOWING: '跟进中', ORDERED: '已转订单', CLOSED: '已关闭'
  };
  var RENEWAL_STATUS = [RENEWAL.PENDING, RENEWAL.FOLLOWING, RENEWAL.ORDERED, RENEWAL.CLOSED];
  var RENEWAL_TONE = { '待跟进': 'amber', '跟进中': 'blue', '已转订单': 'green', '已关闭': 'slate' };
  var RENEWAL_SOURCE = ['课时不足', '套餐临期'];
  var LESSON_ALERT_THRESHOLD = 5;      /* 剩余课时低于 5 生成续费机会 */
  var EXPIRE_ALERT_DAYS = 45;          /* 套餐 45 天内到期生成续费机会 */

  var LEAD_ACTION = {
    CREATED: 'CREATED', FOLLOWED: 'FOLLOWED', STATUS_CHANGED: 'STATUS_CHANGED',
    INTENT: 'INTENT', ORDERED: 'ORDERED', DEAL: 'DEAL', ASSIGNED: 'ASSIGNED', INVALID: 'INVALID'
  };

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
  var SESSION_KEY = 'ee_proto_session_v8';
  var sessionRestored = false;
  /* 持久化「当前登录身份」（角色 + 身份 ID + 操作人）：
     角色切换器写入后，同标签页跨页面延续同一身份；
     页面仍可以用 setSession 显式声明角色，声明结果同样落盘。 */
  function saveSession() {
    try {
      SS.setItem(SESSION_KEY, JSON.stringify({
        role: session.role || '',
        operatorName: session.operatorName || '',
        operatorId: session.operatorId || '',
        accountId: session.accountId || '',
        teacherId: session.teacherId || '',
        agentId: session.agentId || '',
        parentId: session.parentId || ''
      }));
    } catch (e) { /* 静默 */ }
  }
  function restoreSession() {
    try {
      var raw = SS.getItem(SESSION_KEY);
      if (!raw) return;
      var o = JSON.parse(raw);
      if (!o || typeof o !== 'object') return;
      sessionRestored = true;
      if (o.role) session.role = o.role;
      if (o.operatorName) session.operatorName = o.operatorName;
      if (o.operatorId) session.operatorId = o.operatorId;
      if (o.accountId) session.accountId = o.accountId;
      if (o.teacherId) session.teacherId = o.teacherId;
      if (o.agentId) session.agentId = o.agentId;
      if (o.parentId) session.parentId = o.parentId;
    } catch (e) { /* 损坏则用默认会话 */ }
  }
  /** 会话是否来自上次持久化（用于页面判断「用户是否已显式选择过身份」） */
  function sessionPersisted() { return sessionRestored; }

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

    /* ============================================================
       13. 第七轮域：代理 / 客户线索 / 跟进 / 订单 / 收款 / 续费
       ------------------------------------------------------------
       种子只覆盖「各状态各一条」，不追求数量：
         代理：启用 3 个 + 停用 1 个
         线索：新线索 / 待联系 / 跟进中 / 意向明确 / 已成交 / 无效 / 已关闭
         订单：待审核 / 待收款 / 已入账 / 已退款
         续费：课时不足 1 条 + 套餐临期 1 条
       历史订单的课时已由 accounts 承载，v8 不再重复入账；
       新提交订单必须走「收款确认」才产生课时。
       ============================================================ */
    var agents = [];
    var agentLogs = [];
    var agentLogSeq = 0;
    (B.agents || []).forEach(function (a) {
      var pct = /(\d+(?:\.\d+)?)%/.exec(String(a.rule || ''));
      var fixed = /(\d+(?:\.\d+)?)\s*元/.exec(String(a.rule || ''));
      agents.push({
        id: a.id, name: a.name, phone: a.phone || '', wechat: a.wechat || '',
        type: a.type || '个人代理', status: a.status === '停用' ? '停用' : '启用',
        recruiterId: '', ownerId: a.owner || '',
        ruleType: pct ? 'percent' : (fixed ? 'fixed' : 'none'),
        ruleValue: pct ? Number(pct[1]) : (fixed ? Number(fixed[1]) : 0),
        ruleText: a.rule || '规则待确认',
        remark: '', createdBy: a.owner || '', approvedBy: a.owner || '',
        approvedAt: a.created ? a.created + ' 10:00' : '',
        createdAt: (a.created || TODAY) + ' 09:00',
        updatedAt: (a.created || TODAY) + ' 09:00'
      });
      agentLogSeq++;
      agentLogs.push({
        id: 'AL' + pad(agentLogSeq, 3), agentId: a.id, action: 'CREATED',
        detail: '代理档案建立（' + (a.type || '个人代理') + '），规则：' + (a.rule || '待确认'),
        from: '', to: a.status === '停用' ? '停用' : '启用',
        operatorId: a.owner || '', operatorName: a.owner || '', at: (a.created || TODAY) + ' 09:00'
      });
    });

    var products = clone(B.products || []);
    function productByName(name) {
      return products.filter(function (p) { return p.name === name; })[0] ||
        products.filter(function (p) { return String(p.name).indexOf(String(name).replace(/（.*?）/g, '')) >= 0; })[0] || null;
    }
    function productByIntent(intent) {
      var m = /(\d+)\s*课时/.exec(String(intent || ''));
      if (!m) return products[0] || null;
      return products.filter(function (p) { return Number(p.hours) === Number(m[1]); })[0] || products[0] || null;
    }

    var leads = [];
    var leadFollowUps = [];
    var leadLogs = [];
    var leadSeq = 0, followSeq = 0, leadLogSeq = 0;
    (B.leads || []).forEach(function (l) {
      leadSeq++;
      var p = productByIntent(l.intent);
      leads.push({
        id: l.id, code: l.id, name: l.name, phone: l.phone,
        kidName: l.kid || '', grade: l.grade || '', book: l.book || '',
        channel: l.channel || '其他',
        agentId: l.agent || '',                       /* 旧页面兼容镜像 = currentAgentId */
        sourceAgentId: l.agent || '',                 /* 首次获客代理，写入后永不覆盖 */
        currentAgentId: l.agent || '',                /* 当前维护代理，可移交 */
        followerId: l.follower || '',                 /* 维护归属 */
        followerName: l.follower || '',
        intent: l.intent || '', intentProductId: p ? p.id : '',
        status: l.status || LEAD.NEW, level: l.level || '中',
        lastFollowAt: l.lastFollow || '', nextFollowAt: l.next ? l.next + ' 10:00' : '',
        convertedStudentId: '', convertedAt: '',
        createdBy: l.follower || l.agent || '', createdAt: (l.created || TODAY) + ' 09:00',
        updatedAt: l.lastFollow || (l.created || TODAY) + ' 09:00',
        invalidReason: '', remark: ''
      });
      leadLogs.push({
        id: 'LL' + pad(leadLogSeq + 1, 3), leadId: l.id, action: LEAD_ACTION.CREATED,
        detail: '线索建立，来源 ' + (l.channel || '其他') + (l.agent ? '，代理归属 ' + l.agent : ''),
        from: '', to: l.status || LEAD.NEW, operatorId: l.follower || l.agent || '',
        operatorName: l.follower || l.agent || '', at: (l.created || TODAY) + ' 09:00'
      });
      leadLogSeq++;
      if (l.status && l.status !== LEAD.NEW && l.lastFollow) {
        followSeq++;
        leadFollowUps.push({
          id: 'LF' + pad(followSeq, 3), leadId: l.id, type: '电话',
          content: '已与家长沟通 ' + (l.kid || l.name) + ' 的学习情况，意向 ' + (l.intent || '待确认'),
          result: l.status === LEAD.INVALID ? '家长暂时不需要' : '家长表示可以考虑',
          nextAt: l.next ? l.next + ' 10:00' : '',
          by: l.follower || '', byId: l.follower || '', at: l.lastFollow
        });
      }
    });

    var orders = [];
    var payments = [];
    var orderLogs = [];
    var ordSeq = 0, paySeq = 0, ordLogSeq = 0;
    var orderStatusMap = { '已生效': ORDER.CREDITED, '部分付款': ORDER.REVIEWED, '待付款': ORDER.PENDING, '退款处理中': ORDER.REFUNDED };
    (B.orders || []).forEach(function (o) {
      ordSeq++;
      var p = productByName(o.product);
      var st = orderStatusMap[o.status] || ORDER.PENDING;
      /* 历史演示数据里这两单的账户/收款已经在系统里，按「已收款入账」还原，
         避免出现「课时账户有余额、订单却未收款」的凭空课时；同时保留一单待收款、一单待审核。 */
      if (o.id === 'OD20261008002') st = ORDER.CREDITED;
      if (o.id === 'OD20261025004') st = ORDER.REVIEWED;
      var lead = leads.filter(function (x) { return x.phone === o.phone; })[0] || null;
      var stu = (B.students || []).filter(function (x) { return x.id === o.student; })[0] || null;
      var agentId = o.agent || (lead ? lead.agentId : '');
      /* 让「课时不足」的续费机会可追溯到代理：历史订单 OD20261008002 归 A002 */
      if (o.id === 'OD20261008002' && !agentId) agentId = 'A002';
      var paid = Number(o.paid) || 0;
      if (st === ORDER.CREDITED) paid = Number(o.amount) || paid;
      var acc = st === ORDER.CREDITED ? (B.accounts || []).filter(function (a) {
        return a.student === o.studentName && a.product === o.product;
      })[0] || null : null;
      var order = {
        id: o.id, code: o.id, type: ORDER_TYPE.NEW,
        leadId: lead ? lead.id : '', studentId: o.student,
        parentId: stu ? stu.parent : '', agentId: agentId,
        followerId: lead ? lead.followerId : '', ownerAgentId: agentId,
        productId: p ? p.id : '', productName: o.product, hours: Number(o.buy) || 0,
        gift: Number(o.gift) || 0, totalHours: (Number(o.buy) || 0) + (Number(o.gift) || 0),
        amount: Number(o.amount) || 0, paidAmount: paid,
        refundedAmount: 0, partialRefund: false,
        creditedHours: st === ORDER.CREDITED ? (Number(o.buy) || 0) + (Number(o.gift) || 0) : 0,
        status: st, payMethod: o.payType || '',
        paymentId: '', lessonAccountId: acc ? acc.id : '',
        creditedAt: st === ORDER.CREDITED ? (o.pay || TODAY) + ' 10:00' : '',
        creditBy: st === ORDER.CREDITED ? (o.agent || '张敏') : '',
        createdBy: lead ? lead.followerId : (o.agent || ''),
        createdAt: o.created || (TODAY + ' 09:00'), updatedAt: o.created || (TODAY + ' 09:00'),
        reviewedBy: st === ORDER.CREDITED ? '王敏' : '', reviewedAt: st === ORDER.CREDITED ? (o.pay || TODAY) + ' 10:00' : '',
        renewalOpportunityId: '', cancelReason: '', remark: ''
      };
      if (st === ORDER.CREDITED || st === ORDER.REFUNDED) {
        paySeq++;
        order.paymentId = 'PY' + pad(paySeq, 3);
        payments.push({
          id: order.paymentId, orderId: order.id, amount: paid || order.amount,
          method: o.payType || '银行转账',
          status: st === ORDER.REFUNDED ? PAY.REVERSED : PAY.CONFIRMED,
          confirmedBy: '王敏', confirmedAt: (o.pay || TODAY) + ' 10:00',
          note: st === ORDER.REFUNDED ? '订单退款，原收款冲回（历史保留）' : '历史订单收款',
          createdAt: (o.pay || TODAY) + ' 09:30', updatedAt: (o.pay || TODAY) + ' 10:00'
        });
      } else if (st === ORDER.REVIEWED && paid) {
        paySeq++;
        order.paymentId = 'PY' + pad(paySeq, 3);
        payments.push({
          id: order.paymentId, orderId: order.id, amount: paid, method: o.payType || '银行转账',
          status: PAY.PENDING, confirmedBy: '', confirmedAt: '',
          note: '部分付款待确认，未确认前不入课时',
          createdAt: (o.pay || TODAY) + ' 09:30', updatedAt: (o.pay || TODAY) + ' 09:30'
        });
      }
      orders.push(order);
      ordLogSeq++;
      orderLogs.push({
        id: 'OL' + pad(ordLogSeq, 3), orderId: order.id, action: 'CREATED',
        detail: '订单创建：' + order.productName + ' / ' + order.totalHours + ' 课时',
        from: '', to: ORDER.PENDING, operatorId: order.createdBy, operatorName: order.createdBy,
        at: order.createdAt
      });
      if (st !== ORDER.PENDING) {
        ordLogSeq++;
        orderLogs.push({
          id: 'OL' + pad(ordLogSeq, 3), orderId: order.id,
          action: st === ORDER.CREDITED ? 'CREDITED' : (st === ORDER.REFUNDED ? 'REFUNDED' : 'REVIEWED'),
          detail: st === ORDER.CREDITED ? '收款确认，课时入账 ' + order.totalHours + ' 课时' :
            (st === ORDER.REFUNDED ? '订单退款' : '审核通过，待确认收款'),
          from: ORDER.PENDING, to: st, operatorId: '王敏', operatorName: '王敏',
          at: (o.pay || TODAY) + ' 10:00'
        });
      }
    });

    /* 已成交线索回填学员，保证「线索 → 学员 → 订单」可串联 */
    leads.forEach(function (l) {
      if (l.convertedStudentId || l.status !== LEAD.DEAL) return;
      var s = (B.students || []).filter(function (x) {
        var p = (B.parents || []).filter(function (pp) { return pp.id === x.parent; })[0];
        return p && p.phone === l.phone;
      })[0];
      if (s) {
        l.convertedStudentId = s.id;
        l.convertedAt = (s.created || TODAY) + ' 10:00';
      }
    });

    var accounts = clone(B.accounts || []);
    var flows = clone(B.flows || []);
    var stuByName = {};
    (B.students || []).forEach(function (s) { stuByName[s.name] = s; });
    accounts.forEach(function (a) {
      var s = stuByName[a.student];
      a.studentId = s ? s.id : '';
      a.parentId = s ? s.parent : '';
      a.hours = Number(a.buy) || 0;
      a.gift = Number(a.gift) || 0;
      a.used = Number(a.used) || 0;
      a.adjust = Number(a.adjust) || 0;
      a.remain = Number(a.remain) || 0;
      a.orderId = (orders.filter(function (o) { return o.lessonAccountId === a.id; })[0] || {}).id || '';
      a.expireAt = a.expireAt || a.valid || '';
    });
    flows.forEach(function (f) {
      var s = stuByName[f.student];
      f.studentId = s ? s.id : '';
      var m = /(OD\w+)/.exec(String(f.ref || ''));
      f.orderId = m ? m[1] : (f.orderId || '');
      f.accountId = f.account;
    });

    /* 补齐历史链路：每个课时账户都必须能追溯到一笔已收款订单；
       没有订单的账户补一笔历史已入账订单，保证「课时 == 订单」可核对。 */
    accounts.forEach(function (a) {
      if (a.orderId) return;
      var s = stuByName[a.student];
      if (!s) return;
      var p = productByName(a.product) || { id: '', name: a.product, price: a.buy * 120, gift: 0, validMonths: 12 };
      ordSeq++;
      var oid = 'OD' + TODAY.replace(/-/g, '') + 'S' + pad(ordSeq, 3);
      var createdDate = a.expireAt ? addMonths(a.expireAt, -12) : TODAY;
      var o = {
        id: oid, code: oid, type: ORDER_TYPE.NEW, leadId: '',
        studentId: s.id, parentId: s.parent, agentId: 'A003',
        followerId: '', ownerAgentId: 'A003',
        productId: p.id, productName: a.product, hours: Number(a.buy) || 0,
        gift: Number(a.gift) || 0, totalHours: Number(a.buy) + Number(a.gift),
        amount: Number(p.price) || 0, paidAmount: Number(p.price) || 0,
        refundedAmount: 0, partialRefund: false, creditedHours: Number(a.buy) + Number(a.gift),
        status: ORDER.CREDITED, payMethod: '微信', paymentId: '', lessonAccountId: a.id,
        creditedAt: createdDate + ' 10:00', creditBy: '张敏',
        reviewedBy: '王敏', reviewedAt: createdDate + ' 10:00',
        renewalOpportunityId: '', createdBy: '张敏',
        createdAt: createdDate + ' 09:00', updatedAt: createdDate + ' 10:00',
        cancelReason: '', remark: '历史演示数据补齐（账户可追溯到订单）'
      };
      paySeq++;
      o.paymentId = 'PY' + pad(paySeq, 3);
      payments.push({
        id: o.paymentId, orderId: oid, amount: o.amount, method: '微信',
        status: PAY.CONFIRMED, confirmedBy: '王敏', confirmedAt: createdDate + ' 10:00',
        note: '历史订单收款（补齐演示链路）', createdAt: createdDate + ' 09:30', updatedAt: createdDate + ' 10:00'
      });
      orders.push(o);
      a.orderId = oid;
      a.studentId = s.id;
      a.parentId = s.parent;
      orderLogs.push({
        id: 'OL' + pad(ordLogSeq + 1, 3), orderId: oid, action: 'CREDITED',
        detail: '历史订单收款确认，课时入账 ' + o.totalHours + ' 课时',
        from: ORDER.PENDING, to: ORDER.CREDITED, operatorId: '王敏', operatorName: '王敏',
        at: createdDate + ' 10:00'
      });
      ordLogSeq++;
    });

    /* 每个已入账账户补一笔购买/赠送入账流水（已存在的跳过），让订单与课时账逐个对得上 */
    var flowSeq = flows.length;
    accounts.forEach(function (a) {
      var o = orders.filter(function (x) { return x.lessonAccountId === a.id; })[0];
      if (!o || o.status !== ORDER.CREDITED) return;
      var at = o.creditedAt || (TODAY + ' 10:00');
      var stampId = at.slice(0, 10).replace(/-/g, '');
      if (!flows.some(function (f) { return f.account === a.id && f.type === '购买入账'; }) && a.buy > 0) {
        flowSeq++;
        flows.push({
          id: 'FL' + stampId + pad(flowSeq, 3), student: a.student, studentId: a.studentId,
          account: a.id, accountId: a.id, type: '购买入账', delta: a.buy,
          before: 0, after: a.buy, ref: o.id + ' 收款确认', op: '张敏', time: at,
          note: '订单收款确认后入账', orderId: o.id, paymentId: o.paymentId
        });
      }
      if (!flows.some(function (f) { return f.account === a.id && f.type === '赠送入账'; }) && a.gift > 0) {
        flowSeq++;
        flows.push({
          id: 'FL' + stampId + pad(flowSeq, 3), student: a.student, studentId: a.studentId,
          account: a.id, accountId: a.id, type: '赠送入账', delta: a.gift,
          before: a.buy, after: Number(a.buy) + Number(a.gift), ref: o.id + ' 赠送课时',
          op: '张敏', time: at, note: '套餐赠送 ' + a.gift + ' 课时',
          orderId: o.id, paymentId: o.paymentId
        });
      }
      flows.forEach(function (f) {
        if (f.account === a.id && !f.orderId) f.orderId = o.id;
      });
    });

    /* 补一笔“还没收款”的演示订单：待审核 1 条，未收款不产生课时。
       另一单 OD20261025004 已按「待收款」保留。 */
    (function () {
      var pendingStu = (B.students || []).filter(function (x) { return x.id === 'S2026009'; })[0];
      [
        { stu: pendingStu, status: '待审核', agent: 'A002', pid: 'PRD02', date: TODAY + ' 10:00' }
      ].forEach(function (item) {
        if (!item.stu) return;
        var p = products.filter(function (x) { return x.id === item.pid; })[0] || products[1];
        ordSeq++;
        var oid = 'OD' + TODAY.replace(/-/g, '') + pad(ordSeq, 3);
        var o = {
          id: oid, code: oid, type: ORDER_TYPE.NEW, leadId: '',
          studentId: item.stu.id, parentId: item.stu.parent, agentId: item.agent,
          followerId: '', ownerAgentId: item.agent, productId: p.id, productName: p.name,
          hours: p.hours, gift: p.gift, totalHours: p.hours + p.gift,
          amount: p.price, paidAmount: 0, refundedAmount: 0, partialRefund: false, creditedHours: 0,
          status: item.status, payMethod: '',
          paymentId: '', lessonAccountId: '', creditedAt: '', creditBy: '',
          reviewedBy: item.status === '待收款' ? '王敏' : '',
          reviewedAt: item.status === '待收款' ? item.date : '',
          renewalOpportunityId: '', createdBy: '张敏',
          createdAt: item.date, updatedAt: item.date, cancelReason: '',
          remark: '演示订单：' + item.status + '，未收款不产生课时'
        };
        orders.push(o);
        orderLogs.push({
          id: 'OL' + pad(ordLogSeq + 1, 3), orderId: oid, action: 'CREATED',
          detail: '提交报名订单：' + p.name + ' / ' + o.totalHours + ' 课时，' + item.status,
          from: '', to: ORDER.PENDING, operatorId: '张敏', operatorName: '张敏', at: item.date
        });
        ordLogSeq++;
      });
    })();

    /* 学员剩余课时以账户为唯一口径：没有账户就是 0（新建学员不赠送课时） */
    (B.students || []).forEach(function (s) {
      var sum = accounts.filter(function (a) { return a.studentId === s.id; })
        .reduce(function (n, a) { return n + Number(a.remain || 0); }, 0);
      s.remain = sum;
      if (!sum) s.product = '';
    });

    /* 学习反馈：只取已发布报告，代理可见；未发布报告不进入反馈表 */
    var learningFeedbacks = [];
    var fbSeq = 0;
    reports.forEach(function (rp) {
      if (rp.status !== REPORT_STATUS.PUBLISHED) return;
      fbSeq++;
      learningFeedbacks.push({
        id: 'FB' + pad(fbSeq, 3), studentId: rp.studentId, teacherId: rp.teacherId,
        courseId: rp.courseId, reportId: rp.id, title: rp.title,
        performance: rp.content.performance || '', weak: rp.content.weak || '',
        next: rp.content.next || '', status: '已发布', visibleToAgent: true,
        publishedAt: rp.publishedAt || rp.createdAt || '', createdAt: rp.createdAt || ''
      });
    });
    /* 第二个学员的反馈：让 A003 也能看到自己客户的已发布反馈 */
    (function () {
      if (!(B.students || []).some(function (x) { return x.id === 'S2026004'; })) return;
      fbSeq++;
      learningFeedbacks.push({
        id: 'FB' + pad(fbSeq, 3), studentId: 'S2026004', teacherId: 'T004',
        courseId: 'C20261029005', reportId: '', title: 'Unit 1 单词初筛 · 课后反馈',
        performance: '本节完成 20 个单词初筛，12 个已掌握。',
        weak: '字母组合 th / sh 的发音还需要多听多读。',
        next: '下节课继续 Unit 1 剩余单词，并加入 5 个待复习词的莱特纳复习。',
        status: '已发布', visibleToAgent: true,
        publishedAt: '2026-10-29 19:30', createdAt: '2026-10-29 19:20'
      });
    })();

    /* 续费机会：只为有明确代理归属的学员生成，来源、剩余课时、到期日都可追溯 */
    function attributionOfStudent(studentId) {
      var os = orders.filter(function (o) { return o.studentId === studentId && o.status === ORDER.CREDITED; })
        .sort(function (a, b) { return a.createdAt < b.createdAt ? 1 : -1; });
      if (os.length && os[0].agentId) return { agentId: os[0].agentId, orderId: os[0].id, leadId: os[0].leadId || '' };
      var ls = leads.filter(function (x) { return x.convertedStudentId === studentId; })[0];
      if (ls) return { agentId: ls.agentId, orderId: '', leadId: ls.id };
      return { agentId: '', orderId: '', leadId: '' };
    }
    var renewalOpportunities = [];
    var renewalSeq = 0;
    accounts.forEach(function (a) {
      if (!a.studentId) return;
      var at = attributionOfStudent(a.studentId);
      if (!at.agentId) return;
      var low = Number(a.remain) < LESSON_ALERT_THRESHOLD;
      var near = a.expireAt && a.expireAt >= TODAY && a.expireAt <= addDays(TODAY, EXPIRE_ALERT_DAYS);
      if (!low && !near) return;
      renewalSeq++;
      renewalOpportunities.push({
        id: 'RN' + pad(renewalSeq, 3), studentId: a.studentId, leadId: at.leadId,
        agentId: at.agentId, accountId: a.id, orderId: at.orderId,
        sourceType: low ? '课时不足' : '套餐临期',
        remain: a.remain, threshold: LESSON_ALERT_THRESHOLD, expireAt: a.expireAt || '',
        status: RENEWAL.PENDING, handledBy: '', remark: '',
        createdAt: TODAY + ' 08:30', updatedAt: TODAY + ' 08:30', renewalOrderId: ''
      });
    });

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
          SD: demandSeq, TRS: respSeq, DL: dlogSeq, WBR: wbrSeq, SWB: swbSeq,
          TR: 0, TD: 0, PR: 0, TDP: 0, TRPT: 0, RVP: 0, RVR: 0,
          AG: agents.length, LD: leadSeq, LF: followSeq, LLOG: leadLogSeq,
          ORD: ordSeq, PY: paySeq, OLOG: ordLogSeq,
          RN: renewalSeq, FB: fbSeq, ALOG: agentLogSeq,
          FL: flows.length, ACC: accounts.length
        },
        builtAt: stamp()
      },
      /* 第七轮域 */
      agents: agents,
      agentLogs: agentLogs,
      products: products,
      leads: leads,
      leadFollowUps: leadFollowUps,
      leadLogs: leadLogs,
      orders: orders,
      payments: payments,
      orderLogs: orderLogs,
      renewalOpportunities: renewalOpportunities,
      learningFeedbacks: learningFeedbacks,
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
      trainDisplays: [],
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

  /* ---------------- 系统管理域：幂等种子 ----------------
     账号、角色、权限、字典、通知、机构设置都在 normalizeDb 里补齐：
     旧数据只补缺失项，绝不覆盖用户已经调整过的配置。 */
  function ensureSystemData(d) {
    d.staffProfiles = d.staffProfiles || [];
    d.users = d.users || [];
    d.agents = d.agents || [];
    d.parents = d.parents || [];
    d.teachers = d.teachers || [];
    d.roles = d.roles || [];
    d.permissions = d.permissions || [];
    d.rolePermissions = d.rolePermissions || [];
    d.dictionaryTypes = d.dictionaryTypes || [];
    d.dictionaryItems = d.dictionaryItems || [];
    d.notificationRules = d.notificationRules || [];
    d.notifications = d.notifications || [];
    d.auditLogs = d.auditLogs || [];
    d.organization = d.organization || {};
    d.meta = d.meta || { seq: {} };
    d.meta.seq = d.meta.seq || {};

    function maxNum(list, re) {
      return list.reduce(function (m, x) {
        var hit = re.exec(String((x && x.id) || ''));
        return hit ? Math.max(m, Number(hit[1])) : m;
      }, 0);
    }
    function nextAccountId() {
      var n = maxNum(d.users, /^UA(\d+)$/);
      return 'UA' + pad(n + 1, 3);
    }
    function accountStatusByProfile(kind, p) {
      if (kind === 'teacher') {
        if (!p.accountId) return ACCOUNT.NONE;
        var u = d.users.filter(function (x) { return x.id === p.accountId; })[0];
        return u ? u.status : ACCOUNT.NONE;
      }
      if (kind === 'agent') {
        if (p.status === '启用') return ACCOUNT.OK;
        return p.status === '停用' ? ACCOUNT.DISABLED : ACCOUNT.NONE;
      }
      if (kind === 'parent') return p.status === '停用' ? ACCOUNT.DISABLED : ACCOUNT.OK;
      return ACCOUNT.OK;
    }

    /* 内部员工档案：角色身份来自档案，页面不得再硬编码姓名/工号；
       noAccount 表示档案已入职但尚未开通登录账号，用于验证「新增账号」流程 */
    [['STF001', '张敏', '13901110000', 'admin'],
      ['STF002', '陈静', '13902220000', 'staff'],
      ['STF003', '王敏', '13903330000', 'ops'],
      ['STF004', '刘洋', '13904440000', 'staff', true],
      ['STF005', '赵磊', '13905550000', 'ops', true]].forEach(function (x) {
      if (d.staffProfiles.some(function (p) { return p.id === x[0]; })) return;
      d.staffProfiles.push({
        id: x[0], name: x[1], phone: x[2], roleCode: x[3], noAccount: !!x[4],
        status: '在职', createdAt: TODAY + ' 09:00', updatedAt: TODAY + ' 09:00'
      });
    });

    /* 统一账号：教师账号保留原有结构，只补 profileType/profileId/roleCode；
       代理、家长、内部员工按人员档案补账号，已有账号不重复创建 */
    d.users.forEach(function (u) {
      u.phone = u.phone || '';
      u.loginName = u.loginName || u.phone;
      u.username = u.loginName;
      u.passwordHash = u.passwordHash || '';
      if (u.mustChangePassword === undefined) u.mustChangePassword = true;
      u.status = [ACCOUNT.OK, ACCOUNT.DISABLED, ACCOUNT.NONE].indexOf(u.status) >= 0 ? u.status : ACCOUNT.OK;
      if (u.teacherId) {
        u.profileType = u.profileType || 'teacher';
        u.profileId = u.profileId || u.teacherId;
        u.roleCode = 'teacher';
      } else {
        u.profileType = u.profileType || 'staff';
        u.profileId = u.profileId || ('STF' + pad(d.staffProfiles.findIndex(function (p) { return p.name === u.loginName; }) + 1, 3));
        u.roleCode = u.roleCode || u.roleId || 'admin';
      }
      u.roleId = u.roleCode;
      u.createdAt = u.createdAt || (TODAY + ' 09:00');
      u.updatedAt = u.updatedAt || u.createdAt;
      u.lastLoginAt = u.lastLoginAt || '';
      u.disabledReason = u.disabledReason || '';
    });

    d.staffProfiles.forEach(function (p) {
      if (p.noAccount) return;
      var exists = d.users.filter(function (u) {
        return u.profileType === 'staff' && u.profileId === p.id;
      })[0];
      if (exists) { exists.roleCode = p.roleCode; exists.roleId = p.roleCode; return; }
      var u = {
        id: nextAccountId(), loginName: p.phone, username: p.phone, phone: p.phone,
        passwordHash: '', mustChangePassword: true, status: ACCOUNT.OK,
        roleCode: p.roleCode, roleId: p.roleCode, profileType: 'staff', profileId: p.id,
        teacherId: '', staffId: p.id, lastLoginAt: '', disabledReason: '',
        createdAt: p.createdAt || (TODAY + ' 09:00'), updatedAt: p.createdAt || (TODAY + ' 09:00')
      };
      d.users.push(u);
    });

    d.agents.forEach(function (a) {
      a.accountId = a.accountId || '';
      a.roleCode = 'agent';
      var acc = d.users.filter(function (u) { return u.profileType === 'agent' && u.profileId === a.id; })[0];
      if (acc) { a.accountId = acc.id; acc.roleCode = 'agent'; acc.roleId = 'agent'; return; }
      var st = accountStatusByProfile('agent', a);
      var u = {
        id: nextAccountId(), loginName: a.phone || a.id, username: a.phone || a.id, phone: a.phone || '',
        passwordHash: '', mustChangePassword: true, status: st,
        roleCode: 'agent', roleId: 'agent', profileType: 'agent', profileId: a.id,
        agentId: a.id, teacherId: '', lastLoginAt: '',
        disabledReason: st === ACCOUNT.DISABLED ? '代理已停用' : (st === ACCOUNT.NONE ? '代理待审核，账号未开通' : ''),
        createdAt: a.createdAt || a.created || (TODAY + ' 09:00'),
        updatedAt: a.createdAt || a.created || (TODAY + ' 09:00')
      };
      d.users.push(u);
      a.accountId = u.id;
    });

    d.parents.forEach(function (p) {
      p.accountId = p.accountId || '';
      p.roleCode = 'parent';
      var acc = d.users.filter(function (u) { return u.profileType === 'parent' && u.profileId === p.id; })[0];
      if (acc) { p.accountId = acc.id; acc.roleCode = 'parent'; acc.roleId = 'parent'; return; }
      var st = accountStatusByProfile('parent', p);
      var u = {
        id: nextAccountId(), loginName: p.phone || p.id, username: p.phone || p.id, phone: p.phone || '',
        passwordHash: '', mustChangePassword: true, status: st,
        roleCode: 'parent', roleId: 'parent', profileType: 'parent', profileId: p.id,
        parentId: p.id, teacherId: '', lastLoginAt: '',
        disabledReason: st === ACCOUNT.DISABLED ? '家长账号已停用' : '',
        createdAt: TODAY + ' 09:00', updatedAt: TODAY + ' 09:00'
      };
      d.users.push(u);
      p.accountId = u.id;
    });

    d.teachers.forEach(function (t) {
      var u = t.accountId ? d.users.filter(function (x) { return x.id === t.accountId; })[0] : null;
      if (!u) {
        u = d.users.filter(function (x) { return x.profileType === 'teacher' && x.profileId === t.id; })[0];
        if (u) t.accountId = u.id;
      }
      if (u) {
        u.profileType = 'teacher'; u.profileId = t.id; u.teacherId = t.id;
        u.roleCode = 'teacher'; u.roleId = 'teacher';
      }
    });

    /* 角色与权限 */
    ROLE_SEED.forEach(function (r, i) {
      var role = d.roles.filter(function (x) { return x.code === r.code; })[0];
      if (!role) {
        role = {
          id: 'R' + pad(i + 1, 3), code: r.code, name: r.name, description: r.description,
          dataScope: r.dataScope, system: true, status: '启用',
          createdAt: TODAY + ' 09:00', updatedAt: TODAY + ' 09:00'
        };
        d.roles.push(role);
      }
      role.dataScope = role.dataScope || r.dataScope;
      role.status = role.status || '启用';
    });

    PERMISSION_SEED.forEach(function (p, i) {
      if (d.permissions.some(function (x) { return x.code === p[0]; })) return;
      d.permissions.push({
        id: 'P' + pad(i + 1, 3), code: p[0], module: p[1], name: p[2],
        description: p[3], type: p[4] || 'action', status: '启用'
      });
    });

    var permByCode = {};
    d.permissions.forEach(function (p) { permByCode[p.code] = p; });
    d.roles.forEach(function (role) {
      var def = DEFAULT_PERM[role.code] || { codes: [], dataScope: role.dataScope || 'ALL' };
      d.permissions.forEach(function (p) {
        var exists = d.rolePermissions.filter(function (rp) {
          return rp.roleCode === role.code && rp.permissionCode === p.code;
        })[0];
        if (exists) { exists.roleId = role.id; return; }
        var enabled = !!def.all || (def.codes || []).indexOf(p.code) >= 0;
        d.rolePermissions.push({
          id: 'RP-' + role.code + '-' + p.code, roleId: role.id, roleCode: role.code,
          permissionId: p.id, permissionCode: p.code, enabled: enabled,
          dataScope: def.dataScope || role.dataScope || 'ALL',
          updatedAt: TODAY + ' 09:00', updatedBy: 'system'
        });
      });
      if (!def.all && role.code !== 'admin') {
        var first = d.rolePermissions.filter(function (rp) { return rp.roleCode === role.code; })[0];
        if (first && !role.dataScope) role.dataScope = first.dataScope;
      }
    });

    /* 字典：类型 + 选项；只补缺失，历史选项保留 */
    DICT_TYPE_SEED.forEach(function (t) {
      if (d.dictionaryTypes.some(function (x) { return x.code === t.code; })) return;
      d.dictionaryTypes.push({
        id: 'DT' + pad(d.dictionaryTypes.length + 1, 3), code: t.code, name: t.name,
        description: t.description, status: '启用', createdAt: TODAY + ' 09:00'
      });
    });
    var dictSeq = maxNum(d.dictionaryItems, /^DI(\d+)$/);
    Object.keys(DICT_ITEM_SEED).forEach(function (typeCode) {
      DICT_ITEM_SEED[typeCode].forEach(function (label) {
        var exists = d.dictionaryItems.filter(function (x) {
          return x.typeCode === typeCode && x.label === label;
        })[0];
        if (exists) return;
        dictSeq++;
        d.dictionaryItems.push({
          id: 'DI' + pad(dictSeq, 3), typeCode: typeCode, label: label,
          value: label, sort: dictSeq, status: '启用', remark: '',
          createdAt: TODAY + ' 09:00', updatedAt: TODAY + ' 09:00'
        });
      });
    });
    d.meta.seq.DI = Math.max(d.meta.seq.DI || 0, dictSeq);
    d.meta.seq.UA = Math.max(d.meta.seq.UA || 0, maxNum(d.users, /^UA(\d+)$/));
    d.meta.seq.R = Math.max(d.meta.seq.R || 0, maxNum(d.roles, /^R(\d+)$/));

    /* 通知规则 */
    NOTIFY_RULE_SEED.forEach(function (r, i) {
      if (d.notificationRules.some(function (x) {
        return x.event === r.event && x.receiverRole === r.role;
      })) return;
      d.notificationRules.push({
        id: 'NR' + pad(i + 1, 3), event: r.event, name: r.name,
        receiverRole: r.role, titleTemplate: r.title, contentTemplate: r.content,
        businessType: r.business, enabled: true, channels: ['站内信'],
        createdAt: TODAY + ' 09:00', updatedAt: TODAY + ' 09:00'
      });
    });
    d.meta.seq.NR = Math.max(d.meta.seq.NR || 0, d.notificationRules.length);
    var ntSeq = maxNum(d.notifications, /^NT(\d+)$/);
    d.meta.seq.NT = Math.max(d.meta.seq.NT || 0, ntSeq);
    var audSeq = maxNum(d.auditLogs, /^AUD(\d+)$/);
    d.meta.seq.audit = Math.max(d.meta.seq.audit || 0, audSeq);

    /* 机构设置：只补默认值 */
    Object.keys(ORG_SEED).forEach(function (k) {
      if (d.organization[k] === undefined) d.organization[k] = ORG_SEED[k];
    });
    d.organization.updatedAt = d.organization.updatedAt || (TODAY + ' 09:00');
    d.organization.updatedBy = d.organization.updatedBy || 'system';

    /* 账号状态与教师档案互指：未开通账号不自动创建 */
    d.teachers.forEach(function (t) {
      if (t.accountId && !d.users.some(function (u) { return u.id === t.accountId; })) t.accountId = '';
    });
    return d;
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
    d.config.renewal = d.config.renewal || {
      lessonThreshold: LESSON_ALERT_THRESHOLD,
      expireDays: EXPIRE_ALERT_DAYS
    };
    /* 统一复习计划的间隔策略（可配置；训练检测与复习动作都从这里取间隔，不散落硬编码天数） */
    d.config.reviewStrategy = d.config.reviewStrategy || {
      interval: { not_mastered: 1, needs_practice: 3, mastered: 7 },
      maxStage: 5, multiplier: 1.5
    };

    /* ---- 第七轮域：结构性默认值 ---- */
    d.agents = d.agents || [];
    d.agentLogs = d.agentLogs || [];
    d.products = d.products || [];
    d.leads = d.leads || [];
    d.leadFollowUps = d.leadFollowUps || [];
    d.leadLogs = d.leadLogs || [];
    d.orders = d.orders || [];
    d.payments = d.payments || [];
    d.orderLogs = d.orderLogs || [];
    d.renewalOpportunities = d.renewalOpportunities || [];
    d.learningFeedbacks = d.learningFeedbacks || [];
    d.accounts = d.accounts || [];
    d.flows = d.flows || [];
    /* ---- 第七轮加固域：关系 / 争议 / 收款登记 / 退款 ---- */
    d.parentStudents = d.parentStudents || [];
    d.parentInquiries = d.parentInquiries || [];
    d.leadDisputes = d.leadDisputes || [];
    d.paymentRegistrations = d.paymentRegistrations || [];
    d.refundRequests = d.refundRequests || [];

    d.agents.forEach(function (a) {
      a.status = AGENT_STATUS.indexOf(a.status) >= 0 ? a.status : '待审核';
      a.type = a.type || '个人代理';
      a.phone = a.phone || ''; a.wechat = a.wechat || '';
      a.ruleType = a.ruleType || 'none';
      if (typeof a.ruleValue !== 'number') a.ruleValue = 0;
      a.ruleText = a.ruleText || '规则待确认';
      a.recruiterId = a.recruiterId || '';
      a.ownerId = a.ownerId || '';
      a.createdAt = a.createdAt || (TODAY + ' 09:00');
      a.updatedAt = a.updatedAt || a.createdAt;
    });

    d.products.forEach(function (p) {
      p.hours = Number(p.hours) || 0;
      p.gift = Number(p.gift) || 0;
      p.amount = Number(p.amount || p.price) || 0;
      p.name = p.name || '';
      p.status = p.status === '停用' ? '停用' : '在售';
      var vm = /\d+/.exec(String(p.validMonths || p.valid || ''));
      p.validMonths = vm ? Number(vm[0]) : 12;
      p.description = p.description || '';
    });

    d.leads.forEach(function (l) {
      l.status = LEAD_STATUS.indexOf(l.status) >= 0 ? l.status : LEAD.NEW;
      l.level = LEAD_LEVELS.indexOf(l.level) >= 0 ? l.level : '中';
      /* 归属三字段（v8 加固）：agentId 只作为旧页面兼容镜像，
         真实口径是 sourceAgentId（首次获客，永不覆盖）/ currentAgentId（当前维护，可移交）。 */
      l.sourceAgentId = l.sourceAgentId || l.agentId || '';
      l.currentAgentId = l.currentAgentId || l.agentId || '';
      l.agentId = l.currentAgentId;
      l.followerId = l.followerId || l.currentAgentId || '';
      l.followerName = l.followerName || l.followerId;
      l.kidName = l.kidName || ''; l.grade = l.grade || ''; l.book = l.book || '';
      l.intentProductId = l.intentProductId || '';
      l.convertedStudentId = l.convertedStudentId || '';
      l.convertedAt = l.convertedAt || '';
      l.createdAt = l.createdAt || (TODAY + ' 09:00');
      l.updatedAt = l.updatedAt || l.createdAt;
    });

    d.leadDisputes.forEach(function (x) {
      x.status = DISPUTE_STATUS.indexOf(x.status) >= 0 ? x.status : DISPUTE.OPEN;
      x.reason = x.reason || ''; x.result = x.result || '';
      x.createdAt = x.createdAt || (TODAY + ' 09:00');
    });

    d.leadFollowUps.forEach(function (f) {
      f.type = f.type || '电话';
      f.content = f.content || '';
      f.by = f.by || ''; f.byId = f.byId || '';
      f.at = f.at || f.createdAt || (TODAY + ' 09:00');
    });

    d.orders.forEach(function (o) {
      o.type = o.type === ORDER_TYPE.RENEW ? ORDER_TYPE.RENEW : ORDER_TYPE.NEW;
      o.status = ORDER_STATUS.indexOf(o.status) >= 0 ? o.status : ORDER.PENDING;
      o.hours = Number(o.hours) || 0;
      o.gift = Number(o.gift) || 0;
      o.totalHours = Number(o.totalHours) || (o.hours + o.gift);
      o.amount = Number(o.amount) || 0;
      o.paidAmount = Number(o.paidAmount) || 0;
      o.refundedAmount = Number(o.refundedAmount) || 0;
      o.partialRefund = !!o.partialRefund;
      o.creditedHours = Number(o.creditedHours) || 0;
      if (o.status === ORDER.CREDITED && !o.creditedHours) o.creditedHours = Number(o.totalHours) || 0;
      o.agentId = o.agentId || '';
      o.ownerAgentId = o.ownerAgentId || o.agentId;
      o.leadId = o.leadId || ''; o.studentId = o.studentId || ''; o.parentId = o.parentId || '';
      o.paymentId = o.paymentId || ''; o.lessonAccountId = o.lessonAccountId || '';
      o.creditedAt = o.creditedAt || '';
      o.renewalOpportunityId = o.renewalOpportunityId || '';
      o.createdAt = o.createdAt || (TODAY + ' 09:00');
      o.updatedAt = o.updatedAt || o.createdAt;
    });

    d.payments.forEach(function (p) {
      p.status = PAY_STATUS.indexOf(p.status) >= 0 ? p.status : PAY.PENDING;
      p.amount = Number(p.amount) || 0;
      p.method = p.method || '微信';
      p.confirmedBy = p.confirmedBy || ''; p.confirmedAt = p.confirmedAt || '';
      p.createdAt = p.createdAt || (TODAY + ' 09:00');
    });

    /* 登记 ≠ 入账：v8 种子/旧数据里的「待确认」收款统一迁移到登记表，
       payments 只保留已确认 / 已冲正的正式收款记录。 */
    d.paymentRegistrations.forEach(function (r) {
      r.status = PAY_REG_STATUS.indexOf(r.status) >= 0 ? r.status : PAY_REG.PENDING;
      r.amount = Number(r.amount) || 0;
      r.method = r.method || '微信';
      r.registeredAt = r.registeredAt || r.createdAt || (TODAY + ' 09:00');
      r.createdAt = r.createdAt || r.registeredAt;
    });
    var legacyPending = d.payments.filter(function (p) { return p.status === PAY.PENDING; });
    legacyPending.forEach(function (p) {
      if (d.paymentRegistrations.some(function (r) { return r.paymentId === p.id || (r.orderId === p.orderId && r.amount === p.amount); })) return;
      d.paymentRegistrations.push({
        id: 'PST' + pad(d.paymentRegistrations.length + 1, 3), orderId: p.orderId, amount: Number(p.amount) || 0,
        method: p.method || '微信', voucherNo: '', note: p.note || '历史待确认收款，已迁移为登记',
        registeredBy: p.registeredBy || p.confirmedBy || '历史数据', registeredAt: p.createdAt || (TODAY + ' 09:00'),
        status: PAY_REG.PENDING, confirmedBy: '', confirmedAt: '', paymentId: '',
        createdAt: p.createdAt || (TODAY + ' 09:00'), updatedAt: p.createdAt || (TODAY + ' 09:00')
      });
    });
    if (legacyPending.length) {
      d.payments = d.payments.filter(function (p) { return p.status !== PAY.PENDING; });
      d.orders.forEach(function (o) {
        if (o.paymentId && !d.payments.some(function (p) { return p.id === o.paymentId; })) o.paymentId = '';
      });
    }

    d.refundRequests.forEach(function (r) {
      r.status = REFUND_STATUS.indexOf(r.status) >= 0 ? r.status : REFUND.PENDING;
      r.amount = Number(r.amount) || 0;
      r.requestedAt = r.requestedAt || r.createdAt || (TODAY + ' 09:00');
      r.createdAt = r.createdAt || r.requestedAt;
    });

    d.renewalOpportunities.forEach(function (r) {
      r.status = RENEWAL_STATUS.indexOf(r.status) >= 0 ? r.status : RENEWAL.PENDING;
      r.sourceType = RENEWAL_SOURCE.indexOf(r.sourceType) >= 0 ? r.sourceType : '课时不足';
      r.remain = Number(r.remain) || 0;
      r.createdAt = r.createdAt || (TODAY + ' 08:30');
      r.updatedAt = r.updatedAt || r.createdAt;
      r.renewalOrderId = r.renewalOrderId || '';
    });

    d.learningFeedbacks.forEach(function (f) {
      f.status = f.status === '草稿' ? '草稿' : '已发布';
      if (f.visibleToAgent === undefined) f.visibleToAgent = true;
      /* 可见性拆分兼容：历史已发布反馈默认对家长可见，不因新增字段而消失 */
      if (f.visibleToParent === undefined) f.visibleToParent = f.status === '已发布';
      if (f.homeworkAdvice === undefined) f.homeworkAdvice = '';
      f.createdAt = f.createdAt || (TODAY + ' 09:00');
      f.publishedAt = f.publishedAt || (f.status === '已发布' ? f.createdAt : '');
    });

    ['AG', 'LD', 'LF', 'LLOG', 'ORD', 'PY', 'OLOG', 'RN', 'FB', 'ALOG', 'FL', 'ACC',
      'PS', 'PST', 'DSP', 'RFD'].forEach(function (k) {
      d.meta.seq[k] = d.meta.seq[k] || 0;
    });
    d.meta.seq.AG = Math.max(d.meta.seq.AG, d.agents.length);
    d.meta.seq.ALOG = Math.max(d.meta.seq.ALOG, d.agentLogs.length);
    d.meta.seq.FL = Math.max(d.meta.seq.FL, d.flows.length);
    var accMax = d.meta.seq.ACC || 0;
    d.accounts.forEach(function (a) {
      var m = /^ACC-\d{4}-(\d+)/.exec(String(a.id || ''));
      if (m) accMax = Math.max(accMax, Number(m[1]));
    });
    d.flows.forEach(function (f) {
      var m = /^ACC-\d{4}-(\d+)/.exec(String(f.account || ''));
      if (m) accMax = Math.max(accMax, Number(m[1]));
    });
    d.meta.seq.ACC = Math.max(d.meta.seq.ACC, accMax);
    d.meta.seq.LD = Math.max(d.meta.seq.LD, d.leads.length);
    d.meta.seq.LF = Math.max(d.meta.seq.LF, d.leadFollowUps.length);
    d.meta.seq.LLOG = Math.max(d.meta.seq.LLOG, d.leadLogs.length);
    d.meta.seq.ORD = Math.max(d.meta.seq.ORD, d.orders.length);
    d.meta.seq.PY = Math.max(d.meta.seq.PY, d.payments.length);
    d.meta.seq.OLOG = Math.max(d.meta.seq.OLOG, d.orderLogs.length);
    d.meta.seq.RN = Math.max(d.meta.seq.RN, d.renewalOpportunities.length);
    d.meta.seq.FB = Math.max(d.meta.seq.FB, d.learningFeedbacks.length);
    d.meta.seq.PS = Math.max(d.meta.seq.PS, d.parentStudents.length);
    d.meta.seq.PST = Math.max(d.meta.seq.PST, d.paymentRegistrations.length);
    d.meta.seq.DSP = Math.max(d.meta.seq.DSP, d.leadDisputes.length);
    d.meta.seq.RFD = Math.max(d.meta.seq.RFD, d.refundRequests.length);

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

    /* 课时余额唯一口径：accounts.remain 之和。
       任何「没有账户却有课时」的历史脏数据在这里被清零，避免凭空课时。 */
    d.students.forEach(function (s) {
      var sum = d.accounts.filter(function (a) {
        return (a.studentId && a.studentId === s.id) || (!a.studentId && a.student === s.name);
      }).reduce(function (n, a) { return n + Number(a.remain || 0); }, 0);
      s.remain = sum;
      if (!sum && s.product) s.product = '';
    });
    d.accounts.forEach(function (a) {
      if (a.studentId) return;
      var s = d.students.filter(function (x) { return x.name === a.student; })[0];
      if (s) { a.studentId = s.id; a.parentId = a.parentId || s.parent || ''; }
    });
    /* 家长—学员多对多关系：旧字段 student.parent / parent.kids 仅作兼容读取，
       parentStudents 关系表是家长端投影的唯一口径（一个孩子可对应父母两个账号）。 */
    d.parentStudents = d.parentStudents.filter(function (x) {
      if (!x) return false;
      if (x.parentId === undefined) x.parentId = x.parent;
      if (x.studentId === undefined) x.studentId = x.student;
      delete x.parent; delete x.student;
      return d.parents.some(function (p) { return p.id === x.parentId; }) &&
        d.students.some(function (s) { return s.id === x.studentId; });
    });
    d.parentStudents.forEach(function (x, i) {
      x.id = x.id || ('PS' + pad(i + 1, 3));
      x.relationship = x.relationship || '家长';
      x.isPrimaryContact = x.isPrimaryContact === undefined ? true : !!x.isPrimaryContact;
      x.createdAt = x.createdAt || (TODAY + ' 09:00');
    });
    if (!d.parentStudents.length) {
      d.students.forEach(function (s, i) {
        if (!s.parent) return;
        var p = d.parents.filter(function (x) { return x.id === s.parent; })[0];
        if (!p) return;
        d.parentStudents.push({
          id: 'PS' + pad(i + 1, 3), parentId: s.parent, studentId: s.id,
          relationship: p.relation || '家长', isPrimaryContact: true,
          createdAt: s.created || TODAY, createdBy: '历史数据（按 student.parent 生成）'
        });
      });
    }

    /* 订单与课时账户互链：已入账订单必须有账户；账户必须能追溯到订单 */
    d.orders.forEach(function (o) {
      if (o.status !== ORDER.CREDITED) return;
      if (!o.lessonAccountId) {
        var acc = d.accounts.filter(function (a) {
          return a.orderId === o.id || (a.studentId === o.studentId && a.product === o.productName);
        })[0];
        if (acc) o.lessonAccountId = acc.id;
      }
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

      /* ---- 第九轮：多词库动态训练任务的加法字段 ----
         旧任务（单个 wordbookId）原样可用：wordbookIds 由 wordbookId 反推，
         展示流标记 displayFlow=false 表示走历史的「逐词判断」记录方式，
         历史 trainDetails 的读取与统计能力全部保留。 */
      if (!Array.isArray(t.wordbookIds)) t.wordbookIds = t.wordbookId ? [t.wordbookId] : [];
      if (!t.wordbookId && t.wordbookIds.length) t.wordbookId = t.wordbookIds[0];
      if (!t.currentWordbookId) t.currentWordbookId = t.wordbookIds[0] || '';
      if (typeof t.displayFlow !== 'boolean') t.displayFlow = false;
      if (!Array.isArray(t.wordIds)) t.wordIds = [];
      if (!Array.isArray(t.candidateWordIds)) {
        /* 旧任务没有独立候选集合：不认识且已作答的词即候选 */
        t.candidateWordIds = (t.wordIds || []).filter(function (id) {
          return t.prescreen && t.prescreen[id] && !t.prescreen[id].known;
        });
      }
      if (!Array.isArray(t.knownWordIds)) t.knownWordIds = [];
      if (!Array.isArray(t.queueWordIds)) t.queueWordIds = [];
      if (!Array.isArray(t.remainWordIds)) t.remainWordIds = [];
      if (!t.prescreen || typeof t.prescreen !== 'object') t.prescreen = {};
      if (!t.prescreenStats || typeof t.prescreenStats !== 'object') t.prescreenStats = null;
      if (t.prescreenCompletedAt === undefined) t.prescreenCompletedAt = t.phase === '预筛选' ? null : (t.createdAt || null);
      if (typeof t.targetCount !== 'number' || !(t.targetCount > 0)) {
        t.targetCount = Math.min(TARGET_RANGE.max, Math.max(TARGET_RANGE.min, (t.queueWordIds || []).length || TARGET_RANGE.def));
      }
      if (!t.groupSize) t.groupSize = TRAIN_GROUP_SIZE;
      if (!t.groupIndex) t.groupIndex = 0;
      if (!t.results || typeof t.results !== 'object') t.results = {};
      if (!t.finalResults || typeof t.finalResults !== 'object') t.finalResults = {};
      if (!t.joins) t.joins = { leitner: [], plan21: [], planIds: [], green: [] };
      /* wordbookName 是旧页面的展示字段，多词库时给一个稳定的摘要 */
      if (!t.wordbookName) {
        var nb = (t.wordbookIds || []).map(function (id) {
          var b = d.wordbooks.filter(function (x) { return x.id === id; })[0];
          return b ? b.name : '';
        }).filter(Boolean);
        t.wordbookName = nb.length > 1 ? nb[0] + ' 等 ' + nb.length + ' 个词库' : (nb[0] || '未指定词库');
      }
    });

    /* 展示进度记录（第九轮新表）：只记录教师带读了几轮，不产生掌握判断 */
    d.trainDisplays = d.trainDisplays || [];
    d.trainDisplays.forEach(function (x) {
      x.displayStep = Math.max(0, Math.min(DISPLAY_STEP.DONE, Number(x.displayStep) || 0));
      x.cycleCompleted = !!x.cycleCompleted || x.displayStep >= DISPLAY_STEP.DONE;
      x.groupIndex = Number(x.groupIndex) || 0;
      x.updatedAt = x.updatedAt || x.at || '';
      x.taps = Number(x.taps) || x.displayStep;
      delete x.at;
    });
    d.meta.seq.TDP = Math.max(d.meta.seq.TDP || 0, d.trainDisplays.length);

    /* 统一训练会话报告 / 统一复习计划 / 统一复习记录（本轮新增，附加式默认，不改旧集合） */
    d.trainingReports = d.trainingReports || [];
    d.reviewPlans = d.reviewPlans || [];
    d.reviewRecords = d.reviewRecords || [];
    d.meta.seq.TRPT = Math.max(d.meta.seq.TRPT || 0, d.trainingReports.length);
    d.meta.seq.RVP = Math.max(d.meta.seq.RVP || 0, d.reviewPlans.length);
    d.meta.seq.RVR = Math.max(d.meta.seq.RVR || 0, d.reviewRecords.length);

    /* 学员单词档案：补上独立的初筛状态（不改变已有 state / prescreenKnown 语义） */
    d.studentWordStates = d.studentWordStates || [];
    d.studentWordStates.forEach(function (s) {
      if (s.prescreenKnown === undefined) s.prescreenKnown = null;
      if (s.screeningStatus === undefined) {
        s.screeningStatus = s.prescreenKnown === true ? SCREEN.KNOWN
          : s.prescreenKnown === false ? SCREEN.UNKNOWN : SCREEN.NONE;
      }
      if (s.screeningStatus && [SCREEN.KNOWN, SCREEN.UNKNOWN].indexOf(s.screeningStatus) < 0) s.screeningStatus = SCREEN.NONE;
      if (s.screenedKnownAt === undefined) s.screenedKnownAt = null;
      if (s.screenedKnownBy === undefined) s.screenedKnownBy = '';
      if (s.screeningSourceTaskId === undefined) s.screeningSourceTaskId = null;
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

    ensureSystemData(d);
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
  var V8_COLLECTIONS = ['agents', 'agentLogs', 'products', 'leads', 'leadFollowUps', 'leadLogs', 'orders',
    'payments', 'orderLogs', 'renewalOpportunities', 'learningFeedbacks'];

  /**
   * v8 → v9 一次性迁移（系统管理域）。
   * v9 新增账号统一字段、角色/权限、审计日志、字典、通知规则与机构设置；
   * 原有集合原样搬运，新集合用种子补齐。无论成功失败都不删除 ee_proto_store_v8，
   * 失败时在 meta.migration 写入原因，页面据此提示并保留旧 key 作为备份。
   */
  function loadLegacyV8() {
    var raw = null;
    try { raw = SS.getItem(LEGACY_KEY_V8); } catch (e) { return null; }
    if (!raw) return null;
    var old;
    try { old = JSON.parse(raw); } catch (e) { old = null; }
    if (!old || typeof old !== 'object') {
      try { console.warn('[Store] ' + LEGACY_KEY_V8 + ' 无法解析，已保留原始数据作为备份，演示数据重置为 v9 种子'); } catch (e) { }
      var bad = normalizeDb(buildSeed());
      bad.meta.migration = {
        from: 'v8', to: 'v9', at: stamp(), ok: false,
        reason: 'v8 数据无法解析',
        strategy: '迁移失败，未修改旧 key，演示数据已重置为 v9 种子',
        carried: [], seeded: [], backupKey: LEGACY_KEY_V8
      };
      return bad;
    }
    try {
      var seed = buildSeed();
      var out = normalizeDb(seed);
      var moved = [], reset = [];
      Object.keys(seed).forEach(function (k) {
        if (!Array.isArray(seed[k])) return;
        if (!Array.isArray(old[k])) { reset.push(k); return; }
        out[k] = clone(old[k]);
        moved.push(k);
      });
      /* 计数器取两侧最大值，避免迁移后新建单据与历史编号冲突 */
      var oldSeq = (old.meta && old.meta.seq) || {};
      Object.keys(oldSeq).forEach(function (k) {
        var n = Number(oldSeq[k]);
        if (!isFinite(n)) return;
        out.meta.seq[k] = Math.max(Number(out.meta.seq[k] || 0), n);
      });
      out.version = VERSION;
      out.meta.migration = {
        from: 'v8', to: 'v9', at: stamp(), ok: true,
        strategy: '按集合搬运 + 系统管理新表用种子补齐；v8 原始数据保留在 ' + LEGACY_KEY_V8,
        carried: moved, seeded: reset, backupKey: LEGACY_KEY_V8
      };
      try {
        console.info('[Store] 已从 v8 迁移本地演示数据：保留 ' + moved.length + ' 个集合，' +
          reset.length + ' 个集合用种子补齐；' + LEGACY_KEY_V8 + ' 已保留为备份');
      } catch (e) { }
      return normalizeDb(out);
    } catch (e) {
      try { console.warn('[Store] v8 迁移失败，已保留 ' + LEGACY_KEY_V8 + ' 原始数据，演示数据已重置：' + e.message); } catch (x) { }
      var fail = normalizeDb(buildSeed());
      fail.meta.migration = {
        from: 'v8', to: 'v9', at: stamp(), ok: false,
        reason: String(e && e.message || e),
        strategy: '迁移失败，未修改旧 key，演示数据已重置为 v9 种子',
        carried: [], seeded: [], backupKey: LEGACY_KEY_V8
      };
      return fail;
    }
  }

  /**
   * v7 → v8 一次性迁移。
   * v8 在 v7 的基础上新增代理/线索/订单/收款/续费/学习反馈六组表，
   * 原有学习域集合结构不变，因此按集合原样搬运，新表用种子补齐。
   * 永不删除 ee_proto_store_v7；迁移结果写入 db.meta.migration 供界面提示。
   * 返回 null 表示没有可迁移的 v7 数据。
   */
  function loadLegacyV7() {
    var raw = null;
    try { raw = SS.getItem(LEGACY_KEY_V7); } catch (e) { return null; }
    if (!raw) return null;
    var old;
    try { old = JSON.parse(raw); } catch (e) { old = null; }
    if (!old || typeof old !== 'object') {
      try { console.warn('[Store] ' + LEGACY_KEY_V7 + ' 无法解析，已保留原始数据作为备份，演示数据重置为 v8 种子'); } catch (e) { }
      var bad = normalizeDb(buildSeed());
      bad.meta.migration = {
        from: 'v7', to: 'v9', at: stamp(), ok: false,
        reason: 'v7 数据无法解析',
        strategy: '迁移失败，未修改旧 key，演示数据已重置为 v9 种子',
        carried: [], seeded: [], backupKey: LEGACY_KEY_V7
      };
      return bad;
    }
    try {
      var seed = buildSeed();
      var out = normalizeDb(seed);
      var moved = [], reset = [];
      MIGRATABLE_KEYS.concat(V8_COLLECTIONS).forEach(function (k) {
        if (!Array.isArray(old[k]) || !Array.isArray(seed[k])) { reset.push(k); return; }
        out[k] = clone(old[k]);
        moved.push(k);
      });
      out.version = VERSION;
      out.meta = out.meta || {};
      out.meta.migration = {
        from: 'v7', to: 'v9', at: stamp(), ok: true,
        strategy: '按集合搬运 + 新表用种子补齐；v7 原始数据保留在 ' + LEGACY_KEY_V7,
        carried: moved, seeded: reset, backupKey: LEGACY_KEY_V7
      };
      try {
        console.info('[Store] 已从 v7 迁移本地演示数据：保留 ' + moved.length + ' 个集合，' +
          reset.length + ' 个集合用种子补齐；' + LEGACY_KEY_V7 + ' 已保留为备份');
      } catch (e) { }
      return normalizeDb(out);
    } catch (e) {
      /* 结构无法安全映射：旧 key 原样保留，用 v8 种子启动，并把原因写进 meta 供页面提示 */
      try { console.warn('[Store] v7 迁移失败，已保留 ' + LEGACY_KEY_V7 + ' 原始数据，演示数据已重置：' + e.message); } catch (x) { }
      var bad = normalizeDb(buildSeed());
      bad.meta.migration = {
        from: 'v7', to: 'v9', at: stamp(), ok: false,
        reason: String(e && e.message || e),
        strategy: '迁移失败，未修改旧 key，演示数据已重置为 v9 种子',
        carried: [], seeded: [], backupKey: LEGACY_KEY_V7
      };
      return bad;
    }
  }

  function loadLegacyV6() {
    var raw = null;
    try { raw = SS.getItem(LEGACY_KEY); } catch (e) { return null; }
    if (!raw) return null;
    var old;
    try { old = JSON.parse(raw); } catch (e) { old = null; }
    if (!old || typeof old !== 'object') {
      /* 旧数据损坏：保留原 key 不动，退回种子并明确提示 */
      try { console.warn('[Store] ' + LEGACY_KEY + ' 无法解析，已保留原始数据作为备份，演示数据重置为 v8 种子'); } catch (e) { }
      return null;
    }
    var seed = buildSeed();
    var out = normalizeDb(seed);
    var moved = [], reset = [];
    MIGRATABLE_KEYS.forEach(function (k) {
      if (!Array.isArray(old[k])) { reset.push(k); return; }
      /* 只搬运结构一致的数组：两侧都存在该集合才覆盖，避免把 v6 的未知结构塞进 v8 */
      if (!Array.isArray(seed[k])) { reset.push(k); return; }
      out[k] = clone(old[k]);
      moved.push(k);
    });
    out.version = VERSION;
    out.meta = out.meta || {};
    out.meta.migration = {
      from: 'v6', to: 'v9', at: stamp(), ok: true,
      strategy: '按集合搬运 + 缺失集合用种子补齐；v6 原始数据保留在 ' + LEGACY_KEY,
      carried: moved, seeded: reset, backupKey: LEGACY_KEY
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
    var legacyV8 = loadLegacyV8();
    if (legacyV8) { db = legacyV8; save(); return db; }
    var legacyV7 = loadLegacyV7();
    if (legacyV7) { db = legacyV7; save(); return db; }
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
    if (session.role === 'teacher') assertMyStudent(studentId);
    else if (session.role === 'parent') {
      if (!parentHasStudent(session.parentId, studentId)) {
        throw bizError('FORBIDDEN', '家长只能查看自己孩子的学习记录');
      }
    } else if (session.role === 'agent' && !hasDataAccess('', 'student', studentId)) {
      throw bizError('FORBIDDEN', '代理只能查看自己客户的学员');
    }
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
      /* 第九轮加法字段：旧接口创建的仍是「单库 + 逐词判断」历史流程 */
      wordbookIds: [bk.id],
      currentWordbookId: bk.id,
      targetCount: db.config.trainCap,
      displayFlow: false,
      candidateWordIds: [],
      prescreenStats: null,
      prescreenCompletedAt: null,
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

  /* ============================================================
     多词库动态训练任务（第九轮）
     ------------------------------------------------------------
     词库只是单词来源，不是训练任务的边界：
       一个任务 = 学员 + 授课教师 + 关联课程 + 目标数量
                + 若干词库来源 + 唯一的候选单词集合 + 唯一训练队列。
     跨词库去重按基础 Word ID，不按词库关联记录。
     旧接口 startTrainTask 保留（单库、45 上限、历史逐词判断流程），
     历史任务因此永远能打开；新流程走 displayFlow：
       初筛（列表）→ 五词一组展示循环 → 列表式最后复习。
     ============================================================ */

  /** 词库摘要名：1 个用名字，多个用「A 等 N 个词库」 */
  function bookLabel(t) {
    var names = (t.wordbookIds || []).map(function (id) {
      var b = wordbook(id);
      return b ? b.name : '';
    }).filter(Boolean);
    if (!names.length) return '未指定词库';
    return names.length > 1 ? names[0] + ' 等 ' + names.length + ' 个词库' : names[0];
  }

  function wordbooksOfTask(t) {
    return (t.wordbookIds || []).map(function (id) { return wordbook(id); }).filter(Boolean);
  }

  /** 该单词在本次任务里属于哪个词库（取第一个命中的来源词库） */
  function bookOfWordInTask(t, wordId) {
    var ids = t.wordbookIds || [];
    for (var i = 0; i < ids.length; i++) {
      var hit = db.wordbookWords.some(function (x) {
        return x.wordbookId === ids[i] && x.wordId === wordId;
      });
      if (hit) return ids[i];
    }
    return '';
  }

  /**
   * 学员是否已被标记为「初筛认识」
   * 必须看独立的 screeningStatus，不能只看 box === 'green'：
   * 教师手动加入绿盒、最后复习不认识放进绿盒，都不等于初筛认识。
   */
  function isScreenedKnown(studentId, wordId) {
    var st = wordState(studentId, wordId);
    return !!st && st.screeningStatus === SCREEN.KNOWN;
  }

  /** 同一单词是否已被别的未完成任务占用（只做提示，不阻断新任务） */
  function openTaskOfWord(studentId, wordId, exceptTaskId) {
    return db.trainTasks.filter(function (t) {
      return t.studentId === studentId && t.id !== exceptTaskId && isOpen(t.status)
        && (t.queueWordIds || []).indexOf(wordId) >= 0;
    })[0] || null;
  }

  /**
   * 创建训练任务（多词库动态训练）
   * @param {{studentId, teacherId, courseId?, targetCount?}} opt
   * 同一学员同时只允许一个未完成任务：避免同一批单词被两个任务并行处理
   */
  function createTrainTask(opt) {
    opt = opt || {};
    var stu = student(opt.studentId);
    if (!stu) throw bizError('STUDENT_NOT_FOUND', '学员不存在');
    var teacherId = opt.teacherId || sessionTeacherId();
    if (session.role === 'teacher') {
      if (!teacherId) throw bizError('FORBIDDEN', '教师训练任务必须绑定当前登录教师');
      assertMyStudent(opt.studentId);
    }

    var target = Number(opt.targetCount);
    if (!target) target = TARGET_RANGE.def;
    if (target < TARGET_RANGE.min || target > TARGET_RANGE.max) {
      throw bizError('TARGET_OUT_OF_RANGE',
        '训练目标数量需在 ' + TARGET_RANGE.min + ' – ' + TARGET_RANGE.max + ' 之间');
    }

    var open = db.trainTasks.filter(function (t) {
      return t.studentId === opt.studentId && isOpen(t.status);
    }).sort(function (a, b) { return a.createdAt < b.createdAt ? 1 : -1; })[0];
    if (open) {
      if (session.role === 'teacher' && (open.teacherId || '') !== (opt.teacherId || sessionTeacherId())) {
        throw bizError('FORBIDDEN', '该学员已有其他教师创建的未完成任务，不能复用');
      }
      return { ok: true, reused: true, task: open };
    }

    var t = {
      id: 'TR' + TODAY.replace(/-/g, '') + seq('TR', 2),
      studentId: opt.studentId,
      teacherId: teacherId || '',
      courseId: opt.courseId || '',
      wordbookIds: [],
      wordbookId: '',
      wordbookName: '未指定词库',
      currentWordbookId: '',
      targetCount: target,
      groupSize: TRAIN_GROUP_SIZE,
      displayFlow: true,
      createdAt: stamp(),
      status: STATUS.PENDING,
      phase: PHASE.PRESCREEN,
      wordIds: [],              // 候选池：已关联词库的全部单词（按 Word ID 去重）
      candidateWordIds: [],     // 初筛不认识的唯一候选集合
      knownWordIds: [],         // 初筛认识
      queueWordIds: [],         // 最终强化训练队列
      remainWordIds: [],        // 超出目标数量、保留待训练的候选
      prescreen: {},            // wordId -> {known, at, by, wordbookId}
      prescreenStats: { target: target, pool: 0, known: 0, unknown: 0, screened: 0, unscreened: 0, updatedAt: stamp() },
      prescreenCompletedAt: null,
      groupIndex: 0,
      wordIndex: 0,
      results: {},              // 历史字段：displayFlow 任务不再写入掌握判断
      finalResults: {},
      finalIndex: 0,
      mode: 'en2cn',
      pausedAt: null,
      finishedAt: null,
      interruptReason: '',
      joins: { leitner: [], plan21: [], planIds: [], green: [] }
    };
    db.trainTasks.push(t);
    save();
    return { ok: true, reused: false, task: t };
  }

  /**
   * 给任务追加词库来源（可多次调用，逐词补足目标数量）
   * @returns {{ok:boolean, added:Array, skipped:Array, task, pool:number}}
   */  /** 调整目标训练数量（只在初筛阶段允许，进入强化训练后锁定） */
  function setTrainTarget(taskId, count) {
    var t = trainTask(taskId);
    if (!t) throw bizError('TASK_NOT_FOUND', '训练任务不存在');
    if (t.phase !== PHASE.PRESCREEN) {
      throw bizError('PHASE_LOCKED', '已经进入「' + t.phase + '」，训练目标不能再修改');
    }
    if (isDone(t.status) || t.status === STATUS.CANCELLED) {
      throw bizError('TASK_CLOSED', '任务已结束，不能修改训练目标');
    }
    var n = Number(count);
    if (!n || n < TARGET_RANGE.min || n > TARGET_RANGE.max) {
      throw bizError('TARGET_OUT_OF_RANGE',
        '训练目标数量需在 ' + TARGET_RANGE.min + ' – ' + TARGET_RANGE.max + ' 之间');
    }
    t.targetCount = Math.round(n);
    recomputeCandidates(t);
    save();
    return { ok: true, task: t, stat: prescreenTaskStat(taskId) };
  }

  function addWordbooksToTask(taskId, bookIds) {
    assertMyTask(taskId);
    var t = trainTask(taskId);
    if (!t) throw bizError('TASK_NOT_FOUND', '训练任务不存在');
    if (isDone(t.status)) throw bizError('TASK_DONE', '任务已提交，不能再添加词库');
    if (t.status === STATUS.CANCELLED) throw bizError('TASK_CANCELLED', '任务已取消，不能继续添加词库');
    if (t.phase !== PHASE.PRESCREEN) {
      throw bizError('PHASE_LOCKED', '已经进入「' + t.phase + '」，不能再添加词库或修改初筛范围');
    }
    var added = [], skipped = [];
    (bookIds || []).forEach(function (bid) {
      var b = wordbook(bid);
      if (!b) { skipped.push({ id: bid, name: '', reason: '词库不存在' }); return; }
      if (b.status !== '启用') { skipped.push({ id: bid, name: b.name, reason: '词库已停用' }); return; }
      if (!bookLinkCount(b.id)) { skipped.push({ id: bid, name: b.name, reason: '该词库还没有单词' }); return; }
      if ((t.wordbookIds || []).indexOf(bid) >= 0) { skipped.push({ id: bid, name: b.name, reason: '已经在本次任务中' }); return; }
      if (session.role === 'teacher' && !isAuthorized(t.studentId, b.id)) {
        skipped.push({ id: bid, name: b.name, reason: '学员没有该词库的有效授权' });
        return;
      }
      var ws = wordsOfBook(b.id);
      t.wordbookIds = t.wordbookIds || [];
      t.wordbookIds.push(bid);
      ws.forEach(function (w) { if (t.wordIds.indexOf(w.id) < 0) t.wordIds.push(w.id); });
      added.push({ id: bid, name: b.name, words: ws.length });
    });
    if (added.length) {
      t.wordbookId = t.wordbookIds[0];
      t.currentWordbookId = added[0].id;
      t.wordbookName = bookLabel(t);
      t.updatedAt = stamp();
    }
    save();
    return { ok: added.length > 0, added: added, skipped: skipped, task: t, pool: (t.wordIds || []).length };
  }

  /**
   * 可筛选 / 已筛选的单词清单（列表式预筛选的数据源）
   * 自动排除：历史初筛已认识、无效授权词库、不在本次候选池的单词。
   * @param {string} taskId
   * @param {{wordbookId?:string, all?:boolean}} opt
   */
  function prescreenCandidates(taskId, opt) {
    opt = opt || {};
    assertMyTask(taskId);
    var t = trainTask(taskId);
    if (!t) throw bizError('TASK_NOT_FOUND', '训练任务不存在');
    var bookId = opt.wordbookId || t.currentWordbookId || (t.wordbookIds || [])[0] || '';
    var books = opt.all ? wordbooksOfTask(t) : [wordbook(bookId)].filter(Boolean);
    var out = [], seen = {};
    books.forEach(function (b) {
      wordsOfBook(b.id).forEach(function (w) {
        if ((t.wordIds || []).indexOf(w.id) < 0) return;
        /* 按基础 Word.id 去重：同一基础单词属于多个词库时，只保留一个训练候选，
           并在 sourceBooks 中汇总来源词库，便于追溯；不影响词库各自的单词关联与排序。 */
        var hit = seen[w.id];
        if (hit) {
          if (!hit.sourceBooks.some(function (sb) { return sb.id === b.id; })) {
            hit.sourceBooks.push({ id: b.id, name: b.name });
          }
          return;
        }
        var p = t.prescreen[w.id] || null;
        var knownBefore = isScreenedKnown(t.studentId, w.id);
        var conflict = openTaskOfWord(t.studentId, w.id, t.id);
        hit = {
          id: w.id, en: w.en, ph: w.ph, mean: w.mean, pos: w.pos, audio: w.audio,
          wordbookId: b.id, wordbookName: b.name,
          sourceBooks: [{ id: b.id, name: b.name }],
          screened: p,
          status: p ? (p.known ? SCREEN.KNOWN : SCREEN.UNKNOWN)
            : knownBefore ? SCREEN.KNOWN : SCREEN.NONE,
          knownBefore: knownBefore && !p,
          excluded: knownBefore && !p,          // 历史已初筛认识：本次直接排除，不再重复筛
          conflictTaskId: conflict ? conflict.id : ''
        };
        out.push(hit);
        seen[w.id] = hit;
      });
    });
    return out;
  }

  /** 任务级 + 词库级初筛统计（顶部统计与「还差多少个」都读这里） */
  function prescreenTaskStat(taskId) {
    var t = trainTask(taskId);
    if (!t) return null;
    var pool = (t.wordIds || []).slice();
    var known = [], unknown = [], unscreened = [], excluded = [];
    pool.forEach(function (id) {
      var p = t.prescreen[id];
      if (p) { (p.known ? known : unknown).push(id); return; }
      if (isScreenedKnown(t.studentId, id)) { excluded.push(id); return; }
      unscreened.push(id);
    });
    var target = t.targetCount || TARGET_RANGE.def;
    var byBook = {};
    wordbooksOfTask(t).forEach(function (b) {
      byBook[b.id] = { id: b.id, name: b.name, total: 0, known: 0, unknown: 0, screened: 0, unscreened: 0, excluded: 0 };
    });
    pool.forEach(function (id) {
      var bid = bookOfWordInTask(t, id);
      var row = byBook[bid];
      if (!row) return;
      row.total++;
      var p = t.prescreen[id];
      if (p) { row.screened++; if (p.known) row.known++; else row.unknown++; }
      else if (isScreenedKnown(t.studentId, id)) row.excluded++;
      else row.unscreened++;
    });
    return {
      taskId: taskId, phase: t.phase, status: t.status,
      target: target, pool: pool.length,
      known: known.length, unknown: unknown.length,
      unscreened: unscreened.length, excluded: excluded.length,
      screened: known.length + unknown.length,
      needMore: Math.max(0, target - unknown.length),
      reached: unknown.length >= target,
      byBook: byBook
    };
  }

  /** 由 prescreen 结果重算候选集合与统计（唯一候选按 Word ID 去重） */
  function recomputeCandidates(t) {
    var known = [], unknown = [];
    (t.wordIds || []).forEach(function (id) {
      var p = t.prescreen[id];
      if (!p) return;
      (p.known ? known : unknown).push(id);
    });
    t.knownWordIds = known;
    t.candidateWordIds = unknown;
    t.prescreenStats = {
      target: t.targetCount,
      pool: (t.wordIds || []).length,
      known: known.length, unknown: unknown.length,
      screened: known.length + unknown.length,
      unscreened: (t.wordIds || []).length - known.length - unknown.length,
      updatedAt: stamp()
    };
  }

  /** 撤销「初筛认识」：只撤自己这次初筛加进绿盒的记录，教师手动加入的绿盒保持不动 */
  function revokeScreeningKnown(studentId, wordId, taskId, reason, by) {
    var st = wordState(studentId, wordId);
    if (!st || st.screeningStatus !== SCREEN.KNOWN) return null;
    var ls = leitnerState(studentId, wordId);
    if (ls && ls.box === 'green' && ls.source === SCREEN_SOURCE.PRESCREEN && (!ls.sourceTaskId || ls.sourceTaskId === taskId)) {
      db.leitnerStates = db.leitnerStates.filter(function (x) { return x !== ls; });
      logOp(studentId, wordId, '撤销初筛认识', 'green', null,
        reason || '初筛误判修正', by, taskId);
    } else if (ls) {
      logOp(studentId, wordId, '初筛误判修正', ls.box, ls.box,
        reason || '初筛误判修正（绿盒由教师手动管理，不自动移出）', by, taskId);
    }
    save();
    return st;
  }

  /**
   * 逐词保存初筛结果
   * · 首次判断：认识 → 立即进绿盒并写 screeningStatus；不认识 → 进候选队列
   * · 修正误判：必须填写原因，追加一条带 correction 的记录，原始记录保留
   */
  function prescreenAnswer(taskId, wordId, known, opt) {
    opt = opt || {};
    assertMyTask(taskId);
    var t = trainTask(taskId);
    if (!t) throw bizError('TASK_NOT_FOUND', '训练任务不存在');
    if (t.phase !== PHASE.PRESCREEN) {
      throw bizError('PHASE_LOCKED', '当前阶段是「' + t.phase + '」，不能再修改初筛结果');
    }
    if (isDone(t.status)) throw bizError('TASK_DONE', '任务已提交，不能修改初筛结果');
    if (t.status === STATUS.CANCELLED) throw bizError('TASK_CANCELLED', '任务已取消，不能继续操作');
    if ((t.wordIds || []).indexOf(wordId) < 0) {
      throw bizError('WORD_NOT_IN_TASK', '该单词不属于本次训练任务，不能提交判断');
    }
    known = !!known;
    var prev = t.prescreen[wordId] || null;
    if (prev && prev.known === known) {
      return { ok: true, unchanged: true, corrected: false, task: t, stat: prescreenTaskStat(taskId) };
    }
    var reason = String(opt.reason || '').trim();
    if (prev && !reason) {
      throw bizError('REASON_REQUIRED', '修改已经提交的初筛结果必须填写原因');
    }
    var at = stamp();
    var by = t.teacherId || sessionTeacherId() || '';
    var bid = bookOfWordInTask(t, wordId);
    t.prescreen[wordId] = { known: known, at: at, by: by, wordbookId: bid };

    db.prescreens.push({
      id: 'PS' + seq('PR', 4),
      taskId: taskId, studentId: t.studentId, wordbookId: bid,
      wordId: wordId, known: known, at: at, teacherId: by,
      courseId: t.courseId || '',
      correction: !!prev, correctionFrom: prev ? prev.known : null,
      correctionNote: prev ? reason : ''
    });

    setWordState(t.studentId, wordId,
      known ? '初筛认识' : '待强化训练',
      { prescreenKnown: known, lastTaskId: taskId });

    if (!known && prev && prev.known) {
      revokeScreeningKnown(t.studentId, wordId, taskId, reason || '初筛误判修正', by);
    }

    var st = wordState(t.studentId, wordId);
    if (st) {
      st.screeningStatus = known ? SCREEN.KNOWN : SCREEN.UNKNOWN;
      st.screeningSourceTaskId = taskId;
      if (known) {
        st.screenedKnownAt = at;
        st.screenedKnownBy = by;
        var tn = teacher(by) ? teacher(by).name : (by || '教师');
        addToGreen(t.studentId, wordId,
          '初筛认识（任务 ' + taskId + ' · ' + tn + '）', tn,
          { source: SCREEN_SOURCE.PRESCREEN, taskId: taskId });
      } else {
        st.screenedKnownAt = null;
        st.screenedKnownBy = '';
      }
    }

    if (t.status === STATUS.PENDING || t.status === STATUS.INTERRUPTED) t.status = STATUS.ACTIVE;
    if (!t.currentWordbookId) t.currentWordbookId = bid;
    recomputeCandidates(t);
    save();
    return { ok: true, unchanged: false, corrected: !!prev, task: t, stat: prescreenTaskStat(taskId) };
  }

  /**
   * 结束预筛选，生成训练队列
   * 规则：认识的单词不入队；不认识的按词库顺序取前 45 个；其余保留待训练
   */
  function finishPrescreen(taskId, opt) {
    opt = opt || {};
    assertMyTask(taskId);
    var t = trainTask(taskId);
    if (!t) throw bizError('TASK_NOT_FOUND', '训练任务不存在');
    if (t.phase !== PHASE.PRESCREEN) {
      return { ok: false, reason: 'PHASE_LOCKED', message: '任务已经进入「' + t.phase + '」，不需要重复结束预筛选' };
    }
    if (isDone(t.status) || t.status === STATUS.CANCELLED) {
      return { ok: false, reason: 'TASK_CLOSED', message: '任务已结束，不能生成训练队列' };
    }

    var order = t.wordIds || [];
    var known = [], unknown = [], unscreened = [];
    order.forEach(function (id) {
      var p = t.prescreen[id];
      if (!p) { if (!isScreenedKnown(t.studentId, id)) unscreened.push(id); return; }
      (p.known ? known : unknown).push(id);
    });

    /* 队列永远按 Word ID 去重：同一单词属于多个词库时只训练一次 */
    var cand = cleanWordIds(unknown);

    if (!cand.length) {
      return {
        ok: false, reason: 'NO_CANDIDATE',
        message: '本次还没有筛选出任何「不认识」的单词，无法生成训练队列',
        candidate: 0, target: t.targetCount || TARGET_RANGE.def
      };
    }

    var cap = t.displayFlow ? (t.targetCount || TARGET_RANGE.def) : db.config.trainCap;
    var queue = cand.slice(0, cap);
    var remain = cand.slice(cap);
    /* 未达到目标数量时，必须由教师明确确认后才可以按实际数量开始 */
    if (t.displayFlow && queue.length < cap && !opt.confirmShort) {
      return {
        ok: false, reason: 'SHORT_OF_TARGET',
        message: '当前只筛出 ' + cand.length + ' 个不认识的单词，距离目标 ' + cap + ' 个还差 ' + (cap - cand.length) + ' 个。' +
          '可以继续添加词库补足，也可以按实际数量开始训练。',
        candidate: cand.length, target: cap, short: cap - cand.length, canConfirm: true
      };
    }

    t.knownWordIds = known;
    t.queueWordIds = queue;
    t.remainWordIds = remain;
    t.candidateWordIds = cand;
    t.screenedCount = known.length + unknown.length;
    t.unscreenedWordIds = unscreened;
    t.status = STATUS.ACTIVE;
    t.phase = PHASE.DISPLAY;
    t.groupIndex = 0;
    t.wordIndex = 0;
    t.prescreenCompletedAt = stamp();
    t.targetCount = cap;
    recomputeCandidates(t);

    // 队列内单词进入「待强化训练」，队列外仍保留待强化（不进本次，但不丢弃）
    remain.forEach(function (id) {
      setWordState(t.studentId, id, '待强化训练', { lastTaskId: taskId });
    });
    save();

    return {
      ok: true,
      bookTotal: order.length,
      pool: order.length,
      screened: known.length + unknown.length,
      unscreened: unscreened.length,
      known: known.length,
      unknown: unknown.length,
      queue: queue,
      remain: remain,
      target: cap,
      short: Math.max(0, cap - queue.length),
      groups: groupsOf(queue, t.groupSize || TRAIN_GROUP_SIZE)
    };
  }

  function queueOf(t) {
    return (t.queueWordIds || []).map(function (id) { return word(id); }).filter(Boolean);
  }

  function groupsOfTask(t) { return groupsOf(t.queueWordIds || [], t.groupSize); }

  /* ---------------- 强化训练：五词一组的展示循环 ----------------
     展示进度独立成表 trainDisplays，只用 displayStep 表达「带读了几轮」：
       1 = 显示英文，2 = 显示中文，3 = 英文与中文都隐藏并标记本轮完成。
     强化训练阶段不产生认识 / 不认识的掌握判断（历史 trainDetails 只读保留）。 */

  function trainDisplayOf(taskId, wordId) {
    return db.trainDisplays.filter(function (d) {
      return d.taskId === taskId && d.wordId === wordId;
    })[0] || null;
  }

  function trainDisplaysOf(taskId) {
    return db.trainDisplays.filter(function (d) { return d.taskId === taskId; });
  }

  function displayCompleted(taskId, wordId) {
    var d = trainDisplayOf(taskId, wordId);
    return !!(d && d.cycleCompleted);
  }

  /** 任务在「强化训练」阶段的完成度：按唯一 wordId 计，不看前端当前组 */
  function displayStat(taskId) {
    var t = trainTask(taskId);
    if (!t) return null;
    var q = t.queueWordIds || [];
    var size = t.groupSize || TRAIN_GROUP_SIZE;
    var groups = groupsOf(q, size).map(function (ids, i) {
      var words = ids.map(function (id) {
        var d = trainDisplayOf(taskId, id);
        return {
          id: id, step: d ? d.displayStep : 0,
          stepLabel: DISPLAY_LABEL[d ? d.displayStep : 0],
          completed: !!(d && d.cycleCompleted),
          needsReinforce: !!(d && d.needsReinforce)
        };
      });
      var done = words.filter(function (w) { return w.completed; }).length;
      return {
        index: i, wordIds: ids, words: words,
        total: ids.length, done: done, allDone: done === ids.length
      };
    });
    var total = q.length;
    var done = groups.reduce(function (n, g) { return n + g.done; }, 0);
    var current = Math.min(Math.max(t.groupIndex || 0, 0), Math.max(groups.length - 1, 0));
    var firstOpen = -1;
    groups.forEach(function (g) { if (firstOpen < 0 && !g.allDone) firstOpen = g.index; });
    return {
      taskId: taskId, total: total, done: done, remaining: total - done,
      groupIndex: current, groupCount: groups.length,
      groups: groups,
      currentGroup: groups[current] || null,
      currentComplete: !!(groups[current] && groups[current].allDone),
      firstOpenGroup: firstOpen,
      allDone: total > 0 && done === total,
      corrections: db.trainDetails.filter(function (d) {
        return d.taskId === taskId && d.correction;
      }).length
    };
  }

  /**
   * 点击一次展示（英文 → 中文 → 隐藏并完成）
   * 每个单词独立推进，不影响同组其它单词；第三次点击后不再自增。
   */
  function trainDisplayTap(taskId, wordId, opt) {
    opt = opt || {};
    assertMyTask(taskId);
    var t = trainTask(taskId);
    if (!t) throw bizError('TASK_NOT_FOUND', '训练任务不存在');
    if (isDone(t.status)) throw bizError('TASK_DONE', '任务已提交，不能再修改展示进度');
    if (t.status === STATUS.CANCELLED) throw bizError('TASK_CANCELLED', '任务已取消，不能继续操作');
    if (t.status === STATUS.INTERRUPTED) throw bizError('TASK_INTERRUPTED', '任务已中断，请先恢复训练再继续展示');
    if (t.phase !== PHASE.DISPLAY) {
      throw bizError('PHASE_LOCKED', '当前阶段是「' + t.phase + '」，不是强化训练');
    }
    if ((t.queueWordIds || []).indexOf(wordId) < 0) {
      throw bizError('WORD_NOT_IN_QUEUE', '该单词不属于本次强化训练队列');
    }

    var d = trainDisplayOf(taskId, wordId);
    if (!d) {
      d = {
        id: 'TDP' + seq('TDP', 4),
        taskId: taskId, studentId: t.studentId, wordId: wordId,
        groupIndex: Math.floor((t.queueWordIds || []).indexOf(wordId) / (t.groupSize || TRAIN_GROUP_SIZE)),
        displayStep: 0, cycleCompleted: false, taps: 0,
        updatedAt: stamp(), completedAt: null,
        teacherId: t.teacherId || '', courseId: opt.courseId || t.courseId || ''
      };
      db.trainDisplays.push(d);
    }
    if (d.cycleCompleted) {
      return { ok: true, already: true, record: d, stat: displayStat(taskId) };
    }
    d.displayStep = Math.min(DISPLAY_STEP.DONE, (d.displayStep || 0) + 1);
    d.taps = (d.taps || 0) + 1;
    d.updatedAt = stamp();
    d.cycleCompleted = d.displayStep >= DISPLAY_STEP.DONE;
    if (d.cycleCompleted) {
      d.completedAt = d.updatedAt;
      /* 「待最后复习」只是生命周期标记，不是掌握判断 */
      setWordState(t.studentId, wordId, '待最后复习', { lastTrainAt: d.updatedAt, lastTaskId: taskId });
    }
    save();
    return { ok: true, already: false, record: d, stat: displayStat(taskId) };
  }

  /** 切换当前组：向前只能一组一组走，且当前组必须 5 个单词全部完成展示 */
  function setTrainGroup(taskId, index) {
    assertMyTask(taskId);
    var t = trainTask(taskId);
    if (!t) throw bizError('TASK_NOT_FOUND', '训练任务不存在');
    var st = displayStat(taskId);
    if (!st || !st.groupCount) throw bizError('NO_QUEUE', '本次任务还没有训练队列');
    index = Number(index);
    if (!(index >= 0 && index < st.groupCount)) throw bizError('GROUP_OUT_OF_RANGE', '组号超出范围');
    if (index > st.groupIndex) {
      var cur = st.groups[st.groupIndex];
      if (cur && !cur.allDone) {
        throw bizError('GROUP_NOT_DONE',
          '第 ' + (st.groupIndex + 1) + ' 组还有 ' + (cur.total - cur.done) + ' 个单词未完成展示，不能进入下一组',
          { groupIndex: st.groupIndex, missing: cur.total - cur.done });
      }
      if (index > st.groupIndex + 1) {
        throw bizError('GROUP_SKIP', '不能跳过中间的组，请按顺序完成');
      }
    }
    t.groupIndex = index;
    save();
    return { ok: true, task: t, stat: displayStat(taskId) };
  }

  /** 强化训练是否全部完成（Store 层判断，不依赖前端当前组） */
  function finishDisplay(taskId) {
    var t = trainTask(taskId);
    if (!t) throw bizError('TASK_NOT_FOUND', '训练任务不存在');
    var st = displayStat(taskId);
    if (!st) throw bizError('TASK_NOT_FOUND', '训练任务不存在');
    var missing = (st.groups || []).reduce(function (arr, g) {
      g.words.forEach(function (w) { if (!w.completed) arr.push(w.id); });
      return arr;
    }, []);
    if (missing.length) {
      return { ok: false, reason: 'DISPLAY_NOT_DONE', missing: missing, stat: st };
    }
    return { ok: true, task: t, stat: st };
  }

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

  /** 任务进度统计：强化训练与最后一轮分别按唯一 wordId 计数
   *  displayFlow 任务的「已完成强化训练」= 展示循环完成（展示记录），
   *  历史任务仍按 trainDetails 的首次判断计，两种口径各自独立不混算。 */
  function trainTaskStat(taskId) {
    var t = trainTask(taskId);
    if (!t) return null;
    var q = t.queueWordIds || [];
    var doneOf = function (id) {
      return t.displayFlow ? displayCompleted(taskId, id) : !!trainFirstDetail(taskId, id);
    };
    var trained = q.filter(doneOf);
    var finaled = q.filter(function (id) { return !!(t.finalResults && t.finalResults[id]); });
    return {
      taskId: taskId,
      queue: q.length,
      trained: trained.length,
      trainedMissing: q.filter(function (id) { return !doneOf(id); }),
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
    assertMyTask(taskId);
    var t = trainTask(taskId);
    if (!t) fail('训练任务不存在');
    if (isDone(t.status)) fail('任务已提交，不能修改判断结果');
    if (t.status === STATUS.CANCELLED) fail('任务已取消，不能继续操作');
    if (t.status === STATUS.INTERRUPTED) fail('任务已中断，请先恢复训练后再操作');
    if (t.phase !== '强化训练') fail('当前阶段不允许提交强化训练结果（当前：' + t.phase + '）');
    if (t.displayFlow) {
      throw bizError('DISPLAY_ONLY',
        '本次训练采用展示循环流程：强化训练阶段只记录带读轮次，不产生认识 / 不认识的掌握判断；掌握结果在最后复习阶段记录');
    }

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
    assertMyTask(taskId);
    var t = trainTask(taskId);
    if (!t) fail('训练任务不存在');
    if (isDone(t.status)) fail('任务已提交，不能修改判断结果');
    if (t.status === STATUS.CANCELLED) fail('任务已取消，不能修改判断结果');
    if (t.status === STATUS.INTERRUPTED) fail('任务已中断，请先恢复训练后再修正');
    if (!result || ['yes', 'no', 'mid'].indexOf(result) < 0) fail('修正结果不合法');
    if (!isStr(note) || !note.trim()) fail('误判修正必须填写原因');
    if (t.displayFlow) {
      throw bizError('DISPLAY_ONLY', '本次训练的强化阶段不产生掌握判断，没有可修正的判断记录');
    }
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
    assertMyTask(taskId);
    var t = trainTask(taskId);
    if (!t) return null;
    Object.keys(patch).forEach(function (k) { t[k] = patch[k]; });
    save();
    return t;
  }

  /** 暂停 / 保存退出：状态不变，仅记录暂停时间，可恢复 */
  function pauseTask(taskId) {
    assertMyTask(taskId);
    var t = trainTask(taskId);
    if (!t) return null;
    t.pausedAt = stamp();
    t.resumeCount = (t.resumeCount || 0);
    save();
    return t;
  }

  function resumeTask(taskId) {
    assertMyTask(taskId);
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
    assertMyTask(taskId);
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
    assertMyTask(taskId);
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
    assertMyTask(taskId);
    var t = trainTask(taskId);
    if (!t) fail('训练任务不存在');
    if (t.status === STATUS.INTERRUPTED) return { ok: false, reason: '任务已中断，请先恢复训练', missing: [] };
    if (isDone(t.status)) return { ok: false, reason: '任务已提交', missing: [] };
    if (t.phase === PHASE.FINAL || t.phase === PHASE.DONE) return { ok: true, task: t, already: true };
    /* 完成口径在 Store 层判断：展示流看每条展示记录是否走完三轮，
       历史任务看是否已有强化训练判断记录——不依赖前端当前组状态 */
    var missing = (t.queueWordIds || []).filter(function (id) {
      return t.displayFlow ? !displayCompleted(taskId, id) : !trainFirstDetail(taskId, id);
    });
    if (missing.length) {
      return {
        ok: false, missing: missing,
        reason: '还有 ' + missing.length + ' 个单词未完成强化训练' + (t.displayFlow ? '展示' : '判断')
      };
    }
    t.status = STATUS.ACTIVE;
    t.phase = PHASE.FINAL;
    t.finalIndex = 0;
    save();
    return { ok: true, task: t };
  }

  /**
   * 最后一轮复习判断（首次判断专用）
   * 校验：阶段正确、单词属于本次队列、同词不可重复首次判断
   */
  function finalJudge(taskId, wordId, result, courseId) {
    assertMyTask(taskId);
    var t = trainTask(taskId);
    if (!t) fail('训练任务不存在');
    if (t.status === STATUS.INTERRUPTED) fail('任务已中断，请先恢复训练后再操作');
    if (t.status === STATUS.CANCELLED) fail('任务已取消，不能继续操作');
    if (isDone(t.status)) fail('任务已提交，不能修改判断结果');
    if (t.phase !== '最后复习') fail('当前阶段不允许提交最后一轮复习结果');
    if ((t.queueWordIds || []).indexOf(wordId) < 0) fail('该单词不属于本次训练队列');
    if (!result || ['yes', 'no', 'mid'].indexOf(result) < 0) fail('判断结果不合法');

    /* 提交前允许重判：尚未正式提交（未 DONE）时，直接以本次选择为最终结果，不追加修正记录。
       提交后的纠错走 finalCorrect（保留原始记录 + 记录原因/操作人）。 */
    if (t.finalResults[wordId]) {
      var _old = t.finalResults[wordId];
      if (_old.result === result) return t;
      t.finalResults[wordId] = {
        result: result, at: stamp(), correctedFrom: _old.result, corrections: (_old.corrections || 0) + 1,
        courseId: courseId || ''
      };
      save();
      return t;
    }

    // 最后一轮只能处理已完成强化训练的词（展示流看展示循环，历史任务看判断记录）
    if (t.displayFlow) {
      if (!displayCompleted(taskId, wordId)) fail('该单词尚未完成强化训练展示，不能进入最后复习');
    } else if (!trainFirstDetail(taskId, wordId)) fail('该单词尚未完成强化训练判断，不能进入最后复习');

    t.finalResults[wordId] = {
      result: result, at: stamp(), correctedFrom: null, corrections: 0,
      courseId: courseId || ''
    };
    save();
    return t;
  }

  /** 最后一轮复习修正：必填原因，保留原值 */
  function finalCorrect(taskId, wordId, result, note, courseId) {
    assertMyTask(taskId);
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

  /** 加入绿盒（教师自主，必须记录原因）
   *  opt.source 区分三种来源：初筛认识 / 教师手动加入 / 训练最后复习。
   *  无论哪种来源，都只影响莱特纳盒子，绝不改动「初筛认识」状态。 */
  function addToGreen(studentId, wordId, reason, by, opt) {
    opt = opt || {};
    var src = opt.source || SCREEN_SOURCE.MANUAL;
    var srcTask = opt.taskId || null;
    var s = leitnerState(studentId, wordId);
    var from = s ? s.box : null;
    if (!s) {
      s = {
        id: 'LS' + seq('LS', 3), studentId: studentId, wordId: wordId, box: 'green',
        addedAt: TODAY, dueAt: null, lastReviewAt: null, lastResult: '待复习',
        manualToday: false, reason: reason, source: src, sourceTaskId: srcTask, by: by || '李婉'
      };
      db.leitnerStates.push(s);
    } else {
      s.box = 'green';
      s.dueAt = null;
      s.reason = reason;
      s.by = by || '李婉';
      s.source = src;
      s.sourceTaskId = srcTask;
      s.addedAt = TODAY;
    }
    logOp(studentId, wordId, '加入绿盒', from, 'green', reason, by, srcTask);
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
  /** 生成训练会话级报告：统计与掌握率全部来自本次最终检测（finalResults），不来自点击/历史。
   *  幂等：task.reportId 回指，一个训练任务最多一份报告；重复生成返回既有报告。 */
  function generateTrainingReport(taskId) {
    assertTeachingAccess();
    var t = trainTask(taskId);
    if (!t) throw bizError('TASK_NOT_FOUND', '训练任务不存在');
    if (t.status !== STATUS.DONE) throw bizError('TASK_NOT_DONE', '训练任务尚未完成，不能生成报告');
    if (t.reportId) {
      var ex = db.trainingReports.filter(function (r) { return r.id === t.reportId; })[0];
      if (ex) return ex;
    }
    var total = (t.queueWordIds || []).length;
    var mastered = 0, needs = 0, notMastered = 0;
    var words = (t.queueWordIds || []).map(function (id) {
      var fr = t.finalResults[id] || {};
      var m = mapResult(fr.result);
      if (m === MASTERY.MASTERED) mastered++;
      else if (m === MASTERY.NEEDS_PRACTICE) needs++;
      else if (m === MASTERY.NOT_MASTERED) notMastered++;
      var w = word(id);
      return {
        wordId: id, en: w ? w.en : id, ph: w ? w.ph : '', mean: w ? w.mean : [],
        sourceBookIds: wordbookIdsOf(id), sourceBookNames: wordbookNamesOf(id),
        finalResult: fr.result || '', mastery: m, masteryLabel: MASTERY_LABEL[m] || '',
        teacherNote: fr.note || '', enteredReview: (m === MASTERY.NOT_MASTERED || m === MASTERY.NEEDS_PRACTICE)
      };
    });
    var rep = {
      id: 'TRPT' + seq('TRPT', 4),
      taskId: taskId, studentId: t.studentId, teacherId: t.teacherId,
      sessionDate: (t.finishedAt || TODAY).slice(0, 10),
      sourceWordbookIds: (t.wordbookIds || []).slice(),
      trainedCount: total,
      masteredCount: mastered, needsPracticeCount: needs, notMasteredCount: notMastered,
      masteredRate: total ? Math.round(mastered / total * 10000) / 100 : 0,
      words: words,
      teacherNote: t.reportNote || { overall: '', performance: '', problems: '', nextAdvice: '' },
      createdAt: stamp(), updatedAt: stamp()
    };
    db.trainingReports.push(rep);
    t.reportId = rep.id;
    save();
    return rep;
  }

  /* ================= 统一复习计划（第五阶段业务对象） =================
     一个 (studentId, wordId) 同一时刻只允许一条有效计划（pending/in_progress）；
     训练检测后待加强/未掌握才入计划，掌握不进入常规复习；历史计划版本化归档不删除。 */
  function reviewStrategyOf(mastery) {
    var c = (db.config && db.config.reviewStrategy) || {};
    var interval = (c.interval) || {};
    var map = { not_mastered: 1, needs_practice: 3, mastered: 7 };
    return {
      intervalDays: interval[mastery] ? Number(interval[mastery]) : map[mastery],
      maxStage: c.maxStage || 5,
      multiplier: typeof c.multiplier === 'number' ? Number(c.multiplier) : 1.5
    };
  }
  function planStartDate(mastery) { return addDays(TODAY, reviewStrategyOf(mastery).intervalDays); }
  function activeReviewPlanOf(studentId, wordId) {
    return db.reviewPlans.filter(function (p) {
      return p.studentId === studentId && p.wordId === wordId &&
        (p.status === 'pending' || p.status === 'in_progress');
    }).sort(function (a, b) { return (a.updatedAt || '') < (b.updatedAt || '') ? 1 : -1; })[0] || null;
  }
  /** 训练检测完成后为待加强 / 未掌握单词建立（或版本化）统一复习计划；掌握单词不入常规复习。
   *  幂等：task.reviewPlanBuilt 回指，同一训练任务只建一次计划（防重复）；新训练再次判定时按新版本迭代。 */
  function createReviewPlansFromTraining(taskId) {
    assertTeachingAccess();
    var t = trainTask(taskId);
    if (!t) throw bizError('TASK_NOT_FOUND', '训练任务不存在');
    if (t.status !== STATUS.DONE) throw bizError('TASK_NOT_DONE', '训练任务尚未完成，不能生成复习计划');
    if (t.reviewPlanBuilt) {
      return db.reviewPlans.filter(function (p) { return p.sourceTaskId === taskId; });
    }
    var joins = t.joins || {};
    // 策略落点：该词是否随本次训练进入莱特纳/21 天体系（作为复习策略）
    function planRefFor(id) {
      if ((joins.leitner || []).indexOf(id) >= 0) return { type: 'leitner', id: '' };
      if ((joins.plan21 || []).indexOf(id) >= 0) {
        return { type: 'plan21', id: (joins.planIds || [])[0] || '' };
      }
      return { type: 'unified', id: '' };
    }
    var made = [];
    (t.queueWordIds || []).forEach(function (id) {
      var fr = t.finalResults[id] || {};
      var m = mapResult(fr.result);
      if (m !== MASTERY.NOT_MASTERED && m !== MASTERY.NEEDS_PRACTICE) return;
      var pid = 'RVP' + seq('RVP', 4);
      var old = activeReviewPlanOf(t.studentId, id);
      if (old) { old.status = 'removed'; old.archivedAt = stamp(); old.supersededBy = pid; }
      var p = {
        id: pid, studentId: t.studentId, wordId: id,
        sourceTrainingSessionId: taskId, sourceTaskId: taskId,
        status: 'in_progress', strategy: 'unified', currentStage: 1,
        nextReviewAt: planStartDate(m), lastReviewAt: null,
        lastResult: fr.result || '', mastery: m,
        planRef: planRefFor(id),
        createdAt: stamp(), updatedAt: stamp()
      };
      db.reviewPlans.push(p);
      made.push(p);
    });
    t.reviewPlanBuilt = true;
    save();
    return made;
  }

  /* ---- 复习任务列表 / 发起复习 / 复习记录 ---- */
  function dueReviewWords(studentId) {
    return db.reviewPlans.filter(function (p) {
      return p.studentId === studentId && (p.status === 'pending' || p.status === 'in_progress') &&
        p.nextReviewAt && p.nextReviewAt <= TODAY;
    }).sort(function (a, b) { return (a.nextReviewAt || '') < (b.nextReviewAt || '') ? -1 : 1; });
  }
  function reviewPlansOf(studentId, wordId) {
    return db.reviewPlans.filter(function (p) {
      return p.studentId === studentId && (!wordId || p.wordId === wordId);
    }).sort(function (a, b) { return (a.createdAt || '') < (b.createdAt || '') ? 1 : -1; });
  }
  function activeReviewPlan(studentId, wordId) { return activeReviewPlanOf(studentId, wordId); }
  function reviewPlanStat(studentId) {
    var list = db.reviewPlans.filter(function (p) { return p.studentId === studentId; });
    var active = list.filter(function (p) { return p.status === 'pending' || p.status === 'in_progress'; });
    return {
      total: list.length, active: active.length,
      due: active.filter(function (p) { return p.nextReviewAt && p.nextReviewAt <= TODAY; }).length,
      mastered: active.filter(function (p) { return p.lastResult === 'yes' || p.mastery === 'mastered'; }).length
    };
  }
  /** 复习动作：追加一条复习记录 + 按结果动态调整计划的下次到期（间隔走策略，不硬编码）。 */
  function recordReview(opt) {
    assertTeachingAccess();
    opt = opt || {};
    if (!opt.studentId || !opt.wordId) throw bizError('REQUIRED', '缺少学员或单词');
    var m = opt.result && [MASTERY.MASTERED, MASTERY.NEEDS_PRACTICE, MASTERY.NOT_MASTERED].indexOf(opt.result) >= 0
      ? opt.result : mapResult(opt.resultRaw);
    if (!m) throw bizError('BAD_RESULT', '复习结果不合法');
    var plan = activeReviewPlanOf(opt.studentId, opt.wordId);
    var strategy = reviewStrategyOf(m);
    var rec = {
      id: 'RVR' + seq('RVR', 4), studentId: opt.studentId, wordId: opt.wordId,
      planId: plan ? plan.id : '', sourceTaskId: opt.sourceTaskId || '',
      reviewedAt: stamp(), method: opt.method || 'unified',
      result: m, mastery: m,
      teacherId: opt.teacherId || (session.role === 'teacher' ? sessionTeacherId() : ''),
      nextReviewAt: '', note: opt.note || ''
    };
    if (plan) {
      plan.lastReviewAt = rec.reviewedAt;
      plan.lastResult = m === MASTERY.MASTERED ? 'yes' : m === MASTERY.NEEDS_PRACTICE ? 'mid' : 'no';
      plan.mastery = m;
      plan.status = 'pending';
      if (m === MASTERY.MASTERED) plan.currentStage = Math.min((plan.currentStage || 1) + 1, strategy.maxStage);
      else plan.currentStage = 1;
      var gap = strategy.intervalDays * (m === MASTERY.MASTERED ? plan.currentStage : 1);
      plan.nextReviewAt = addDays(TODAY, gap);
      plan.updatedAt = stamp();
      rec.nextReviewAt = plan.nextReviewAt;
    } else {
      rec.nextReviewAt = addDays(TODAY, strategy.intervalDays);
    }
    db.reviewRecords.push(rec);
    save();
    return rec;
  }
  function reviewRecordsOf(studentId, wordId) {
    return db.reviewRecords.filter(function (r) {
      return r.studentId === studentId && (!wordId || r.wordId === wordId);
    }).sort(function (a, b) { return (a.reviewedAt || '') < (b.reviewedAt || '') ? 1 : -1; });
  }

  /** 学员某词的当前掌握状态（训练内容确认清单 / 训练工作台 / 复习标注共用）。
   *  仅作派生投影，不写历史；优先取统一复习计划的 mastery，其次取 wordState 兜底。 */
  function wordMastery(studentId, wordId) {
    var plan = activeReviewPlanOf(studentId, wordId);
    if (plan) {
      var due = !!(plan.nextReviewAt && plan.nextReviewAt <= TODAY);
      if (plan.mastery === MASTERY.NOT_MASTERED) return { key: 'not_mastered', label: '未掌握', dueReview: due };
      if (plan.mastery === MASTERY.NEEDS_PRACTICE) return { key: 'needs_practice', label: '待加强', dueReview: due };
      if (plan.mastery === MASTERY.MASTERED) return { key: 'mastered', label: '已掌握', dueReview: due };
      if (due) return { key: 'review_due', label: '待复习(到期)', dueReview: true };
      return { key: 'review', label: '复习中', dueReview: false };
    }
    var st = wordState(studentId, wordId);
    var state = st ? st.state : '未训练';
    if (state === '本次通过') return { key: 'mastered', label: '已掌握', dueReview: false };
    if (state === '初筛认识') return { key: 'mastered', label: '已有印象', dueReview: false };
    if (state === '待复习' || state === '暂不确定') return { key: 'needs_practice', label: '待加强', dueReview: false };
    if (state === '待最后复习' || state === '待强化训练') return { key: 'not_mastered', label: '未掌握(训练中)', dueReview: false };
    return { key: 'not_trained', label: '未训练', dueReview: false };
  }
  /** 训练阶段标记「需要强化」（持久化到 trainDisplays.needsReinforce，不影响掌握判断）。 */
  function markTrainReinforce(taskId, wordId, flag) {
    assertTeachingAccess();
    assertMyTask(taskId);
    var t = trainTask(taskId);
    if (!t) throw bizError('TASK_NOT_FOUND', '训练任务不存在');
    if ((t.queueWordIds || []).indexOf(wordId) < 0) throw bizError('WORD_NOT_IN_QUEUE', '该单词不属于本次训练队列');
    var d = trainDisplayOf(taskId, wordId);
    if (!d) {
      d = {
        id: 'TDP' + seq('TDP', 4), taskId: taskId, studentId: t.studentId, wordId: wordId,
        groupIndex: Math.floor((t.queueWordIds || []).indexOf(wordId) / (t.groupSize || TRAIN_GROUP_SIZE)),
        displayStep: 0, cycleCompleted: false, taps: 0,
        updatedAt: stamp(), completedAt: null, teacherId: t.teacherId || ''
      };
      db.trainDisplays.push(d);
    }
    d.needsReinforce = flag ? true : false;
    d.updatedAt = stamp();
    save();
    return d;
  }

  /** 训练报告读取（学员维，可按任务过滤；含逐词明细与掌握率） */
  function trainingReportsOf(studentId, taskId) {
    return db.trainingReports.filter(function (r) {
      return r.studentId === studentId && (!taskId || r.taskId === taskId);
    }).sort(function (a, b) { return (a.createdAt || '') < (b.createdAt || '') ? 1 : -1; });
  }

  /** 家长只读：训练会话级报告投影（assertParentChild 隔离；只给业务字段，不给可写/内部字段） */
  function parentTrainingReports(parentId, studentId) {
    var pid = assertParentChild(parentId, studentId);
    return db.trainingReports.filter(function (r) { return r.studentId === studentId; })
      .sort(function (a, b) { return (a.createdAt || '') < (b.createdAt || '') ? 1 : -1; })
      .map(function (r) {
        return {
          id: r.id, taskId: r.taskId, sessionDate: r.sessionDate, teacherId: r.teacherId,
          trainedCount: r.trainedCount, mastered: r.masteredCount,
          needsPractice: r.needsPracticeCount, notMastered: r.notMasteredCount,
          masteredRate: r.masteredRate,
          words: (r.words || []).map(function (w) {
            return {
              wordId: w.wordId, en: w.en, ph: w.ph || '', mean: w.mean || [],
              finalResult: w.finalResult, mastery: w.mastery || '',
              masteryLabel: w.masteryLabel || '', enteredReview: !!w.enteredReview
            };
          }),
          teacherOverall: (r.teacherNote && r.teacherNote.overall) || ''
        };
      });
  }
  /** 家长只读：学员当前有效复习计划投影（含每个词的到期与已完成复习次数）。 */
  function parentReviewPlan(parentId, studentId, wordId) {
    var pid = assertParentChild(parentId, studentId);
    return db.reviewPlans.filter(function (p) {
      return p.studentId === studentId && (!wordId || p.wordId === wordId) &&
        (p.status === 'pending' || p.status === 'in_progress');
    }).map(function (p) {
      var w = word(p.wordId);
      return {
        wordId: p.wordId, en: w ? w.en : p.wordId, ph: w ? w.ph : '',
        mastery: p.mastery || '', nextReviewAt: p.nextReviewAt,
        due: !!(p.nextReviewAt && p.nextReviewAt <= TODAY),
        sourceTrainingSessionId: p.sourceTrainingSessionId,
        recordCount: db.reviewRecords.filter(function (r) {
          return r.studentId === studentId && r.wordId === p.wordId;
        }).length
      };
    });
  }

  /** 教学写入口角色守卫：代理/家长不能直接通过 Store 修改训练结果、报告、复习计划与复习记录。
   *  教师需再经 assertMyTask 归属校验；admin/staff/ops 保留管理能力。 */
  function assertTeachingAccess() {
    if (session.role === 'parent' || session.role === 'agent') {
      throw bizError('FORBIDDEN', '当前身份不能修改教学训练结果');
    }
  }

  function completeTask(taskId, opt) {
    opt = opt || {};
    assertTeachingAccess();
    assertMyTask(taskId);
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

    /* 统一副产物：训练会话报告 + 复习计划（幂等，均已用 task 回指防重复；生成失败不阻塞完成） */
    try { generateTrainingReport(taskId); } catch (e) { warnings.push('训练报告生成失败：' + e.message); }
    try { createReviewPlansFromTraining(taskId); } catch (e) { warnings.push('复习计划生成失败：' + e.message); }

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
        addToGreen(t.studentId, id, '训练最后复习未通过（任务 ' + t.id + '）', opt.by || '李婉',
          { source: SCREEN_SOURCE.TRAIN_FINAL, taskId: taskId });
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
    if (session.role === 'teacher') teacherId = assertSelfTeacher(teacherId);
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
    if (session.role === 'teacher') teacherId = assertSelfTeacher(teacherId);
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
    var accs = accountsOfStudent(stu.id);
    var acc = accs.filter(function (a) { return Number(a.remain) > 0; })[0] || accs[0];
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
    acc.updatedAt = stamp();
    var f = {
      id: 'FL' + TODAY.replace(/-/g, '') + ('000' + (db.flows.length + 1)).slice(-3),
      student: stu.name, studentId: stu.id, account: acc.id, accountId: acc.id, type: '正常扣课',
      delta: -1, before: before, after: acc.remain,
      ref: c.id + ' 课程完成', op: by || '系统', time: stamp(),
      note: '课程完成后自动扣课', courseId: c.id, orderId: acc.orderId || ''
    };
    db.flows.push(f);
    c.deductState = '已扣课';
    c.deduct = '已扣课';
    setLessonAccountStatus(acc, db.config.renewal.lessonThreshold);
    syncStudentRemain(stu.id);
    save();
    refreshRenewalOpportunities(stu.id);
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
    ['performance', 'weak', 'next', 'homeworkAdvice'].forEach(function (k) {
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
    /* 报告发布即生成一条「已发布」学习反馈，代理与家长只看这一层投影 */
    syncFeedbackFromReport(rp);
    var stu = student(rp.studentId) || {};
    var parentRel = db.parentStudents.filter(function (x) {
      return x.studentId === rp.studentId && !x.endAt;
    })[0];
    recordAudit({
      module: '教学与报告', action: '发布学习报告', resourceType: 'report', resourceId: rp.id,
      resourceName: (stu.name || rp.studentId) + ' / ' + (rp.courseId || ''),
      beforeData: { status: REPORT_STATUS.SUBMITTED },
      afterData: { status: rp.status, publishedBy: rp.publishedBy },
      reason: '报告发布后家长可见', result: '成功'
    });
    notify('REPORT_PUBLISHED', {
      studentName: stu.name || '', parentId: parentRel ? parentRel.parentId : '',
      businessId: rp.id, link: 'parent/report.html?id=' + rp.id
    });
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
      operatorId: opt.operatorId || session.operatorId || '',
      operatorName: opt.operatorName || operatorNameNow(),
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
        operatorId: meta.operatorId || session.operatorId || '',
        operatorName: meta.operatorName || operatorNameNow(),
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
      operatorId: meta.operatorId || session.operatorId || '',
      operatorName: meta.operatorName || operatorNameNow(),
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
  function accountForSession() {
    if (session.accountId) {
      return db.users.filter(function (u) { return u.id === session.accountId; })[0] || null;
    }
    if (session.operatorId && String(session.operatorId).indexOf('UA') === 0) {
      return db.users.filter(function (u) { return u.id === session.operatorId; })[0] || null;
    }
    /* 只有对应业务身份才用对应档案定位账号，避免切角色后残留 teacherId 借到他人账号 */
    if (session.role === 'teacher' && session.teacherId) {
      return db.users.filter(function (u) { return u.teacherId === session.teacherId; })[0] || null;
    }
    if (session.role === 'agent' && session.agentId) {
      return db.users.filter(function (u) { return u.agentId === session.agentId; })[0] || null;
    }
    if (session.role === 'parent' && session.parentId) {
      return db.users.filter(function (u) { return u.parentId === session.parentId; })[0] || null;
    }
    /* 内部角色在旧页面里可能只设置了 role + 操作人姓名；只在同一角色内匹配，
       不存在跨角色借用。若该角色只有一个启用账号，它就是当前会话身份。 */
    if (['admin', 'staff', 'ops'].indexOf(session.role) >= 0) {
      var sameRole = db.users.filter(function (u) {
        return u.roleCode === session.role && u.profileType === 'staff';
      });
      var byName = sameRole.filter(function (u) { return staffNameOf(u) === session.operatorName; })[0];
      if (byName) return byName;
      if (sameRole.length === 1) return sameRole[0];
    }
    return null;
  }
  function sessionAccountActive() {
    var u = accountForSession();
    if (!u) return true; /* 兼容没有统一账号的内部会话（setSession 未传 accountId） */
    return u.status === ACCOUNT.OK;
  }
  function setSession(s) {
    s = s || {};
    var roleChanged = !!s.role && s.role !== session.role;
    if (s.accountId) {
      var acc = db.users.filter(function (u) { return u.id === s.accountId; })[0];
      if (!acc) throw bizError('NO_ACCOUNT', '账号不存在：' + s.accountId);
      if (acc.status !== ACCOUNT.OK) {
        throw bizError('ACCOUNT_DISABLED',
          '账号「' + acc.loginName + '」' + (acc.status === ACCOUNT.NONE ? '未开通' : '已禁用') + '，不能作为当前身份',
          { accountId: acc.id, status: acc.status });
      }
      session.accountId = acc.id;
      if (!s.operatorName) { s.operatorName = (staffNameOf(acc) || acc.loginName); }
    } else if ('accountId' in s) {
      session.accountId = '';
    }
    if (s.role) session.role = s.role;
    if (s.operatorName) { session.operatorName = s.operatorName; session.operatorId = s.operatorName; }
    else if (roleChanged && !s.accountId && ROLE_DEFAULT_OPERATOR[session.role]) {
      session.operatorName = ROLE_DEFAULT_OPERATOR[session.role];
      session.operatorId = session.operatorName;
    }
    if (s.operatorId) session.operatorId = s.operatorId;
    /* 教师身份单独记：教师端所有「我的 / 自己的」判断都靠它，不靠姓名猜 */
    if ('teacherId' in s) session.teacherId = s.teacherId || '';
    if ('agentId' in s) session.agentId = s.agentId || '';
    if ('parentId' in s) session.parentId = s.parentId || '';
    saveSession();
    return clone(session);
  }
  function currentSession() { return clone(session); }
  /* 操作人一律取自当前会话；不再按角色内置姓名，避免硬编码身份。 */
  function operatorForRole(role) {
    var acc = accountForSession();
    return (acc && staffNameOf(acc)) || session.operatorName || '';
  }
  function rolePermissionOf(roleCode, permissionCode) {
    return db.rolePermissions.filter(function (rp) {
      return rp.roleCode === roleCode && rp.permissionCode === permissionCode;
    })[0] || null;
  }
  /** 动态权限判断：先按新权限编码查 rolePermissions，未迁移的历史动作才回落到静态 PERMS */
  function can(action) {
    if (!sessionAccountActive()) return false;
    var code = ACTION_PERM[action];
    if (code) {
      var rp = rolePermissionOf(session.role, code);
      return !!(rp && rp.enabled);
    }
    return (PERMS[action] || []).indexOf(session.role) >= 0;
  }
  function hasPermission(userId, permissionCode) {
    var roleCode = session.role;
    var statusOk = true;
    if (userId) {
      var u = db.users.filter(function (x) {
        return x.id === userId || x.profileId === userId || x.loginName === userId;
      })[0];
      if (u) {
        roleCode = u.roleCode || u.roleId || '';
        statusOk = u.status === ACCOUNT.OK;
      } else if (ROLE_SEED.some(function (r) { return r.code === userId; })) {
        roleCode = userId;
      } else {
        return false;
      }
    } else {
      statusOk = sessionAccountActive();
    }
    var rp = rolePermissionOf(roleCode, permissionCode);
    return !!(statusOk && rp && rp.enabled);
  }
  function assertPermission(permissionCode) {
    if (!hasPermission('', permissionCode)) {
      throw bizError('FORBIDDEN', '当前身份无权执行该操作（' + permissionCode + '）', { permission: permissionCode });
    }
  }
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
    if (session.role === 'teacher') id = assertSelfTeacher(id);
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
    if (session.role === 'teacher') id = assertSelfTeacher(id);
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
      status: ACCOUNT.OK, roleCode: 'teacher', roleId: 'teacher', teacherId: t.id,
      profileType: 'teacher', profileId: t.id,
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
    recordAudit({
      module: '教师管理', action: '开通教师账号', resourceType: 'account', resourceId: u.id,
      resourceName: t.name, beforeData: { accountId: '' },
      afterData: { accountId: u.id, loginName: u.loginName, status: u.status },
      reason: opt.reason || '为教师开通登录账号', result: '成功'
    });
    save();
    return u;
  }

  /* ---------- 账号状态（单独入口，便于权限与留痕统一校验） ---------- */
  function setTeacherAccountStatus(teacherId, status, opt) {
    assertCan('teacher.account');
    opt = opt || {};
    var u = accountOf(teacherId);
    if (!u) throw bizError('NO_ACCOUNT', '该教师还没有登录账号');
    if (status !== ACCOUNT.OK && status !== ACCOUNT.DISABLED) {
      throw bizError('BAD_STATUS', '账号状态只能设置为「正常」或「已禁用」');
    }
    if (u.status === status) return u;
    var beforeStatus = u.status;
    if (status === ACCOUNT.OK) enableAccount(teacherId, opt.reason || '手动启用账号');
    else disableAccount(teacherId, opt.reason || '手动禁用账号');
    recordAudit({
      module: '教师管理', action: status === ACCOUNT.OK ? '启用教师账号' : '禁用教师账号',
      resourceType: 'account', resourceId: u.id, resourceName: (teacher(teacherId) || {}).name || teacherId,
      beforeData: { status: beforeStatus }, afterData: { status: status },
      reason: opt.reason || '手动调整教师登录账号状态', result: '成功'
    });
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
    recordAudit({
      module: '教学资源分配', action: '正式分配学员', resourceType: 'student', resourceId: s.id,
      resourceName: s.name, beforeData: { teacherId: '', teacherName: '未分配', relationId: '' },
      afterData: { teacherId: t.id, teacherName: t.name, relationId: r.id, startAt: r.startAt, demandId: r.demandId },
      reason: reason, result: '成功'
    });
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
    recordAudit({
      module: '教学资源分配', action: '更换负责教师', resourceType: 'student', resourceId: s.id,
      resourceName: s.name,
      beforeData: { teacherId: cur ? cur.teacherId : '', relationId: cur ? cur.id : '' },
      afterData: { teacherId: nt.id, teacherName: nt.name, relationId: r.id, startAt: r.startAt },
      reason: reason, result: '成功'
    });
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
    recordAudit({
      module: '教学资源分配', action: '解除师生关系', resourceType: 'student', resourceId: s.id,
      resourceName: s.name,
      beforeData: { teacherId: cur.teacherId, relationId: cur.id, status: REL.ACTIVE },
      afterData: { teacherId: '', relationId: cur.id, status: cur.status, endAt: cur.endAt },
      reason: reason, result: '成功'
    });
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
    /* 身份只来自会话：不再按姓名反查教师，也不自动借用默认教师 */
    return session.teacherId || '';
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
  /** 训练任务归属校验：教师只能操作自己创建的任务。
   *  依据任务创建时的 teacherId 绑定，而非前端传入的学生/教师参数；
   *  学员发生教师转移时，历史任务不自动转移给新教师（原教师仍可恢复/完成）。
   *  非教师角色（admin/staff/ops）放行，保障管理端必要能力。 */
  function assertMyTask(taskId) {
    if (session.role !== 'teacher') return;
    var t = trainTask(taskId);
    if (!t) throw bizError('TASK_NOT_FOUND', '训练任务不存在');
    var self = assertSelfTeacher();
    if ((t.teacherId || '') !== self) {
      throw bizError('FORBIDDEN', '该训练任务不属于当前教师，无法操作');
    }
    return t;
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
      recordAudit({
        module: '学员需求', action: '重新发布学员需求', resourceType: 'demand', resourceId: x.id,
        resourceName: x.studentName || x.id, beforeData: { status: x.status }, afterData: { status: x.status },
        reason: opt.reason || '重新发布通知', result: '成功'
      });
      notify('DEMAND_PUBLISHED', {
        studentName: x.studentName || '', businessId: x.id,
        link: 'teacher/demand-center.html?tab=open'
      });
      save();
      return x;
    }
    var from = x.status;
    x.status = DEMAND.OPEN;
    x.publishedBy = session.operatorName;
    x.publishedAt = stamp();
    x.updatedAt = x.publishedAt;
    logDemand(x.id, DEMAND_ACTION.PUBLISHED, opt.reason || '发布到待接单需求池', { from: from, to: x.status });
    recordAudit({
      module: '学员需求', action: '发布学员需求', resourceType: 'demand', resourceId: x.id,
      resourceName: x.studentName || x.id, beforeData: { status: from }, afterData: { status: x.status },
      reason: opt.reason || '向教师开放接单', result: '成功'
    });
    notify('DEMAND_PUBLISHED', {
      studentName: x.studentName || '', businessId: x.id,
      link: 'teacher/demand-center.html?tab=open'
    });
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
      recordAudit({
        module: '学员需求', action: '教务确认人选', resourceType: 'demand', resourceId: x.id,
        resourceName: x.studentName || x.id, beforeData: { status: DEMAND.CONFIRM, teacherId: '' },
        afterData: { status: x.status, teacherId: teacherId, reason: reason },
        reason: reason, result: '成功'
      });
      notify('DEMAND_CONFIRMED', {
        studentName: x.studentName || '', teacherId: teacherId, businessId: x.id,
        link: 'teacher/demand-center.html?tab=mine'
      });
      notify('DEMAND_WAIT_ASSIGN', {
        studentName: x.studentName || '', businessId: x.id,
        link: 'admin/assign-task.html?id=' + x.id
      });
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
      recordAudit({
        module: '学员需求', action: '撤销教务确认', resourceType: 'demand', resourceId: x.id,
        resourceName: x.studentName || x.id, beforeData: { status: DEMAND.ASSIGN, teacherId: prev },
        afterData: { status: x.status, teacherId: '' }, reason: reason, result: '成功'
      });
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
      recordAudit({
        module: '教学分配', action: chk.isChange ? '更换负责教师' : '正式分配教师',
        resourceType: 'demand', resourceId: x.id,
        resourceName: chk.student.name + ' / ' + chk.teacher.name,
        beforeData: { status: from, teacherId: chk.isChange ? chk.currentTeacher.id : '' },
        afterData: { status: x.status, teacherId: chk.teacher.id, relationId: rel.id },
        reason: reason, result: '成功'
      });
      notify('DEMAND_ASSIGNED', {
        studentName: chk.student.name, teacherId: chk.teacher.id, businessId: x.id,
        link: 'teacher/my-students.html'
      });
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
    if (session.role === 'teacher') q.teacherId = assertSelfTeacher(q.teacherId);
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
        recordAudit({
          module: '教学资源', action: '提交词库申请', resourceType: 'wordbookRequest', resourceId: r.id,
          resourceName: s.name + ' / ' + (wordbook(wid) || {}).name,
          beforeData: null, afterData: { studentId: s.id, wordbookId: wid, status: r.status },
          reason: reason, result: '成功'
        });
        notify('WORD_REQUEST', {
          teacherName: (teacher(tid) || {}).name || tid, studentName: s.name,
          businessId: r.id, link: 'admin/wordbook-request.html?tab=pending'
        });
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
      recordAudit({
        module: '教学资源', action: approve ? '审核词库申请（通过）' : '审核词库申请（驳回）',
        resourceType: 'wordbookRequest', resourceId: r.id,
        resourceName: s.name + ' / ' + b.name, beforeData: { status: WBR.PENDING },
        afterData: { status: r.status, grantId: grant ? grant.id : '', remark: r.reviewRemark },
        reason: r.reviewRemark, result: '成功'
      });
      notify(approve ? 'WORD_GRANTED' : 'WORD_REJECTED', {
        studentName: s.name, teacherId: r.teacherId, grantId: grant ? grant.id : '',
        businessId: r.id, link: 'teacher/demand-center.html?tab=wbreq'
      });
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

  /* ============================================================
     第七轮：代理获客 / 线索 / 报名订单 / 收款 / 课时 / 续费 / 反馈
     ------------------------------------------------------------
     分层约定：
       1) 所有写操作先 assertCan + 归属校验，再快照 db，失败 JSON.parse 回滚；
       2) 代理 / 家长 / 教师只拿「投影」，越权判断在 Store 里，不靠页面隐藏按钮；
       3) 课时只认 accounts，订单只有「收款已确认」才生成账户；
       4) 归属：lead.agentId（代理归属）、lead.followerId（维护归属）、
          order.agentId（成交归属）三处留痕，变更写 leadLogs。
     安全说明：以上过滤在原型阶段由 Store 承担；真实上线必须把这些投影
     下沉到服务端接口（代理只能请求自己的 customerId，家长只能请求自己的孩子），
     前端不可信。
     ============================================================ */

  function agent(id) { return db.agents.filter(function (a) { return a.id === id; })[0] || null; }
  function agents() { return db.agents; }
  function product(id) { return db.products.filter(function (p) { return p.id === id; })[0] || null; }
  function products() { return db.products; }
  function lead(id) { return db.leads.filter(function (l) { return l.id === id; })[0] || null; }
  function order(id) { return db.orders.filter(function (o) { return o.id === id; })[0] || null; }
  function payment(id) { return db.payments.filter(function (p) { return p.id === id; })[0] || null; }
  function renewal(id) { return db.renewalOpportunities.filter(function (r) { return r.id === id; })[0] || null; }
  function parent(id) { return db.parents.filter(function (p) { return p.id === id; })[0] || null; }

  function defaultAgentId() {
    var a = db.agents.filter(function (x) { return x.status === '启用'; })[0] || db.agents[0];
    return a ? a.id : '';
  }
  /** 演示模式开关：只有显式 ?demo=1（或 localStorage ee_proto_demo=1）才允许借用默认身份 */
  function isDemoMode() {
    try {
      var q = (W.location && W.location.search) || '';
      if (/[?&]demo=1(?:&|$)/.test(q)) return true;
      return SS.getItem('ee_proto_demo') === '1';
    } catch (e) { return false; }
  }
  /** 代理身份只认会话；缺失时不再自动借用第一位启用代理，避免张冠李戴 */
  function sessionAgentId() {
    if (session.agentId) return session.agentId;
    return isDemoMode() ? defaultAgentId() : '';
  }
  function defaultParentId() {
    var p = db.parents.filter(function (x) { return x.status !== '停用'; })[0] || db.parents[0];
    return p ? p.id : '';
  }
  function sessionParentId() {
    /* 家长身份只认会话；缺失时不再借用第一位家长 */
    if (session.parentId) return session.parentId;
    return isDemoMode() ? defaultParentId() : '';
  }
  /** 代理身份只能操作自己：与教师 assertSelfTeacher 口径一致 */
  function assertSelfAgent(agentId) {
    if (session.role !== 'agent') return agentId;
    var self = sessionAgentId();
    if (!self) throw bizError('NO_AGENT_CONTEXT', '当前代理登录态无法识别，请重新进入代理工作台');
    if (agentId && agentId !== self) throw bizError('FORBIDDEN', '代理只能查看和操作自己负责的客户');
    return self;
  }
  function assertSelfParent(parentId) {
    if (session.role !== 'parent') return parentId;
    var self = sessionParentId();
    if (!self) throw bizError('NO_PARENT_CONTEXT', '当前家长登录态无法识别，请重新进入家长端');
    if (parentId && parentId !== self) throw bizError('FORBIDDEN', '家长只能查看自己孩子的数据');
    return self;
  }
  function assertAgentEnabled(agentId) {
    var a = agent(agentId);
    if (!a) throw bizError('AGENT_NOT_FOUND', '代理不存在');
    if (a.status !== '启用') {
      throw bizError('AGENT_DISABLED', '代理「' + a.name + '」当前状态为「' + a.status + '」，不能继续获客或下单');
    }
    return a;
  }
  function operatorNameNow() {
    if (session.role === 'agent') {
      var a = agent(sessionAgentId());
      if (a) return a.name;
    }
    if (session.role === 'parent') {
      var p = parent(sessionParentId());
      if (p) return p.name;
    }
    return session.operatorName || '';
  }
  function addMonths(dateStr, n) {
    var d = new Date(String(dateStr || TODAY).slice(0, 10) + 'T00:00:00');
    if (isNaN(d.getTime())) d = new Date(TODAY + 'T00:00:00');
    d.setMonth(d.getMonth() + (Number(n) || 0));
    return d.getFullYear() + '-' + pad(d.getMonth() + 1, 2) + '-' + pad(d.getDate(), 2);
  }
  function nextId(prefix, k, width) {
    return prefix + pad(seq(k, width || 3), width || 3);
  }
  function nextStudentId() {
    var max = 0;
    db.students.forEach(function (s) {
      var m = /(\d+)$/.exec(String(s.id || ''));
      if (m) max = Math.max(max, Number(m[1]));
    });
    return 'S' + String(TODAY.slice(0, 4)) + pad(max + 1, 3);
  }
  function nextParentId() {
    var max = 0;
    db.parents.forEach(function (p) {
      var m = /^P(\d+)$/.exec(String(p.id || ''));
      if (m) max = Math.max(max, Number(m[1]));
    });
    return 'P' + pad(max + 1, 3);
  }
  function nextOrderId() {
    return 'OD' + TODAY.replace(/-/g, '') + pad(seq('ORD', 3), 3);
  }
  function nextLeadId() {
    return 'L' + TODAY.replace(/-/g, '') + pad(seq('LD', 3), 3);
  }

  function leadLog(leadId, action, detail, from, to) {
    var item = {
      id: nextId('LL', 'LLOG', 3), leadId: leadId, action: action, detail: detail,
      from: from || '', to: to || '', operatorId: session.operatorId || '',
      operatorName: operatorNameNow(), at: stamp()
    };
    db.leadLogs.push(item);
    return item;
  }
  function orderLog(orderId, action, detail, from, to) {
    var item = {
      id: nextId('OL', 'OLOG', 3), orderId: orderId, action: action, detail: detail,
      from: from || '', to: to || '', operatorId: session.operatorId || '',
      operatorName: operatorNameNow(), at: stamp()
    };
    db.orderLogs.push(item);
    return item;
  }
  function agentLog(agentId, action, detail, from, to) {
    var item = {
      id: nextId('AL', 'ALOG', 3), agentId: agentId, action: action, detail: detail,
      from: from || '', to: to || '', operatorId: session.operatorId || '',
      operatorName: operatorNameNow(), at: stamp()
    };
    db.agentLogs.push(item);
    return item;
  }
  function feedbackId() { return nextId('FB', 'FB', 3); }

  function assertLeadAccess(l) {
    if (!l) throw bizError('LEAD_NOT_FOUND', '客户线索不存在');
    if (session.role === 'agent') {
      var self = sessionAgentId();
      if (!self) throw bizError('NO_AGENT_CONTEXT', '当前代理登录态无法识别，请重新进入代理工作台');
      if (leadCurrentAgentId(l) !== self) {
        throw bizError('FORBIDDEN', '该客户不在你负责的范围内，不能查看或操作');
      }
    }
    return l;
  }
  function assertOrderAccess(o) {
    if (!o) throw bizError('ORDER_NOT_FOUND', '订单不存在');
    if (session.role === 'agent') {
      var self = sessionAgentId();
      if (o.agentId !== self) throw bizError('FORBIDDEN', '该订单不属于你负责的客户');
    }
    if (session.role === 'parent') {
      var pid = sessionParentId();
      var kids = parentStudents(pid).map(function (s) { return s.id; });
      if (o.parentId !== pid && kids.indexOf(o.studentId) < 0) {
        throw bizError('FORBIDDEN', '该订单不属于你的孩子');
      }
    }
    return o;
  }
  function assertRenewalAccess(r) {
    if (!r) throw bizError('RENEWAL_NOT_FOUND', '续费机会不存在');
    if (session.role === 'agent') {
      var self = sessionAgentId();
      if (r.agentId !== self) throw bizError('FORBIDDEN', '该续费机会不属于你负责的客户');
    }
    return r;
  }
  /** 家长—学员关系行：多对多唯一事实来源 */
  function parentStudentLinks(parentId) {
    return db.parentStudents.filter(function (x) { return x.parentId === parentId; });
  }
  /** 家长名下的孩子：以关系表为准；只有历史数据完全没有关系行时才回退旧字段 */
  function parentStudents(parentId) {
    var p = parent(parentId);
    if (!p) return [];
    var links = parentStudentLinks(parentId);
    if (links.length) {
      var ids = links.map(function (x) { return x.studentId; });
      return db.students.filter(function (s) { return ids.indexOf(s.id) >= 0; });
    }
    return db.students.filter(function (s) {
      return s.parent === parentId || (p.kids || []).indexOf(s.id) >= 0;
    });
  }
  /** 关联家长与学员（一个孩子可以同时有父母两个账号，各自独立收通知） */
  function linkParentStudent(parentId, studentId, opt) {
    assertCan('student.create');
    opt = opt || {};
    var p = parent(parentId);
    if (!p) throw bizError('PARENT_NOT_FOUND', '家长档案不存在');
    var s = student(studentId);
    if (!s) throw bizError('STUDENT_NOT_FOUND', '学员不存在');
    var exist = db.parentStudents.filter(function (x) {
      return x.parentId === parentId && x.studentId === studentId;
    })[0];
    if (exist) return exist;
    var rel = {
      id: nextId('PS', 'PS', 3), parentId: parentId, studentId: studentId,
      relationship: String(opt.relationship || p.relation || '家长'),
      isPrimaryContact: opt.isPrimaryContact === undefined ? false : !!opt.isPrimaryContact,
      createdBy: operatorNameNow(), createdAt: stamp()
    };
    db.parentStudents.push(rel);
    p.kids = p.kids || [];
    if (p.kids.indexOf(studentId) < 0) p.kids.push(studentId);
    save();
    return rel;
  }
  /** 解除家长—孩子关联：只移除关系，不删除任何历史课程/订单/报告/复习记录 */
  function unlinkParentStudent(parentId, studentId) {
    assertCan('student.create');
    var before = db.parentStudents.length;
    db.parentStudents = db.parentStudents.filter(function (x) {
      return !(x.parentId === parentId && x.studentId === studentId);
    });
    var p = parent(parentId);
    if (p && Array.isArray(p.kids)) {
      p.kids = p.kids.filter(function (k) { return k !== studentId; });
    }
    if (db.parentStudents.length === before) throw bizError('RELATION_NOT_FOUND', '家长与学员不存在关联');
    save();
    return { removed: true, parentId: parentId, studentId: studentId };
  }
  /** 课时账户归属唯一口径：有 studentId 时只按 ID；仅历史数据缺 studentId 才回退姓名 */
  function accountBelongsTo(acc, s) {
    if (!acc || !s) return false;
    if (acc.studentId) return acc.studentId === s.id;
    return !!s.name && acc.student === s.name;
  }
  function accountsOfStudent(studentId) {
    var s = student(studentId);
    if (!s) return [];
    return db.accounts.filter(function (a) { return accountBelongsTo(a, s); });
  }

  /* ---------------- 归属与投影 ---------------- */
  /** 线索当前维护代理（可移交）；旧 agentId 只作兼容 */
  function leadCurrentAgentId(l) {
    return l ? (l.currentAgentId || l.agentId || '') : '';
  }
  /** 线索首次获客代理（写入后永不覆盖） */
  function leadSourceAgentId(l) {
    return l ? (l.sourceAgentId || l.agentId || '') : '';
  }
  function studentAttribution(studentId) {
    var credited = db.orders.filter(function (o) {
      return o.studentId === studentId && o.agentId;
    }).sort(function (a, b) { return a.createdAt < b.createdAt ? 1 : -1; });
    if (credited.length) {
      return { agentId: credited[0].agentId, leadId: credited[0].leadId || '', orderId: credited[0].id };
    }
    var l = db.leads.filter(function (x) { return x.convertedStudentId === studentId; })[0];
    if (l) return { agentId: leadCurrentAgentId(l), leadId: l.id, orderId: '' };
    var s = student(studentId);
    if (s && s.agentId) return { agentId: s.agentId, leadId: s.sourceLeadId || '', orderId: '' };
    return { agentId: '', leadId: '', orderId: '' };
  }
  function agentStudentIds(agentId) {
    var ids = {};
    db.leads.forEach(function (l) {
      if (leadCurrentAgentId(l) === agentId && l.convertedStudentId) ids[l.convertedStudentId] = 1;
    });
    db.orders.forEach(function (o) {
      if (o.agentId === agentId && o.studentId) ids[o.studentId] = 1;
    });
    return Object.keys(ids);
  }
  function leadFollowUpsOf(leadId) {
    return db.leadFollowUps.filter(function (f) { return f.leadId === leadId; })
      .sort(function (a, b) { return a.at < b.at ? 1 : -1; });
  }
  function leadOrders(leadId) {
    return db.orders.filter(function (o) { return o.leadId === leadId; })
      .sort(function (a, b) { return a.createdAt < b.createdAt ? 1 : -1; });
  }
  function orderPayments(orderId) {
    return db.payments.filter(function (p) { return p.orderId === orderId; })
      .sort(function (a, b) { return a.createdAt < b.createdAt ? 1 : -1; });
  }
  function studentOfOrder(o) { return o && o.studentId ? student(o.studentId) : null; }
  function agentOfOrder(o) { return o && o.agentId ? agent(o.agentId) : null; }

  function orderSummary(o) {
    var s = studentOfOrder(o), a = agentOfOrder(o);
    return {
      order: o, student: s, agent: a,
      studentName: s ? s.name : o.studentName,
      agentName: a ? a.name : (o.agentId || '机构直营'),
      productName: o.productName,
      totalHours: o.totalHours, amount: o.amount, paidAmount: o.paidAmount, status: o.status
    };
  }

  /** 代理视角的客户列表投影：只含自己负责的线索 + 自己成交的学员 */
  function agentCustomers(query) {
    query = query || {};
    var self = (session.role === 'agent') ? sessionAgentId() : (query.agentId || defaultAgentId());
    if (session.role === 'agent') assertSelfAgent(self);
    var rows = [], seenStudent = {};
    db.leads.filter(function (l) {
      if (leadCurrentAgentId(l) !== self) return false;
      if (query.status && l.status !== query.status) return false;
      if (query.kw) {
        var hay = [l.name, l.phone, l.kidName, l.grade, l.book, l.intent, l.channel].join(' ').toLowerCase();
        if (hay.indexOf(String(query.kw).toLowerCase()) < 0) return false;
      }
      return true;
    }).forEach(function (l) {
      var s = l.convertedStudentId ? student(l.convertedStudentId) : null;
      if (s) seenStudent[s.id] = 1;
      var os = leadOrders(l.id);
      var deals = os.filter(function (o) { return o.status === ORDER.CREDITED; })
        .reduce(function (n, o) { return n + Number(o.amount || 0); }, 0);
      var rn = db.renewalOpportunities.filter(function (r) {
        return r.leadId === l.id && (r.status === RENEWAL.PENDING || r.status === RENEWAL.FOLLOWING);
      }).length;
      rows.push({
        leadId: l.id, studentId: s ? s.id : '', customerName: l.name, phone: l.phone,
        kidName: l.kidName || (s ? s.name : ''), grade: l.grade || (s ? s.grade : ''),
        book: l.book || (s ? s.book : ''), status: l.status, level: l.level,
        intent: l.intent, channel: l.channel,
        lastFollowAt: l.lastFollowAt, nextFollowAt: l.nextFollowAt,
        studentName: s ? s.name : '', remain: s ? s.remain : null,
        teacherName: s ? (s.teacherName || '未分配') : '',
        orderCount: os.length, dealAmount: deals, openRenewals: rn,
        feedbackCount: s ? agentFeedbacksForStudent(s.id).length : 0,
        updatedAt: l.updatedAt, converted: !!s
      });
    });
    /* 有订单但线索未转换的历史客户也进入列表，保证成交归属可追溯 */
    db.orders.filter(function (o) { return o.agentId === self; }).forEach(function (o) {
      if (seenStudent[o.studentId]) return;
      var s = student(o.studentId);
      if (!s) return;
      seenStudent[o.studentId] = 1;
      var os = db.orders.filter(function (x) { return x.studentId === s.id && x.agentId === self; });
      var deals = os.filter(function (x) { return x.status === ORDER.CREDITED; })
        .reduce(function (n, x) { return n + Number(x.amount || 0); }, 0);
      rows.push({
        leadId: o.leadId || '', studentId: s.id, customerName: s.parentName || s.name,
        phone: s.phone, kidName: s.name, grade: s.grade, book: s.book,
        status: LEAD.DEAL, level: '高', intent: '', channel: '历史成交',
        lastFollowAt: o.createdAt, nextFollowAt: '',
        studentName: s.name, remain: s.remain, teacherName: s.teacherName || '未分配',
        orderCount: os.length, dealAmount: deals,
        openRenewals: db.renewalOpportunities.filter(function (r) {
          return r.studentId === s.id && (r.status === RENEWAL.PENDING || r.status === RENEWAL.FOLLOWING);
        }).length,
        feedbackCount: agentFeedbacksForStudent(s.id).length,
        updatedAt: o.updatedAt || o.createdAt, converted: true
      });
    });
    return rows.sort(function (a, b) { return a.updatedAt < b.updatedAt ? 1 : -1; });
  }

  function agentOverview(agentId) {
    var self = session.role === 'agent' ? sessionAgentId() : (agentId || defaultAgentId());
    if (session.role === 'agent') assertSelfAgent(self);
    var rows = agentCustomers({ agentId: self });
    var byStatus = {};
    LEAD_STATUS.forEach(function (s) { byStatus[s] = 0; });
    rows.forEach(function (r) { if (byStatus[r.status] !== undefined) byStatus[r.status]++; });
    var credited = db.orders.filter(function (o) { return o.agentId === self && o.status === ORDER.CREDITED; });
    return {
      agent: agent(self), agentId: self, customers: rows.length,
      byStatus: byStatus,
      pendingLeads: rows.filter(function (r) { return r.status !== LEAD.DEAL && r.status !== LEAD.INVALID && r.status !== LEAD.CLOSED; }).length,
      deals: rows.filter(function (r) { return r.status === LEAD.DEAL || r.converted; }).length,
      orders: db.orders.filter(function (o) { return o.agentId === self; }).length,
      creditedOrders: credited.length,
      amount: credited.reduce(function (n, o) { return n + Number(o.amount || 0); }, 0),
      renewals: db.renewalOpportunities.filter(function (r) {
        return r.agentId === self && (r.status === RENEWAL.PENDING || r.status === RENEWAL.FOLLOWING);
      }).length,
      commission: agentCommissionPreview(self)
    };
  }

  /** 代理视角的客户详情：客户 + 跟进 + 订单 + 已发布反馈 + 续费机会；不含内部流水/收款明细 */
  function agentLeadView(leadId) {
    var l = assertLeadAccess(lead(leadId));
    var s = l.convertedStudentId ? student(l.convertedStudentId) : null;
    var os = leadOrders(l.id);
    return {
      lead: {
        id: l.id, code: l.code, name: l.name, phone: l.phone, kidName: l.kidName,
        grade: l.grade, book: l.book, channel: l.channel, status: l.status, level: l.level,
        intent: l.intent, intentProductId: l.intentProductId,
        lastFollowAt: l.lastFollowAt, nextFollowAt: l.nextFollowAt,
        sourceAgentId: leadSourceAgentId(l), currentAgentId: leadCurrentAgentId(l),
        agentId: leadCurrentAgentId(l), followerName: l.followerName,
        convertedStudentId: l.convertedStudentId, convertedAt: l.convertedAt
      },
      followUps: leadFollowUpsOf(l.id),
      orders: os.map(function (o) {
        return {
          id: o.id, type: o.type, productName: o.productName, totalHours: o.totalHours,
          amount: o.amount, paidAmount: o.paidAmount, status: o.status,
          createdAt: o.createdAt, creditedAt: o.creditedAt
        };
      }),
      student: s ? {
        id: s.id, name: s.name, grade: s.grade, book: s.book, school: s.school,
        teacherName: s.teacherName || '未分配', remain: s.remain, status: s.status
      } : null,
      renewals: db.renewalOpportunities.filter(function (r) {
        return (r.leadId === l.id || (s && r.studentId === s.id)) && r.status !== RENEWAL.CLOSED;
      }),
      feedbacks: s ? agentFeedbacksForStudent(s.id) : [],
      commission: agentCommissionPreview(leadCurrentAgentId(l), os),
      policy: { canSeePaymentDetail: false, note: '代理端不展示收款流水、内部日志与其他代理客户' }
    };
  }
  function agentStudentView(studentId) {
    var s = student(studentId);
    if (!s) throw bizError('STUDENT_NOT_FOUND', '学员不存在');
    var at = studentAttribution(studentId);
    if (session.role === 'agent' && at.agentId !== sessionAgentId()) {
      throw bizError('FORBIDDEN', '该学员不在你负责的客户范围内');
    }
    var l = at.leadId ? lead(at.leadId) : null;
    if (l) return agentLeadView(l.id);
    var os = db.orders.filter(function (o) { return o.studentId === studentId; });
    return {
      lead: null,
      followUps: [],
      orders: os.map(function (o) {
        return {
          id: o.id, type: o.type, productName: o.productName, totalHours: o.totalHours,
          amount: o.amount, paidAmount: o.paidAmount, status: o.status,
          createdAt: o.createdAt, creditedAt: o.creditedAt
        };
      }),
      student: {
        id: s.id, name: s.name, grade: s.grade, book: s.book, school: s.school,
        teacherName: s.teacherName || '未分配', remain: s.remain, status: s.status
      },
      renewals: db.renewalOpportunities.filter(function (r) {
        return r.studentId === studentId && r.status !== RENEWAL.CLOSED;
      }),
      feedbacks: agentFeedbacksForStudent(studentId),
      commission: agentCommissionPreview(at.agentId, os),
      policy: { canSeePaymentDetail: false }
    };
  }

  /* ---------------- 代理招募 ---------------- */
  function agentsOf(query) {
    query = query || {};
    return db.agents.filter(function (a) {
      if (query.status && a.status !== query.status) return false;
      if (query.kw) {
        var hay = [a.id, a.name, a.phone, a.wechat, a.type, a.ruleText].join(' ').toLowerCase();
        if (hay.indexOf(String(query.kw).toLowerCase()) < 0) return false;
      }
      return true;
    }).map(function (a) {
      var rows = agentCustomers({ agentId: a.id });
      var credited = db.orders.filter(function (o) { return o.agentId === a.id && o.status === ORDER.CREDITED; });
      return {
        agent: a, customers: rows.length,
        deals: rows.filter(function (r) { return r.converted; }).length,
        orders: db.orders.filter(function (o) { return o.agentId === a.id; }).length,
        amount: credited.reduce(function (n, o) { return n + Number(o.amount || 0); }, 0),
        commission: agentCommissionPreview(a.id)
      };
    });
  }
  /** 招募代理：先建档为待审核，审核通过后才能获客 */
  function recruitAgent(input) {
    assertCan('agent.recruit');
    input = input || {};
    var name = String(input.name || '').trim();
    var phone = String(input.phone || '').trim();
    if (!name) throw bizError('NAME_REQUIRED', '请填写代理姓名');
    if (!/^\d{6,}$/.test(phone)) throw bizError('PHONE_INVALID', '请填写有效的代理手机号');
    if (db.agents.some(function (a) { return a.phone === phone; })) {
      throw bizError('AGENT_PHONE_DUP', '该手机号已登记为代理');
    }
    var ruleText = String(input.ruleText || '').trim();
    if (!ruleText) throw bizError('RULE_REQUIRED', '请填写佣金规则（本轮只做展示，不做结算）');
    var id = 'A' + pad(seq('AG', 3), 3);
    var a = {
      id: id, name: name, phone: phone, wechat: String(input.wechat || '').trim(),
      type: AGENT_TYPES.indexOf(input.type) >= 0 ? input.type : '个人代理',
      status: '待审核', recruiterId: session.operatorId || operatorNameNow(),
      ownerId: session.operatorId || operatorNameNow(),
      ruleType: input.ruleType || 'none', ruleValue: Number(input.ruleValue) || 0,
      ruleText: ruleText, remark: String(input.remark || ''),
      createdBy: operatorNameNow(), approvedBy: '', approvedAt: '',
      createdAt: stamp(), updatedAt: stamp()
    };
    db.agents.push(a);
    agentLog(id, 'CREATED', '代理招募建档，待审核：' + name + '（' + ruleText + '）', '', '待审核');
    save();
    return a;
  }
  function reviewAgent(agentId, opt) {
    assertCan('agent.review');
    opt = opt || {};
    var a = agent(agentId);
    if (!a) throw bizError('AGENT_NOT_FOUND', '代理不存在');
    var pass = opt.pass !== false;
    if (!pass && !String(opt.remark || '').trim()) throw bizError('REMARK_REQUIRED', '驳回代理必须填写原因');
    var from = a.status;
    a.status = pass ? '启用' : '停用';
    a.approvedBy = operatorNameNow();
    a.approvedAt = stamp();
    a.remark = String(opt.remark || a.remark || '');
    a.updatedAt = stamp();
    agentLog(a.id, pass ? 'APPROVED' : 'REJECTED',
      (pass ? '审核通过' : '审核驳回') + (a.remark ? '：' + a.remark : ''), from, a.status);
    save();
    return a;
  }
  function setAgentStatus(agentId, status, opt) {
    assertCan('agent.manage');
    opt = opt || {};
    if (AGENT_STATUS.indexOf(status) < 0) throw bizError('STATUS_INVALID', '代理状态不合法');
    var a = agent(agentId);
    if (!a) throw bizError('AGENT_NOT_FOUND', '代理不存在');
    if (status === '停用' && !String(opt.remark || '').trim()) throw bizError('REMARK_REQUIRED', '停用代理必须填写原因');
    var from = a.status;
    a.status = status;
    a.remark = String(opt.remark || a.remark || '');
    a.updatedAt = stamp();
    agentLog(a.id, 'STATUS_CHANGED', (opt.remark || '状态变更'), from, status);
    save();
    return a;
  }
  function agentLogsOf(agentId) {
    return db.agentLogs.filter(function (l) { return l.agentId === agentId; })
      .sort(function (a, b) { return a.at < b.at ? 1 : -1; });
  }

  /* ---------------- 客户线索与跟进 ---------------- */
  function leads(query) {
    query = query || {};
    return db.leads.filter(function (l) {
      if (query.status && l.status !== query.status) return false;
      if (query.agentId && leadCurrentAgentId(l) !== query.agentId) return false;
      if (query.sourceAgentId && leadSourceAgentId(l) !== query.sourceAgentId) return false;
      if (query.followerId && l.followerId !== query.followerId) return false;
      if (query.kw) {
        var hay = [l.id, l.name, l.phone, l.kidName, l.grade, l.book, l.intent, l.channel]
          .join(' ').toLowerCase();
        if (hay.indexOf(String(query.kw).toLowerCase()) < 0) return false;
      }
      return true;
    }).map(function (l) {
      var s = l.convertedStudentId ? student(l.convertedStudentId) : null;
      var os = leadOrders(l.id);
      return {
        lead: l, student: s,
        agent: leadCurrentAgentId(l) ? agent(leadCurrentAgentId(l)) : null,
        sourceAgent: leadSourceAgentId(l) ? agent(leadSourceAgentId(l)) : null,
        sourceAgentId: leadSourceAgentId(l), currentAgentId: leadCurrentAgentId(l),
        orders: os.length,
        credited: os.filter(function (o) { return o.status === ORDER.CREDITED; }).length,
        openRenewals: db.renewalOpportunities.filter(function (r) {
          return (r.leadId === l.id || (s && r.studentId === s.id)) &&
            (r.status === RENEWAL.PENDING || r.status === RENEWAL.FOLLOWING);
        }).length
      };
    }).sort(function (a, b) { return a.lead.updatedAt < b.lead.updatedAt ? 1 : -1; });
  }
  function leadRowCounts() {
    var m = {};
    LEAD_STATUS.forEach(function (s) { m[s] = 0; });
    db.leads.forEach(function (l) { m[l.status] = (m[l.status] || 0) + 1; });
    return m;
  }
  function leadView(leadId) {
    var l = lead(leadId);
    if (!l) throw bizError('LEAD_NOT_FOUND', '客户线索不存在');
    if (session.role === 'agent') return agentLeadView(leadId);
    if (session.role === 'parent' || session.role === 'teacher') {
      throw bizError('FORBIDDEN', '当前身份不能查看客户线索');
    }
    var s = l.convertedStudentId ? student(l.convertedStudentId) : null;
    return {
      lead: l, student: s, parent: s && s.parent ? parent(s.parent) : null,
      agent: leadCurrentAgentId(l) ? agent(leadCurrentAgentId(l)) : null,
      sourceAgent: leadSourceAgentId(l) ? agent(leadSourceAgentId(l)) : null,
      disputes: leadDisputesOf({ leadId: l.id, status: DISPUTE.OPEN }),
      followUps: leadFollowUpsOf(l.id),
      logs: db.leadLogs.filter(function (x) { return x.leadId === l.id; })
        .sort(function (a, b) { return a.at < b.at ? 1 : -1; }),
      orders: leadOrders(l.id).map(orderSummary),
      renewals: db.renewalOpportunities.filter(function (r) {
        return r.leadId === l.id || (s && r.studentId === s.id);
      }),
      feedbacks: s ? (session.role === 'parent' ? parentFeedbacks(s.parent) : learningFeedbacksOfStudent(s.id)) : []
    };
  }
  /* ---------------- 重复报备归属争议 ---------------- */
  function createLeadDispute(leadId, claimantAgentId, originalAgentId, reason, input) {
    input = input || {};
    var d = {
      id: nextId('DSP', 'DSP', 3), leadId: leadId,
      claimantAgentId: claimantAgentId || '', originalAgentId: originalAgentId || '',
      reason: String(reason || '').trim() || '重复报备，归属存在争议',
      evidence: String(input.evidence || input.remark || ''),
      status: DISPUTE.OPEN, handledBy: '', result: '', resolvedToAgentId: '',
      requestedBy: operatorNameNow(), createdAt: stamp(), resolvedAt: ''
    };
    db.leadDisputes.push(d);
    leadLog(leadId, 'DISPUTE_CREATED',
      '重复报备争议 ' + d.id + '：申领代理 ' + (claimantAgentId || '—') +
      ' / 原归属 ' + (originalAgentId || '机构直营') + '；事由：' + d.reason, '', DISPUTE.OPEN);
    save();
    return d;
  }
  function leadDisputesOf(query) {
    query = query || {};
    return db.leadDisputes.filter(function (x) {
      if (query.leadId && x.leadId !== query.leadId) return false;
      if (query.status && x.status !== query.status) return false;
      if (query.agentId && (x.claimantAgentId !== query.agentId && x.originalAgentId !== query.agentId)) return false;
      return true;
    }).map(function (x) {
      return {
        dispute: x, lead: lead(x.leadId),
        claimantAgent: agent(x.claimantAgentId), originalAgent: agent(x.originalAgentId),
        resolvedAgent: x.resolvedToAgentId ? agent(x.resolvedToAgentId) : null
      };
    }).sort(function (a, b) { return a.dispute.createdAt < b.dispute.createdAt ? 1 : -1; });
  }
  /** 管理员裁定归属争议：可判给申领代理 / 维持原归属；结果写日志，永久可追溯 */
  function resolveLeadDispute(disputeId, opt) {
    assertCan('lead.assign');
    opt = opt || {};
    var d = db.leadDisputes.filter(function (x) { return x.id === disputeId; })[0];
    if (!d) throw bizError('DISPUTE_NOT_FOUND', '归属争议不存在');
    if (d.status === DISPUTE.RESOLVED) throw bizError('DISPUTE_RESOLVED', '该争议已裁定，不能重复处理');
    var result = String(opt.result || '').trim();
    if (!result) throw bizError('RESULT_REQUIRED', '裁定争议必须填写处理结果');
    var l = lead(d.leadId);
    if (!l) throw bizError('LEAD_NOT_FOUND', '争议关联的线索不存在');
    var toAgent = opt.assignToAgentId === undefined ? d.claimantAgentId : String(opt.assignToAgentId || '');
    if (toAgent) {
      var a = agent(toAgent);
      if (!a) throw bizError('AGENT_NOT_FOUND', '裁定的目标代理不存在');
      if (a.status !== '启用') throw bizError('AGENT_DISABLED', '目标代理「' + a.name + '」不是启用状态');
    }
    var fromAgent = leadCurrentAgentId(l);
    l.currentAgentId = toAgent || '';
    l.agentId = l.currentAgentId;                 /* 旧页面兼容镜像 */
    l.updatedAt = stamp();
    d.status = DISPUTE.RESOLVED;
    d.handledBy = operatorNameNow();
    d.result = result;
    d.resolvedToAgentId = toAgent;
    d.resolvedAt = stamp();
    leadLog(l.id, 'DISPUTE_RESOLVED',
      '归属争议 ' + d.id + ' 裁定：' + result + '；维护归属 ' + (fromAgent || '机构直营') +
      ' → ' + (toAgent || '机构直营') + '（首次获客归属 ' + (leadSourceAgentId(l) || '机构直营') + ' 不变）',
      fromAgent, l.currentAgentId);
    save();
    return { dispute: d, lead: l };
  }

  function createLead(input) {
    assertCan('lead.create');
    input = input || {};
    var name = String(input.name || '').trim();
    var phone = String(input.phone || '').trim();
    if (!name) throw bizError('NAME_REQUIRED', '请填写家长姓名');
    if (!/^1\d{10}$/.test(phone)) throw bizError('PHONE_INVALID', '请填写 11 位家长手机号');
    var dup = db.leads.filter(function (l) {
      return l.phone === phone && l.status !== LEAD.INVALID && l.status !== LEAD.CLOSED;
    })[0];
    var claimant = session.role === 'agent' ? sessionAgentId() : (input.agentId || '');
    if (dup) {
      var owner = leadCurrentAgentId(dup);
      if (claimant && claimant !== owner) {
        var dispute = createLeadDispute(dup.id, claimant, owner,
          input.disputeReason || input.remark || '代理重复报备同一客户', input);
        throw bizError('LEAD_DISPUTE',
          '该手机号已有未关闭线索（' + dup.id + '，' + dup.name + '，当前维护 ' +
          ((agent(owner) || {}).name || '机构直营') + '）。已生成归属争议 ' + dispute.id +
          '，请等待管理员裁定，不要重复录入', { lead: dup, dispute: dispute });
      }
      throw bizError('LEAD_DUP', '该手机号已有未关闭线索（' + dup.id + '，' + dup.name + '）', { lead: dup });
    }

    var selfAgent = '';
    if (session.role === 'agent') {
      selfAgent = assertSelfAgent(sessionAgentId());
      assertAgentEnabled(selfAgent);
    } else if (input.agentId) {
      var a = agent(input.agentId);
      if (!a) throw bizError('AGENT_NOT_FOUND', '代理不存在');
      if (a.status !== '启用') throw bizError('AGENT_DISABLED', '代理「' + a.name + '」不是启用状态，不能录入客户');
      selfAgent = a.id;
    }
    var channel = String(input.channel || '其他');
    if (!dictionaryHas('lead_channel', channel)) {
      throw bizError('DICT_INVALID', '获客渠道「' + channel + '」不在数据字典中，请先在字典管理中维护');
    }
    var id = nextLeadId();
    var followerId = session.role === 'agent' ? selfAgent : (input.followerId || session.operatorId || '');
    var l = {
      id: id, code: id, name: name, phone: phone,
      kidName: String(input.kidName || '').trim(), grade: String(input.grade || '').trim(),
      book: String(input.book || '').trim(), channel: channel,
      sourceAgentId: selfAgent, currentAgentId: selfAgent, agentId: selfAgent,
      followerId: followerId, followerName: input.followerName || followerId,
      intent: String(input.intent || ''), intentProductId: input.intentProductId || '',
      status: LEAD.NEW, level: LEAD_LEVELS.indexOf(input.level) >= 0 ? input.level : '中',
      lastFollowAt: '', nextFollowAt: input.nextFollowAt || '',
      convertedStudentId: '', convertedAt: '',
      createdBy: operatorNameNow(), createdAt: stamp(), updatedAt: stamp(),
      invalidReason: '', remark: String(input.remark || '')
    };
    db.leads.push(l);
    leadLog(id, LEAD_ACTION.CREATED,
      '线索建立（' + l.channel + '）' + (selfAgent ? '，首次获客代理 ' + (agent(selfAgent) || {}).name : '，机构直营'),
      '', LEAD.NEW);
    recordAudit({
      module: '客户管理', action: '新建客户线索', resourceType: 'lead', resourceId: l.id,
      resourceName: l.name, beforeData: null,
      afterData: { name: l.name, phone: l.phone, channel: l.channel, agentId: l.currentAgentId, status: l.status },
      reason: input.remark || '录入新客户线索', result: '成功'
    });
    if (selfAgent) {
      notify('LEAD_ASSIGNED', {
        leadName: l.name, agentId: selfAgent, businessId: l.id,
        link: 'agent/customer-detail.html?id=' + l.id
      });
    }
    save();
    return l;
  }
  function addLeadFollowUp(leadId, input) {
    assertCan('lead.follow');
    var l = assertLeadAccess(lead(leadId));
    if ([LEAD.DEAL, LEAD.INVALID, LEAD.CLOSED].indexOf(l.status) >= 0) {
      throw bizError('LEAD_CLOSED', '线索当前为「' + l.status + '」，不能再新增跟进');
    }
    input = input || {};
    var content = String(input.content || '').trim();
    if (!content) throw bizError('CONTENT_REQUIRED', '请填写本次跟进内容');
    if (input.type && !dictionaryHas('follow_type', input.type)) {
      throw bizError('DICT_INVALID', '跟进方式「' + input.type + '」不在数据字典中，请先维护字典');
    }
    var to = input.status || '';
    if (to && to === l.status) to = '';
    if (to) {
      var allowed = LEAD_NEXT[l.status] || [];
      if (allowed.indexOf(to) < 0) {
        throw bizError('STATUS_TRANSITION_INVALID',
          '线索不能从「' + l.status + '」直接变为「' + to + '」，允许：' +
          (allowed.length ? allowed.join('、') : '无（终态）'));
      }
      if ((to === LEAD.INVALID || to === LEAD.CLOSED) && !String(input.invalidReason || input.reason || '').trim()) {
        throw bizError('REASON_REQUIRED', '标记为「' + to + '」必须填写原因');
      }
    } else if (l.status === LEAD.NEW || l.status === LEAD.TO_CONTACT) {
      to = LEAD.FOLLOWING;
    }
    var from = l.status;
    var f = {
      id: nextId('LF', 'LF', 3), leadId: l.id,
      type: input.type || '电话', content: content,
      result: String(input.result || ''), nextAt: input.nextAt || '',
      by: operatorNameNow(), byId: session.operatorId || '', at: stamp()
    };
    db.leadFollowUps.push(f);
    l.lastFollowAt = f.at;
    l.nextFollowAt = input.nextAt || l.nextFollowAt;
    l.updatedAt = f.at;
    if (to && to !== from) {
      l.status = to;
      if (to === LEAD.INVALID || to === LEAD.CLOSED) l.invalidReason = input.invalidReason || input.reason || '';
      leadLog(l.id, LEAD_ACTION.STATUS_CHANGED, '跟进后状态变更：' + content, from, to);
    } else {
      leadLog(l.id, LEAD_ACTION.FOLLOWED, '新增跟进：' + content, l.status, l.status);
    }
    save();
    return { lead: l, followUp: f };
  }
  /** 意向转化：至少一条跟进记录，且只能从「待联系 / 跟进中」进入「意向明确」 */
  function markLeadIntent(leadId, opt) {
    assertCan('lead.convert');
    opt = opt || {};
    var l = assertLeadAccess(lead(leadId));
    if (l.status === LEAD.INTENT) return l;
    if (l.status !== LEAD.TO_CONTACT && l.status !== LEAD.FOLLOWING) {
      throw bizError('STATUS_NOT_ALLOWED',
        '线索当前为「' + l.status + '」，请先录入跟进并把状态推进到「待联系 / 跟进中」');
    }
    if (!leadFollowUpsOf(l.id).length) throw bizError('FOLLOWUP_REQUIRED', '转为意向之前必须至少录入一条跟进记录');
    var from = l.status;
    l.status = LEAD.INTENT;
    l.intent = String(opt.intent || l.intent || '');
    l.intentProductId = opt.productId || l.intentProductId || '';
    if (opt.level && LEAD_LEVELS.indexOf(opt.level) >= 0) l.level = opt.level;
    l.updatedAt = stamp();
    leadLog(l.id, LEAD_ACTION.INTENT, '意向明确：' + (l.intent || '待选套餐') +
      (l.intentProductId ? '（' + (product(l.intentProductId) || {}).name + '）' : ''), from, l.status);
    save();
    return l;
  }
  function assignLead(leadId, input) {
    assertCan('lead.assign');
    input = input || {};
    var l = lead(leadId);
    if (!l) throw bizError('LEAD_NOT_FOUND', '客户线索不存在');
    var reason = String(input.reason || '').trim();
    if (!reason) throw bizError('REASON_REQUIRED', '调整客户归属必须填写原因');
    var toAgent = input.agentId === undefined ? leadCurrentAgentId(l) : String(input.agentId || '');
    if (toAgent) {
      var a = agent(toAgent);
      if (!a) throw bizError('AGENT_NOT_FOUND', '目标代理不存在');
      if (a.status !== '启用') throw bizError('AGENT_DISABLED', '目标代理「' + a.name + '」不是启用状态');
    }
    var toFollower = input.followerId || l.followerId;
    var from = { agentId: leadCurrentAgentId(l), followerId: l.followerId, sourceAgentId: leadSourceAgentId(l) };
    /* 只改当前维护归属；首次获客归属 sourceAgentId 永不覆盖 */
    l.currentAgentId = toAgent || '';
    l.agentId = l.currentAgentId;              /* 旧页面兼容镜像 */
    l.followerId = toFollower || '';
    l.followerName = input.followerName || toFollower || '';
    l.updatedAt = stamp();
    leadLog(l.id, LEAD_ACTION.ASSIGNED,
      '维护归属调整：代理 ' + (from.agentId || '机构直营') + ' → ' + (l.currentAgentId || '机构直营') +
      '；维护人 ' + (from.followerId || '未指定') + ' → ' + (l.followerId || '未指定') +
      '；首次获客归属 ' + (from.sourceAgentId || '机构直营') + ' 不变；原因：' + reason,
      from.agentId + '/' + from.followerId, l.currentAgentId + '/' + l.followerId);
    recordAudit({
      module: '客户管理', action: '客户归属移交', resourceType: 'lead', resourceId: l.id,
      resourceName: l.name, beforeData: from,
      afterData: { agentId: l.currentAgentId, followerId: l.followerId, sourceAgentId: from.sourceAgentId },
      reason: reason, result: '成功'
    });
    if (from.agentId !== l.currentAgentId) {
      notify('LEAD_TRANSFER', {
        leadName: l.name, agentId: l.currentAgentId || from.agentId,
        agentName: (agent(l.currentAgentId) || {}).name || '机构直营',
        businessId: l.id, link: 'agent/customer-detail.html?id=' + l.id
      });
    }
    save();
    return l;
  }

  /* ---------------- 建档 + 订单（原子） ---------------- */
  function findOrCreateParent(leadObj, opt) {
    var phone = String(opt.phone || leadObj.phone || '').trim();
    var exist = db.parents.filter(function (p) { return p.phone === phone; })[0];
    if (exist) return exist;
    var p = {
      id: nextParentId(), name: opt.parentName || leadObj.name, phone: phone,
      wechat: String(opt.wechat || ''), relation: opt.relation || '家长',
      kids: [], first: TODAY, status: '启用',
      createdAt: stamp(), updatedAt: stamp()
    };
    db.parents.push(p);
    return p;
  }
  function findOrCreateStudent(leadObj, parentObj, opt) {
    if (leadObj.convertedStudentId) {
      var linked = student(leadObj.convertedStudentId);
      if (linked) return linked;
    }
    var name = String(opt.studentName || leadObj.kidName || '').trim();
    if (!name) throw bizError('STUDENT_NAME_REQUIRED', '请填写学员姓名后再提交报名订单');
    var dup = db.students.filter(function (s) { return s.name === name && s.parent === parentObj.id; })[0];
    if (dup) {
      if (leadObj.convertedStudentId !== dup.id) {
        leadObj.convertedStudentId = dup.id;
        leadObj.convertedAt = leadObj.convertedAt || stamp();
      }
      return dup;
    }
    var s = {
      id: nextStudentId(), name: name, gender: opt.gender || '',
      grade: String(opt.grade || leadObj.grade || '').trim(),
      parent: parentObj.id, parentName: parentObj.name, phone: parentObj.phone,
      teacher: '', teacherName: '未分配',
      product: '', remain: 0,                       /* 新建学员永远 0 课时 */
      status: '在读', created: TODAY, book: String(opt.book || leadObj.book || '').trim(),
      school: String(opt.school || ''), source: leadObj.channel || '代理推荐',
      agentId: leadCurrentAgentId(leadObj) || '', sourceLeadId: leadObj.id,
      words: { total: 0, mastered: 0, review: 0 },
      lastCourse: '', lastContent: '',
      createdAt: stamp(), updatedAt: stamp()
    };
    db.students.push(s);
    parentObj.kids = parentObj.kids || [];
    if (parentObj.kids.indexOf(s.id) < 0) parentObj.kids.push(s.id);
    /* 家长—学员关系表是家长端投影的唯一口径；同时保留旧 kids / parent 字段做兼容读取 */
    db.parentStudents.push({
      id: nextId('PS', 'PS', 3), parentId: parentObj.id, studentId: s.id,
      relationship: parentObj.relation || '家长', isPrimaryContact: true,
      createdBy: operatorNameNow(), createdAt: stamp()
    });
    if (leadObj.convertedStudentId !== s.id) {
      leadObj.convertedStudentId = s.id;
      leadObj.convertedAt = stamp();
    }
    return s;
  }
  function createOrderRecord(input) {
    var p = product(input.productId);
    if (!p) throw bizError('PRODUCT_NOT_FOUND', '套餐不存在');
    if (p.status === '停用') throw bizError('PRODUCT_DISABLED', '套餐「' + p.name + '」已停用，不能下单');
    var hours = Number(p.hours) || 0;
    if (hours <= 0) throw bizError('PRODUCT_INVALID', '套餐课时数不合法');
    var o = {
      id: nextOrderId(), code: '',
      type: input.type || ORDER_TYPE.NEW,
      leadId: input.leadId || '', studentId: input.studentId || '',
      parentId: input.parentId || '', agentId: input.agentId || '',
      followerId: input.followerId || '', ownerAgentId: input.agentId || '',
      productId: p.id, productName: p.name, hours: hours, gift: Number(p.gift) || 0,
      totalHours: hours + (Number(p.gift) || 0),
      amount: Number(p.amount || p.price) || 0, paidAmount: 0,
      refundedAmount: 0, partialRefund: false, creditedHours: 0,
      status: ORDER.PENDING, payMethod: '', paymentId: '', lessonAccountId: '',
      creditedAt: '', creditBy: '', reviewedBy: '', reviewedAt: '',
      renewalOpportunityId: input.renewalOpportunityId || '',
      createdBy: operatorNameNow(), createdAt: stamp(), updatedAt: stamp(),
      cancelReason: '', remark: String(input.remark || '')
    };
    o.code = o.id;
    db.orders.push(o);
    orderLog(o.id, 'CREATED',
      '提交报名订单：' + p.name + ' / ' + o.totalHours + ' 课时 / ¥' + o.amount +
      '（未收款，不产生课时）', '', ORDER.PENDING);
    return o;
  }
  /** 代理提交新签订单：线索必须已转意向；学员/家长不存在时在同一事务内建档 */
  function submitEnrollmentOrder(input) {
    assertCan('order.create');
    input = input || {};
    var l = assertLeadAccess(lead(input.leadId));
    if (l.status !== LEAD.INTENT) {
      throw bizError('LEAD_STATUS_INVALID',
        '线索当前为「' + l.status + '」，只有「意向明确」的客户才能提交报名订单');
    }
    var agentId = session.role === 'agent' ? assertSelfAgent(sessionAgentId())
      : (input.agentId || leadCurrentAgentId(l));
    if (agentId) assertAgentEnabled(agentId);
    var snap = JSON.stringify(db);
    try {
      var p = product(input.productId || l.intentProductId);
      if (!p) throw bizError('PRODUCT_REQUIRED', '请选择报名套餐');
      var parentObj = findOrCreateParent(l, input.parent || input);
      var stu = findOrCreateStudent(l, parentObj, input.student || input);
      var o = createOrderRecord({
        type: ORDER_TYPE.NEW, leadId: l.id, studentId: stu.id, parentId: parentObj.id,
        agentId: agentId, followerId: l.followerId, productId: p.id,
        remark: input.remark || ''
      });
      l.updatedAt = stamp();
      leadLog(l.id, LEAD_ACTION.ORDERED,
        '提交报名订单 ' + o.id + '：' + p.name + '，金额 ¥' + o.amount + '，待管理员审核收款',
        l.status, l.status);
      recordAudit({
        module: '报名收款', action: '提交报名订单', resourceType: 'order', resourceId: o.id,
        resourceName: stu.name + ' / ' + p.name, beforeData: null,
        afterData: { studentId: stu.id, parentId: parentObj.id, agentId: o.agentId, amount: o.amount, status: o.status },
        reason: input.remark || '代理/教务提交报名订单', result: '成功'
      });
      notify('ORDER_REVIEW', {
        orderNo: o.id, studentName: stu.name, amount: o.amount, businessId: o.id,
        link: 'admin/order-list.html?id=' + o.id
      });
      save();
      return orderView(o.id);
    } catch (e) {
      db = JSON.parse(snap);
      throw bizError(e.code || 'ORDER_SUBMIT_FAILED',
        '报名订单提交失败，已回滚（不保留孤立学员档案）：' + e.message, e.data);
    }
  }

  /* ---------------- 收款确认 → 课时入账 ---------------- */
  function orderOf(id) {
    var o = order(id);
    if (!o) throw bizError('ORDER_NOT_FOUND', '订单不存在');
    return o;
  }
  function orderView(id) {
    var o = assertOrderAccess(orderOf(id));
    var s = studentOfOrder(o), a = agentOfOrder(o), l = o.leadId ? lead(o.leadId) : null;
    return {
      order: o, student: s, agent: a, lead: l,
      parent: o.parentId ? parent(o.parentId) : (s && s.parent ? parent(s.parent) : null),
      payments: orderPayments(o.id), logs: orderLogsOf(o.id),
      account: o.lessonAccountId ? account(o.lessonAccountId) : null,
      renewal: o.renewalOpportunityId ? renewal(o.renewalOpportunityId) : null
    };
  }
  function orderLogsOf(orderId) {
    return db.orderLogs.filter(function (x) { return x.orderId === orderId; })
      .sort(function (a, b) { return a.at < b.at ? 1 : -1; });
  }
  function orderRows(query) {
    query = query || {};
    var selfAgent = session.role === 'agent' ? sessionAgentId() : '';
    var selfParent = session.role === 'parent' ? session.parentId : '';
    var parentKids = selfParent ? parentStudents(selfParent).map(function (s) { return s.id; }) : [];
    return db.orders.filter(function (o) {
      if (selfAgent && o.agentId !== selfAgent) return false;
      if (selfParent && o.parentId !== selfParent && parentKids.indexOf(o.studentId) < 0) return false;
      if (query.status && o.status !== query.status) return false;
      if (query.type && o.type !== query.type) return false;
      if (query.agentId && o.agentId !== query.agentId) return false;
      if (query.studentId && o.studentId !== query.studentId) return false;
      if (query.kw) {
        var s = student(o.studentId);
        var hay = [o.id, s ? s.name : '', o.productName, o.agentId, o.status].join(' ').toLowerCase();
        if (hay.indexOf(String(query.kw).toLowerCase()) < 0) return false;
      }
      return true;
    }).map(orderSummary).sort(function (a, b) {
      return a.order.createdAt < b.order.createdAt ? 1 : -1;
    });
  }
  function reviewOrder(id, opt) {
    assertCan('order.review');
    opt = opt || {};
    var o = orderOf(id);
    if (o.status !== ORDER.PENDING) throw bizError('ORDER_STATUS_INVALID', '订单当前为「' + o.status + '」，只有「待审核」可审核');
    var pass = opt.pass !== false;
    var from = o.status;
    if (!pass) {
      var reason = String(opt.reason || '').trim();
      if (!reason) throw bizError('REASON_REQUIRED', '驳回订单必须填写原因');
      o.status = ORDER.CANCELLED;
      o.cancelReason = reason;
      o.reviewedBy = operatorNameNow();
      o.reviewedAt = stamp();
      o.updatedAt = o.reviewedAt;
      orderLog(o.id, 'REJECTED', '审核驳回：' + reason, from, o.status);
      var restored = restoreRenewalOpportunity(o, '审核驳回');
      if (restored) {
        orderLog(o.id, 'RENEWAL_RESTORED',
          '关联续费机会 ' + restored.id + ' 恢复为「待跟进」，跟进记录保留，可重新选套餐提交',
          o.status, o.status);
      }
      recordAudit({
        module: '报名收款', action: '审核报名订单（驳回）', resourceType: 'order', resourceId: o.id,
        resourceName: o.id, beforeData: { status: from }, afterData: { status: o.status },
        reason: reason, result: '成功'
      });
      save();
      return o;
    }
    o.status = ORDER.REVIEWED;
    o.reviewedBy = operatorNameNow();
    o.reviewedAt = stamp();
    o.updatedAt = o.reviewedAt;
    orderLog(o.id, 'REVIEWED', '审核通过，待确认收款（未收款不产生课时）', from, o.status);
    recordAudit({
      module: '报名收款', action: '审核报名订单（通过）', resourceType: 'order', resourceId: o.id,
      resourceName: o.id, beforeData: { status: from }, afterData: { status: o.status },
      reason: opt.reason || '订单信息审核通过', result: '成功'
    });
    save();
    return o;
  }
  function syncStudentRemain(studentId) {
    var s = student(studentId);
    if (!s) return 0;
    var sum = accountsOfStudent(s.id).reduce(function (n, a) { return n + Number(a.remain || 0); }, 0);
    s.remain = sum;
    return sum;
  }
  /** 续费机会恢复统一入口：订单取消 / 审核驳回 / 退款共用，保留跟进记录与备注 */
  function restoreRenewalOpportunity(o, actionLabel) {
    if (!o || !o.renewalOpportunityId) return null;
    var rn = renewal(o.renewalOpportunityId);
    if (!rn) return null;
    if (rn.status !== RENEWAL.ORDERED && rn.renewalOrderId !== o.id) return null;
    rn.status = RENEWAL.PENDING;
    rn.renewalOrderId = '';
    rn.restoredFromOrderId = o.id;
    rn.restoredAt = stamp();
    rn.updatedAt = rn.restoredAt;
    rn.remark = (rn.remark ? rn.remark + '；' : '') +
      '订单 ' + o.id + ' ' + (actionLabel || '取消') + '，续费机会恢复为「待跟进」（跟进记录保留）';
    return rn;
  }
  /** 课时账户按「已确认收款」增量创建；未确认收款前不存在账户 */
  function ensureAccountForOrder(o, stu, p) {
    var acc = o.lessonAccountId ? account(o.lessonAccountId) : null;
    if (acc) return acc;
    acc = {
      id: 'ACC-' + TODAY.slice(0, 4) + '-' + pad(seq('ACC', 4), 4),
      student: stu.name, studentId: stu.id, parent: stu.parentName, parentId: stu.parent,
      product: p.name, buy: 0, gift: 0, used: 0, adjust: 0, remain: 0,
      hours: 0, gift: 0,
      valid: addMonths(TODAY, p.validMonths || 12),
      expireAt: addMonths(TODAY, p.validMonths || 12),
      status: '已用完',
      orderId: o.id, createdAt: stamp(), updatedAt: stamp()
    };
    db.accounts.push(acc);
    o.lessonAccountId = acc.id;
    return acc;
  }
  /**
   * 部分收款折算课时：按订单「金额/总课时」单价折算，非最后一笔向下取整，
   * 尾差（含赠送课时）全部计入最后一笔，保证累计课时 = 订单课时。
   */
  function hoursSplitForPayment(o, acc, amount) {
    var totalHours = Number(o.totalHours) || 0;
    var orderAmount = Number(o.amount) || 0;
    var already = Number(o.creditedHours) || 0;
    var cum = (Number(o.paidAmount) || 0) + Number(amount || 0);
    var isFinal = cum >= orderAmount - 0.005;
    var hoursThis;
    if (isFinal) {
      hoursThis = Math.max(0, totalHours - already);
    } else {
      var unit = totalHours > 0 ? orderAmount / totalHours : 0;
      hoursThis = unit > 0 ? Math.floor(Number(amount) / unit + 1e-9) : 0;
      if (hoursThis > totalHours - already) hoursThis = Math.max(0, totalHours - already);
    }
    var giftThis = isFinal ? Math.max(0, (Number(o.gift) || 0) - (Number(acc.gift) || 0)) : 0;
    if (giftThis > hoursThis) giftThis = hoursThis;
    return { isFinal: isFinal, hoursThis: hoursThis, purchaseThis: hoursThis - giftThis, giftThis: giftThis };
  }
  /** 确认一笔收款（登记 → payments + 课时入账 + 订单状态推进），事务由调用方包裹 */
  function applyPaymentConfirmation(o, reg, opt) {
    opt = opt || {};
    var stu = student(o.studentId);
    if (!stu) throw bizError('STUDENT_NOT_FOUND', '订单关联学员不存在，无法入账');
    var p = product(o.productId) || { name: o.productName, validMonths: 12 };
    var from = o.status;
    var pay = {
      id: nextId('PY', 'PY', 3), orderId: o.id, amount: Number(reg.amount) || 0,
      method: PAY_METHODS.indexOf(reg.method) >= 0 ? reg.method : (reg.method || '微信'),
      status: PAY.CONFIRMED, confirmedBy: operatorNameNow(), confirmedAt: stamp(),
      note: String(reg.note || opt.note || '管理员确认收款'), createdAt: stamp(), updatedAt: stamp(),
      registrationId: reg.id
    };
    db.payments.push(pay);
    reg.status = PAY_REG.CONFIRMED;
    reg.paymentId = pay.id;
    reg.confirmedBy = pay.confirmedBy;
    reg.confirmedAt = pay.confirmedAt;
    reg.updatedAt = pay.confirmedAt;

    var acc = ensureAccountForOrder(o, stu, p);
    var split = hoursSplitForPayment(o, acc, pay.amount);
    var beforeH = Number(acc.hours) || 0;
    var beforeG = Number(acc.gift) || 0;
    if (split.purchaseThis > 0) {
      pushFlow({
        student: stu.name, studentId: stu.id, account: acc.id,
        type: '购买入账', delta: split.purchaseThis, before: beforeH, after: beforeH + split.purchaseThis,
        ref: o.id + ' 收款确认（' + pay.amount + ' 元）', note: '第 ' + (db.payments.filter(function (x) { return x.orderId === o.id && x.status === PAY.CONFIRMED; }).length) + ' 笔收款按单价折算入账',
        orderId: o.id, paymentId: pay.id
      });
    }
    if (split.giftThis > 0) {
      pushFlow({
        student: stu.name, studentId: stu.id, account: acc.id,
        type: '赠送入账', delta: split.giftThis, before: beforeG, after: beforeG + split.giftThis,
        ref: o.id + ' 赠送课时', note: '套餐赠送 ' + split.giftThis + ' 课时', orderId: o.id, paymentId: pay.id
      });
    }
    acc.hours = beforeH + split.purchaseThis;
    acc.gift = beforeG + split.giftThis;
    acc.buy = acc.hours;
    acc.remain = (Number(acc.remain) || 0) + split.hoursThis;
    acc.updatedAt = pay.confirmedAt;
    o.paidAmount = (Number(o.paidAmount) || 0) + pay.amount;
    o.creditedHours = (Number(o.creditedHours) || 0) + split.hoursThis;
    o.paymentId = pay.id;
    o.payMethod = pay.method;
    o.reviewedBy = o.reviewedBy || pay.confirmedBy;
    o.reviewedAt = o.reviewedAt || pay.confirmedAt;
    o.status = split.isFinal ? ORDER.CREDITED : ORDER.REVIEWED;
    o.updatedAt = pay.confirmedAt;
    if (split.isFinal) {
      o.creditedAt = pay.confirmedAt;
      o.creditBy = pay.confirmedBy;
    }
    setLessonAccountStatus(acc, db.config.renewal.lessonThreshold);
    syncStudentRemain(stu.id);
    stu.product = stu.product || p.name;
    stu.status = stu.status === '暂停' ? '在读' : stu.status;
    stu.updatedAt = o.updatedAt;
    orderLog(o.id, 'PAYMENT_CONFIRMED',
      '确认收款 ¥' + pay.amount + '（' + pay.method + '），本次入账 ' + split.hoursThis +
      ' 课时，累计入账 ' + o.creditedHours + '/' + o.totalHours + ' 课时，已收 ¥' + o.paidAmount + '/' + o.amount,
      from, o.status);

    if (split.isFinal) {
      orderLog(o.id, 'CREDITED',
        '订单收款完成，课时入账 ' + o.creditedHours + ' 课时，余额 ' + stu.remain, from, ORDER.CREDITED);
      if (o.leadId) {
        var l = lead(o.leadId);
        if (l) {
          if (l.convertedStudentId !== stu.id) {
            l.convertedStudentId = stu.id;
            l.convertedAt = l.convertedAt || o.creditedAt;
          }
          if (l.status !== LEAD.DEAL) {
            var lf = l.status;
            l.status = LEAD.DEAL;
            l.updatedAt = o.creditedAt;
            leadLog(l.id, LEAD_ACTION.DEAL, '报名订单 ' + o.id + ' 收款确认，线索成交', lf, LEAD.DEAL);
          }
        }
      }
      if (o.renewalOpportunityId) {
        var rn = renewal(o.renewalOpportunityId);
        if (rn) {
          rn.status = RENEWAL.ORDERED;
          rn.renewalOrderId = o.id;
          rn.updatedAt = o.creditedAt;
          rn.remark = (rn.remark ? rn.remark + '；' : '') + '续费订单 ' + o.id + ' 已收款入账';
        }
      }
      db.renewalOpportunities.forEach(function (r) {
        if (r.studentId === stu.id && r.id !== o.renewalOpportunityId &&
          (r.status === RENEWAL.PENDING || r.status === RENEWAL.FOLLOWING)) {
          r.status = RENEWAL.CLOSED;
          r.remark = (r.remark ? r.remark + '；' : '') + '学员已补充课时，自动关闭';
          r.updatedAt = o.creditedAt;
        }
      });
      refreshRenewalOpportunities(stu.id);
    }
    return { order: o, account: acc, payment: pay, split: split };
  }
  /** 收款确认后的审计 + 通知（不改变任何业务状态，只记录与告知） */
  function afterPaymentConfirmed(o, amount, paymentId, registrationId) {
    var stuAddr = student(o.studentId) || {};
    recordAudit({
      module: '报名收款', action: '确认收款并入账', resourceType: 'order', resourceId: o.id,
      resourceName: (stuAddr.name || o.studentId) + ' / ' + o.productName,
      beforeData: { paidAmountBefore: Number(o.paidAmount || 0) - Number(amount || 0), status: ORDER.REVIEWED },
      afterData: {
        paymentId: paymentId || '', registrationId: registrationId || '',
        amount: amount, paidAmount: o.paidAmount, creditedHours: o.creditedHours,
        status: o.status, lessonAccountId: o.lessonAccountId
      },
      reason: '管理员确认到账，课时已入账', result: '成功'
    });
    notify('PAYMENT_CONFIRMED', {
      orderNo: o.id, amount: amount, studentName: stuAddr.name || '',
      agentId: o.agentId, parentId: o.parentId, businessId: o.id,
      link: 'agent/workbench.html'
    });
  }
  /** 收款登记：只登记待确认，不写账户；登记 ≠ 入账 */
  function registerPayment(orderId, opt) {
    assertCan('order.create');
    opt = opt || {};
    var o = assertOrderAccess(orderOf(orderId));
    if (o.status === ORDER.CANCELLED) throw bizError('ORDER_CANCELLED', '订单已取消，不能登记收款');
    if (o.status === ORDER.REFUNDED) throw bizError('ORDER_REFUNDED', '订单已退款，不能再登记收款');
    if (o.status === ORDER.CREDITED) throw bizError('ALREADY_CREDITED', '订单已收款完成，不能再登记收款');
    var amount = Number(opt.amount);
    if (!(amount > 0)) throw bizError('AMOUNT_INVALID', '收款金额必须大于 0');
    var confirmedSum = orderPayments(o.id).filter(function (p) { return p.status === PAY.CONFIRMED; })
      .reduce(function (n, p) { return n + Number(p.amount || 0); }, 0);
    var pendingSum = db.paymentRegistrations.filter(function (x) {
      return x.orderId === o.id && x.status === PAY_REG.PENDING;
    }).reduce(function (n, x) { return n + Number(x.amount || 0); }, 0);
    if (confirmedSum + pendingSum + amount > Number(o.amount) + 0.005) {
      throw bizError('AMOUNT_OVERFLOW',
        '登记金额超出订单应收：订单 ¥' + o.amount + '，已确认 ¥' + confirmedSum + '，待确认 ¥' + pendingSum +
        '，本次 ¥' + amount + '，累计溢价 ¥' + (confirmedSum + pendingSum + amount - o.amount));
    }
    var method = String(opt.method || '微信');
    if (!dictionaryHas('pay_method', method)) {
      throw bizError('DICT_INVALID', '支付方式「' + method + '」不在数据字典中，请先在字典管理中维护');
    }
    var reg = {
      id: nextId('PST', 'PST', 3), orderId: o.id, amount: amount, method: method,
      voucherNo: String(opt.voucherNo || ''), note: String(opt.note || ''),
      registeredBy: operatorNameNow(), registeredAt: stamp(),
      status: PAY_REG.PENDING, confirmedBy: '', confirmedAt: '', paymentId: '',
      createdAt: stamp(), updatedAt: stamp()
    };
    db.paymentRegistrations.push(reg);
    orderLog(o.id, 'PAYMENT_REGISTERED',
      '收款登记 ¥' + amount + '（' + reg.method + (reg.voucherNo ? '，凭证 ' + reg.voucherNo : '') +
      '），待管理员确认，未确认前不入课时', o.status, o.status);
    recordAudit({
      module: '报名收款', action: '登记收款', resourceType: 'order', resourceId: o.id,
      resourceName: o.id, beforeData: { paidAmount: o.paidAmount, status: o.status },
      afterData: { registrationId: reg.id, amount: amount, method: method, status: reg.status },
      reason: opt.note || '登记线下收款，待确认', result: '成功'
    });
    notify('PAYMENT_REGISTERED', {
      orderNo: o.id, amount: amount, businessId: o.id,
      link: 'admin/order-list.html?id=' + o.id
    });
    save();
    return reg;
  }
  /** 管理员确认登记：落 payments 并触发课时入账 */
  function confirmRegisteredPayment(regId, opt) {
    assertCan('payment.confirm');
    var reg = db.paymentRegistrations.filter(function (x) { return x.id === regId; })[0];
    if (!reg) throw bizError('REGISTRATION_NOT_FOUND', '收款登记不存在');
    if (reg.status === PAY_REG.CONFIRMED) throw bizError('ALREADY_CONFIRMED', '该收款登记已确认，不能重复确认');
    if (reg.status === PAY_REG.REJECTED) throw bizError('REGISTRATION_REJECTED', '该收款登记已驳回，请重新登记');
    var o = orderOf(reg.orderId);
    if (!o) throw bizError('ORDER_NOT_FOUND', '登记关联的订单不存在');
    if (o.status === ORDER.CANCELLED) throw bizError('ORDER_CANCELLED', '订单已取消，不能确认收款');
    if (o.status === ORDER.REFUNDED) throw bizError('ORDER_REFUNDED', '订单已退款，不能确认收款');
    if (o.status === ORDER.CREDITED) throw bizError('ALREADY_CREDITED', '订单已完成收款入账，不能重复确认');
    var confirmedSum = orderPayments(o.id).filter(function (p) { return p.status === PAY.CONFIRMED; })
      .reduce(function (n, p) { return n + Number(p.amount || 0); }, 0);
    if (confirmedSum + Number(reg.amount) > Number(o.amount) + 0.005) {
      throw bizError('AMOUNT_OVERFLOW',
        '本次确认将超出订单应收：订单 ¥' + o.amount + '，已确认 ¥' + confirmedSum + '，本次 ¥' + reg.amount);
    }
    var snap = JSON.stringify(db);
    try {
      var applied = applyPaymentConfirmation(o, reg, opt);
      afterPaymentConfirmed(o, reg.amount, applied.payment ? applied.payment.id : '', reg.id);
      save();
      return orderView(o.id);
    } catch (e) {
      db = JSON.parse(snap);
      throw bizError(e.code || 'PAYMENT_FAILED',
        '收款确认未完成，已整体回滚（不会产生课时）：' + e.message, e.data);
    }
  }
  function rejectRegisteredPayment(regId, opt) {
    assertCan('payment.confirm');
    opt = opt || {};
    var reg = db.paymentRegistrations.filter(function (x) { return x.id === regId; })[0];
    if (!reg) throw bizError('REGISTRATION_NOT_FOUND', '收款登记不存在');
    if (reg.status !== PAY_REG.PENDING) throw bizError('REGISTRATION_STATUS_INVALID', '只有「待确认」登记可以驳回');
    var reason = String(opt.reason || '').trim();
    if (!reason) throw bizError('REASON_REQUIRED', '驳回收款登记必须填写原因');
    reg.status = PAY_REG.REJECTED;
    reg.confirmedBy = operatorNameNow();
    reg.confirmedAt = stamp();
    reg.rejectReason = reason;
    reg.updatedAt = reg.confirmedAt;
    orderLog(reg.orderId, 'PAYMENT_REJECTED', '收款登记 ' + reg.id + ' 驳回：' + reason,
      order(reg.orderId) ? order(reg.orderId).status : '', order(reg.orderId) ? order(reg.orderId).status : '');
    save();
    return reg;
  }
  /**
   * 管理员确认收款（兼容入参：无 registrationId 时先登记再确认）。
   * 支持多次部分收款：累计不得超过订单金额，课时按单价折算，尾差计入最后一笔。
   */
  function confirmOrderPayment(id, opt) {
    assertCan('payment.confirm');
    opt = opt || {};
    var o = orderOf(id);
    if (o.status === ORDER.CREDITED) throw bizError('ALREADY_CREDITED', '该订单已完成收款并入账，不能重复操作');
    if (o.status === ORDER.CANCELLED) throw bizError('ORDER_CANCELLED', '订单已取消，不能确认收款');
    if (o.status === ORDER.REFUNDED) throw bizError('ORDER_REFUNDED', '订单已退款，不能再次确认收款');
    if (o.status !== ORDER.PENDING && o.status !== ORDER.REVIEWED) {
      throw bizError('ORDER_STATUS_INVALID', '订单当前为「' + o.status + '」，不能确认收款');
    }
    if (opt.registrationId) return confirmRegisteredPayment(opt.registrationId, opt);
    var confirmedSum = orderPayments(o.id).filter(function (p) { return p.status === PAY.CONFIRMED; })
      .reduce(function (n, p) { return n + Number(p.amount || 0); }, 0);
    var amount = opt.amount === undefined ? Number(o.amount) - confirmedSum : Number(opt.amount);
    if (!(amount > 0)) throw bizError('AMOUNT_INVALID', '收款金额必须大于 0');
    if (confirmedSum + amount > Number(o.amount) + 0.005) {
      throw bizError('AMOUNT_OVERFLOW',
        '收款金额超出订单应收：订单 ¥' + o.amount + '，已确认 ¥' + confirmedSum + '，本次 ¥' + amount);
    }
    var snap = JSON.stringify(db);
    try {
      var reg = {
        id: nextId('PST', 'PST', 3), orderId: o.id, amount: amount,
        method: PAY_METHODS.indexOf(opt.method) >= 0 ? opt.method : (opt.method || '微信'),
        voucherNo: String(opt.voucherNo || ''), note: String(opt.note || '管理员确认收款'),
        registeredBy: operatorNameNow(), registeredAt: stamp(),
        status: PAY_REG.PENDING, confirmedBy: '', confirmedAt: '', paymentId: '',
        createdAt: stamp(), updatedAt: stamp()
      };
      db.paymentRegistrations.push(reg);
      var applied = applyPaymentConfirmation(o, reg, opt);
      afterPaymentConfirmed(o, amount, applied.payment ? applied.payment.id : '', reg.id);
      save();
      return orderView(o.id);
    } catch (e) {
      db = JSON.parse(snap);
      throw bizError(e.code || 'PAYMENT_FAILED',
        '收款确认未完成，已整体回滚（不会产生课时）：' + e.message, e.data);
    }
  }
  function pushFlow(payload) {
    var f = {
      id: 'FL' + TODAY.replace(/-/g, '') + pad(seq('FL', 3), 3),
      student: payload.student, studentId: payload.studentId || '',
      account: payload.account, accountId: payload.account,
      type: payload.type, delta: payload.delta,
      before: payload.before, after: payload.after,
      ref: payload.ref || '', op: operatorNameNow(), time: stamp(),
      note: payload.note || '', orderId: payload.orderId || '',
      paymentId: payload.paymentId || '', courseId: payload.courseId || ''
    };
    db.flows.push(f);
    return f;
  }
  function setLessonAccountStatus(acc, threshold) {
    var t = Number(threshold || db.config.renewal.lessonThreshold);
    acc.status = Number(acc.remain) <= 0 ? '已用完' : (Number(acc.remain) < t ? '余额不足' : '正常');
  }
  function cancelOrder(id, opt) {
    assertCan('order.create');
    opt = opt || {};
    var o = orderOf(id);
    if (session.role === 'agent') {
      var self = assertSelfAgent(sessionAgentId());
      if (o.agentId !== self) throw bizError('FORBIDDEN', '只能取消自己客户的待审核订单');
    }
    if (o.status !== ORDER.PENDING && o.status !== ORDER.REVIEWED) {
      throw bizError('ORDER_STATUS_INVALID', '只有「待审核 / 待收款」订单可以取消');
    }
    var reason = String(opt.reason || '').trim();
    if (!reason) throw bizError('REASON_REQUIRED', '取消订单必须填写原因');
    var from = o.status;
    o.status = ORDER.CANCELLED;
    o.cancelReason = reason;
    o.updatedAt = stamp();
    orderLog(o.id, 'CANCELLED', '订单取消：' + reason, from, ORDER.CANCELLED);
    var restored = restoreRenewalOpportunity(o, '取消');
    if (restored) {
      orderLog(o.id, 'RENEWAL_RESTORED',
        '关联续费机会 ' + restored.id + ' 恢复为「待跟进」，跟进记录保留', ORDER.CANCELLED, ORDER.CANCELLED);
    }
    save();
    return o;
  }
  /** 订单与课时账核对：用于验收与管理员自查（支持部分收款与退款） */
  function orderCheck(id) {
    var o = orderOf(id);
    var acc = o.lessonAccountId ? account(o.lessonAccountId) : null;
    var confirmedPays = orderPayments(o.id).filter(function (p) { return p.status === PAY.CONFIRMED; });
    var reversedPays = orderPayments(o.id).filter(function (p) { return p.status === PAY.REVERSED; });
    var pay = confirmedPays[0] || null;
    var paidSum = confirmedPays.reduce(function (n, p) { return n + Number(p.amount || 0); }, 0);
    var refundedGross = reversedPays.reduce(function (n, p) { return n + Number(p.amount || 0); }, 0);
    var creditedFlows = db.flows.filter(function (f) {
      return f.orderId === o.id && (f.type === '购买入账' || f.type === '赠送入账');
    });
    var refundFlows = db.flows.filter(function (f) {
      return f.orderId === o.id && f.type === '退款冲回';
    });
    var allFlows = db.flows.filter(function (f) { return f.orderId === o.id; });
    var flowHours = creditedFlows.reduce(function (n, f) { return n + Number(f.delta || 0); }, 0);
    var refundHours = Math.abs(refundFlows.reduce(function (n, f) { return n + Number(f.delta || 0); }, 0));
    var credited = Number(o.creditedHours) || 0;
    var ok = true, reasons = [];
    if (o.status === ORDER.CREDITED) {
      if (!pay) { ok = false; reasons.push('已入账订单缺少已确认收款记录'); }
      if (!acc) { ok = false; reasons.push('已入账订单缺少课时账户'); }
      if (Math.abs(paidSum - Number(o.amount)) > 0.005) {
        ok = false; reasons.push('已确认收款合计 ' + paidSum + ' 与订单金额 ' + o.amount + ' 不一致');
      }
      if (acc && Number(acc.hours) !== Number(o.hours)) { ok = false; reasons.push('账户购买课时与订单不一致'); }
      if (acc && Number(acc.gift) !== Number(o.gift)) { ok = false; reasons.push('账户赠送课时与订单不一致'); }
      if (flowHours !== Number(o.totalHours)) { ok = false; reasons.push('入账流水合计 ' + flowHours + ' 与订单总课时 ' + o.totalHours + ' 不一致'); }
      if (acc && (Number(acc.hours) + Number(acc.gift)) !== flowHours) {
        ok = false; reasons.push('账户课时 ' + (Number(acc.hours) + Number(acc.gift)) + ' 与入账流水 ' + flowHours + ' 不一致');
      }
    } else if (o.status === ORDER.REFUNDED) {
      if (Number(o.refundedAmount) > paidSum + refundedGross + 0.005) {
        ok = false; reasons.push('退款金额 ' + o.refundedAmount + ' 超过已确认收款合计 ' + (paidSum + refundedGross));
      }
      if (refundHours > flowHours) {
        ok = false; reasons.push('退款冲回课时 ' + refundHours + ' 超过已入账课时 ' + flowHours);
      }
    } else {
      /* 待审核 / 待收款（含部分收款中）：账户只允许存在已确认收款折算出的课时 */
      if (!acc && (flowHours > 0 || credited > 0)) { ok = false; reasons.push('已入账课时却缺少课时账户'); }
      if (acc && flowHours !== credited) {
        ok = false; reasons.push('入账流水合计 ' + flowHours + ' 与累计已入账课时 ' + credited + ' 不一致');
      }
      if (acc && (Number(acc.hours) + Number(acc.gift)) !== flowHours) {
        ok = false; reasons.push('账户课时与入账流水不一致');
      }
      if (creditedFlows.length && !confirmedPays.length) {
        ok = false; reasons.push('存在入账流水却没有已确认收款');
      }
      if (credited > Number(o.totalHours)) { ok = false; reasons.push('累计入账课时超过订单总课时'); }
    }
    return {
      ok: ok, order: o, account: acc, payment: pay, payments: confirmedPays,
      refundFlows: refundFlows, refundHours: refundHours,
      flows: creditedFlows, allFlows: allFlows, flowHours: flowHours, reasons: reasons
    };
  }

  /* ---------------- 退款申请与审核 ---------------- */
  function refundRequestsOf(query) {
    query = query || {};
    return db.refundRequests.filter(function (r) {
      if (query.orderId && r.orderId !== query.orderId) return false;
      if (query.status && r.status !== query.status) return false;
      return true;
    }).map(function (r) {
      return { request: r, order: order(r.orderId), reviewedByName: r.reviewedBy || '' };
    }).sort(function (a, b) { return a.request.requestedAt < b.request.requestedAt ? 1 : -1; });
  }
  /** 发起退款申请（登记待审核）：金额不得超过已确认收款合计 */
  function requestOrderRefund(orderId, opt) {
    assertCan('order.create');
    opt = opt || {};
    var o = assertOrderAccess(orderOf(orderId));
    if (o.status === ORDER.CANCELLED) throw bizError('ORDER_CANCELLED', '订单已取消，不能发起退款');
    if (o.status === ORDER.PENDING || o.status === ORDER.REVIEWED) {
      throw bizError('ORDER_NOT_CREDITED', '订单尚未完成收款入账，不能退款；请走「取消订单」');
    }
    var amount = Number(opt.amount);
    if (!(amount > 0)) throw bizError('AMOUNT_INVALID', '退款金额必须大于 0');
    var paidSum = orderPayments(o.id).filter(function (p) { return p.status === PAY.CONFIRMED; })
      .reduce(function (n, p) { return n + Number(p.amount || 0); }, 0);
    var pendingSum = db.refundRequests.filter(function (r) {
      return r.orderId === o.id && r.status === REFUND.PENDING;
    }).reduce(function (n, r) { return n + Number(r.amount || 0); }, 0);
    var refundable = paidSum - (Number(o.refundedAmount) || 0) - pendingSum;
    if (amount > refundable + 0.005) {
      throw bizError('REFUND_AMOUNT_EXCEED',
        '可退金额不足：已确认收款 ¥' + paidSum + '，已退 ¥' + (o.refundedAmount || 0) +
        '，待审核 ¥' + pendingSum + '，最多可退 ¥' + Math.max(0, refundable));
    }
    var reason = String(opt.reason || '').trim();
    if (!reason) throw bizError('REASON_REQUIRED', '退款申请必须填写原因');
    var r = {
      id: nextId('RFD', 'RFD', 3), orderId: o.id, studentId: o.studentId,
      amount: amount, reason: reason,
      status: REFUND.PENDING, requestedBy: operatorNameNow(), requestedAt: stamp(),
      reviewedBy: '', reviewedAt: '', result: '', reversedHours: 0,
      createdAt: stamp(), updatedAt: stamp()
    };
    db.refundRequests.push(r);
    orderLog(o.id, 'REFUND_REQUESTED',
      '退款申请 ' + r.id + '：¥' + amount + '，事由：' + reason + '（待管理员审核）', o.status, o.status);
    recordAudit({
      module: '报名收款', action: '发起退款申请', resourceType: 'refund', resourceId: r.id,
      resourceName: o.id, beforeData: { refundedAmount: o.refundedAmount, status: o.status },
      afterData: { amount: amount, reason: reason, status: r.status },
      reason: reason, result: '成功'
    });
    save();
    return r;
  }
  /** 管理员审核退款：通过后按比例冲回课时并写负数流水，账户余额不得为负 */
  function reviewRefund(refundId, opt) {
    assertCan('order.review');
    opt = opt || {};
    var r = db.refundRequests.filter(function (x) { return x.id === refundId; })[0];
    if (!r) throw bizError('REFUND_NOT_FOUND', '退款申请不存在');
    if (r.status !== REFUND.PENDING) throw bizError('REFUND_STATUS_INVALID', '该退款申请已处理，不能重复审核');
    var pass = opt.pass !== false;
    var o = orderOf(r.orderId);
    if (!o) throw bizError('ORDER_NOT_FOUND', '退款申请关联订单不存在');
    if (!pass) {
      var rejectReason = String(opt.reason || '').trim();
      if (!rejectReason) throw bizError('REASON_REQUIRED', '驳回退款必须填写原因');
      r.status = REFUND.REJECTED;
      r.reviewedBy = operatorNameNow();
      r.reviewedAt = stamp();
      r.result = rejectReason;
      r.updatedAt = r.reviewedAt;
      orderLog(o.id, 'REFUND_REJECTED', '退款申请 ' + r.id + ' 驳回：' + rejectReason, o.status, o.status);
      recordAudit({
        module: '报名收款', action: '审核退款（驳回）', resourceType: 'refund', resourceId: r.id,
        resourceName: o.id, beforeData: { status: REFUND.PENDING },
        afterData: { status: r.status, amount: r.amount }, reason: rejectReason, result: '成功'
      });
      save();
      return { request: r, order: o, reversedHours: 0 };
    }
    var paidSum = orderPayments(o.id).filter(function (p) { return p.status === PAY.CONFIRMED; })
      .reduce(function (n, p) { return n + Number(p.amount || 0); }, 0);
    var approvedBefore = Number(o.refundedAmount) || 0;
    if (approvedBefore + Number(r.amount) > paidSum + 0.005) {
      throw bizError('REFUND_AMOUNT_EXCEED',
        '退款金额 ¥' + r.amount + ' 超出可退范围：已确认收款 ¥' + paidSum + '，已退 ¥' + approvedBefore);
    }
    var acc = o.lessonAccountId ? account(o.lessonAccountId) : null;
    if (!acc) throw bizError('NO_ACCOUNT', '订单没有课时账户，无法冲回课时');
    var creditedHours = Number(o.creditedHours) || 0;
    var alreadyReversed = Math.abs(db.flows.filter(function (f) {
      return f.orderId === o.id && f.type === '退款冲回';
    }).reduce(function (n, f) { return n + Number(f.delta || 0); }, 0));
    var remainToReverse = Math.max(0, creditedHours - alreadyReversed);
    var netRemaining = paidSum - approvedBefore;
    var isFull = r.amount >= netRemaining - 0.005;
    var reverse;
    if (isFull) {
      reverse = remainToReverse;
    } else {
      var unit = creditedHours > 0 ? paidSum / creditedHours : 0;
      reverse = unit > 0 ? Math.floor(Number(r.amount) / unit + 1e-9) : 0;
      if (reverse > remainToReverse) reverse = remainToReverse;
    }
    if (reverse > Number(acc.remain)) {
      throw bizError('REFUND_HOURS_EXCEED',
        '课时不足以冲回：应冲回 ' + reverse + ' 课时，账户仅剩 ' + acc.remain +
        ' 课时（已消耗 ' + ((Number(acc.used) || 0)) + ' 课时）。余额不得为负，请按剩余课时折算退款金额或走人工调整');
    }
    var snap = JSON.stringify(db);
    try {
      var before = Number(acc.remain) || 0;
      acc.remain = before - reverse;
      acc.adjust = (Number(acc.adjust) || 0) - reverse;
      acc.updatedAt = stamp();
      setLessonAccountStatus(acc, db.config.renewal.lessonThreshold);
      if (reverse > 0) {
        pushFlow({
          student: acc.student, studentId: acc.studentId, account: acc.id,
          type: '退款冲回', delta: -reverse, before: before, after: acc.remain,
          ref: o.id + ' 退款 ' + r.id, note: '退款 ¥' + r.amount + ' 按比例冲回 ' + reverse + ' 课时',
          orderId: o.id
        });
      }
      o.refundedAmount = approvedBefore + Number(r.amount);
      o.partialRefund = o.refundedAmount < paidSum - 0.005;
      o.status = ORDER.REFUNDED;
      o.updatedAt = stamp();
      r.status = REFUND.APPROVED;
      r.reviewedBy = operatorNameNow();
      r.reviewedAt = stamp();
      r.reversedHours = reverse;
      r.result = String(opt.result || '').trim() || ('同意退款 ¥' + r.amount + '，冲回 ' + reverse + ' 课时');
      r.updatedAt = r.reviewedAt;
      orderLog(o.id, 'REFUND_APPROVED',
        '退款通过 ' + r.id + '：¥' + r.amount + '（' + (o.partialRefund ? '部分退款' : '全额退款') +
        '），冲回 ' + reverse + ' 课时，账户余额 ' + acc.remain,
        o.status, ORDER.REFUNDED);
      var restored = restoreRenewalOpportunity(o, '退款');
      if (restored) {
        orderLog(o.id, 'RENEWAL_RESTORED',
          '关联续费机会 ' + restored.id + ' 恢复为「待跟进」', ORDER.REFUNDED, ORDER.REFUNDED);
      }
      syncStudentRemain(o.studentId);
      recordAudit({
        module: '报名收款', action: '审核退款（通过）', resourceType: 'refund', resourceId: r.id,
        resourceName: o.id, beforeData: { refundedAmount: approvedBefore, status: ORDER.CREDITED },
        afterData: {
          refundedAmount: o.refundedAmount, reversedHours: reverse,
          accountRemain: acc.remain, status: o.status
        },
        reason: r.result, result: '成功'
      });
      save();
      refreshRenewalOpportunities(o.studentId);
      save();
      return { request: r, order: o, reversedHours: reverse, account: acc };
    } catch (e) {
      db = JSON.parse(snap);
      throw bizError(e.code || 'REFUND_FAILED', '退款审核未完成，已回滚：' + e.message);
    }
  }


  function adjustLessons(studentId, delta, reason, opt) {
    assertCan('lesson.adjust');
    opt = opt || {};
    delta = Number(delta);
    if (!delta) throw bizError('DELTA_INVALID', '调整课时不能为 0');
    var s = student(studentId);
    if (!s) throw bizError('STUDENT_NOT_FOUND', '学员不存在');
    var why = String(reason || '').trim();
    if (!why) throw bizError('REASON_REQUIRED', '课时调整必须填写原因');
    var accs = accountsOfStudent(studentId);
    if (!accs.length) throw bizError('NO_ACCOUNT', '该学员没有课时账户，不能凭空调整课时');
    var acc = delta > 0 ? accs[accs.length - 1] : (accs.filter(function (a) { return Number(a.remain) > 0; })[0] || accs[0]);
    if (delta < 0 && Number(acc.remain) < Math.abs(delta)) {
      throw bizError('INSUFFICIENT_HOURS', '可用课时不足（当前剩余 ' + acc.remain + ' 课时）');
    }
    var snap = JSON.stringify(db);
    try {
      var before = Number(acc.remain || 0);
      acc.remain = before + delta;
      acc.adjust = Number(acc.adjust || 0) + delta;
      acc.updatedAt = stamp();
      setLessonAccountStatus(acc, db.config.renewal.lessonThreshold);
      pushFlow({
        student: s.name, studentId: s.id, account: acc.id,
        type: '课时调整', delta: delta, before: before, after: acc.remain,
        ref: opt.ref || '有权限的课时调整', note: why
      });
      syncStudentRemain(s.id);
      recordAudit({
        module: '课时账户', action: '调整课时', resourceType: 'lessonAccount', resourceId: acc.id,
        resourceName: s.name, beforeData: { remain: before, adjust: Number(acc.adjust || 0) - delta },
        afterData: { remain: acc.remain, adjust: acc.adjust, delta: delta },
        reason: why, result: '成功'
      });
      save();
      refreshRenewalOpportunities(s.id);
      save();
      return { account: acc, remaining: acc.remain, student: s };
    } catch (e) {
      db = JSON.parse(snap);
      throw bizError(e.code || 'ADJUST_FAILED', '课时调整未完成，已回滚：' + e.message);
    }
  }

  /* ---------------- 续费机会 ---------------- */
  function refreshRenewalOpportunities(studentId) {
    var targets = studentId ? [student(studentId)].filter(Boolean) : db.students;
    var created = [];
    var threshold = Number(db.config.renewal.lessonThreshold || LESSON_ALERT_THRESHOLD);
    var days = Number(db.config.renewal.expireDays || EXPIRE_ALERT_DAYS);
    targets.forEach(function (s) {
      var at = studentAttribution(s.id);
      if (!at.agentId) return;
      var accs = accountsOfStudent(s.id);
      accs.forEach(function (a) {
        var low = Number(a.remain) < threshold;
        var near = a.expireAt && a.expireAt >= TODAY && a.expireAt <= addDays(TODAY, days);
        var source = low ? '课时不足' : (near ? '套餐临期' : '');
        var open = db.renewalOpportunities.filter(function (r) {
          return r.studentId === s.id && r.accountId === a.id &&
            (r.status === RENEWAL.PENDING || r.status === RENEWAL.FOLLOWING);
        })[0];
        var current = db.renewalOpportunities.filter(function (r) {
          return r.studentId === s.id && r.accountId === a.id && r.status === RENEWAL.ORDERED;
        })[0];
        if (!source) {
          if (open) {
            open.status = RENEWAL.CLOSED;
            open.remark = (open.remark ? open.remark + '；' : '') + '课时/有效期已恢复，自动关闭';
            open.updatedAt = stamp();
          }
          return;
        }
        if (current) return;
        if (open) {
          open.sourceType = source;
          open.remain = a.remain;
          open.expireAt = a.expireAt || '';
          open.agentId = at.agentId;
          open.updatedAt = stamp();
          return;
        }
        var r = {
          id: nextId('RN', 'RN', 3), studentId: s.id, leadId: at.leadId || '',
          agentId: at.agentId, accountId: a.id, orderId: at.orderId || '',
          sourceType: source, remain: a.remain, threshold: threshold,
          expireAt: a.expireAt || '', status: RENEWAL.PENDING,
          handledBy: '', remark: '', renewalOrderId: '',
          createdAt: stamp(), updatedAt: stamp()
        };
        db.renewalOpportunities.push(r);
        created.push(r);
        notify(source === '课时不足' ? 'LESSON_LOW' : 'RENEWAL_CREATED', {
          studentName: s.name, remain: a.remain, sourceType: source,
          agentId: at.agentId, businessId: r.id, link: 'agent/renewal-list.html'
        });
      });
    });
    return created;
  }
  function renewalRows(query) {
    query = query || {};
    return db.renewalOpportunities.filter(function (r) {
      if (query.status && r.status !== query.status) return false;
      if (query.agentId && r.agentId !== query.agentId) return false;
      if (query.studentId && r.studentId !== query.studentId) return false;
      return true;
    }).map(function (r) {
      var s = student(r.studentId), a = agent(r.agentId), acc = r.accountId ? account(r.accountId) : null;
      return {
        renewal: r, student: s, agent: a, account: acc,
        studentName: s ? s.name : '', agentName: a ? a.name : '机构直营',
        grade: s ? s.grade : '', remain: r.remain, expireAt: r.expireAt,
        teacherName: s ? s.teacherName : ''
      };
    }).sort(function (a, b) { return a.renewal.createdAt < b.renewal.createdAt ? 1 : -1; });
  }
  function agentRenewals(agentId) {
    var self = session.role === 'agent' ? assertSelfAgent(sessionAgentId()) : (agentId || defaultAgentId());
    return renewalRows({ agentId: self }).filter(function (x) {
      return x.renewal.agentId === self;
    });
  }
  function handleRenewal(id, opt) {
    assertCan('renewal.handle');
    opt = opt || {};
    var r = assertRenewalAccess(renewal(id));
    if (r.status === RENEWAL.ORDERED || r.status === RENEWAL.CLOSED) {
      throw bizError('RENEWAL_CLOSED', '该续费机会已「' + r.status + '」，不能再跟进');
    }
    var remark = String(opt.remark || '').trim();
    if (!remark) throw bizError('REMARK_REQUIRED', '记录续费跟进必须填写内容');
    r.status = RENEWAL.FOLLOWING;
    r.handledBy = operatorNameNow();
    r.remark = remark;
    r.updatedAt = stamp();
    save();
    return r;
  }
  function closeRenewal(id, opt) {
    assertCan('renewal.handle');
    opt = opt || {};
    var r = assertRenewalAccess(renewal(id));
    if (r.status === RENEWAL.ORDERED) throw bizError('RENEWAL_ORDERED', '该续费机会已经转成订单，不能关闭');
    var remark = String(opt.remark || '').trim();
    if (!remark) throw bizError('REMARK_REQUIRED', '关闭续费机会必须填写原因');
    r.status = RENEWAL.CLOSED;
    r.remark = remark;
    r.handledBy = operatorNameNow();
    r.updatedAt = stamp();
    save();
    return r;
  }
  /** 代理发起续费订单：必须来自自己的续费机会，套餐课时按当前售价重新下单 */
  function submitRenewalOrder(renewalId, productId, opt) {
    assertCan('order.create');
    opt = opt || {};
    var r = assertRenewalAccess(renewal(renewalId));
    if (r.status === RENEWAL.ORDERED) throw bizError('RENEWAL_ORDERED', '该续费机会已转成订单，不能重复提交');
    if (r.status === RENEWAL.CLOSED) throw bizError('RENEWAL_CLOSED', '该续费机会已关闭');
    var s = student(r.studentId);
    if (!s) throw bizError('STUDENT_NOT_FOUND', '学员不存在');
    var p = product(productId || r.productId);
    if (!p) throw bizError('PRODUCT_REQUIRED', '请选择续费套餐');
    var snap = JSON.stringify(db);
    try {
      var o = createOrderRecord({
        type: ORDER_TYPE.RENEW, leadId: r.leadId, studentId: s.id, parentId: s.parent,
        agentId: r.agentId, followerId: '', productId: p.id,
        renewalOpportunityId: r.id, remark: opt.remark || ''
      });
      r.status = RENEWAL.ORDERED;
      r.renewalOrderId = o.id;
      r.handledBy = operatorNameNow();
      r.updatedAt = stamp();
      if (r.leadId) {
        leadLog(r.leadId, LEAD_ACTION.ORDERED,
          '代理发起续费订单 ' + o.id + '：' + p.name + '，待审核收款', '', '');
      }
      save();
      return orderView(o.id);
    } catch (e) {
      db = JSON.parse(snap);
      throw bizError(e.code || 'RENEWAL_ORDER_FAILED',
        '续费订单提交失败，已回滚：' + e.message, e.data);
    }
  }

  /* ---------------- 学习反馈 ---------------- */
  function syncFeedbackFromReport(rp) {
    if (!rp) return null;
    if (db.learningFeedbacks.some(function (f) { return f.reportId === rp.id; })) return null;
    var f = {
      id: feedbackId(), studentId: rp.studentId, teacherId: rp.teacherId,
      courseId: rp.courseId, reportId: rp.id, title: rp.title,
      performance: rp.content.performance || '', weak: rp.content.weak || '',
      next: rp.content.next || '', status: '已发布', visibleToAgent: true, visibleToParent: true,
      homeworkAdvice: (rp.content && rp.content.homeworkAdvice) || '',
      createdAt: rp.createdAt || stamp(), publishedAt: rp.publishedAt || stamp()
    };
    db.learningFeedbacks.push(f);
    return f;
  }
  function createLearningFeedback(input) {
    assertCan('feedback.create');
    input = input || {};
    var s = student(input.studentId);
    if (!s) throw bizError('STUDENT_NOT_FOUND', '学员不存在');
    var teacherId = input.teacherId || session.teacherId;
    if (session.role === 'teacher') {
      teacherId = assertSelfTeacher(teacherId);
      assertMyStudent(s.id);
    }
    var courseId = input.courseId || '';
    if (courseId) {
      var c = course(courseId);
      if (!c) throw bizError('COURSE_NOT_FOUND', '课程不存在');
      if (c.studentId !== s.id) throw bizError('COURSE_STUDENT_MISMATCH', '该课程不属于此学员');
    }
    var title = String(input.title || '').trim() || '课堂学习反馈';
    if (!String(input.performance || '').trim()) throw bizError('CONTENT_REQUIRED', '请填写本节表现');
    var publish = input.publish !== false;
    var f = {
      id: feedbackId(), studentId: s.id, teacherId: teacherId || '',
      courseId: courseId, reportId: input.reportId || '', title: title,
      performance: String(input.performance || ''), weak: String(input.weak || ''),
      next: String(input.next || ''), status: publish ? '已发布' : '草稿',
      visibleToAgent: input.visibleToAgent !== false, visibleToParent: input.visibleToParent !== false,
      homeworkAdvice: String(input.homeworkAdvice || ''),
      createdAt: stamp(), publishedAt: publish ? stamp() : ''
    };
    db.learningFeedbacks.push(f);
    save();
    return f;
  }
  /**
   * 学习反馈可见性：家长与代理的可见性相互独立，草稿一律不进投影。
   *   audience === 'parent' → 已发布 且 visibleToParent
   *   audience === 'agent'  → 已发布 且 visibleToAgent
   *   其余（教师/内部）→ 仅已发布
   */
  function learningFeedbacksOfStudent(studentId, audience) {
    return db.learningFeedbacks.filter(function (f) {
      if (f.studentId !== studentId || f.status !== '已发布') return false;
      if (audience === 'parent') return f.visibleToParent !== false;
      if (audience === 'agent') return f.visibleToAgent !== false;
      return true;
    }).sort(function (a, b) { return a.publishedAt < b.publishedAt ? 1 : -1; });
  }
  /** 代理只能看到自己客户学员、代理可见的已发布反馈，字段也做最小投影 */
  function agentFeedbacksForStudent(studentId) {
    var s = student(studentId);
    if (!s) return [];
    return learningFeedbacksOfStudent(studentId, 'agent').map(function (f) {
      var t = teacher(f.teacherId);
      return {
        id: f.id, studentId: f.studentId, studentName: s.name,
        teacherId: f.teacherId, teacherName: t ? t.name : '教师',
        courseId: f.courseId, title: f.title,
        performance: f.performance, weak: f.weak, next: f.next,
        publishedAt: f.publishedAt, status: f.status
      };
    });
  }
  function agentFeedbacks(agentId) {
    var self = session.role === 'agent' ? assertSelfAgent(sessionAgentId()) : (agentId || defaultAgentId());
    var ids = agentStudentIds(self);
    var out = [];
    ids.forEach(function (sid) { out = out.concat(agentFeedbacksForStudent(sid)); });
    return out.sort(function (a, b) { return a.publishedAt < b.publishedAt ? 1 : -1; });
  }
  function parentFeedbacks(parentId) {
    var pid = resolveParentId(parentId);
    var out = [];
    parentStudents(pid).forEach(function (s) {
      learningFeedbacksOfStudent(s.id, 'parent').forEach(function (f) {
        var t = teacher(f.teacherId);
        out.push({
          id: f.id, studentId: s.id, studentName: s.name, title: f.title,
          teacherName: t ? t.name : '教师', performance: f.performance,
          weak: f.weak, next: f.next, homeworkAdvice: f.homeworkAdvice || '',
          publishedAt: f.publishedAt
        });
      });
    });
    return out.sort(function (a, b) { return a.publishedAt < b.publishedAt ? 1 : -1; });
  }

  /* ---------------- 家长端投影：只有孩子的，且不暴露内部财务流水 ---------------- */
  function resolveParentId(parentId) {
    if (session.role === 'parent') {
      if (parentId) assertSelfParent(parentId);
      return sessionParentId();
    }
    return parentId || defaultParentId();
  }
  function parentChildren(parentId) {
    var pid = resolveParentId(parentId);
    return parentStudents(pid).map(function (s) {
      var accs = accountsOfStudent(s.id);
      return {
        id: s.id, name: s.name, gender: s.gender, grade: s.grade, book: s.book,
        school: s.school, teacherName: s.teacherName || '未分配', status: s.status,
        remain: s.remain,
        totalHours: accs.reduce(function (n, a) { return n + Number(a.buy || 0) + Number(a.gift || 0); }, 0),
        usedHours: accs.reduce(function (n, a) { return n + Number(a.used || 0); }, 0),
        lastCourse: s.lastCourse || '', lastContent: s.lastContent || '',
        latestFeedback: learningFeedbacksOfStudent(s.id, 'parent')[0] || null
      };
    });
  }
  function parentOrders(parentId) {
    var pid = resolveParentId(parentId);
    var kids = parentStudents(pid).map(function (s) { return s.id; });
    return db.orders.filter(function (o) {
      return o.parentId === pid || kids.indexOf(o.studentId) >= 0;
    }).map(function (o) {
      return {
        id: o.id, type: o.type, studentId: o.studentId,
        studentName: (student(o.studentId) || {}).name || '',
        productName: o.productName, totalHours: o.totalHours, amount: o.amount,
        paidAmount: o.paidAmount, status: o.status, createdAt: o.createdAt, creditedAt: o.creditedAt
      };
    }).sort(function (a, b) { return a.createdAt < b.createdAt ? 1 : -1; });
  }
  function parentHours(parentId) {
    var pid = resolveParentId(parentId);
    var lowTh = (db.organization && db.organization.lessonAlertThreshold) || 5;
    var expDays = (db.organization && db.organization.expireAlertDays) || 14;
    function daysLeftOf(expDateStr) {
      if (!expDateStr) return -1;
      var d = String(expDateStr).slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return -1;
      var cur = new Date(TODAY.slice(0, 4), Number(TODAY.slice(5, 7)) - 1, Number(TODAY.slice(8, 10)));
      var exp = new Date(d.slice(0, 4), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)));
      return Math.round((exp - cur) / 86400000);
    }
    return parentStudents(pid).map(function (s) {
      var accs = accountsOfStudent(s.id);
      var remainAll = accs.reduce(function (n, a) { return n + Number(a.remain || 0); }, 0);
      return {
        studentId: s.id, studentName: s.name, remain: s.remain,
        totalRemain: remainAll,
        lowAlert: remainAll > 0 && remainAll <= lowTh,
        accounts: accs.map(function (a) {
          var expAt = a.expireAt || a.valid || '';
          var daysLeft = daysLeftOf(expAt);
          return {
            id: a.id, product: a.product, totalHours: Number(a.buy || 0) + Number(a.gift || 0),
            usedHours: Number(a.used || 0), remain: Number(a.remain || 0),
            expireAt: expAt, status: a.status,
            daysLeft: daysLeft, expiring: (daysLeft >= 0 && daysLeft <= expDays)
          };
        })
      };
    });
  }
  function parentView(parentId) {
    var pid = resolveParentId(parentId);
    var p = parent(pid);
    if (!p) throw bizError('PARENT_NOT_FOUND', '家长档案不存在');
    return {
      parent: {
        id: p.id, name: p.name, phone: p.phone, relation: p.relation,
        kids: parentStudents(pid).map(function (s) { return s.id; }),
        links: parentStudentLinks(pid).map(function (x) {
          return { studentId: x.studentId, relationship: x.relationship, isPrimaryContact: x.isPrimaryContact };
        })
      },
      children: parentChildren(pid), orders: parentOrders(pid), hours: parentHours(pid),
      feedbacks: parentFeedbacks(pid),
      policy: { canSeeInternalFlows: false, note: '家长端只展示自己孩子的订单状态、课时余额汇总与已发布反馈' }
    };
  }

  /* ---------------- 家长端专用授权接口（P0 数据安全） ----------------
     设计原则：
       1. 当前登录角色必须是 parent，parentId 只取自有效会话（resolveParentId）。
       2. 所有 studentId 必须通过 ParentStudent 关系校验，不能信任前端参数。
       3. 所有业务详情 ID 再次校验归属；返回最小必要投影，不暴露内部字段。
       4. 写操作必须记录操作家长与时间。
       原型阶段在 Store 内模拟会话校验；正式全栈版必须在服务端重新校验。 */
  /** 家长是否拥有该学员：以 ParentStudent 关系表为唯一口径 */
  function parentHasStudent(parentId, studentId) {
    if (!studentId) return false;
    return parentStudents(parentId).some(function (s) { return s.id === studentId; });
  }
  /** 越权即拒绝：家长只能访问自己关联的孩子 */
  function assertParentChild(parentId, studentId) {
    if (session.role !== 'parent') {
      throw bizError('FORBIDDEN', '家长专用接口仅限家长身份调用');
    }
    var pid = resolveParentId(parentId);
    if (!parentHasStudent(pid, studentId)) {
      throw bizError('FORBIDDEN', '该学员不在当前家长名下，无法访问');
    }
    return pid;
  }
  /** 学员详情投影：只给家长端需要的最小字段，不返回内部对象 */
  function parentStudentDetail(parentId, studentId) {
    var pid = assertParentChild(parentId, studentId);
    var s = student(studentId);
    if (!s) throw bizError('STUDENT_NOT_FOUND', '学员不存在');
    var accs = accountsOfStudent(s.id);
    var done = db.courses.filter(function (c) {
      return c.studentId === s.id && c.status === COURSE_STATUS.DONE;
    }).sort(function (a, b) { return (a.date + a.start) < (b.date + b.start) ? 1 : -1; });
    var lastDone = done[0] || null;
    var t = teacher(s.teacherId);
    return {
      id: s.id, name: s.name, gender: s.gender, grade: s.grade, book: s.book,
      school: s.school, status: s.status,
      teacherId: s.teacherId, teacherName: (t && t.name) || s.teacherName || '未分配',
      remain: s.remain,
      totalHours: accs.reduce(function (n, a) { return n + Number(a.buy || 0) + Number(a.gift || 0); }, 0),
      usedHours: accs.reduce(function (n, a) { return n + Number(a.used || 0); }, 0),
      lastCourse: s.lastCourse || '', lastContent: s.lastContent || '',
      lastCourseDate: lastDone ? lastDone.date : (s.lastCourse || ''),
      lastCourseTopic: lastDone ? (lastDone.topic || '') : (s.lastContent || ''),
      reviewSummary: parentReviewSummary(s.id)
    };
  }
  /** 课程列表投影：课程状态与报告状态独立；历史课程保留原教师快照 */
  function parentCourses(parentId, studentId, filters) {
    var pid = assertParentChild(parentId, studentId);
    filters = filters || {};
    var rows = db.courses.filter(function (c) {
      if (c.studentId !== studentId) return false;
      if (filters.status && c.status !== filters.status) return false;
      return true;
    }).sort(function (a, b) { return (a.date + a.start) < (b.date + b.start) ? 1 : -1; }).map(function (c) {
      var rp = recordOfCourse(c.id);
      var rep = reportOfCourse(c.id);
      var t = teacher(c.teacherId);
      return {
        id: c.id, date: c.date, start: c.start, end: c.end,
        status: c.status, deductState: c.deductState || (c.deduct === '已扣课' ? '已扣课' : '未扣课'),
        teacherName: c.teacherName || (t ? t.name : c.teacher || ''),
        teacherId: c.teacherId, topic: c.topic || '',
        reportStatus: rep ? rep.status : '未生成',
        reportId: rep ? rep.id : '',
        reportViewable: !!(rep && rep.status === REPORT_STATUS.PUBLISHED),
        note: c.note || '',
        actualStart: rp ? rp.actualStart : '', actualEnd: rp ? rp.actualEnd : ''
      };
    });
    if (filters.report !== undefined && filters.report !== '') {
      rows = rows.filter(function (c) {
        return filters.report === '有报告' ? c.reportStatus !== '未生成'
          : filters.report === '已发布' ? c.reportStatus === '已发布' : true;
      });
    }
    return rows;
  }
  function parentCourseDetail(parentId, studentId, courseId) {
    var pid = assertParentChild(parentId, studentId);
    var c = course(courseId);
    if (!c || c.studentId !== studentId) throw bizError('COURSE_NOT_FOUND', '课程不存在');
    var rp = reportOfCourse(courseId);
    var rec = recordOfCourse(courseId);
    var t = teacher(c.teacherId);
    return {
      id: c.id, date: c.date, start: c.start, end: c.end,
      status: c.status, deductState: c.deductState || (c.deduct === '已扣课' ? '已扣课' : '未扣课'),
      teacherName: c.teacherName || (t ? t.name : c.teacher || ''),
      topic: c.topic || '', note: c.note || '',
      actualStart: rec ? rec.actualStart : '', actualEnd: rec ? rec.actualEnd : '',
      reportStatus: rp ? rp.status : '未生成', reportId: rp ? rp.id : '',
      reportViewable: !!(rp && rp.status === REPORT_STATUS.PUBLISHED)
    };
  }
  /** 报告列表投影：只给已发布且对家长可见的报告 */
  function parentReports(parentId, studentId, filters) {
    var pid = assertParentChild(parentId, studentId);
    filters = filters || {};
    return db.reports.filter(function (r) {
      if (r.studentId !== studentId) return false;
      if (r.status !== REPORT_STATUS.PUBLISHED || r.visibleToParent === false) return false;
      if (filters.courseId && r.courseId !== filters.courseId) return false;
      return true;
    }).sort(function (a, b) { return a.courseDate < b.courseDate ? 1 : -1; }).map(function (r) {
      var t = teacher(r.teacherId);
      return {
        id: r.id, courseId: r.courseId, courseDate: r.courseDate, title: r.title,
        teacherName: (t && t.name) || '教师', summary: r.content ? r.content.performance : '',
        publishedAt: r.publishedAt || '', status: r.status
      };
    });
  }
  function parentReportDetail(parentId, studentId, reportId) {
    var pid = assertParentChild(parentId, studentId);
    var rp = report(reportId);
    if (!rp || rp.studentId !== studentId) throw bizError('REPORT_NOT_FOUND', '报告不存在');
    if (rp.status !== REPORT_STATUS.PUBLISHED || rp.visibleToParent === false) {
      throw bizError('FORBIDDEN', '该报告尚未对家长发布');
    }
    var t = teacher(rp.teacherId);
    var c = course(rp.courseId);
    var rec = rp.recordId ? courseRecord(rp.recordId) : recordOfCourse(rp.courseId);
    var snap = rec ? recordView(rec) : null;
    var art = db.articleTasks.filter(function (a) { return a.courseId === rp.courseId; })[0] || null;
    var artStat = art ? articleTaskStat(art.id) : null;
    return {
      id: rp.id, courseId: rp.courseId, courseDate: rp.courseDate, title: rp.title,
      teacherName: (t && t.name) || '教师', publishedAt: rp.publishedAt || '',
      courseStatus: c ? c.status : '', planStart: c ? (c.date + ' ' + c.start) : '',
      planEnd: c ? (c.date + ' ' + c.end) : '',
      actualStart: rec ? rec.actualStart : '', actualEnd: rec ? rec.actualEnd : '',
      content: {
        performance: rp.content.performance || '', weak: rp.content.weak || '',
        next: rp.content.next || '', homeworkAdvice: rp.content.homeworkAdvice || ''
      },
      stats: {
        trainWords: snap ? snap.trainWords : 0, mastered: snap ? snap.mastered : 0,
        weak: snap ? snap.weak : 0, leitnerWords: snap ? snap.leitnerWords : 0,
        plan21Words: snap ? snap.plan21Words : 0,
        articleCount: snap ? snap.articleCount : 0,
        articleMastered: snap ? snap.articleMastered : 0,
        articleWeak: snap ? snap.articleWeak : 0
      },
      article: art ? { id: art.id, name: art.articleName } : null,
      articleStat: artStat ? { mastered: artStat.mastered, weak: artStat.weak, readDone: artStat.readDone } : null
    };
  }
  /** 复习汇总（真实口径）：今日到期 / 全部待复习 / 已通过 */
  function parentReviewSummary(parentId, studentId) {
    if (arguments.length < 2) { studentId = parentId; parentId = resolveParentId(); }
    assertParentChild(parentId, studentId);
    var rows = buildParentReviewRows(studentId);
    return {
      today: rows.filter(function (r) { return r.dueToday; }).length,
      all: rows.length,
      passed: wordStates(studentId).filter(function (s) { return s.state === '本次通过'; }).length
    };
  }
  /** 构建家长可见的复习单词行（两套体系独立计算、按 wordId 合并） */
  function buildParentReviewRows(studentId) {
    var rows = [];
    var seen = {};
    function pushWord(wordId, systems, extra) {
      if (!seen[wordId]) {
        seen[wordId] = 1;
        rows.push({ wordId: wordId, systems: systems.slice(), extra: extra });
      } else {
        var hit = rows.filter(function (r) { return r.wordId === wordId; })[0];
        systems.forEach(function (sy) { if (hit.systems.indexOf(sy) < 0) hit.systems.push(sy); });
        if (extra && extra.dueToday) hit.extra.dueToday = true;
        if (extra && extra.dueAt && (!hit.extra.dueAt || hit.extra.dueAt > extra.dueAt)) hit.extra.dueAt = extra.dueAt;
      }
    }
    // 莱特纳：未毕业单词；今日到期 = 红盒/黄盒到期 + 手动今日加入
    leitnerStates(studentId).forEach(function (s) {
      if (s.box === 'graduated') return;
      pushWord(s.wordId, ['莱特纳'], {
        dueToday: isDue(s) || (s.manualToday && s.box !== 'graduated'),
        dueAt: s.dueAt || '', leitnerBox: s.box, leitnerBoxName: boxName(s.box), lastResult: s.lastResult || '待复习'
      });
    });
    // 21 天：未取消计划里未完成任务的单词，按各自任务日期计算到期
    plansOf(studentId).forEach(function (p) {
      if (p.status === '已取消') return;
      plan21Tasks(p.id).forEach(function (t) {
        if (isDone(t.status) || !t.wordIds || !t.wordIds.length) return;
        t.wordIds.forEach(function (wid) {
          pushWord(wid, ['21 天'], { dueToday: t.date <= TODAY, dueAt: t.date, planDay: t.day });
        });
      });
    });
    return rows.map(function (r) {
      var w = word(r.wordId);
      var st = wordState(studentId, r.wordId);
      return {
        wordId: r.wordId,
        en: w ? w.en : r.wordId, ph: w ? w.ph : '',
        cn: w ? w.mean.map(function (m) { return m.cn; }).join('；') : '',
        unit: w ? (w.grade + ' ' + w.unit) : '',
        bookIds: wordbookIdsOf(r.wordId), bookNames: wordbookNamesOf(r.wordId),
        systems: r.systems, state: st ? st.state : '未训练',
        dueToday: !!r.extra.dueToday, dueAt: r.extra.dueAt || '',
        leitnerBox: r.extra.leitnerBox || null, leitnerBoxName: r.extra.leitnerBoxName || '',
        lastResult: r.extra.lastResult || ''
      };
    });
  }
  /** 家长待复习三视图：today / all / passed */
  function parentReviewWords(parentId, studentId, options) {
    var pid = assertParentChild(parentId, studentId);
    options = options || {};
    var view = options.view || 'all';
    var system = options.system || 'all';
    var rows = buildParentReviewRows(studentId);
    if (view === 'today') rows = rows.filter(function (r) { return r.dueToday; });
    if (view === 'passed') {
      return wordStates(studentId).filter(function (s) { return s.state === '本次通过'; })
        .map(function (s) {
          var w = word(s.wordId);
          return {
            wordId: s.wordId, en: w ? w.en : s.wordId, ph: w ? w.ph : '', cn: w ? w.mean.map(function (m) { return m.cn; }).join('；') : '',
            unit: w ? (w.grade + ' ' + w.unit) : '', bookIds: wordbookIdsOf(s.wordId), bookNames: wordbookNamesOf(s.wordId),
            systems: ['已通过'], state: s.state, dueToday: false, dueAt: '', leitnerBox: null, leitnerBoxName: '', lastResult: ''
          };
        });
    }
    if (system === 'leitner') rows = rows.filter(function (r) { return r.systems.indexOf('莱特纳') >= 0; });
    if (system === 'plan21') rows = rows.filter(function (r) { return r.systems.indexOf('21 天') >= 0; });
    if (isStr(options.bookId)) rows = rows.filter(function (r) { return r.bookIds.indexOf(options.bookId) >= 0; });
    if (!options.includePassed) rows = rows.filter(function (r) { return r.state !== '本次通过'; });
    var rank = { '待复习': 0, '暂不确定': 1, '待强化训练': 2, '待最后复习': 3, '初筛认识': 4, '本次通过': 5, '未训练': 6 };
    rows.sort(function (a, b) {
      var d = (rank[a.state] === undefined ? 9 : rank[a.state]) - (rank[b.state] === undefined ? 9 : rank[b.state]);
      if (d) return d;
      return a.en < b.en ? -1 : a.en > b.en ? 1 : 0;
    });
    return rows;
  }
  /** 家庭复习记录（家长可见范围，可按日期） */
  function parentFamilyChecks(parentId, studentId, date) {
    var pid = assertParentChild(parentId, studentId);
    var d = date || TODAY;
    return db.familyChecks.filter(function (c) {
      return c.studentId === studentId && (!date || c.date === d);
    }).map(function (c) {
      return { id: c.id, parentId: c.parentId, studentId: c.studentId, wordId: c.wordId, date: c.date, checked: !!c.checked, at: c.at, by: c.by };
    });
  }
  function parentFamilyCheckAt(parentId, studentId, wordId, date) {
    var pid = assertParentChild(parentId, studentId);
    return db.familyChecks.filter(function (c) {
      return c.studentId === studentId && c.wordId === wordId && c.date === (date || TODAY);
    })[0] || null;
  }
  /** 家庭复习勾选：只写辅助表，不改变正式学习状态；记录操作家长与时间 */
  function toggleParentFamilyCheck(parentId, studentId, wordId, checked) {
    var pid = assertParentChild(parentId, studentId);
    if (!isStr(wordId)) throw bizError('WORD_REQUIRED', '单词参数缺失');
    // wordId 必须存在于该学员的有效复习数据中
    var valid = buildParentReviewRows(studentId).some(function (r) { return r.wordId === wordId; });
    var passed = wordStates(studentId).some(function (s) { return s.wordId === wordId && s.state === '本次通过'; });
    if (!valid && !passed) throw bizError('WORD_NOT_REVIEW', '该单词不在该学员的有效复习数据中');
    var p = parent(pid);
    var c = parentFamilyCheckAt(pid, studentId, wordId, TODAY);
    if (checked) {
      if (!c) {
        db.familyChecks.push({
          id: 'FC' + seq('FC', 4), parentId: pid, studentId: studentId, wordId: wordId,
          date: TODAY, checked: true, at: stamp(), by: (p ? p.name : '') || '家长'
        });
      } else {
        c.checked = true; c.parentId = pid; c.at = stamp(); c.by = (p ? p.name : '') || '家长';
      }
    } else if (c) {
      c.checked = false; c.at = stamp();
    }
    save();
    return parentFamilyCheckAt(pid, studentId, wordId, TODAY);
  }
  /** 当前孩子选择状态：五页共享，切换后全局生效 */
  function setParentCurrentChild(parentId, studentId) {
    var pid = resolveParentId(parentId);
    if (!parentHasStudent(pid, studentId)) throw bizError('FORBIDDEN', '不能切换到自己名下的孩子之外');
    try { sessionStorage.setItem('ee_parent_current_child_' + pid, studentId); } catch (e) { /* 降级为内存 */ }
    return studentId;
  }
  function parentCurrentChild(parentId) {
    var pid = resolveParentId(parentId);
    var kids = parentStudents(pid).map(function (s) { return s.id; });
    if (!kids.length) return '';
    var saved = null;
    try { saved = sessionStorage.getItem('ee_parent_current_child_' + pid); } catch (e) { saved = null; }
    if (saved && kids.indexOf(saved) >= 0) return saved;
    return kids[0];
  }
  /* ---------------- 家长咨询 ----------------
     家长只能查看自己的咨询；咨询真实落库并生成教务待处理事项与通知。 */
  function parentInquiries(parentId) {
    var pid = resolveParentId(parentId);
    return db.parentInquiries.filter(function (q) { return q.parentId === pid; })
      .sort(function (a, b) { return a.createdAt < b.createdAt ? 1 : -1; });
  }
  function parentInquiryDetail(parentId, inquiryId) {
    var pid = resolveParentId(parentId);
    var q = db.parentInquiries.filter(function (x) { return x.id === inquiryId && x.parentId === pid; })[0];
    if (!q) throw bizError('INQUIRY_NOT_FOUND', '咨询记录不存在');
    return clone(q);
  }
  function createParentInquiry(input) {
    var pid = resolveParentId();
    if (session.role !== 'parent') throw bizError('FORBIDDEN', '仅家长可发起咨询');
    input = input || {};
    var type = String(input.type || '').trim();
    var content = String(input.content || '').trim();
    if (!content) throw bizError('CONTENT_REQUIRED', '请填写咨询内容');
    var studentId = input.studentId || '';
    if (studentId && !parentHasStudent(pid, studentId)) {
      throw bizError('FORBIDDEN', '只能为孩子发起咨询');
    }
    var p = parent(pid);
    var q = {
      id: 'IQ' + seq('IQ', 3), parentId: pid, studentId: studentId || '',
      type: type || '其他', content: content,
      contact: input.contact || (p ? p.phone : ''),
      status: '待处理', assignedStaffId: '', reply: '',
      createdAt: stamp(), updatedAt: stamp(), resolvedAt: ''
    };
    db.parentInquiries.push(q);
    save();
    var kidName = studentId ? ((student(studentId) || {}).name || '') : '';
    notify('PARENT_INQUIRY', {
      parentId: pid, parentName: (p ? p.name : '') || '家长', studentName: kidName,
      type: q.type, content: q.content, businessId: q.id,
      link: 'admin/parent-inquiry.html?inquiry=' + q.id
    });
    return clone(q);
  }
  /** 教务处理咨询：标记状态 / 填写回复（教务端调用，需权限） */
  function handleParentInquiry(inquiryId, input) {
    assertCan('parent.view');
    input = input || {};
    var q = db.parentInquiries.filter(function (x) { return x.id === inquiryId; })[0];
    if (!q) throw bizError('INQUIRY_NOT_FOUND', '咨询记录不存在');
    if (input.reply !== undefined) {
      q.reply = String(input.reply || '');
      if (q.reply.trim()) q.status = '已回复';
    }
    if (input.status) q.status = input.status;
    if (input.assignedStaffId !== undefined) q.assignedStaffId = input.assignedStaffId;
    q.updatedAt = stamp();
    if (q.status === '已回复' || q.status === '已关闭') q.resolvedAt = q.resolvedAt || stamp();
    if (input.reply !== undefined && input.reply.trim()) {
      notify('PARENT_INQUIRY_REPLIED', {
        parentId: q.parentId, type: q.type, businessId: q.id, link: 'parent/hours.html'
      });
    }
    save();
    return clone(q);
  }
  /** 教务端全量咨询列表：合并家长/孩子姓名，同一权限校验（parent.view），只读投影 */
  function allParentInquiries() {
    assertCan('parent.view');
    return db.parentInquiries.slice().sort(function (a, b) {
      return a.createdAt < b.createdAt ? 1 : -1;
    }).map(function (q) {
      var p = parent(q.parentId);
      var s = q.studentId ? student(q.studentId) : null;
      return {
        id: q.id, parentId: q.parentId, parentName: (p && p.name) || q.parentId,
        studentId: q.studentId, studentName: (s && s.name) || '',
        type: q.type, content: q.content, contact: q.contact,
        status: q.status, assignedStaffId: q.assignedStaffId || '',
        reply: q.reply || '', createdAt: q.createdAt, updatedAt: q.updatedAt, resolvedAt: q.resolvedAt || ''
      };
    });
  }

  /* ---------------- 佣金：本轮只占位预估，不做结算 ---------------- */
  function agentCommissionPreview(agentId, ordersInput) {
    var a = agent(agentId);
    if (!a) return null;
    var os = (ordersInput || db.orders.filter(function (o) { return o.agentId === agentId; }))
      .filter ? ordersInput || null : null;
    var list = ordersInput || db.orders.filter(function (o) { return o.agentId === agentId && o.status === ORDER.CREDITED; });
    var amount = list.filter(function (o) { return o.status === ORDER.CREDITED; })
      .reduce(function (n, o) { return n + Number(o.amount || 0); }, 0);
    var count = list.filter(function (o) { return o.status === ORDER.CREDITED; }).length;
    var estimate = 0;
    if (a.ruleType === 'percent') estimate = amount * Number(a.ruleValue || 0) / 100;
    else if (a.ruleType === 'fixed') estimate = Number(a.ruleValue || 0) * count;
    return {
      agentId: a.id, agentName: a.name, ruleText: a.ruleText,
      ruleType: a.ruleType, ruleValue: a.ruleValue,
      creditedOrders: count, creditedAmount: amount,
      estimatedCommission: Math.round(estimate * 100) / 100,
      settled: false, settlementStatus: '未结算',
      note: '本轮只展示佣金预估；完整结算（应结/已结/打款/冲正）不在范围内，接口已预留 getCommission/agentCommissionPreview。'
    };
  }
  function commissionSummary() {
    return db.agents.filter(function (a) { return a.status === '启用'; }).map(function (a) {
      return agentCommissionPreview(a.id);
    });
  }

  /* ============================================================
     第八轮：系统管理域（统一账号 / 角色权限 / 审计 / 字典 / 通知 / 机构）
     ============================================================ */
  function staffNameOf(acc) {
    if (!acc) return '';
    if (acc.profileType === 'staff') {
      var sp = db.staffProfiles.filter(function (p) { return p.id === acc.profileId; })[0];
      return sp ? sp.name : (acc.loginName || '');
    }
    if (acc.profileType === 'teacher') {
      var t = teacher(acc.profileId || acc.teacherId);
      return t ? t.name : (acc.loginName || '');
    }
    if (acc.profileType === 'agent') {
      var a = agent(acc.profileId);
      return a ? a.name : (acc.loginName || '');
    }
    if (acc.profileType === 'parent') {
      var p = parent(acc.profileId);
      return p ? p.name : (acc.loginName || '');
    }
    return acc.loginName || acc.username || '';
  }
  function accountStatusLabel(status) {
    return status === ACCOUNT.OK ? '启用'
      : status === ACCOUNT.DISABLED ? '禁用'
        : status === ACCOUNT.NONE ? '待激活' : String(status || '');
  }
  function accountById(id) {
    return db.users.filter(function (u) { return u.id === id; })[0] || null;
  }
  function accountOfProfile(profileType, profileId) {
    return db.users.filter(function (u) {
      return u.profileType === profileType && u.profileId === profileId;
    })[0] || null;
  }
  function accountRows(filters) {
    filters = filters || {};
    return db.users.filter(function (u) {
      if (filters.roleCode && u.roleCode !== filters.roleCode) return false;
      if (filters.status && u.status !== filters.status && accountStatusLabel(u.status) !== filters.status) return false;
      if (filters.profileType && u.profileType !== filters.profileType) return false;
      if (filters.keyword) {
        var kw = String(filters.keyword).toLowerCase();
        var hay = [u.loginName, u.phone, staffNameOf(u), u.profileId].join(' ').toLowerCase();
        if (hay.indexOf(kw) < 0) return false;
      }
      return true;
    }).map(function (u) {
      var role = db.roles.filter(function (r) { return r.code === u.roleCode; })[0];
      return {
        id: u.id, loginName: u.loginName, phone: u.phone,
        roleCode: u.roleCode, roleName: role ? role.name : (ROLE_LABEL[u.roleCode] || u.roleCode),
        profileType: u.profileType, profileId: u.profileId, profileName: staffNameOf(u),
        status: u.status, statusLabel: accountStatusLabel(u.status),
        dataScope: role ? role.dataScope : 'ALL',
        dataScopeLabel: role ? (DATA_SCOPE_LABEL[role.dataScope] || role.dataScope) : '全部数据',
        lastLoginAt: u.lastLoginAt || '', createdAt: u.createdAt || '',
        disabledReason: u.disabledReason || '', mustChangePassword: !!u.mustChangePassword
      };
    }).sort(function (a, b) {
      var ra = ROLE_SEED.findIndex(function (r) { return r.code === a.roleCode; });
      var rb = ROLE_SEED.findIndex(function (r) { return r.code === b.roleCode; });
      return ra - rb || (a.profileName < b.profileName ? -1 : 1);
    });
  }
  function accountSummary() {
    var rows = accountRows();
    var enabled = rows.filter(function (r) { return r.status === ACCOUNT.OK; }).length;
    return {
      total: rows.length, enabled: enabled,
      disabled: rows.filter(function (r) { return r.status === ACCOUNT.DISABLED; }).length,
      pending: rows.filter(function (r) { return r.status === ACCOUNT.NONE; }).length,
      byRole: ROLE_SEED.map(function (r) {
        return { code: r.code, name: r.name, count: rows.filter(function (x) { return x.roleCode === r.code; }).length };
      })
    };
  }
  function profileNameOf(type, id) {
    if (type === 'teacher') { var t = teacher(id); return t ? t.name : ''; }
    if (type === 'agent') { var a = agent(id); return a ? a.name : ''; }
    if (type === 'parent') { var p = parent(id); return p ? p.name : ''; }
    var sp = db.staffProfiles.filter(function (x) { return x.id === id; })[0];
    return sp ? sp.name : '';
  }
  function createAccount(input) {
    assertPermission('account.create');
    input = input || {};
    var type = input.profileType;
    var pid = String(input.profileId || '').trim();
    if (['staff', 'teacher', 'agent', 'parent'].indexOf(type) < 0) {
      throw bizError('BAD_PROFILE', '账号必须绑定已有的人员档案（员工/教师/代理/家长）');
    }
    if (!pid) throw bizError('NO_PROFILE', '请选择要绑定的人员档案');
    if (!profileNameOf(type, pid)) throw bizError('PROFILE_NOT_FOUND', '人员档案不存在：' + pid);
    if (accountOfProfile(type, pid)) {
      throw bizError('DUPLICATE_BINDING', '该人员档案已绑定账号，同一人员不能重复开通');
    }
    var roleCode = input.roleCode
      || (type === 'staff' ? '' : type);
    if (type !== 'staff' && roleCode !== type) {
      throw bizError('ROLE_MISMATCH', '教师/代理/家长账号的角色必须与档案类型一致');
    }
    if (!roleCode || !db.roles.some(function (r) { return r.code === roleCode && r.status === '启用'; })) {
      throw bizError('ROLE_NOT_FOUND', '请选择有效角色');
    }
    var loginName = String(input.loginName || input.phone || '').trim();
    if (!loginName) throw bizError('NO_LOGIN', '登录名不能为空');
    if (db.users.some(function (u) { return u.loginName.toLowerCase() === loginName.toLowerCase(); })) {
      throw bizError('DUPLICATE_LOGIN', '登录名已被占用：' + loginName);
    }
    var status = input.status && [ACCOUNT.OK, ACCOUNT.DISABLED, ACCOUNT.NONE].indexOf(input.status) >= 0
      ? input.status : ACCOUNT.OK;
    var now = stamp();
    var acc = {
      id: nextId('UA', 'UA', 3), loginName: loginName, username: loginName,
      phone: String(input.phone || ''), passwordHash: '', mustChangePassword: true,
      status: status, roleCode: roleCode, roleId: roleCode, profileType: type, profileId: pid,
      teacherId: type === 'teacher' ? pid : '', agentId: type === 'agent' ? pid : '',
      parentId: type === 'parent' ? pid : '', staffId: type === 'staff' ? pid : '',
      lastLoginAt: '', disabledReason: status === ACCOUNT.DISABLED ? (input.reason || '新建时禁用') : '',
      openedAt: now, openedBy: operatorForRole(), createdAt: now, updatedAt: now
    };
    db.users.push(acc);
    if (type === 'teacher') {
      var t = teacher(pid);
      t.accountId = acc.id;
      t.updatedAt = now;
      logCoop(t.id, COOP_ACTION.ACCOUNT_OPENED, { reason: '系统管理开通账号', remark: '登录名 ' + loginName });
    } else if (type === 'agent') {
      agent(pid).accountId = acc.id;
    } else if (type === 'parent') {
      parent(pid).accountId = acc.id;
    }
    recordAudit({
      module: '系统管理', action: '账号开通', resourceType: 'account', resourceId: acc.id,
      resourceName: profileNameOf(type, pid) + '（' + loginName + '）',
      beforeData: null, afterData: { loginName: loginName, roleCode: roleCode, status: status },
      reason: input.reason || '为已有人员档案开通登录账号', result: '成功'
    });
    save();
    return clone(acc);
  }
  function updateAccount(accountId, input) {
    assertPermission('account.edit');
    input = input || {};
    var acc = accountById(accountId);
    if (!acc) throw bizError('ACCOUNT_NOT_FOUND', '账号不存在');
    var before = { loginName: acc.loginName, phone: acc.phone, roleCode: acc.roleCode, status: acc.status };
    if (input.loginName !== undefined) {
      var ln = String(input.loginName || '').trim();
      if (!ln) throw bizError('NO_LOGIN', '登录名不能为空');
      if (db.users.some(function (u) { return u.id !== acc.id && u.loginName.toLowerCase() === ln.toLowerCase(); })) {
        throw bizError('DUPLICATE_LOGIN', '登录名已被占用：' + ln);
      }
      acc.loginName = ln; acc.username = ln;
    }
    if (input.phone !== undefined) acc.phone = String(input.phone || '');
    if (input.roleCode !== undefined && input.roleCode !== acc.roleCode) {
      if (acc.profileType !== 'staff' && input.roleCode !== acc.profileType) {
        throw bizError('ROLE_MISMATCH', '教师/代理/家长账号不能改成与档案不一致的角色');
      }
      var role = db.roles.filter(function (r) { return r.code === input.roleCode && r.status === '启用'; })[0];
      if (!role) throw bizError('ROLE_NOT_FOUND', '目标角色不存在或已停用');
      acc.roleCode = role.code; acc.roleId = role.code;
      if (acc.profileType === 'staff') {
        var sp = db.staffProfiles.filter(function (p) { return p.id === acc.profileId; })[0];
        if (sp) sp.roleCode = role.code;
      }
    }
    acc.updatedAt = stamp();
    recordAudit({
      module: '系统管理', action: '账号编辑', resourceType: 'account', resourceId: acc.id,
      resourceName: staffNameOf(acc) + '（' + acc.loginName + '）',
      beforeData: before, afterData: { loginName: acc.loginName, phone: acc.phone, roleCode: acc.roleCode },
      reason: input.reason || '修改账号信息', result: '成功'
    });
    save();
    return clone(acc);
  }
  function normalizeAccountStatus(status) {
    if (status === '启用' || status === '正常') return ACCOUNT.OK;
    if (status === '禁用' || status === '已禁用') return ACCOUNT.DISABLED;
    if (status === '待激活' || status === '未开通') return ACCOUNT.NONE;
    return status;
  }
  function setUserAccountStatus(accountId, status, opt) {
    assertPermission('account.disable');
    opt = opt || {};
    var acc = accountById(accountId);
    if (!acc) throw bizError('ACCOUNT_NOT_FOUND', '账号不存在');
    var next = normalizeAccountStatus(status);
    if ([ACCOUNT.OK, ACCOUNT.DISABLED, ACCOUNT.NONE].indexOf(next) < 0) {
      throw bizError('BAD_STATUS', '账号状态只能是启用/禁用/待激活');
    }
    if (acc.status === next) return clone(acc);
    if (next !== ACCOUNT.OK && !String(opt.reason || '').trim()) {
      throw bizError('REASON_REQUIRED', '封禁/停用账号必须填写原因');
    }
    var currentAcc = accountForSession();
    if (next !== ACCOUNT.OK && currentAcc && currentAcc.id === acc.id) {
      throw bizError('SELF_DISABLE', '不能禁用当前正在使用的账号');
    }
    if (next !== ACCOUNT.OK && acc.roleCode === 'admin') {
      var otherAdmin = db.users.filter(function (u) {
        return u.roleCode === 'admin' && u.status === ACCOUNT.OK && u.id !== acc.id;
      }).length;
      if (!otherAdmin) throw bizError('LAST_ADMIN', '不能禁用最后一个可用的管理员账号');
    }
    var before = { status: acc.status, disabledReason: acc.disabledReason };
    acc.status = next;
    acc.disabledReason = next === ACCOUNT.OK ? '' : String(opt.reason || '');
    acc.disabledAt = next === ACCOUNT.OK ? '' : stamp();
    acc.updatedAt = stamp();
    if (next === ACCOUNT.DISABLED && session.accountId === acc.id) session.accountId = '';
    recordAudit({
      module: '系统管理', action: next === ACCOUNT.OK ? '启用账号' : '禁用账号',
      resourceType: 'account', resourceId: acc.id,
      resourceName: staffNameOf(acc) + '（' + acc.loginName + '）',
      beforeData: before, afterData: { status: acc.status, disabledReason: acc.disabledReason },
      reason: opt.reason || '手动调整账号状态', result: '成功'
    });
    save();
    return clone(acc);
  }
  function resetAccountCredential(accountId, opt) {
    assertPermission('account.reset_credential');
    opt = opt || {};
    var acc = accountById(accountId);
    if (!acc) throw bizError('ACCOUNT_NOT_FOUND', '账号不存在');
    acc.passwordHash = '';
    acc.mustChangePassword = true;
    acc.credentialResetAt = stamp();
    acc.updatedAt = stamp();
    recordAudit({
      module: '系统管理', action: '重置登录凭证', resourceType: 'account', resourceId: acc.id,
      resourceName: staffNameOf(acc) + '（' + acc.loginName + '）',
      beforeData: { mustChangePassword: true }, afterData: { mustChangePassword: true },
      reason: opt.reason || '管理员重置凭证', result: '成功'
    });
    save();
    return clone(acc);
  }

  /* ---------- 角色与权限 ---------- */
  function roles() { return db.roles.slice(); }
  function roleOf(roleId) {
    return db.roles.filter(function (r) { return r.id === roleId || r.code === roleId; })[0] || null;
  }
  function roleRows() {
    return db.roles.map(function (r) {
      var members = db.users.filter(function (u) { return u.roleCode === r.code && u.status === ACCOUNT.OK; });
      var enabledCount = db.rolePermissions.filter(function (rp) {
        return rp.roleCode === r.code && rp.enabled;
      }).length;
      return {
        id: r.id, code: r.code, name: r.name, description: r.description,
        dataScope: r.dataScope, dataScopeLabel: DATA_SCOPE_LABEL[r.dataScope] || r.dataScope,
        memberCount: members.length, permissionCount: enabledCount,
        totalPermissionCount: db.permissions.length,
        system: !!r.system, status: r.status,
        updatedAt: r.updatedAt || '', updatedBy: r.updatedBy || ''
      };
    });
  }
  function permissionCatalog() {
    return db.permissions.map(function (p) {
      return { code: p.code, module: p.module, name: p.name, description: p.description, type: p.type };
    });
  }
  function permissionMatrix(roleId) {
    var r = roleOf(roleId);
    if (!r) throw bizError('ROLE_NOT_FOUND', '角色不存在');
    var modules = [];
    db.permissions.forEach(function (p) {
      var group = modules.filter(function (m) { return m.module === p.module; })[0];
      if (!group) { group = { module: p.module, items: [] }; modules.push(group); }
      var rp = rolePermissionOf(r.code, p.code);
      group.items.push({
        code: p.code, name: p.name, description: p.description, type: p.type,
        enabled: !!(rp && rp.enabled), dataScope: rp ? rp.dataScope : r.dataScope
      });
    });
    return {
      role: { id: r.id, code: r.code, name: r.name, dataScope: r.dataScope, system: !!r.system },
      modules: modules, dataScopeOptions: DATA_SCOPE_STATUS.map(function (s) {
        return { code: s, label: DATA_SCOPE_LABEL[s] || s };
      })
    };
  }
  function updateRolePermissions(roleId, permissions, opt) {
    assertPermission('permission.configure');
    opt = opt || {};
    var r = roleOf(roleId);
    if (!r) throw bizError('ROLE_NOT_FOUND', '角色不存在');
    var list = Array.isArray(permissions) ? permissions : (permissions && permissions.permissions) || [];
    if (!list.length) throw bizError('EMPTY_PERMISSION', '至少保留一项权限');
    var before = {};
    db.rolePermissions.forEach(function (rp) {
      if (rp.roleCode === r.code) before[rp.permissionCode] = rp.enabled;
    });
    list.forEach(function (item) {
      if (!item || !item.code) return;
      var rp = rolePermissionOf(r.code, item.code);
      if (!rp) return;
      if (r.code === 'admin' && item.code === 'permission.configure' && item.enabled === false) {
        throw bizError('PROTECTED_PERMISSION', '机构管理员必须保留「配置角色权限」，避免机构失去管理入口');
      }
      rp.enabled = !!item.enabled;
      if (item.dataScope && DATA_SCOPE_STATUS.indexOf(item.dataScope) >= 0) rp.dataScope = item.dataScope;
      rp.updatedAt = stamp();
      rp.updatedBy = operatorForRole();
    });
    if (opt.dataScope && DATA_SCOPE_STATUS.indexOf(opt.dataScope) >= 0) {
      r.dataScope = opt.dataScope;
      db.rolePermissions.forEach(function (rp) { if (rp.roleCode === r.code) rp.dataScope = opt.dataScope; });
    }
    r.updatedAt = stamp();
    r.updatedBy = operatorForRole();
    recordAudit({
      module: '系统管理', action: '修改角色权限', resourceType: 'role', resourceId: r.id,
      resourceName: r.name, beforeData: before,
      afterData: (function () {
        var out = {};
        db.rolePermissions.forEach(function (rp) { if (rp.roleCode === r.code) out[rp.permissionCode] = rp.enabled; });
        return out;
      })(),
      reason: opt.reason || '调整角色菜单与操作权限', result: '成功'
    });
    save();
    return permissionMatrix(r.id);
  }
  function resetRolePermissions(roleId, opt) {
    assertPermission('permission.configure');
    var r = roleOf(roleId);
    if (!r) throw bizError('ROLE_NOT_FOUND', '角色不存在');
    var def = DEFAULT_PERM[r.code];
    if (!def) throw bizError('NO_DEFAULT', '自定义角色没有预置权限可恢复');
    db.rolePermissions.forEach(function (rp) {
      if (rp.roleCode !== r.code) return;
      rp.enabled = !!def.all || (def.codes || []).indexOf(rp.permissionCode) >= 0;
      rp.dataScope = def.dataScope || r.dataScope;
      rp.updatedAt = stamp();
      rp.updatedBy = operatorForRole();
    });
    r.dataScope = def.dataScope || r.dataScope;
    recordAudit({
      module: '系统管理', action: '恢复默认权限', resourceType: 'role', resourceId: r.id,
      resourceName: r.name, beforeData: null, afterData: { dataScope: r.dataScope },
      reason: (opt && opt.reason) || '恢复角色预置权限', result: '成功'
    });
    save();
    return permissionMatrix(r.id);
  }
  function createRole(input) {
    assertPermission('role.edit');
    input = input || {};
    var name = String(input.name || '').trim();
    if (!name) throw bizError('NO_NAME', '角色名称不能为空');
    var code = String(input.code || '').trim().replace(/[^a-zA-Z0-9_]/g, '');
    if (!code) code = 'custom_' + (db.roles.length + 1);
    if (db.roles.some(function (r) { return r.code === code; })) throw bizError('DUPLICATE_ROLE', '角色编码已存在');
    var role = {
      id: nextId('R', 'R', 3), code: code, name: name,
      description: String(input.description || '自定义角色'),
      dataScope: DATA_SCOPE_STATUS.indexOf(input.dataScope) >= 0 ? input.dataScope : 'ALL',
      system: false, status: '启用', createdAt: stamp(), updatedAt: stamp()
    };
    db.roles.push(role);
    db.permissions.forEach(function (p) {
      db.rolePermissions.push({
        id: 'RP-' + code + '-' + p.code, roleId: role.id, roleCode: code,
        permissionId: p.id, permissionCode: p.code, enabled: false,
        dataScope: role.dataScope, updatedAt: stamp(), updatedBy: operatorForRole()
      });
    });
    recordAudit({
      module: '系统管理', action: '新建角色', resourceType: 'role', resourceId: role.id,
      resourceName: role.name, beforeData: null, afterData: { code: role.code, dataScope: role.dataScope },
      reason: input.reason || '新建自定义角色', result: '成功'
    });
    save();
    return clone(role);
  }
  function updateRole(roleId, input) {
    assertPermission('role.edit');
    input = input || {};
    var r = roleOf(roleId);
    if (!r) throw bizError('ROLE_NOT_FOUND', '角色不存在');
    var before = { name: r.name, description: r.description, dataScope: r.dataScope, status: r.status };
    if (input.name !== undefined) {
      if (!String(input.name || '').trim()) throw bizError('NO_NAME', '角色名称不能为空');
      r.name = String(input.name).trim();
    }
    if (input.description !== undefined) r.description = String(input.description || '');
    if (input.status !== undefined) {
      if (r.system && input.status === '停用') throw bizError('SYSTEM_ROLE', '系统角色不能停用');
      r.status = input.status === '停用' ? '停用' : '启用';
    }
    r.updatedAt = stamp(); r.updatedBy = operatorForRole();
    recordAudit({
      module: '系统管理', action: '编辑角色', resourceType: 'role', resourceId: r.id,
      resourceName: r.name, beforeData: before,
      afterData: { name: r.name, description: r.description, status: r.status },
      reason: input.reason || '维护角色信息', result: '成功'
    });
    save();
    return clone(r);
  }
  function roleAccounts(roleCode) {
    return db.users.filter(function (u) {
      return u.roleCode === roleCode;
    }).map(function (u) {
      var name = staffNameOf(u);
      var available = u.status === ACCOUNT.OK;
      var reason = '';
      if (!available) {
        reason = u.status === ACCOUNT.NONE ? '账号未开通' : (u.disabledReason || '账号已禁用');
      }
      if (available && u.profileType === 'teacher') {
        var t = teacher(u.profileId);
        if (!t || t.cooperationStatus !== COOP.READY) {
          available = false;
          reason = '合作状态：' + ((t && t.cooperationStatus) || '未知');
        }
      }
      if (available && u.profileType === 'agent') {
        var a = agent(u.profileId);
        if (!a || a.status !== '启用') {
          available = false;
          reason = a ? (a.status === '待审核' ? '代理待审核，暂不可登录' : '代理已停用') : '代理档案不存在';
        }
      }
      if (available && u.profileType === 'parent') {
        var p = parent(u.profileId);
        if (!p || p.status === '停用') {
          available = false;
          reason = '家长账号已停用';
        }
      }
      return {
        accountId: u.id, id: u.profileId, profileId: u.profileId, profileType: u.profileType,
        name: name, code: u.profileId || u.id, available: available, reason: reason,
        status: u.status, statusLabel: accountStatusLabel(u.status),
        meta: ROLE_LABEL[u.roleCode] || u.roleCode
      };
    }).sort(function (a, b) { return a.code < b.code ? -1 : 1; });
  }
  function currentIdentity() {
    var role = session.role;
    var acc = accountForSession();
    var base = {
      role: role, roleName: ROLE_LABEL[role] || role,
      accountId: acc ? acc.id : '', available: true, reason: ''
    };
    if (role === 'teacher') {
      if (!session.teacherId) return mergeIdentity(base, { name: '未识别教师身份', code: '', available: false });
      var t = teacher(session.teacherId);
      if (!t) return mergeIdentity(base, { name: '未识别教师身份', code: '', available: false });
      var ok = acc ? acc.status === ACCOUNT.OK && t.cooperationStatus === COOP.READY : t.cooperationStatus === COOP.READY;
      return mergeIdentity(base, {
        name: t.name, code: t.id, available: ok,
        reason: ok ? '' : (acc && acc.status !== ACCOUNT.OK ? '账号' + accountStatusLabel(acc.status) : '合作状态：' + t.cooperationStatus)
      });
    }
    if (role === 'agent') {
      var a = session.agentId ? agent(session.agentId) : null;
      if (!a) return mergeIdentity(base, { name: '未识别代理身份', code: '', available: false });
      return mergeIdentity(base, { name: a.name, code: a.id, available: a.status === '启用', reason: a.status === '启用' ? '' : '代理' + a.status });
    }
    if (role === 'parent') {
      var p = session.parentId ? parent(session.parentId) : null;
      if (!p) return mergeIdentity(base, { name: '未识别家长身份', code: '', available: false });
      return mergeIdentity(base, { name: p.name, code: p.id, available: p.status !== '停用', reason: p.status === '停用' ? '家长账号已停用' : '' });
    }
    if (!acc) return mergeIdentity(base, { name: '未识别员工身份', code: '', available: false });
    return mergeIdentity(base, { name: staffNameOf(acc), code: acc.profileId, available: acc.status === ACCOUNT.OK });
  }
  function mergeIdentity(base, extra) {
    var out = clone(base);
    Object.keys(extra || {}).forEach(function (k) { out[k] = extra[k]; });
    return out;
  }

  /* ---------- 数据范围 ---------- */
  function identityOf(userId) {
    if (userId) {
      var u = db.users.filter(function (x) {
        return x.id === userId || x.profileId === userId || x.loginName === userId;
      })[0];
      if (u) {
        return {
          roleCode: u.roleCode, teacherId: u.teacherId || (u.profileType === 'teacher' ? u.profileId : ''),
          agentId: u.profileType === 'agent' ? u.profileId : '',
          parentId: u.profileType === 'parent' ? u.profileId : ''
        };
      }
      if (ROLE_SEED.some(function (r) { return r.code === userId; })) {
        return { roleCode: userId, teacherId: '', agentId: '', parentId: '' };
      }
      return null;
    }
    return {
      roleCode: session.role, teacherId: session.teacherId,
      agentId: session.agentId, parentId: session.parentId
    };
  }
  function teacherHasStudent(teacherId, studentId) {
    return db.teacherStudents.some(function (r) {
      return r.teacherId === teacherId && r.studentId === studentId && !r.endAt;
    });
  }
  function parentHasStudent(parentId, studentId) {
    return db.parentStudents.some(function (r) {
      return r.parentId === parentId && r.studentId === studentId && !r.endAt;
    });
  }
  function agentHasLead(agentId, leadId) {
    var l = db.leads.filter(function (x) { return x.id === leadId; })[0];
    if (!l) return false;
    return leadCurrentAgentId(l) === agentId || l.sourceAgentId === agentId || l.agentId === agentId;
  }
  function hasDataAccess(userId, resourceType, resourceId, action) {
    var id = identityOf(userId);
    if (!id) return false;
    var scope = roleDataScope(id.roleCode);
    if (scope === 'ALL') return true;
    if (scope === 'ASSIGNED') {
      if (!id.teacherId) return false;
      if (resourceType === 'student') return teacherHasStudent(id.teacherId, resourceId);
      if (resourceType === 'course') {
        var c = db.courses.filter(function (x) { return x.id === resourceId; })[0];
        return !!c && c.teacherId === id.teacherId;
      }
      if (resourceType === 'report') {
        var rp = db.reports.filter(function (x) { return x.id === resourceId; })[0];
        return !!rp && rp.teacherId === id.teacherId;
      }
      if (resourceType === 'demand') {
        var d = db.studentDemands.filter(function (x) { return x.id === resourceId; })[0];
        return !!d && (d.teacherId === id.teacherId || d.selectedTeacherId === id.teacherId);
      }
      if (resourceType === 'account') return resourceId === id.teacherId;
      return false;
    }
    if (scope === 'OWN') {
      if (!id.agentId) return false;
      if (resourceType === 'lead') return agentHasLead(id.agentId, resourceId);
      if (resourceType === 'order') {
        var o = db.orders.filter(function (x) { return x.id === resourceId; })[0];
        return !!o && o.agentId === id.agentId;
      }
      if (resourceType === 'student') {
        var s = db.students.filter(function (x) { return x.id === resourceId; })[0];
        if (!s) return false;
        if (s.agentId === id.agentId) return true;
        var lo = db.orders.filter(function (x) { return x.studentId === s.id && x.agentId === id.agentId; })[0];
        if (lo) return true;
        return db.leads.some(function (l) {
          return l.convertedStudentId === s.id && agentHasLead(id.agentId, l.id);
        });
      }
      if (resourceType === 'renewal') {
        var rn = db.renewalOpportunities.filter(function (x) { return x.id === resourceId; })[0];
        return !!rn && rn.agentId === id.agentId;
      }
      if (resourceType === 'report') {
        var rp2 = db.reports.filter(function (x) { return x.id === resourceId; })[0];
        if (!rp2) return false;
        return db.orders.some(function (o2) {
          return o2.studentId === rp2.studentId && o2.agentId === id.agentId;
        });
      }
      if (resourceType === 'account') return resourceId === id.agentId;
      return false;
    }
    if (scope === 'RELATED') {
      if (!id.parentId) return false;
      if (resourceType === 'student') return parentHasStudent(id.parentId, resourceId);
      if (resourceType === 'order') {
        var o3 = db.orders.filter(function (x) { return x.id === resourceId; })[0];
        return !!o3 && (o3.parentId === id.parentId ||
          parentHasStudent(id.parentId, o3.studentId));
      }
      if (resourceType === 'report') {
        var rp3 = db.reports.filter(function (x) { return x.id === resourceId; })[0];
        return !!rp3 && parentHasStudent(id.parentId, rp3.studentId);
      }
      if (resourceType === 'course') {
        var c2 = db.courses.filter(function (x) { return x.id === resourceId; })[0];
        return !!c2 && parentHasStudent(id.parentId, c2.studentId);
      }
      if (resourceType === 'account') return resourceId === id.parentId;
      return false;
    }
    return false;
  }
  function assertDataAccess(resourceType, resourceId) {
    if (!hasDataAccess('', resourceType, resourceId)) {
      throw bizError('FORBIDDEN', '当前身份无权访问该' + resourceType + '：' + resourceId);
    }
  }
  function roleDataScope(roleCode) {
    var r = db.roles.filter(function (x) { return x.code === roleCode; })[0];
    return r ? r.dataScope : 'ALL';
  }

  /* ---------- 操作审计 ---------- */
  function recordAudit(input) {
    input = input || {};
    var acc = accountForSession();
    var row = {
      id: 'AUD' + seq('audit', 4),
      operatorId: session.accountId || session.accountId || session.operatorId || session.role,
      operatorName: (acc && staffNameOf(acc)) || session.operatorName || (ROLE_LABEL[session.role] || session.role),
      operatorRole: session.role, operatorRoleLabel: ROLE_LABEL[session.role] || session.role,
      accountId: acc ? acc.id : '', identityId: acc ? acc.profileId : '',
      module: input.module || '系统管理', action: input.action || '操作',
      resourceType: input.resourceType || '', resourceId: input.resourceId || '',
      resourceName: input.resourceName || '',
      beforeData: input.beforeData === undefined ? null : input.beforeData,
      afterData: input.afterData === undefined ? null : input.afterData,
      reason: input.reason || '', result: input.result || '成功',
      errorMessage: input.errorMessage || '',
      createdAt: stamp()
    };
    db.auditLogs.push(row);
    return row;
  }
  function auditRows(filters) {
    assertCan('audit.view');
    filters = filters || {};
    var list = db.auditLogs.slice();
    if (filters.module) list = list.filter(function (x) { return x.module === filters.module; });
    if (filters.resourceType) list = list.filter(function (x) { return x.resourceType === filters.resourceType; });
    if (filters.resourceId) list = list.filter(function (x) { return x.resourceId === filters.resourceId; });
    if (filters.operatorRole) list = list.filter(function (x) { return x.operatorRole === filters.operatorRole; });
    if (filters.keyword) {
      var kw = String(filters.keyword).toLowerCase();
      list = list.filter(function (x) {
        return [x.operatorName, x.action, x.resourceName, x.resourceId, x.reason].join(' ').toLowerCase().indexOf(kw) >= 0;
      });
    }
    if (filters.action) list = list.filter(function (x) { return x.action.indexOf(filters.action) >= 0; });
    return list.sort(function (a, b) { return a.createdAt < b.createdAt ? 1 : -1; });
  }
  function auditOf(auditId) {
    assertCan('audit.view');
    return db.auditLogs.filter(function (x) { return x.id === auditId; })[0] || null;
  }
  function auditStat() {
    assertCan('audit.view');
    var rows = db.auditLogs;
    return {
      total: rows.length,
      today: rows.filter(function (x) { return String(x.createdAt).slice(0, 10) === TODAY; }).length,
      failed: rows.filter(function (x) { return x.result === '失败'; }).length,
      modules: (function () {
        var m = {};
        rows.forEach(function (x) { m[x.module] = (m[x.module] || 0) + 1; });
        return m;
      })()
    };
  }

  /* ---------- 数据字典 ---------- */
  function dictionaryTypes(includeDisabled) {
    return db.dictionaryTypes.filter(function (t) {
      return includeDisabled || t.status === '启用';
    }).map(function (t) {
      return {
        id: t.id, code: t.code, name: t.name, description: t.description, status: t.status,
        itemCount: db.dictionaryItems.filter(function (x) { return x.typeCode === t.code; }).length,
        enabledCount: db.dictionaryItems.filter(function (x) {
          return x.typeCode === t.code && x.status === '启用';
        }).length
      };
    });
  }
  function dictionaryItems(typeCode, includeDisabled) {
    return db.dictionaryItems.filter(function (x) {
      return x.typeCode === typeCode && (includeDisabled || x.status === '启用');
    }).sort(function (a, b) { return Number(a.sort || 0) - Number(b.sort || 0); })
      .map(function (x) {
        return {
          id: x.id, typeCode: x.typeCode, label: x.label, value: x.value || x.label,
          sort: x.sort, status: x.status, remark: x.remark || '',
          usage: dictionaryUsage(x.typeCode, x.label)
        };
      });
  }
  function dictionaryOptions(typeCode) {
    return dictionaryItems(typeCode).map(function (x) { return x.label; });
  }
  function dictionaryHas(typeCode, label) {
    return dictionaryItems(typeCode).some(function (x) { return x.label === label || x.value === label; });
  }
  function dictionaryItem(id) {
    return db.dictionaryItems.filter(function (x) { return x.id === id; })[0] || null;
  }
  function dictionaryUsage(typeCode, label) {
    var n = 0;
    function has(v) { return v === label; }
    if (typeCode === 'lead_channel') n = db.leads.filter(function (l) { return has(l.channel); }).length;
    else if (typeCode === 'lead_level') n = db.leads.filter(function (l) { return has(l.level); }).length;
    else if (typeCode === 'follow_type') n = db.leadFollowUps.filter(function (f) { return has(f.type || f.method); }).length;
    else if (typeCode === 'agent_type') n = db.agents.filter(function (a) { return has(a.type); }).length;
    else if (typeCode === 'pay_method') n = db.payments.filter(function (p) { return has(p.method); }).length;
    else if (typeCode === 'grade') {
      n = db.students.filter(function (s) { return has(s.grade); }).length +
        db.studentDemands.filter(function (d) { return has(d.grade); }).length;
    } else if (typeCode === 'textbook') {
      n = db.students.filter(function (s) { return has(s.book); }).length +
        db.teachers.filter(function (t) { return (t.textbooks || []).indexOf(label) >= 0; }).length;
    } else if (typeCode === 'relation') n = db.parents.filter(function (p) { return has(p.relation); }).length;
    else if (typeCode === 'decline_reason') n = db.teacherResponses.filter(function (r) { return has(r.declineReason); }).length;
    return n;
  }
  function createDictionaryItem(input) {
    assertPermission('dictionary.manage');
    input = input || {};
    var typeCode = String(input.typeCode || '').trim();
    var type = db.dictionaryTypes.filter(function (t) { return t.code === typeCode; })[0];
    if (!type) throw bizError('DICT_TYPE_NOT_FOUND', '字典类型不存在：' + typeCode);
    if (type.status !== '启用') throw bizError('DICT_TYPE_DISABLED', '该字典类型已停用');
    var label = String(input.label || '').trim();
    if (!label) throw bizError('NO_LABEL', '字典项名称不能为空');
    if (db.dictionaryItems.some(function (x) { return x.typeCode === typeCode && x.label === label; })) {
      throw bizError('DUPLICATE_ITEM', '同一字典类型下已存在「' + label + '」');
    }
    var maxSort = db.dictionaryItems.filter(function (x) { return x.typeCode === typeCode; })
      .reduce(function (m, x) { return Math.max(m, Number(x.sort || 0)); }, 0);
    var item = {
      id: 'DI' + seq('DI', 3), typeCode: typeCode, label: label,
      value: String(input.value || label), sort: input.sort ? Number(input.sort) : maxSort + 1,
      status: '启用', remark: String(input.remark || ''), createdAt: stamp(), updatedAt: stamp()
    };
    db.dictionaryItems.push(item);
    recordAudit({
      module: '数据字典', action: '新增字典项', resourceType: 'dictionary', resourceId: item.id,
      resourceName: type.name + ' / ' + label, beforeData: null,
      afterData: { typeCode: typeCode, label: label, sort: item.sort },
      reason: input.reason || '业务需要新增下拉选项', result: '成功'
    });
    save();
    return clone(item);
  }
  function updateDictionaryItem(itemId, input) {
    assertPermission('dictionary.manage');
    input = input || {};
    var item = dictionaryItem(itemId);
    if (!item) throw bizError('DICT_ITEM_NOT_FOUND', '字典项不存在');
    var before = { label: item.label, sort: item.sort, status: item.status, remark: item.remark };
    if (input.label !== undefined) {
      var label = String(input.label || '').trim();
      if (!label) throw bizError('NO_LABEL', '字典项名称不能为空');
      if (db.dictionaryItems.some(function (x) {
        return x.id !== item.id && x.typeCode === item.typeCode && x.label === label;
      })) throw bizError('DUPLICATE_ITEM', '同一字典类型下已存在「' + label + '」');
      item.label = label;
      if (!input.value) item.value = label;
    }
    if (input.value !== undefined) item.value = String(input.value || '');
    if (input.sort !== undefined) item.sort = Number(input.sort) || item.sort;
    if (input.remark !== undefined) item.remark = String(input.remark || '');
    if (input.status !== undefined) item.status = input.status === '停用' ? '停用' : '启用';
    item.updatedAt = stamp();
    recordAudit({
      module: '数据字典', action: '编辑字典项', resourceType: 'dictionary', resourceId: item.id,
      resourceName: item.typeCode + ' / ' + item.label, beforeData: before,
      afterData: { label: item.label, sort: item.sort, status: item.status, remark: item.remark },
      reason: input.reason || '维护字典项', result: '成功'
    });
    save();
    return clone(item);
  }
  function removeDictionaryItem(itemId, opt) {
    assertPermission('dictionary.manage');
    var item = dictionaryItem(itemId);
    if (!item) throw bizError('DICT_ITEM_NOT_FOUND', '字典项不存在');
    var used = dictionaryUsage(item.typeCode, item.label);
    if (used > 0) {
      throw bizError('IN_USE', '当前字典项被 ' + used + ' 条历史业务数据引用，只能停用不能删除', { usage: used });
    }
    db.dictionaryItems = db.dictionaryItems.filter(function (x) { return x.id !== item.id; });
    recordAudit({
      module: '数据字典', action: '删除字典项', resourceType: 'dictionary', resourceId: item.id,
      resourceName: item.typeCode + ' / ' + item.label, beforeData: { label: item.label, status: item.status },
      afterData: null, reason: (opt && opt.reason) || '删除未被引用的字典项', result: '成功'
    });
    save();
    return true;
  }

  /* ---------- 消息通知 ---------- */
  function currentReceiver() {
    if (session.role === 'teacher') return { role: 'teacher', id: session.teacherId || '' };
    if (session.role === 'agent') return { role: 'agent', id: session.agentId || '' };
    if (session.role === 'parent') return { role: 'parent', id: session.parentId || '' };
    var acc = accountForSession();
    return { role: session.role, id: acc ? acc.id : (session.accountId || '') };
  }
  function renderNotifyTemplate(tpl, payload) {
    return String(tpl || '').replace(/\{(\w+)\}/g, function (m, k) {
      return payload && payload[k] != null ? String(payload[k]) : '';
    });
  }
  function notify(eventCode, payload, opt) {
    opt = opt || {};
    payload = payload || {};
    var rules = db.notificationRules.filter(function (r) {
      return r.event === eventCode && r.enabled;
    });
    var created = [];
    rules.forEach(function (rule) {
      var role = rule.receiverRole;
      var targets = [];
      if (role === 'teacher') {
        if (payload.teacherId) {
          targets = db.users.filter(function (u) {
            return u.roleCode === 'teacher' && u.profileId === payload.teacherId && u.status === ACCOUNT.OK;
          });
        } else {
          targets = db.users.filter(function (u) { return u.roleCode === 'teacher' && u.status === ACCOUNT.OK; });
        }
      } else if (role === 'agent') {
        targets = payload.agentId ? db.users.filter(function (u) {
          return u.roleCode === 'agent' && u.profileId === payload.agentId && u.status === ACCOUNT.OK;
        }) : [];
      } else if (role === 'parent') {
        targets = payload.parentId ? db.users.filter(function (u) {
          return u.roleCode === 'parent' && u.profileId === payload.parentId && u.status === ACCOUNT.OK;
        }) : [];
      } else {
        targets = db.users.filter(function (u) { return u.roleCode === role && u.status === ACCOUNT.OK; });
      }
      targets.forEach(function (u) {
        var dup = db.notifications.some(function (n) {
          return n.eventCode === eventCode && n.ruleId === rule.id &&
            n.receiverRole === role && n.receiverId === (role === 'teacher' || role === 'agent' || role === 'parent' ? u.profileId : u.id) &&
            n.businessId === (payload.businessId || '');
        });
        if (dup && !opt.allowDuplicate) return;
        var receiverId = (role === 'teacher' || role === 'agent' || role === 'parent') ? u.profileId : u.id;
        var n = {
          id: 'NT' + seq('NT', 3), ruleId: rule.id, eventCode: eventCode, eventName: rule.name,
          receiverRole: role, receiverId: receiverId, receiverAccountId: u.id,
          receiverName: staffNameOf(u),
          title: renderNotifyTemplate(rule.titleTemplate, payload),
          content: renderNotifyTemplate(rule.contentTemplate, payload),
          businessType: payload.businessType || rule.businessType || '',
          businessId: payload.businessId || '',
          link: payload.link || defaultNotificationLink(rule, payload),
          readAt: '', createdAt: stamp()
        };
        db.notifications.push(n);
        created.push(n);
      });
    });
    return created;
  }
  function defaultNotificationLink(rule, payload) {
    var id = payload.businessId || '';
    if (payload.link) return payload.link;
    if (rule.businessType === 'lead') return 'agent/customer-detail.html?id=' + id;
    if (rule.businessType === 'order') {
      if (rule.receiverRole === 'parent') return 'parent/hours.html';
      if (rule.receiverRole === 'agent') return 'agent/workbench.html';
      return 'admin/order-list.html?id=' + id;
    }
    if (rule.businessType === 'demand') {
      if (rule.receiverRole === 'teacher') return 'teacher/demand-center.html?tab=open';
      return 'admin/assign-task.html';
    }
    if (rule.businessType === 'wordbookRequest') return 'teacher/demand-center.html?tab=wbreq';
    if (rule.businessType === 'report') return 'parent/report.html?id=' + id;
    if (rule.businessType === 'renewal') return 'agent/renewal-list.html';
    return 'notifications.html';
  }
  function notificationRows(filters) {
    filters = filters || {};
    var me = currentReceiver();
    var list = db.notifications.filter(function (n) {
      if (filters.all) return true;
      return n.receiverRole === me.role && n.receiverId === me.id;
    });
    if (filters.unread) list = list.filter(function (n) { return !n.readAt; });
    if (filters.eventCode) list = list.filter(function (n) { return n.eventCode === filters.eventCode; });
    return list.sort(function (a, b) { return a.createdAt < b.createdAt ? 1 : -1; });
  }
  function unreadNotificationCount() {
    return notificationRows({ unread: true }).length;
  }
  function markNotificationRead(notificationId) {
    var me = currentReceiver();
    var n = db.notifications.filter(function (x) { return x.id === notificationId; })[0];
    if (!n) throw bizError('NOTIFY_NOT_FOUND', '通知不存在');
    if (n.receiverRole !== me.role || n.receiverId !== me.id) {
      throw bizError('FORBIDDEN', '不能操作他人的通知');
    }
    if (!n.readAt) { n.readAt = stamp(); save(); }
    return clone(n);
  }
  function markAllNotificationsRead() {
    var me = currentReceiver();
    var n = 0;
    db.notifications.forEach(function (x) {
      if (x.receiverRole === me.role && x.receiverId === me.id && !x.readAt) { x.readAt = stamp(); n++; }
    });
    if (n) save();
    return n;
  }
  function notificationRules() { return db.notificationRules.map(function (r) { return clone(r); }); }
  function updateNotificationRule(ruleId, input) {
    assertPermission('notification.manage');
    input = input || {};
    var r = db.notificationRules.filter(function (x) { return x.id === ruleId; })[0];
    if (!r) throw bizError('RULE_NOT_FOUND', '通知规则不存在');
    var before = {
      enabled: r.enabled, titleTemplate: r.titleTemplate, contentTemplate: r.contentTemplate
    };
    if (input.enabled !== undefined) r.enabled = !!input.enabled;
    if (input.titleTemplate !== undefined) r.titleTemplate = String(input.titleTemplate || '');
    if (input.contentTemplate !== undefined) r.contentTemplate = String(input.contentTemplate || '');
    if (input.receiverRole !== undefined && ROLE_SEED.some(function (x) { return x.code === input.receiverRole; })) {
      r.receiverRole = input.receiverRole;
    }
    r.updatedAt = stamp(); r.updatedBy = operatorForRole();
    recordAudit({
      module: '消息通知', action: '编辑通知规则', resourceType: 'notificationRule', resourceId: r.id,
      resourceName: r.name, beforeData: before,
      afterData: { enabled: r.enabled, titleTemplate: r.titleTemplate, contentTemplate: r.contentTemplate },
      reason: input.reason || '调整通知模板/开关', result: '成功'
    });
    save();
    return clone(r);
  }
  function allNotifications(filters) {
    filters = filters || {};
    filters.all = true;
    return notificationRows(filters);
  }

  /* ---------- 机构设置 ---------- */
  function organizationSettings() { return clone(db.organization); }
  function updateOrganizationSettings(input) {
    assertPermission('organization.manage');
    input = input || {};
    var before = clone(db.organization);
    ['name', 'campus', 'address', 'contactPhone', 'contactEmail', 'workingHours', 'defaultTimezone']
      .forEach(function (k) { if (input[k] !== undefined) db.organization[k] = String(input[k] || ''); });
    if (input.lessonAlertThreshold !== undefined) {
      var n = Number(input.lessonAlertThreshold);
      if (!isFinite(n) || n < 0) throw bizError('BAD_THRESHOLD', '课时预警阈值必须是非负数字');
      db.organization.lessonAlertThreshold = n;
    }
    if (input.expireAlertDays !== undefined) {
      var d = Number(input.expireAlertDays);
      if (!isFinite(d) || d < 0) throw bizError('BAD_EXPIRE', '套餐临期提醒天数必须是非负数字');
      db.organization.expireAlertDays = d;
    }
    if (input.allowAgentRegisterPayment !== undefined) {
      db.organization.allowAgentRegisterPayment = !!input.allowAgentRegisterPayment;
    }
    db.organization.updatedAt = stamp();
    db.organization.updatedBy = operatorForRole();
    recordAudit({
      module: '机构设置', action: '更新机构设置', resourceType: 'organization', resourceId: 'ORG',
      resourceName: db.organization.name + ' · ' + db.organization.campus,
      beforeData: before, afterData: clone(db.organization),
      reason: input.reason || '维护机构基础参数', result: '成功'
    });
    save();
    return clone(db.organization);
  }

  /* ---------------- 迁移提示 ---------------- */
  function migrationInfo() {
    return db.meta && db.meta.migration ? clone(db.meta.migration) : null;
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
    openTeacherAccount: openTeacherAccount,
    setAccountStatus: function (targetId, status, opt) {
      return accountById(targetId)
        ? setUserAccountStatus(targetId, status, opt)
        : setTeacherAccountStatus(targetId, status, opt);
    },
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
    /* 训练（第九轮：多词库动态选词 + 展示循环） */
    createTrainTask: createTrainTask, addWordbooksToTask: addWordbooksToTask,
    setTrainTarget: setTrainTarget,
    wordbooksOfTask: wordbooksOfTask, bookOfWordInTask: bookOfWordInTask, bookLabel: bookLabel,
    isScreenedKnown: isScreenedKnown, openTaskOfWord: openTaskOfWord,
    prescreenCandidates: prescreenCandidates, prescreenTaskStat: prescreenTaskStat,
    trainDisplayOf: trainDisplayOf, trainDisplaysOf: trainDisplaysOf, displayCompleted: displayCompleted,
    displayStat: displayStat, trainDisplayTap: trainDisplayTap, setTrainGroup: setTrainGroup,
    finishDisplay: finishDisplay, revokeScreeningKnown: revokeScreeningKnown,
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
    /* ---------- 第七轮：代理 / 线索 / 订单 / 收款 / 课时 / 续费 / 反馈 ---------- */
    currentAgentId: sessionAgentId, currentParentId: sessionParentId,
    isDemoMode: isDemoMode,
    operatorForRole: operatorForRole,
    sessionPersisted: sessionPersisted,
    defaultAgentId: defaultAgentId, defaultParentId: defaultParentId,
    agents: agents, agent: agent, agentsOf: agentsOf,
    recruitAgent: recruitAgent, reviewAgent: reviewAgent, setAgentStatus: setAgentStatus,
    agentLogsOf: agentLogsOf, agentOverview: agentOverview,
    products: products, product: product,
    leads: leads, lead: lead, leadView: leadView, leadRowCounts: leadRowCounts,
    leadCurrentAgentId: leadCurrentAgentId, leadSourceAgentId: leadSourceAgentId,
    leadDisputesOf: leadDisputesOf, createLeadDispute: createLeadDispute,
    resolveLeadDispute: resolveLeadDispute,
    agentCustomers: agentCustomers, agentLeadView: agentLeadView, agentStudentView: agentStudentView,
    createLead: createLead, addLeadFollowUp: addLeadFollowUp, markLeadIntent: markLeadIntent,
    assignLead: assignLead, leadFollowUpsOf: leadFollowUpsOf, leadOrders: leadOrders,
    leadLogsOf: function (leadId) {
      return db.leadLogs.filter(function (x) { return x.leadId === leadId; })
        .sort(function (a, b) { return a.at < b.at ? 1 : -1; });
    },
    submitEnrollmentOrder: submitEnrollmentOrder,
    orders: orderRows, order: orderOf, orderView: orderView, orderOf: orderOf,
    orderRows: orderRows, orderLogsOf: orderLogsOf, orderPayments: orderPayments,
    reviewOrder: reviewOrder, confirmOrderPayment: confirmOrderPayment, cancelOrder: cancelOrder,
    registerPayment: registerPayment, confirmRegisteredPayment: confirmRegisteredPayment,
    rejectRegisteredPayment: rejectRegisteredPayment, paymentRegistrations: function () { return db.paymentRegistrations; },
    paymentRegistrationsOf: function (orderId) {
      return db.paymentRegistrations.filter(function (x) { return !orderId || x.orderId === orderId; })
        .sort(function (a, b) { return a.registeredAt < b.registeredAt ? 1 : -1; });
    },
    requestOrderRefund: requestOrderRefund, reviewRefund: reviewRefund,
    refundRequestsOf: refundRequestsOf,
    orderCheck: orderCheck,
    payments: function () { return db.payments; },
    adjustLessons: adjustLessons, syncStudentRemain: syncStudentRemain,
    accountsOfStudent: accountsOfStudent,
    refreshRenewalOpportunities: refreshRenewalOpportunities,
    renewals: renewalRows, renewal: renewal, agentRenewals: agentRenewals,
    handleRenewal: handleRenewal, closeRenewal: closeRenewal, submitRenewalOrder: submitRenewalOrder,
    createLearningFeedback: createLearningFeedback, learningFeedbacksOfStudent: learningFeedbacksOfStudent,
    agentFeedbacks: agentFeedbacks, parentFeedbacks: parentFeedbacks,
    parents: function () { return db.parents; },
    parent: parent, parentChildren: parentChildren, parentOrders: parentOrders,
    parentStudents: parentStudents, parentStudentLinks: parentStudentLinks,
    linkParentStudent: linkParentStudent, unlinkParentStudent: unlinkParentStudent,
    parentHours: parentHours, parentView: parentView,
    /* P0 家长专用授权接口 */
    parentHasStudent: parentHasStudent, assertParentChild: assertParentChild,
    parentStudentDetail: parentStudentDetail,
    parentCourses: parentCourses, parentCourseDetail: parentCourseDetail,
    parentReports: parentReports, parentReportDetail: parentReportDetail,
    parentReviewWords: parentReviewWords, parentReviewSummary: parentReviewSummary,
    parentFamilyChecks: parentFamilyChecks, parentFamilyCheckAt: parentFamilyCheckAt,
    toggleParentFamilyCheck: toggleParentFamilyCheck,
    setParentCurrentChild: setParentCurrentChild, parentCurrentChild: parentCurrentChild,
    createParentInquiry: createParentInquiry, parentInquiries: parentInquiries,
    parentInquiryDetail: parentInquiryDetail, handleParentInquiry: handleParentInquiry,
    allParentInquiries: allParentInquiries,
    agentCommissionPreview: agentCommissionPreview, commissionSummary: commissionSummary,
    migrationInfo: migrationInfo,
    MASTERY: MASTERY, MASTERY_LABEL: MASTERY_LABEL, mapResult: mapResult, mapMasteryToResult: mapMasteryToResult,
    generateTrainingReport: generateTrainingReport,
    createReviewPlansFromTraining: createReviewPlansFromTraining,
    dueReviewWords: dueReviewWords, reviewPlansOf: reviewPlansOf,
    activeReviewPlan: activeReviewPlan, reviewPlanStat: reviewPlanStat,
    recordReview: recordReview, reviewRecordsOf: reviewRecordsOf,
    wordMastery: wordMastery, markTrainReinforce: markTrainReinforce,
    trainingReportsOf: trainingReportsOf,
    parentTrainingReports: parentTrainingReports, parentReviewPlan: parentReviewPlan,
    LEAD_STATUS: LEAD_STATUS, LEAD: LEAD, LEAD_NEXT: LEAD_NEXT, LEAD_TONE: LEAD_TONE,
    LEAD_LEVELS: LEAD_LEVELS, LEAD_CHANNELS: LEAD_CHANNELS,
    LESSON_ALERT_THRESHOLD: LESSON_ALERT_THRESHOLD, EXPIRE_ALERT_DAYS: EXPIRE_ALERT_DAYS,
    ORDER_STATUS: ORDER_STATUS, ORDER: ORDER, ORDER_TONE: ORDER_TONE, ORDER_TYPE: ORDER_TYPE,
    PAY_STATUS: PAY_STATUS, PAY: PAY, PAY_METHODS: PAY_METHODS,
    PAY_REG: PAY_REG, PAY_REG_STATUS: PAY_REG_STATUS,
    DISPUTE: DISPUTE, DISPUTE_STATUS: DISPUTE_STATUS,
    REFUND: REFUND, REFUND_STATUS: REFUND_STATUS,
    AGENT_STATUS: AGENT_STATUS, AGENT_TONE: AGENT_TONE, AGENT_TYPES: AGENT_TYPES,
    RENEWAL_STATUS: RENEWAL_STATUS, RENEWAL: RENEWAL, RENEWAL_TONE: RENEWAL_TONE,
    RENEWAL_SOURCE: RENEWAL_SOURCE,
    /* ---------- 第八轮：系统管理 ---------- */
    accountRows: accountRows, accountSummary: accountSummary,
    staffProfiles: function () { return db.staffProfiles.slice(); },
    accountById: accountById, accountOfProfile: accountOfProfile,
    createAccount: createAccount, updateAccount: updateAccount,
    setUserAccountStatus: setUserAccountStatus, resetAccountCredential: resetAccountCredential,
    roleAccounts: roleAccounts, currentIdentity: currentIdentity,
    hasPermission: hasPermission, assertPermission: assertPermission,
    roleDataScope: roleDataScope, hasDataAccess: hasDataAccess, assertDataAccess: assertDataAccess,
    roles: roles, roleOf: roleOf, roleRows: roleRows, createRole: createRole, updateRole: updateRole,
    permissionCatalog: permissionCatalog, permissionMatrix: permissionMatrix,
    updateRolePermissions: updateRolePermissions, resetRolePermissions: resetRolePermissions,
    recordAudit: recordAudit, auditRows: auditRows, auditOf: auditOf, auditStat: auditStat,
    dictionaryTypes: dictionaryTypes, dictionaryItems: dictionaryItems,
    dictionaryOptions: dictionaryOptions, dictionaryHas: dictionaryHas,
    createDictionaryItem: createDictionaryItem, updateDictionaryItem: updateDictionaryItem,
    removeDictionaryItem: removeDictionaryItem, dictionaryUsage: dictionaryUsage,
    notificationRules: notificationRules, updateNotificationRule: updateNotificationRule,
    notify: notify, notifications: notificationRows, unreadNotificationCount: unreadNotificationCount,
    markNotificationRead: markNotificationRead, markAllNotificationsRead: markAllNotificationsRead,
    allNotifications: allNotifications,
    organizationSettings: organizationSettings, updateOrganizationSettings: updateOrganizationSettings,
    DATA_SCOPE_LABEL: DATA_SCOPE_LABEL, ACTION_PERM: ACTION_PERM, PERMISSION_SEED: PERMISSION_SEED,
    /* 状态词表 */
    STATUS: STATUS, COURSE_STATUS: COURSE_STATUS, REPORT_STATUS: REPORT_STATUS,
    /* 单词训练域：三种教学状态各自的词表 */
    SCREEN: SCREEN, SCREEN_TONE: SCREEN_TONE, SCREEN_SOURCE: SCREEN_SOURCE,
    DISPLAY_STEP: DISPLAY_STEP, DISPLAY_LABEL: DISPLAY_LABEL,
    PHASE: PHASE, TRAIN_GROUP_SIZE: TRAIN_GROUP_SIZE, TARGET_RANGE: TARGET_RANGE,
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
