/* ============================================================
   生成真实的 Excel 测试文件（不是 CSV 改名，是 SheetJS 写出的 xlsx / xls）
   ------------------------------------------------------------
   覆盖五个验收场景需要的一批文件：
     场景一：3 个互不相关的文件 → 3 个词库
     场景二：含系统已有单词的文件 → 复用基础单词
     场景三：文件内部重复行
     场景四：1 个错误文件 + 2 个正常文件
     场景五：刷新后持久化（复用上面任意文件）
   运行：node prototype/_test/make-fixtures.js
   ============================================================ */
const fs = require('fs');
const path = require('path');
const XLSX = require('../assets/vendor/xlsx.full.min.js');

const OUT = path.join(__dirname, 'fixtures');
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

/* 单元格里的「换行释义」用 \n，验证多释义拆分 */
function book(sheets) {
  const wb = XLSX.utils.book_new();
  sheets.forEach(s => {
    const ws = XLSX.utils.aoa_to_sheet(s.rows);
    if (s.widths) ws['!cols'] = s.widths.map(w => ({ wch: w }));
    XLSX.utils.book_append_sheet(wb, ws, s.name);
  });
  return wb;
}

function save(wb, name) {
  const f = path.join(OUT, name);
  const isXls = /\.xls$/i.test(name);
  const buf = XLSX.write(wb, { type: 'buffer', bookType: isXls ? 'biff8' : 'xlsx' });
  fs.writeFileSync(f, buf);
  const kb = (fs.statSync(f).size / 1024).toFixed(1);
  console.log(`  ${name.padEnd(34)} ${kb} KB`);
  return f;
}

/* ---------- 场景一：三个互不相关的文件 ---------- */

/* 1. 标准表头，一个工作表 */
save(book([{
  name: '词汇',
  widths: [14, 16, 8, 26, 22],
  rows: [
    ['单词', '音标', '词性', '中文', '音频'],
    ['apple', '/ˈæpl/', 'n.', '苹果', 'apple.mp3'],
    ['banana', '/bəˈnɑːnə/', 'n.', '香蕉', 'banana.mp3'],
    ['orange', '/ˈɒrɪndʒ/', 'n.', '橙子；橘子', 'orange.mp3'],
    ['grape', '/ɡreɪp/', 'n.', '葡萄', ''],
    ['pear', '/peə(r)/', 'n.', '梨', 'pear.mp3'],
    ['peach', '/piːtʃ/', 'n.', '桃子', ''],
    ['lemon', '/ˈlemən/', 'n.', '柠檬', 'lemon.mp3'],
    ['mango', '/ˈmæŋɡəʊ/', 'n.', '芒果', ''],
    ['melon', '/ˈmelən/', 'n.', '甜瓜；瓜', 'melon.mp3'],
    ['cherry', '/ˈtʃeri/', 'n.', '樱桃', ''],
    ['strawberry', '/ˈstrɔːbəri/', 'n.', '草莓', 'strawberry.mp3'],
    ['watermelon', '/ˈwɔːtəmelən/', 'n.', '西瓜', ''],
  ]
}]), 'WOWEnglish-全季.xlsx');

/* 2. 前两行是封面/说明，表头在第 3 行 —— 验证表头识别与数据起始行 */
save(book([{
  name: 'Sheet1',
  widths: [12, 14, 8, 20],
  rows: [
    ['小学考纲词库（2026 版）'],
    ['说明：本表仅含考纲核心名词，音标采用英式注音，音频文件待补'],
    [],
    ['英文', '音标', '词性', '释义'],
    ['cat', '/kæt/', 'n.', '猫'],
    ['dog', '/dɒɡ/', 'n.', '狗'],
    ['bird', '/bɜːd/', 'n.', '鸟'],
    ['fish', '/fɪʃ/', 'n.', '鱼'],
    ['rabbit', '/ˈræbɪt/', 'n.', '兔子'],
    ['tiger', '/ˈtaɪɡə(r)/', 'n.', '老虎'],
    ['lion', '/ˈlaɪən/', 'n.', '狮子'],
    ['monkey', '/ˈmʌŋki/', 'n.', '猴子'],
    ['elephant', '/ˈelɪfənt/', 'n.', '大象'],
    ['panda', '/ˈpændə/', 'n.', '熊猫'],
  ]
}]), '小学考纲词库.xlsx');

