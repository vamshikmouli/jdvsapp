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
});
