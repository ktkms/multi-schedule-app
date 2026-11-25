# GA4 計測設計

## 目的と範囲

DaySynth の公開フローで、利用者がどの段階まで進み、どの操作が成功したかを集計する。対象はブラウザから Google Analytics 4 へ送るページビューと操作イベントであり、イベントや回答の正確な件数をデータベースから集計する仕組みは含めない。

実装は `src/components/analytics/google-analytics.tsx` の型付き allowlist を中心に行う。GA4 用の追加 SDK は導入せず、Google tag の `gtag.js` を利用する。測定 ID が未設定の場合と開発環境では送信しない。送信失敗は画面操作や認証処理へ伝播させない。

## ページビューとプライバシー

初期化時と App Router のパス遷移時に、次の安全なコンテキストを明示して `page_view` を送る。`send_page_view: false` を指定し、ブラウザ履歴の自動ページビューとの二重計測を避ける。

- `page_path` と `page_location` はクエリを除外する。
- イベント URL の公開トークンは `[public_id]` に置き換え、`/input` など許可した子パスを維持する。公開トークンや `participant_id` などのクエリパラメータは送らない。
- 既知の静的ルートだけをそのまま送る。allowlist 外のパスは `/unknown` に固定するため、404 などの任意パスも送らない。
- `page_title` は固定された画面名の allowlist から生成する。初期 inline config では安全な固定値 `DaySynth` を使う。
- 同一オリジンの `page_referrer` はサニタイズ済みの画面パスへ置き換え、外部リファラーはオリジンだけにする。値がない、または不正な場合は明示的に空文字を送る。
- カスタムイベントにも同じページコンテキストを付け、自由な URL、タイトル、入力値をパラメータとして受け付けない。

カレンダー URL に含まれ得る日付やタイトルの送信と、ページビューの二重計測を避けるため、GA4 の拡張計測で次の項目を無効にする。

- ブラウザ履歴の変更に基づくページビュー
- 離脱クリック
- サイト内検索
- フォーム操作

必要な集計にはアプリが送る allowlist イベントと手動の `page_view` を使う。タグ読み込み時の自動 `page_view` は、アプリの `send_page_view: false` で抑止する。

## イベント契約

イベント名は固定し、追加パラメータは `google-analytics.tsx` の型、allowlist、GA4 のカスタム定義を同時に更新する。真偽値は GA4 レポートで扱いやすい `yes` または `no` に正規化する。

| イベント                     | 発火条件                                                               | パラメータ                                                                                          |
| ---------------------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `create_started`             | 作成ウィザードを表示したとき。1マウントにつき1回                       | なし                                                                                                |
| `create_step_completed`      | 作成ウィザードの入力検証に成功して次へ進んだとき。ステップごとに1回    | `step`、任意の `input_mode`                                                                         |
| `event_created`              | `createEvent` が成功し、公開トークンを受け取った後、リダイレクトする前 | `input_mode`、`interval_unit`                                                                       |
| `answer_started`             | 新規回答フローを表示したとき。編集では送らない                         | `auth_state`（フロー開始時）                                                                        |
| `answer_step_completed`      | 新規回答で入力検証に成功して次へ進んだとき。ステップごとに1回          | `step`、`auth_state`（フロー開始時）、週入力を経由する `weekly` / `availability` では `weekly_used` |
| `answer_submitted`           | 新規回答の保存が成功したとき                                           | `auth_state`（保存完了時）、`weekly_used`                                                           |
| `answer_edited`              | 既存回答の保存が成功したとき                                           | `auth_state`（保存完了時）、`weekly_used`                                                           |
| `share`                      | Web Share、クリップボード、fallback の共有処理が成功したとき           | `method`、`content_type`                                                                            |
| `finalize_started`           | 確定ウィザードを表示したとき。1マウントにつき1回                       | `has_existing_finalization`                                                                         |
| `event_finalized`            | 現在未確定のイベントを1件以上で保存したとき                            | `selection_count`                                                                                   |
| `event_finalization_updated` | 既存の確定日程がある状態で保存したとき（同じ選択の保存も含む）         | `selection_count`                                                                                   |
| `event_unfinalized`          | 確定済み日程を空にする保存が成功したとき                               | なし                                                                                                |
| `login`                      | NextAuth の Google OAuth 成功イベント後に短命マーカーを1回消費したとき | `method=Google`                                                                                     |

`create_step_completed.step` は `event_info`、`input_mode`、`candidate_settings`、`manual_calendar`、`confirmation`、`answer_step_completed.step` は `name`、`weekly`、`availability` に限定する。戻る操作で同じステップを再表示しても、同じマウント内では完了イベントを再送しない。スキップされた週入力や名前入力のステップにはイベントを送らない。

