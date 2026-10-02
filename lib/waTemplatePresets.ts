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
  header: 'MONTHLY_CALENDAR' | 'NONE'; // MONTHLY_CALENDAR = image header (the app renders a sample for review)
}

export const MONTHLY_ATTENDANCE_TEMPLATE = 'monthly_attendance_report';
export const ABSENCE_ALERT_TEMPLATE = 'student_absence_alert';

export const WA_TEMPLATE_PRESETS: WaTemplatePreset[] = [
  {
    key: 'monthly_attendance',
    name: MONTHLY_ATTENDANCE_TEMPLATE,
    category: 'UTILITY',
    title: 'Monthly attendance report',
    usedFor: 'Communications → Monthly attendance (calendar image + counts for each student)',
    // One item per line. WhatsApp shows only the first 2–3 lines under an image
    // ("Read more" hides the rest), so the % and Absent come first — no greeting /
    // blank line before them.
    body:
      'Attendance of {{1}} for {{2}}: {{3}}%\n' +
      'Absent: {{4}} days\n' +
      'Present: {{5}} days\n' +
      'Leave: {{6}} days\n\n' +
      'The day-wise attendance calendar is attached. For any correction, please contact the school office.',
    examples: ['ASHA', 'September 2025', '96', '1', '23', '2'],
    header: 'MONTHLY_CALENDAR',
  },
  {
    key: 'absence_alert',
    name: ABSENCE_ALERT_TEMPLATE,
    category: 'UTILITY',
    title: 'Student absent / on leave (same day)',
    usedFor: 'Student attendance — sent to parents when a class is submitted with the child absent or on leave',
    body:
      'Dear {{1}},\n' +
      'This is to inform you that {{2}} was marked {{3}} in school on {{4}}.\n\n' +
      'If this is not correct, or to share the reason, please contact the class teacher or the school office.',
    examples: ['Ramesh', 'ASHA', 'absent', '02 Oct 2026'],
    header: 'NONE',
  },
];
