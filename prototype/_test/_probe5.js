/* 临时探针：确认 v6 教师域模型可加载、种子一致 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const root = path.join(__dirname, '..', 'assets', 'js') + path.sep;
const mem = {};
const localStorage = {
  getItem: k => (k in mem ? mem[k] : null),
  setItem: (k, v) => { mem[k] = String(v); },
  removeItem: k => { delete mem[k]; }
};
const sandbox = { console, localStorage, Date, JSON, Math, Object, Array, String, Number, isFinite, parseInt, parseFloat };
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(root + 'data.js', 'utf8'), sandbox);
vm.runInContext(fs.readFileSync(root + 'store.js', 'utf8'), sandbox);
const S = sandbox.Store;

console.log('教师数', S.teachers().length);
console.log('账号数', S.users().length);
console.log('关系数', S.db.teacherStudents.length);
console.log('合作流水', S.db.teacherCooperations.length);
S.teachers().forEach(t => {
  const s = S.teacherStat(t.id);
  console.log(t.code, t.name, t.cooperationStatus, S.accountStatusOf(t.id),
    '当前学员', s.currentStudents, '历史学员', S.historyStudentsOf(t.id).length,
    '本月课', s.monthCourses, '未来课', s.futureCourses, '|', S.availabilityText(t));
});
console.log('概览', JSON.stringify(S.teacherOverview()));
console.log('学员缓存', S.students().map(s => s.name + ':' + s.teacherName).join(', '));
console.log('启用检查 T007', JSON.stringify(S.activationCheck('T007')));
console.log('退出检查 T001', JSON.stringify(S.exitCheck('T001').blocks));
console.log('可授课池', S.teacherPool().map(x => x.teacher.name).join(','));
