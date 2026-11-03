/* 第三阶段：教师接单中心 · 真实点击交互验证（临时脚本） */
const { Page, launch, sleep, ROOT } = require('./cdp');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? ' → ' + JSON.stringify(extra) : '')); }
}

(async () => {
  const proc = await launch();
  const p = await Page.open();
  const errs = [];
  try {
    const base = ROOT + 'teacher/demand-center.html';

    /* ---- 1. 打开待响应 Tab ---- */
    await p.goto(base + '?tab=open&t=T001');
    let r = await p.eval(`
      return { cards: document.querySelectorAll('.demand-card').length,
               stats: [...document.querySelectorAll('#stats .stat-value')].map(e=>e.textContent.trim()),
               page: document.getElementById('pageTitle').textContent,
               active: (document.querySelector('#ttabs .tab.active')||{}).innerText,
               actions: document.getElementById('tabActions').innerText.trim(),
               hasParentPhone: /1[3-9]\\d{9}/.test(document.body.innerText) };`);
    ok('待响应卡片 = 2', r.cards === 2, r);
    ok('统计卡 4 个数值 [' + r.stats.join(',') + ']', r.stats.length === 4 && r.stats[0] === '2', r.stats);
    ok('Tab 高亮 = 待响应需求', r.active === '待响应需求', r.active);
    ok('不暴露家长手机号', r.hasParentPhone === false, r.hasParentPhone);
    await p.shot('p6-5a-接单待响应');

    /* ---- 2. 点「我可以带」→ 提交 ---- */
    await p.eval(`document.querySelector('[onclick*="openRespond(' + "'D20261030002'" + ')"]').click();`);
    await sleep(200);
    r = await p.eval(`return { open: document.getElementById('respondModal').classList.contains('show'),
                                title: document.getElementById('rsTitle').textContent,
                                info: document.getElementById('rsInfo').innerText.replace(/\\n/g,' | ') };`);
    ok('响应弹窗打开并带匹配度', r.open && /我的匹配度/.test(r.info), r);
    await p.eval(`document.getElementById('rsRemark').value = '可以带，周六上午有空';doRespond();`);
    await sleep(200);
    r = await p.eval(`
      var d = Store.demandOf('D20261030002');
      var rp = Store.responseOf('D20261030002','T001');
      return { status: rp && rp.status, remark: rp && rp.remark, demand: d.status,
               closed: !document.getElementById('respondModal').classList.contains('show'),
               cardBtn: [...document.querySelectorAll('.demand-card')].map(c=>c.innerText.replace(/\\s+/g,' ').slice(0,40)) };`);
    ok('响应落库为「已响应」', r.status === '已响应', r.status);
    ok('教师说明已保存', r.remark === '可以带，周六上午有空', r.remark);
    ok('响应后需求变「接单中」', r.demand === '接单中', r.demand);
    ok('弹窗已关闭', r.closed === true, r.closed);

    /* ---- 3. 刷新后仍在 ---- */
    await p.goto(base + '?tab=open&t=T001');
    r = await p.eval(`return { txt: document.getElementById('openList').innerText.replace(/\\s+/g,' ') };`);
    ok('刷新后仍显示「我已响应」', /我已响应/.test(r.txt), r.txt.slice(0, 120));
    ok('刷新后出现「撤回意向」按钮', /撤回意向/.test(r.txt), r.txt.slice(0, 120));

    /* ---- 4. 撤回：不填原因应被拦 ---- */
    await p.eval(`document.querySelector('[onclick*="askWithdraw"]').click();`);
    await sleep(150);
    await p.eval(`document.getElementById('rRemark').value='';document.getElementById('rOk').click();`);
    await sleep(200);
    r = await p.eval(`
      var rp = Store.responseOf('D20261030002','T001');
      return { status: rp.status, err: document.getElementById('rErr').innerText.trim(),
               open: document.getElementById('reasonModal').classList.contains('show') };`);
    ok('撤回未填原因被拦（状态仍已响应）', r.status === '已响应' && r.err.length > 0 && r.open, r);

    /* ---- 5. 撤回：填原因成功 ---- */
    await p.eval(`document.getElementById('rRemark').value='本周时间有冲突，无法带';document.getElementById('rOk').click();`);
    await sleep(200);
    r = await p.eval(`
      var rp = Store.responseOf('D20261030002','T001');
      var log = Store.demandLogsOf('D20261030002').slice(-1)[0];
      return { status: rp.status, reason: rp.withdrawReason, at: !!rp.withdrawnAt,
               log: log && log.action };`);
    ok('撤回成功（状态 已撤回）', r.status === '已撤回', r.status);
    ok('撤回原因入库', r.reason === '本周时间有冲突，无法带', r.reason);
    ok('撤回时间已记录', r.at === true, r.at);
    ok('流水记录 RESPONSE_WITHDRAWN', r.log === 'RESPONSE_WITHDRAWN', r.log);

    /* ---- 6. 暂不接单（另一条需求） ---- */
    await p.goto(base + '?tab=open&t=T001');
    r = await p.eval(`
      var card = [...document.querySelectorAll('.demand-card')].find(c => /沈亦航/.test(c.innerText));
      var b = card && card.querySelector('[onclick*="askDecline"]');
      if (b) b.click();
      return { found: !!b };`);
    ok('定位到沈亦航需求并点「暂不接单」', r.found === true, r);
    await sleep(150);
    r = await p.eval(`return { reasons: [...document.querySelectorAll('#rReason option')].map(o=>o.value) };`);
    ok('暂不接单原因 5 种', r.reasons.length === 5, r.reasons);
    await p.eval(`document.getElementById('rReason').value='时间不合适';
                  document.getElementById('rRemark').value='周三下午有课';
                  document.getElementById('rOk').click();`);
    await sleep(200);
    r = await p.eval(`
      var rp = Store.responseOf('D20261029003','T001');
      return { status: rp.status, reason: rp.declineReason, remark: rp.remark };`);
    ok('暂不接单落库', r.status === '暂不接单', r.status);
    ok('拒绝原因入库', r.reason === '时间不合适', r.reason);

    /* ---- 7. 「我的响应」Tab ---- */
    await p.goto(base + '?tab=mine&t=T001');
    r = await p.eval(`
      return { rows: document.querySelectorAll('#mineRows tr').length,
               txt: document.getElementById('page').innerText.replace(/\\s+/g,' '),
               foot: document.getElementById('mineFoot').textContent.trim() };`);
    ok('我的响应有记录', r.rows >= 2, r.rows);
    ok('展示「已撤回」与「暂不接单」', /已撤回/.test(r.txt) && /暂不接单/.test(r.txt), r.txt.slice(0, 200));
    ok('页脚说明教师不能改确认结果', /教师不能修改/.test(r.foot), r.foot);
    await p.shot('p6-6a-我的响应');

    /* ---- 8. 我的词库申请 Tab + 申请弹窗可用项 ---- */
    await p.goto(base + '?tab=wbreq&t=T001');
    r = await p.eval(`return { rows: document.querySelectorAll('#wbRows tr').length,
                                actions: document.getElementById('tabActions').innerText.trim() };`);
    ok('词库申请 Tab 有行', r.rows >= 1, r.rows);
    ok('右上角有「申请词库」', /申请词库/.test(r.actions), r.actions);
    await p.eval(`openWbModal();`);
    await sleep(200);
    r = await p.eval(`
      var items = [...document.querySelectorAll('#w_list .wb-item')];
      return { total: items.length,
               disabled: items.filter(i=>i.classList.contains('disabled')).length,
               reason: items.filter(i=>i.classList.contains('disabled')).map(i=>i.innerText.replace(/\\s+/g,' ').slice(-40)).slice(0,3),
               students: [...document.querySelectorAll('#w_student option')].length };`);
    ok('词库多选项已渲染', r.total > 0, r.total);
    ok('已授权词库被置灰并标注原因', r.disabled > 0 && r.reason.length > 0, r);
    await p.shot('p6-7a-词库申请弹窗');

    /* ---- 9. 提交一条真实申请 ---- */
    r = await p.eval(`
      var box = [...document.querySelectorAll('#w_list .wb-item')].filter(i=>!i.classList.contains('disabled'))[0];
      if (!box) return { none: true };
      var cb = box.querySelector('input'); cb.checked = true;
      document.getElementById('w_reason').value = '本周开始 Unit 2，需要配套词表';
      document.getElementById('w_plan').value = '先初筛再建莱特纳';
      var before = Store.wordbookRequests({}).length;
      submitWb();
      var after = Store.wordbookRequests({});
      return { id: cb.value, before: before, after: after.length,
               latest: after[after.length-1] && { wb: after[after.length-1].request.wordbookId,
                 status: after[after.length-1].request.status, by: after[after.length-1].request.teacherId } };`);
    ok('提交申请后数量 +1', r.after === r.before + 1, r);
    ok('新申请状态 待审核', r.latest && r.latest.status === '待审核', r.latest);
    ok('申请记录提交教师', r.latest && r.latest.by === 'T001', r.latest);

    /* ---- 10. 暂停教师不能接单 ---- */
    await p.goto(base + '?tab=open&t=T005');
    r = await p.eval(`return { txt: document.getElementById('openList').innerText.replace(/\\s+/g,' '),
                                cards: document.querySelectorAll('.demand-card').length };`);
    ok('暂停教师看不到可接需求 + 有提示', r.cards === 0 && /只有/.test(r.txt), r.txt.slice(0, 160));
    await p.shot('p6-8-暂停教师');

    errs.push(...p.errors);
    console.log('\n  控制台异常:', p.errors.length ? p.errors : '无');
    console.log(`\n  结果: ${pass} 通过 / ${fail} 失败`);
  } catch (e) {
    console.error('运行失败:', e.message);
    fail++;
  } finally {
    p.close();
    proc.kill();
  }
  process.exit(fail ? 1 : 0);
})();
