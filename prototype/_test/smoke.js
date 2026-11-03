/* 全站冒烟：逐页打开，收集 JS 异常与空页面 */
const fs = require('fs');
const path = require('path');
const { Page, launch, sleep, ROOT } = require('./cdp');

(async () => {
  const proc = await launch();
  const page = await Page.open();
  let curRole = '';
  async function ensureRole(role) {
    if (curRole === role) return;
    await page.eval(`(function(role){
      var a;
      if(role==='teacher'){
        a=Proto.roleAccounts('teacher').filter(function(x){return x.available;})[0];
        Store.setSession({role:'teacher',accountId:a?a.accountId:'',teacherId:a?a.profileId:'T001',agentId:'',parentId:''});
      }else if(role==='agent'){
        a=Proto.roleAccounts('agent').filter(function(x){return x.available;})[0];
        Store.setSession({role:'agent',accountId:a?a.accountId:'',agentId:a?a.profileId:'',teacherId:'',parentId:''});
      }else if(role==='parent'){
        a=Proto.roleAccounts('parent').filter(function(x){return x.available;})[0];
        Store.setSession({role:'parent',accountId:a?a.accountId:'',parentId:a?a.profileId:'',teacherId:'',agentId:''});
      }else{
        Store.setSession({role:'admin',accountId:'',operatorName:'',operatorId:'',teacherId:'',agentId:'',parentId:''});
      }
      return true;
    })(${JSON.stringify(role)})`);
    curRole = role;
  }
  await page.goto(ROOT + 'admin/dashboard.html');
  const files = [];
  (function walk(dir) {
    fs.readdirSync(dir, { withFileTypes: true }).forEach(e => {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (!['_shots', '_test', 'assets'].includes(e.name)) walk(p); }
      else if (e.name.endsWith('.html')) files.push(p);
    });
  })('D:/低代码/英语一对一教学软件/prototype');

  let bad = 0;
  for (const f of files) {
    const rel = path.relative('D:/低代码/英语一对一教学软件/prototype', f).replace(/\\/g, '/');
    const role = rel.indexOf('teacher/') === 0 ? 'teacher'
      : rel.indexOf('agent/') === 0 ? 'agent'
        : rel.indexOf('parent/') === 0 ? 'parent' : 'admin';
    await ensureRole(role);
    page.errors.length = 0;
    page.logs.length = 0;
    await page.goto(ROOT + rel);
    const info = await page.eval(`return {
      title: document.title,
      len: document.body.innerText.replace(/\\s/g,'').length,
      empty: document.querySelectorAll('.empty').length
    };`);
    if (page.errors.length || page.logs.length) {
      bad++;
      console.log('✗ ' + rel + ' → ' + JSON.stringify(page.errors.concat(page.logs)).slice(0, 260));
    } else if (info.len < 60) {
      bad++;
      console.log('✗ ' + rel + ' → 内容过少 (' + info.len + ')');
    }
  }
  console.log('\n检查 ' + files.length + ' 页，异常 ' + bad + ' 页');
  page.close(); proc.kill(); process.exit(bad ? 1 : 0);
})();
