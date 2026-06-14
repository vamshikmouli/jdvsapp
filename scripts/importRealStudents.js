const XLSX = require('xlsx');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

// Map admission classes to class IDs.
// Excel uses Roman numerals + "STD" (e.g. "I STD", "X STD") plus PKG/LKG/UKG.
const classMapping = {
  'PKG': 'prekg',
  'LKG': 'lkg',
  'UKG': 'ukg',
  'I STD': '1',
  'II STD': '2',
  'III STD': '3',
  'IV STD': '4',
  'V STD': '5',
  'VI STD': '6',
  'VII STD': '7',
  'VIII STD': '8',
  'IX STD': '9',
  'X STD': '10',
};

async function importRealStudents() {
  const excelPath = 'C:\\Users\\Thinkpad\\Downloads\\student_deatils.xlsx';

  console.log('📖 Reading Excel file...');
  const workbook = XLSX.readFile(excelPath);
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];

  // Read all rows
  const allData = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });

  // Row 2 has headers (index 2)
  const headers = allData[2];
  console.log('✅ Headers:', headers.join(', '));

  // Clear existing students
  console.log('\n🗑️  Clearing existing students...');
  await prisma.student.deleteMany({});
  console.log('✅ Cleared');

  // Import students from row 3+ (index 3+)
  let imported = 0;
  let skipped = 0;

  for (let i = 3; i < allData.length; i++) {
    const row = allData[i];
    if (!row || row.length === 0) continue;

    // Map row to columns
    const obj = {};
    headers.forEach((header, index) => {
      obj[header] = row[index];
    });

    // Skip if no name
    if (!obj.name || !obj.name.toString().trim()) {
      skipped++;
      continue;
    }

    try {
      const studentName = obj.name.toString().trim();
      const gender = obj.gender ? obj.gender.toString().trim().toUpperCase() : 'M';
      const admissionClass = obj.admission_class ? obj.admission_class.toString().trim() : '';
      const classId = classMapping[admissionClass] || null;

      // Get guardian info (prefer mother, then father)
      const guardianName =
        (obj.mother_name && obj.mother_name.toString().trim()) ||
        (obj.father_name && obj.father_name.toString().trim()) ||
        'Guardian';

      const guardianPhone =
        (obj.mother_mobile_number && obj.mother_mobile_number.toString().trim()) ||
        (obj.father_mobile_number && obj.father_mobile_number.toString().trim()) ||
        '';

      const registrationNo = obj.register_number ? obj.register_number.toString().trim() : '';
      const village = obj.village ? obj.village.toString().trim() : '';

      // Use the Excel register number if present, otherwise a clean sequential admission no.
      const admissionNo = registrationNo || `JD2026-${String(imported + 1).padStart(4, '0')}`;

      await prisma.student.create({
        data: {
          id: admissionNo,
          name: studentName,
          gender: ['F', 'FEMALE'].includes(gender) ? 'F' : 'M',
          classId: classId,
          guardianName: guardianName,
          guardianPhone: guardianPhone,
          village: village,
          status: 'ACTIVE',
          joinedDate: new Date('2025-06-01'),
        },
      });

      imported++;

      if (imported % 50 === 0) {
        console.log(`  ⏳ Imported ${imported} students...`);
      }
    } catch (error) {
      if (error.code === 'P2002') {
        // Unique constraint violation - student ID already exists, skip
        skipped++;
      } else {
        console.error(`Error importing student at row ${i}:`, error.message);
      }
    }
  }

  console.log(`\n✅ Import completed!`);
  console.log(`   📝 Imported: ${imported} students`);
  console.log(`   ⏭️  Skipped: ${skipped} students`);

  // Show summary by class
  const byClass = await prisma.student.groupBy({
    by: ['classId'],
    _count: true,
    where: { classId: { not: null } },
  });

  console.log(`\n📊 Students by class:`);
  for (const group of byClass) {
    const cls = await prisma.schoolClass.findUnique({ where: { id: group.classId } });
    console.log(`   ${cls?.name || group.classId}: ${group._count}`);
  }
}

importRealStudents()
  .catch((error) => {
    console.error('❌ Error:', error.message);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
