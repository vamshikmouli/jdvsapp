// Who's where — the live building board: which teacher is in which room right now, and
// who is free. Meant for a staffroom TV, so it runs full-screen (see app/admin/layout.tsx).
// The board itself is public/whos-where.html (generated from the timetable app's board,
// see sync_board_to_erp.py there); it reads the published timetable from /api/timetable.
export default function WhosWherePage() {
  return <iframe src="/whos-where.html" title="Who's where" allowFullScreen className="block w-screen h-screen border-0" />;
}