`weekly_used` は週入力画面を開いたかではなく、曜日一括操作によって回答の日付選択が実際に変更されたかを表す。`auth_state` は開始イベントでは開始時点、保存イベントでは保存完了時点を使う。認証状態の再水和だけでは `login` を送らない。

共有は成功した方式だけを送る。ユーザーが Web Share をキャンセルした場合、クリップボード API が失敗した場合、fallback のコピーが `false` を返した場合は `share` を送らない。`content_type` は通常のイベント詳細を `event`、確定済み日程を `finalized`、共通日程を `available_dates` とする。

確定状態は現在の画面で判定する。空の状態から保存した場合は `event_finalized`、既存の確定状態から保存した場合は `event_finalization_updated`、空に戻した場合は `event_unfinalized` である。一度解除した後の再確定も、現在が空なら `event_finalized` になる。このイベントはサービス全期間での初回確定を表さず、履歴用の DB カラムや追加クエリは設けない。

## パラメータと管理画面

アプリ側で利用するパラメータは次のとおり。`mode` はイベント名（`answer_submitted` / `answer_edited`）で識別できるため登録しない。

| パラメータ                  | 値                                                                 |
| --------------------------- | ------------------------------------------------------------------ |
| `input_mode`                | `auto` / `manual`                                                  |
| `interval_unit`             | `10` / `30` / `60` / `120` / `180` / `360` / `other`               |
| `auth_state`                | `authenticated` / `guest`                                          |
| `step`                      | イベント表で定義したステップ値                                     |
| `weekly_used`               | `yes` / `no`                                                       |
| `method`                    | 共有は `web_share` / `clipboard` / `fallback`、ログインは `Google` |
| `content_type`              | `event` / `finalized` / `available_dates`                          |
| `has_existing_finalization` | `yes` / `no`                                                       |
| `selection_count`           | 選択した確定日程数（数値）                                         |

GA4 管理画面では `input_mode`、`interval_unit`、`auth_state`、`step`、`weekly_used`、`has_existing_finalization` をイベントスコープのカスタムディメンションとして登録し、`selection_count` をイベントスコープのカスタム指標として登録する。`method` と `content_type` は同名の標準ディメンションで参照できるため、重複するカスタム定義は作成しない。

キーイベントは `event_created`、`answer_submitted`、`event_finalized` を各1回として登録する。金額は設定せず、既存の `purchase` 設定は維持する。キーイベント数は UI 操作の成立回数であり、ユニークな DB イベント数や参加者数ではない。

## 認証マーカー

NextAuth の `events.signIn` で `account.provider === 'google'` の成功時だけ、識別情報を含まない短命 Cookie を設定する。GoogleAnalytics コンポーネントがクライアントで一度だけ読み取り、直ちに削除して `login` を送る。Google ボタンのクリック、既存セッションの水和、キャンセル後に残った既存セッションは成功として扱わない。Cookie の読み書きや計測の例外は OAuth の成功を妨げない。

## 個人情報を送らない境界

カスタムイベントには、公開トークン、参加者 ID・名前、イベントタイトル・説明、回答内容、候補日時・確定日程の ID、メールアドレス、OAuth プロフィール、カレンダー連携 URL を含めない。ページビューもクエリと公開トークンを除去し、ページタイトルは画面名の allowlist から生成する。分析用の値が必要な場合は、上記の固定カテゴリまたは件数へ変換する。

## ファネルと DB KPI の違い

### 既存イベントで確認する UX 指標

- 作成・新規回答の完了率と離脱段階は、開始、各 `step` の完了、保存成功を順に並べたファネル探索で確認する。曜日一括入力をスキップする経路は別のファネルとして扱う。
- 開始から完了までの平均経過時間は、GA4 のファネル探索で「経過時間を表示」を有効にして確認する。放置や再訪の時間も含むため、操作に要した時間そのものとは扱わない。
- `weekly_used` で曜日一括入力の利用を、`answer_edited` で送信済み回答の編集成功回数を確認する。入力中の戻る回数や変更回数は現状のイベントからは分からない。
- ページ表示の性能、Server Action の待ち時間、失敗理由は現在のイベントでは計測していない。今回は追加イベントや計測 SDK を導入せず、既存イベントの分析から始める。

