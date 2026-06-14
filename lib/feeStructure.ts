/**
 * Jnana Deepika — official fee structure (source: school fee sheet).
 * This is the canonical price reference the fee module reads from for
 * uniform pricing, the school-fee extras and the village van rates.
 *
 * Class keys here are the human labels from the sheet; `CLASS_ID_BY_KEY`
 * maps them to the DB SchoolClass ids ("prekg","lkg","ukg","1".."10").
 */

export type ClassKey =
  | 'Pre-KG' | 'LKG' | 'UKG'
  | '1st' | '2nd' | '3rd' | '4th' | '5th'
  | '6th' | '7th' | '8th' | '9th' | '10th';

export const CLASSES: ClassKey[] = [
  'Pre-KG', 'LKG', 'UKG',
  '1st', '2nd', '3rd', '4th', '5th',
  '6th', '7th', '8th', '9th', '10th',
];

export const CLASS_ID_BY_KEY: Record<ClassKey, string> = {
  'Pre-KG': 'prekg', LKG: 'lkg', UKG: 'ukg',
  '1st': '1', '2nd': '2', '3rd': '3', '4th': '4', '5th': '5',
  '6th': '6', '7th': '7', '8th': '8', '9th': '9', '10th': '10',
};

export const CLASS_KEY_BY_ID: Record<string, ClassKey> = Object.fromEntries(
  Object.entries(CLASS_ID_BY_KEY).map(([k, v]) => [v, k as ClassKey])
) as Record<string, ClassKey>;

// Tuition / school fee grand total per class (kept for reference; the DB holds
// the installment breakdown that already sums to these).
export const TUITION: Record<ClassKey, number> = {
  'Pre-KG': 12000, LKG: 16500, UKG: 17000,
  '1st': 17500, '2nd': 20500, '3rd': 21000, '4th': 21500, '5th': 22000,
  '6th': 22500, '7th': 23000, '8th': 17000, '9th': 17500, '10th': 18000,
};

type Maybe = number | null;

const UNIFORM_SCHOOL_BOY: Record<ClassKey, Maybe> = {
  'Pre-KG': 1200, LKG: 1230, UKG: 1250,
  '1st': 1500, '2nd': 560, '3rd': 580, '4th': 600, '5th': 600,
  '6th': 630, '7th': 630, '8th': 1980, '9th': 680, '10th': 680,
};
const UNIFORM_SCHOOL_GIRL: Record<ClassKey, Maybe> = {
  'Pre-KG': 1260, LKG: 1280, UKG: 1300,
  '1st': 1500, '2nd': 700, '3rd': 720, '4th': 720, '5th': 720,
  '6th': 740, '7th': 900, '8th': 1980, '9th': 920, '10th': 920,
};
const UNIFORM_WHITE_BOY: Record<ClassKey, Maybe> = {
  'Pre-KG': 620, LKG: 640, UKG: 640,
  '1st': 650, '2nd': 660, '3rd': 670, '4th': 670,
  '5th': null, '6th': null, '7th': null, '8th': null, '9th': null, '10th': null,
};
const UNIFORM_WHITE_GIRL: Record<ClassKey, Maybe> = {
  'Pre-KG': 620, LKG: 640, UKG: 640,
  '1st': 650, '2nd': 660,
  '3rd': null, '4th': null, '5th': null, '6th': null, '7th': null, '8th': null, '9th': null, '10th': null,
};
const TSHIRT: Record<ClassKey, Maybe> = {
  'Pre-KG': 300, LKG: 300, UKG: 300,
  '1st': 300, '2nd': 300, '3rd': 300, '4th': 300, '5th': 350,
  '6th': 350, '7th': 350, '8th': 380, '9th': 380, '10th': 380,
};
const WED_UNIFORM: Record<ClassKey, Maybe> = {
  'Pre-KG': 740, LKG: 740, UKG: 760,
  '1st': 770, '2nd': 800, '3rd': 820, '4th': 820, '5th': 850,
  '6th': 850, '7th': 850, '8th': 850, '9th': 850, '10th': 850,
};
const TIE: Record<ClassKey, number> = {
  'Pre-KG': 60, LKG: 60, UKG: 60,
  '1st': 60, '2nd': 70, '3rd': 70, '4th': 70, '5th': 70,
  '6th': 80, '7th': 80, '8th': 80, '9th': 80, '10th': 80,
};
const BELT: Record<ClassKey, number> = {
  'Pre-KG': 120, LKG: 120, UKG: 120,
  '1st': 120, '2nd': 120, '3rd': 120, '4th': 120, '5th': 120,
  '6th': 140, '7th': 140, '8th': 140, '9th': 140, '10th': 140,
};
const SOCKS: Record<ClassKey, number> = {
  'Pre-KG': 70, LKG: 70, UKG: 70,
  '1st': 70, '2nd': 70, '3rd': 70, '4th': 70, '5th': 70,
  '6th': 80, '7th': 80, '8th': 80, '9th': 80, '10th': 80,
};

