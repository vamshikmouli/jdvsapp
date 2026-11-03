import { describe, it, expect, afterAll } from 'vitest';
import { prisma } from '@/lib/db';
import { generateAdmissionNo } from '@/lib/services/admissionNo';

// Student-ID generation: base, then -2, -3… skipping ids in the DB or chosen this batch.
// Uses roll 97 of 10th STD in year 2099 so it can't clash with real data.
const Y = '2099-00', BASE = 'JDVS991097';
const made: string[] = [];
const mk = async (id: string) => { made.push(id); await prisma.student.create({ data: { id, name: id, gender: 'M', guardianName: 'T', guardianPhone: '0', status: 'ACTIVE' } }); };
afterAll(async () => { await prisma.student.deleteMany({ where: { id: { in: made } } }); await prisma.$disconnect(); });

describe('generateAdmissionNo', () => {
  it('unknown class or no roll → null', async () => {
    expect(await generateAdmissionNo({ classId: 'nope', roll: 5, yearId: Y })).toBeNull();
    expect(await generateAdmissionNo({ classId: '10', roll: '', yearId: Y })).toBeNull();
  });
  it('free base is used; taken ones get the next free suffix (DB and batch)', async () => {
    expect(await generateAdmissionNo({ classId: '10', roll: 97, yearId: Y })).toBe(BASE);
    await mk(BASE); await mk(`${BASE}-2`); await mk(`${BASE}-4`);
    expect(await generateAdmissionNo({ classId: '10', roll: '97', yearId: Y })).toBe(`${BASE}-3`);
    const taken = new Set<string>([`${BASE}-3`]);
    expect(await generateAdmissionNo({ classId: '10', roll: 97, yearId: Y, taken })).toBe(`${BASE}-5`);
    expect(taken.has(`${BASE}-5`)).toBe(true);
    expect(await generateAdmissionNo({ classId: '10', roll: 97, yearId: Y, taken })).toBe(`${BASE}-6`);
  });
  it('pads a single-digit roll and maps pre-primary class codes', async () => {
    expect(await generateAdmissionNo({ classId: 'prekg', roll: 7, yearId: Y })).toBe('JDVS991107');
  });
});
