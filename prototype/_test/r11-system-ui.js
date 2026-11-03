/* 第十一轮浏览器验收：系统管理六个子模块真实点击 + 截图留证
   运行：node prototype/_test/r11-system-ui.js
   截图输出：prototype/_test/shots/（已忽略，不入库） */
const { Page, launch, sleep, ROOT } = require('./cdp');

let pass = 0, fail = 0;
const fails = [];
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  ✓ ' + name + (detail ? '（' + detail + '）' : '')); }
  else { fail++; fails.push(name + (detail !== undefined ? ' → ' + detail : '')); console.log('  ✗ ' + name + ' → ' + detail); }
}
function section(t) { console.log('\n' + t); }
async function waitFor(fn, timeout) {
  const end = Date.now() + (timeout || 6000);
  while (Date.now() < end) {
    try { if (await fn()) return true; } catch (e) { /* 页面切换中 */ }
    await sleep(150);
  }
  return false;
}
async function click(p, sel) {
  return p.eval(`var e=document.querySelector(${JSON.stringify(sel)});if(!e)return false;e.click();return true;`);
}
async function asAdmin(p) {
  await p.eval(`Store.setSession({role:'admin',accountId:'',operatorName:'',operatorId:'',
    teacherId:'',agentId:'',parentId:''});return true;`);
}

