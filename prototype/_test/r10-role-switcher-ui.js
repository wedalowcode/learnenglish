﻿/* 第十轮浏览器验收：统一角色切换组件（真实点击 + 截图留证）
   覆盖：面板展开/收起（Esc、外部点击、按钮激活态）、角色列表高亮、
        多账号二级人员、置灰原因、四条切换路径（管理端 → 教师 T004 → 代理 A001 → 家长 P004）、
        切换后顶栏身份/可见菜单/数据投影、窄屏不遮挡顶栏。
   运行：node prototype/_test/r10-role-switcher-ui.js
   截图输出：prototype/_test/shots/（已在 .gitignore） */
const { Page, launch, sleep, ROOT } = require('./cdp');

let pass = 0, fail = 0;
const fails = [];
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  ✓ ' + name + (detail ? '（' + detail + '）' : '')); }
  else { fail++; fails.push(name + (detail !== undefined ? ' → ' + detail : '')); console.log('  ✗ ' + name + ' → ' + detail); }
}
function section(t) { console.log('\n' + t); }

async function waitFor(fn, timeout) {
  const end = Date.now() + (timeout || 5000);
  while (Date.now() < end) {
    try { if (await fn()) return true; } catch (e) { /* 页面切换中上下文可能失效 */ }
    await sleep(120);
  }
  return false;
}
async function click(p, sel) {
  return p.eval(`var e=document.querySelector(${JSON.stringify(sel)});if(!e)return false;e.click();return true;`);
}
async function currentLabel(p) {
  return p.eval(`var e=document.querySelector('.role-switch-current');return e?e.textContent.replace(/\\s+/g,' ').trim():'';`);
}
async function navText(p) {
  return p.eval(`return [...document.querySelectorAll('.nav-item')].map(e=>e.textContent.trim()).join('|');`);
}
async function session(p) {
  return p.eval(`var s=Store.currentSession();return {role:s.role,teacherId:s.teacherId,agentId:s.agentId,parentId:s.parentId,operatorName:s.operatorName};`);
}
async function waitUrl(p, kw) {
  return waitFor(async () => (await p.eval('return location.href;')).indexOf(kw) >= 0);
}

