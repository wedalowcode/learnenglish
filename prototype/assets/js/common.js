/* ============================================================
   英语一对一教学平台 · 原型公共脚本
   纯 ES6，无依赖，直接 file:// 打开可用
   ============================================================ */

window.PROTO_ROOT = window.PROTO_ROOT || '';

const Proto = (() => {
  const root = () => window.PROTO_ROOT || '';
  /** 兼容尚未接入 Store 的历史页面：无数据层时退化为纯静态导航，不报错 */
  const hasStore = () => typeof Store !== 'undefined' && Store;

  /* ---------------- 菜单配置（按角色） ---------------- */
  const MENUS = {
    admin: [
      { group: '工作台', items: [
        { id: 'dashboard', label: '经营概览', href: 'admin/dashboard.html' },
      ]},
      { group: '招生管理', items: [
        { id: 'lead-list', label: '客户线索', href: 'admin/lead-list.html' },
        { id: 'agent-list', label: '代理管理', href: 'admin/agent-list.html' },
        { id: 'renewal-list', label: '续费机会', href: 'admin/renewal-list.html' },
      ]},
      { group: '教学管理', items: [
        { id: 'student-list', label: '学员管理', href: 'admin/student-list.html' },
        { id: 'parent-list', label: '家长管理', href: 'admin/parent-list.html' },
        { id: 'parent-inquiry', label: '家长咨询', href: 'admin/parent-inquiry.html' },
        { id: 'teacher-list', label: '教师管理', href: 'admin/teacher-list.html' },
      ]},
      { group: '排课管理', items: [
        { id: 'schedule-workbench', label: '排课总览', href: 'admin/schedule-workbench.html' },
        { id: 'teacher-match', label: '教师匹配', href: 'admin/teacher-match.html' },
        { id: 'schedule-series', label: '周期排课', href: 'admin/schedule-series.html' },
        { id: 'batch-schedule', label: '批量排课', href: 'admin/batch-schedule.html' },
        { id: 'schedule-settings', label: '排课设置', href: 'admin/schedule-settings.html' },
        { id: 'schedule-calendar', label: '课程排课（旧版）', href: 'admin/schedule-calendar.html' },
        { id: 'course-list', label: '课程记录', href: 'admin/course-list.html' },
      ]},
      { group: '教务管理 · 学员接单', items: [
        { id: 'demand-list', label: '学员需求池', href: 'admin/demand-list.html' },
        { id: 'response-manage', label: '教师响应管理', href: 'admin/response-manage.html' },
      ]},
      { group: '教学资源分配', items: [
        { id: 'assign-task', label: '待分配学员', href: 'admin/assign-task.html' },
        { id: 'wordbook-request', label: '词库开通申请', href: 'admin/wordbook-request.html' },
      ]},
      { group: '商品订单', items: [
        { id: 'product-list', label: '课程商品', href: 'admin/product-list.html' },
        { id: 'order-list', label: '订单管理', href: 'admin/order-list.html' },
      ]},
      { group: '财务管理', items: [
        { id: 'hour-account', label: '课时账户', href: 'admin/hour-account.html' },
        { id: 'hour-flow', label: '课时流水', href: 'admin/hour-flow.html' },
        { id: 'teacher-pay-rules', label: '教师课时费规则', href: 'admin/teacher-pay-rules.html' },
        { id: 'teacher-settlement', label: '教师结算', href: 'admin/teacher-settlement.html' },
      ]},
      { group: '资源中心', items: [
        { id: 'material-list', label: '教材结构', href: 'resource/material-list.html' },
        { id: 'wordbook-list', label: '词库管理', href: 'resource/wordbook-list.html' },
        { id: 'article-list', label: '文章管理', href: 'resource/article-list.html' },
        { id: 'import', label: '资源导入', href: 'resource/import.html' },
      ]},
      { group: '系统设置', items: [
        { id: 'system', label: '系统设置', href: 'admin/system.html' },
      ]},
    ],
    teacher: [
      { group: '教学工作台', items: [
        { id: 'workbench', label: '今日工作台', href: 'teacher/workbench.html' },
        { id: 'course-workbench', label: '课程工作台', href: 'teacher/course-workbench.html' },
        { id: 'my-students', label: '我的学员', href: 'teacher/my-students.html' },
        { id: 'teaching-record', label: '教学记录', href: 'teacher/teaching-record.html' },
        { id: 'my-settlements', label: '我的结算', href: 'teacher/my-settlements.html' },
      ]},
      { group: '接单中心', items: [
        { id: 'demand-open', label: '待响应需求', href: 'teacher/demand-center.html?tab=open' },
        { id: 'demand-mine', label: '我的响应', href: 'teacher/demand-center.html?tab=mine' },
        { id: 'demand-wbreq', label: '词库申请', href: 'teacher/demand-center.html?tab=wbreq' },
      ]},
      { group: '教学管理', items: [
        { id: 'student-profile', label: '学员学习档案', href: 'teacher/student-profile.html' },
        { id: 'article-training', label: '文章训练', href: 'teacher/article-training.html' },
        { id: 'leitner', label: '莱特纳复习', href: 'teacher/leitner.html' },
        { id: 'memory21', label: '21 天记忆复习', href: 'teacher/memory21.html' },
      ]},
    ],
    /* 管理员：只管「正式分配」和「词库开通」，不参与教务确认，也不建需求 */
    ops: [
      { group: '教学资源分配', items: [
        { id: 'assign-task', label: '待分配学员', href: 'admin/assign-task.html?tab=task' },
        { id: 'wordbook-request', label: '待处理词库申请', href: 'admin/wordbook-request.html?tab=pending' },
        { id: 'assign-log', label: '分配记录', href: 'admin/assign-task.html?tab=log' },
        { id: 'wordbook-grant', label: '词库授权记录', href: 'admin/wordbook-request.html?tab=grant' },
      ]},
      { group: '教学管理', items: [
        { id: 'student-list', label: '学员管理', href: 'admin/student-list.html' },
        { id: 'teacher-list', label: '教师管理', href: 'admin/teacher-list.html' },
      ]},
      { group: '资源中心', items: [
        { id: 'wordbook-list', label: '词库管理', href: 'resource/wordbook-list.html' },
      ]},
      { group: '系统设置', items: [
        { id: 'system', label: '系统设置', href: 'admin/system.html' },
      ]},
    ],
    agent: [
      { group: '工作台', items: [
        { id: 'agent-workbench', label: '业绩概览', href: 'agent/workbench.html' },
      ]},
      { group: '客户管理', items: [
        { id: 'agent-customers', label: '我的客户', href: 'agent/my-customers.html' },
        { id: 'agent-report', label: '客户报备', href: 'agent/customer-create.html' },
      ]},
      { group: '续费与佣金', items: [
        { id: 'agent-renewal', label: '续费机会', href: 'agent/renewal-list.html' },
        { id: 'agent-commission', label: '佣金记录', href: 'agent/commission.html' },
      ]},
    ],
    parent: [
      { group: '孩子学习', items: [
        { id: 'parent-home', label: '学习首页', href: 'parent/home.html' },
        { id: 'parent-hours', label: '课时余额', href: 'parent/hours.html' },
        { id: 'parent-records', label: '上课记录', href: 'parent/course-records.html' },
        { id: 'parent-reports', label: '学习报告', href: 'parent/report.html' },
      ]},
    ],
  };

  const ROLE_INFO = {
    admin: { org: '启航英语 · 城东校区', cls: '' },
    staff: { org: '启航英语 · 城东校区', cls: 'b' },
    ops: { org: '启航英语 · 城东校区', cls: 'c' },
    teacher: { org: '启航英语 · 城东校区', cls: 'g' },
    agent: { org: '启航英语 · 城东校区', cls: 'a' },
    parent: { org: '启航英语 · 城东校区', cls: 'b' },
  };

  /* 角色切换器：角色清单、首页与内部账号（内部角色没有数据库账号表，使用演示身份） */
  const ROLE_META = {
    admin: { label: '老板/机构管理', short: '老板', home: 'admin/dashboard.html', cls: '', glyph: 'A' },
    staff: { label: '教务负责人', short: '教务', home: 'admin/demand-list.html', cls: 'b', glyph: '教' },
    ops: { label: '管理员', short: '管理员', home: 'admin/assign-task.html', cls: 'c', glyph: '管' },
    teacher: { label: '教师', short: '教师', home: 'teacher/workbench.html', cls: 'g', glyph: '师' },
    agent: { label: '代理', short: '代理', home: 'agent/workbench.html', cls: 'a', glyph: '代' },
    parent: { label: '家长', short: '家长', home: 'parent/home.html', cls: 'b', glyph: '家' },
  };
  const ROLE_ORDER = ['admin', 'staff', 'ops', 'teacher', 'agent', 'parent'];

  /* 菜单 → 权限编码：菜单可见性与 Store 的 rolePermissions 同源，
     角色权限被修改后刷新页面即同步收紧/放开，不再只改配置不改行为。 */
  const MENU_PERM = {
    dashboard: ['lead.view.all', 'lead.view.own'],
    'lead-list': ['lead.view.all', 'lead.view.own'],
    'agent-list': ['lead.view.all'],
    'renewal-list': ['renewal.view.all', 'renewal.view.own'],
    'student-list': ['student.view'],
    'parent-list': ['parent.view'],
    'parent-inquiry': ['parent.view'],
    'teacher-list': ['teacher.view'],
    'schedule-calendar': ['lesson.view.all', 'demand.confirm'],
    'schedule-workbench': ['lesson.view.all'],
    'teacher-match': ['lesson.view.all'],
    'schedule-series': ['lesson.view.all'],
    'batch-schedule': ['lesson.view.all'],
    'schedule-settings': ['lesson.view.all'],
    'course-list': ['lesson.view.all', 'lesson.view.own'],
    'demand-list': ['demand.view'],
    'response-manage': ['demand.confirm'],
    'assign-task': ['teacher.assign_student', 'demand.assign'],
    'wordbook-request': ['wordbook.review', 'wordbook.grant', 'wordbook.request'],
    'product-list': ['order.view.all', 'order.create'],
    'order-list': ['order.view.all', 'order.create'],
    'hour-account': ['lesson_account.view'],
    'hour-flow': ['lesson_account.view'],
    'teacher-pay-rules': ['order.view.all', 'lesson_account.view'],
    'teacher-settlement': ['order.view.all', 'lesson_account.view'],
    'material-list': ['wordbook.view'],
    'wordbook-list': ['wordbook.view'],
    'article-list': ['wordbook.view'],
    import: ['wordbook.edit', 'wordbook.create'],
    system: ['account.view', 'role.view', 'audit.view'],
    workbench: ['lesson.view.own'],
    'course-workbench': ['lesson.view.own'],
    'my-students': ['student.view'],
    'teaching-record': ['lesson.view.own'],
    'my-settlements': ['lesson.view.own'],
    'demand-open': ['demand.respond'],
    'demand-mine': ['demand.respond'],
    'demand-wbreq': ['wordbook.request'],
    'student-profile': ['student.view'],
    'word-setup': ['student.view'],
    'article-training': ['student.view'],
    leitner: ['student.view'],
    memory21: ['student.view'],
    'assign-log': ['teacher.assign_student', 'demand.assign'],
    'wordbook-grant': ['wordbook.grant', 'wordbook.review'],
    'agent-workbench': ['lead.view.own', 'lead.view.all'],
    'agent-customers': ['lead.view.own', 'lead.view.all'],
    'agent-report': ['lead.create'],
    'agent-renewal': ['renewal.view.own', 'renewal.view.all'],
    'agent-commission': ['renewal.view.own', 'renewal.view.all'],
    'parent-home': ['student.view'],
    'parent-hours': ['lesson_account.view'],
    'parent-records': ['lesson.view.own'],
    'parent-reports': ['report.view.own'],
  };

  function escHtml(v) {
    return String(v == null ? '' : v).replace(/[&<>"]/g,
      c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  /** 角色可选账号：统一从 Store 的账号表读取，禁用/未开通账号不可切换 */
  function roleAccounts(role) {
    if (!hasStore()) return [];
    const rows = Store.roleAccounts ? Store.roleAccounts(role) : [];
    return rows.map(a => ({
      id: a.id, accountId: a.accountId, profileId: a.profileId, profileType: a.profileType,
      name: a.name, code: a.code, available: a.available, reason: a.reason,
      meta: a.meta || ROLE_META[role].label
    }));
  }

  /** 当前身份只来自会话；页面角色与会话角色不一致时明确显示未识别，绝不借用他人身份 */
  function roleIdentity(role) {
    const s = hasStore() ? Store.currentSession() : { role: '' };
    const unknown = { role, name: role === 'teacher' ? '未识别教师身份'
      : role === 'parent' ? '未识别家长身份'
        : role === 'agent' ? '未识别代理身份' : '未识别员工身份', code: '', available: false };
    if (role !== s.role) return unknown;
    const ident = hasStore() && Store.currentIdentity ? Store.currentIdentity() : null;
    if (!ident) return unknown;
    return { role, name: ident.name, code: ident.code, available: ident.available, reason: ident.reason || '' };
  }

  /** 按角色权限过滤菜单；权限收紧后对应的菜单组立即消失 */
  function menusFor(role) {
    const groups = MENUS[role] || [];
    if (!hasStore()) return groups;
    return groups.map(g => ({
      group: g.group,
      items: g.items.filter(it => {
        const codes = MENU_PERM[it.id];
        if (!codes || !codes.length) return true;
        return codes.some(c => Store.hasPermission && Store.hasPermission('', c));
      })
    })).filter(g => g.items.length);
  }

  /** 页面角色：会话里已显式选择过身份就沿用该角色，否则用页面默认角色。
      不做跨角色映射（例如教师打开教务页面不会静默变成教务），权限由 Store 拦截。 */
  function pageRole(defaultRole) {
    if (!hasStore()) return defaultRole;
    const s = Store.currentSession();
    if (!(Store.sessionPersisted && Store.sessionPersisted())) return defaultRole;
    return ROLE_ORDER.indexOf(s.role) >= 0 ? s.role : defaultRole;
  }

  /* ---------------- 角色切换器组件 ---------------- */
  let roleSwitcherBound = false;
  const roleSwitcherState = { expanded: {}, open: false };

  function roleLabel(role) { return (ROLE_META[role] || ROLE_META.admin).label; }

  function closeRolePanel() {
    roleSwitcherState.open = false;
    const host = document.querySelector('[data-role-switcher]');
    if (!host) return;
    const btn = host.querySelector('.role-switch-btn');
    const panel = host.querySelector('.role-switch-panel');
    if (btn) { btn.classList.remove('on'); btn.setAttribute('aria-expanded', 'false'); }
    if (panel) panel.hidden = true;
  }

  /** 清理上一角色的临时运行态：只清 UI 缓存与弹窗，不碰 Store 业务数据 */
  function clearSwitchRuntime() {
    try {
      const keys = [];
      for (let i = 0; i < sessionStorage.length; i++) {
        const k = sessionStorage.key(i);
        if (k && (k.indexOf('ee_proto_ui_') === 0 || k.indexOf('ee_proto_draft_') === 0)) keys.push(k);
      }
      keys.forEach(k => sessionStorage.removeItem(k));
      sessionStorage.removeItem('ee_proto_demo');
    } catch (e) { /* 忽略 */ }
    document.querySelectorAll('.mask.show, .drawer.show').forEach(el => el.classList.remove('show'));
  }

  /** 显式切换身份：写入会话（角色 + 身份 ID + 操作人）后跳角色首页 */
  function switchRole(role, accountId) {
    const meta = ROLE_META[role];
    if (!meta) return;
    const acc = roleAccounts(role).filter(a => a.id === accountId || a.accountId === accountId)[0];
    if (!acc) return;
    if (!acc.available) {
      toast('该账号当前不可切换：' + (acc.reason || '不可用'), 'warn');
      return;
    }
    const pid = acc.profileId || acc.id;
    closeRolePanel();
    clearSwitchRuntime();
    try {
      Store.setSession({
        role: role,
        accountId: acc.accountId || '',
        operatorName: acc.name,
        operatorId: acc.accountId || pid,
        teacherId: role === 'teacher' ? pid : '',
        agentId: role === 'agent' ? pid : '',
        parentId: role === 'parent' ? pid : ''
      });
    } catch (e) {
      toast('切换失败：' + (e.message || '账号不可用'), 'warn');
      return;
    }
    location.href = root() + meta.home;
  }

  function roleItemHTML(role, currentRole) {
    const meta = ROLE_META[role];
    const accounts = roleAccounts(role);
    const available = accounts.filter(a => a.available);
    const hasAny = available.length > 0;
    const isCurrent = role === currentRole;
    const ident = isCurrent ? roleIdentity(role) : null;
    const currentId = ident ? ident.code : '';
    const multi = accounts.length > 1;
    const expanded = multi && (isCurrent || roleSwitcherState.expanded[role]);
    const subtitle = isCurrent && ident
      ? `当前身份：${escHtml(ident.name)}${ident.code ? ' / ' + escHtml(ident.code) : ''}`
      : (hasAny ? `${available.length} 个可用账号` : '暂无可用账号');
    const reason = !hasAny ? ((accounts[0] && accounts[0].reason) || '该角色尚未配置账号') : '';
    return `
      <div class="role-item ${isCurrent ? 'on' : ''} ${hasAny ? '' : 'disabled'}" data-role="${role}">
        <div class="role-item-main" role="button" tabindex="0" data-role="${role}"
          ${hasAny ? '' : 'aria-disabled="true"'}>
          <div class="role-avatar ${meta.cls}">${meta.glyph}</div>
          <div class="role-info">
            <div class="role-name">${escHtml(meta.label)}</div>
            <div class="role-sub">${subtitle}${reason ? ' · ' + escHtml(reason) : ''}</div>
          </div>
          <div class="role-tail">${multi && hasAny ? `<span class="role-more">可选 ${available.length} 人</span>` : ''}${hasAny ? '<span class="role-arrow">›</span>' : ''}</div>
        </div>
        ${expanded ? `<div class="role-accounts">${accounts.map(a => `
          <button type="button" class="role-account ${a.id === currentId ? 'on' : ''}"
            data-role="${escHtml(role)}" data-account="${escHtml(a.id)}"
            ${a.available ? '' : 'disabled title="' + escHtml(a.reason || '暂不可用') + '"'}>
            ${escHtml(a.name)} <span class="role-account-code">${escHtml(a.code)}</span>
            ${a.available ? '' : `<span class="role-account-why">${escHtml(a.reason)}</span>`}
          </button>`).join('')}</div>` : ''}
      </div>`;
  }

  function roleSwitcherHTML(currentRole) {
    const ident = roleIdentity(currentRole);
    const accounts = roleAccounts(currentRole);
    const activeCount = accounts.filter(a => a.available).length;
    return `
      <button type="button" class="role-switch-btn" aria-haspopup="true" aria-expanded="false"
        title="切换角色与登录身份">
        <span class="role-switch-glyph">⇄</span>
        <span class="role-switch-text">切换角色</span>
        <span class="role-switch-current">${escHtml(roleLabel(currentRole))} · ${escHtml(ident.name)}${ident.code ? ' / ' + escHtml(ident.code) : ''}</span>
        <span class="caret">▾</span>
      </button>
      <div class="role-switch-panel" hidden>
        <div class="role-switch-head">
          <b>切换角色</b>
          <span>当前 ${escHtml(roleLabel(currentRole))} · ${activeCount} 个可用账号</span>
        </div>
        <div class="role-switch-list">
          ${ROLE_ORDER.map(r => roleItemHTML(r, currentRole)).join('')}
        </div>
        <div class="role-switch-foot">切换会清理临时筛选与未保存草稿提示；业务数据与已保存记录不受影响。</div>
      </div>`;
  }

  function bindRoleSwitcher(host, currentRole) {
    host.onclick = (e) => {
      /* 面板内点击不冒泡到 document，否则多账号展开重渲染后
         原 target 已脱离文档，外部点击判定会误关面板 */
      e.stopPropagation();
      const btn = e.target.closest('.role-switch-btn');
      if (btn) {
        const panel = host.querySelector('.role-switch-panel');
        const open = panel.hidden;
        roleSwitcherState.open = open;
        panel.hidden = !open;
        btn.classList.toggle('on', open);
        btn.setAttribute('aria-expanded', open ? 'true' : 'false');
        return;
      }
      const accountBtn = e.target.closest('.role-account');
      if (accountBtn) {
        e.preventDefault();
        switchRole(accountBtn.dataset.role, accountBtn.dataset.account);
        return;
      }
      const main = e.target.closest('.role-item-main');
      if (main) {
        e.preventDefault();
        const role = main.dataset.role;
        const accounts = roleAccounts(role);
        const available = accounts.filter(a => a.available);
        if (!available.length) {
          toast('该角色暂无可用账号：' + ((accounts[0] && accounts[0].reason) || '请联系管理员配置'), 'warn');
          return;
        }
        if (accounts.length === 1) {
          switchRole(role, accounts[0].id);
        } else {
          roleSwitcherState.expanded[role] = !roleSwitcherState.expanded[role];
          roleSwitcherState.open = true;
          roleSwitcher(host._pageRole || currentRole);
        }
      }
    };
    host.onkeydown = (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const main = e.target.closest('.role-item-main');
      if (!main) return;
      e.preventDefault();
      main.click();
    };
    host._pageRole = currentRole;
    if (!roleSwitcherBound) {
      roleSwitcherBound = true;
      document.addEventListener('click', (e) => {
        if (!e.target.closest('[data-role-switcher]')) closeRolePanel();
      });
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeRolePanel();
      });
    }
  }

  /**
   * 统一角色切换组件：所有带顶栏的页面由 shell 自动挂载；
   * 家长端等没有顶栏的移动页面在 DOMContentLoaded 时挂到 .m-head。
   */
  function roleSwitcher(opts = {}) {
    const currentRole = opts.role || ((hasStore() && Store.currentSession().role) || 'admin');
    let host = document.querySelector('[data-role-switcher]');
    if (!host) {
      const right = document.querySelector('.topbar-right');
      const head = document.querySelector('.m-head');
      if (right) {
        host = document.createElement('div');
        host.className = 'role-switcher-host';
        right.insertBefore(host, right.firstChild);
      } else if (head) {
        host = document.createElement('div');
        host.className = 'role-switcher-host in-mobile';
        head.appendChild(host);
      } else {
        return null;
      }
      host.setAttribute('data-role-switcher', '');
    }
    host.classList.toggle('in-mobile', !document.querySelector('.topbar') && !!document.querySelector('.m-frame'));
    host.innerHTML = roleSwitcherHTML(currentRole);
    bindRoleSwitcher(host, currentRole);
    if (roleSwitcherState.open) {
      const btn = host.querySelector('.role-switch-btn');
      const panel = host.querySelector('.role-switch-panel');
      if (btn) { btn.classList.add('on'); btn.setAttribute('aria-expanded', 'true'); }
      if (panel) panel.hidden = false;
    }
    return host;
  }

  /* ---------------- 布局外壳 ---------------- */
  function shell(opts = {}) {
    const role = opts.role || 'admin';
    const identityRole = opts.identityRole || role;
    const active = opts.active || '';
    const rid = ROLE_INFO[identityRole] || ROLE_INFO.admin;
    const ident = roleIdentity(identityRole);

    const sidebar = document.getElementById('sidebar');
    if (sidebar) {
      const groups = menusFor(role);
      sidebar.innerHTML = `
        <div class="brand">
          <div class="brand-mark">EE</div>
          <div>
            <div class="brand-name">英语一对一教学</div>
            <div class="brand-sub">Teaching Ops Platform</div>
          </div>
        </div>
        <nav class="nav">
          ${groups.map(g => `
            <div class="nav-group">
              <div class="nav-group-title">${g.group}</div>
              ${g.items.map(it => `
                <a class="nav-item ${it.id === active ? 'active' : ''}" href="${root() + it.href}">
                  ${it.label}${it.badge ? `<span class="nav-badge">${it.badge}</span>` : ''}
                </a>`).join('')}
            </div>`).join('')}
          <div class="nav-group" style="margin-top:auto;padding-top:12px;border-top:1px solid rgba(148,163,184,.15)">
            <a class="nav-item" href="${root()}index.html">← 原型导航总览</a>
          </div>
        </nav>`;
    }

    const topbar = document.getElementById('topbar');
    if (topbar) {
      const unread = hasStore() && Store.unreadNotificationCount ? Store.unreadNotificationCount() : 0;
      topbar.innerHTML = `
        <div class="topbar-org">
          <strong>${rid.org}</strong>
          <span class="tag tag-slate nodot" style="font-size:11px">${roleName(identityRole)}端</span>
        </div>
        <div class="topbar-right">
          <div data-role-switcher></div>
          <a class="topbar-icon" title="消息中心" href="${root()}notifications.html">✉${unread ? `<span class="dot">${unread > 99 ? '99+' : unread}</span>` : ''}</a>
          <div class="user-chip"><div class="avatar ${rid.cls}">${escHtml((ident.name || '?').slice(0, 1))}</div><span>${escHtml(ident.name)}</span></div>
        </div>`;
    }

    roleSwitcher({ role: identityRole });

    if (opts.title) document.title = opts.title + ' · 英语一对一教学平台';
  }

  function roleName(role) {
    return {
      admin: '老板/机构管理', staff: '教务负责人', ops: '管理员',
      teacher: '教师', agent: '代理', parent: '家长'
    }[role] || role;
  }

  /* ---------------- 通用工具 ---------------- */
  function $(s, ctx) { return (ctx || document).querySelector(s); }
  function $$(s, ctx) { return Array.from((ctx || document).querySelectorAll(s)); }

  function money(n) {
    return '¥' + Number(n || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function int(n) { return Number(n || 0).toLocaleString('zh-CN'); }

  function toast(msg, type = '') {
    let wrap = $('.toast-wrap');
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.className = 'toast-wrap';
      document.body.appendChild(wrap);
    }
    const el = document.createElement('div');
    el.className = 'toast ' + type;
    el.textContent = msg;
    wrap.appendChild(el);
    setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .25s'; }, 2000);
    setTimeout(() => el.remove(), 2300);
  }

  function openModal(id) {
    const m = document.getElementById(id);
    if (m) m.classList.add('show');
  }
  function closeModal(id) {
    const m = document.getElementById(id);
    if (m) m.classList.remove('show');
  }
  function openDrawer(id) {
    const d = document.getElementById(id);
    if (d) d.classList.add('show');
    const mask = document.getElementById(id + '-mask');
    if (mask) mask.classList.add('show');
  }
  function closeDrawer(id) {
    const d = document.getElementById(id);
    if (d) d.classList.remove('show');
    const mask = document.getElementById(id + '-mask');
    if (mask) mask.classList.remove('show');
  }

  /* 二次确认（危险操作） */
  function confirmBox(title, desc, okText, onOk) {
    let m = document.getElementById('__confirm');
    if (!m) {
      m = document.createElement('div');
      m.id = '__confirm';
      m.className = 'mask';
      m.innerHTML = `
        <div class="modal" style="width:440px">
          <div class="modal-head"><div class="modal-title" id="__c_title"></div>
            <button class="modal-close" onclick="Proto.closeModal('__confirm')">×</button></div>
          <div class="modal-body" id="__c_body" style="font-size:13px;color:#475569;line-height:1.7"></div>
          <div class="modal-foot">
            <button class="btn" onclick="Proto.closeModal('__confirm')">取消</button>
            <button class="btn btn-danger" id="__c_ok">确定</button>
          </div>
        </div>`;
      document.body.appendChild(m);
      m.addEventListener('click', e => { if (e.target === m) closeModal('__confirm'); });
    }
    $('#__c_title').textContent = title;
    $('#__c_body').innerHTML = desc;
    const ok = $('#__c_ok');
    ok.textContent = okText || '确定';
    ok.onclick = () => { closeModal('__confirm'); onOk && onOk(); };
    openModal('__confirm');
  }

  /* Tabs */
  function initTabs(scope) {
    $$('.tabs', scope || document).forEach(bar => {
      bar.addEventListener('click', e => {
        const t = e.target.closest('.tab');
        if (!t) return;
        const target = t.dataset.pane;
        $$('.tab', bar).forEach(x => x.classList.toggle('active', x === t));
        const panes = $$('.tab-pane');
        panes.forEach(p => p.classList.toggle('active', p.id === target));
      });
    });
  }

  function switchTab(barId, paneId) {
    const bar = document.getElementById(barId);
    if (!bar) return;
    $$('.tab', bar).forEach(x => x.classList.toggle('active', x.dataset.pane === paneId));
    $$('.tab-pane').forEach(p => p.classList.toggle('active', p.id === paneId));
  }

  /* 表格渲染 */
  function renderRows(tbodyId, rows, rowFn, colspan, emptyText) {
    const tb = document.getElementById(tbodyId);
    if (!tb) return;
    if (!rows || !rows.length) {
      tb.innerHTML = `<tr><td colspan="${colspan || 6}">
        <div class="empty"><div class="e-ico">▤</div><p>${emptyText || '暂无数据'}</p></div></td></tr>`;
      return;
    }
    tb.innerHTML = rows.map(rowFn).join('');
  }

  /* 语音朗读（Web Speech API，降级静默） */
  function speak(text, lang = 'en-US') {
    if (!('speechSynthesis' in window)) { toast('当前环境不支持语音播放'); return; }
    try {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = lang;
      u.rate = .88;
      window.speechSynthesis.speak(u);
    } catch (e) { /* 静默降级 */ }
  }

  /* 音频按钮（模拟播放状态 + 语音朗读） */
  function playAudio(btn, text) {
    const label = btn.dataset.label || btn.innerHTML;
    btn.dataset.label = label;
    btn.classList.add('playing');
    btn.innerHTML = '♪ 播放中…';
    speak(text || '');
    const dur = Math.max(900, Math.min(2600, (text || '').length * 90));
    clearTimeout(btn._t);
    btn._t = setTimeout(() => {
      btn.classList.remove('playing');
      btn.innerHTML = label;
    }, dur);
  }

  /* 表单校验：手机号 */
  function isPhone(v) { return /^1[3-9]\d{9}$/.test(v || ''); }

  function markInvalid(fieldId, on) {
    const f = document.getElementById(fieldId);
    if (f) f.classList.toggle('invalid', !!on);
  }

  function setText(id, txt) {
    const el = document.getElementById(id);
    if (el) el.textContent = txt;
  }

  /**
   * 教师端身份：一律取当前登录会话里的 teacherId，绝不从 URL 的学员编号反推。
   * 演示环境没有登录页，会话为空时才用第一位「可授课」教师兜底，并写回会话，
   * 保证后续页面（我的学员 / 训练 / 报告）读到的是同一个教师身份。
   */
  let teacherNoticeShown = false;
  function showTeacherIdentityNotice() {
    if (teacherNoticeShown) return;
    teacherNoticeShown = true;
    Proto.toast('未识别教师登录身份：请从顶栏切换为具体教师账号', 'warn');
    if (typeof document === 'undefined' || !document.body) return;
    const bar = document.createElement('div');
    bar.className = 'card';
    bar.style.cssText = 'margin:16px 20px 0;padding:14px 16px;border-left:4px solid var(--warning);background:var(--surface)';
    bar.innerHTML = '<b>未识别教师身份</b><div class="small muted" style="margin-top:4px">' +
      '为避免张冠李戴，本页不会自动借用其他教师身份。请使用右上角「切换角色」选择具体教师。</div>';
    document.body.insertBefore(bar, document.body.firstChild);
  }
  function teacherId() {
    const s = Store.currentSession();
    if (s.teacherId) return s.teacherId;
    if (Store.isDemoMode && Store.isDemoMode()) {
      const demoId = Store.defaultTeacherId();
      if (demoId) {
        Store.setSession({
          role: 'teacher', teacherId: demoId,
          operatorName: (Store.teacher(demoId) || {}).name || ''
        });
        return demoId;
      }
    }
    showTeacherIdentityNotice();
    return '';
  }

  /** 当前登录教师姓名（用于操作记录 by 字段），与学生档案的「当前教师」同源 */
  function teacherName() {
    const id = teacherId();
    return (Store.teacher(id) || {}).name || '';
  }

  let agentNoticeShown = false;
  function showAgentIdentityNotice() {
    if (agentNoticeShown) return;
    agentNoticeShown = true;
    Proto.toast('未识别代理登录身份：请从代理工作台进入，或使用 ?demo=1 演示模式', 'warn');
    if (typeof document === 'undefined' || !document.body) return;
    const bar = document.createElement('div');
    bar.className = 'card';
    bar.style.cssText = 'margin:16px 20px 0;padding:14px 16px;border-left:4px solid var(--warning);background:var(--surface)';
    bar.innerHTML = '<b>未识别代理身份</b><div class="small muted" style="margin-top:4px">' +
      '为避免张冠李戴，本页不会自动借用其他代理身份。请从代理工作台登录，或在地址后加 <code>?demo=1</code> 使用演示身份。</div>';
    document.body.insertBefore(bar, document.body.firstChild);
  }
  /**
   * 当前登录代理 ID：只认会话。
   * 身份缺失时不再自动借用「第一位启用代理」（避免张冠李戴），
   * 仅显式演示模式（?demo=1）下才允许回落到演示代理。
   */
  function agentId() {
    const s = Store.currentSession();
    if (s.agentId) return s.agentId;
    const demo = Store.isDemoMode && Store.isDemoMode();
    if (!demo) {
      showAgentIdentityNotice();
      return '';
    }
    const id = Store.defaultAgentId();
    if (!id) return '';
    Store.setSession({
      role: 'agent', agentId: id,
      operatorName: (Store.agent(id) || {}).name || ''
    });
    return id;
  }
  function agentName() {
    const id = agentId();
    return id ? ((Store.agent(id) || {}).name || '') : '';
  }

  let parentNoticeShown = false;
  function showParentIdentityNotice() {
    if (parentNoticeShown) return;
    parentNoticeShown = true;
    Proto.toast('未识别家长登录身份：请使用右上角切换为具体家长账号', 'warn');
    if (typeof document === 'undefined' || !document.body) return;
    const bar = document.createElement('div');
    bar.className = 'card';
    bar.style.cssText = 'margin:16px 20px 0;padding:14px 16px;border-left:4px solid var(--warning);background:var(--surface)';
    bar.innerHTML = '<b>未识别家长身份</b><div class="small muted" style="margin-top:4px">' +
      '为避免看到别人家孩子的数据，本页不会自动借用其他家长身份。请从右上角切换到具体家长。</div>';
    document.body.insertBefore(bar, document.body.firstChild);
  }
  /** 当前登录家长 ID：只认会话；仅显式演示模式才回落到演示家长 */
  function parentId() {
    const s = Store.currentSession();
    if (s.parentId) return s.parentId;
    if (Store.isDemoMode && Store.isDemoMode()) {
      const demoId = Store.defaultParentId();
      if (demoId) {
        Store.setSession({
          role: 'parent', parentId: demoId,
          operatorName: (Store.parent(demoId) || {}).name || ''
        });
        return demoId;
      }
    }
    showParentIdentityNotice();
    return '';
  }
  function parentName() {
    const id = parentId();
    return (Store.parent(id) || {}).name || '';
  }

  return {
    shell, roleSwitcher, switchRole, roleIdentity, roleAccounts, pageRole,
    $, $$, money, int, toast, openModal, closeModal, openDrawer, closeDrawer,
    confirmBox, initTabs, switchTab, renderRows, speak, playAudio, isPhone, markInvalid, setText,
    teacherId, teacherName, agentId, agentName, parentId, parentName,
    MENUS, ROLE_META, roleName, escHtml, menusFor,
  };
})();

document.addEventListener('DOMContentLoaded', () => {
  Proto.initTabs();
  /* 家长端等没有顶栏的移动页面：把角色切换器挂到页头 */
  if (!document.querySelector('[data-role-switcher]') && document.querySelector('.m-frame')) {
    Proto.roleSwitcher({ role: 'parent' });
  }
});
