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
  {
    key: 'absence_alert',
    name: ABSENCE_ALERT_TEMPLATE,
    category: 'UTILITY',
    title: 'Student absent / on leave (same day)',
    usedFor: 'Student attendance — sent to parents when a class is submitted with the child absent or on leave',
    // One paragraph, no line breaks: WhatsApp folds messages that take up many
    // lines behind "Read more", even short ones.
    body: 'Dear {{1}}, this is to inform you that {{2}} was marked {{3}} in school on {{4}}. For any queries, please contact the school office. Thank you.',
    examples: ['Ramesh', 'ASHA', 'absent', '02 Oct 2026'],
    header: 'NONE',
  },
];
