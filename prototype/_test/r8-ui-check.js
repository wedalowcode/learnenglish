const fs = require('fs');
const path = require('path');
const files = process.argv.slice(2);
let bad = 0;
for (const f of files) {
  const html = fs.readFileSync(f, 'utf8');
  const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
  let m, i = 0;
  while ((m = re.exec(html))) {
    i++;
    try { new Function(m[1]); }
    catch (e) { bad++; console.log('SYNTAX FAIL', path.basename(f), 'block', i, e.message); }
  }
}
console.log(bad ? `FAIL ${bad}` : 'ALL OK');
process.exit(bad ? 1 : 0);
