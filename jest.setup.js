import { TextEncoder, TextDecoder } from 'util';
import { ReadableStream, WritableStream, TransformStream } from 'web-streams-polyfill';

// Jestセットアップ: Node.js環境でWeb APIのグローバルポリフィル

// TextEncoder/TextDecoderのポリフィル
if (typeof global.TextEncoder === 'undefined') {
  global.TextEncoder = TextEncoder;
  global.TextDecoder = TextDecoder;
}
// Web Streams APIのポリフィル
if (typeof global.ReadableStream === 'undefined') {
  global.ReadableStream = ReadableStream;
}
if (typeof global.WritableStream === 'undefined') {
  global.WritableStream = WritableStream;
}
if (typeof global.TransformStream === 'undefined') {
  global.TransformStream = TransformStream;
}

// JSDOM の未実装APIをモックしてテストログのノイズを抑制
if (typeof window !== 'undefined') {
  Object.defineProperty(window, 'scrollTo', {
    value: () => {},
    writable: true,
    configurable: true,
  });
}

// テスト環境向けの必須環境変数（未設定時のみ）
if (!process.env.SUPABASE_DB_URL) {
  process.env.SUPABASE_DB_URL = 'postgresql://postgres:postgres@localhost:5432/postgres';
}
if (!process.env.NEXTAUTH_SECRET) {
  process.env.NEXTAUTH_SECRET = 'test-secret';
}
if (!process.env.GOOGLE_CLIENT_ID) {
  process.env.GOOGLE_CLIENT_ID = 'test-client-id';
}
if (!process.env.GOOGLE_CLIENT_SECRET) {
  process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
}
// PointerEvent ポリフィル
if (typeof global.PointerEvent === 'undefined') {
  class PointerEventPolyfill extends MouseEvent {
    constructor(type, params = {}) {
      super(type, params);
      this.pointerId = params.pointerId ?? 0;
      this.pointerType = params.pointerType ?? 'mouse';
      this.isPrimary = params.isPrimary ?? true;
    }
  }
  global.PointerEvent = PointerEventPolyfill;
}
// Requestの簡易モック（API Route/Next.js用）
if (typeof global.Request === 'undefined') {
  global.Request = class {
    constructor(input, init) {
      this.url = typeof input === 'string' ? input : input && input.url;
      this.method = (init && init.method) || 'GET';
      this.headers = (init && init.headers) || {};
      this.body = init && init.body;
    }
  };
}
// Responseのポリフィルは削除（API Routeテストで個別にモック）

// JSDOM: HTMLFormElement.prototype.requestSubmit ポリフィル
if (
  typeof HTMLFormElement !== 'undefined' &&
  typeof HTMLFormElement.prototype.requestSubmit !== 'function'
) {
  HTMLFormElement.prototype.requestSubmit = function (submitter) {
    // submitterが指定された場合はsubmitイベントを発火
    if (submitter) {
      const evt = new Event('submit', { bubbles: true, cancelable: true });
      submitter.dispatchEvent(evt);
    } else {
      this.submit();
    }
  };
}

// --- JSDOMのrequestSubmit未実装対策（全テスト共通で必ず定義）
if (typeof window !== 'undefined' && !window.HTMLFormElement.prototype.requestSubmit) {
  window.HTMLFormElement.prototype.requestSubmit = function () {
    this.submit();
  };
}

// jsdom の `window.scrollTo` は実装が未完成で呼び出すと例外になることがあるため、
// テスト実行時は安全なスタブ実装で上書きする
if (typeof window !== 'undefined') {
  // 常に上書きして Not implemented エラーを防止
  window.scrollTo = function () {};
}
