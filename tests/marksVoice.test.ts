import { describe, it, expect } from 'vitest';
import { parseVoice } from '@/lib/marksVoice';

const subs = [
  { id: 'kan', name: 'Kannada' }, { id: 'eng', name: 'English' }, { id: 'mat', name: 'Mathematics' },
  { id: 'ss', name: 'Social Science' }, { id: 'evs', name: 'EVS' },
];

describe('parseVoice — dictated marks', () => {
  it('reads digit strings in sequence', () => {
    expect(parseVoice('45 38 42')).toEqual([{ type: 'num', n: 45 }, { type: 'num', n: 38 }, { type: 'num', n: 42 }]);
  });
  it('reads number words incl. tens + units and hundred', () => {
    expect(parseVoice('forty five thirty eight hundred zero')).toEqual([
      { type: 'num', n: 45 }, { type: 'num', n: 38 }, { type: 'num', n: 100 }, { type: 'num', n: 0 },
    ]);
  });
  it('maps common homophones of small numbers', () => {
    expect(parseVoice('for to ate')).toEqual([{ type: 'num', n: 4 }, { type: 'num', n: 2 }, { type: 'num', n: 8 }]);
  });
  it('handles decimals', () => {
    expect(parseVoice('4.5 seven point five')).toEqual([{ type: 'num', n: 4.5 }, { type: 'num', n: 7.5 }]);
  });
  it('understands commands', () => {
    expect(parseVoice('absent next back clear stop').map((a) => a.type)).toEqual(['ab', 'next', 'back', 'clear', 'stop']);
    expect(parseVoice('a b')).toEqual([{ type: 'ab' }]);
  });
  it('jumps to a roll number', () => {
    expect(parseVoice('roll 12 45')).toEqual([{ type: 'roll', n: 12 }, { type: 'num', n: 45 }]);
    expect(parseVoice('roll number twelve forty')).toEqual([{ type: 'roll', n: 12 }, { type: 'num', n: 40 }]);
  });
  it('recognises subject names (one and two words, maths)', () => {
    expect(parseVoice('english 42 maths 38 social science 40', subs)).toEqual([
      { type: 'subject', id: 'eng' }, { type: 'num', n: 42 },
      { type: 'subject', id: 'mat' }, { type: 'num', n: 38 },
      { type: 'subject', id: 'ss' }, { type: 'num', n: 40 },
    ]);
  });
  it('ignores filler words', () => {
    expect(parseVoice('marks is 45 and 38')).toEqual([{ type: 'num', n: 45 }, { type: 'num', n: 38 }]);
  });
  it('ignores punctuation phones add ("Next." "Back," "45.")', () => {
    expect(parseVoice('Next. Back, Clear. 45. Absent.').map((a) => a.type)).toEqual(['next', 'back', 'clear', 'num', 'ab']);
    expect(parseVoice('45.')).toEqual([{ type: 'num', n: 45 }]);
  });
  it('understands common mis-hearings of the commands', () => {
    expect(parseVoice('nest bag clean absence').map((a) => a.type)).toEqual(['next', 'back', 'clear', 'ab']);
    expect(parseVoice('go back').map((a) => a.type)).toEqual(['back']);
  });
});

describe('parseVoice — grades (grade-only subjects)', () => {
  const g = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2', 'D', 'E'];
  it('reads grade labels spoken as one token or letter + number', () => {
    expect(parseVoice('A1 a two B. 1 bee two see one D', [], g)).toEqual([
      { type: 'grade', label: 'A1' }, { type: 'grade', label: 'A2' }, { type: 'grade', label: 'B1' },
      { type: 'grade', label: 'B2' }, { type: 'grade', label: 'C1' }, { type: 'grade', label: 'D' },
    ]);
  });
  it('handles plus / minus scales and keeps numbers as numbers', () => {
    expect(parseVoice('a plus b 45', [], ['A+', 'A', 'B+', 'B'])).toEqual([
      { type: 'grade', label: 'A+' }, { type: 'grade', label: 'B' }, { type: 'num', n: 45 },
    ]);
  });
  it('absent still wins over the letter A', () => {
    expect(parseVoice('absent a b', [], g).map((a) => a.type)).toEqual(['ab', 'ab']);
  });
  it('without a grade scale, letters are ignored as before', () => {
    expect(parseVoice('a one 45')).toEqual([{ type: 'num', n: 1 }, { type: 'num', n: 45 }]);
  });
});
