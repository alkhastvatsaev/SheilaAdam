import { NextResponse } from 'next/server';
import webpush from 'web-push';

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || 'BNJYNHCV6iuyIXXAryAV2D7f6b3HZocIK_yPm9PJaWOnx0RlYYP_QDAeGGqzwDpWrDYYQNlaN8RYy2i422b6u2I';
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || 'afKK92J5-MiSck6S5z_V86_EDsTbuOc0P3J5Xrrj8-M';

webpush.setVapidDetails(
  'mailto:example@yourdomain.com',
  VAPID_PUBLIC_KEY,
  VAPID_PRIVATE_KEY
);

export async function POST(request: Request) {
  const { subscription, title, body, url } = await request.json();

  try {
    await webpush.sendNotification(
      subscription,
      JSON.stringify({ title, body, url })
    );
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error sending notification:', error);
    return NextResponse.json({ success: false, error: 'Failed to send notification' }, { status: 500 });
  }
}
