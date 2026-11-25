import 'server-only';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  answerInput,
  answerReadInput,
  answerScheduleInput,
  eventInput,
  scheduleInput,
  eventSearchInput,
  scheduleReadInput,
} from './schemas';
import { MCP_TOOL_SCOPES, mcpChallenge, toolSecurity, type McpToolName } from './authorization';
import {
  McpInputError,
  previewMyScheduleUpdate,
  readEvent,
  readMyAnswer,
  saveMyAnswer,
  saveMyAnswerToSchedule,
  updateMySchedule,
} from './services';
import { listMyEvents, readMySchedule } from './read-services';

/** HTTPリクエストごとに認証済み本人を閉じ込め、別ユーザーへの状態の混入を防ぐ。 */
export function createMcpServer(identity: { userId: string; scopes: string[] } | null) {
  const user = identity ?? { userId: '', scopes: [] };
  const server = new McpServer({ name: 'daysynth', version: '1.0.0' });
  const run = async (name: McpToolName, operation: () => Promise<unknown>) => {
    const scope = MCP_TOOL_SCOPES[name];
    if (!user.scopes.includes(scope))
      return {
        content: [
          {
            type: 'text' as const,
            text: 'この接続には必要な操作権限がありません。必要な範囲で再接続してください。',
          },
        ],
        isError: true,
        _meta: {
          'mcp/www_authenticate': [
            mcpChallenge(scope, identity ? 'insufficient_scope' : 'invalid_token'),
          ],
        },
      };
    try {
      const result = await operation();
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result) }],
        ...(typeof result === 'object' &&
        result !== null &&
        'success' in result &&
        result.success === false
          ? { isError: true }
          : {}),
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text' as const,
            text:
              error instanceof McpInputError
                ? error.message
                : '処理を完了できませんでした。時間をおいて再度お試しください。',
          },
        ],
        isError: true,
      };
    }
  };
  const read = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
  const write = {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: false,
  };
  server.registerTool(
    'list_my_events',
    {
      description:
        '本人に紐づくイベントを期間・名前・確定状態で検索する。date_from/date_toは日本時間の日付で終了日も含む。date_targetはeffective（未確定は候補、確定済みは確定日程）・candidate・finalized。日付先行型はscheduling_mode=date_firstとfinalization_kindを返し、時刻未定はkind=day/date、日時付きはkind=timeとして区別する。時刻未定を終日の不可予定と解釈しない。期間指定時は日程順。一致候補は最大3件で、省略フラグがtrueならget_eventを確認する。続きは同じ条件とlimitでoffsetを指定する。',
      inputSchema: eventSearchInput,
      annotations: read,
      _meta: toolSecurity('list_my_events'),
    },
    (input) => run('list_my_events', () => listMyEvents(user.userId, input)),
  );
  server.registerTool(
    'get_event',
    {
      description:
        '公開トークンからイベントを取得する。日時先行型のdates/finalized_datesと旧形式互換を維持する。日付先行型はscheduling_mode=date_first、candidate_days、confirmed_days、調整段階、構造revisionを返す。datesは現在対象の時間候補で、未回答を不可と解釈しない。時刻表現は日本時間の壁時計。回答保存のrevisionはget_my_answerのdayRevision/timeRevisionを使う。',
      inputSchema: eventInput,
      annotations: read,
      _meta: toolSecurity('get_event'),
    },
    ({ public_token }) => run('get_event', () => readEvent(public_token)),
  );
  server.registerTool(
    'get_my_answer',
    {
      description:
        '本人に紐づく回答を取得する。紐づきがなければanswerはnull。日付先行型はdaysの○△×/nullと条件・コメント、timesのtrue/false/null、source、dayRevision/timeRevisionを返す。日付先行型では回答行がない場合と回答値のnullは未回答。日付の○はイベントで設定した時間帯（翌日に及ぶ時間帯を含む）を通して参加可能という意味で、日付回答は正式な時間回答に自動で引き継がれない。別途保存された時間回答の有無はtimesで確認する。日時先行型の回答のfalseは不可。include_account_schedule=trueで個人予定の判定も取得する。予定判定のnullは不明。',
      inputSchema: answerReadInput,
      annotations: read,
      _meta: toolSecurity('get_my_answer'),
    },
    ({ public_token, include_account_schedule }) =>
      run('get_my_answer', () => readMyAnswer(user.userId, public_token, include_account_schedule)),
  );
  server.registerTool(
    'get_my_schedule',
    {
      description:
        '本人の登録済み予定を取得する。week_startで7日間、またはdate_from/date_toで終了日を含め最大31日間を指定する。両形式は併用できない。availabilityで登録済みの可・不可を絞れる。未登録は参加可能ではなく不明。確定イベントとの照合結果ではない。日時は日本時間の壁時計時刻として読む。',
      inputSchema: scheduleReadInput,
      annotations: read,
      _meta: toolSecurity('get_my_schedule'),
    },
    (input) => run('get_my_schedule', () => readMySchedule(user.userId, input)),
  );
  server.registerTool(
    'save_my_answer',
    {
      description:
        '本人の回答を登録・編集する。日時先行型はnameとavailabilitiesを指定する。初回は、省略した枠が不可になる。登録済み予定を使う初回回答ではuse_account_schedule=trueとし、availabilitiesには本人が個別に可否を指定した枠だけを入れる。個別指定がなければ空配列を渡す。予定が不明な枠も省略すると不可になるため、その扱いが依頼から分からなければ保存前に本人へ確認する。明示した枠は手動回答として後の予定同期から保護される。予定補完で判定できず省略した枠はunresolved_date_idsに含まれる。既存回答の編集ではget_my_answerで取得した表示名をnameにそのまま指定し、変更枠だけを送る。日付先行型ではscheduling_mode=date_firstを指定する。日付回答はanswer_kind=daysとday_changes、詳細時間回答はanswer_kind=timesとtime_changesを送る。編集のexpected_revisionにはget_my_answerで取得したdayRevision（days）またはtimeRevision（times）を指定し、nameとrequest_idは省略する。新規作成ではrequest_id、nameとexpected_revision=0を指定する。日付先行型では未指定の回答を保持し、未回答を不可に変換しない。どちらの回答種別でも、初回に予定から補完する場合はuse_account_schedule=trueを指定し、個別指定がなければ選んだ種別の差分に空配列を渡す。新規再送は同じrequest_idと内容を使う。個人予定は変更しない。',
      inputSchema: answerInput,
      annotations: { ...write, idempotentHint: false },
      _meta: toolSecurity('save_my_answer'),
    },
    (input) => run('save_my_answer', () => saveMyAnswer(user.userId, input)),
  );
  server.registerTool(
    'save_my_answer_to_schedule',
    {
      description:
        '本人の保存済み時間回答の指定枠だけを個人予定へ保存する。mode=previewで確認し、本人が保存・上書きを希望した場合だけmode=applyと直前のプレビューで返されたexpected_revisionを指定する。対象枠を変える場合は再プレビューする。日付先行型では、timesのtrueまたはfalseが保存された時間枠だけを選ぶ。日付回答や未回答の時間枠は対象外。端数を1時間へ拡大せず、重なる登録済み予定は選択範囲だけ更新し外側を保持する。日時先行型の初回回答では、answered_date_idsに未指定のまま不可になった枠も含まれる。予定へ反映する枠だけを渡し、省略により不可になった枠は、本人がその枠を不可として個人予定に登録することを希望した場合だけ含める。他イベントの回答は更新しない。適用成功後は再実行しない。回答や予定の変更による競合で適用できなかった場合は再プレビューする。',
      inputSchema: answerScheduleInput,
      annotations: { ...write, idempotentHint: false },
      _meta: toolSecurity('save_my_answer_to_schedule'),
    },
    (input) => run('save_my_answer_to_schedule', () => saveMyAnswerToSchedule(user.userId, input)),
  );
  server.registerTool(
    'preview_my_schedule_update',
    {
      description:
        '予定変更を保存せず、新旧各イベントへの反映差分を確認する。日付先行型でコメント削除が必要ならrequires_confirmation、expected_revision、acknowledged_day_idsを返す。内容を本人が確認した場合にだけupdate_my_scheduleのconfirmed_eventsへ渡す。日時はAsia/Tokyo、YYYY-MM-DDTHH:00:00、最大7日。',
      inputSchema: scheduleInput,
      annotations: read,
      _meta: toolSecurity('preview_my_schedule_update'),
    },
    (input) => run('preview_my_schedule_update', () => previewMyScheduleUpdate(user.userId, input)),
  );
  server.registerTool(
    'update_my_schedule',
    {
      description:
        '本人の個人予定を保存し、紐づく全イベントの未来の回答へ反映する。先にpreview_my_schedule_updateで影響範囲を示し、本人がその範囲への反映を希望した場合に同じ期間・可否・allow_finalizedで実行する。これらを変える場合は再プレビューする。日本時間、毎正時、最大7日。手動上書き・手動未回答と過去回答を保持し、確定済みイベントにも反映するよう本人が明示した場合だけallow_finalized=trueを指定する。日付先行型でコメントの削除が必要な場合は、プレビューで削除対象を本人に提示する。本人が承認したイベントだけ、プレビューのpublic_token、expected_revision、acknowledged_day_idsをconfirmed_eventsに渡す。承認がないイベントの回答は更新せず、requires_confirmationを返す。予定保存と反映の部分失敗を区別し、同じ入力で再試行できる。',
      inputSchema: scheduleInput,
      annotations: write,
      _meta: toolSecurity('update_my_schedule'),
    },
    (input) => run('update_my_schedule', () => updateMySchedule(user.userId, input)),
  );
  return server;
}
