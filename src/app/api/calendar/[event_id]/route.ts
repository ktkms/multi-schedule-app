import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseClient } from '@/lib/supabase';
import { formatIcsDate } from '@/lib/utils';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import { dateFirstCalendarResponse } from '@/lib/date-first-calendar-response';

// Extend dayjs with plugins
dayjs.extend(utc);
dayjs.extend(timezone);

// Next.js 15.3.1のAPIルートハンドラの形式に合わせる
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ event_id: string }> },
) {
  try {
    const { event_id: eventId } = await params;
    const url = new URL(request.url);
    const isGoogleCalendar = url.searchParams.get('googleCalendar') === 'true';
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
      return await dateFirstCalendarResponse(
        request,
        event.id,
        event.public_token,
        isGoogleCalendar,
      );
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

      // Google Calendar URLの生成
      if (isGoogleCalendar) {
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

        const startDate = new Date(targetDate.start_time);
        const endDate = new Date(targetDate.end_time);

        const googleParams = new URLSearchParams({
          action: 'TEMPLATE',
          text: totalCount > 1 ? `${event.title} (${targetIndex + 1}/${totalCount})` : event.title,
          details: event.description || '',
          dates: `${formatGoogleDate(startDate)}/${formatGoogleDate(endDate)}`,
          ctz: 'Asia/Tokyo', // タイムゾーンを明示
        });

        // Google Calendarリンクにリダイレクト
        return NextResponse.redirect(
          `https://calendar.google.com/calendar/render?${googleParams.toString()}`,
        );
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

      // Google Calendar URLの生成
      if (isGoogleCalendar) {
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

        const startDate = new Date(targetDate.start_time);
        const endDate = new Date(targetDate.end_time);

        const googleParams = new URLSearchParams({
          action: 'TEMPLATE',
          text: totalCount > 1 ? `${event.title} (${targetIndex + 1}/${totalCount})` : event.title,
          details: event.description || '',
          dates: `${formatGoogleDate(startDate)}/${formatGoogleDate(endDate)}`,
          ctz: 'Asia/Tokyo', // タイムゾーンを明示
        });

        // Google Calendarリンクにリダイレクト
        return NextResponse.redirect(
          `https://calendar.google.com/calendar/render?${googleParams.toString()}`,
        );
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
  const now = new Date();
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//MultiScheduleApp//JP',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
  ];

  // 複数のイベントをサポート
  events.forEach((event) => {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${event.eventId}@multischeduleapp.example.com`,
      `DTSTAMP:${formatIcsDate(now)}`,
      `DTSTART:${formatIcsDate(event.startDate)}`,
      `DTEND:${formatIcsDate(event.endDate)}`,
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

// Google Calendar用の日付フォーマット（YYYYMMDDTHHMMSS形式、Zなしローカルタイム）
function formatGoogleDate(date: Date): string {
  // 入力値をそのままローカルタイムで出力
  return dayjs(date).format('YYYYMMDDTHHmmss');
}
