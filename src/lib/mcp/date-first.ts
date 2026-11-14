import 'server-only';
import { dateFirstFailure, runDateFirstTransaction } from '@/lib/date-first-service';
import { dateFirstAnswerSchema } from '@/lib/date-first-schema';
import { dateFirstAnswerInput } from './schemas';

/** OAuthで解決した本人だけを渡し、参加者の指定・名前照合・旧boolean保存を行わない。 */
export async function saveDateFirstMcpAnswer(userId: string, raw: unknown) {
  const input = dateFirstAnswerInput.parse(raw);
  try {
    return await runDateFirstTransaction(async (db) => {
      const changes = input.answer_kind === 'days' ? input.day_changes : input.time_changes;
      const result = await db.query<{
        value: { id: string; revision: string; replayed: boolean; created: boolean };
      }>('SELECT date_first.my_answer($1,$2,$3,$4,$5::jsonb,$6,$7,$8) AS value', [
        userId,
        input.public_token,
        input.answer_kind,
        input.expected_revision,
        JSON.stringify(changes),
        input.request_id ?? null,
        input.name ?? null,
        input.use_account_schedule ?? false,
      ]);
      const saved = result.rows[0].value;
      const found = await db.query<{ value: unknown }>(
        'SELECT date_first.read_answer($1,$2) AS value',
        [input.public_token, saved.id],
      );
      const answer = dateFirstAnswerSchema.parse(found.rows[0].value);
      return {
        success: true,
        scheduling_mode: 'date_first',
        answer_kind: input.answer_kind,
        created: saved.created ?? false,
        replayed: saved.replayed,
        revision: saved.revision,
        answered_day_ids: input.answer_kind === 'days' ? input.day_changes.map((d) => d.id) : [],
        answered_date_ids: input.answer_kind === 'times' ? input.time_changes.map((t) => t.id) : [],
        answer,
      };
    }, 'serializable');
  } catch (error) {
    return dateFirstFailure(error);
  }
}
