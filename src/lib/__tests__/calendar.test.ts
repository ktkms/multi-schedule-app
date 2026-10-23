// jsdomのrequestSubmit未実装対策
if (!HTMLFormElement.prototype.requestSubmit) {
  HTMLFormElement.prototype.requestSubmit = function () {
    this.submit();
  };
}

import { NextRequest } from 'next/server';
import { generateGoogleCalendarUrl } from '../utils';
import { createSupabaseClient } from '@/lib/supabase';

jest.mock('@/lib/supabase');
const mockedCreateSupabaseClient = createSupabaseClient as jest.Mock;

// Jest環境用の簡易Responseクラスをグローバル定義
if (typeof global.Response === 'undefined') {
  class TestResponse {
    status: number;
    _text: string;
    _headers: Record<string, string>;
    ok = true;
    redirected = false;
    statusText = '';
    type = 'basic';
    url = '';
    constructor(
      text: string,
      { status = 200, headers = {} as Record<string, string> | Headers } = {},
    ) {
      this.status = status;
      this._text = text;
      // keyを小文字化して格納
      this._headers = {};
      if (typeof (headers as Headers).forEach === 'function') {
        (headers as Headers).forEach((v: string, k: string) => {
          this._headers[k.toLowerCase()] = v;
        });
      } else {
        const obj = headers as Record<string, string>;
        for (const k in obj) {
          if (Object.prototype.hasOwnProperty.call(obj, k)) {
            this._headers[k.toLowerCase()] = obj[k];
          }
        }
      }
    }
    text() {
      return Promise.resolve(this._text);
    }
    get headers() {
      return {
        get: (key: string) => {
          return this._headers[key.toLowerCase()] || '';
        },
      };
    }
    // 型エラー回避のためダミーのstaticメソッドを追加
    static error(_?: unknown) {
      return undefined;
    }
    static json(_?: unknown, __?: unknown) {
      return undefined;
    }
    static redirect(_?: unknown, __?: unknown) {
      return undefined;
    }
  }
  // @ts-expect-error Jest用のResponseモックのため型不一致を許容
  global.Response = TestResponse;
}

// 旧 `/api/generate-ics` は廃止。ICSは `/api/calendar/ics/[eventId]` を使用します。

describe('generateGoogleCalendarUrl', () => {
  it('正しいGoogleカレンダーURLが生成される', () => {
    const url = generateGoogleCalendarUrl({
      title: 'テストイベント',
      start: '2025-05-10T10:00:00Z',
      end: '2025-05-10T11:00:00Z',
      description: '説明文',
      location: '東京駅',
    });
    const calendarUrl = new URL(url);
    expect(calendarUrl.origin).toBe('https://calendar.google.com');
    expect(calendarUrl.pathname).toBe('/calendar/r/eventedit');
    expect(url).toContain('text=%E3%83%86%E3%82%B9%E3%83%88%E3%82%A4%E3%83%99%E3%83%B3%E3%83%88');
    expect(url).toContain('dates=20250510T100000Z%2F20250510T110000Z');
    expect(url).toContain('details=%E8%AA%AC%E6%98%8E%E6%96%87');
    expect(url).toContain('location=%E6%9D%B1%E4%BA%AC%E9%A7%85');
  });

  it('日本語や特殊文字もURLエンコードされる', () => {
    const url = generateGoogleCalendarUrl({
      title: '会議 & 打合せ',
      start: '2025-12-01T09:30:00Z',
      end: '2025-12-01T10:30:00Z',
      description: '詳細: テスト\n改行もOK',
      location: '大阪・梅田',
    });
    // +と%20の違いを許容するため正規表現で判定
    expect(url).toMatch(
      new RegExp(encodeURIComponent('会議 & 打合せ').replace(/%20/g, '(\\+|%20)')),
    );
    expect(url).toMatch(
      new RegExp(encodeURIComponent('詳細: テスト\n改行もOK').replace(/%20/g, '(\\+|%20)')),
    );
    expect(url).toMatch(new RegExp(encodeURIComponent('大阪・梅田').replace(/%20/g, '(\\+|%20)')));
    expect(url).toContain('dates=20251201T093000Z%2F20251201T103000Z');
  });

  it('省略パラメータも問題なく生成される', () => {
    const url = generateGoogleCalendarUrl({
      title: 'タイトルのみ',
      start: '2025-01-01T00:00:00Z',
      end: '2025-01-01T01:00:00Z',
    });
    expect(url).toContain('text=%E3%82%BF%E3%82%A4%E3%83%88%E3%83%AB%E3%81%AE%E3%81%BF');
    expect(url).toContain('dates=20250101T000000Z%2F20250101T010000Z');
  });
});

