import 'server-only';
import { NextResponse } from 'next/server';
import { readDateFirstEvent } from './date-first-service';
import { dateFirstCalendarEntries, dateFirstGoogleUrl, dateFirstIcs } from './date-first-calendar';

/** 新方式のカレンダー出力を公開URLに限定し、別候補へのフォールバックはしない。 */
export async function dateFirstCalendarResponse(
  request: Request,
  eventId: string,
  publicToken: string,
  google: boolean,
) {
  const url = new URL(request.url);
  if (url.searchParams.get('token') !== publicToken)
    return new NextResponse('イベントが見つかりません', { status: 404 });
  const data = await readDateFirstEvent(publicToken);
  if (!data || data.event.id !== eventId)
    return new NextResponse('イベントが見つかりません', { status: 404 });
  const entries = dateFirstCalendarEntries(data),
    dateId = url.searchParams.get('dateId');
  const selected = dateId ? entries.filter((entry) => entry.id === dateId) : entries;
  if (selected.length === 0)
    return new NextResponse('確定された日程が見つかりません', { status: 404 });
  if (google)
    return NextResponse.redirect(dateFirstGoogleUrl(selected[0], data.event.description), {
      headers: { 'Referrer-Policy': 'no-referrer', 'Cache-Control': 'private, no-store' },
    });
  return new NextResponse(dateFirstIcs(selected, data.event.description), {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'attachment; filename="daysynth.ics"',
      'Cache-Control': 'private, no-store',
      'Referrer-Policy': 'no-referrer',
    },
  });
}
