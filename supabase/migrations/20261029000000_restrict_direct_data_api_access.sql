-- Next.js サーバーが service_role でDBを操作する構成を維持しつつ、
-- ブラウザ等が使える anon / authenticated / PUBLIC からの直接アクセスを閉じる。
-- 公開リンクによる閲覧・回答は Next.js Server Actions / Route Handlers 側で継続する。

BEGIN;

-- 既存のサーバー側サービス用権限を明示的に維持する。
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO service_role;

REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, anon, authenticated;

-- RLSを引き続き有効とし、「開発用全許可」ポリシーを廃止する。
-- 既存の finalized_dates SELECT ポリシーも公開DB経由では使えなくなる。
DO $$
DECLARE
  target RECORD;
BEGIN
  FOR target IN
    SELECT n.nspname AS schema_name, c.relname AS table_name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
  LOOP
    EXECUTE format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY', target.schema_name, target.table_name);
  END LOOP;
END;
$$;

DROP POLICY IF EXISTS "Allow all for development" ON public.events;
DROP POLICY IF EXISTS "Allow all for development" ON public.event_dates;
DROP POLICY IF EXISTS "Allow all for development" ON public.participants;
DROP POLICY IF EXISTS "Allow all for development" ON public.availabilities;

-- 将来のpostgresロール作成オブジェクトへ自動で公開GRANTしない。
-- DDLを別ロールで実施する場合は、そのロールの既定権限も別途確認する。
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL PRIVILEGES ON TABLES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL PRIVILEGES ON SEQUENCES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated;
-- 関数の PUBLIC デフォルト EXECUTE はグローバル既定権限でも撤回する。
ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

COMMIT;
