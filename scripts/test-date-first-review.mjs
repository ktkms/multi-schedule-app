import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { Client } from 'pg';

// 明示した空のローカル専用DBだけを使用する。.envやSupabaseリンクを参照しない。
const connectionString = process.env.DATE_FIRST_REVIEW_DATABASE_URL;
const root = new URL('../', import.meta.url);
const schema = 'date_first';
const connect = async () => {
  const db = new Client({ connectionString });
  await db.connect();
  // 既存マイグレーションによるロール既定値が再実行へ残っても、履歴表の配置を変えない。
  await db.query("SET search_path=public; SET statement_timeout='30s'; SET lock_timeout='5s'");
  return db;
};
const call = async (db, name, values, casts) => {
  if (name === 'change_schedule') {
    // 本番の予定テーブルへ直接書き、全経路を守るトリガーの本人ロックも検証する。
    await db.query(
      `INSERT INTO public.user_schedule_blocks(user_id,start_time,end_time,availability,source)
      VALUES($1,$2::timestamp AT TIME ZONE 'UTC',$3::timestamp AT TIME ZONE 'UTC',$4,'manual')
      ON CONFLICT(user_id,start_time,end_time) DO UPDATE SET availability=excluded.availability,updated_at=now()`,
      values,
    );
    return null;
  }
  return (
    await db.query(
      `SELECT ${schema}.${name}(${values.map((_, i) => '$' + (i + 1) + (casts?.[i] ?? '')).join(',')}) AS value`,
      values,
    )
  ).rows[0].value;
};
const revision = async (db, e) =>
  (await db.query('SELECT revision FROM public.events WHERE id=$1', [e.id])).rows[0].revision;
const fixture = async (db, days = ['2026-11-07', '2026-11-08']) => {
  const e = await call(db, 'create_event', [
    randomUUID(),
    JSON.stringify({ title: '隔離検証', days }),
  ]);
  e.days = (
    await db.query(
      'SELECT id,local_date::text FROM public.event_candidate_days WHERE event_id=$1 ORDER BY local_date',
      [e.id],
    )
  ).rows;
  e.participant = await call(db, 'create_participant', [
    e.token,
    randomUUID(),
    JSON.stringify({ name: '検証参加者' }),
  ]);
  return e;
};
const save = (
  db,
  e,
  kind,
  rev,
  changes,
  participant = e.participant,
  name = null,
  expected = null,
) =>
  call(db, 'save_answers', [
    e.token,
    participant,
    String(rev),
    kind,
    JSON.stringify(changes),
    name,
    expected,
  ]);
const slots = async (db, e, ranges = [[600, 660]], day = e.days[0].id) => {
  await call(db, 'add_slots', [e.token, await revision(db, e), day, JSON.stringify(ranges)]);
  return (
    await db.query(
      'SELECT id FROM public.event_dates WHERE event_id=$1 AND candidate_day_id=$2 ORDER BY start_time',
      [e.id, day],
    )
  ).rows.map((r) => r.id);
};
const finalize = async (db, e, days, times = [], ack = []) =>
  call(db, 'finalize', [e.token, await revision(db, e), days, times, ack]);
