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
        '本人に紐づく回答を取得する。紐づきがなければanswerはnull。日付先行型はdaysの○△×/nullと条件・コメント、timesのtrue/false/null、source、dayRevision/timeRevisionを返す。行なしとnullは未回答であり不可ではない。include_account_schedule=trueで、保存や初回登録を行わず本人予定の判定も取得する。日付○は当日0〜24時で、翌朝や正式な時間回答へコピーしない。',
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
        '本人の回答を登録・編集する。日時先行型は従来どおりname/availabilitiesを指定し、省略枠の既存契約を維持する。日付先行型はscheduling_mode=date_first、answer_kind=days/times、expected_revisionを必須とし、day_changes/time_changesの差分を送る。revisionはget_my_answerの各段階の値。新規はrequest_id/nameとrevision=0、編集は名前やrequest_idを送らない。未指定・未回答を×へ変換しない。use_account_schedule=trueは初回だけで、手動値を守って予定から補完する。新規再送は同じrequest_id・内容を使う。個人予定は変更しない。',
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
        '本人の保存済み時間回答の指定枠だけを個人予定へ保存する。mode=previewで確認し、本人が保存・上書きを希望した場合だけmode=applyとexpected_revisionを指定する。日付先行型は正式な○/×のみ対象で、日付記号・null・行なしを予定へ変換しない。端数を1時間へ拡大せず、重なる登録済み予定は選択範囲だけ更新し外側を保持する。他イベントの回答は更新しない。適用成功後は再実行せず、変更エラーなら再プレビューする。',
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
        '本人の予定を保存し、紐づく新旧イベントの未来の回答へ反映する。日本時間、毎正時、最大7日。手動上書き・手動未回答と過去回答を保持し、確定済みイベントはallow_finalized=trueの場合だけ反映する。日付先行型のコメント削除はconfirmed_eventsで確認した指紋と対象が一致する場合だけ許可する。未確認ならそのイベントを全件無変更にしrequires_confirmationを返す。予定保存と反映の部分失敗を区別し、同じ入力で再試行できる。',
      inputSchema: scheduleInput,
      annotations: write,
      _meta: toolSecurity('update_my_schedule'),
    },
    (input) => run('update_my_schedule', () => updateMySchedule(user.userId, input)),
  );
  return server;
}