(async () => {
  const proc = await launch();
  const p = await Page.open();
  try {
    /* ============ 1. 管理端：展开角色列表 ============ */
    section('1. 管理端：点击「切换角色」展开全部角色');
    await p.goto(ROOT + 'admin/dashboard.html');
    ok('管理端顶栏出现切换入口', await waitFor(async () => await p.eval(`return !!document.querySelector('.role-switch-btn');`)));
    ok('顶栏身份显示 老板/机构管理 · 张敏 / STF001', (await currentLabel(p)) === '老板/机构管理 · 张敏 / STF001', await currentLabel(p));
    ok('面板初始收起', await p.eval(`return document.querySelector('.role-switch-panel').hidden === true;`));

    await click(p, '.role-switch-btn');
    const opened = await p.eval(`var pan=document.querySelector('.role-switch-panel');var btn=document.querySelector('.role-switch-btn');
      return {hidden:pan.hidden, expanded:btn.getAttribute('aria-expanded'), on:btn.classList.contains('on'),
        items:document.querySelectorAll('.role-item').length,
        current:document.querySelector('.role-item.on .role-name').textContent.trim(),
        agent:document.querySelector('.role-item[data-role="agent"] .role-sub').textContent.trim(),
        overflow:getComputedStyle(document.querySelector('.role-switch-list')).overflowY,
        maxH:getComputedStyle(document.querySelector('.role-switch-panel')).maxHeight};`);
    ok('点击后按钮为激活态', opened.hidden === false && opened.expanded === 'true' && opened.on === true, JSON.stringify({ hidden: opened.hidden, expanded: opened.expanded, on: opened.on }));
    ok('角色列表包含全部 6 个角色', opened.items === 6, 'items=' + opened.items);
    ok('当前角色高亮为老板/机构管理', /老板\/机构管理/.test(opened.current), opened.current);
    ok('多账号角色显示可选人数', /个可用账号/.test(opened.agent), opened.agent);
    ok('长列表可滚动', (opened.overflow === 'auto' || opened.overflow === 'scroll') && opened.maxH !== 'none', opened.overflow + '/' + opened.maxH);
    await p.shot('r10-01-角色列表-管理端');

    /* ============ 2. 收起交互：Esc / 外部点击 ============ */
    section('2. Esc 与外部点击收起面板');
    await p.eval(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));return true;`);
    ok('Esc 收起面板', await p.eval(`var pan=document.querySelector('.role-switch-panel');var btn=document.querySelector('.role-switch-btn');
      return pan.hidden===true && btn.classList.contains('on')===false && btn.getAttribute('aria-expanded')==='false';`));

    await click(p, '.role-switch-btn');
    await p.eval(`document.body.click();return true;`);
    ok('点击外部区域收起面板', await p.eval(`return document.querySelector('.role-switch-panel').hidden === true;`));

    /* ============ 3. 多账号角色：二级人员列表 ============ */
    section('3. 教师角色展开二级人员（T004 可选 / T006 置灰）');
    await click(p, '.role-switch-btn');
    await click(p, '.role-item-main[data-role="teacher"]');
    const tPanel = await p.eval(`
      var box=document.querySelector('.role-item[data-role="teacher"]');
      var t4=box.querySelector('.role-account[data-account="T004"]');
      var t6=box.querySelector('.role-account[data-account="T006"]');
      return {open:document.querySelector('.role-switch-panel').hidden===false,
        chips:box.querySelectorAll('.role-account').length,
        t4:!!t4 && !t4.disabled, t6:!!t6 && t6.disabled,
        why:t6?t6.textContent.replace(/\\s+/g,' ').trim():'',
        name:t4?t4.textContent.replace(/\\s+/g,' ').trim():''};`);
    ok('展开人员时面板保持打开', tPanel.open === true);
    ok('教师项下列出多个人员', tPanel.chips >= 4, 'chips=' + tPanel.chips);
    ok('T004 可点击切换', tPanel.t4 === true);
    ok('T006 置灰并说明原因', tPanel.t6 === true && /合作状态|账号/.test(tPanel.why), tPanel.why);
    ok('人员项显示姓名 + 编码', /沈心怡/.test(tPanel.name) && /T004/.test(tPanel.name), tPanel.name);
    await p.shot('r10-02-教师账号列表');

    /* ============ 4. 路径一：管理端 → 教师 T004 ============ */
    section('4. 切换路径：管理端 → 教师 T004');
    await click(p, '.role-account[data-account="T004"]');
    ok('跳转到教师工作台', await waitUrl(p, 'teacher/workbench.html'), await p.eval('return location.href;'));
    await waitFor(async () => await p.eval(`return !!document.querySelector('.role-switch-btn');`));
    const s4 = await session(p);
    ok('会话身份写入教师 T004', s4.role === 'teacher' && s4.teacherId === 'T004' && s4.operatorName === '沈心怡', JSON.stringify(s4));
    ok('顶栏身份同步为 教师 · 沈心怡 / T004', (await currentLabel(p)) === '教师 · 沈心怡 / T004', await currentLabel(p));
    const nav4 = await navText(p);
    ok('教师菜单含「我的学员」', /我的学员/.test(nav4));
    ok('教师菜单不含管理端「客户线索」', /客户线索/.test(nav4) === false, nav4);
    const t4Projection = await p.eval(`
      var mine=Store.currentStudentsOf('T004').map(x=>x.student.id);
      var t3=Store.db.teacherStudents.filter(r=>r.teacherId==='T003'&&!r.endAt).map(r=>r.studentId);
      return {mine:mine, leak:t3.filter(id=>mine.indexOf(id)>=0)};`);
    ok('教师只看到自己的学员', t4Projection.mine.length > 0, 'mine=' + t4Projection.mine.join(','));
    ok('看不到 T003 的学员', t4Projection.leak.length === 0, 'leak=' + t4Projection.leak.join(','));
    await p.shot('r10-03-教师端-T004');

    /* ============ 5. 路径二：教师 T004 → 代理 A001 ============ */
    section('5. 切换路径：教师 T004 → 代理 A001');
    await click(p, '.role-switch-btn');
    await click(p, '.role-item-main[data-role="agent"]');
    const aPanel = await p.eval(`
      var box=document.querySelector('.role-item[data-role="agent"]');
      var a1=box.querySelector('.role-account[data-account="A001"]');
      var a4=box.querySelector('.role-account[data-account="A004"]');
      return {a1:!!a1&&!a1.disabled,a4:!!a4&&a4.disabled,why:a4?a4.textContent.replace(/\\s+/g,' ').trim():''};`);
    ok('代理项列出 A001（可用）', aPanel.a1 === true);
    ok('停用代理 A004 置灰', aPanel.a4 === true && /停用/.test(aPanel.why), aPanel.why);
    await click(p, '.role-account[data-account="A001"]');
    ok('跳转到代理工作台', await waitUrl(p, 'agent/workbench.html'), await p.eval('return location.href;'));
    await waitFor(async () => await p.eval(`return !!document.querySelector('.role-switch-btn');`));
    const s5 = await session(p);
    ok('会话身份写入代理 A001', s5.role === 'agent' && s5.agentId === 'A001' && s5.teacherId === '', JSON.stringify(s5));
    ok('顶栏身份同步为 代理 · 王磊 / A001', (await currentLabel(p)) === '代理 · 王磊 / A001', await currentLabel(p));
    const nav5 = await navText(p);
    ok('代理菜单含「我的客户」', /我的客户/.test(nav5), nav5);
    ok('代理菜单不含管理端「经营概览」', /经营概览/.test(nav5) === false, nav5);
    const aProjection = await p.eval(`
      var rows=Store.agentCustomers();
      var others=Store.db.leads.filter(l=>l.currentAgentId&&l.currentAgentId!=='A001').map(l=>l.id);
      var own=Store.db.orders.filter(o=>o.agentId==='A001').map(o=>o.studentId);
      return {count:rows.length, leak:rows.filter(r=>others.indexOf(r.leadId)>=0).map(r=>r.leadId),
        foreignStudent:rows.filter(r=>r.studentId&&own.indexOf(r.studentId)<0).map(r=>r.studentId)};`);
    ok('代理客户列表非空', aProjection.count > 0, 'count=' + aProjection.count);
    ok('代理只看到自己的客户', aProjection.leak.length === 0, 'leak=' + aProjection.leak.join(','));
    ok('代理客户不含他人成交学员', aProjection.foreignStudent.length === 0, 'foreign=' + aProjection.foreignStudent.join(','));
    await p.shot('r10-04-代理端-A001');

    /* ============ 6. 路径三：代理 A001 → 家长 P004 ============ */
    section('6. 切换路径：代理 A001 → 家长 P004');
    await click(p, '.role-switch-btn');
    await click(p, '.role-item-main[data-role="parent"]');
    await click(p, '.role-account[data-account="P004"]');
    ok('跳转到家长首页', await waitUrl(p, 'parent/home.html'), await p.eval('return location.href;'));
    await waitFor(async () => await p.eval(`return !!document.querySelector('.role-switch-btn');`));
    const s6 = await session(p);
    ok('会话身份写入家长 P004', s6.role === 'parent' && s6.parentId === 'P004' && s6.agentId === '', JSON.stringify(s6));
    ok('顶栏身份同步为 家长 · 孙巧云 / P004', (await currentLabel(p)) === '家长 · 孙巧云 / P004', await currentLabel(p));
    const pProjection = await p.eval(`
      var kids=Store.parentChildren('P004').map(k=>k.id);
      var expect=Store.db.students.filter(s=>s.parent==='P004').map(s=>s.id);
      var text=document.body.textContent;
      return {kids:kids, expect:expect, hasHours:/课时/.test(text), hasLead:/客户线索|代理管理/.test(text)};`);
    ok('家长只看到自己的孩子', pProjection.kids.length === pProjection.expect.length &&
      pProjection.kids.every(id => pProjection.expect.indexOf(id) >= 0), pProjection.kids.join(','));
    ok('家长首页有课时入口且无管理端菜单', pProjection.hasHours === true && pProjection.hasLead === false,
      'hours=' + pProjection.hasHours + '/lead=' + pProjection.hasLead);
    await p.shot('r10-05-家长端-P004');

    /* ============ 7. 窄屏：面板不遮挡顶栏 ============ */
    section('7. 窄屏（390x844）：切换器在移动顶栏内且面板不溢出');
    await p.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await sleep(300);
    const narrow = await p.eval(`
      var host=document.querySelector('[data-role-switcher]');
      var h=host.getBoundingClientRect();
      return {inHead:!!host.closest('.m-head'), top:h.top, right:h.right, w:innerWidth,
        btnVisible:!!document.querySelector('.role-switch-btn').offsetParent};`);
    ok('窄屏下切换器挂在移动顶栏', narrow.inHead === true);
    ok('窄屏下切换器不超出视口', narrow.right <= narrow.w + 1 && narrow.top >= 0, JSON.stringify(narrow));
    await click(p, '.role-switch-btn');
    const narrowPanel = await p.eval(`
      var r=document.querySelector('.role-switch-panel').getBoundingClientRect();
      var h=document.querySelector('.m-head').getBoundingClientRect();
      return {top:r.top, left:r.left, right:r.right, w:innerWidth, headBottom:h.bottom};`);
    ok('窄屏面板不遮挡移动顶栏', narrowPanel.top >= narrowPanel.headBottom - 1, JSON.stringify(narrowPanel));
    ok('窄屏面板不横向溢出', narrowPanel.left >= -1 && narrowPanel.right <= narrowPanel.w + 1, JSON.stringify(narrowPanel));
    await p.shot('r10-06-家长端-窄屏');
    await p.send('Emulation.clearDeviceMetricsOverride', {});

    /* ============ 8. 控制台异常 ============ */
    section('8. 控制台异常');
    const errs = p.errors.concat(p.logs).filter(Boolean);
    ok('页面无脚本异常', errs.length === 0, errs.join(' | '));
  } catch (e) {
    fail++;
    fails.push('脚本异常：' + e.message);
    console.error(e);
  } finally {
    p.close();
    try { proc.kill(); } catch (e) { /* ignore */ }
  }

  console.log('\n============================================================');
  console.log('第十轮角色切换浏览器验收：' + pass + ' 通过 / ' + fail + ' 失败');
  if (fails.length) { console.log('失败项：\n - ' + fails.join('\n - ')); process.exitCode = 1; }
  else console.log('全部通过（截图见 prototype/_test/shots/r10-*.png）');
})();
