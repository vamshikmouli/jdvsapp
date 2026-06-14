const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const CLASS_SEED = [
  { id: 'prekg', name: 'Pre-KG', order: 0, room: 'G-00', group: 'PRE' },
  { id: 'lkg', name: 'LKG', order: 1, room: 'G-01', group: 'PRE' },
  { id: 'ukg', name: 'UKG', order: 2, room: 'G-02', group: 'PRE' },
  { id: '1', name: '1st STD', order: 3, room: '101', group: 'PRIMARY' },
  { id: '2', name: '2nd STD', order: 4, room: '102', group: 'PRIMARY' },
  { id: '3', name: '3rd STD', order: 5, room: '103', group: 'PRIMARY' },
  { id: '4', name: '4th STD', order: 6, room: '104', group: 'PRIMARY' },
  { id: '5', name: '5th STD', order: 7, room: '105', group: 'PRIMARY' },
  { id: '6', name: '6th STD', order: 8, room: '201', group: 'SECONDARY' },
  { id: '7', name: '7th STD', order: 9, room: '202', group: 'SECONDARY' },
  { id: '8', name: '8th STD', order: 10, room: '203', group: 'SECONDARY' },
  { id: '9', name: '9th STD', order: 11, room: '204', group: 'SECONDARY' },
  { id: '10', name: '10th STD', order: 12, room: '205', group: 'SECONDARY' },
];

const STAFF_SEED = [
  { name: 'Anita Desai', email: 'anita.desai@jnanadeepika.edu', phone: '+91 98450 11111', designation: 'Class Teacher', classes: ['prekg'] },
  { name: 'Rekha Menon', email: 'rekha.menon@jnanadeepika.edu', phone: '+91 98450 22222', designation: 'Class Teacher', classes: ['ukg'] },
  { name: 'Sunita Rao', email: 'sunita.rao@jnanadeepika.edu', phone: '+91 98450 33333', designation: 'Class Teacher', classes: ['1'] },
  { name: 'Fatima Sheikh', email: 'fatima.sheikh@jnanadeepika.edu', phone: '+91 98450 44444', designation: 'Class Teacher', classes: ['2'] },
  { name: 'Joseph Thomas', email: 'joseph.thomas@jnanadeepika.edu', phone: '+91 98450 55555', designation: 'Class Teacher', classes: ['3', '6'] },
  { name: 'Priya Nair', email: 'priya.nair@jnanadeepika.edu', phone: '+91 98450 66666', designation: 'Class Teacher', classes: ['4', '5'] },
  { name: 'Latha Krishnan', email: 'latha.krishnan@jnanadeepika.edu', phone: '+91 98450 77777', designation: 'Class Teacher', classes: ['5'] },
  { name: 'Imran Qureshi', email: 'imran.qureshi@jnanadeepika.edu', phone: '+91 98450 88888', designation: 'Class Teacher', classes: ['6', '7', '8'] },
  { name: 'Deepa Pillai', email: 'deepa.pillai@jnanadeepika.edu', phone: '+91 98450 99999', designation: 'Class Teacher', classes: ['7'] },
  { name: 'Ramesh Gowda', email: 'ramesh.gowda@jnanadeepika.edu', phone: '+91 98451 00000', designation: 'Class Teacher', classes: ['8'] },
  { name: 'Nandini Shet', email: 'nandini.shet@jnanadeepika.edu', phone: '+91 98451 11111', designation: 'Class Teacher', classes: ['9'] },
  { name: 'Vincent D\'Cruz', email: 'vincent.dcruz@jnanadeepika.edu', phone: '+91 98451 22222', designation: 'Class Teacher', classes: ['10'] },
  { name: 'Vikram Rao', email: 'vikram.rao@jnanadeepika.edu', phone: '+91 98451 33333', designation: 'Accountant', classes: [] },
  { name: 'Meera Iyer', email: 'meera.iyer@jnanadeepika.edu', phone: '+91 98451 44444', designation: 'Administrator', classes: [] },
];

const FIRST_NAMES = ['Aanya', 'Aarav', 'Devansh', 'Diya', 'Ishaan', 'Kabir', 'Kavya', 'Mira', 'Neil', 'Pari', 'Riaan', 'Rohan', 'Saira', 'Tara', 'Vivaan'];
const LAST_NAMES = ['Iyer', 'Sharma', 'Rao', 'Patel', 'Verma', 'Khanna', 'Reddy', 'Joshi', 'D\'Souza', 'Kapoor'];
const VILLAGES = ['Karenahalli', 'Channasandra', 'Raghupati Agrahara'];

function hash(s) {
  let h = 0;
  for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) | 0;
  return Math.abs(h);
}

async function main() {
  console.log('🌱 Starting seed...');

  // Seed classes
  console.log('📚 Seeding classes...');
  for (const cls of CLASS_SEED) {
    await prisma.schoolClass.upsert({
      where: { id: cls.id },
      update: {},
      create: cls,
    });
  }
  console.log(`   ✅ Created ${CLASS_SEED.length} classes`);

  // Seed staff
  console.log('👨‍🏫 Seeding staff...');
  for (const staff of STAFF_SEED) {
    const staffRecord = await prisma.staff.create({
      data: {
        name: staff.name,
        email: staff.email,
        phone: staff.phone,
        designation: staff.designation,
      },
    });

    // Assign to classes
    for (const classId of staff.classes) {
      await prisma.schoolClass.update({
        where: { id: classId },
        data: {
          teachers: { connect: { id: staffRecord.id } },
        },
      });
    }
  }
  console.log(`   ✅ Created ${STAFF_SEED.length} staff members`);

  // Seed students
  console.log('👥 Seeding students...');
  let studentNum = 1;
  const studentCount = { prekg: 5, lkg: 6, ukg: 5, '1': 5, '2': 4, '3': 4, '4': 6, '5': 4, '6': 3, '7': 3, '8': 3, '9': 2, '10': 3 };
  let totalStudents = 0;

  for (const cls of CLASS_SEED) {
    const count = studentCount[cls.id] || 3;

    for (let i = 0; i < count; i++) {
      const firstName = FIRST_NAMES[hash(cls.id + String(i) + 'f') % FIRST_NAMES.length];
      const lastName = LAST_NAMES[hash(cls.id + String(i) + 'l') % LAST_NAMES.length];
      const name = `${firstName} ${lastName}`;
      const genderHash = hash(name) % 2;
      const gender = genderHash === 0 ? 'F' : 'M';
      const guardianName = `${gender === 'F' ? 'Mrs.' : 'Mr.'} ${lastName}`;

      await prisma.student.create({
        data: {
          id: `JD2026-${String(1000 + studentNum).padStart(4, '0')}`,
          name,
          classId: cls.id,
          roll: String(i + 1).padStart(2, '0'),
          gender,
          guardianName,
          guardianPhone: `+91 9${String(7000000 + hash(name) % 99999999).slice(0, 9)}`,
          village: VILLAGES[hash(name) % VILLAGES.length],
          status: hash(name) % 11 === 0 ? 'INACTIVE' : 'ACTIVE',
          joinedDate: new Date('2025-06-01'),
        },
      });
      totalStudents++;
      studentNum++;
    }
  }
  console.log(`   ✅ Created ${totalStudents} students`);

  console.log('✅ Seed completed successfully!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
