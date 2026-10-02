// Turns dictated speech into marks-entry actions, e.g.
//   "45 38 absent forty two next back"  →  num 45, num 38, ab, num 42, next, back
//   "roll 12 45"                         →  roll 12, num 45
//   "english 42" (with subject names)    →  subject <id>, num 42
// Speech engines return numbers as digits ("45") or words ("forty five"), and
// mishear small numbers as homophones ("for", "to", "ate") — all handled here.

export type VoiceAction =
  | { type: 'num'; n: number }
  | { type: 'ab' }
  | { type: 'next' }
  | { type: 'back' }
  | { type: 'clear' }
  | { type: 'stop' }
  | { type: 'roll'; n: number }
  | { type: 'subject'; id: string };

const UNITS: Record<string, number> = {
  zero: 0, oh: 0, nil: 0, one: 1, won: 1, two: 2, to: 2, too: 2, three: 3, tree: 3, four: 4, for: 4, fore: 4,
  five: 5, six: 6, seven: 7, eight: 8, ate: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13,
  fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
};
const TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fourty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
// Includes how phone speech engines (en-IN) commonly mis-hear each command.
const AB_WORDS = new Set(['absent', 'ab', 'abs', 'absentee', 'absence', 'absents', 'apsent']);
const NEXT_WORDS = new Set(['next', 'skip', 'blank', 'empty', 'nest', 'necks', 'text', 'nex', 'nexts']);
const BACK_WORDS = new Set(['back', 'previous', 'bag', 'pack', 'buck', 'bach', 'beck']);
const CLEAR_WORDS = new Set(['clear', 'delete', 'erase', 'remove', 'undo', 'wrong', 'clean', 'claire', 'clare', 'cleared']);
const STOP_WORDS = new Set(['stop', 'done', 'finish', 'finished']);
const ROLL_WORDS = new Set(['roll', 'role', 'rol', 'number', 'no']);

// Letters and digits only. Phone engines add punctuation ("Next.", "Back,") — without
// stripping it, commands were silently ignored on mobile.
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

export function parseVoice(text: string, subjects: { id: string; name: string }[] = []): VoiceAction[] {
  // "a b" → "ab"; "point" between numbers → decimal handled below.
  const words = text.toLowerCase().replace(/\b(a)\s+(b)\b/g, 'ab').split(/[\s,;]+/).map((w) => w.trim()).filter(Boolean);
  const subjectByWord = new Map<string, string>();
  for (const s of subjects) {
    const full = norm(s.name);
    if (full) subjectByWord.set(full, s.id);
    // First word too ("social" for "Social Science"), when it's unambiguous.
    const first = norm(s.name.split(/\s+/)[0] || '');
    if (first && first.length >= 3 && !subjects.some((o) => o.id !== s.id && norm(o.name.split(/\s+/)[0] || '') === first)) subjectByWord.set(first, s.id);
  }
  if (subjectByWord.has('maths') === false && subjects.some((s) => /math/i.test(s.name))) subjectByWord.set('maths', subjects.find((s) => /math/i.test(s.name))!.id);

  const out: VoiceAction[] = [];
  let i = 0;
  // Read one number starting at words[i] (digits, words, "forty five", "hundred", "4.5", "4 point 5").
  const readNumber = (): number | null => {
    const w = words[i];
    if (w === undefined) return null;
    // Digits, allowing trailing punctuation from phone engines ("45." / "45,").
    const bare = w.replace(/[.,;:!?%]+$/, '');
    const d = bare.replace(/[^0-9.]/g, '');
    if (d && /^[0-9]+(\.[0-9]+)?$/.test(d) && /^[0-9.]+$/.test(bare)) {
      i++;
      let n = Number(d);
      if (words[i] === 'point' && words[i + 1] !== undefined && /^[0-9]$/.test(words[i + 1]) ) { n = Number(`${d}.${words[i + 1]}`); i += 2; }
      return n;
    }
    const ww = norm(w);
    if (ww === 'hundred') { i++; return 100; }
    if (ww in TENS) {
      i++;
      let n = TENS[ww];
      const nx = words[i] !== undefined ? norm(words[i]) : '';
      if (nx in UNITS && UNITS[nx] >= 1 && UNITS[nx] <= 9) { n += UNITS[nx]; i++; }
      return n;
    }
    if (ww in UNITS) {
      i++;
      let n = UNITS[ww];
      if (words[i] !== undefined && norm(words[i]) === 'hundred') { n *= 100; i++; }
      else if (words[i] === 'point' && words[i + 1] !== undefined && norm(words[i + 1]) in UNITS) { n = Number(`${n}.${UNITS[norm(words[i + 1])]}`); i += 2; }
      return n;
    }
    return null;
  };

  while (i < words.length) {
    const w = words[i];
    const ww = norm(w);
    if (!ww && !/\d/.test(w)) { i++; continue; } // lone punctuation
    if (AB_WORDS.has(ww) || /^a\.?b\.?$/.test(w)) { out.push({ type: 'ab' }); i++; continue; }
    if (ww === 'go' && words[i + 1] !== undefined && BACK_WORDS.has(norm(words[i + 1]))) { out.push({ type: 'back' }); i += 2; continue; }
    if (NEXT_WORDS.has(ww)) { out.push({ type: 'next' }); i++; continue; }
    if (BACK_WORDS.has(ww)) { out.push({ type: 'back' }); i++; continue; }
    if (CLEAR_WORDS.has(ww)) { out.push({ type: 'clear' }); i++; continue; }
    if (STOP_WORDS.has(ww)) { out.push({ type: 'stop' }); i++; continue; }
    if (ROLL_WORDS.has(ww)) {
      i++;
      const n = readNumber();
      if (n !== null) out.push({ type: 'roll', n });
      continue;
    }
    // Two-word subject names ("social science") then single words.
    const two = words[i + 1] !== undefined ? norm(w + words[i + 1]) : '';
    if (two && subjectByWord.has(two)) { out.push({ type: 'subject', id: subjectByWord.get(two)! }); i += 2; continue; }
    if (subjectByWord.has(ww)) { out.push({ type: 'subject', id: subjectByWord.get(ww)! }); i++; continue; }
    const n = readNumber();
    if (n !== null) { out.push({ type: 'num', n }); continue; }
    i++; // filler word ("marks", "is", "and") — ignore
  }
  return out;
}

// Browser speech recognition (Chrome / Edge / Android Chrome / Safari 14.5+).
export function getSpeechRecognition(): any | null {
  if (typeof window === 'undefined') return null;
  const w = window as any;
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}