/* 3. 多工作表：第一个是说明页，第二个才是数据 —— 不能把说明页当数据 */
save(book([
  {
    name: '说明',
    rows: [
      ['初中超前词汇'],
      ['本文件用于九年级拔高训练'],
      ['请勿删除「词汇表」工作表'],
    ]
  },
  {
    name: '词汇表',
    widths: [14, 16, 10, 20],
    rows: [
      ['Word', 'Phonetic', 'Pos', 'Meaning'],
      ['ability', '/əˈbɪləti/', 'n.', '能力；才能'],
      ['achieve', '/əˈtʃiːv/', 'v.', '实现；达到'],
      ['advantage', '/ədˈvɑːntɪdʒ/', 'n.', '优点；优势'],
      ['challenge', '/ˈtʃælɪndʒ/', 'n./v.', '挑战；向…挑战'],
      ['communicate', '/kəˈmjuːnɪkeɪt/', 'v.', '交流；沟通'],
      ['confident', '/ˈkɒnfɪdənt/', 'adj.', '自信的'],
      ['develop', '/dɪˈveləp/', 'v.', '发展；培养'],
      ['environment', '/ɪnˈvaɪrənmənt/', 'n.', '环境'],
      ['experience', '/ɪkˈspɪəriəns/', 'n./v.', '经验；经历'],
      ['improve', '/ɪmˈpruːv/', 'v.', '改进；提高'],
    ]
  }
]), '初中超前词汇.xlsx');

/* ---------- 场景二：含系统已有单词（name / nice / meet / friend 已在 WB001） ---------- */
save(book([{
  name: '新初一单词',
  widths: [14, 16, 8, 22],
  rows: [
    ['词汇', '音标', '词性', '中文释义'],
    ['name', '/neɪm/', 'n./v.', '名字；命名'],
    ['nice', '/naɪs/', 'adj.', '令人愉快的；友好的'],
    ['meet', '/miːt/', 'v.', '遇见；相识'],
    ['friend', '/frend/', 'n.', '朋友'],
    ['welcome', '/ˈwelkəm/', 'v./adj.', '欢迎；受欢迎的'],
    ['morning', '/ˈmɔːnɪŋ/', 'n.', '早晨；上午'],
    ['afternoon', '/ˌɑːftəˈnuːn/', 'n.', '下午'],
    ['evening', '/ˈiːvnɪŋ/', 'n.', '晚上；傍晚'],
    ['student', '/ˈstjuːdnt/', 'n.', '学生'],
    ['teacher', '/ˈtiːtʃə(r)/', 'n.', '老师；教师'],
  ]
}]), '新初一单词.xlsx');

/* 同一批次里第二个文件，与上一个文件也有重叠（welcome / morning / afternoon） */
save(book([{
  name: 'Unit 1',
  widths: [14, 16, 8, 24],
  rows: [
    ['单词', '音标', '词性', '释义'],
    ['welcome', '/ˈwelkəm/', 'v.', '欢迎'],
    ['morning', '/ˈmɔːnɪŋ/', 'n.', '早晨'],
    ['afternoon', '/ˌɑːftəˈnuːn/', 'n.', '下午'],
    ['subject', '/ˈsʌbdʒɪkt/', 'n.', '科目；主题'],
    ['lesson', '/ˈlesn/', 'n.', '课；一节课'],
    ['homework', '/ˈhəʊmwɜːk/', 'n.', '家庭作业'],
    ['exam', '/ɪɡˈzæm/', 'n.', '考试'],
    ['grade', '/ɡreɪd/', 'n.', '年级；成绩'],
  ]
}]), '人教版中学-按单元.xlsx');

