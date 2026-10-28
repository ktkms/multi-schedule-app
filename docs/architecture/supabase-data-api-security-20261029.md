# Supabase Data APIへの直接アクセス制限（2026-10-29）

## 現状と判断

運用中のSupabaseプロジェクト `multi-schedule-app` では、`public.events`、`participants`、`availabilities`、`event_dates` などで `anon` に読み書き権限が付与され、さらに `Allow all for development` の `USING (true)` ポリシーが残っている。イベントの `admin_token`、`admin_password_hash`、回答者の `response_token` は、アプリ画面で表示しないことだけでは保護できない。

現在のアクセス権限仕様（`docs/architecture/access-policy.md`）では「イベントリンクを知っている人が閲覧・確定できる」。**DB匿名ロールへ全行の直接アクセスを許可することは、この仕様の要件ではない**。公開リンクを介するアプリの閲覧・編集の仕様は維持し、DBの公開APIは閉じる。

- `src/lib/supabase.ts` ではServer-onlyで管理用クライアントを作成する。
- `createSupabaseClient` は現状、Server Actionsやカレンダー用Route Handlersからだけ利用されるため、サーバー管理用クライアントに統一する。既存の呼び出しを維持するために一時的に関数名を残す。
- 公開イベントの参照・回答・日程確定・ICS/Googleカレンダーは従来のNext.jsサーバー経由で維持する。
- `submit_availability_bundle` 等、権限昇格する `SECURITY DEFINER` RPC は、公開権限を撤回する。サーバー側からの利用は継続する。

## 変更内容

- `src/lib/supabase.ts`：公開フロー向けに匿名キーで作成していたクライアントを、サーバー用service_roleへ統一。
- `supabase/migrations/20261029000000_restrict_direct_data_api_access.sql`：`public`の全テーブル・シーケンス・関数の`PUBLIC`/`anon`/`authenticated`権限を撤回し、`service_role`の処理を維持。RLSは全テーブルに有効化し、開発用ALLポリシーを削除。
- 今後`postgres`で作成するオブジェクトの既定公開権限も抑制する（他のDDLロールは個別確認）。

## デプロイ順序（重要）

このPRは**アプリケーションコードとDBマイグレーションの双方が必要**。

1. ローカルの独立Supabase環境でマイグレーションを適用し、サーバー側のアクセスと匿名直接アクセス拒否を検証する。
2. **先にアプリケーションをデプロイ**し、Vercel等で `SUPABASE_URL` と `SUPABASE_SERVICE_ROLE_KEY` が有効であること、ICS生成・イベントコピー・参加者重複チェックなどが動作することを確認する。この時点ではDB公開権限はまだ旧設定。
3. アプリ新バージョンが稼働していることを確認後、`supabase/migrations/20261029000000_restrict_direct_data_api_access.sql` を本番DBへ適用する。
4. 公開リンクでのイベント表示、回答、回答の編集、日程の追加・確定・解除、ログイン、予定自動同期、ICS/Googleカレンダー、cronを確認する。
5. Security Advisor、権限の再取得、REST/RPC匿名アクセス拒否を検証する。問題があれば旧クライアントへアプリだけロールバックしても直らないため、DBの権限スナップショットから適切に復旧する。

## 検証SQL（データ変更なし）

```sql
SELECT c.relname, c.relrowsecurity AS rls,
       has_table_privilege('anon', c.oid, 'SELECT') AS anon_read,
       has_table_privilege('anon', c.oid, 'INSERT') AS anon_insert,
       has_table_privilege('anon', c.oid, 'UPDATE') AS anon_update,
       has_table_privilege('authenticated', c.oid, 'SELECT') AS authenticated_read,
       has_table_privilege('service_role', c.oid, 'SELECT') AS service_read
FROM pg_class c
JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relkind IN ('r','p')
ORDER BY c.relname;
```

全件でRLS=true、匿名/認証済みロールの直接アクセス=false、service_roleのSELECT=trueを期待する。

```sql
SELECT p.proname, has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_execute,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_execute,
       has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_execute
FROM pg_proc p
JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public'
ORDER BY p.proname;
```

## 監査で分かった別途検討事項

- DBに格納した `admin_token`、`admin_password_hash`、`response_token` の過去のアクセス可能性は今回の修正では消えない。ログを確認し、必要に応じて再発行・失効を検討する。
- `submit_availability_bundle` は入力の `p_user_id` を利用する。公開EXECUTEの撤去に加えて、Server Action境界のセッション確認、イベント共有フロー、なりすまし耐性を個別レビューする。
- `SECURITY DEFINER` 関数の固定 `search_path` やSQL内の非修飾テーブル名は継続調査する。署名を変えずに権限を落とす本PRの範囲とは分離する。
- `service_role` の運用にあたってはサーバー側の認証・認可、Rate limit、入力検証が重要となる。DB権限の撤去だけでアプリのServer Actionsが安全になるわけではない。
- PostgreSQLバージョンのセキュリティ更新は別途実施する。
