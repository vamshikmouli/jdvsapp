import { NextResponse } from 'next/server';
import { getRequestUserId } from '@/lib/auth/mobileSession';
import { birthdayWishesForUser, istTodayKey, wishText } from '@/lib/birthdays';

export const dynamic = 'force-dynamic';

// GET /api/birthdays/me → today's birthday wishes for the signed-in user (their own as
// staff, their children's as a parent). Drives the greeting popup on web + mobile.
export async function GET() {
  try {
    const userId = await getRequestUserId();
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const todayKey = istTodayKey();
    const { wishes, schoolName } = await birthdayWishesForUser(userId, todayKey);
    // Same wording as the push, so the popup and the notification match.
    return NextResponse.json({ todayKey, schoolName, wishes: wishes.map((w) => ({ ...w, ...wishText(w, schoolName) })) });
  } catch (err) {
    console.error('birthdays/me', err);
    return NextResponse.json({ error: 'Failed to load' }, { status: 500 });
  }
}