(async () => {
  const proc = await launch();
  const p = await Page.open();
  try {
    await p.goto(ROOT + 'admin/dashboard.html');
    await p.eval('localStorage.clear();location.reload();return true;');
    await sleep(900);
    await asAdmin(p);

    /* ================= 1. 系统设置入口 ================= */
    section('1. 系统设置入口六模块');
    await p.goto(ROOT + 'admin/system.html');
    ok('系统设置页加载', await waitFor(async () => await p.eval(`return !!document.querySelector('#sysGrid');`)));
    const cards = await p.eval(`return [...document.querySelectorAll('.sys-card')].map(a=>
      a.querySelector('h3').textContent.trim()+'|'+a.querySelector('.metric').textContent.replace(/\\s+/g,' ').trim());`);
    ok('六个子模块卡片齐全', cards.length === 6, cards.join(' / '));
    ok('账号卡片显示真实统计', /个账号/.test(cards[0] || ''), cards[0]);
    ok('操作日志卡片显示真实条数', /共/.test(cards[2] || ''), cards[2]);
    await p.shot('r11-01-系统设置六模块');

    /* ================= 2. 账号新增 / 启停 ================= */
    section('2. 账号新增与启停');
    await p.goto(ROOT + 'admin/account-list.html');
    ok('账号列表可打开', await waitFor(async () => await p.eval(`return !!document.querySelector('#rows');`)));
    await click(p, '#btnNew');
    const opts = await p.eval(`return [...document.querySelectorAll('#fProfile option')].map(o=>o.value+'|'+o.textContent.trim());`);
    ok('可选未绑定员工档案', opts.some(x => x.indexOf('STF004|刘洋') === 0), opts.join(' / '));
    await p.eval(`document.getElementById('fProfile').value='STF004';
      document.getElementById('fLogin').value='liuyang';
      document.getElementById('fPhone').value='13904440000';
      document.getElementById('fReason').value='新员工入职开通';return true;`);
    await click(p, '#btnCreate');
    ok('新增后账号出现在列表', await waitFor(async () => await p.eval(`
      return [...document.querySelectorAll('#rows tr')].some(r=>r.textContent.indexOf('刘洋')>=0);`)));
    const created = await p.eval(`var a=Store.accountRows().filter(x=>x.profileId==='STF004')[0];return a?{id:a.id,label:a.statusLabel}:null;`);
    ok('新增账号为启用状态', created && created.label === '启用', created && created.label);
    await p.shot('r11-02-新增账号');

    await p.eval(`window.prompt=()=>'离职交接中';return true;`);
    await p.eval(`var tr=[...document.querySelectorAll('#rows tr')].find(r=>r.textContent.indexOf('刘洋')>=0);
      var b=tr&&tr.querySelector('button[data-toggle]');if(b)b.click();return !!b;`);
    await sleep(600);
    const disabled = await p.eval(`var a=Store.accountRows().filter(x=>x.profileId==='STF004')[0];
      return a?{label:a.statusLabel,reason:a.disabledReason}:null;`);
    ok('禁用后状态与原因可见', disabled && disabled.label === '禁用' && /离职/.test(disabled.reason || ''),
      disabled && (disabled.label + '/' + disabled.reason));
    const grey = await p.eval(`var r=Proto.roleAccounts('staff').filter(x=>x.accountId===${JSON.stringify(created ? created.id : '')})[0];
      return r?{available:r.available,reason:r.reason}:null;`);
    ok('切换器对应账号置灰', grey && grey.available === false, grey && grey.reason);
    ok('禁用账号无法切入', await p.eval(`var before=Store.currentSession().role;
      Proto.switchRole('staff', ${JSON.stringify(created ? created.id : '')});
      return Store.currentSession().role===before;`));
    await p.shot('r11-03-禁用账号置灰');

    /* ================= 3. 角色权限收紧 ================= */
    section('3. 角色权限修改后菜单与操作收紧');
    const teacherRole = await p.eval(`return Store.roleOf('teacher').id;`);
    await p.goto(ROOT + 'admin/role-detail.html?id=' + teacherRole);
    ok('权限矩阵渲染', await waitFor(async () => await p.eval(`return document.querySelectorAll('#matrix input[type=checkbox]').length>0;`)));
    ok('权限矩阵按模块分组', await p.eval(`return document.querySelectorAll('.perm-module').length>=4;`));
    const before = await p.eval(`return Store.permissionMatrix('teacher').modules.reduce((n,m)=>
      n+m.items.filter(i=>i.enabled).length,0);`);
    await p.eval(`['student.view','wordbook.request'].forEach(c=>{
      var b=document.querySelector('input[data-code="'+c+'"]');if(b){b.checked=false;b.dispatchEvent(new Event('change',{bubbles:true}));}
    });document.getElementById('fReason').value='按校区要求收紧教师权限';return true;`);
    await click(p, '#btnSave');
    await sleep(1200);
    const after = await p.eval(`return Store.permissionMatrix('teacher').modules.reduce((n,m)=>
      n+m.items.filter(i=>i.enabled).length,0);`);
    ok('保存后权限数量减少', after < before, before + ' → ' + after);
    await p.shot('r11-04-教师权限收紧');

    const tAcc = await p.eval(`var a=Proto.roleAccounts('teacher').filter(x=>x.available)[0];
      Proto.switchRole('teacher', a.accountId);return a.accountId;`);
    await waitFor(async () => (await p.eval('return location.href;')).indexOf('teacher/workbench') >= 0);
    await waitFor(async () => await p.eval(`return document.querySelectorAll('.nav-item').length>0;`));
    const tNav = await p.eval(`return [...document.querySelectorAll('.nav-item')].map(e=>e.textContent.trim()).join('|');`);
    ok('教师端菜单不再含「我的学员」', tNav.indexOf('我的学员') < 0, tNav);
    ok('教师端菜单不再含「词库申请」', tNav.indexOf('词库申请') < 0);
    ok('教师端仍保留工作台', tNav.indexOf('今日工作台') >= 0);
    await p.shot('r11-05-教师菜单收紧');

    await asAdmin(p);
    await p.goto(ROOT + 'admin/role-detail.html?id=' + teacherRole);
    await p.eval(`window.confirm=()=>true;return true;`);
    await click(p, '#btnReset');
    await sleep(1200);
    ok('恢复默认权限后菜单回补', await p.eval(`return Store.permissionMatrix('teacher').modules.some(m=>
      m.items.some(i=>i.code==='student.view'&&i.enabled));`));

    /* ================= 4. 数据字典 ================= */
    section('4. 新增字典项后业务下拉立即可选');
    await p.goto(ROOT + 'admin/dictionary-list.html');
    ok('字典页加载', await waitFor(async () => await p.eval(`return document.querySelectorAll('#typeList .type-item').length>=6;`)));
    await click(p, '#btnNew');
    await p.eval(`document.getElementById('fLabel').value='小红书';document.getElementById('fValue').value='小红书';
      document.getElementById('fSort').value='90';document.getElementById('fRemark').value='浏览器验收新增渠道';return true;`);
    await click(p, '#btnSave');
    await sleep(600);
    ok('字典项出现在列表', await p.eval(`return document.querySelector('#itemRows').textContent.indexOf('小红书')>=0;`));
    ok('业务下拉预览立即包含新项', await p.eval(`return document.getElementById('itemTitle').textContent.indexOf('小红书')>=0;`));
    await p.shot('r11-06-新增字典项');
    await p.goto(ROOT + 'admin/lead-list.html');
    ok('线索页渠道下拉读取字典', await waitFor(async () => await p.eval(`
      return [...document.querySelectorAll('#ch option')].some(o=>o.textContent.trim()==='小红书');`)));
    await p.shot('r11-07-业务下拉立即可选');

    /* ================= 5. 业务链路与审计日志 ================= */
    section('5. 报名→收款→课时入账→分配教师 日志可查');
    const chain = await p.eval(`
      var P=Store.products()[0];
      var l=Store.createLead({name:'UI 链路客户',phone:'13800138111',kidName:'UI 学员',
        grade:'三年级',channel:'小红书',level:'高',remark:'浏览器验收'});
      Store.addLeadFollowUp(l.id,{type:'电话',content:'电话沟通需求',status:'跟进中'});
      Store.markLeadIntent(l.id,{intent:'想报名',productId:P.id,level:'高'});
      var od=Store.submitEnrollmentOrder({leadId:l.id,productId:P.id,remark:'浏览器验收报名'});
      Store.reviewOrder(od.order.id,{pass:true,reason:'信息核对无误'});
      var reg=Store.registerPayment(od.order.id,{amount:od.order.amount,method:'微信',voucherNo:'WXUI001'});
      Store.confirmRegisteredPayment(reg.id,{reason:'到账核对完成'});
      var t=Store.db.teachers.filter(function(x){return x.cooperationStatus==='可授课';})[0];
      Store.assignStudent(t.id, od.student.id, {reason:'按年级匹配分配'});
      return {oid:od.order.id,sid:od.student.id,teacher:t.name};
    `);
    ok('链路执行完成', chain && chain.oid && chain.sid, JSON.stringify(chain));
    await p.goto(ROOT + 'admin/audit-log.html?resourceType=order&resourceId=' + chain.oid);
    ok('日志页按单据筛出记录', await waitFor(async () => await p.eval(`
      return document.querySelectorAll('#rows tr').length >= 3;`)));
    const logText = await p.eval(`return document.querySelector('#rows').textContent.replace(/\\s+/g,' ');`);
    ok('日志含报名/审核/登记/确认动作',
      logText.indexOf('提交报名订单') >= 0 && logText.indexOf('审核报名订单') >= 0 &&
      logText.indexOf('登记收款') >= 0 && logText.indexOf('确认收款并入账') >= 0, logText.slice(0, 160));
    ok('日志可打开详情抽屉', await p.eval(`var b=document.querySelector('button[data-audit]');
      if(!b)return false;b.click();return !document.getElementById('log-mask').hidden;`));
    await p.shot('r11-08-操作日志逐条可查');
    await p.eval(`Proto.closeDrawer('log');return true;`);

    /* ================= 6. 通知与已读 ================= */
    section('6. 业务事件通知与已读状态');
    await p.goto(ROOT + 'notifications.html');
    ok('消息中心加载', await waitFor(async () => await p.eval(`return !!document.querySelector('#list');`)));
    const unread = await p.eval(`return Store.unreadNotificationCount();`);
    const titles = await p.eval(`return [...document.querySelectorAll('.msg-title')].map(e=>e.textContent.trim());`);
    ok('业务事件生成通知可见', unread >= 2 && titles.length >= 2, '未读 ' + unread + ' / ' + titles.slice(0, 3).join(' , '));
    await p.shot('r11-09-消息中心');
    await click(p, '#btnReadAll');
    await sleep(400);
    ok('全部标为已读后未读归零', await p.eval(`return Store.unreadNotificationCount()===0;`));
    ok('消息项状态同步为已读', await p.eval(`return document.querySelectorAll('.msg-item.read').length === document.querySelectorAll('.msg-item').length;`));
    await p.shot('r11-10-通知全部已读');

    /* ================= 7. 机构设置与通知规则 ================= */
    section('7. 机构设置与通知规则');
    await p.goto(ROOT + 'admin/organization-settings.html');
    ok('机构设置加载', await waitFor(async () => await p.eval(`return !!document.querySelector('#fThreshold');`)));
    const orgBefore = await p.eval(`return Store.organizationSettings().lessonAlertThreshold;`);
    await p.eval(`document.getElementById('fThreshold').value='5';
      document.getElementById('fReason').value='浏览器验收调整阈值';return true;`);
    await click(p, '#btnSave');
    await sleep(900);
    ok('课时预警阈值已落库', (await p.eval(`return Store.organizationSettings().lessonAlertThreshold;`)) === 5);
    ok('机构设置留痕', await p.eval(`return Store.auditRows({resourceType:'organization'}).length>0;`));
    await p.shot('r11-11-机构设置');

    await p.goto(ROOT + 'admin/notification-settings.html');
    ok('通知规则页加载', await waitFor(async () => await p.eval(`return document.querySelectorAll('#ruleRows tr').length>0;`)));
    await p.eval(`var b=document.querySelector('#ruleRows input[data-toggle]');if(b)b.click();return !!b;`);
    await sleep(500);
    ok('规则开关变更落库', await p.eval(`return Store.notificationRules()[0].enabled===false;`));
    ok('发送记录接入真实通知',
      await p.eval(`return document.querySelector('#sendRows').textContent.indexOf('UI 链路客户')>=0 ||
        document.querySelector('#sendRows').textContent.indexOf('ORD')>=0;`));
    await p.shot('r11-12-通知规则与发送记录');

    section('8. 角色列表与账号详情');
    await p.goto(ROOT + 'admin/role-list.html');
    ok('角色列表加载', await waitFor(async () => await p.eval(`return document.querySelectorAll('#rows tr').length>=6;`)));
    ok('角色行含权限数与数据范围', await p.eval(`return /\\d+ \\/ \\d+/.test(document.querySelector('#rows').textContent);`));
    await p.shot('r11-13-角色列表');

    await p.goto(ROOT + 'admin/account-detail.html?id=' + (created ? created.id : ''));
    ok('账号详情加载', await waitFor(async () => await p.eval(`return !!document.querySelector('#desc');`)));
    const detailText = await p.eval(`return document.querySelector('#desc').textContent.replace(/\\s+/g,' ');`);
    ok('账号详情展示档案与角色', detailText.indexOf('刘洋') >= 0 && detailText.indexOf('教务负责人') >= 0,
      detailText.slice(0, 120));
    ok('账号详情展示操作轨迹', await p.eval(`return document.querySelector('#auditRows').textContent.indexOf('禁用账号')>=0;`));
    await p.shot('r11-14-账号详情与操作轨迹');

    section('9. 控制台异常');
    ok('全程无脚本异常', p.errors.length === 0, p.errors.slice(0, 3).join(' | '));

    console.log('\n========================================');
    console.log('第十一轮浏览器验收：' + pass + ' 通过 / ' + fail + ' 失败');
    console.log('========================================');
    if (fails.length) { console.log('失败项：'); fails.forEach(f => console.log(' - ' + f)); }
    process.exitCode = fail ? 1 : 0;
  } finally {
    p.close();
    proc.kill();
  }
})();
