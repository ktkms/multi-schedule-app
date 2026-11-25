# アカウント予定連携の設計（現行実装）

> 本文は既存日時先行型の現行実装。日付先行型の初回実装には日付記号・△時間・詳細時間の補完と同期も含める。○の当日0〜24時判定、翌朝の区別、手動未回答の保護は[機能仕様](../../specifications/date-first-scheduling.md)と[技術設計](date-first-scheduling.md)を参照する。新方式は未実装。

作成日: 2026-02-05  
最終更新日: 2026-07-14

## 背景

- ログインユーザーの予定情報を活用し、回答入力の負担を減らす。
- 確定イベントと重複する枠を安全に扱う。
- 手動上書きはイベント単位で保持し、他イベントへ波及させない。
- 週ごとの入力は便利だが、アカウント保存すると日付ごとの予定との優先関係が見えづらくなるため、回答中の一時入力補助に限定する。

## 方針

- 新規回答時はアカウント予定を初期値へ自動反映する。
- アカウント予定の自動反映は `user_schedule_blocks`（日付ごとの予定）と確定イベント重複のみを対象にする。
- 週予定はアカウントへ保存せず、長い未入力期間がある回答時だけ一時的な曜日一括入力として表示する。
- 回答送信時には同期範囲を選ばせず、回答完了後に予定保存・他イベント反映を段階的に確認する。

## データモデル

- `user_event_links`: ユーザーとイベントの紐付け
- `user_schedule_blocks`: 実日時の予定ブロック（可/不可）
- `user_event_availability_overrides`: 重複枠の手動上書き

## アカウント予定の取得・表示

- `/account` の予定一括管理は最古の開始日時と最新の終了日時だけを先に取得し、現在週の予定を初期表示する。
- 前後週へ移動したときは対象週と重なる予定だけを遅延取得し、一度取得した週は画面内キャッシュから再表示する。
- 週内の予定が1000件を超える場合にも欠落しないよう、対象週の取得自体は1000件単位で全ページを結合する。
- 同一開始日時でも取得順がページ間で変わらないよう、開始日時・終了日時・IDの順で並べる。
- 保存後は期間境界と表示週だけを再取得し、全期間の予定を読み直さない。
- 週内の途中ページ取得に失敗した場合は、不完全な予定を正しい一覧として表示せず、空の取得結果として扱いサーバーログへ詳細を記録する。
- 同様に全件性が必要な参加者回答、確定日程、イベントURLから参照する候補日程、イベント間回答コピーの日程・回答も1000件単位で取得する。

### 廃止したデータ

- `user_schedule_templates`: 週予定のアカウント保存廃止に伴い、`20260509000000_drop_user_schedule_templates.sql` で削除する。
- 既存データを残したい環境では、マイグレーション適用前に `public.user_schedule_templates` をバックアップする。
  - 例: `create table public.user_schedule_templates_backup_20260509 as table public.user_schedule_templates;`
- 実DBへ push する前に `supabase migration list` で pending migration と適用順序を確認する。

## 自動反映ルール

### 判定

- **可（○）**: 候補枠を可ブロックが完全内包する場合
- **不可（×）**: 不可ブロックまたは確定イベントとの重複がある場合
- 判定不能は自動反映しない（`null`）

### 補足

- 各日予定由来で反映された枠は `dailyAutoFillDateIds` で保持する。
- 週入力由来の値はアカウント予定として扱わない。

## 回答画面仕様（現行）

- 新規回答は基本 `Step1 -> Step2 -> Step3 -> Step4`。
- ログイン済みの場合は、日付ごとの予定で補えない候補枠数が `7 * ユニーク時間帯数` を超える場合のみ Step2（曜日一括入力）を表示する。
- 未ログインの場合は従来どおり Step2 を表示し、回答入力の補助として使う。
- Step2 の `次へ` で曜日一括入力をイベント枠へ反映する。
  - `dailyAutoFillDateIds` の枠は上書きしない。
  - 手動編集済み枠（ヒートマップ編集）も上書きしない。
- Step2 の入力内容は現在の回答だけに反映し、アカウントには保存しない。
- `/account` には週予定管理タブを表示しない。

## 同期（回答完了後）

- 回答送信時は回答保存のみを行い、成功後に `/event/{public_id}/input/complete` へ遷移する。
- 回答送信RPCは `user_event_links` まで更新するが、`user_schedule_blocks` は更新しない。
- 回答送信前から存在する手動予定は、完了画面で保存を選ぶまで変更しない。
- ログイン済みの場合、完了ページで「この回答をアカウントに保存しますか？」を表示する。
  - `保存しない`: `/event/{public_id}` へ戻る。
  - `保存する`: 回答済み内容を `user_schedule_blocks` へ保存し、現在イベント以外の反映候補を同じ Server Action 内で確認する。
- 保存後に他イベントの差分がある場合のみ「他の回答済みイベントにも反映しますか？」を表示する。
  - `反映しない`: `/event/{public_id}` へ戻る。
  - `反映する`: `/event/{public_id}/input/sync-review` へ遷移し、イベント単位で反映確認する。
- 保存後に差分がない場合は保存完了メッセージのみを表示し、追加確認なしで `/event/{public_id}` へ自動遷移する。
- `sync-review` の対象は「現在イベント以外で、Asia/Tokyo の現在時刻より後に終了する候補日時に差分があるイベント」とする。すべての候補日時が過去のイベント、または差分が過去候補のみにあるイベントは表示しない。
- `sync-review` 適用時はイベント回答をRPCで置換更新するため、画面に表示しない過去候補の既存回答（選択済み）は payload に含めて保持する。
- `sync-review` は対象0件なら表示せず `/event/{public_id}` へ自動遷移する。
- `sync-review` で最後のイベント適用後に対象0件になった場合も `/event/{public_id}` へ自動遷移する。
- 未ログインの場合は完了ページに結果ページへ戻る導線と任意の Google ログイン導線を表示し、予定保存は行わない。今回の回答はログイン後もアカウントの予定へ自動保存されず、ログイン後は結果ページへ戻る。

## 手動上書き

- 重複枠は確認ダイアログで上書き可能。
- 上書き情報は `user_event_availability_overrides` に保存し、同期時も尊重する。
- 保存時の `overrideDateIds` は差分ではなく置換として扱い、今回未指定になった上書き行は削除する。

## 未ログイン回答の紐づけ

- 紐づけ導線はイベントページ内の「回答紐づきを編集」に統一し、`/account` には表示しない。
- `linkMyParticipantAnswerById` は、対象回答が他ユーザーに紐づいている場合は拒否する。

## 復帰時の参照差分

- 本変更を戻す場合は、週予定保存廃止の差分として次を参照する。
  - 作業中: `git diff -- src/components/availability-form.tsx src/components/account/account-schedule-settings.tsx src/lib/schedule-actions.ts src/lib/schedule-utils.ts supabase/migrations/20260509000000_drop_user_schedule_templates.sql`
  - コミット後: 上記ファイルと `docs/architecture/account-schedule.md` を変更したコミットの diff。
- DBデータ復帰が必要な場合は、`20260509000000_drop_user_schedule_templates.sql` 適用前のバックアップから `public.user_schedule_templates` を復元する。
  - 例: `create table public.user_schedule_templates as table public.user_schedule_templates_backup_20260509;` の後、必要な制約・インデックスは `20260205000000_add_user_schedule_features.sql` の定義を参照して再作成する。
- Git差分の確認には `git diff --name-status HEAD` と `git diff HEAD -- <対象ファイル>` を使う。
