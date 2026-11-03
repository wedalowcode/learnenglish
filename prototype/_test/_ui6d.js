/* 第四阶段：管理员正式分配 · 真实点击验证（临时脚本） */
const { Page, launch, sleep, ROOT } = require('./cdp');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? ' → ' + JSON.stringify(extra) : '')); }
}

(async () => {
  const proc = await launch();
  const p = await Page.open();
  const base = ROOT + 'admin/assign-task.html';
  try {
    /* ---- 1. 待分配列表七列 ---- */
    await p.goto(base + '?tab=task&as=ops');
    let r = await p.eval(`
      var tr = document.querySelector('#taskRows tr');
      return { cols: document.querySelectorAll('#taskRows tr:first-child td').length,
               heads: [...document.querySelectorAll('#pTask thead th')].map(t=>t.innerText.trim()),
               txt: tr ? tr.innerText.replace(/\\s+/g,' ') : '',
               stats: [...document.querySelectorAll('#stats .stat-label')].map(e=>e.textContent.trim()),
               sub: document.getElementById('pageSub').textContent };`);
    ok('表头 7 列', r.cols === 7 && r.heads.length === 7, { cols: r.cols, heads: r.heads });
    ok('列表含陈可欣需求 D20261026005', /D20261026005/.test(r.txt) && /陈可欣/.test(r.txt), r.txt.slice(0, 160));
    ok('统计卡 5 个', r.stats.length === 5, r.stats);
    ok('页脚/副标题说明正式分配唯一性', /正式分配/.test(r.sub), r.sub);
    await p.shot('p6-9-待分配列表');

    /* ---- 2. 打开分配弹窗：六项检查 ---- */
    await p.eval(`openAssign('D20261026005');`);
    await sleep(200);
    r = await p.eval(`
      var chks = [...document.querySelectorAll('#asChecks .chk')].map(c => ({
        ok: !!c.querySelector('.chk-ico.ok'),
        block: c.classList.contains('block'),
        label: c.querySelector('.chk-label').textContent,
        value: c.querySelector('.chk-value').textContent }));
      return { chks: chks, tip: document.getElementById('asTip').innerText.replace(/\\s+/g,' '),
               sum: document.getElementById('asSum').innerText.replace(/\\s+/g,' '),
               btn: document.getElementById('asOk').textContent, disabled: document.getElementById('asOk').disabled };`);
    ok('六项检查全部渲染', r.chks.length === 6, r.chks.length);
    ok('检查项全部通过（无 block）', r.chks.every(c => c.ok || !c.block), r.chks);
    ok('提示本次为更换教师', /更换教师/.test(r.tip), r.tip.slice(0, 160));
    ok('提示已完成课程仍归原教师', /已完成的课程仍归属原教师/.test(r.tip), r.tip.slice(0, 200));
    ok('弹窗摘要含教务确认信息', /教务/.test(r.sum) && /确认/.test(r.sum), r.sum.slice(0, 200));
    ok('按钮可点（管理员有权限）', r.btn === '确认正式分配' && !r.disabled, r);
    await p.shot('p6-10-分配检查弹窗');

    /* ---- 3. 分配前快照：原教师与已完成课程 ---- */
    r = await p.eval(`
      var d = Store.demandOf('D20261026005');
      var rels = Store.relationsOfStudent(d.studentId);
      var cur = rels.filter(x=>x.status === Store.REL.ACTIVE)[0];
      var s = Store.student(d.studentId);
      var done = Store.courses().filter(c => c.studentId === d.studentId && c.status === Store.COURSE_STATUS.DONE);
      var relBefore = Store.db.teacherStudents.length;
      return { curTeacher: cur ? Store.teacher(cur.teacherId).name : null, relId: cur ? cur.id : null,
               doneTeachers: done.map(c => Store.teacher(c.teacherId).name),
               relBefore: relBefore, studentTeacher: s.teacherName };`);
    ok('分配前当前教师为李婉', r.curTeacher === '李婉', r);
    ok('已完成课程归属原教师 ' + JSON.stringify(r.doneTeachers), r.doneTeachers.length > 0 && r.doneTeachers.every(x => x === '李婉'), r.doneTeachers);
    const relBefore = r.relBefore;

    /* ---- 4. 执行正式分配 ---- */
    await p.eval(`document.getElementById('asReason').value='家长申请更换教师，确认由沈心怡接手';
                  doAssign();`);
    await sleep(300);
    r = await p.eval(`
      var d = Store.demandOf('D20261026005');
      var rels = Store.relationsOfStudent(d.studentId);
      var act = rels.filter(x=>x.status === Store.REL.ACTIVE)[0];
      var end = rels.filter(x=>x.status === Store.REL.ENDED);
      var s = Store.student(d.studentId);
      var done = Store.courses().filter(c => c.studentId === d.studentId && c.status === Store.COURSE_STATUS.DONE);
      var log = Store.demandLogsOf('D20261026005').slice(-1)[0];
      var newRel = rels.filter(x=>x.demandId === 'D20261026005');
      return { status: d.status, assignedBy: d.assignedBy, assignedAt: !!d.assignedAt,
               relAfter: Store.db.teacherStudents.length,
               curTeacher: act ? Store.teacher(act.teacherId).name : null,
               relDemandId: act ? act.demandId : '', relReason: act ? act.assignReason : '',
               endedTeachers: end.map(x=>Store.teacher(x.teacherId).name),
               studentTeacher: s.teacherName,
               doneTeachers: done.map(c=>Store.teacher(c.teacherId).name),
               logAction: log && log.action, logText: log && log.detail };`);
    ok('需求推进到「已完成分配」', r.status === '已完成分配', r.status);
    ok('记录分配人 ' + r.assignedBy, r.assignedBy === '王敏', r.assignedBy);
    ok('记录分配时间', r.assignedAt === true, r.assignedAt);
    ok('关系数 +1（换教师：新建一条）', r.relAfter === relBefore + 1, { before: relBefore, after: r.relAfter });
    ok('学员当前教师变为沈心怡', r.curTeacher === '沈心怡' && r.studentTeacher === '沈心怡', r);
    ok('新关系写入需求编号', r.relDemandId === 'D20261026005', r.relDemandId);
    ok('新关系写入分配原因', /家长申请更换教师/.test(r.relReason || ''), r.relReason);
    ok('原教师李婉的关系已结束', r.endedTeachers.indexOf('李婉') >= 0, r.endedTeachers);
    ok('已完成课程归属不变（仍为李婉）', r.doneTeachers.length > 0 && r.doneTeachers.every(x => x === '李婉'), r.doneTeachers);
    ok('流水记录 ASSIGNED', r.logAction === 'ASSIGNED', r.logAction);
    ok('流水含新旧教师说明', /沈心怡/.test(r.logText) && /李婉/.test(r.logText), r.logText);

    /* ---- 5. 刷新后仍在 ---- */
    await p.goto(base + '?tab=task&as=ops');
    r = await p.eval(`return { rows: document.querySelectorAll('#taskRows tr').length,
      empty: /还没有|暂无|没有待分配/.test(document.getElementById('taskRows').innerText),
      txt: document.getElementById('taskRows').innerText.replace(/\\s+/g,' ').slice(0,80) };`);
    ok('刷新后待分配列表已清空', r.empty === true, r);

    /* ---- 6. 分配记录 Tab ---- */
    await p.goto(base + '?tab=log&as=ops');
    r = await p.eval(`
      var tr = document.querySelector('#logRows tr');
      return { txt: tr ? tr.innerText.replace(/\\s+/g,' ') : '', rows: document.querySelectorAll('#logRows tr').length };`);
    ok('分配记录出现该条', /D20261026005/.test(r.txt) && /陈可欣/.test(r.txt), r.txt.slice(0, 200));
    ok('标记为更换教师', /更换教师/.test(r.txt), r.txt.slice(0, 200));
    ok('记录原负责教师李婉', /李婉/.test(r.txt), r.txt.slice(0, 200));
    ok('记录分配人王敏', /王敏/.test(r.txt), r.txt.slice(0, 200));
    await p.shot('p6-11-分配记录');

    /* ---- 7. 重复分配被拒（原子性） ---- */
    r = await p.eval(`
      var before = Store.db.teacherStudents.length;
      var out = { err: '' };
      try { Store.assignDemand('D20261026005'); } catch (e) { out.err = e.message; }
      return { err: out.err, before: before, after: Store.db.teacherStudents.length };`);
    ok('重复分配被拒 ' + r.err.slice(0, 30), /已完成分配/.test(r.err), r.err);
    ok('被拒后关系数未变（原子性）', r.before === r.after, r);

    /* ---- 8. 教务角色不能正式分配（越权） ---- */
    await p.goto(base + '?tab=task&as=staff');
    r = await p.eval(`
      var rows = document.querySelectorAll('#taskRows tr').length;
      var out = { err: '' };
      try { Store.assignDemand('D20261026005'); } catch (e) { out.err = e.message; }
      return { err: out.err, rows: rows, can: Store.can('student.assignFinal') };`);
    ok('教务无分配权限', r.can === false, r.can);
    ok('教务调用分配被拒 FORBIDDEN', /无权|权限/.test(r.err), r.err);

    /* 让一条需求回到待分配，验证教务点按钮时的页面拦截 */
    r = await p.eval(`
      Store.setSession({role:'staff', operatorName:'陈静'});
      var v = null;
      try { v = Store.demands({}).filter(x=>x.demand.status === Store.DEMAND.ASSIGN)[0]; } catch(e){}
      return { has: !!v };`);
    await p.eval(`
      Store.setSession({role:'admin', operatorName:'张敏'});
      var s = Store.student('S2026009');
      var d = Store.createDemand({ studentId:'S2026009', grade:'七年级', textbook:'人教版',
        learningNeeds:['词汇'], expectedSchedule:{weekday:['周六'],periods:['上午'],weeklyLessons:1},
        currentLevel:'基础一般', specialRequirements:'', expectedStartAt:'', remark:'' });
      d = Store.publishDemand(d.id);
      Store.setSession({role:'teacher', operatorName:'李婉', teacherId:'T001'});
      Store.respondDemand(d.id, { remark:'可以带' });
      Store.setSession({role:'staff', operatorName:'陈静'});
      Store.startConfirm(d.id);
      Store.confirmDemand(d.id, 'T001', { reason:'年级教材匹配，时间合适' });
      Store.setSession({role:'staff', operatorName:'陈静'});
      localStorage.setItem('__tmp_demand', d.id);`);
    await p.goto(base + '?tab=task&as=staff');
    r = await p.eval(`
      var id = localStorage.getItem('__tmp_demand');
      openAssign(id);
      return { tip: document.getElementById('asTip').innerText.replace(/\\s+/g,' '),
               btn: document.getElementById('asOk').textContent,
               disabled: document.getElementById('asOk').disabled };`);
    ok('教务打开分配弹窗提示无权限', /没有正式分配权限/.test(r.tip), r.tip.slice(0, 120));
    ok('教务的分配按钮被禁用', r.disabled === true && /无分配权限/.test(r.btn), r);
    await p.shot('p6-12-教务无权限');

    console.log('\n  控制台异常:', p.errors.length ? p.errors : '无');
    console.log(`\n  结果: ${pass} 通过 / ${fail} 失败`);
  } catch (e) {
    console.error('运行失败:', e.message);
    fail++;
  } finally { p.close(); proc.kill(); }
  process.exit(fail ? 1 : 0);
})();
