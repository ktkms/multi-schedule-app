import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { test } from 'node:test';
import { Client } from 'pg';

const migrationDirectory = new URL('../supabase/migrations/', import.meta.url);
const boundaryMigration = '20261029000000_restrict_direct_data_api_access.sql';

// 環境変数の省略や設定間違いで、開発用・本番用DBへ接続しない。
test('Data APIの公開権限を撤去し、サーバー操作を維持する', async (t) => {
  const connectionString = process.env.DATA_API_TEST_DATABASE_URL;
  assert.ok(connectionString, 'DATA_API_TEST_DATABASE_URLを指定してください');
  const url = new URL(connectionString);
  assert.ok(
    ['localhost', '127.0.0.1'].includes(url.hostname) && url.pathname === '/data_api_security_test',
    '空のローカルdata_api_security_test DBだけを指定してください',
  );
  const db = new Client({ connectionString });
  await db.connect();
  try {
    const tables = await db.query(
      "SELECT count(*)::int AS count FROM pg_tables WHERE schemaname = 'public'",
    );
    assert.equal(tables.rows[0].count, 0, '再実行時は使い捨てDBを作り直してください');
    await db.query(`
      CREATE ROLE anon NOLOGIN;
      CREATE ROLE authenticated NOLOGIN;
      CREATE ROLE service_role NOLOGIN BYPASSRLS;
      GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
      ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
        GRANT ALL ON TABLES TO anon, authenticated, service_role;
      ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
        GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
      ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
        GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
    `);
    const migrations = (await readdir(migrationDirectory))
      .filter((name) => name.endsWith('.sql'))
      .sort();
    assert.ok(migrations.includes(boundaryMigration));
    for (const name of migrations.filter((name) => name < boundaryMigration)) {
      let sql = await readFile(new URL(name, migrationDirectory), 'utf8');
      // pgTAPは既存SQLテスト用の拡張。本テストはNodeで検証するため導入しない。
      if (name === '00000000000000_initial_schema.sql') {
        sql = sql.replace('CREATE EXTENSION IF NOT EXISTS pgtap;', '');
      }
      await db.query(sql);
    }
    // 運用DBに残っていた全許可ポリシーと、シーケンスの公開権限も再現する。
    for (const table of ['events', 'event_dates', 'participants', 'availabilities']) {
      await db.query(`CREATE POLICY "Allow all for development" ON public.${table}
        FOR ALL USING (true) WITH CHECK (true)`);
    }
    await db.query('CREATE SEQUENCE public.access_regression_sequence');

    const token = 'regression-public-token';
    const event = (
      await db.query(
        'INSERT INTO public.events(title, public_token) VALUES ($1, $2) RETURNING id',
        ['権限回帰テスト', token],
      )
    ).rows[0].id;
    const date = (
      await db.query(
        `INSERT INTO public.event_dates(event_id, start_time, end_time)
       VALUES ($1, '2099-02-02 10:00', '2099-02-02 11:00') RETURNING id`,
        [event],
      )
    ).rows[0].id;
    const participant = (
      await db.query(
        'INSERT INTO public.participants(event_id, name) VALUES ($1, $2) RETURNING id',
        [event, '回答者'],
      )
    ).rows[0].id;
    const rpc = 'SELECT public.update_participant_availability($1, $2, $3::jsonb)';
    const answer = [
      participant,
      event,
      JSON.stringify([{ event_date_id: date, availability: true }]),
    ];

    async function asRole(role, operation) {
      await db.query(`SET ROLE ${role}`);
      try {
        return await operation();
      } finally {
        await db.query('RESET ROLE');
      }
    }

    await t.test('移行前は匿名でデータ参照と特権RPCの実行が可能', async () => {
      await asRole('anon', async () => {
        assert.equal((await db.query('SELECT id FROM public.events')).rowCount, 1);
        assert.equal((await db.query(rpc, answer)).rows[0].update_participant_availability, true);
      });
    });

    // 権限境界を変更する本番用SQLは加工せず適用する。
    await db.query(await readFile(new URL(boundaryMigration, migrationDirectory), 'utf8'));
    const applicationTables = (
      await db.query(
        `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') ORDER BY c.relname`,
      )
    ).rows.map((row) => row.relname);
    assert.ok(applicationTables.includes('events'));
    assert.ok(applicationTables.includes('user_schedule_blocks'));

    for (const role of ['anon', 'authenticated']) {
      await t.test(`${role}は全テーブルの参照・更新と特権RPCを実行できない`, async () => {
        await asRole(role, async () => {
          for (const table of applicationTables) {
            await assert.rejects(db.query(`SELECT * FROM public."${table}"`), { code: '42501' });
          }
          for (const sql of [
            "INSERT INTO public.events(title, public_token) VALUES ('拒否対象', 'denied-public-token')",
            "UPDATE public.events SET title = '拒否対象'",
            'DELETE FROM public.events',
            "SELECT nextval('public.access_regression_sequence')",
          ]) {
            await assert.rejects(db.query(sql), { code: '42501' });
          }
          await assert.rejects(db.query(rpc, answer), { code: '42501' });
          await assert.rejects(
            db.query(
              `SELECT * FROM public.submit_availability_bundle(
              $1, $2, $3, '回答者', '', $4::jsonb, NULL)`,
              [event, token, participant, answer[2]],
            ),
            { code: '42501' },
          );
        });
      });
    }

    await t.test('全テーブルのRLSと全RPC・シーケンスの権限が期待通り', async () => {
      const result = await db.query(`
        SELECT c.relname, c.relrowsecurity,
          has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') AS anon_access,
          has_table_privilege('authenticated', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') AS auth_access,
          has_table_privilege('service_role', c.oid, 'SELECT') AS service_read,
          has_table_privilege('service_role', c.oid, 'INSERT') AS service_write
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
      `);
      for (const row of result.rows) {
        assert.deepEqual(
          [
            row.relrowsecurity,
            row.anon_access,
            row.auth_access,
            row.service_read,
            row.service_write,
          ],
          [true, false, false, true, true],
          row.relname,
        );
      }
      for (const row of (
        await db.query(`
        SELECT p.oid::regprocedure::text AS name,
          has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_execute,
          has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_execute,
          has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_execute
        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public'
      `)
      ).rows) {
        assert.deepEqual(
          [row.anon_execute, row.auth_execute, row.service_execute],
          [false, false, true],
          row.name,
        );
      }
      for (const row of (
        await db.query(`
        SELECT c.relname,
          has_sequence_privilege('anon', c.oid, 'USAGE,SELECT,UPDATE') AS anon_access,
          has_sequence_privilege('authenticated', c.oid, 'USAGE,SELECT,UPDATE') AS auth_access,
          has_sequence_privilege('service_role', c.oid, 'USAGE') AS service_access
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'S'
      `)
      ).rows) {
        assert.deepEqual(
          [row.anon_access, row.auth_access, row.service_access],
          [false, false, true],
          row.relname,
        );
      }
      assert.equal(
        (
          await db.query(`SELECT count(*)::int AS count FROM pg_policies
        WHERE schemaname = 'public' AND policyname = 'Allow all for development'`)
        ).rows[0].count,
        0,
      );
    });

    await t.test('service_roleで回答保存・日程確定・参照・更新・削除を継続できる', async () => {
      await asRole('service_role', async () => {
        const saved = await db.query(
          `SELECT * FROM public.submit_availability_bundle(
            $1, $2, $3, '回答者', '保存確認', $4::jsonb, NULL)`,
          [event, token, participant, answer[2]],
        );
        assert.equal(saved.rows[0].success, true);
        assert.equal(
          (
            await db.query(
              'SELECT availability FROM public.availabilities WHERE participant_id = $1',
              [participant],
            )
          ).rows[0].availability,
          true,
        );
        await db.query(
          'INSERT INTO public.finalized_dates(event_id, event_date_id) VALUES ($1, $2)',
          [event, date],
        );
        await db.query('UPDATE public.events SET is_finalized = true WHERE id = $1', [event]);
        assert.equal(
          (await db.query('SELECT is_finalized FROM public.events WHERE id = $1', [event])).rows[0]
            .is_finalized,
          true,
        );
        assert.equal(
          (await db.query("SELECT nextval('public.access_regression_sequence') AS value")).rows[0]
            .value,
          '1',
        );
        assert.equal(
          (await db.query('DELETE FROM public.finalized_dates WHERE event_id = $1', [event]))
            .rowCount,
          1,
        );
      });
    });

    await t.test('将来作成するテーブル・シーケンス・関数にも公開権限を付与しない', async () => {
      await db.query(`
        CREATE TABLE public.future_access_regression(id serial PRIMARY KEY);
        CREATE FUNCTION public.future_access_rpc() RETURNS integer LANGUAGE sql AS 'SELECT 1';
      `);
      for (const role of ['anon', 'authenticated']) {
        await asRole(role, async () => {
          await assert.rejects(db.query('SELECT * FROM public.future_access_regression'), {
            code: '42501',
          });
          await assert.rejects(
            db.query("SELECT nextval('public.future_access_regression_id_seq')"),
            { code: '42501' },
          );
          await assert.rejects(db.query('SELECT public.future_access_rpc()'), { code: '42501' });
        });
      }
      await asRole('service_role', async () => {
        assert.equal(
          (
            await db.query(
              'INSERT INTO public.future_access_regression DEFAULT VALUES RETURNING id',
            )
          ).rows[0].id,
          1,
        );
        assert.equal(
          (await db.query('SELECT public.future_access_rpc() AS value')).rows[0].value,
          1,
        );
      });
    });
  } finally {
    await db.end();
  }
});
