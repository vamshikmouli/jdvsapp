const XLSX = require('xlsx');

const excelPath = 'C:/Users/Thinkpad/Downloads/student_deatils.xlsx';
const workbook = XLSX.readFile(excelPath);
const worksheet = workbook.Sheets[workbook.SheetNames[0]];
const allData = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });

const headers = allData[2];
const classIdx = headers.indexOf('admission_class');

const counts = {};
for (let i = 3; i < allData.length; i++) {
  const val = allData[i][classIdx];
  const key = (val === '' || val === undefined || val === null) ? '(blank)' : String(val).trim();
  counts[key] = (counts[key] || 0) + 1;
}

console.log('admission_class distinct values and counts:');
Object.keys(counts).sort().forEach(k => console.log(`  "${k}": ${counts[k]}`));
console.log('\nTotal distinct:', Object.keys(counts).length);
