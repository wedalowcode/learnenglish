/* ============================================================
   英语一对一教学平台 · 原型公共脚本
   纯 ES6，无依赖，直接 file:// 打开可用
   ============================================================ */

window.PROTO_ROOT = window.PROTO_ROOT || '';

const Proto = (() => {
  const root = () => window.PROTO_ROOT || '';

  /* ---------------- 菜单配置（按角色） ---------------- */
  const MENUS = {
    admin: [
      { group: '工作台', items: [
        { id: 'dashboard', label: '经营概览', href: 'admin/dashboard.html' },
      ]},
      { group: '招生管理', items: [
        { id: 'lead-list', label: '客户线索', href: 'admin/lead-list.html' },
        { id: 'agent-list', label: '代理管理', href: 'admin/agent-list.html' },
      ]},
      { group: '教学管理', items: [
        { id: 'student-list', label: '学员管理', href: 'admin/student-list.html' },
        { id: 'parent-list', label: '家长管理', href: 'admin/parent-list.html' },
        { id: 'teacher-list', label: '教师管理', href: 'admin/teacher-list.html' },
        { id: 'schedule-calendar', label: '课程排课', href: 'admin/schedule-calendar.html' },
        { id: 'course-list', label: '课程记录', href: 'admin/course-list.html' },
      ]},
      { group: '商品订单', items: [
        { id: 'product-list', label: '课程商品', href: 'admin/product-list.html' },
        { id: 'order-list', label: '订单管理', href: 'admin/order-list.html' },
      ]},
      { group: '财务管理', items: [
        { id: 'hour-account', label: '课时账户', href: 'admin/hour-account.html' },
        { id: 'hour-flow', label: '课时流水', href: 'admin/hour-flow.html' },
      ]},
      { group: '资源中心', items: [
        { id: 'material-list', label: '教材结构', href: 'resource/material-list.html' },
        { id: 'wordbook-list', label: '词库管理', href: 'resource/wordbook-list.html' },
        { id: 'article-list', label: '文章管理', href: 'resource/article-list.html' },
        { id: 'import', label: '资源导入', href: 'resource/import.html' },
      ]},
      { group: '系统设置', items: [
        { id: 'system', label: '用户与权限', href: 'admin/system.html' },
      ]},
    ],
    teacher: [
      { group: '教学工作台', items: [
        { id: 'workbench', label: '今日工作台', href: 'teacher/workbench.html' },
        { id: 'course-workbench', label: '课程工作台', href: 'teacher/course-workbench.html' },
        { id: 'my-students', label: '我的学员', href: 'teacher/my-students.html' },
        { id: 'teaching-record', label: '教学记录', href: 'teacher/teaching-record.html' },
      ]},
      { group: '教学管理', items: [
        { id: 'student-profile', label: '学员学习档案', href: 'teacher/student-profile.html' },
        { id: 'word-setup', label: '单词训练', href: 'teacher/word-training-setup.html' },
        { id: 'article-training', label: '文章训练', href: 'teacher/article-training.html' },
        { id: 'leitner', label: '莱特纳复习', href: 'teacher/leitner.html' },
        { id: 'memory21', label: '21 天记忆复习', href: 'teacher/memory21.html' },
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
      { group: '佣金管理', items: [
        { id: 'agent-commission', label: '佣金记录', href: 'agent/commission.html' },
      ]},
    ],
  };

  const ROLE_INFO = {
    admin: { name: '张敏（机构管理员）', org: '启航英语 · 城东校区', avatar: '张', cls: '' },
    teacher: { name: '李婉（教师）', org: '启航英语 · 城东校区', avatar: '李', cls: 'g' },
    agent: { name: '王磊（招生代理）', org: '启航英语 · 城东校区', avatar: '王', cls: 'a' },
  };

  /* ---------------- 布局外壳 ---------------- */
  function shell(opts = {}) {
    const role = opts.role || 'admin';
    const active = opts.active || '';
    const rid = ROLE_INFO[role] || ROLE_INFO.admin;

    const sidebar = document.getElementById('sidebar');
    if (sidebar) {
      const groups = MENUS[role] || [];
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
      topbar.innerHTML = `
        <div class="topbar-org">
          <strong>${rid.org}</strong>
          <span class="tag tag-slate nodot" style="font-size:11px">${roleName(role)}端</span>
        </div>
        <div class="topbar-right">
          <a class="btn btn-sm btn-ghost" href="${root()}index.html">切换角色</a>
          <div class="topbar-icon" title="消息通知" onclick="Proto.toast('3 条待处理提醒','warn')">✉<span class="dot"></span></div>
          <div class="user-chip"><div class="avatar ${rid.cls}">${rid.avatar}</div><span>${rid.name}</span></div>
        </div>`;
    }

    if (opts.title) document.title = opts.title + ' · 英语一对一教学平台';
  }

  function roleName(role) {
    return { admin: '老板/教务', teacher: '教师', agent: '代理', parent: '家长' }[role] || role;
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

  return {
    shell, $, $$, money, int, toast, openModal, closeModal, openDrawer, closeDrawer,
    confirmBox, initTabs, switchTab, renderRows, speak, playAudio, isPhone, markInvalid, setText,
    MENUS, roleName,
  };
})();

document.addEventListener('DOMContentLoaded', () => { Proto.initTabs(); });
