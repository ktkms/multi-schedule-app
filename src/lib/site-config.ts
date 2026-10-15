// サービス名やロゴに関する設定を一元管理するファイル
interface SiteConfig {
  url: string;
  ogImage: string;
  illustrations: {
    hero: string;
    heroDark: string;
  };
  // サービス名の設定
  name: {
    full: string; // 完全なサービス名
    short: string; // 省略形
    tagline: string; // キャッチフレーズ/サブタイトル
  };
  // メタデータ設定
  meta: {
    title: string; // ページタイトル (SEO用)
    description: string; // サイト説明 (SEO用)
    themeColor: string; // テーマカラー (マニフェスト用)
    keywords?: string; // 検索キーワード (SEO用)
  };
  // OGP と共有文言の設定
  share: {
    homeTitle: string; // LP共有時のタイトル
    homeDescription: string; // LP共有時の説明文
    defaultTitle: string; // 汎用共有タイトル
    defaultText: string; // 汎用共有本文
    eventTitleSuffix: string; // イベント共有タイトル末尾
    eventText: string; // イベント回答依頼の共有本文
    finalizedEventText: string; // 確定済みイベントの共有本文
    availableDatesTitle: string; // 共通日程共有タイトル
  };
  // ロゴ設定
  logo: {
    main: string; // メインロゴのパス
    icon: string; // アイコン（ファビコン）のパス
    svg: string; // SVGロゴのパス（ヘッダーなどで使用）
    alt: string; // ロゴの代替テキスト
  };
  // 著作権情報
  copyright: {
    year: number | string; // 著作権の年（数値または文字列）
    holder: string; // 著作権者名
  };
}

// サービス設定
const siteConfig: SiteConfig = {
  name: {
    full: 'DaySynth',
    short: 'DaySynth',
    tagline: 'みんなの予定が、すぐ決まる。',
  },
  meta: {
    title: 'DaySynth（デイシンス／でいしんす） - みんなの予定がすぐ決まる日程調整',
    description:
      'DaySynth（デイシンス／でいしんす）は、参加者それぞれの予定を重ねて、集まれる候補を見つける日程調整アプリです。候補作成、共有、回答、確定までをシンプルに進められます。回答はログイン不要・無料。',
    themeColor: '#6366f1',
    keywords:
      'DaySynth, デイシンス, でいしんす, daysynth, 日程調整, スケジュール調整, 候補日, 予定の重なり, バンド練習, ゲーム会, 会議, イベント, カレンダー, 無料, ログイン不要, 簡単, シンプル, グループ, スケジュール',
  },
  share: {
    homeTitle: 'DaySynth｜みんなの予定がすぐ決まる日程調整',
    homeDescription:
      '候補を作って、リンクを送るだけ。参加者の回答を見ながら、集まれる日を決められる日程調整アプリです。',
    defaultTitle: 'DaySynthで日程調整',
    defaultText: 'DaySynthで候補日を重ねて、集まれる日を見つけましょう。',
    eventTitleSuffix: 'DaySynthで日程調整',
    eventText: 'DaySynthで候補日を共有しています。都合のよい予定を入力してください。',
    finalizedEventText: 'DaySynthで確定した日程です。内容を確認してください。',
    availableDatesTitle: 'DaySynthで共通日程を共有',
  },
  logo: {
    main: '/logo/favicon.svg', // メインロゴ（すでに設定されているパス）
    icon: '/logo/favicon.ico', // アイコン（ファビコン）
    svg: '/logo/favicon.svg', // SVGロゴ（ヘッダーで使用）
    alt: '複数日程調整アプリ',
  },
  copyright: {
    year: new Date().getFullYear(),
    holder: 'DaySynth',
  },
  url: 'https://daysynth.k-tkms.com/',
  ogImage: '/logo/web-app-manifest-512x512.png',
  illustrations: {
    hero: '/images/landing/daysynth-layered-availability-transparent-light.webp',
    heroDark: '/images/landing/daysynth-layered-availability-dark-matte.webp',
  },
};

export default siteConfig;
