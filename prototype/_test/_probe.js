const vm=require('node:vm'),fs=require('fs'),path=require('path');
const mem={};const LS={getItem:k=>k in mem?mem[k]:null,setItem:(k,v)=>{mem[k]=String(v)},removeItem:k=>{delete mem[k]}};
function boot(){
  const ctx={console,localStorage:LS,sessionStorage:LS,Date,Math,JSON,Object,Array,String,Number,setTimeout};
  ctx.window=ctx;ctx.globalThis=ctx;vm.createContext(ctx);
  ['../assets/js/data.js','../assets/js/store.js'].forEach(f=>vm.runInContext(fs.readFileSync(path.join(__dirname,f),'utf8'),ctx,{filename:f}));
  return ctx.Store;
}
let S=boot();
console.log('课程数',S.db.courses.length,'记录数',S.db.courseRecords.length,'报告数',S.db.reports.length);
const c=S.course('C20261102005');
console.log('课程C20261102005 ->',c.status,c.studentId,c.teacherId,c.deductState);
console.log('今日李婉课:',S.coursesOfTeacher('T001','2026-11-02').map(x=>x.start+'~'+x.status).join(' | '));
console.log('统计',JSON.stringify(S.courseStat('T001','2026-11-02')));
['001','008','004'].forEach(n=>{const t=S.plan21Task('P21T'+n);console.log('节点'+n,t.status,t.dateState,t.wordIds.length,'done',S.plan21TaskStat(t.id).done);});
console.log('莱特纳任务',S.db.leitnerTasks.map(t=>t.id+':'+t.status).join(','));
console.log('文章任务',S.db.articleTasks.map(t=>t.id+':'+t.status).join(','));
console.log('计划',S.db.plans21.map(p=>p.id+':'+p.status).join(','));
console.log('复习来源',JSON.stringify(S.leitnerDueDetail('S2026001')).slice(0,220));
console.log('21天摘要',JSON.stringify(S.plan21TodaySummary('S2026001')));