参考: [GA4 ファネル探索](https://support.google.com/analytics/answer/9327974?hl=ja)

GA4 は匿名ブラウザを含む利用者の到達段階、操作成功、共有方式などのファネル分析に使う。リロードや再試行、ブラウザ設定による欠測があり得るため、`event_created` の件数を DB 上のイベント成立件数として扱わない。確定イベントのユニーク件数、回答者数、候補日の成立件数、保存の整合性は既存 DB を基準に集計する。確定のキーイベントもユニークイベント数ではない。

## 本番設定

2026-11-26 に、公開サイト `https://daysynth.k-tkms.com/` の測定 ID と GA4 の既存ウェブストリームの測定 ID が一致し、作成・回答・確定のイベントを受信していることを確認した。ストリームの登録 URL を公開サイトに合わせ、「ページビューとプライバシー」に記載した 4 項目を無効にした。イベントデータの保持期間は 14 か月に設定した。

本番ビルドに `NEXT_PUBLIC_GOOGLE_ANALYTICS` を設定する。プレビューやローカルの本番モードで検証するときは、本番の測定 ID を設定しない。本番の測定 ID を共有すると、その環境の計測も本番のレポートに入る。

## 探索の見方

- [作成ファネル](https://analytics.google.com/analytics/web/#/analysis/a299588562p487595650/edit/k06J4OSvQk60sZA0eclwcg) の「作成ファネル」タブで作成の完了率を、「作成詳細ファネル」タブでイベント情報の入力、入力方式の選択、作成成功への到達を順に見る。
- [回答ファネル](https://analytics.google.com/analytics/web/#/analysis/a299588562p487595650/edit/Tj6sT986Q9OtLM6zU2AGIw) の「回答ファネル」タブで新規回答の完了率を、「回答詳細ファネル」タブで参加可否の入力と回答の保存への到達を順に見る。同じ探索の「DaySynth 主要指標」タブでは、作成成功、新規回答の保存、日程の確定、共有のイベント数とアクティブユーザー数を日別・デバイス別に確認する。
- [確定ファネル](https://analytics.google.com/analytics/web/#/analysis/a299588562p487595650/edit/oBkfu8GITE-cAhuymthjkA) で、未確定の日程の確定を始めたユーザーのうち、確定に成功した割合を見る。開始条件は `finalize_started` かつ `has_existing_finalization=no`。

定点観測では、同じ長さの期間で、各フローの開始ユーザー数と完了率を併せて確認する。デバイス別の傾向を見るときは、端末ごとの開始ユーザー数も確認する。キーイベント数は保存成功などの発火回数を表し、ファネルの人数は指定の順序で各ステップに到達したユーザー数を表す。作成者と回答者は別の利用者になり得るため、作成・回答・確定はそれぞれのファネルで見る。

### 設定変更後の確認手順

1. DebugView で初期表示とアプリ内遷移を確認し、遷移先ごとの `page_view` が 1 件であること、URL の公開トークン、`participant_id`、イベントタイトル、候補日時、カレンダー URL が送信内容に含まれないことを確認する。
2. 計測の変更箇所に応じて、作成、新規回答、編集回答、共有の成功・キャンセル、確定の保存・更新・解除、Google OAuth の成功、既存セッションでの再読み込みを確認する。
3. Realtime のキーイベントとデータベースの集計を同じ期間で照合するときは、各指標の定義を確認する。

実装の単体テストでは、成功時の一度だけの送信、失敗・キャンセル時の無送信、新規／編集の分岐、解除／更新の分岐、パスとリファラーのサニタイズ、ログイン再水和の無送信、SPA ページビュー、スキップされたステップを検証する。

## 検証結果

実装時の検証では、依存関係を `npm ci` で lock ファイルの指定に復元した後、lint（エラー・警告なし）、unit（64 suites、370 passed、1 skipped）、production build、isolated browser smoke を完了した。ブラウザスモークは Google への通信を遮断したローカル環境で、初期化、遅延ロード、SPA ページビュー、サニタイズを確認している。unknown パス、測定 ID 未設定、development 環境は unit で検証した。

実装時の `origin/main`（`a8bcf26`）をベースにした隔離 worktreeでは、再度 `npm ci` を実行し、lint（エラー・警告なし）、unit（65 suites、378 passed、1 skipped）、typecheck、production build（ダミー測定 ID と既存のローカル環境変数を使用）を完了した。isolated browser smoke は実装時の検証結果であり、この worktree では再実施していない。

2026-11-26 の設定変更後に、本番のブラウザから送信されるリクエストを Google に到達する前に捕捉した。トップページの初期表示と作成画面への遷移で `page_view` が各 1 件、作成画面で `create_started` が 1 件だった。架空のイベント URL では、`page_view` のパスが `/event/[public_id]/input` に置き換わり、`participant_id` を含むクエリが除去された。