describe('/api/calendar/[event_id]/route.ts', () => {
  const createRequest = (url: string) => ({ url }) as NextRequest;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('複数確定日程のタイトルが連番で生成される', async () => {
    const fromMock = jest
      .fn()
      .mockReturnValueOnce({
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({
          data: {
            id: 'eid',
            title: '複数テスト',
            description: 'desc',
            is_finalized: true,
            public_token: 'token',
          },
          error: null,
        }),
      })
      .mockReturnValueOnce({
        select: jest.fn().mockReturnThis(),
        eq: jest.fn(() =>
          Promise.resolve({
            data: [{ event_date_id: 'd1' }, { event_date_id: 'd2' }],
            error: null,
          }),
        ),
      })
      .mockReturnValueOnce({
        select: jest.fn().mockReturnThis(),
        in: jest.fn(() =>
          Promise.resolve({
            data: [
              {
                id: 'd1',
                start_time: '2025-05-10T10:00:00Z',
                end_time: '2025-05-10T11:00:00Z',
                label: '',
              },
              {
                id: 'd2',
                start_time: '2025-05-11T10:00:00Z',
                end_time: '2025-05-11T11:00:00Z',
                label: '',
              },
            ],
            error: null,
          }),
        ),
      });
    mockedCreateSupabaseClient.mockReturnValue({ from: fromMock });

    const { GET: calendarGET } = await import('@/app/api/calendar/[event_id]/route');
    const res = await calendarGET(createRequest('http://localhost/api/calendar/eid'), {
      params: Promise.resolve({ event_id: 'eid' }),
    });

    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toMatch(/SUMMARY:複数テスト \(1\/2\)/);
    expect(text).toMatch(/SUMMARY:複数テスト \(2\/2\)/);
  });

  it('Googleカレンダーリンクに連番が付与される', async () => {
    const fromMock = jest
      .fn()
      .mockReturnValueOnce({
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({
          data: {
            id: 'eid',
            title: '複数テスト',
            description: 'desc',
            is_finalized: true,
            public_token: 'token',
          },
          error: null,
        }),
      })
      .mockReturnValueOnce({
        select: jest.fn().mockReturnThis(),
        eq: jest.fn(() =>
          Promise.resolve({
            data: [{ event_date_id: 'd1' }, { event_date_id: 'd2' }],
            error: null,
          }),
        ),
      })
      .mockReturnValueOnce({
        select: jest.fn().mockReturnThis(),
        in: jest.fn(() =>
          Promise.resolve({
            data: [
              {
                id: 'd1',
                start_time: '2025-05-10T10:00:00Z',
                end_time: '2025-05-10T11:00:00Z',
                label: '',
              },
              {
                id: 'd2',
                start_time: '2025-05-11T10:00:00Z',
                end_time: '2025-05-11T11:00:00Z',
                label: '',
              },
            ],
            error: null,
          }),
        ),
      });
    mockedCreateSupabaseClient.mockReturnValue({ from: fromMock });

    const { GET: calendarGET } = await import('@/app/api/calendar/[event_id]/route');
    const res = await calendarGET(
      createRequest('http://localhost/api/calendar/eid?googleCalendar=true&dateId=d2'),
      { params: Promise.resolve({ event_id: 'eid' }) },
    );

    expect(res.status).toBe(307);
    const location = res.headers.get('location') || '';
    const url = new URL(location);
    expect(url.searchParams.get('text')).toBe('複数テスト (2/2)');
  });
});
