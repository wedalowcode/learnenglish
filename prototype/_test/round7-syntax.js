/** 语法自检：把本次改动页面的内联脚本交给 JS 解析器（只解析，不执行） */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

const files = [
  'admin/demand-list.html', 'teacher/article-training.html', 'teacher/course-report.html',
  'teacher/course-workbench.html', 'teacher/demand-center.html', 'teacher/leitner-review.html',
  'teacher/leitner.html', 'teacher/memory21-review.html', 'teacher/memory21.html',
  'teacher/my-students.html', 'teacher/student-profile.html', 'teacher/teaching-record.html',
  'teacher/word-detail.html', 'teacher/word-training-setup.html', 'teacher/word-training.html',
  'teacher/workbench.html'
];

let bad = 0;
files.forEach(f => {
  const html = fs.readFileSync(path.join(ROOT, f), 'utf8');
  const blocks = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)];
  blocks.forEach((m, i) => {
    try {
      new Function(m[1]);
    } catch (e) {
      bad++;
      console.log('SYNTAX FAIL ' + f + ' #' + (i + 1) + ' → ' + e.message);
    }
  });
  console.log('OK ' + f + ' (' + blocks.length + ' block' + (blocks.length > 1 ? 's' : '') + ')');
});
console.log(bad === 0 ? '\n全部页面脚本语法通过' : '\n存在语法错误：' + bad);
process.exit(bad ? 1 : 0);
