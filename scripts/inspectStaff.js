const XLSX = require('xlsx');

const excelPath = 'C:/Users/Thinkpad/Downloads/staffs.xlsx';
const workbook = XLSX.readFile(excelPath);
const worksheet = workbook.Sheets[workbook.SheetNames[0]];
const data = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });

console.log(`Total rows: ${data.length}`);
console.log('\nFirst 8 rows:');
for (let i = 0; i < Math.min(8, data.length); i++) {
  console.log(`Row ${i}:`, JSON.stringify(data[i]));
}