const rejected = (operation, message) => assert.rejects(operation, new RegExp(message));
const blocked = async (observer, waiter, blocker) => {
  const start = performance.now();
  while (performance.now() - start < 3000) {
    const result = await observer.query('SELECT $2::integer=ANY(pg_blocking_pids($1)) AS blocked', [
      waiter.processID,
      blocker.processID,
    ]);
    if (result.rows[0].blocked) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.fail('想定した行ロック待ちを観測できませんでした');
};
const pair = async (operation) => {
  const a = await connect();
  const b = await connect();
  try {
    await operation(a, b);
  } finally {
    await Promise.allSettled([a.query('ROLLBACK'), b.query('ROLLBACK')]);
    await Promise.all([a.end(), b.end()]);
  }
};

test('日付先行型マイグレーションの隔離DB検証', async (t) => {
  assert.ok(connectionString, 'DATE_FIRST_REVIEW_DATABASE_URLを明示してください');
  const url = new URL(connectionString);
  assert.ok(['localhost', '127.0.0.1'].includes(url.hostname));
  assert.equal(url.pathname, '/daysynth_date_first_review');
  assert.ok(!url.search, '接続オプションによる別ホストへの切替を許可しません');
  const db = await connect();
  try {
    assert.equal(
      (await db.query("SELECT count(*)::integer AS n FROM pg_tables WHERE schemaname='public'"))
        .rows[0].n,
      0,
      '空の使い捨てDBだけを指定してください',
    );
    console.log('PostgreSQL:', (await db.query('SHOW server_version')).rows[0].server_version);
    await db.query(`
      CREATE ROLE anon NOLOGIN;
      CREATE ROLE authenticated NOLOGIN;
      CREATE ROLE service_role NOLOGIN BYPASSRLS;
      GRANT USAGE ON SCHEMA public TO anon,authenticated,service_role;
      ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO service_role;
      ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO service_role;
    `);
    const migrations = (await readdir(new URL('supabase/migrations/', root)))
      .filter((p) => p.endsWith('.sql') && !p.endsWith('_date_first_scheduling.sql'))
      .sort();
    for (const path of migrations) {
      let sql = await readFile(new URL('supabase/migrations/' + path, root), 'utf8');
      sql = sql.replace('CREATE EXTENSION IF NOT EXISTS pgtap;', '');
      await db.query(sql);
    }
    assert.equal(
      (await db.query("SELECT to_regclass('public.event_access_histories') IS NOT NULL AS present"))
        .rows[0].present,
      true,
    );
    // スキーマ切替前の旧方式データが残ることも確認する。
    const old = (
      await db.query(
        "INSERT INTO public.events(title,public_token) VALUES('旧方式','review-old-event') RETURNING id",
      )
    ).rows[0].id;
    const oldDate = (
      await db.query(
        `INSERT INTO public.event_dates(event_id,start_time,end_time)
      VALUES($1,'2026-11-07 10:00','2026-11-07 11:00') RETURNING id`,
        [old],
      )
    ).rows[0].id;
    const oldParticipant = (
      await db.query(
        "INSERT INTO public.participants(event_id,name) VALUES($1,'旧参加者') RETURNING id",
        [old],
      )
    ).rows[0].id;
    await db.query(
      await readFile(
        new URL('supabase/migrations/20261103060811_date_first_scheduling.sql', root),
        'utf8',
      ),
    );
    console.log('既存マイグレーション適用数:', migrations.length);

    await t.test('V01 旧一意性を維持し、新方式の別親日付には同じ実時間を保存できる', async () => {
      await rejected(
        db.query(
          `INSERT INTO public.event_dates(event_id,start_time,end_time)
        VALUES($1,'2026-11-07 10:00','2026-11-07 11:00')`,
          [old],
        ),
        'duplicate key',
      );
      const e = await fixture(db);
      await slots(db, e, [[1560, 1620]]);
      await slots(db, e, [[120, 180]], e.days[1].id);
      assert.equal(
        (
          await db.query(
            'SELECT count(*)::integer AS n FROM public.event_dates WHERE event_id=$1',
            [e.id],
          )
        ).rows[0].n,
        2,
      );
      await rejected(
        db.query(
          "UPDATE public.event_dates SET start_time=start_time+interval '1 minute' WHERE event_id=$1",
          [e.id],
        ),
        'immutable_slot',
      );
      const aliases = (
        await db.query('SELECT id FROM public.event_dates WHERE event_id=$1', [e.id])
      ).rows.map((r) => r.id);
      await rejected(
        finalize(
          db,
          e,
          e.days.map((d) => d.id),
          aliases,
        ),
        'overlapping_finalization',
      );
      assert.equal(
        (
          await db.query(
            'SELECT count(*)::integer AS n FROM public.finalized_dates WHERE event_id=$1',
            [e.id],
          )
        ).rows[0].n,
        0,
      );
      await db.query('SET ROLE service_role');
      try {
        assert.equal(
          (
            await db.query('SELECT public.update_participant_availability($1,$2,$3::jsonb) AS ok', [
              oldParticipant,
              old,
              JSON.stringify([{ event_date_id: oldDate, availability: true }]),
            ])
          ).rows[0].ok,
          true,
        );
        await rejected(
          db.query('SELECT public.update_participant_availability($1,$2,$3::jsonb)', [
            e.participant,
            e.id,
            '[]',
          ]),
          'invalid_mode',
        );
        assert.equal(
          (
            await db.query('SELECT public.finalize_event_safe($1,$2::jsonb) AS ok', [
              old,
              JSON.stringify([oldDate]),
            ])
          ).rows[0].ok,
          true,
        );
        await rejected(
          db.query('SELECT public.finalize_event_safe($1,$2::jsonb)', [e.id, '[]']),
          'invalid_mode',
        );
      } finally {
        await db.query('RESET ROLE');
      }
    });

    await t.test('V02 別イベントの参加者・候補日・枠を拒否し、差分を部分保存しない', async () => {
      const e = await fixture(db);
      const other = await fixture(db);
      await rejected(
        db.query(
          `INSERT INTO public.event_day_responses(event_id,participant_id,candidate_day_id,status,source)
        VALUES($1,$2,$3,'yes','manual')`,
          [e.id, other.participant, e.days[0].id],
        ),
        'foreign key',
      );
      await assert.rejects(
        db.query(
          `INSERT INTO public.event_day_responses
        (event_id,participant_id,candidate_day_id,status,source) VALUES($1,$2,$3,'yes','manual')`,
          [e.id, e.participant, other.days[0].id],
        ),
        { code: '23503' },
      );
      const [otherSlot] = await slots(db, other);
      await assert.rejects(
        db.query(
          `INSERT INTO public.date_first_time_responses
        (event_id,participant_id,event_date_id,availability,source) VALUES($1,$2,$3,true,'manual')`,
          [e.id, e.participant, otherSlot],
        ),
        { code: '23503' },
      );
      await rejected(
        save(db, e, 'days', 0, [
          { id: e.days[0].id, status: 'yes' },
          { id: other.days[0].id, status: 'yes' },
        ]),
        'query returned no rows',
      );
      assert.equal(
        (
          await db.query(
            'SELECT count(*)::integer AS n FROM public.event_day_responses WHERE event_id=$1',
            [e.id],
          )
        ).rows[0].n,
        0,
      );
    });

    await t.test('V03 NULL・sourceのCHECKと、手動未回答の保存', async () => {
      await assert.rejects(
        db.query(
          "INSERT INTO public.events(title,public_token,scheduling_mode) VALUES('不正','invalid-stage-token','date_first')",
        ),
        { code: '23514' },
      );
      const e = await fixture(db);
      for (const values of [
        ['yes', null, null],
        [null, 'account', null],
        [null, 'manual', '消えずに残るコメント'],
      ]) {
        await assert.rejects(
          db.query(
            `INSERT INTO public.event_day_responses
          (event_id,participant_id,candidate_day_id,status,source,comment) VALUES($1,$2,$3,$4,$5,$6)`,
            [e.id, e.participant, e.days[0].id, ...values],
          ),
          (error) => ['23502', '23514'].includes(error.code),
        );
      }
      await save(db, e, 'days', 0, [{ id: e.days[0].id, status: null }]);
      const row = (
        await db.query(
          'SELECT status,source,comment FROM public.event_day_responses WHERE participant_id=$1',
          [e.participant],
        )
      ).rows[0];
      assert.deepEqual(row, { status: null, source: 'manual', comment: null });
      assert.equal(await save(db, e, 'days', 1, [{ id: e.days[0].id, status: null }]), '1');
      await rejected(
        save(db, e, 'days', 1, [{ id: e.days[1].id, comment: '未回答への入力' }]),
        'invalid_input',
      );
    });

    await t.test('V04 △区間と記号変更の最終状態を遅延検査する', async () => {
      const e = await fixture(db);
      await save(db, e, 'days', 0, [
        {
          id: e.days[0].id,
          status: 'maybe',
          intervals: [
            [600, 660],
            [660, 720],
            [780, 840],
          ],
        },
      ]);
      const response = (
        await db.query('SELECT id FROM public.event_day_responses WHERE participant_id=$1', [
          e.participant,
        ])
      ).rows[0].id;
      assert.equal(
        (
          await db.query(
            'SELECT count(*)::integer AS n FROM public.day_response_intervals WHERE day_response_id=$1',
            [response],
          )
        ).rows[0].n,
        2,
      );
      await db.query('BEGIN');
      await db.query("UPDATE public.event_day_responses SET status='yes' WHERE id=$1", [response]);
      await rejected(db.query('COMMIT'), 'interval_requires_maybe');
      await db.query('ROLLBACK');
      assert.equal(
        (await db.query('SELECT status FROM public.event_day_responses WHERE id=$1', [response]))
          .rows[0].status,
        'maybe',
      );
      await db.query('BEGIN');
      await db.query("UPDATE public.event_day_responses SET status='yes' WHERE id=$1", [response]);
      await db.query('DELETE FROM public.day_response_intervals WHERE day_response_id=$1', [
        response,
      ]);
      await db.query('COMMIT');
    });

    await t.test('V05 日付と日時の包含・解除確認・回答の保持', async () => {
      const e = await fixture(db);
      const [slot] = await slots(db, e);
      await save(db, e, 'times', 0, [{ id: slot, availability: false }]);
      await finalize(db, e, [e.days[0].id], [slot]);
      await rejected(finalize(db, e, [], []), 'requires_confirmation');
      await db.query('BEGIN');
      await db.query('UPDATE public.event_candidate_days SET confirmed_at=NULL WHERE event_id=$1', [
        e.id,
      ]);
      await rejected(db.query('COMMIT'), 'invalid_finalization');
      await db.query('ROLLBACK');
      await finalize(db, e, [], [], [slot]);
      assert.equal(
        (
          await db.query(
            'SELECT availability FROM public.date_first_time_responses WHERE event_id=$1',
            [e.id],
          )
        ).rows[0].availability,
        false,
      );
      await finalize(db, e, [e.days[0].id]);
      assert.equal(
        (
          await db.query(
            'SELECT count(*)::integer AS n FROM public.finalized_dates WHERE event_id=$1',
            [e.id],
          )
        ).rows[0].n,
        0,
      );
    });

    await t.test('日付集計にコメント有無を含め、空白だけや削除後には印を出さない', async () => {
      const e = await fixture(db);
      await save(db, e, 'days', '0', [
        { id: e.days[0].id, status: 'maybe', comment: '途中から参加' },
      ]);
      let result = await call(db, 'read_event', [e.token]);
      assert.equal(result.days.find((day) => day.id === e.days[0].id).hasComment, true);
      assert.equal(result.days.find((day) => day.id === e.days[1].id).hasComment, false);
      await save(db, e, 'days', '1', [{ id: e.days[0].id, comment: ' \n　 ' }]);
      result = await call(db, 'read_event', [e.token]);
      assert.equal(result.days.find((day) => day.id === e.days[0].id).hasComment, false);
      await save(db, e, 'days', '2', [{ id: e.days[0].id, comment: '' }]);
      result = await call(db, 'read_event', [e.token]);
      assert.equal(result.days.find((day) => day.id === e.days[0].id).hasComment, false);
    });

    await t.test('V06 89日からの同時追加で90日上限を守る', async () => {
      const days = Array.from({ length: 89 }, (_, i) =>
        new Date(Date.UTC(2026, 0, i + 1)).toISOString().slice(0, 10),
      );
      const e = await fixture(db, days);
      await pair(async (a, b) => {
        await a.query('BEGIN');
        await call(a, 'add_days', [e.token, '0', ['2027-01-01']]);
        const pending = rejected(
          call(b, 'add_days', [e.token, '0', ['2027-01-02']]),
          'stale_revision',
        );
        await blocked(db, b, a);
        await a.query('COMMIT');
        await pending;
      });
      await rejected(
        call(db, 'add_days', [e.token, await revision(db, e), ['2027-01-02']]),
        'limit_exceeded',
      );
      assert.equal(
        (
          await db.query(
            'SELECT count(*)::integer AS n FROM public.event_candidate_days WHERE event_id=$1',
            [e.id],
          )
        ).rows[0].n,
        90,
      );
    });

    await t.test('V07 有効3000枠・総12000枠と同ID復活を検査する', async () => {
      const activeCase = await fixture(db);
      await db.query(
        `INSERT INTO public.event_dates(event_id,candidate_day_id,start_time,end_time)
        SELECT $1,c.id,c.local_date::timestamp+make_interval(mins=>x),
        c.local_date::timestamp+make_interval(mins=>x+1)
        FROM public.event_candidate_days c CROSS JOIN generate_series(0,1499) x
        WHERE c.event_id=$1 AND NOT(c.local_date='2026-11-08' AND x=1499)`,
        [activeCase.id],
      );
      await pair(async (a, b) => {
        await a.query('BEGIN');
        await call(a, 'add_slots', [activeCase.token, '0', activeCase.days[1].id, '[[1499,1500]]']);
        const pending = rejected(
          call(b, 'add_slots', [activeCase.token, '0', activeCase.days[0].id, '[[1500,1501]]']),
          'stale_revision',
        );
        await blocked(db, b, a);
        await a.query('COMMIT');
        await pending;
      });
      await rejected(
        call(db, 'add_slots', [
          activeCase.token,
          await revision(db, activeCase),
          activeCase.days[0].id,
          '[[1500,1501]]',
        ]),
        'limit_exceeded',
      );
      const days = Array.from({ length: 8 }, (_, i) => '2026-12-' + String(i + 1).padStart(2, '0'));
      const e = await fixture(db, days);
      await db.query(
        `INSERT INTO public.event_dates(event_id,candidate_day_id,start_time,end_time,retired_at)
        SELECT $1,c.id,c.local_date::timestamp+make_interval(mins=>x),
        c.local_date::timestamp+make_interval(mins=>x+1),CASE WHEN n>3000 THEN now() END
        FROM (SELECT c.*,row_number() OVER(ORDER BY local_date) AS dn FROM public.event_candidate_days c WHERE event_id=$1) c
        CROSS JOIN generate_series(0,1499) x
        CROSS JOIN LATERAL (SELECT (dn-1)*1500+x+1 AS n) counts`,
        [e.id],
      );
      await rejected(
        call(db, 'add_slots', [e.token, await revision(db, e), e.days[0].id, '[[1500,1501]]']),
        'limit_exceeded',
      );
      const active = (
        await db.query(
          'SELECT id FROM public.event_dates WHERE event_id=$1 AND retired_at IS NULL LIMIT 1',
          [e.id],
        )
      ).rows[0].id;
      await call(db, 'add_slots', [e.token, await revision(db, e), e.days[0].id, '[]', [active]]);
      await call(db, 'add_slots', [e.token, await revision(db, e), e.days[2].id, '[[0,1]]']);
      assert.equal(
        (
          await db.query(
            'SELECT count(*)::integer AS n FROM public.event_dates WHERE event_id=$1',
            [e.id],
          )
        ).rows[0].n,
        12000,
      );
      const anotherActive = (
        await db.query(
          'SELECT id FROM public.event_dates WHERE event_id=$1 AND retired_at IS NULL LIMIT 1',
          [e.id],
        )
      ).rows[0].id;
      await rejected(
        call(db, 'add_slots', [
          e.token,
          await revision(db, e),
          e.days[0].id,
          '[[1500,1501]]',
          [anotherActive],
        ]),
        'limit_exceeded',
      );
      assert.equal(
        (await db.query('SELECT retired_at FROM public.event_dates WHERE id=$1', [anotherActive]))
          .rows[0].retired_at,
        null,
      );
    });

    await t.test('V08 同じ回答revisionの並行更新を拒否する', async () => {
      const e = await fixture(db);
      await pair(async (a, b) => {
        await a.query('BEGIN');
        await save(a, e, 'days', 0, [{ id: e.days[0].id, status: 'yes' }]);
        const pending = rejected(
          save(b, e, 'days', 0, [{ id: e.days[1].id, status: 'no' }]),
          'stale_revision',
        );
        await blocked(db, b, a);
        await a.query('COMMIT');
        await pending;
      });
      const [slot] = await slots(db, e);
      assert.equal(await save(db, e, 'times', 0, [{ id: slot, availability: null }]), '1');
    });

    await t.test('V09 回答保存と確定日解除が同時でも、無効枠へ後から保存しない', async () => {
      const e = await fixture(db);
      const [slot] = await slots(db, e);
      await finalize(db, e, [e.days[0].id]);
      await pair(async (a, b) => {
        await a.query('BEGIN');
        await save(a, e, 'times', 0, [{ id: slot, availability: true }]);
        const pending = finalize(b, e, []);
        await blocked(db, b, a);
        await a.query('COMMIT');
        await pending;
      });
      await rejected(
        save(db, e, 'times', 1, [{ id: slot, availability: false }]),
        'invalid_event_scope',
      );
      assert.equal(
        (
          await db.query(
            'SELECT availability FROM public.date_first_time_responses WHERE event_id=$1',
            [e.id],
          )
        ).rows[0].availability,
        true,
      );
    });

    await t.test('V10 候補日追加だけなら既存日付への差分保存を受理する', async () => {
      const e = await fixture(db);
      await call(db, 'add_days', [e.token, '0', ['2026-11-09']]);
      await save(db, e, 'days', 0, [{ id: e.days[0].id, status: 'yes' }]);
      assert.equal(
        (
          await db.query(
            'SELECT count(*)::integer AS n FROM public.event_day_responses WHERE event_id=$1',
            [e.id],
          )
        ).rows[0].n,
        1,
      );
    });

    await t.test('V11 新規作成の同時再送と異内容の衝突', async () => {
      const request = randomUUID();
      const body = JSON.stringify({ title: '再送確認', days: ['2026-11-07'] });
      let first;
      await pair(async (a, b) => {
        await a.query('BEGIN');
        first = await call(a, 'create_event', [request, body]);
        const pending = call(b, 'create_event', [request, body]);
        await blocked(db, b, a);
        await a.query('COMMIT');
        assert.equal((await pending).id, first.id);
      });
      await db.query("UPDATE public.events SET title='後から編集' WHERE id=$1", [first.id]);
      await call(db, 'create_event', [request, body]);
      assert.equal(
        (await db.query('SELECT title FROM public.events WHERE id=$1', [first.id])).rows[0].title,
        '後から編集',
      );
      await rejected(
        call(db, 'create_event', [
          request,
          JSON.stringify({ title: '別内容', days: ['2026-11-07'] }),
        ]),
        'request_conflict',
      );
      const e = await fixture(db);
      const participantRequest = randomUUID();
      const participantBody = JSON.stringify({ name: '再送参加者' });
      await pair(async (a, b) => {
        await a.query('BEGIN');
        const firstId = await call(a, 'create_participant', [
          e.token,
          participantRequest,
          participantBody,
        ]);
        const pending = call(b, 'create_participant', [
          e.token,
          participantRequest,
          participantBody,
        ]);
        await blocked(db, b, a);
        await a.query('COMMIT');
        assert.equal(await pending, firstId);
      });
      await rejected(
        call(db, 'create_participant', [
          e.token,
          participantRequest,
          JSON.stringify({ name: '別内容' }),
        ]),
        'request_conflict',
      );
      const failedRequest = randomUUID();
      await db.query('BEGIN');
      const failedParticipant = await call(db, 'create_participant', [
        e.token,
        failedRequest,
        participantBody,
      ]);
      await rejected(
        save(
          db,
          e,
          'days',
          0,
          [{ id: e.days[0].id, status: 'maybe', intervals: [[1800, 1801]] }],
          failedParticipant,
        ),
        'check constraint|invalid_input',
      );
      await db.query('ROLLBACK');
      assert.equal(
        (
          await db.query(
            'SELECT count(*)::integer AS n FROM public.participants WHERE creation_request_id=$1',
            [failedRequest],
          )
        ).rows[0].n,
        0,
      );
    });

    await t.test('V12 50人の並行保存と、別段階からの氏名競合', async () => {
      const e = await fixture(db);
      const participants = [];
      for (let i = 0; i < 50; i++) {
        participants.push(
          await call(db, 'create_participant', [
            e.token,
            randomUUID(),
            JSON.stringify({ name: '負荷検証参加者' }),
          ]),
        );
      }
      const started = performance.now();
      await Promise.all(
        participants.map(async (p) => {
          const client = await connect();
          try {
            await save(client, e, 'days', 0, [{ id: e.days[0].id, status: 'yes' }], p);
          } finally {
            await client.end();
          }
        }),
      );
      console.log('50接続の保存時間(ms):', Math.round(performance.now() - started));
      assert.equal(
        (
          await db.query(
            'SELECT count(*)::integer AS n FROM public.event_day_responses WHERE event_id=$1',
            [e.id],
          )
        ).rows[0].n,
        50,
      );
      await pair(async (a, b) => {
        await a.query('BEGIN');
        await save(a, e, 'days', 0, [], e.participant, '変更A', '検証参加者');
        const pending = rejected(
          save(b, e, 'times', 0, [], e.participant, '変更B', '検証参加者'),
          'stale_name',
        );
        await blocked(db, b, a);
        await a.query('COMMIT');
        await pending;
      });
    });

    await t.test('V13 sourceによる更新保護のSQL条件（実際の予定反映RPCは未検証）', async () => {
      const e = await fixture(db);
      const ids = await slots(db, e, [
        [600, 660],
        [660, 720],
      ]);
      await save(db, e, 'times', 0, [{ id: ids[0], availability: null }]);
      await db.query(
        `INSERT INTO public.date_first_time_responses(event_id,participant_id,event_date_id,availability,source)
        VALUES($1,$2,$3,true,'account')`,
        [e.id, e.participant, ids[1]],
      );
      await db.query(
        "DELETE FROM public.date_first_time_responses WHERE event_id=$1 AND source='account'",
        [e.id],
      );
      const rows = (
        await db.query(
          'SELECT availability,source FROM public.date_first_time_responses WHERE event_id=$1',
          [e.id],
        )
      ).rows;
      assert.deepEqual(rows, [{ availability: null, source: 'manual' }]);
    });

    await t.test('V14 SERIALIZABLEの競合検出（本人リンク・指紋の統合は未検証）', async () => {
      const e = await fixture(db);
      await pair(async (a, b) => {
        await a.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
        await a.query('SELECT title FROM public.events WHERE id=$1', [e.id]);
        await b.query("UPDATE public.events SET title='別接続の変更' WHERE id=$1", [e.id]);
        await assert.rejects(
          a.query("UPDATE public.events SET title='古い前提の変更' WHERE id=$1", [e.id]),
          { code: '40001' },
        );
        await a.query('ROLLBACK');
      });
    });

    await t.test(
      'V15 HTTP本文の境界はWeb/MCP実装後に検証',
      { skip: 'PostgreSQLだけではHTTP本文上限を検証できない' },
      () => {},
    );

    await t.test('V16 Unicode文字数・コメント長と900区間上限', async () => {
      assert.equal(
        (await db.query('SELECT char_length($1)::integer AS n', ['😀'.repeat(100)])).rows[0].n,
        100,
      );
      assert.equal(
        (await db.query('SELECT char_length($1)::integer AS n', ['か\u3099'])).rows[0].n,
        2,
      );
      const e = await fixture(db);
      const intervals = Array.from({ length: 900 }, (_, i) => [i * 2, i * 2 + 1]);
      await save(db, e, 'days', 0, [
        { id: e.days[0].id, status: 'maybe', comment: '😀'.repeat(2000), intervals },
      ]);
      await rejected(
        save(db, e, 'days', 1, [{ id: e.days[0].id, comment: '😀'.repeat(2001) }]),
        'check constraint|invalid_input',
      );
      await rejected(
        save(db, e, 'days', 1, [{ id: e.days[0].id, intervals: [...intervals, [0, 1]] }]),
        'limit_exceeded',
      );
      assert.equal(
        (
          await db.query(
            `SELECT count(*)::integer AS n FROM public.day_response_intervals i
        JOIN public.event_day_responses r ON r.id=i.day_response_id WHERE r.participant_id=$1`,
            [e.participant],
          )
        ).rows[0].n,
        900,
      );
    });

    await t.test('V17 公開DBロールを拒否しservice_roleだけが検証RPCを使える', async () => {
      for (const role of ['anon', 'authenticated']) {
        await db.query('SET ROLE ' + role);
        try {
          for (const table of [
            'event_candidate_days',
            'event_day_responses',
            'day_response_intervals',
            'date_first_time_responses',
          ]) {
            await assert.rejects(db.query('SELECT * FROM public.' + table), { code: '42501' });
          }
          await assert.rejects(
            call(db, 'create_event', [
              randomUUID(),
              JSON.stringify({ title: '拒否対象', days: ['2026-11-07'] }),
            ]),
            { code: '42501' },
          );
        } finally {
          await db.query('RESET ROLE');
        }
      }
      await db.query('SET ROLE service_role');
      try {
        const e = await fixture(db);
        await save(db, e, 'days', 0, [{ id: e.days[0].id, status: 'yes' }]);
      } finally {
        await db.query('RESET ROLE');
      }
    });

    await t.test('V18 最後の制約違反は全件ロールバック（後処理警告は未検証）', async () => {
      const e = await fixture(db);
      await rejected(
        save(db, e, 'days', 0, [
          { id: e.days[0].id, status: 'yes' },
          { id: e.days[1].id, status: 'maybe', intervals: [[1799, 1801]] },
        ]),
        'check constraint|invalid_input',
      );
      assert.equal(
        (
          await db.query(
            'SELECT count(*)::integer AS n FROM public.event_day_responses WHERE event_id=$1',
            [e.id],
          )
        ).rows[0].n,
        0,
      );
      assert.equal(
        (
          await db.query('SELECT day_answers_revision FROM public.participants WHERE id=$1', [
            e.participant,
          ])
        ).rows[0].day_answers_revision,
        '0',
      );
    });

    const integrationUser = async () =>
      (await db.query("INSERT INTO authjs.users(name) VALUES('統合検証') RETURNING id")).rows[0].id;
    const own = (client, user, e, kind, rev, changes, request = null, name = null) =>
      call(client, 'my_answer', [
        user,
        e.token,
        kind,
        String(rev),
        JSON.stringify(changes),
        request,
        name,
      ]);
    const preview = (client, user, e) => call(client, 'sync_preview', [user, e.token]);
    const apply = async (client, user, e, plan, ack = []) => {
      await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
      try {
        const result = await call(client, 'apply_sync', [user, e.token, plan.fingerprint, ack]);
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    };

    await t.test('I01 本人リンク・初回回答の原子性と同時再送', async () => {
      const e = await fixture(db, ['2099-01-01', '2099-01-02']);
      const user = await integrationUser(),
        stranger = await integrationUser(),
        request = randomUUID();
      const changes = [{ id: e.days[0].id, status: 'yes' }];
      let saved;
      await pair(async (a, b) => {
        await a.query('BEGIN');
        saved = await own(a, user, e, 'days', 0, changes, request, '本人');
        const pending = own(b, user, e, 'days', 0, changes, request, '本人');
        await blocked(db, b, a);
        await a.query('COMMIT');
        assert.equal((await pending).id, saved.id);
      });
      await rejected(own(db, stranger, e, 'days', 1, changes), 'not_linked');
      await save(db, e, 'days', 1, [{ id: e.days[0].id, status: 'no' }], saved.id);
      const replay = await own(db, user, e, 'days', 0, changes, request, '本人');
      assert.equal(replay.replayed, true);
      assert.equal(replay.revision, '2');
      assert.equal(
        (
          await db.query('SELECT status FROM public.event_day_responses WHERE participant_id=$1', [
            saved.id,
          ])
        ).rows[0].status,
        'no',
      );
      const failedUser = await integrationUser();
      await rejected(
        own(
          db,
          failedUser,
          e,
          'days',
          0,
          [{ id: e.days[0].id, status: 'maybe', intervals: [[1800, 1801]] }],
          randomUUID(),
          '失敗確認',
        ),
        'check constraint|invalid_input',
      );
      assert.equal(
        (
          await db.query(
            'SELECT count(*)::integer AS n FROM public.user_event_links WHERE user_id=$1',
            [failedUser],
          )
        ).rows[0].n,
        0,
      );
      assert.equal(
        (
          await db.query(
            "SELECT count(*)::integer AS n FROM public.participants WHERE name='失敗確認'",
          )
        ).rows[0].n,
        0,
      );
    });

    await t.test('I02 日付○△×未回答・翌朝の区別と手動未回答を実予定から反映', async () => {
      const e = await fixture(db, ['2099-02-01', '2099-02-02', '2099-02-03', '2099-02-04']);
      const user = await integrationUser();
      const owner = await own(db, user, e, 'days', 0, [], randomUUID(), '予定連携');
      const [night] = await slots(db, e, [[1380, 1500]]);
      const midday = await slots(
        db,
        e,
        [
          [720, 780],
          [780, 840],
        ],
        e.days[1].id,
      );
      await slots(db, e, [[600, 660]], e.days[3].id);
      await own(db, user, e, 'times', 0, [{ id: midday[1], availability: null }]);
      await call(db, 'change_schedule', [user, '2099-02-01 00:00', '2099-02-02 00:00', true]);
      await call(db, 'change_schedule', [user, '2099-02-02 00:00', '2099-02-02 06:00', false]);
      await call(db, 'change_schedule', [user, '2099-02-02 12:00', '2099-02-02 14:00', true]);
      await call(db, 'change_schedule', [user, '2099-02-03 00:00', '2099-02-04 00:00', false]);
      const plan = await preview(db, user, e);
      assert.deepEqual(
        plan.days.map((d) => d.status),
        ['yes', 'maybe', 'no', null],
      );
      assert.equal(plan.times.find((t) => t.id === night).availability, false);
      assert.equal(plan.times.find((t) => t.id === midday[0]).availability, true);
      assert.ok(!plan.times.some((t) => t.id === midday[1]));
      await apply(db, user, e, plan);
      const values = (
        await db.query(
          'SELECT status,source FROM public.event_day_responses WHERE participant_id=$1 ORDER BY candidate_day_id',
          [owner.id],
        )
      ).rows;
      assert.equal(values.length, 3);
      assert.ok(values.every((v) => v.source === 'account'));
      const interval = (
        await db.query(
          `SELECT i.start_offset_minutes,i.end_offset_minutes
        FROM public.day_response_intervals i JOIN public.event_day_responses r ON r.id=i.day_response_id
        WHERE r.participant_id=$1`,
          [owner.id],
        )
      ).rows;
      assert.deepEqual(interval, [{ start_offset_minutes: 720, end_offset_minutes: 840 }]);
      const before = (
        await db.query(
          'SELECT day_answers_revision,detail_answers_revision FROM public.participants WHERE id=$1',
          [owner.id],
        )
      ).rows[0];
      await apply(db, user, e, await preview(db, user, e));
      assert.deepEqual(
        (
          await db.query(
            'SELECT day_answers_revision,detail_answers_revision FROM public.participants WHERE id=$1',
            [owner.id],
          )
        ).rows[0],
        before,
      );
    });

    await t.test('I03 自動未回答化によるコメント削除は確認指紋で守る', async () => {
      const e = await fixture(db, ['2099-03-01']);
      const user = await integrationUser();
      const owner = await own(db, user, e, 'days', 0, [], randomUUID(), 'コメント確認');
      await call(db, 'change_schedule', [user, '2099-03-01 12:00', '2099-03-01 13:00', true]);
      await apply(db, user, e, await preview(db, user, e));
      await own(db, user, e, 'days', 1, [{ id: e.days[0].id, comment: '保持するメモ' }]);
      assert.equal(
        (
          await db.query('SELECT source FROM public.event_day_responses WHERE participant_id=$1', [
            owner.id,
          ])
        ).rows[0].source,
        'account',
      );
      await db.query('DELETE FROM public.user_schedule_blocks WHERE user_id=$1', [user]);
      const plan = await preview(db, user, e);
      await rejected(apply(db, user, e, plan), 'requires_confirmation');
      assert.equal(
        (
          await db.query('SELECT comment FROM public.event_day_responses WHERE participant_id=$1', [
            owner.id,
          ])
        ).rows[0].comment,
        '保持するメモ',
      );
      await own(db, user, e, 'days', 2, [{ id: e.days[0].id, comment: '別のメモ' }]);
      await rejected(apply(db, user, e, plan, [e.days[0].id]), 'stale_preview');
      await apply(db, user, e, await preview(db, user, e), [e.days[0].id]);
      assert.equal(
        (
          await db.query(
            'SELECT count(*)::integer AS n FROM public.event_day_responses WHERE participant_id=$1',
            [owner.id],
          )
        ).rows[0].n,
        0,
      );
    });

    await t.test('I04 予定変更・本人リンク変更を再検証し、適用中の本人更新を直列化', async () => {
      const e = await fixture(db, ['2099-04-01']);
      const user = await integrationUser();
      await own(db, user, e, 'days', 0, [], randomUUID(), '競合確認');
      await call(db, 'change_schedule', [user, '2099-04-01 00:00', '2099-04-02 00:00', true]);
      const old = await preview(db, user, e);
      await call(db, 'change_schedule', [user, '2099-04-01 12:00', '2099-04-01 13:00', false]);
      await rejected(apply(db, user, e, old), 'stale_preview');
      const latest = await preview(db, user, e);
      await pair(async (a, b) => {
        await a.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
        await call(a, 'apply_sync', [user, e.token, latest.fingerprint, []]);
        const pending = call(b, 'change_schedule', [
          user,
          '2099-04-01 14:00',
          '2099-04-01 15:00',
          false,
        ]);
        await blocked(db, b, a);
        await a.query('COMMIT');
        await pending;
      });
      const linked = await preview(db, user, e);
      const other = await call(db, 'create_participant', [
        e.token,
        randomUUID(),
        JSON.stringify({ name: '紐付け変更' }),
      ]);
      await db.query(
        'UPDATE public.user_event_links SET participant_id=$3 WHERE user_id=$1 AND event_id=$2',
        [user, e.id, other],
      );
      await rejected(apply(db, user, e, linked), 'stale_preview');
      await db.query('DELETE FROM public.user_event_links WHERE user_id=$1 AND event_id=$2', [
        user,
        e.id,
      ]);
      await rejected(
        apply(db, user, e, await Promise.resolve({ fingerprint: '0'.repeat(64) })),
        'not_linked',
      );
    });

    await t.test('I05 分単位の部分区間を拡大せず、不可と他イベント確定を優先', async () => {
      const e = await fixture(db, ['2099-05-01']);
      const user = await integrationUser();
      const owner = await own(db, user, e, 'days', 0, [], randomUUID(), '区間確認');
      const [slot] = await slots(db, e, [[720, 780]]);
      await call(db, 'change_schedule', [user, '2099-05-01 12:30', '2099-05-01 13:30', true]);
      let plan = await preview(db, user, e);
      assert.deepEqual(plan.days[0].intervals, [[750, 810]]);
      assert.equal(plan.times[0].availability, null);
      await call(db, 'change_schedule', [user, '2099-05-01 12:45', '2099-05-01 13:00', false]);
      plan = await preview(db, user, e);
      assert.deepEqual(plan.days[0].intervals, [
        [750, 765],
        [780, 810],
      ]);
      assert.equal(plan.times.find((t) => t.id === slot).availability, false);
      await apply(db, user, e, plan);
      const unrelated = await fixture(db, ['2099-05-01']);
      const otherOwner = await own(db, user, unrelated, 'days', 0, [], randomUUID(), '別イベント');
      const [busy] = await slots(db, unrelated, [[780, 810]]);
      await finalize(db, unrelated, [unrelated.days[0].id], [busy]);
      assert.ok(otherOwner.id);
      plan = await preview(db, user, e);
      assert.deepEqual(plan.days[0].intervals, [[750, 765]]);
      await apply(db, user, e, plan);
      assert.equal(
        (
          await db.query(
            'SELECT source FROM public.date_first_time_responses WHERE participant_id=$1',
            [owner.id],
          )
        ).rows[0].source,
        'account',
      );
    });
    await t.test('I06 公開取得は内部値を返さず、集計・全区間・未回答を区別する', async () => {
      const e = await fixture(db);
      await save(db, e, 'days', 0, [
        {
          id: e.days[0].id,
          status: 'maybe',
          comment: '確認',
          intervals: [
            [600, 630],
            [700, 780],
            [1440, 1800],
          ],
        },
      ]);
      await call(db, 'create_participant', [
        e.token,
        randomUUID(),
        JSON.stringify({ name: '同名でも別回答' }),
      ]);
      const event = await call(db, 'read_event', [e.token]);
      assert.deepEqual(Object.keys(event.event).sort(), [
        'baseRanges',
        'description',
        'id',
        'revision',
        'stage',
        'title',
        'token',
      ]);
      assert.equal(event.days[0].maybe, 1);
      assert.equal(event.days[0].unanswered, 1);
      const details = await call(db, 'day_details', [e.token, e.days[0].id]);
      assert.equal(details[0].status, 'maybe');
      assert.deepEqual(details[0].intervals, [
        [600, 630],
        [700, 780],
        [1440, 1800],
      ]);
      assert.equal(details[1].status, null);
      const answer = await call(db, 'read_answer', [e.token, e.participant]);
      assert.equal(answer.dayRevision, '1');
      assert.equal(answer.days[0].comment, '確認');
      assert.equal(await call(db, 'read_answer', ['unrelated-public-token', e.participant]), null);
      const rev = await revision(db, e);
      await call(db, 'add_days', [e.token, rev, [e.days[0].local_date]], ['', '', '::date[]']);
      assert.equal(await revision(db, e), rev);
      const [slot] = await slots(db, e);
      await finalize(db, e, [e.days[0].id], [slot]);
      const confirmed = await revision(db, e);
      await finalize(db, e, [e.days[0].id], [slot]);
      assert.equal(await revision(db, e), confirmed);
      await rejected(
        call(
          db,
          'add_slots',
          [e.token, confirmed, e.days[0].id, '[]', [slot]],
          ['', '', '', '::jsonb', '::uuid[]'],
        ),
        'requires_confirmation',
      );
      await call(
        db,
        'add_slots',
        [e.token, confirmed, e.days[0].id, '[]', [slot], [slot]],
        ['', '', '', '::jsonb', '::uuid[]', '::uuid[]'],
      );
      const retired = await call(db, 'read_event', [e.token]);
      assert.equal(retired.slots.length, 0);
      assert.equal(retired.days[0].confirmed, true);
      assert.equal(
        (
          await db.query(
            'SELECT count(*)::int AS n FROM public.finalized_dates WHERE event_id=$1',
            [e.id],
          )
        ).rows[0].n,
        0,
      );
    });

    await t.test('I07 方式・基点を固定し、旧経路を拒否して参加者削除を許す', async () => {
      const e = await fixture(db);
      const [slot] = await slots(db, e);
      await rejected(
        db.query(
          "UPDATE public.events SET scheduling_mode='time_first',adjustment_stage=NULL WHERE id=$1",
          [e.id],
        ),
        'immutable_mode',
      );
      await rejected(
        db.query('UPDATE public.event_candidate_days SET local_date=local_date+1 WHERE id=$1', [
          e.days[0].id,
        ]),
        'immutable_day',
      );
      await rejected(
        db.query(
          'INSERT INTO public.availabilities(event_id,participant_id,event_date_id,availability) VALUES($1,$2,$3,true)',
          [e.id, e.participant, slot],
        ),
        'invalid_mode',
      );
      await save(db, e, 'days', 0, [
        { id: e.days[0].id, status: 'maybe', intervals: [[600, 660]] },
      ]);
      await save(db, e, 'times', 0, [{ id: slot, availability: null }]);
      await db.query('DELETE FROM public.participants WHERE id=$1', [e.participant]);
      assert.equal(
        (
          await db.query(
            'SELECT count(*)::int AS n FROM public.day_response_intervals i JOIN public.event_day_responses r ON r.id=i.day_response_id WHERE r.event_id=$1',
            [e.id],
          )
        ).rows[0].n,
        0,
      );
      assert.equal(
        (
          await db.query(
            'SELECT count(*)::int AS n FROM public.date_first_time_responses WHERE event_id=$1',
            [e.id],
          )
        ).rows[0].n,
        0,
      );
      // 旧方式の日時編集は、新方式の不変制約へ巻き込まない。
      await db.query("UPDATE public.event_dates SET start_time='2026-11-07 09:00' WHERE id=$1", [
        oldDate,
      ]);
    });

    await t.test('I08 匿名初回保存は原子的で、再送が後続の共同編集を戻さない', async () => {
      const e = await fixture(db);
      const request = randomUUID();
      const changes = JSON.stringify([{ id: e.days[0].id, status: 'yes' }]);
      const saved = await call(db, 'web_answer', [e.token, request, 'days', changes, '新しい回答']);
      await save(db, e, 'days', 1, [{ id: e.days[0].id, status: 'no' }], saved.id);
      const replay = await call(db, 'web_answer', [
        e.token,
        request,
        'days',
        changes,
        '新しい回答',
      ]);
      assert.equal(replay.replayed, true);
      assert.equal((await call(db, 'read_answer', [e.token, saved.id])).days[0].status, 'no');
      await rejected(
        call(db, 'web_answer', [e.token, request, 'days', '[]', '新しい回答']),
        'request_conflict',
      );
      const before = (await call(db, 'read_event', [e.token])).participants.length;
      await rejected(
        call(db, 'web_answer', [
          e.token,
          randomUUID(),
          'days',
          JSON.stringify([{ id: randomUUID(), status: 'yes' }]),
          '失敗した回答',
        ]),
        'no rows',
      );
      assert.equal((await call(db, 'read_event', [e.token])).participants.length, before);
      const rev = await save(db, e, 'days', 0, [{ id: e.days[0].id, comment: null }]);
      assert.equal(String(rev), '0');
      assert.equal((await call(db, 'read_answer', [e.token, e.participant])).days.length, 0);
      const user = await integrationUser();
      await db.query(
        'INSERT INTO public.user_event_links(user_id,event_id,participant_id) VALUES($1,$2,$3)',
        [user, e.id, e.participant],
      );
      await rejected(
        own(db, user, e, 'days', 0, [], randomUUID(), '新しい回答'),
        'request_conflict',
      );
    });

    await t.test('I09 内部JSON境界も型・範囲・余分なキーを拒否する', async () => {
      const e = await fixture(db);
      for (const changes of [
        [{ id: e.days[0].id, status: 'yes', source: 'account' }],
        [{ id: e.days[0].id, status: false }],
        [{ id: e.days[0].id, status: 'maybe', intervals: [[0, 1801]] }],
        [{ id: e.days[0].id, status: 'maybe', intervals: [[0.5, 1]] }],
        [{ id: e.days[0].id, status: 'yes', intervals: [[0, 1]] }],
      ])
        await rejected(save(db, e, 'days', 0, changes), 'invalid_input');
      await rejected(
        call(db, 'add_slots', [e.token, await revision(db, e), e.days[0].id, '[[0,1801]]']),
        'invalid_input',
      );
      assert.equal((await call(db, 'read_answer', [e.token, e.participant])).dayRevision, '0');
    });
    await t.test('I10 対象日の変更で集計を休止し、同じ候補だけ復帰する', async () => {
      const e = await fixture(db);
      const [slot] = await slots(db, e);
      await save(db, e, 'times', 0, [{ id: slot, availability: false }]);
      await call(
        db,
        'set_targets',
        [e.token, await revision(db, e), [e.days[1].id]],
        ['', '', '::uuid[]'],
      );
      assert.equal((await call(db, 'read_event', [e.token])).slots.length, 0);
      assert.equal((await call(db, 'read_answer', [e.token, e.participant])).times.length, 0);
      await rejected(
        save(db, e, 'times', 1, [{ id: slot, availability: true }]),
        'invalid_event_scope',
      );
      await call(
        db,
        'set_targets',
        [e.token, await revision(db, e), [e.days[0].id]],
        ['', '', '::uuid[]'],
      );
      assert.equal(
        (await call(db, 'read_answer', [e.token, e.participant])).times[0].availability,
        false,
      );
      const same = await revision(db, e);
      await call(db, 'set_targets', [e.token, same, [e.days[0].id]], ['', '', '::uuid[]']);
      assert.equal(await revision(db, e), same);
      await finalize(db, e, [e.days[1].id]);
      await rejected(
        call(
          db,
          'set_targets',
          [e.token, await revision(db, e), [e.days[0].id]],
          ['', '', '::uuid[]'],
        ),
        'invalid_event_scope',
      );
      await finalize(db, e, []);
      assert.equal(
        (await call(db, 'read_event', [e.token])).days.some((d) => d.target),
        false,
      );
      assert.equal((await call(db, 'read_event', [e.token])).slots.length, 0);
    });
    await t.test('I11 初回予定補完と未登録プレビューは手動値・再送を保護する', async () => {
      const e = await fixture(db, ['2099-08-01', '2099-08-02']);
      const user = await integrationUser();
      const [slot] = await slots(db, e);
      await call(db, 'change_schedule', [user, '2099-08-01 00:00', '2099-08-02 00:00', true]);
      const before = (
        await db.query('SELECT count(*)::int AS n FROM public.participants WHERE event_id=$1', [
          e.id,
        ])
      ).rows[0].n;
      const initial = await call(
        db,
        'sync_preview',
        [user, e.token, '[]', true],
        ['', '', '::jsonb', ''],
      );
      assert.equal(initial.participant, null);
      assert.equal(initial.days[0].status, 'yes');
      assert.equal(
        (
          await db.query('SELECT count(*)::int AS n FROM public.participants WHERE event_id=$1', [
            e.id,
          ])
        ).rows[0].n,
        before,
      );
      const proposed = JSON.stringify([
        { start_time: '2099-08-01T00:00:00', end_time: '2099-08-02T00:00:00', availability: false },
      ]);
      const planned = await call(
        db,
        'sync_preview',
        [user, e.token, proposed, true],
        ['', '', '::jsonb', ''],
      );
      assert.equal(planned.days[0].status, 'no');
      assert.equal(planned.times[0].availability, false);
      assert.equal(
        (
          await db.query('SELECT availability FROM public.user_schedule_blocks WHERE user_id=$1', [
            user,
          ])
        ).rows[0].availability,
        true,
      );
      const request = randomUUID(),
        changes = JSON.stringify([{ id: e.days[0].id, status: null }]);
      await db.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
      const saved = await call(
        db,
        'my_answer',
        [user, e.token, 'days', 0, changes, request, '初回補完', true],
        ['', '', '', '', '::jsonb', '', '', ''],
      );
      await db.query('COMMIT');
      let answer = await call(db, 'read_answer', [e.token, saved.id]);
      assert.equal(answer.days[0].status, null);
      assert.equal(answer.days[0].source, 'manual');
      assert.equal(answer.times[0].availability, true);
      assert.equal(answer.times[0].source, 'account');
      await save(
        db,
        e,
        'times',
        answer.timeRevision,
        [{ id: slot, availability: false }],
        saved.id,
      );
      const replay = await call(
        db,
        'my_answer',
        [user, e.token, 'days', 0, changes, request, '初回補完', true],
        ['', '', '', '', '::jsonb', '', '', ''],
      );
      assert.equal(replay.replayed, true);
      answer = await call(db, 'read_answer', [e.token, saved.id]);
      assert.equal(answer.times[0].availability, false);
      await rejected(
        call(
          db,
          'my_answer',
          [user, e.token, 'days', 0, changes, request, '初回補完', false],
          ['', '', '', '', '::jsonb', '', '', ''],
        ),
        'request_conflict',
      );
    });
    await t.test('I12 正式時間回答の予定保存は端数・選択外・未回答を保持する', async () => {
      const e = await fixture(db, ['2099-09-01']);
      const user = await integrationUser();
      const times = await slots(db, e, [
        [600, 630],
        [630, 660],
        [660, 690],
      ]);
      const owner = await own(
        db,
        user,
        e,
        'times',
        0,
        [
          { id: times[0], availability: true },
          { id: times[1], availability: null },
          { id: times[2], availability: false },
        ],
        randomUUID(),
        '予定保存',
      );
      await call(db, 'change_schedule', [user, '2099-09-01 09:00', '2099-09-01 12:00', false]);
      await call(db, 'change_schedule', [user, '2099-09-01 09:00', '2099-09-01 10:00', true]);
      const preview = await call(
        db,
        'answer_schedule_preview',
        [user, e.token, times],
        ['', '', '::uuid[]'],
      );
      assert.equal(preview.changes.length, 2);
      assert.deepEqual(preview.unanswered_ids, [times[1]]);
      assert.equal(preview.preserved.length, 3);
      assert.equal(preview.overwritten.length, 1);
      await db.query("SET TIME ZONE 'Asia/Tokyo'");
      assert.equal(
        (await call(db, 'answer_schedule_preview', [user, e.token, times], ['', '', '::uuid[]']))
          .expected_revision,
        preview.expected_revision,
      );
      await db.query("SET TIME ZONE 'UTC'");
      await save(db, e, 'times', 1, [{ id: times[0], availability: false }], owner.id);
      await db.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
      await rejected(
        call(
          db,
          'apply_answer_schedule',
          [user, e.token, times, preview.expected_revision],
          ['', '', '::uuid[]', ''],
        ),
        'stale_preview',
      );
      await db.query('ROLLBACK');
      assert.equal(
        (
          await db.query(
            'SELECT count(*)::int AS n FROM public.user_schedule_blocks WHERE user_id=$1',
            [user],
          )
        ).rows[0].n,
        2,
      );
      await save(db, e, 'times', 2, [{ id: times[0], availability: true }], owner.id);
      const current = await call(
        db,
        'answer_schedule_preview',
        [user, e.token, times],
        ['', '', '::uuid[]'],
      );
      await db.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
      await call(
        db,
        'apply_answer_schedule',
        [user, e.token, times, current.expected_revision],
        ['', '', '::uuid[]', ''],
      );
      await db.query('COMMIT');
      const result = await db.query(
        "SELECT to_char(start_time AT TIME ZONE 'UTC','HH24:MI') lo,to_char(end_time AT TIME ZONE 'UTC','HH24:MI') hi,availability,source FROM public.user_schedule_blocks WHERE user_id=$1 ORDER BY start_time,end_time",
        [user],
      );
      assert.deepEqual(
        result.rows.map((row) => [row.lo, row.hi, row.availability]),
        [
          ['09:00', '10:00', false],
          ['10:00', '10:30', true],
          ['10:30', '11:00', false],
          ['11:00', '11:30', false],
          ['11:30', '12:00', false],
        ],
      );
      assert.equal(result.rows[2].source, 'manual');
      const unknown = await call(
        db,
        'answer_schedule_preview',
        [user, e.token, [times[1]]],
        ['', '', '::uuid[]'],
      );
      assert.deepEqual(unknown.changes, []);
      assert.deepEqual(unknown.overwritten, []);
    });
    await t.test('I13 別基点で重なる正式回答の矛盾と予定保存途中失敗を拒否する', async () => {
      const e = await fixture(db, ['2099-10-01', '2099-10-02']);
      const user = await integrationUser();
      const [a] = await slots(db, e, [[1440, 1500]], e.days[0].id),
        [b] = await slots(db, e, [[0, 60]], e.days[1].id);
      await own(
        db,
        user,
        e,
        'times',
        0,
        [
          { id: a, availability: true },
          { id: b, availability: false },
        ],
        randomUUID(),
        '矛盾確認',
      );
      await rejected(
        call(db, 'answer_schedule_preview', [user, e.token, [a, b]], ['', '', '::uuid[]']),
        'conflicting_answers',
      );
      const other = await integrationUser();
      await rejected(
        call(db, 'answer_schedule_preview', [other, e.token, [a]], ['', '', '::uuid[]']),
        'not_linked',
      );
      await call(db, 'change_schedule', [user, '2099-10-02 00:00', '2099-10-02 02:00', false]);
      const plan = await call(
        db,
        'answer_schedule_preview',
        [user, e.token, [a]],
        ['', '', '::uuid[]'],
      );
      await db.query(`CREATE FUNCTION date_first.test_schedule_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
        IF NEW.source='event' THEN RAISE EXCEPTION 'schedule_late_failure'; END IF; RETURN NEW; END $$;
        CREATE TRIGGER test_schedule_failure BEFORE INSERT ON public.user_schedule_blocks FOR EACH ROW EXECUTE FUNCTION date_first.test_schedule_failure()`);
      await db.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
      await rejected(
        call(
          db,
          'apply_answer_schedule',
          [user, e.token, [a], plan.expected_revision],
          ['', '', '::uuid[]', ''],
        ),
        'schedule_late_failure',
      );
      await db.query('ROLLBACK');
      await db.query(
        'DROP TRIGGER test_schedule_failure ON public.user_schedule_blocks; DROP FUNCTION date_first.test_schedule_failure()',
      );
      const rows = await db.query(
        "SELECT to_char(start_time AT TIME ZONE 'UTC','HH24:MI') lo,to_char(end_time AT TIME ZONE 'UTC','HH24:MI') hi,availability FROM public.user_schedule_blocks WHERE user_id=$1",
        [user],
      );
      assert.deepEqual(rows.rows, [{ lo: '00:00', hi: '02:00', availability: false }]);
    });
  } finally {
    await db.end();
  }
});
