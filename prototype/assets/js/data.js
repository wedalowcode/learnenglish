/* ============================================================
   原型模拟数据（页面内 JS 对象，无后端）
   数据口径示例：当前日期 2026-11-02（周一）
   ============================================================ */

const DB = {
  today: '2026-11-02',

  /* ============================================================
     教师（兼职教学资源池）
     ------------------------------------------------------------
     机构教师全部为兼职（大学生 / 在校研究生 / 其他兼职人员），
     人员流动频繁，因此档案必须能表达「反复进出」而不是一次性员工记录。
     字段口径：
       id / code      内部主键 / 对外教师编号（都唯一，编号由系统生成）
       cooperationStatus  待启用 / 可授课 / 暂停合作 / 已退出
       account        登录账号（未开通为 null），与教师档案分离
       availability   可授课时间块（星期 + 时段），是排课参考，不是预约
       coop           合作事件流水，历史只追加不覆盖
     ============================================================ */
  teachers: [
    {
      id: 'T001', code: 'T001', name: '李婉', phone: '13801234567', gender: '女',
      school: '华东师范大学', major: '英语教育', education: '本科',
      grades: ['七年级', '八年级'], textbooks: ['人教版'],
      teachingTags: ['词汇强化', '自然拼读', '阅读训练', '家长沟通及时'],
      teachingExperience: '6 年一对一英语教学经验，累计授课 1200+ 节，带过 4 届中考冲刺。',
      teachingStyle: '课堂以「预筛 → 分组强化 → 最后一轮复习」为主线，配合莱特纳与 21 天两套复习体系做长期记忆管理。',
      introduction: '6 年一对一英语教学经验，擅长词汇与阅读训练。',
      availability: [
        { weekday: '周一', period: '晚上' }, { weekday: '周三', period: '晚上' },
        { weekday: '周五', period: '晚上' }, { weekday: '周六', period: '上午' }
      ],
      cooperationStatus: '可授课',
      firstCooperationAt: '2024-03-01', lastCooperationStartAt: '2024-03-01', cooperationEndAt: '',
      createdBy: '张敏', createdAt: '2024-03-01 09:20', updatedAt: '2026-10-20 14:10', remark: '',
      rejoinCount: 0,
      account: { id: 'UA001', loginName: '13801234567', status: '正常', roleId: 'teacher',
        openedAt: '2024-03-02 10:05', openedBy: '张敏' },
      coop: [
        { action: 'CREATED', at: '2024-03-01 09:20', reason: '新教师录入', operator: '张敏' },
        { action: 'ACTIVATED', at: '2024-03-01 10:00', reason: '资料与账号就绪，进入可授课资源池', operator: '张敏' }
      ]
    },
    {
      id: 'T002', code: 'T002', name: '周雅', phone: '13802234567', gender: '女',
      school: '南京师范大学', major: '英语', education: '本科',
      grades: ['三年级', '四年级'], textbooks: ['人教版', '外研版'],
      teachingTags: ['低年级启蒙', '自然拼读', '听说训练'],
      teachingExperience: '4 年小学段一对一教学，主带三、四年级启蒙与拼读。',
      teachingStyle: '节奏轻快，善用游戏化操练，重视开口频次。',
      introduction: '低年级启蒙教学，课堂节奏把控好。',
      availability: [
        { weekday: '周二', period: '晚上' }, { weekday: '周四', period: '晚上' },
        { weekday: '周六', period: '上午' }
      ],
      cooperationStatus: '可授课',
      firstCooperationAt: '2024-09-12', lastCooperationStartAt: '2024-09-12', cooperationEndAt: '',
      createdBy: '张敏', createdAt: '2024-09-12 15:40', updatedAt: '2026-09-12 15:40', remark: '',
      rejoinCount: 0,
      account: { id: 'UA002', loginName: '13802234567', status: '正常', roleId: 'teacher',
        openedAt: '2024-09-13 09:30', openedBy: '张敏' },
      coop: [
        { action: 'CREATED', at: '2024-09-12 15:40', reason: '新教师录入', operator: '张敏' },
        { action: 'ACTIVATED', at: '2024-09-13 09:30', reason: '资料与账号就绪', operator: '张敏' }
      ]
    },
    {
      id: 'T003', code: 'T003', name: '何俊', phone: '13803234567', gender: '男',
      school: '四川外国语大学', major: '翻译', education: '硕士',
      grades: ['八年级', '九年级'], textbooks: ['人教版'],
      teachingTags: ['语法', '写作', '中考冲刺'],
      teachingExperience: '5 年中学段教学，专注语法体系梳理与写作提分。',
      teachingStyle: '结构化板书，按错题类型归因，作业反馈当日给出。',
      introduction: '中考冲刺方向，语法与写作。',
      availability: [
        { weekday: '周一', period: '晚上' }, { weekday: '周二', period: '晚上' },
        { weekday: '周四', period: '晚上' }, { weekday: '周日', period: '下午' }
      ],
      cooperationStatus: '可授课',
      firstCooperationAt: '2025-02-20', lastCooperationStartAt: '2025-02-20', cooperationEndAt: '',
      createdBy: '张敏', createdAt: '2025-02-20 11:05', updatedAt: '2026-06-30 18:20', remark: '',
      rejoinCount: 0,
      account: { id: 'UA003', loginName: '13803234567', status: '正常', roleId: 'teacher',
        openedAt: '2025-02-21 10:00', openedBy: '张敏' },
      coop: [
        { action: 'CREATED', at: '2025-02-20 11:05', reason: '新教师录入', operator: '张敏' },
        { action: 'ACTIVATED', at: '2025-02-21 10:00', reason: '资料与账号就绪', operator: '张敏' }
      ]
    },
    {
      id: 'T004', code: 'T004', name: '沈心怡', phone: '13804234567', gender: '女',
      school: '浙江师范大学', major: '小学教育', education: '本科',
      grades: ['五年级', '六年级'], textbooks: ['外研版'],
      teachingTags: ['自然拼读', '听说训练', '阅读'],
      teachingExperience: '3 年小学高段教学，外研版教材熟悉。',
      teachingStyle: '注重语音语调，课后固定 10 分钟家长沟通。',
      introduction: '自然拼读与听说训练。',
      availability: [
        { weekday: '周三', period: '晚上' }, { weekday: '周五', period: '晚上' },
        { weekday: '周日', period: '上午' }, { weekday: '周日', period: '下午' }
      ],
      cooperationStatus: '可授课',
      firstCooperationAt: '2025-07-05', lastCooperationStartAt: '2025-07-05', cooperationEndAt: '',
      createdBy: '教务-小陈', createdAt: '2025-07-05 09:50', updatedAt: '2026-09-30 12:00', remark: '',
      rejoinCount: 0,
      account: { id: 'UA004', loginName: '13804234567', status: '正常', roleId: 'teacher',
        openedAt: '2025-07-05 14:20', openedBy: '教务-小陈' },
      coop: [
        { action: 'CREATED', at: '2025-07-05 09:50', reason: '新教师录入', operator: '教务-小陈' },
        { action: 'ACTIVATED', at: '2025-07-05 14:20', reason: '资料与账号就绪', operator: '教务-小陈' }
      ]
    },
    {
      /* 暂停合作示例：备考研究生入学考试，学员已全部结课，账号按机构策略禁用但档案与历史全部保留 */
      id: 'T005', code: 'T005', name: '徐峰', phone: '13805234567', gender: '男',
      school: '湖南师范大学', major: '英语', education: '本科',
      grades: ['九年级'], textbooks: ['人教版'],
      teachingTags: ['中考冲刺', '语法'],
      teachingExperience: '3 年初中段教学。',
      teachingStyle: '讲练结合，强调整句输出。',
      introduction: '因备考暂停接课，预计 12 月恢复。',
      availability: [
        { weekday: '周六', period: '下午' }, { weekday: '周日', period: '晚上' }
      ],
      cooperationStatus: '暂停合作',
      firstCooperationAt: '2023-08-15', lastCooperationStartAt: '2023-08-15', cooperationEndAt: '',
      pauseInfo: { reason: '备考研究生入学考试，12 月前无法安排课程', startAt: '2026-10-15',
        expectResumeAt: '2026-12-20', remark: '学员已在 10 月前全部结课', by: '张敏' },
      createdBy: '张敏', createdAt: '2023-08-15 10:30', updatedAt: '2026-10-15 09:10', remark: '',
      rejoinCount: 0,
      account: { id: 'UA005', loginName: '13805234567', status: '已禁用', roleId: 'teacher',
        openedAt: '2023-08-16 09:00', openedBy: '张敏', disabledAt: '2026-10-15 09:10' },
      coop: [
        { action: 'CREATED', at: '2023-08-15 10:30', reason: '新教师录入', operator: '张敏' },
        { action: 'ACTIVATED', at: '2023-08-16 09:00', reason: '资料与账号就绪', operator: '张敏' },
        { action: 'PAUSED', at: '2026-10-15 09:10', reason: '备考研究生入学考试，12 月前无法安排课程', operator: '张敏' }
      ]
    },
    {
      /* 已退出示例：正式结束合作，历史课程 / 报告 / 教学记录全部保留 */
      id: 'T006', code: 'T006', name: '郑好', phone: '13806234567', gender: '女',
      school: '江苏师范大学', major: '英语', education: '本科',
      grades: ['七年级'], textbooks: ['人教版'],
      teachingTags: ['词汇', '低年级启蒙'],
      teachingExperience: '2 年兼职教学，毕业后离开本地。',
      teachingStyle: '耐心细致，重视基础词汇积累。',
      introduction: '江苏师范大学英语专业，主带七年级词汇与低年级启蒙，2026 年 6 月毕业后离开本地，已正式结束合作。',
      availability: [],
      cooperationStatus: '已退出',
      firstCooperationAt: '2025-09-01', lastCooperationStartAt: '2025-09-01', cooperationEndAt: '2026-06-30',
      createdBy: '张敏', createdAt: '2025-09-01 10:00', updatedAt: '2026-06-30 18:00', remark: '',
      rejoinCount: 0,
      account: { id: 'UA006', loginName: '13806234567', status: '已禁用', roleId: 'teacher',
        openedAt: '2025-09-02 09:20', openedBy: '张敏', disabledAt: '2026-06-30 18:00' },
      coop: [
        { action: 'CREATED', at: '2025-09-01 10:00', reason: '新教师录入', operator: '张敏' },
        { action: 'ACTIVATED', at: '2025-09-02 09:20', reason: '资料与账号就绪', operator: '张敏' },
        { action: 'EXITED', at: '2026-06-30 18:00', reason: '教师毕业后离开本地，正式结束合作', operator: '张敏' }
      ]
    },
    {
      /* 待启用示例：本周新录入，资料与账号尚未齐备，不进入可分配资源池 */
      id: 'T007', code: 'T007', name: '苏念', phone: '13807234567', gender: '女',
      school: '南京大学', major: '英语语言文学', education: '在读研究生',
      grades: ['五年级', '六年级'], textbooks: ['外研版'],
      teachingTags: ['阅读', '写作'],
      teachingExperience: '在校研究生，带过 2 学期小学高段阅读课。',
      teachingStyle: '以读促写，重视篇章结构。',
      introduction: '新加入教师，待完善资料并开通账号后启用。',
      availability: [
        { weekday: '周二', period: '上午' }, { weekday: '周四', period: '上午' }
      ],
      cooperationStatus: '待启用',
      firstCooperationAt: '', lastCooperationStartAt: '', cooperationEndAt: '',
      createdBy: '教务-小陈', createdAt: '2026-10-28 16:30', updatedAt: '2026-10-28 16:30', remark: '面试通过，待办入职',
      rejoinCount: 0,
      account: null,
      coop: [
        { action: 'CREATED', at: '2026-10-28 16:30', reason: '新教师录入（面试通过）', operator: '教务-小陈' }
      ]
    },
  ],

  /* ============================================================
     教师—学员负责关系（TeacherStudent）
     ------------------------------------------------------------
     这是「谁现在负责谁」的唯一事实来源；students[].teacher / teacherName
     只是由这段关系推导出的缓存字段，供旧页面读取。
     同一学员同一时间最多一条「当前有效」关系；换教师 = 原关系结束 + 新关系创建。
     ============================================================ */
  teacherStudentSeeds: [
    { teacherId: 'T001', studentId: 'S2026001', startAt: '2026-03-12', assignReason: '新签学员首次分配' },
    { teacherId: 'T001', studentId: 'S2026008', startAt: '2026-10-02', assignReason: '新签学员首次分配' },
    { teacherId: 'T002', studentId: 'S2026002', startAt: '2026-04-08', assignReason: '新签学员首次分配' },
    { teacherId: 'T003', studentId: 'S2026003', startAt: '2026-06-30', assignReason: '由郑好老师转交，负责中考语法方向' },
    { teacherId: 'T004', studentId: 'S2026004', startAt: '2026-06-11', assignReason: '新签学员首次分配' },
    { teacherId: 'T002', studentId: 'S2026005', startAt: '2026-07-20', assignReason: '由李婉老师转交，年级方向更匹配' },
    { teacherId: 'T004', studentId: 'S2026007', startAt: '2026-09-30', assignReason: '由李婉老师转交，低年级教学经验更合适' },

    /* 历史关系：负责关系结束后保留，用于「历史学员」与交接追溯 */
    { teacherId: 'T001', studentId: 'S2026005', startAt: '2026-06-11', endAt: '2026-07-20', endReason: '年级方向不匹配，转交周雅' },
    { teacherId: 'T001', studentId: 'S2026007', startAt: '2026-09-18', endAt: '2026-09-30', endReason: '调整至低年级教师' },
    { teacherId: 'T001', studentId: 'S2026006', startAt: '2026-08-30', endAt: '2026-10-12', endReason: '家长指定更换教师，暂时进入待分配' },
    { teacherId: 'T006', studentId: 'S2026003', startAt: '2026-05-20', endAt: '2026-06-30', endReason: '教师退出合作，转交何俊' },
  ],

  /* ============================================================
     学员需求种子（第六轮：学员接单与教学资源分配）
     ------------------------------------------------------------
     7 条需求覆盖全部 7 种状态，构成一条可演示的完整链路：
       草稿 / 待接单 / 接单中 / 待教务确认 / 待管理员分配 / 已完成分配 / 已取消
     需求只是「要找一个什么样的老师」的表达，它本身不产生师生关系；
     只有管理员正式分配才会写 teacherStudents。
     ============================================================ */
  studentDemandSeeds: [
    {
      id: 'D20261101001', code: 'D20261101001', studentId: 'S2026009',
      grade: '七年级', textbook: '人教版', learningNeeds: ['词汇', '阅读'],
      currentLevel: '新签学员，入学测评 68 分，词汇量约 600，长句阅读容易卡',
      expectedSchedule: { weekday: ['周二', '周四'], periods: ['晚上'], weeklyLessons: 2 },
      expectedStartAt: '2026-11-10',
      specialRequirements: '家长希望每次课后有 5 分钟口头反馈',
      remark: '已在企微群同步过一次，等教务确认时间后再发',
      status: '草稿',
      publishedBy: '陈静', publishedAt: '',
      createdAt: '2026-10-31 16:20', updatedAt: '2026-10-31 16:20'
    },
    {
      id: 'D20261030002', code: 'D20261030002', studentId: 'S2026010',
      grade: '九年级', textbook: '人教版', learningNeeds: ['词汇', '语法', '中考冲刺'],
      currentLevel: '一模英语 74 分，语法填空失分多，急需中考方向教师',
      expectedSchedule: { weekday: ['周六'], periods: ['上午', '下午'], weeklyLessons: 2 },
      expectedStartAt: '2026-11-08',
      specialRequirements: '家长指定要有中考带班经验的老师',
      remark: '',
      status: '待接单',
      publishedBy: '陈静', publishedAt: '2026-10-30 09:20',
      createdAt: '2026-10-30 09:05', updatedAt: '2026-10-30 09:20'
    },
    {
      id: 'D20261029003', code: 'D20261029003', studentId: 'S2026011',
      grade: '五年级', textbook: '外研版', learningNeeds: ['词汇', '听说'],
      currentLevel: '转学插班，外研版 Module 1-3 生词几乎没学过',
      expectedSchedule: { weekday: ['周三', '周五'], periods: ['下午'], weeklyLessons: 2 },
      expectedStartAt: '2026-11-06',
      specialRequirements: '',
      remark: '家长希望先补 Module 1-3 再跟学校进度',
      status: '接单中',
      publishedBy: '陈静', publishedAt: '2026-10-29 14:10',
      createdAt: '2026-10-29 13:50', updatedAt: '2026-10-30 10:12'
    },
    {
      id: 'D20261028004', code: 'D20261028004', studentId: 'S2026006',
      grade: '九年级', textbook: '人教版', learningNeeds: ['词汇', '阅读', '中考冲刺'],
      currentLevel: '词汇量约 800，阅读理解正确率 55%，需要中考方向系统梳理',
      expectedSchedule: { weekday: ['周一', '周三', '周日'], periods: ['晚上'], weeklyLessons: 3 },
      expectedStartAt: '2026-11-05',
      specialRequirements: '家长要求教师能稳定带满一学期，不接受频繁更换',
      remark: '',
      status: '待教务确认',
      publishedBy: '陈静', publishedAt: '2026-10-28 11:00',
      selectedTeacherId: '', confirmedBy: '', confirmedAt: '', confirmReason: '',
      createdAt: '2026-10-28 10:40', updatedAt: '2026-11-01 09:30'
    },
    {
      id: 'D20261026005', code: 'D20261026005', studentId: 'S2026001',
      grade: '七年级', textbook: '人教版', learningNeeds: ['词汇', '阅读'],
      currentLevel: '家长反馈与现任教师沟通节奏不合，希望更换为阅读方向更强的教师',
      expectedSchedule: { weekday: ['周二', '周五'], periods: ['晚上'], weeklyLessons: 2 },
      expectedStartAt: '2026-11-03',
      specialRequirements: '更换教师，原教师已完成课时不追溯',
      remark: '这是更换教师需求，分配时会结束原负责关系',
      status: '待管理员分配',
      publishedBy: '陈静', publishedAt: '2026-10-26 10:00',
      selectedTeacherId: 'T004', confirmedBy: '陈静', confirmedAt: '2026-11-01 15:40',
      confirmReason: '沈心怡带过该学员同年级同学，阅读方向匹配，且可授课时间与家长要求一致',
      createdAt: '2026-10-26 09:40', updatedAt: '2026-11-01 15:40'
    },
    {
      id: 'D20260920006', code: 'D20260920006', studentId: 'S2026007',
      grade: '二年级', textbook: '外研版', learningNeeds: ['词汇', '自然拼读'],
      currentLevel: '零基础启蒙，家长希望从自然拼读开始',
      expectedSchedule: { weekday: ['周六'], periods: ['上午'], weeklyLessons: 1 },
      expectedStartAt: '2026-09-26',
      specialRequirements: '需要低年级教学经验',
      remark: '',
      status: '已完成分配',
      publishedBy: '陈静', publishedAt: '2026-09-20 10:00',
      selectedTeacherId: 'T004', confirmedBy: '陈静', confirmedAt: '2026-09-24 16:20',
      confirmReason: '沈心怡有低年级启蒙经验，家长也认可',
      assignedAt: '2026-09-30 09:10', assignedBy: '王敏',
      createdAt: '2026-09-20 09:30', updatedAt: '2026-09-30 09:10'
    },
    {
      id: 'D20261024007', code: 'D20261024007', studentId: 'S2026005',
      grade: '三年级', textbook: '外研版', learningNeeds: ['词汇'],
      currentLevel: '现有教师带得不错，家长想再加一位老师分担周中课',
      expectedSchedule: { weekday: ['周四'], periods: ['晚上'], weeklyLessons: 1 },
      expectedStartAt: '2026-11-01',
      specialRequirements: '',
      remark: '',
      status: '已取消',
      publishedBy: '陈静', publishedAt: '2026-10-24 15:00',
      cancelReason: '家长决定维持现有安排，本学期不再增加课次',
      createdAt: '2026-10-24 14:40', updatedAt: '2026-10-27 09:05'
    }
  ],

  /* 教师响应种子：只表达意向，不产生师生关系 */
  teacherResponseSeeds: [
    { demandId: 'D20261029003', teacherId: 'T003', status: '已响应',
      remark: '可以带，外研版五年级我上过两轮', respondedAt: '2026-10-30 09:12' },
    { demandId: 'D20261029003', teacherId: 'T004', status: '已响应',
      remark: '周三周五下午都有空', respondedAt: '2026-10-30 10:12' },

    { demandId: 'D20261028004', teacherId: 'T001', status: '已响应',
      remark: '九年级中考方向带过 3 个学员，周日晚上可以', respondedAt: '2026-10-28 15:20' },
    { demandId: 'D20261028004', teacherId: 'T003', status: '已响应',
      remark: '周一至周三晚上均可，中考语法是强项', respondedAt: '2026-10-29 09:05' },
    { demandId: 'D20261028004', teacherId: 'T004', status: '暂不接单',
      declineReason: '时间不合适', remark: '周日晚上已有固定课',
      respondedAt: '2026-10-29 11:30' },

    { demandId: 'D20261026005', teacherId: 'T004', status: '已选中',
      remark: '阅读方向可以，周二周五晚上都能排', respondedAt: '2026-10-27 09:40' },
    { demandId: 'D20261026005', teacherId: 'T002', status: '未选中',
      remark: '可以带，但周二晚上只有 19:00 之后有空', respondedAt: '2026-10-27 14:10' },

    { demandId: 'D20260920006', teacherId: 'T004', status: '已选中',
      remark: '低年级启蒙我一直在带', respondedAt: '2026-09-22 10:30' }
  ],

  /* 需求操作流水：只追加，用于「谁在什么时候做了什么」的可追溯 */
  studentDemandLogSeeds: [
    { demandId: 'D20261028004', action: 'CREATED', detail: '教务创建需求', operator: '陈静', at: '2026-10-28 10:40' },
    { demandId: 'D20261028004', action: 'PUBLISHED', detail: '发布到需求池', operator: '陈静', at: '2026-10-28 11:00' },
    { demandId: 'D20261028004', action: 'RESPONDED', detail: '教师「李婉」响应：九年级中考方向带过 3 个学员', operator: '李婉', at: '2026-10-28 15:20' },
    { demandId: 'D20261028004', action: 'RESPONDED', detail: '教师「何俊」响应：周一至周三晚上均可', operator: '何俊', at: '2026-10-29 09:05' },
    { demandId: 'D20261028004', action: 'DECLINED', detail: '教师「沈心怡」暂不接单：时间不合适', operator: '沈心怡', at: '2026-10-29 11:30' },
    { demandId: 'D20261028004', action: 'CONFIRM_STARTED', detail: '教务开始比较响应教师', operator: '陈静', at: '2026-11-01 09:30' },

    { demandId: 'D20261026005', action: 'CREATED', detail: '教务创建更换教师需求', operator: '陈静', at: '2026-10-26 09:40' },
    { demandId: 'D20261026005', action: 'PUBLISHED', detail: '发布到需求池', operator: '陈静', at: '2026-10-26 10:00' },
    { demandId: 'D20261026005', action: 'RESPONDED', detail: '教师「沈心怡」响应', operator: '沈心怡', at: '2026-10-27 09:40' },
    { demandId: 'D20261026005', action: 'RESPONDED', detail: '教师「周雅」响应', operator: '周雅', at: '2026-10-27 14:10' },
    { demandId: 'D20261026005', action: 'CONFIRMED', detail: '教务确认「沈心怡」：沈心怡带过该学员同年级同学，阅读方向匹配', operator: '陈静', at: '2026-11-01 15:40' },

    { demandId: 'D20260920006', action: 'CREATED', detail: '教务创建需求', operator: '陈静', at: '2026-09-20 09:30' },
    { demandId: 'D20260920006', action: 'PUBLISHED', detail: '发布到需求池', operator: '陈静', at: '2026-09-20 10:00' },
    { demandId: 'D20260920006', action: 'RESPONDED', detail: '教师「沈心怡」响应', operator: '沈心怡', at: '2026-09-22 10:30' },
    { demandId: 'D20260920006', action: 'CONFIRMED', detail: '教务确认「沈心怡」', operator: '陈静', at: '2026-09-24 16:20' },
    { demandId: 'D20260920006', action: 'ASSIGNED', detail: '管理员正式分配：建立师生负责关系', operator: '王敏', at: '2026-09-30 09:10' },

    { demandId: 'D20261024007', action: 'CREATED', detail: '教务创建需求', operator: '陈静', at: '2026-10-24 14:40' },
    { demandId: 'D20261024007', action: 'PUBLISHED', detail: '发布到需求池', operator: '陈静', at: '2026-10-24 15:00' },
    { demandId: 'D20261024007', action: 'CANCELLED', detail: '取消需求：家长决定维持现有安排，本学期不再增加课次', operator: '陈静', at: '2026-10-27 09:05' }
  ],

  /* 词库申请种子：教师为「自己负责的学员」申请词库使用权限 */
  studentWordbookRequestSeeds: [
    { id: 'WR20261101001', studentId: 'S2026001', teacherId: 'T001', wordbookId: 'WB002',
      reason: '本周开始人教版七年级上 Unit 2，需要配套词表做课前初筛', plan: '先用 Unit 2 词库做 23 词初筛，再按错词建莱特纳复习',
      status: '待审核', requestedAt: '2026-11-01 10:20' },
    { id: 'WR20261101002', studentId: 'S2026003', teacherId: 'T003', wordbookId: 'WB003',
      reason: '八年级 Unit 1 词汇缺口较大，需要系统过一遍', plan: '两周内完成 Unit 1，每周 2 次课各 15 分钟',
      status: '待审核', requestedAt: '2026-11-01 16:05' },
    { id: 'WR20260313003', studentId: 'S2026001', teacherId: 'T001', wordbookId: 'WB001',
      reason: '新签学员首次课，需要 Unit 1 词库', plan: '',
      status: '已通过', requestedAt: '2026-03-13 09:10',
      reviewedBy: '王敏', reviewedAt: '2026-03-13 10:02', reviewRemark: '同意开通，按教材进度使用' },
    { id: 'WR20261017004', studentId: 'S2026004', teacherId: 'T004', wordbookId: 'WB006',
      reason: '想给学员加一点九年级词汇拔高', plan: '',
      status: '已驳回', requestedAt: '2026-10-17 14:30',
      reviewedBy: '王敏', reviewedAt: '2026-10-17 16:10',
      reviewRemark: '该学员当前使用外研版，人教版九年级词库与教材不符，请改用外研版词库' },
    { id: 'WR20261020005', studentId: 'S2026002', teacherId: 'T002', wordbookId: 'WB004',
      reason: 'Module 1 复习想用词表', plan: '',
      status: '已取消', requestedAt: '2026-10-20 11:00',
      reviewedBy: '', reviewedAt: '', reviewRemark: '教师自行取消：改用其他方式复习'
    }
  ],

  /* 学员词库授权：只记录「谁在什么时候被授权用哪个词库」，不保存训练进度 */
  studentWordbookSeeds: [
    { studentId: 'S2026001', wordbookId: 'WB001', requestId: 'WR20260313003',
      requestedByTeacherId: 'T001', status: '已授权', approvedBy: '王敏', approvedAt: '2026-03-13 10:02',
      remark: '按教材进度开通' },
    { studentId: 'S2026002', wordbookId: 'WB004', requestedByTeacherId: 'T002',
      status: '已授权', approvedBy: '王敏', approvedAt: '2026-04-10 09:30', remark: '新签学员首次开通' },
    { studentId: 'S2026003', wordbookId: 'WB003', requestedByTeacherId: 'T003',
      status: '已授权', approvedBy: '王敏', approvedAt: '2026-07-02 10:00', remark: '' },
    { studentId: 'S2026003', wordbookId: 'WB001', requestedByTeacherId: 'T006',
      status: '已停用', approvedBy: '王敏', approvedAt: '2026-05-22 09:00',
      disabledBy: '王敏', disabledAt: '2026-09-01 10:20',
      disableReason: '已学完该词库，暂停以专注当前教材；历史训练记录保留' },
    { studentId: 'S2026004', wordbookId: 'WB005', requestedByTeacherId: 'T004',
      status: '已授权', approvedBy: '王敏', approvedAt: '2026-06-12 10:00', remark: '' },
    { studentId: 'S2026005', wordbookId: 'WB004', requestedByTeacherId: 'T002',
      status: '已授权', approvedBy: '王敏', approvedAt: '2026-07-21 09:40', remark: '' },
    { studentId: 'S2026006', wordbookId: 'WB006',
      status: '已授权', approvedBy: '王敏', approvedAt: '2026-10-15 15:00',
      remark: '试听课后管理员主动开通，家长确认走中考方向' },
    { studentId: 'S2026007', wordbookId: 'WB004', requestedByTeacherId: 'T004',
      status: '已授权', approvedBy: '王敏', approvedAt: '2026-10-02 09:20', remark: '' },
    { studentId: 'S2026008', wordbookId: 'WB001', requestedByTeacherId: 'T001',
      status: '已授权', approvedBy: '王敏', approvedAt: '2026-10-03 11:00', remark: '' }
  ],

  parents: [
    { id: 'P001', name: '陈志强', phone: '13901112222', wechat: 'chenzq88', relation: '父亲', kids: ['S2026001'], first: '2026-03-12', status: '启用' },
    { id: 'P002', name: '林慧', phone: '13902223333', wechat: 'linhui_2010', relation: '母亲', kids: ['S2026002', 'S2026007'], first: '2026-04-08', status: '启用' },
    { id: 'P003', name: '赵明', phone: '13903334444', wechat: '', relation: '父亲', kids: ['S2026003'], first: '2026-05-20', status: '启用' },
    { id: 'P004', name: '孙巧云', phone: '13904445555', wechat: 'sunqy', relation: '母亲', kids: ['S2026004', 'S2026005'], first: '2026-06-11', status: '启用' },
    { id: 'P005', name: '吴建平', phone: '13905556666', wechat: '', relation: '父亲', kids: ['S2026006'], first: '2026-08-30', status: '停用' },
    { id: 'P006', name: '唐晓峰', phone: '13905556667', wechat: 'tangxf_88', relation: '父亲', kids: ['S2026009'], first: '2026-10-31', status: '启用' },
    { id: 'P007', name: '高远', phone: '13906667778', wechat: 'gaoyuan2011', relation: '父亲', kids: ['S2026010'], first: '2026-10-30', status: '启用' },
    { id: 'P008', name: '沈丽', phone: '13907778889', wechat: 'shenli_mama', relation: '母亲', kids: ['S2026011'], first: '2026-10-29', status: '启用' },
  ],

  students: [
    { id: 'S2026001', name: '陈可欣', gender: '女', grade: '七年级', parent: 'P001', parentName: '陈志强',
      phone: '13901112222', teacher: 'T001', teacherName: '李婉', product: '60 课时包', remain: 42,
      status: '在读', created: '2026-03-12', book: '人教版', school: '城东实验中学', source: '转介绍',
      words: { total: 186, mastered: 132, review: 34 }, lastCourse: '2026-10-31', lastContent: 'Unit 3 词汇强化' },
    { id: 'S2026002', name: '林子轩', gender: '男', grade: '五年级', parent: 'P002', parentName: '林慧',
      phone: '13902223333', teacher: 'T002', teacherName: '周雅', product: '30 课时包', remain: 8,
      status: '在读', created: '2026-04-08', book: '外研版', school: '育才小学', source: '地推',
      words: { total: 94, mastered: 51, review: 22 }, lastCourse: '2026-10-30', lastContent: 'Unit 2 短文听读' },
    { id: 'S2026003', name: '赵一诺', gender: '女', grade: '八年级', parent: 'P003', parentName: '赵明',
      phone: '13903334444', teacher: 'T003', teacherName: '何俊', product: '60 课时包', remain: 3,
      status: '在读', created: '2026-05-20', book: '人教版', school: '城南一中', source: '公众号',
      words: { total: 240, mastered: 175, review: 48 }, lastCourse: '2026-10-29', lastContent: 'Unit 4 语法专项' },
    { id: 'S2026004', name: '孙浩宇', gender: '男', grade: '六年级', parent: 'P004', parentName: '孙巧云',
      phone: '13904445555', teacher: 'T004', teacherName: '沈心怡', product: '20 课时包', remain: 15,
      status: '在读', created: '2026-06-11', book: '外研版', school: '实验小学', source: '代理推荐',
      words: { total: 72, mastered: 40, review: 12 }, lastCourse: '2026-10-28', lastContent: 'Unit 1 单词初筛' },
    { id: 'S2026005', name: '孙雨桐', gender: '女', grade: '三年级', parent: 'P004', parentName: '孙巧云',
      phone: '13904445555', teacher: 'T002', teacherName: '周雅', product: '20 课时包', remain: 18,
      status: '在读', created: '2026-06-11', book: '人教版', school: '实验小学', source: '代理推荐',
      words: { total: 40, mastered: 28, review: 6 }, lastCourse: '2026-10-27', lastContent: 'Unit 2 字母组合' },
    { id: 'S2026006', name: '吴思远', gender: '男', grade: '九年级', parent: 'P005', parentName: '吴建平',
      phone: '13905556666', teacher: '', teacherName: '未分配', product: '60 课时包', remain: 26,
      status: '暂停', created: '2026-08-30', book: '人教版', school: '城南一中', source: '电话咨询',
      words: { total: 150, mastered: 88, review: 30 }, lastCourse: '2026-10-12', lastContent: 'Unit 1 阅读理解' },
    { id: 'S2026007', name: '林雨萱', gender: '女', grade: '二年级', parent: 'P002', parentName: '林慧',
      phone: '13902223333', teacher: 'T004', teacherName: '沈心怡', product: '20 课时包', remain: 20,
      status: '在读', created: '2026-09-18', book: '外研版', school: '育才小学', source: '转介绍',
      words: { total: 18, mastered: 9, review: 3 }, lastCourse: '2026-10-26', lastContent: 'Unit 1 听说训练' },
    { id: 'S2026008', name: '付嘉禾', gender: '男', grade: '七年级', parent: 'P001', parentName: '陈志强',
      phone: '13901112222', teacher: 'T001', teacherName: '李婉', product: '30 课时包', remain: 28,
      status: '在读', created: '2026-10-02', book: '人教版', school: '城东实验中学', source: '转介绍',
      words: { total: 55, mastered: 20, review: 18 }, lastCourse: '2026-10-30', lastContent: 'Unit 1 单词初筛' },

    /* 新签学员：已建档、已成交，但还没有负责教师 —— 需求池里正在等待分配 */
    { id: 'S2026009', name: '唐语彤', gender: '女', grade: '七年级', parent: 'P006', parentName: '唐晓峰',
      phone: '13905556666', teacher: '', teacherName: '未分配', product: '30 课时包', remain: 30,
      status: '在读', created: '2026-10-31', book: '人教版', school: '城东实验中学', source: '公众号',
      words: { total: 0, mastered: 0, review: 0 }, lastCourse: '', lastContent: '' },
    { id: 'S2026010', name: '高子墨', gender: '男', grade: '九年级', parent: 'P007', parentName: '高远',
      phone: '13906667777', teacher: '', teacherName: '未分配', product: '60 课时包', remain: 60,
      status: '在读', created: '2026-10-30', book: '人教版', school: '城南一中', source: '地推',
      words: { total: 0, mastered: 0, review: 0 }, lastCourse: '', lastContent: '' },
    { id: 'S2026011', name: '沈亦航', gender: '男', grade: '五年级', parent: 'P008', parentName: '沈丽',
      phone: '13907778888', teacher: '', teacherName: '未分配', product: '30 课时包', remain: 30,
      status: '在读', created: '2026-10-29', book: '外研版', school: '育才小学', source: '转介绍',
      words: { total: 0, mastered: 0, review: 0 }, lastCourse: '', lastContent: '' },
  ],

  agents: [
    { id: 'A001', name: '王磊', phone: '13701110001', wechat: 'wanglei01', type: '个人代理', owner: '张敏',
      rule: '成交额 8%', customers: 12, deals: 5, orders: 6, amount: 41260, pending: 1840, settled: 1460, status: '启用', created: '2026-01-08' },
    { id: 'A002', name: '刘倩', phone: '13702220002', wechat: 'liuqian02', type: '合作机构', owner: '张敏',
      rule: '成交额 10%', customers: 9, deals: 3, orders: 4, amount: 28700, pending: 980, settled: 1890, status: '启用', created: '2026-02-14' },
    { id: 'A003', name: '赵勇', phone: '13703330003', wechat: 'zhaoyong03', type: '个人代理', owner: '教务处',
      rule: '固定 300 元/单', customers: 6, deals: 2, orders: 2, amount: 10380, pending: 600, settled: 300, status: '启用', created: '2026-05-06' },
    { id: 'A004', name: '周宁', phone: '13704440004', wechat: '', type: '个人代理', owner: '张敏',
      rule: '成交额 6%', customers: 3, deals: 0, orders: 0, amount: 0, pending: 0, settled: 0, status: '停用', created: '2026-06-21' },
  ],

  leads: [
    { id: 'L2026051', name: '黄女士', phone: '13611112222', kid: '黄子豪', grade: '四年级', book: '人教版',
      channel: '公众号', agent: 'A001', follower: '张敏', lastFollow: '2026-11-01 15:20', intent: '30 课时包',
      status: '跟进中', created: '2026-10-20', level: '高', next: '2026-11-04' },
    { id: 'L2026052', name: '郑先生', phone: '13612223333', kid: '郑欣', grade: '七年级', book: '人教版',
      channel: '转介绍', agent: 'A002', follower: '张敏', lastFollow: '2026-11-01 10:05', intent: '60 课时包',
      status: '意向明确', created: '2026-10-18', level: '高', next: '2026-11-03' },
    { id: 'L2026053', name: '冯女士', phone: '13613334444', kid: '', grade: '六年级', book: '外研版',
      channel: '地推', agent: 'A001', follower: '教务处-小陈', lastFollow: '2026-10-30 18:40', intent: '20 课时包',
      status: '待联系', created: '2026-10-28', level: '中', next: '2026-11-02' },
    { id: 'L2026054', name: '许先生', phone: '13614445555', kid: '许安然', grade: '八年级', book: '人教版',
      channel: '电话咨询', agent: '', follower: '张敏', lastFollow: '2026-10-26 09:12', intent: '60 课时包',
      status: '已成交', created: '2026-09-30', level: '高', next: '' },
    { id: 'L2026055', name: '邓女士', phone: '13615556666', kid: '邓一鸣', grade: '三年级', book: '人教版',
      channel: '公众号', agent: 'A003', follower: '教务处-小陈', lastFollow: '2026-10-22 14:00', intent: '20 课时包',
      status: '无效', created: '2026-10-10', level: '低', next: '' },
    { id: 'L2026056', name: '罗先生', phone: '13616667777', kid: '罗可', grade: '五年级', book: '外研版',
      channel: '转介绍', agent: 'A001', follower: '张敏', lastFollow: '2026-10-31 11:30', intent: '30 课时包',
      status: '跟进中', created: '2026-10-25', level: '中', next: '2026-11-05' },
    { id: 'L2026057', name: '苏女士', phone: '13617778888', kid: '', grade: '九年级', book: '人教版',
      channel: '地推', agent: 'A002', follower: '教务处-小陈', lastFollow: '2026-10-15 16:00', intent: '60 课时包',
      status: '已关闭', created: '2026-09-12', level: '低', next: '' },
    { id: 'L2026058', name: '韩先生', phone: '13618889999', kid: '韩雨泽', grade: '一年级', book: '外研版',
      channel: '代理推荐', agent: 'A003', follower: '张敏', lastFollow: '2026-11-02 08:50', intent: '体验课',
      status: '新线索', created: '2026-11-02', level: '中', next: '2026-11-03' },
  ],

  products: [
    { id: 'PRD01', name: '60 课时包（一对一）', hours: 60, price: 6980, gift: 0, unit: 116.33, valid: '12 个月', status: '在售', created: '2026-01-05', desc: '少儿英语一对一，60 课时，含学情报告。' },
    { id: 'PRD02', name: '30 课时包（一对一）', hours: 30, price: 3680, gift: 2, unit: 122.67, valid: '6 个月', status: '在售', created: '2026-01-05', desc: '适合初次体验学员。' },
    { id: 'PRD03', name: '20 课时包（一对一）', hours: 20, price: 2580, gift: 0, unit: 129.00, valid: '6 个月', status: '在售', created: '2026-02-18', desc: '短期强化。' },
    { id: 'PRD04', name: '体验课 10 课时', hours: 10, price: 1280, gift: 1, unit: 128.00, valid: '3 个月', status: '停用', created: '2025-11-01', desc: '已停用，历史订单保留原商品快照。' },
  ],

  orders: [
    { id: 'OD20260912001', student: 'S2026001', studentName: '陈可欣', parent: '陈志强', phone: '13901112222',
      product: '60 课时包（一对一）', buy: 60, gift: 0, amount: 6980, paid: 6980, status: '已生效', agent: 'A001',
      created: '2026-09-12 10:20', pay: '2026-09-12', payType: '微信' },
    { id: 'OD20261008002', student: 'S2026003', studentName: '赵一诺', parent: '赵明', phone: '13903334444',
      product: '60 课时包（一对一）', buy: 60, gift: 0, amount: 6980, paid: 3000, status: '部分付款', agent: '',
      created: '2026-10-08 14:05', pay: '2026-10-08', payType: '银行转账' },
    { id: 'OD20261018003', student: 'S2026008', studentName: '付嘉禾', parent: '陈志强', phone: '13901112222',
      product: '30 课时包（一对一）', buy: 30, gift: 2, amount: 3680, paid: 3680, status: '已生效', agent: 'A001',
      created: '2026-10-18 09:40', pay: '2026-10-18', payType: '微信' },
    { id: 'OD20261025004', student: 'S2026002', studentName: '林子轩', parent: '林慧', phone: '13902223333',
      product: '20 课时包（一对一）', buy: 20, gift: 0, amount: 2580, paid: 0, status: '待付款', agent: 'A002',
      created: '2026-10-25 16:30', pay: '', payType: '' },
    { id: 'OD20260611005', student: 'S2026004', studentName: '孙浩宇', parent: '孙巧云', phone: '13904445555',
      product: '20 课时包（一对一）', buy: 20, gift: 0, amount: 2580, paid: 2580, status: '已生效', agent: 'A003',
      created: '2026-06-11 11:10', pay: '2026-06-11', payType: '支付宝' },
    { id: 'OD20261030006', student: 'S2026007', studentName: '林雨萱', parent: '林慧', phone: '13902223333',
      product: '体验课 10 课时', buy: 10, gift: 1, amount: 1280, paid: 1280, status: '退款处理中', agent: '',
      created: '2026-10-30 19:15', pay: '2026-10-30', payType: '微信' },
  ],

  accounts: [
    { id: 'ACC-2026-0001', student: '陈可欣', parent: '陈志强', product: '60 课时包（一对一）', buy: 60, gift: 0, used: 18, adjust: 0, remain: 42, valid: '2027-09-11', status: '正常' },
    { id: 'ACC-2026-0002', student: '林子轩', parent: '林慧', product: '30 课时包（一对一）', buy: 30, gift: 2, used: 24, adjust: 0, remain: 8, valid: '2027-04-07', status: '正常' },
    { id: 'ACC-2026-0003', student: '赵一诺', parent: '赵明', product: '60 课时包（一对一）', buy: 60, gift: 0, used: 12, adjust: -1, remain: 3, valid: '2027-05-19', status: '余额不足' },
    { id: 'ACC-2026-0004', student: '孙浩宇', parent: '孙巧云', product: '20 课时包（一对一）', buy: 20, gift: 0, used: 5, adjust: 0, remain: 15, valid: '2026-12-10', status: '正常' },
    { id: 'ACC-2026-0005', student: '孙雨桐', parent: '孙巧云', product: '20 课时包（一对一）', buy: 20, gift: 0, used: 2, adjust: 0, remain: 18, valid: '2026-12-10', status: '正常' },
    { id: 'ACC-2026-0006', student: '付嘉禾', parent: '陈志强', product: '30 课时包（一对一）', buy: 30, gift: 2, used: 4, adjust: 0, remain: 28, valid: '2027-04-17', status: '正常' },
  ],

  flows: [
    { id: 'FL20261102001', student: '陈可欣', account: 'ACC-2026-0001', type: '正常扣课', delta: -1, before: 43, after: 42, ref: 'C20261102001 课程完成', op: '系统', time: '2026-11-02 10:35', note: '课程完成后自动扣课' },
    { id: 'FL20261101002', student: '赵一诺', account: 'ACC-2026-0003', type: '正常扣课', delta: -1, before: 4, after: 3, ref: 'C20261101003 课程完成', op: '系统', time: '2026-11-01 20:10', note: '余额不足预警' },
    { id: 'FL20261031003', student: '付嘉禾', account: 'ACC-2026-0006', type: '购买入账', delta: 30, before: 0, after: 30, ref: 'OD20261018003 订单生效', op: '张敏', time: '2026-10-31 09:00', note: '订单确认后入账' },
    { id: 'FL20261031004', student: '付嘉禾', account: 'ACC-2026-0006', type: '赠送入账', delta: 2, before: 0, after: 2, ref: 'OD20261018003 赠送课时', op: '张敏', time: '2026-10-31 09:00', note: '商品允许赠送 2 课时' },
    { id: 'FL20261030005', student: '林子轩', account: 'ACC-2026-0002', type: '扣课冲正', delta: 1, before: 7, after: 8, ref: 'FL20261029008 冲正', op: '张敏', time: '2026-10-30 17:20', note: '课程取消，原扣课冲正（原流水保留）' },
    { id: 'FL20261029006', student: '孙浩宇', account: 'ACC-2026-0004', type: '正常扣课', delta: -1, before: 16, after: 15, ref: 'C20261029005 课程完成', op: '系统', time: '2026-10-29 19:05', note: '' },
    { id: 'FL20261028007', student: '孙雨桐', account: 'ACC-2026-0005', type: '课时补入', delta: 1, before: 17, after: 18, ref: '教务补课登记', op: '教务处-小陈', time: '2026-10-28 15:40', note: '教师请假补课 1 课时' },
    { id: 'FL20261026008', student: '陈可欣', account: 'ACC-2026-0001', type: '正常扣课', delta: -1, before: 44, after: 43, ref: 'C20261026002 课程完成', op: '系统', time: '2026-10-26 20:00', note: '' },
    { id: 'FL20261024009', student: '赵一诺', account: 'ACC-2026-0003', type: '课时调整', delta: -1, before: 5, after: 4, ref: '教务调整', op: '张敏', time: '2026-10-24 11:15', note: '重复扣课调整（已留痕）' },
    { id: 'FL20261020010', student: '林雨萱', account: 'ACC-2026-0007', type: '购买入账', delta: 10, before: 0, after: 10, ref: 'OD20261030006 订单生效', op: '张敏', time: '2026-10-20 10:00', note: '' },
  ],

  courses: [
    { id: 'C20261102001', date: '2026-11-02', start: '09:00', end: '10:00', student: '陈可欣', teacher: '李婉', type: '一对一', status: '已完成', deduct: '已扣课', creator: '教务处-小陈', meeting: '已生成', meetingUrl: 'https://meeting.tencent.com/dm/LearnEngChenKX', note: '' },
    { id: 'C20261102002', date: '2026-11-02', start: '10:15', end: '11:15', student: '付嘉禾', teacher: '李婉', type: '一对一', status: '待上课', deduct: '未扣课', creator: '教务处-小陈', meeting: '已生成', meetingUrl: 'https://meeting.tencent.com/dm/LearnEngFuJH', note: '' },
    { id: 'C20261102003', date: '2026-11-02', start: '14:00', end: '15:00', student: '赵一诺', teacher: '何俊', type: '一对一', status: '待上课', deduct: '未扣课', creator: '教务处-小陈', meeting: '已生成', meetingUrl: 'https://meeting.tencent.com/dm/LearnEngZhaoYN', note: '' },
    { id: 'C20261102004', date: '2026-11-02', start: '16:00', end: '17:00', student: '孙浩宇', teacher: '沈心怡', type: '一对一', status: '待上课', deduct: '未扣课', creator: '教务处-小陈', meeting: '未生成', note: '学员请假待确认' },
    { id: 'C20261102005', date: '2026-11-02', start: '19:00', end: '20:00', student: '陈可欣', teacher: '李婉', type: '一对一', status: '待上课', deduct: '未扣课', creator: '教务处-小陈', meeting: '已生成', meetingUrl: 'https://meeting.tencent.com/dm/LearnEngChenKX2', note: '' },
    { id: 'C20261103001', date: '2026-11-03', start: '09:00', end: '10:00', student: '林子轩', teacher: '周雅', type: '一对一', status: '待上课', deduct: '未扣课', creator: '教务处-小陈', meeting: '已生成', meetingUrl: 'https://meeting.tencent.com/dm/LearnEngLinZX', note: '' },
    { id: 'C20261103002', date: '2026-11-03', start: '10:30', end: '11:30', student: '林雨萱', teacher: '沈心怡', type: '一对一', status: '待上课', deduct: '未扣课', creator: '教务处-小陈', meeting: '已生成', meetingUrl: 'https://meeting.tencent.com/dm/LearnEngLinYX', note: '' },
    { id: 'C20261103003', date: '2026-11-03', start: '15:00', end: '16:00', student: '赵一诺', teacher: '何俊', type: '一对一', status: '待上课', deduct: '未扣课', creator: '教务处-小陈', meeting: '已生成', meetingUrl: 'https://meeting.tencent.com/dm/LearnEngZhaoYN2', note: '' },
    { id: 'C20261104001', date: '2026-11-04', start: '09:00', end: '10:00', student: '陈可欣', teacher: '李婉', type: '一对一', status: '待上课', deduct: '未扣课', creator: '教务处-小陈', meeting: '已生成', meetingUrl: 'https://meeting.tencent.com/dm/LearnEngChenKX3', note: '' },
    { id: 'C20261104002', date: '2026-11-04', start: '14:00', end: '15:00', student: '孙雨桐', teacher: '周雅', type: '一对一', status: '待上课', deduct: '未扣课', creator: '教务处-小陈', meeting: '已生成', meetingUrl: 'https://meeting.tencent.com/dm/LearnEngSunYT', note: '' },
    { id: 'C20261031001', date: '2026-10-31', start: '19:00', end: '20:00', student: '陈可欣', teacher: '李婉', type: '一对一', status: '已完成', deduct: '已扣课', creator: '教务处-小陈', meeting: '已生成', note: '' },
    { id: 'C20261030002', date: '2026-10-30', start: '18:00', end: '19:00', student: '林子轩', teacher: '周雅', type: '一对一', status: '未上课', deduct: '未扣课', creator: '教务处-小陈', meeting: '已生成', note: '学员临时缺课' },
    { id: 'C20261029003', date: '2026-10-29', start: '19:00', end: '20:00', student: '赵一诺', teacher: '何俊', type: '一对一', status: '待处理', deduct: '扣课异常', creator: '教务处-小陈', meeting: '已生成', note: '课时余额不足，待教务处理' },
    { id: 'C20261028004', date: '2026-10-28', start: '17:00', end: '18:00', student: '孙浩宇', teacher: '沈心怡', type: '一对一', status: '已取消', deduct: '未扣课', creator: '教务处-小陈', meeting: '已生成', note: '教师请假，已补课' },
    /* 已退出教师郑好（T006）的历史课：退出的只是合作关系，这两节课的授课教师永久是郑好 */
    { id: 'C20260528001', date: '2026-05-28', start: '19:00', end: '20:00', student: '赵一诺', teacher: '郑好', type: '一对一', status: '已完成', deduct: '已扣课', creator: '教务处-小陈', meeting: '已生成', note: '' },
    { id: 'C20260611002', date: '2026-06-11', start: '19:00', end: '20:00', student: '赵一诺', teacher: '郑好', type: '一对一', status: '已完成', deduct: '已扣课', creator: '教务处-小陈', meeting: '已生成', note: '' },
  ],

  /* ============================================================
     词库种子（仿真「每份 Excel 一个词库」的入库结果）
     ------------------------------------------------------------
     每个词库 = 一份来源 Excel；words 是该词库的关联单词，数组顺序即词库内排序。
     基础单词按英文去重：family / friend / meet / those 同时出现在两个词库中，
     共用同一条基础单词，只增加词库关联 —— 这正是多对多模型要表达的事实。
     ============================================================ */
  wordbookSeeds: [
    {
      id: 'WB001', name: '人教版 七年级上 Unit 1 词汇', category: '教材',
      bookVersion: '人教版', schoolStage: '初中', grade: '七年级', term: '上学期',
      organization: '按单元',
      description: '人教版七年级上册 Unit 1 核心词汇，按教材出现顺序排列。单词训练时按本顺序生成待训练队列。',
      sourceFile: '人教版七上U1词汇.xlsx', createdAt: '2026-08-20 11:02', status: '启用',
      words: [
        { en: 'name', ph: '/neɪm/', pos: 'n./v.', cn: '名字；命名；说出…的名字',
          mean: [{ pos: 'n.', cn: '名字' }, { pos: 'v.', cn: '命名；说出…的名字' }] },
        { en: 'nice', ph: '/naɪs/', pos: 'adj.', cn: '令人愉快的；友好的' },
        { en: 'meet', ph: '/miːt/', pos: 'v.', cn: '遇见；相识' },
        { en: 'too', ph: '/tuː/', pos: 'adv.', cn: '也；太' },
        { en: 'your', ph: '/jɔː(r)/', pos: 'pron.', cn: '你的；你们的' },
        { en: 'his', ph: '/hɪz/', pos: 'pron.', cn: '他的' },
        { en: 'her', ph: '/hɜː(r)/', pos: 'pron.', cn: '她的；她' },
        { en: 'yes', ph: '/jes/', pos: 'adv.', cn: '是的' },
        { en: 'she', ph: '/ʃiː/', pos: 'pron.', cn: '她' },
        { en: 'he', ph: '/hiː/', pos: 'pron.', cn: '他' },
        { en: 'no', ph: '/nəʊ/', pos: 'adv.', cn: '不；没有' },
        { en: 'not', ph: '/nɒt/', pos: 'adv.', cn: '不' },
        { en: 'friend', ph: '/frend/', pos: 'n.', cn: '朋友' },
        { en: 'question', ph: '/ˈkwestʃən/', pos: 'n./v.', cn: '问题；询问；质疑',
          mean: [{ pos: 'n.', cn: '问题' }, { pos: 'v.', cn: '询问；质疑' }] },
        { en: 'answer', ph: '/ˈɑːnsə(r)/', pos: 'n./v.', cn: '回答；答案',
          mean: [{ pos: 'n.', cn: '回答；答案' }, { pos: 'v.', cn: '回答' }] },
        { en: 'look', ph: '/lʊk/', pos: 'v./n.', cn: '看；看起来；看一眼',
          mean: [{ pos: 'v.', cn: '看；看起来' }, { pos: 'n.', cn: '看一眼' }] },
        { en: 'first', ph: '/fɜːst/', pos: 'adj./adv.', cn: '第一的；首先',
          mean: [{ pos: 'adj.', cn: '第一的' }, { pos: 'adv.', cn: '首先' }] },
        { en: 'last', ph: '/lɑːst/', pos: 'adj./v.', cn: '最后的；持续',
          mean: [{ pos: 'adj.', cn: '最后的；上一个' }, { pos: 'v.', cn: '持续' }] },
        { en: 'class', ph: '/klɑːs/', pos: 'n.', cn: '班级；课' },
        { en: 'classroom', ph: '/ˈklɑːsruːm/', pos: 'n.', cn: '教室' },
        { en: 'library', ph: '/ˈlaɪbrəri/', pos: 'n.', cn: '图书馆' },
        { en: 'happy', ph: '/ˈhæpi/', pos: 'adj.', cn: '高兴的；快乐的' },
        { en: 'family', ph: '/ˈfæməli/', pos: 'n.', cn: '家；家人' },
      ]
    },
    {
      id: 'WB002', name: '人教版 七年级上 Unit 2 词汇', category: '教材',
      bookVersion: '人教版', schoolStage: '初中', grade: '七年级', term: '上学期',
      organization: '按单元',
      description: 'Unit 2「This is my sister」家庭成员与指代词汇。',
      sourceFile: '人教版七上U2词汇.xlsx', createdAt: '2026-08-20 11:20', status: '启用',
      words: [
        { en: 'sister', ph: '/ˈsɪstə(r)/', pos: 'n.', cn: '姐；妹' },
        { en: 'brother', ph: '/ˈbrʌðə(r)/', pos: 'n.', cn: '兄；弟' },
        { en: 'mother', ph: '/ˈmʌðə(r)/', pos: 'n.', cn: '母亲；妈妈' },
        { en: 'father', ph: '/ˈfɑːðə(r)/', pos: 'n.', cn: '父亲；爸爸' },
        { en: 'parent', ph: '/ˈpeərənt/', pos: 'n.', cn: '父亲（或母亲）；家长' },
        { en: 'grandmother', ph: '/ˈɡrænmʌðə(r)/', pos: 'n.', cn: '祖母；外祖母' },
        { en: 'grandfather', ph: '/ˈɡrænfɑːðə(r)/', pos: 'n.', cn: '祖父；外祖父' },
        { en: 'aunt', ph: '/ɑːnt/', pos: 'n.', cn: '姑母；姨母；婶婶' },
        { en: 'uncle', ph: '/ˈʌŋkl/', pos: 'n.', cn: '叔叔；舅舅；伯伯' },
        { en: 'cousin', ph: '/ˈkʌzn/', pos: 'n.', cn: '堂（表）兄弟姐妹' },
        { en: 'son', ph: '/sʌn/', pos: 'n.', cn: '儿子' },
        { en: 'daughter', ph: '/ˈdɔːtə(r)/', pos: 'n.', cn: '女儿' },
        { en: 'family', ph: '/ˈfæməli/', pos: 'n.', cn: '家；家人' },
        { en: 'friend', ph: '/frend/', pos: 'n.', cn: '朋友' },
        { en: 'these', ph: '/ðiːz/', pos: 'pron.', cn: '这些' },
        { en: 'those', ph: '/ðəʊz/', pos: 'pron.', cn: '那些' },
        { en: 'who', ph: '/huː/', pos: 'pron.', cn: '谁' },
        { en: 'photo', ph: '/ˈfəʊtəʊ/', pos: 'n.', cn: '照片' },
        { en: 'here', ph: '/hɪə(r)/', pos: 'adv.', cn: '这里；在这里' },
        { en: 'dear', ph: '/dɪə(r)/', pos: 'adj.', cn: '亲爱的' },
        { en: 'thanks', ph: '/θæŋks/', pos: 'n.', cn: '感谢；谢意' },
        { en: 'have', ph: '/hæv/', pos: 'v.', cn: '有；吃；进行' },
      ]
    },
    {
      id: 'WB003', name: '人教版 八年级上 Unit 1 词汇', category: '教材',
      bookVersion: '人教版', schoolStage: '初中', grade: '八年级', term: '上学期',
      organization: '按单元',
      description: 'Unit 1「Where did you go on vacation」假期与旅行主题词汇。',
      sourceFile: '人教版八上U1词汇.xlsx', createdAt: '2026-08-22 09:15', status: '启用',
      words: [
        { en: 'vacation', ph: '/vəˈkeɪʃn/', pos: 'n.', cn: '假期；休假' },
        { en: 'camp', ph: '/kæmp/', pos: 'v./n.', cn: '露营；营地' },
        { en: 'museum', ph: '/mjuˈziːəm/', pos: 'n.', cn: '博物馆' },
        { en: 'beach', ph: '/biːtʃ/', pos: 'n.', cn: '海滩；沙滩' },
        { en: 'mountain', ph: '/ˈmaʊntən/', pos: 'n.', cn: '山；山脉' },
        { en: 'trip', ph: '/trɪp/', pos: 'n.', cn: '旅行；旅程' },
        { en: 'wonderful', ph: '/ˈwʌndəfl/', pos: 'adj.', cn: '精彩的；极好的' },
        { en: 'delicious', ph: '/dɪˈlɪʃəs/', pos: 'adj.', cn: '美味的；可口的' },
        { en: 'terrible', ph: '/ˈterəbl/', pos: 'adj.', cn: '糟糕的；可怕的' },
        { en: 'activity', ph: '/ækˈtɪvəti/', pos: 'n.', cn: '活动' },
        { en: 'decide', ph: '/dɪˈsaɪd/', pos: 'v.', cn: '决定；选定' },
        { en: 'try', ph: '/traɪ/', pos: 'v./n.', cn: '尝试；努力' },
        { en: 'bicycle', ph: '/ˈbaɪsɪkl/', pos: 'n.', cn: '自行车' },
        { en: 'building', ph: '/ˈbɪldɪŋ/', pos: 'n.', cn: '建筑物；楼房' },
        { en: 'trader', ph: '/ˈtreɪdə(r)/', pos: 'n.', cn: '商人；交易者' },
        { en: 'difference', ph: '/ˈdɪfrəns/', pos: 'n.', cn: '差别；不同之处' },
        { en: 'umbrella', ph: '/ʌmˈbrelə/', pos: 'n.', cn: '雨伞' },
        { en: 'wet', ph: '/wet/', pos: 'adj.', cn: '湿的；潮湿的' },
        { en: 'hungry', ph: '/ˈhʌŋɡri/', pos: 'adj.', cn: '饥饿的' },
        { en: 'enough', ph: '/ɪˈnʌf/', pos: 'adj./adv.', cn: '足够的；足够地' },
        { en: 'top', ph: '/tɒp/', pos: 'n.', cn: '顶部；顶端' },
        { en: 'wonder', ph: '/ˈwʌndə(r)/', pos: 'v.', cn: '想知道；感到惊讶' },
        { en: 'quite', ph: '/kwaɪt/', pos: 'adv.', cn: '相当；很' },
        { en: 'diary', ph: '/ˈdaɪəri/', pos: 'n.', cn: '日记；日记簿' },
      ]
    },
    {
      id: 'WB004', name: '外研版 五年级上 Module 1 词汇', category: '教材',
      bookVersion: '外研版', schoolStage: '小学', grade: '五年级', term: '上学期',
      organization: '按单元',
      description: 'Module 1「Did you come back yesterday」一般过去时入门词汇。',
      sourceFile: '外研版五上M1词汇.xlsx', createdAt: '2026-08-25 14:30', status: '启用',
      words: [
        { en: 'come', ph: '/kʌm/', pos: 'v.', cn: '来；来到' },
        { en: 'back', ph: '/bæk/', pos: 'adv.', cn: '回来；向后' },
        { en: 'yesterday', ph: '/ˈjestədeɪ/', pos: 'n./adv.', cn: '昨天' },
        { en: 'meet', ph: '/miːt/', pos: 'v.', cn: '遇见；相识' },
        { en: 'ground', ph: '/ɡraʊnd/', pos: 'n.', cn: '地面；场地' },
        { en: 'ice cream', ph: '/ˌaɪs ˈkriːm/', pos: 'n.', cn: '冰淇淋' },
        { en: 'wait', ph: '/weɪt/', pos: 'v.', cn: '等待；等候' },
        { en: 'hurry', ph: '/ˈhʌri/', pos: 'v.', cn: '匆忙；赶快' },
        { en: 'finish', ph: '/ˈfɪnɪʃ/', pos: 'v.', cn: '完成；结束' },
        { en: 'drop', ph: '/drɒp/', pos: 'v.', cn: '掉落；落下' },
        { en: 'above', ph: '/əˈbʌv/', pos: 'prep.', cn: '在…上方' },
        { en: 'those', ph: '/ðəʊz/', pos: 'pron.', cn: '那些' },
        { en: 'email', ph: '/ˈiːmeɪl/', pos: 'n./v.', cn: '电子邮件；发电子邮件' },
        { en: 'love', ph: '/lʌv/', pos: 'v./n.', cn: '爱；喜爱' },
        { en: 'weekend', ph: '/ˌwiːkˈend/', pos: 'n.', cn: '周末' },
        { en: 'letter', ph: '/ˈletə(r)/', pos: 'n.', cn: '信；字母' },
      ]
    },
    {
      id: 'WB005', name: '外研版 六年级上 Module 2 词汇', category: '教材',
      bookVersion: '外研版', schoolStage: '小学', grade: '六年级', term: '上学期',
      organization: '按单元',
      description: 'Module 2「There is Chinese dancing」场所与描述类词汇。',
      sourceFile: '外研版六上M2词汇.xlsx', createdAt: '2026-08-25 14:46', status: '启用',
      words: [
        { en: 'Chinatown', ph: '/ˈtʃaɪnətaʊn/', pos: 'n.', cn: '唐人街；中国城' },
        { en: 'dancing', ph: '/ˈdɑːnsɪŋ/', pos: 'n.', cn: '跳舞；舞蹈' },
        { en: 'restaurant', ph: '/ˈrestrɒnt/', pos: 'n.', cn: '餐馆；饭店' },
        { en: 'square', ph: '/skweə(r)/', pos: 'n.', cn: '广场；正方形' },
        { en: 'lake', ph: '/leɪk/', pos: 'n.', cn: '湖；湖泊' },
        { en: 'boat', ph: '/bəʊt/', pos: 'n.', cn: '小船；艇' },
        { en: 'tired', ph: '/ˈtaɪəd/', pos: 'adj.', cn: '疲倦的；累的' },
        { en: 'postcard', ph: '/ˈpəʊstkɑːd/', pos: 'n.', cn: '明信片' },
        { en: 'shop', ph: '/ʃɒp/', pos: 'n./v.', cn: '商店；购物' },
        { en: 'special', ph: '/ˈspeʃl/', pos: 'adj.', cn: '特别的；特殊的' },
        { en: 'surprise', ph: '/səˈpraɪz/', pos: 'n./v.', cn: '惊喜；使惊讶' },
        { en: 'moon', ph: '/muːn/', pos: 'n.', cn: '月亮；月球' },
      ]
    },
    {
      id: 'WB006', name: '人教版 九年级上 Unit 3 词汇', category: '教材',
      bookVersion: '人教版', schoolStage: '初中', grade: '九年级', term: '上学期',
      organization: '按单元',
      description: 'Unit 3「Could you tell me where the restrooms are」问路与礼貌请求词汇。已停用：待与新版教材核对后启用。',
      sourceFile: '人教版九上U3词汇.xlsx', createdAt: '2026-09-01 10:05', status: '停用',
      words: [
        { en: 'restroom', ph: '/ˈrestruːm/', pos: 'n.', cn: '洗手间；卫生间' },
        { en: 'stamp', ph: '/stæmp/', pos: 'n.', cn: '邮票；印章' },
        { en: 'bookstore', ph: '/ˈbʊkstɔː(r)/', pos: 'n.', cn: '书店' },
        { en: 'department', ph: '/dɪˈpɑːtmənt/', pos: 'n.', cn: '部门；百货公司' },
        { en: 'magazine', ph: '/ˌmæɡəˈziːn/', pos: 'n.', cn: '杂志' },
        { en: 'pardon', ph: '/ˈpɑːdn/', pos: 'int.', cn: '对不起；请再说一遍' },
        { en: 'beside', ph: '/bɪˈsaɪd/', pos: 'prep.', cn: '在…旁边' },
        { en: 'central', ph: '/ˈsentrəl/', pos: 'adj.', cn: '中心的；中央的' },
        { en: 'nearby', ph: '/ˌnɪəˈbaɪ/', pos: 'adj./adv.', cn: '附近的；在附近' },
        { en: 'mail', ph: '/meɪl/', pos: 'v./n.', cn: '邮寄；邮件' },
        { en: 'staff', ph: '/stɑːf/', pos: 'n.', cn: '职员；全体员工' },
        { en: 'suggest', ph: '/səˈdʒest/', pos: 'v.', cn: '建议；提议' },
        { en: 'convenient', ph: '/kənˈviːniənt/', pos: 'adj.', cn: '方便的；便利的' },
        { en: 'corner', ph: '/ˈkɔːnə(r)/', pos: 'n.', cn: '角落；拐角' },
        { en: 'polite', ph: '/pəˈlaɪt/', pos: 'adj.', cn: '有礼貌的；客气的' },
        { en: 'direct', ph: '/dəˈrekt/', pos: 'adj./v.', cn: '直接的；指路' },
        { en: 'request', ph: '/rɪˈkwest/', pos: 'n./v.', cn: '请求；要求' },
        { en: 'whom', ph: '/huːm/', pos: 'pron.', cn: '谁（宾格）' },
        { en: 'grape', ph: '/ɡreɪp/', pos: 'n.', cn: '葡萄' },
        { en: 'correct', ph: '/kəˈrekt/', pos: 'adj./v.', cn: '正确的；改正' },
      ]
    },
  ],

  articles: [
    { id: 'AR001', name: 'My First Day at School', book: '人教版', grade: '七年级', term: '上学期', unit: 'Unit 1', sentences: 8, audio: '已就绪', status: '启用' },
    { id: 'AR002', name: 'A Trip to the Library', book: '人教版', grade: '七年级', term: '上学期', unit: 'Unit 2', sentences: 6, audio: '部分缺失', status: '启用' },
    { id: 'AR003', name: 'The Four Seasons', book: '外研版', grade: '五年级', term: '上学期', unit: 'Module 1', sentences: 7, audio: '已就绪', status: '启用' },
    { id: 'AR004', name: 'Our Family Weekend', book: '外研版', grade: '六年级', term: '上学期', unit: 'Module 2', sentences: 5, audio: '未生成', status: '启用' },
  ],

  /* 词库单词统一来自 wordbookSeeds（每份 Excel 对应一个词库），不再单独维护一份全局词表 */

  sentences: [
    { i: 1, en: 'Today is my first day at school.', cn: '今天是我上学的第一天。' },
    { i: 2, en: 'I meet my new teacher in the classroom.', cn: '我在教室里见到了我的新老师。' },
    { i: 3, en: 'She is very nice and her name is Miss Li.', cn: '她非常友好，她的名字是李老师。' },
    { i: 4, en: 'I sit with a boy, and his name is Tom.', cn: '我和一个男孩坐在一起，他的名字是汤姆。' },
    { i: 5, en: 'We look at the questions on the blackboard.', cn: '我们看着黑板上的问题。' },
    { i: 6, en: 'I know the first answer, and Tom knows the last one.', cn: '我知道第一个答案，汤姆知道最后一个。' },
    { i: 7, en: 'We are happy to be friends.', cn: '我们很高兴成为朋友。' },
    { i: 8, en: 'I love my new class and my new family.', cn: '我喜欢我的新班级和新的大家庭。' },
  ],

  /* 莱特纳 / 21 天等学习域数据已迁至 assets/js/store.js（统一数据层），
     本文件仅保留机构、人员、商品、订单、课程、词库资源等基础演示数据。 */

  reports: [
    { id: 'RP001', date: '2026-10-31', student: '陈可欣', course: 'C20261031001', topic: 'Unit 3 词汇强化 + 短文听读',
      words: 23, passed: 16, review: 7, article: 'A Trip to the Library', status: '已提交', teacher: '李婉' },
    { id: 'RP002', date: '2026-10-30', student: '付嘉禾', course: 'C20261030001', topic: 'Unit 1 单词初筛',
      words: 23, passed: 12, review: 11, article: '—', status: '草稿', teacher: '李婉' },
    { id: 'RP003', date: '2026-10-28', student: '陈可欣', course: 'C20261028001', topic: 'Unit 2 词汇复习 + 21 天节点',
      words: 18, passed: 14, review: 4, article: 'My First Day at School', status: '已提交', teacher: '李婉' },
    { id: 'RP004', date: '2026-10-25', student: '陈可欣', course: 'C20261025001', topic: 'Unit 2 词汇首次训练',
      words: 28, passed: 20, review: 8, article: '—', status: '已撤回', teacher: '李婉' },
  ],

  todos: [
    { type: 'danger', text: '赵一诺 的课时账户余额不足（剩余 3 课时），10-29 课程处于待处理状态', action: '去处理', href: 'admin/hour-account.html' },
    { type: 'warn', text: '林子轩 的账户剩余 8 课时，低于 10 课时预警线', action: '查看账户', href: 'admin/hour-account.html' },
    { type: 'info', text: '2 份学习报告为草稿状态，尚未提交给家长', action: '去提交', href: 'teacher/teaching-record.html' },
    { type: 'warn', text: '学员 陈可欣 有 34 个单词处于待复习状态，今日红盒到期 6 个', action: '查看复习', href: 'teacher/leitner.html' },
  ],
};

window.DB = DB;
