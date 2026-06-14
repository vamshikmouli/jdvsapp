const XLSX = require('xlsx');

const excelPath = 'C:\\Users\\Thinkpad\\Downloads\\student_deatils.xlsx';

console.log('📖 Reading Excel file...');
const workbook = XLSX.readFile(excelPath);
const sheetName = workbook.SheetNames[0];
const worksheet = workbook.Sheets[sheetName];

// Get all data as 2D array to see structure clearly
const data = XLSX.utils.sheet_to_json(worksheet, {
  header: 1,
  defval: ''
});

console.log(`Total rows: ${data.length}`);
console.log('\nFirst 5 rows:');

for (let i = 0; i < Math.min(5, data.length); i++) {
  console.log(`Row ${i}:`, JSON.stringify(data[i].slice(0, 10))); // Show first 10 columns
}

// Try to find where actual headers are
console.log('\n\nSearching for header row...');
for (let i = 0; i < Math.min(10, data.length); i++) {
  const row = data[i];
  const hasHeaders = row.some(cell =>
    cell && typeof cell === 'string' &&
    (cell.includes('name') || cell.includes('class') || cell.includes('gender') || cell.includes('mobile'))
  );
  if (hasHeaders) {
    console.log(`Found headers at row ${i}:`, row.slice(0, 15));
  }
}
