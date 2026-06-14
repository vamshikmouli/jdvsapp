const XLSX = require('xlsx');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

function clean(v) {
  if (v === undefined || v === null) return '';
  return String(v).trim();
}

function titleCase(s) {
  return s
    .toLowerCase()
    .split(' ')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

async function importStaff() {
  const excelPath = 'C:/Users/Thinkpad/Downloads/staffs.xlsx';
  console.log('📖 Reading staff Excel...');
  const workbook = XLSX.readFile(excelPath);
  const worksheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });

  const headers = rows[0];
  const col = (name) => headers.indexOf(name);

  const idx = {
    name: col('name'),
    middle: col('middle_name'),
    last: col('last_name'),
    email: col('email_id'),
    phone: col('primary_contact_no'),
    designation: col('designation'),
    category: col('staff_category'),
    subcategory: col('staff_subcategory'),
    subject: col('subject_specialization'),
    status: col('status'),
    uid: col('staff_uid'),
    employeeId: col('employee_id'),
    headTeacher: col('head_teacher'),
  };

  console.log('🗑️  Clearing existing staff...');
  await prisma.staff.deleteMany({});
  console.log('✅ Cleared');

  let imported = 0;
  let skipped = 0;

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || r.length === 0) continue;

    // Build full name from name + middle + last
    const parts = [clean(r[idx.name]), clean(r[idx.middle]), clean(r[idx.last])].filter(Boolean);
    const fullName = parts.join(' ');
    if (!fullName) {
      skipped++;
      continue;
    }

    const email = clean(r[idx.email]) || null;
    const phone = clean(r[idx.phone]) || null;
    const subject = clean(r[idx.subject]);
    const category = clean(r[idx.category]);
    const explicitDesignation = clean(r[idx.designation]);

    // Derive a readable designation
    let designation = explicitDesignation;
    if (!designation) {
      if (category.includes('NON-TEACHING')) {
        designation = 'Non-teaching staff';
      } else if (subject) {
        designation = `Teacher · ${titleCase(subject)}`;
      } else {
        designation = 'Teacher';
      }
    }

    const uid = clean(r[idx.uid]) || clean(r[idx.employeeId]);
    const id = uid ? `STAFF-${uid}` : undefined; // fall back to cuid if no uid

    try {
      await prisma.staff.create({
        data: {
          ...(id ? { id } : {}),
          name: titleCase(fullName),
          email,
          phone,
          designation,
        },
      });
      imported++;
    } catch (error) {
      if (error.code === 'P2002') {
        skipped++;
      } else {
        console.error(`Row ${i} (${fullName}):`, error.message);
        skipped++;
      }
    }
  }

  console.log(`\n✅ Import completed!`);
  console.log(`   📝 Imported: ${imported} staff`);
  console.log(`   ⏭️  Skipped: ${skipped}`);

  const all = await prisma.staff.findMany({ orderBy: { name: 'asc' } });
  console.log(`\n📋 Staff in DB (${all.length}):`);
  all.forEach((s) => console.log(`   ${s.name.padEnd(28)} | ${s.designation || '—'} | ${s.phone || '—'}`));
}

importStaff()
  .catch((e) => {
    console.error('❌ Error:', e.message);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
