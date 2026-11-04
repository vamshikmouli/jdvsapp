import { redirect } from 'next/navigation';

// Who's where — the live building board: which teacher is in which room right now, and
// who is free. Meant for a staffroom TV. The board itself is public/whos-where.html
// (generated from the timetable app's board, see sync_board_to_erp.py there); it reads the
// published timetable from /api/timetable. It is opened directly rather than in an iframe
// because the site-wide frame-ancestors 'none' / X-Frame-Options: DENY headers block framing.
export default function WhosWherePage() {
  redirect('/whos-where.html');
}
