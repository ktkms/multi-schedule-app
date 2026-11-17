import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseClient } from '@/lib/supabase';
import { formatIcsDate } from '@/lib/utils';
import { dateFirstCalendarResponse } from '@/lib/date-first-calendar-response';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ eventId: string }> },
) {
  try {
    const { eventId } = await params;
    const url = new URL(request.url);
    const requestedDateId = url.searchParams.get('dateId');

    // サーバーサイド用のSupabaseクライアントを初期化
    const supabase = createSupabaseClient();

    // イベント情報を取得
    const { data: event, error: eventError } = await supabase
      .from('events')
      .select('id, title, description, is_finalized, public_token, scheduling_mode')
      .eq('id', eventId)
      .single();

    if (eventError || !event || !event.is_finalized) {
      return new NextResponse('イベントが見つからないか、まだ確定されていません', {
        status: 404,
      });
    }

    if (event.scheduling_mode === 'date_first')
      return await dateFirstCalendarResponse(request, event.id, event.public_token, false);
    // 確定した日程の情報を取得（複数日程対応）
    // まずfinalized_datesテーブルから確定した日程IDを取得
    const { data: finalizedDates, error: finalizedError } = await supabase
      .from('finalized_dates')
      .select('event_date_id')
      .eq('event_id', eventId);

    if (finalizedError || !finalizedDates || finalizedDates.length === 0) {
      // 確定日程がfinalized_datesになければ、従来のfinal_date_idを検索
      const { data: eventWithFinalDate } = await supabase
        .from('events')
        .select('final_date_id')
        .eq('id', eventId)
        .single();

      // それでも確定日程がなければエラー
      if (!eventWithFinalDate?.final_date_id) {
        return new NextResponse('確定された日程が見つかりません', {
          status: 404,
        });
      }

      // 従来のfinal_date_idを使用
      const finalDateIds = [eventWithFinalDate.final_date_id];

      // 日程の詳細を取得
      const { data: finalDates, error: dateError } = await supabase
        .from('event_dates')
        .select('id, start_time, end_time, label')
        .in('id', finalDateIds);

      if (dateError || !finalDates || finalDates.length === 0) {
        return new NextResponse('日程情報が見つかりません', {
          status: 404,
        });
      }

      // ICSファイルの生成（単一日程）
      const totalCount = finalDates.length;
      let targetIndex = 0;
      let targetDate = finalDates[0];
      if (requestedDateId) {
        const idx = finalDates.findIndex((d) => d.id === requestedDateId);
        if (idx !== -1) {
          targetIndex = idx;
          targetDate = finalDates[idx];
        }
      }

      const icsContent = generateIcsContent({
        events: (requestedDateId ? [targetDate] : finalDates).map((date, index) => ({
          startDate: new Date(date.start_time),
          endDate: new Date(date.end_time),
          title:
            totalCount > 1
              ? `${event.title} (${requestedDateId ? targetIndex + 1 : index + 1}/${totalCount})`
              : event.title,
          description: event.description || '',
          eventId: `${event.id}-${date.id}`,
          // タイムゾーン情報を追加（日本時間として扱う）
          timezone: 'Asia/Tokyo',
        })),
      });

      // ファイル名に使用できるようにタイトルを整形
      const safeTitle = event.title.replace(/[^\w\s]/gi, '').trim() || 'event';

      // iCSファイルをダウンロード
      return new NextResponse(icsContent, {
        headers: {
          'Content-Type': 'text/calendar',
          'Content-Disposition': `attachment; filename="${safeTitle}.ics"`,
        },
      });
    } else {
      // 複数確定日程の処理
      const finalDateIds = finalizedDates.map((fd) => fd.event_date_id);

      // 複数の確定日程の詳細情報を取得
      const { data: finalDates, error: dateError } = await supabase
        .from('event_dates')
        .select('id, start_time, end_time, label')
        .in('id', finalDateIds);

      if (dateError || !finalDates || finalDates.length === 0) {
        return new NextResponse('日程情報が見つかりません', {
          status: 404,
        });
      }

      // 複数イベント用のICSファイルを生成
      const totalCount = finalDates.length;
      let targetIndex = 0;
      let targetDate = finalDates[0];
      if (requestedDateId) {
        const idx = finalDates.findIndex((d) => d.id === requestedDateId);
        if (idx !== -1) {
          targetIndex = idx;
          targetDate = finalDates[idx];
        }
      }

      const icsContent = generateIcsContent({
        events: (requestedDateId ? [targetDate] : finalDates).map((date, index) => ({
          startDate: new Date(date.start_time),
          endDate: new Date(date.end_time),
          title:
            totalCount > 1
              ? `${event.title} (${requestedDateId ? targetIndex + 1 : index + 1}/${totalCount})`
              : event.title,
          description: event.description || '',
          eventId: `${event.id}-${date.id}`,
        })),
      });

      // ファイル名に使用できるようにタイトルを整形
      const safeTitle = event.title.replace(/[^\w\s]/gi, '').trim() || 'event';

      // iCSファイルをダウンロード
      return new NextResponse(icsContent, {
        headers: {
          'Content-Type': 'text/calendar',
          'Content-Disposition': `attachment; filename="${safeTitle}.ics"`,
        },
      });
    }
  } catch (error) {
    console.error('カレンダーデータ生成エラー:', error);
    return new NextResponse('カレンダーデータの生成に失敗しました', {
      status: 500,
    });
  }
}

interface IcsEventProps {
  events: Array<{
    startDate: Date;
    endDate: Date;
    title: string;
    description: string;
    eventId: string;
  }>;
}

function generateIcsContent({ events }: IcsEventProps): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//MultiScheduleApp//JP',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VTIMEZONE',
    'TZID:Asia/Tokyo',
    'X-LIC-LOCATION:Asia/Tokyo',
    'BEGIN:STANDARD',
    'DTSTART:19700101T000000',
    'TZOFFSETFROM:+0900',
    'TZOFFSETTO:+0900',
    'TZNAME:JST',
    'END:STANDARD',
    'END:VTIMEZONE',
  ];

  // 複数のイベントをサポート
  events.forEach((event) => {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${event.eventId}@multischeduleapp.example.com`,
      // 生成日時は UTCで出したい場合は別途toISOString()系を使ってZ付き
      `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').split('.')[0]}Z`,
      // JST（Asia/Tokyo）として明示する
      `DTSTART;TZID=Asia/Tokyo:${formatIcsDate(event.startDate)}`,
      `DTEND;TZID=Asia/Tokyo:${formatIcsDate(event.endDate)}`,
      `SUMMARY:${escapeIcsValue(event.title)}`,
      `DESCRIPTION:${escapeIcsValue(event.description)}`,
      'END:VEVENT',
    );
  });

  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

// ICS用の特殊文字エスケープ
function escapeIcsValue(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}
