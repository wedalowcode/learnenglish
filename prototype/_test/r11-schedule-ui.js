/** 第十轮 UI 验收：教务排课真实保存与会议链接（真实浏览器）
 *  运行：node _test/r11-schedule-ui.js
 */
const { Page, launch, sleep, ROOT } = require('./cdp');
const ok = [], bad = [];
function assert(name, cond, extra) {
  if (cond) ok.push(name); else bad.push(name + (extra !== undefined ? ' → ' + JSON.stringify(extra) : ''));
}
(async () => {
  const proc = await launch();
  const page = await Page.open();
  const gotoAdmin = async url => {
    await page.goto(ROOT + url);
    await page.eval(`
      var u = Store.db.users.filter(function(x){return x.roleCode==='admin';})[0];
      Store.setSession({role:'admin', accountId:u.id, operatorId:u.id, operatorName:'管理员'});
    `);
    await page.goto(ROOT + url);
    await sleep(200);
  };
  try {
    await gotoAdmin('admin/schedule-calendar.html');

    const ui = await page.eval(`return {
      teacherOpts: Array.from(document.querySelectorAll('#f_teacher option')).map(o => o.value),
      studentOpts: Array.from(document.querySelectorAll('#n_student option')).map(o => o.value),
      meetingInput: !!document.getElementById('n_meeting'),
      meetingFilter: !!document.getElementById('f_meeting'),
      autoText: /自动生成/.test(document.body.innerText)
    };`);
    assert('教师筛选使用真实教师 ID', ui.teacherOpts.indexOf('T001') >= 0, ui.teacherOpts.slice(0, 4));
    assert('学员选择使用真实学员 ID', ui.studentOpts.indexOf('S2026001') >= 0, ui.studentOpts.slice(0, 4));
    assert('排课表单有腾讯会议链接输入', ui.meetingInput);
    assert('不再承诺自动生成会议链接', !ui.autoText);

    /* 冲突：直接调用演示冲突，Store 必须拦截且不写入 */
    const before = await page.eval(`return Store.db.courses.length;`);
    await page.eval(`demoConflict();`);
    await sleep(500);
    const conflict = await page.eval(`return {
      text: document.getElementById('conflictBox').textContent.replace(/\\s+/g,' ').trim(),
      count: Store.db.courses.length
    };`);
    assert('冲突排课被 Store 拦截并显示原因', /冲突|未保存/.test(conflict.text) && conflict.count === before, conflict);

    /* 正常排课：真实写入 */
    const created = await page.eval(`return (function(){
      Proto.openModal('createModal');
      document.getElementById('conflictBox').innerHTML='';
      document.getElementById('n_student').value='S2026001';
      document.getElementById('n_teacher').value='T001';
      document.getElementById('n_date').value='2026-11-06';
      document.getElementById('n_start').value='14:00';
      document.getElementById('n_end').value='15:00';
      document.getElementById('n_meeting').value='https://meeting.tencent.com/dm/UI-R11';
      document.getElementById('n_note').value='UI 验收排课';
      submitCourse();
      var c = Store.db.courses.filter(function(x){return x.date==='2026-11-06' && x.start==='14:00';})[0];
      return c ? {id:c.id, url:c.meetingUrl, studentId:c.studentId, teacherId:c.teacherId, createdBy:c.createdBy} : null;
    })();`);
    await sleep(500);
    assert('排课真实写入课程集合', !!created, created);
    assert('写入真实学员/教师/链接/创建人',
      created && created.studentId === 'S2026001' && created.teacherId === 'T001'
      && created.url === 'https://meeting.tencent.com/dm/UI-R11' && !!created.createdBy, created);

    /* 课程详情：显示链接 + 教务维护 */
    await page.eval(`openEv(Store.course('${created.id}'));`);
    await sleep(200);
    const detail = await page.eval(`return {
      body: document.getElementById('evBody').textContent.replace(/\\s+/g,' ').trim(),
      hasLink: !!document.querySelector('#evBody a[href*="meeting.tencent.com"]'),
      hasEdit: !!document.getElementById('e_meeting')
    };`);
    assert('课程详情展示真实会议链接', detail.hasLink && /UI-R11/.test(detail.body), detail.body.slice(0, 80));
    assert('课程详情提供教务维护字段', detail.hasEdit);
    await page.eval(`
      document.getElementById('e_meeting').value='https://meeting.tencent.com/dm/UI-R11-updated';
      saveEvEdit();
    `);
    await sleep(400);
    const after = await page.eval(`return Store.course('${created.id}').meetingUrl;`);
    assert('教务修改会议链接被保存', after === 'https://meeting.tencent.com/dm/UI-R11-updated', after);

    assert('页面无 JS 异常', page.errors.length === 0, page.errors);
  } catch (e) {
    bad.push('执行异常：' + e.message);
  }
  console.log('\n通过 ' + ok.length + ' 项');
  if (bad.length) { console.log('失败 ' + bad.length + ' 项：'); bad.forEach(b => console.log('  ✗ ' + b)); }
  else console.log('第十轮教务排课 UI 全部通过');
  page.close(); proc.kill();
  process.exit(bad.length ? 1 : 0);
})();
