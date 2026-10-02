// Student address in the Aadhaar-card style, built from the profile fields:
//   S/O: Ramesh Kumar,
//   Hosahalli, Kunigal (T),
//   Tumakuru (D), Karnataka
// S/O (son of) / D/O (daughter of) comes from gender + father's name; with no father's
// name the guardian is used as C/O (care of). Empty parts are skipped.

export interface AddressParts {
  gender?: string | null;
  fatherName?: string | null;
  guardianName?: string | null;
  village?: string | null;
  taluk?: string | null;
  district?: string | null;
}

const STATE = 'Karnataka';
const t = (s?: string | null) => (s || '').trim();

export function buildAddress(p: AddressParts): string {
  const father = t(p.fatherName);
  const guardian = t(p.guardianName);
  const careOf = father ? `${p.gender === 'F' ? 'D/O' : 'S/O'}: ${father}` : guardian ? `C/O: ${guardian}` : '';
  const village = t(p.village), taluk = t(p.taluk), district = t(p.district);
  if (!village && !taluk && !district) return '';
  const place = [village, taluk ? `${taluk} (T)` : ''].filter(Boolean).join(', ');
  const region = [district ? `${district} (D)` : '', STATE].filter(Boolean).join(', ');
  return [careOf, place, region].filter(Boolean).join(',\n');
}