export type Gender = 'M' | 'F';

// Uniform item catalogue. `gendered` items price differently for boys/girls.
export interface UniformItemDef {
  key: string;
  name: string;
  gendered: boolean;
}
export const UNIFORM_ITEMS: UniformItemDef[] = [
  { key: 'school', name: 'School Uniform', gendered: true },
  { key: 'white', name: 'White Uniform', gendered: true },
  { key: 'tshirt', name: 'T-Shirt', gendered: false },
  { key: 'wed', name: 'Wednesday Uniform', gendered: false },
  { key: 'tie', name: 'Tie & Bow', gendered: false },
  { key: 'belt', name: 'Belt', gendered: false },
  { key: 'socks', name: 'Socks', gendered: false },
];

const UNIFORM_PRICE: Record<string, { B?: Record<ClassKey, Maybe>; G?: Record<ClassKey, Maybe>; ANY?: Record<ClassKey, Maybe> }> = {
  school: { B: UNIFORM_SCHOOL_BOY, G: UNIFORM_SCHOOL_GIRL },
  white: { B: UNIFORM_WHITE_BOY, G: UNIFORM_WHITE_GIRL },
  tshirt: { ANY: TSHIRT },
  wed: { ANY: WED_UNIFORM },
  tie: { ANY: TIE },
  belt: { ANY: BELT },
  socks: { ANY: SOCKS },
};

/** Price of a uniform item for a class + gender, or null if not applicable. */
export function uniformPrice(itemKey: string, classId: string, gender: Gender): number | null {
  const ck = CLASS_KEY_BY_ID[classId];
  if (!ck) return null;
  const table = UNIFORM_PRICE[itemKey];
  if (!table) return null;
  const col = table.ANY || (gender === 'F' ? table.G : table.B);
  return col ? col[ck] ?? null : null;
}

/** Uniform items applicable to a student, priced for their class + gender. */
export function uniformItemsFor(classId: string, gender: Gender): { key: string; name: string; price: number }[] {
  return UNIFORM_ITEMS
    .map((it) => ({ key: it.key, name: it.name, price: uniformPrice(it.key, classId, gender) }))
    .filter((it): it is { key: string; name: string; price: number } => it.price != null);
}

// ---- School-fee extras ----
/** Software & Marks Card & Quick Maths — ₹800 for 9th/10th, else ₹1600. */
export function softwareFee(classId: string): number {
  return classId === '9' || classId === '10' ? 800 : 1600;
}
export const ID_CARD_FEE = 120;        // optional per student
export const NEW_ADMISSION_FEE = 400;  // one-time; covers tie + belt + socks set

// ---- Van fee per village (annual) ----
export const VILLAGE_VAN_FEES: { village: string; fee: number }[] = [
  { village: 'Karenahalli', fee: 8300 },
  { village: 'Chaldiganahalli', fee: 8500 },
  { village: 'Padiganahalli', fee: 8700 },
  { village: 'Bellalli', fee: 8900 },
  { village: 'Channasandra', fee: 8900 },
  { village: 'Raghupati Agrahara', fee: 8900 },
  { village: 'Kadagatturu', fee: 9100 },
  { village: 'Byrandahalli', fee: 9200 },
  { village: 'Kamandahalli', fee: 9400 },
  { village: 'Harjenahalli', fee: 9600 },
  { village: 'Kurugal', fee: 9800 },
  { village: 'Maliyappanahalli', fee: 9800 },
  { village: 'Thippenahalli', fee: 8500 },
  { village: 'Kadalli', fee: 8900 },
  { village: 'Nachahalli', fee: 9200 },
  { village: 'Veerenahalli', fee: 9300 },
];
