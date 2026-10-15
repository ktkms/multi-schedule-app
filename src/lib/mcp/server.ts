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
      return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
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
        '本人に紐づくイベントを期間・名前・確定状態で検索する。date_from/date_toは日本時間の日付で終了日も含む。date_targetの既定はeffective（未確定は候補、確定済みは確定日時）。candidateで元の候補、finalizedで確定日時を検索する。期間指定時は日程順。一致日時は最大3件で、省略フラグがtrueならget_eventで詳細を確認する。続きは同じ検索条件とlimitでoffsetを指定する。',
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
        '公開トークンからイベント、候補日時datesと確定日時finalized_datesを取得する。旧形式の確定日程も参照する。日時は既存の保存形式で、日本時間の壁時計時刻として読む。',
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
        '本人に紐づく回答を取得する。紐づきがなければanswerはnull。include_account_schedule=trueで対象期間のアカウント予定の判定と食い違いを取得する。予定のnullは判断不能であり参加可能ではない。既存回答の不可を未回答と推測しない。',
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
        '本人の回答を登録・編集する。既存回答は変更枠だけ指定し、未指定枠を保持する。use_account_schedule=trueは初回限定で保存済み予定から補完する。予定不明の省略枠は不可になるため必要なら事前に確認する。明示した回答だけを手動上書きとして保護する。アカウント予定は変更しない。保存結果のanswered_date_idsを予定保存の対象指定に使える。',
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
        '本人の保存済み回答の指定日時だけをアカウント予定へ保存する。まずmode=previewで差分を確認し、ユーザーが保存・上書きを希望した場合のみmode=applyと返却されたexpected_revisionを指定する。部分編集後はsave_my_answerのanswered_date_idsだけを渡す。初回の全回答保存は同フィールドの全枠を渡す。不可も記録する。他イベントの回答は変更しない。適用成功後は再実行せず、変更エラーなら再プレビューする。',
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
        '予定変更を保存せず、各イベントに反映される変更数を確認する。日時はAsia/Tokyo、YYYY-MM-DDTHH:00:00、最大7日。',
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
        '本人の予定を保存し、本人に紐づく全イベントの未来の回答へ反映する。日本時間、毎正時、最大7日。手動上書きと過去回答を保持し、確定済みイベントはallow_finalized=trueで明示された場合のみ更新する。部分失敗時は同じ入力で再試行できる。',
      inputSchema: scheduleInput,
      annotations: write,
      _meta: toolSecurity('update_my_schedule'),
    },
    (input) => run('update_my_schedule', () => updateMySchedule(user.userId, input)),
  );
  return server;
}