/* ---------- 场景三：文件内部重复 ---------- */
save(book([{
  name: '颜色',
  widths: [12, 14, 8, 16],
  rows: [
    ['英文', '音标', '词性', '中文'],
    ['red', '/red/', 'adj.', '红色的'],
    ['blue', '/bluː/', 'adj.', '蓝色的'],
    ['green', '/ɡriːn/', 'adj.', '绿色的'],
    ['yellow', '/ˈjeləʊ/', 'adj.', '黄色的'],
    ['red', '/red/', 'adj.', '红色的'],
    ['black', '/blæk/', 'adj.', '黑色的'],
    ['white', '/waɪt/', 'adj.', '白色的'],
    ['blue', '/bluː/', 'adj.', '蓝色的'],
    ['pink', '/pɪŋk/', 'adj.', '粉色的'],
    ['red', '/red/', 'adj.', '红色的'],
  ]
}]), '人教版一年级起点.xlsx');

/* ---------- 场景四：一个错误文件 ---------- */
/* 4a. 只有封面，没有表头也没有数据 —— 解析阶段就失败，不能写库 */
save(book([{
  name: '封面',
  rows: [
    ['外研社版中学英语（全）'],
    ['本文件为纸质教材扫描整理，数据整理中'],
    ['2026-10 教务处'],
  ]
}]), '外研社版中学英语(全).xlsx');

/* 4b. 有表头，但 10 行里有 3 行缺中文释义 —— 部分入库 + 失败行可下载 */
save(book([{
  name: '词汇',
  widths: [14, 16, 8, 20],
  rows: [
    ['单词', '音标', '词性', '中文'],
    ['spring', '/sprɪŋ/', 'n.', '春天'],
    ['summer', '/ˈsʌmə(r)/', 'n.', '夏天'],
    ['autumn', '/ˈɔːtəm/', 'n.', ''],
    ['winter', '/ˈwɪntə(r)/', 'n.', '冬天'],
    ['season', '/ˈsiːzn/', 'n.', '季节'],
    ['weather', '/ˈweðə(r)/', 'n.', ''],
    ['sunny', '/ˈsʌni/', 'adj.', '晴朗的'],
    ['cloudy', '/ˈklaʊdi/', 'adj.', '多云的'],
    ['rainy', '/ˈreɪni/', 'adj.', ''],
    ['windy', '/ˈwɪndi/', 'adj.', '有风的'],
  ]
}]), '人教版初中英语(全).xlsx');

/* 4c. .xls 老格式 —— 验证 .xls 也能解析 */
save(book([{
  name: 'Sheet1',
  widths: [12, 14, 8, 16],
  rows: [
    ['单词', '音标', '词性', '中文'],
    ['spring', '/sprɪŋ/', 'n.', '春天'],
    ['summer', '/ˈsʌmə(r)/', 'n.', '夏天'],
    ['autumn', '/ˈɔːtəm/', 'n.', '秋天'],
    ['winter', '/ˈwɪntə(r)/', 'n.', '冬天'],
    ['season', '/ˈsiːzn/', 'n.', '季节'],
    ['weather', '/ˈweðə(r)/', 'n.', '天气'],
    ['sunny', '/ˈsʌni/', 'adj.', '晴朗的'],
    ['cloudy', '/ˈklaʊdi/', 'adj.', '多云的'],
  ]
}]), '新七年级上.xls');

/* 4d. 音标格式异常（没有斜杠）+ 一个非法英文（含数字） */
save(book([{
  name: '词汇',
  widths: [14, 18, 8, 20],
  rows: [
    ['英文', '音标', '词性', '释义'],
    ['library', 'laɪbrəri', 'n.', '图书馆'],
    ['hospital', '/ˈhɒspɪtl/', 'n.', '医院'],
    ['bank', '/bæŋk/', 'n.', '银行'],
    ['abc123', '/eɪbiːsiː/', 'n.', '非法单词示例'],
    ['museum', '', 'n.', '博物馆'],
  ]
}]), '外研版一年级起点.xlsx');

console.log('\n共生成 ' + fs.readdirSync(OUT).filter(f => /\.(xlsx|xls)$/i.test(f)).length + ' 个文件 → ' + OUT);
