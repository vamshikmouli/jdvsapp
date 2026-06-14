const XLSX = require('xlsx');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function importStudents() {
  const excelPath = 'C:\\Users\\Thinkpad\\Downloads\\student_deatils.xlsx';

  console.log('📖 Reading Excel file...');
  const workbook = XLSX.readFile(excelPath);
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];

  // Read all rows to handle the header issue
  const allData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

  console.log(`Total rows: ${allData.length}`);

  // Row 1: School info (skip)
  // Row 2: Headers
  // Row 3+: Student data

  const headers = allData[1]; // Headers are in row 2 (index 1)
  console.log('Headers:', headers);

  const students = [];
  for (let i = 2; i < allData.length; i++) {
    const row = allData[i];
    if (!row || row.length === 0) continue; // Skip empty rows

    const student = {};
    headers.forEach((header, index) => {
      student[header] = row[index];
    });
    students.push(student);
  }

  console.log(`\n✅ Parsed ${students.length} students`);
  console.log('\nFirst 3 students:');
  console.log(JSON.stringify(students.slice(0, 3), null, 2));

  // Return data for further processing
  return students;
}

importStudents()
  .then((students) => {
    console.log('\n✅ Ready to import!');
  })
  .catch((error) => {
    console.error('❌ Error:', error.message);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
