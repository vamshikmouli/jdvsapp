// Ready-made WhatsApp templates the school can create in Meta with one click
// (Administration → WA Templates). Worded as UTILITY — a factual update about the
// parent's own child, no praise / encouragement / promotion — because Meta moves
// templates with marketing-style wording into the (paid, opt-out-able) MARKETING
// category. Each number is its own variable so the fixed text stays factual.

export interface WaTemplatePreset {
  key: string;
  name: string;               // Meta template name
  category: 'UTILITY';
  title: string;              // shown in the app
  usedFor: string;
  body: string;               // with {{n}} variables
  examples: string[];         // sample values for Meta's review, one per variable
  header: 'MONTHLY_CALENDAR'; // which sample image the app renders for review
}

export const MONTHLY_ATTENDANCE_TEMPLATE = 'monthly_attendance_report';

export const WA_TEMPLATE_PRESETS: WaTemplatePreset[] = [
  {
    key: 'monthly_attendance',
    name: MONTHLY_ATTENDANCE_TEMPLATE,
    category: 'UTILITY',
    title: 'Monthly attendance report',
    usedFor: 'Communications → Monthly attendance (calendar image + counts for each student)',
    body:
      'Dear {{1}},\n' +
      'This is the attendance report of {{2}} for {{3}}.\n\n' +
      'Present: {{4}} days\n' +
      'Absent: {{5}} days\n' +
      'Leave: {{6}} days\n' +
      'Attendance: {{7}}%\n\n' +
      'The day-wise attendance calendar is attached. For any correction, please contact the school office.',
    examples: ['Ramesh', 'ASHA', 'September 2025', '23', '1', '2', '96'],
    header: 'MONTHLY_CALENDAR',
  },
];
