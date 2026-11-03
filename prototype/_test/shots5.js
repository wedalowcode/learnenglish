/* 第五轮视觉走查：教师资源池 / 教师详情 8 Tab / 生命周期动作的真实状态截图 */
const { Page, launch, sleep, ROOT } = require('./cdp');

/* 页内有 position:sticky 操作条时，先把视口拉到整页高度再截图，
   否则 sticky 元素会停在默认视口底部、盖住中间内容 */
async function tallShot(page, name, h) {
  await page.send('Emulation.setDeviceMetricsOverride', {
    width: 1360, height: h || 1500, deviceScaleFactor: 1, mobile: false
  });
  await sleep(280);
  const f = await page.shot(name);
  await page.send('Emulation.clearDeviceMetricsOverride');
  await sleep(120);
  return f;
}

(async () => {
  const proc = await launch();
  const page = await Page.open();
  await page.send('DOM.enable');

  await page.goto(ROOT + 'index.html');
  await page.eval('Store.reset(); return 1;');

  const out = [];

  /* 1. 教师资源池默认视图 */
  await page.goto(ROOT + 'admin/teacher-list.html');
  await sleep(600);
  out.push(await page.shot('30-教师资源池-默认'));

  /* 2. 快捷筛选：已退出 */
  await page.eval(`setQuick('已退出'); return 1;`);
  await sleep(350);
  out.push(await page.shot('31-教师资源池-已退出筛选'));

  /* 3. 快捷筛选：暂停 */
  await page.eval(`setQuick('暂停合作'); return 1;`);
  await sleep(350);
  out.push(await page.shot('32-教师资源池-暂停筛选'));

  /* 4. 新增教师弹窗 */
  await page.eval(`setQuick(''); openCreate(); return 1;`);
  await sleep(400);
  out.push(await page.shot('33-新增教师-快速录入'));

  /* 5. 手机号撞已退出档案 */
  await page.eval(`
    document.getElementById('c_name').value = '郑好';
    document.getElementById('c_phone').value = '13806234567';
    submitCreate();
    return 1;`);
  await sleep(450);
  out.push(await page.shot('34-新增教师-手机号撞历史档案'));
  await page.eval(`Proto.closeModal('dupModal'); Proto.closeModal('createModal'); return 1;`);

  /* 6. 教师详情：基础资料 */
  await page.goto(ROOT + 'admin/teacher-detail.html?id=T001');
  await sleep(700);
  out.push(await page.shot('35-教师详情-基础资料'));

  /* 7. 教学能力（可授课时间网格） */
  await page.eval(`document.querySelectorAll('#ttabs .tab')[1].click(); return 1;`);
  await sleep(300);
  out.push(await page.shot('36-教师详情-教学能力'));

  /* 8. 当前学员 */
  await page.eval(`document.querySelectorAll('#ttabs .tab')[2].click(); return 1;`);
  await sleep(300);
  out.push(await page.shot('37-教师详情-当前学员'));

  /* 9. 课程安排 */
  await page.eval(`document.querySelectorAll('#ttabs .tab')[4].click(); return 1;`);
  await sleep(300);
  out.push(await page.shot('38-教师详情-课程安排'));

  /* 10. 合作记录 */
  await page.eval(`document.querySelectorAll('#ttabs .tab')[6].click(); return 1;`);
  await sleep(300);
  out.push(await page.shot('39-教师详情-合作记录'));

  /* 11. 教学统计 */
  await page.eval(`document.querySelectorAll('#ttabs .tab')[7].click(); return 1;`);
  await sleep(300);
  out.push(await page.shot('40-教师详情-教学统计'));

  /* 12. 暂停合作弹窗（逐节处理未来课程） */
  await page.eval(`document.querySelectorAll('#ttabs .tab')[0].click(); openPause(); return 1;`);
  await sleep(450);
  out.push(await page.shot('41-暂停合作-课程处理'));
  await page.eval(`Proto.closeModal('pauseModal'); return 1;`);

  /* 13. 待启用教师详情（缺少启用条件） */
  await page.goto(ROOT + 'admin/teacher-detail.html?id=T007');
  await sleep(600);
  out.push(await page.shot('42-待启用教师-启用条件未满足'));

  /* 14. 已退出教师详情（历史保留） */
  await page.goto(ROOT + 'admin/teacher-detail.html?id=T006');
  await sleep(600);
  out.push(await page.shot('43-已退出教师-档案历史保留'));

  /* 15. 退出向导：阻塞项 */
  await page.goto(ROOT + 'admin/teacher-exit.html?id=T001');
  await sleep(600);
  out.push(await tallShot(page, '44-退出向导-存在阻塞项', 1500));

  /* 16. 退出向导：全部处理完 */
  await page.eval(`
    setStu('S2026001', 'action', 'reassign');
    setStu('S2026001', 'toTeacherId', 'T003');
    setStu('S2026001', 'reason', '转交何俊带中考方向');
    return 1;`);
  await page.eval(`
    setStu('S2026008', 'action', 'reassign');
    setStu('S2026008', 'toTeacherId', 'T002');
    setStu('S2026008', 'reason', '转交周雅，家长认可');
    return 1;`);
  await page.eval(`
    var ids = Store.exitCheck('T001').futureCourses.map(function(c){return c.id;});
    setCt(ids[0], 'action', 'reassign'); setCt(ids[0], 'toTeacherId', 'T003');
    setCt(ids[1], 'action', 'reassign'); setCt(ids[1], 'toTeacherId', 'T002');
    setCt(ids[2], 'action', 'cancel');
    plan.reason = '教师毕业离校，正式结束合作';
    render();
    return 1;`);
  await sleep(450);
  out.push(await tallShot(page, '45-退出向导-可确认退出', 1600));

  /* 17. 学员列表的分配抽屉（已有教师，提示结束原关系） */
  await page.goto(ROOT + 'admin/teacher-detail.html?id=T002');
  await sleep(600);
  await page.eval(`openAssign(); return 1;`);
  await sleep(450);
  out.push(await page.shot('46-教师详情-分配学员抽屉'));

  /* 18. 排课日历的改派弹窗 */
  await page.goto(ROOT + 'admin/schedule-calendar.html');
  await sleep(700);
  const cid = await page.eval(`
    var c = Store.courses().filter(function(x){return x.status === '待上课';})[0];
    return c ? c.id : '';`);
  if (cid) {
    await page.eval(`openReassign('${cid}'); return 1;`);
    await sleep(400);
    out.push(await page.shot('47-排课-课程改派'));
    await page.eval(`Proto.closeModal('reassignModal'); return 1;`);
  }

  /* 19. 学员列表（当前教师来自真实关系） */
  await page.goto(ROOT + 'admin/student-list.html');
  await sleep(600);
  out.push(await page.shot('48-学员列表-当前教师'));

  /* 20. 首页第五轮卡片 */
  await page.goto(ROOT + 'index.html');
  await sleep(600);
  out.push(await page.shot('49-首页-第五轮迭代卡片'));

  console.log(out.join('\n'));
  console.log('errors', page.errors);
  page.close();
  proc.kill();
})();
