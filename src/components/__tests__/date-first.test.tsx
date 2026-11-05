import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import DateFirstAnswerEditor from '@/components/date-first/answer';
import DateFirstEventView from '@/components/date-first/event';
import DateFirstTimeGrid from '@/components/date-first/time-grid';
import {
  getDateFirstAnswer,
  getDateFirstDayDetails,
  saveDateFirst,
} from '@/lib/date-first-actions';
import type { DateFirstAnswer, DateFirstEvent } from '@/lib/date-first-schema';
const mockPush = jest.fn();
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock('@/components/event-history', () => ({ __esModule: true, default: () => null }));

jest.mock('@/lib/date-first-actions', () => ({
  saveDateFirst: jest.fn(),
  getDateFirstAnswer: jest.fn(),
  getDateFirstDayDetails: jest.fn(),
}));
jest.mock('@/lib/event-history-actions', () => ({
  recordEventHistory: jest.fn().mockResolvedValue({ success: true }),
}));
const ids = [
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  '33333333-3333-4333-8333-333333333333',
];
const participant = '44444444-4444-4444-8444-444444444444';
const slots = ['55555555-5555-4555-8555-555555555555', '66666666-6666-4666-8666-666666666666'];
const data: DateFirstEvent = {
  event: {
    id: '77777777-7777-4777-8777-777777777777',
    title: '会食',
    description: null,
    token: 'public-token-123',
    stage: 'times',
    revision: '0',
    baseRanges: [[600, 1320]],
  },
  participants: [{ id: participant, name: '参加者' }],
  days: ids.map((id, i) => ({
    id,
    date: `2026-11-0${7 + i}`,
    confirmed: false,
    target: true,
    yes: 0,
    maybe: 1,
    no: 0,
    unanswered: 0,
  })),
  slots: slots.map((id, i) => ({
    id,
    dayId: ids[0],
    start: 600 + i * 30,
    end: 660 + i * 30,
    finalized: false,
    yes: 0,
    no: 0,
    unanswered: 1,
  })),
};
const answer: DateFirstAnswer = {
  id: participant,
  name: '参加者',
  dayRevision: '0',
  timeRevision: '0',
  days: [
    {
      id: ids[0],
      status: 'maybe',
      source: 'account',
      comment: '元のコメント',
      intervals: [[600, 660]],
    },
  ],
  times: [],
};
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(saveDateFirst).mockResolvedValue({
    success: false,
    code: 'retryable_error',
    message: '入力を保持しています',
  });
});
const reviewAndSave = async () => {
  fireEvent.click(screen.getByLabelText(/利用規約/));
  fireEvent.click(screen.getByTestId('date-first-answer-review'));
  fireEvent.click(
    within(screen.getByRole('dialog', { name: '回答を保存する' })).getByRole('button', {
      name: 'この内容で保存',
    }),
  );
  await waitFor(() => expect(saveDateFirst).toHaveBeenCalled());
};
it('表示の拡張だけでは回答を変更せず、当日0時から翌6時の境界で止める', () => {
  const change = jest.fn();
  render(<DateFirstTimeGrid id="grid" value={[]} baseRanges={[[0, 1440]]} onChange={change} />);
  expect(screen.getByRole('button', { name: '表示を1時間早める' })).toBeDisabled();
  expect(screen.getByRole('group', { name: '参加可能な時間' })).toHaveAccessibleDescription(
    '可能な時間を入力してください。',
  );
  for (let i = 0; i < 6; i++)
    fireEvent.click(screen.getByRole('button', { name: '表示を1時間後ろに延ばす' }));
  expect(screen.getByRole('button', { name: '翌5:00〜翌6:00' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '表示を1時間早める' })).toBeDisabled();
  expect(screen.getByRole('button', { name: '表示を1時間後ろに延ばす' })).toBeDisabled();
  expect(change).not.toHaveBeenCalled();
});

it('既存回答を変更せず確認しても、全未回答と表示しない', () => {
  render(<DateFirstAnswerEditor data={data} initialAnswer={answer} kind="days" />);
  fireEvent.click(screen.getByLabelText(/利用規約/));
  fireEvent.click(screen.getByTestId('date-first-answer-review'));
  expect(screen.getByRole('dialog')).toHaveTextContent('日付の回答は変更しません。');
  expect(screen.getByRole('dialog')).not.toHaveTextContent('日付はすべて未回答です。');
});

it('日付回答のプレビューで、日付・△・時間条件・コメントをまとめて確認できる', () => {
  render(<DateFirstAnswerEditor data={data} initialAnswer={answer} kind="days" />);
  fireEvent.click(screen.getByRole('button', { name: /のコメント（入力済み）/ }));
  fireEvent.change(screen.getByRole('textbox', { name: /のコメント/ }), {
    target: { value: '途中から参加' },
  });
  fireEvent.click(screen.getByLabelText(/利用規約/));
  fireEvent.click(screen.getByTestId('date-first-answer-review'));
  const modal = within(screen.getByRole('dialog', { name: '回答を保存する' }));
  expect(modal.getAllByText('2026/11/7(土)')).toHaveLength(1);
  expect(modal.getByRole('img', { name: '△' })).toBeInTheDocument();
  expect(modal.getByText('10:00〜11:00')).toBeInTheDocument();
  expect(modal.getByText('途中から参加')).toBeInTheDocument();
  fireEvent.click(modal.getByRole('button', { name: '入力に戻る' }));
  expect(screen.getByRole('textbox', { name: /のコメント/ })).toHaveValue('途中から参加');
});

it('詳細時間のプレビューは同じ日付を一度だけ示し、各時間の回答を並べる', () => {
  render(<DateFirstAnswerEditor data={data} initialAnswer={answer} kind="times" />);
  fireEvent.click(screen.getByTestId(`time-${slots[0]}-true`));
  fireEvent.click(screen.getByTestId(`time-${slots[1]}-false`));
  fireEvent.click(screen.getByLabelText(/利用規約/));
  fireEvent.click(screen.getByTestId('date-first-answer-review'));
  const modal = within(screen.getByRole('dialog', { name: '回答を保存する' }));
  expect(modal.getAllByText('2026/11/7(土)')).toHaveLength(1);
  expect(modal.getAllByRole('listitem')).toHaveLength(2);
  expect(modal.getByRole('img', { name: '○' })).toBeInTheDocument();
  expect(modal.getByRole('img', { name: '×' })).toBeInTheDocument();
});

it('コメントを開くと入力欄へフォーカスし、入力中の更新でもフォーカスを維持する', () => {
  render(<DateFirstAnswerEditor data={data} initialAnswer={answer} kind="days" />);
  fireEvent.click(screen.getByRole('button', { name: /のコメント（入力済み）/ }));
  const input = screen.getByRole('textbox', { name: /のコメント/ });
  expect(input).toHaveFocus();
  fireEvent.change(input, { target: { value: '入力を続ける' } });
  expect(input).toHaveFocus();
});

it('記号の操作中もコメントUIを無効表示へ切り替えず、誤操作だけを防ぐ', () => {
  render(<DateFirstAnswerEditor data={data} initialAnswer={answer} kind="days" />);
  const comment = screen.getByRole('button', { name: /のコメント（入力済み）/ });
  fireEvent.click(comment);
  const input = screen.getByRole('textbox', { name: /のコメント/ });
  fireEvent.pointerDown(screen.getByTestId(`day-${ids[0]}-yes`), { pointerId: 1, button: 0 });
  expect(comment).not.toBeDisabled();
  expect(input).not.toBeDisabled();
  expect(input).toHaveAttribute('readonly');
  fireEvent.click(comment);
  expect(input).toBeInTheDocument();
  fireEvent.pointerCancel(window, { pointerId: 1 });
  expect(input).not.toHaveAttribute('readonly');
});

it('過去に△だった日でも、ドラッグ中に時間欄を再展開せず終了後に開く', () => {
  render(<DateFirstAnswerEditor data={data} initialAnswer={null} kind="days" />);
  const first = screen.getByTestId(`day-${ids[0]}-maybe`);
  fireEvent.click(first, { detail: 0 });
  expect(document.querySelectorAll('[data-time-grid]')).toHaveLength(1);
  fireEvent.click(screen.getByTestId(`day-${ids[0]}-no`), { detail: 0 });
  expect(document.querySelectorAll('[data-time-grid]')).toHaveLength(0);
  fireEvent.pointerDown(first, { pointerId: 1, button: 0 });
  expect(document.querySelectorAll('[data-time-grid]')).toHaveLength(0);
  fireEvent.pointerCancel(window, { pointerId: 1 });
  expect(screen.getByTestId(`day-${ids[0]}-no`)).toHaveAttribute('aria-pressed', 'true');
  fireEvent.pointerDown(first, { pointerId: 2, button: 0 });
  expect(document.querySelectorAll('[data-time-grid]')).toHaveLength(0);
  fireEvent.pointerUp(window, { pointerId: 2 });
  expect(document.querySelectorAll('[data-time-grid]')).toHaveLength(1);
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

it('詳細パネルで回答とコメントを確認し、別のマスへ切り替えると表示を更新する', async () => {
  jest.mocked(getDateFirstDayDetails).mockResolvedValue([
    {
      id: participant,
      name: '参加者',
      status: 'maybe',
      comment: '詳細コメント',
      intervals: [
        [600, 660],
        [1440, 1800],
      ],
    },
  ]);
  render(<DateFirstEventView data={data} />);
  expect(getDateFirstDayDetails).not.toHaveBeenCalled();
  fireEvent.click(screen.getByTestId(`day-results-${ids[0]}`));
  fireEvent.click(await screen.findByRole('button', { name: '参加者さんのコメント' }));
  expect(screen.getByText('詳細コメント')).toBeInTheDocument();
  expect(screen.getByText('10:00〜11:00、24:00〜翌6:00')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '回答詳細を閉じる' }));
  expect(screen.queryByText('詳細コメント')).not.toBeInTheDocument();
  fireEvent.click(screen.getByTestId(`day-results-${ids[1]}`));
  await screen.findByRole('button', { name: '参加者さんのコメント' });
  expect(screen.queryByText('詳細コメント')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '参加者さんのコメント' }));
  expect(screen.getByText('詳細コメント')).toBeInTheDocument();
});

it('同じ記号の単独再タップは未回答にし、別日付を送信しない', async () => {
  render(<DateFirstAnswerEditor data={data} initialAnswer={answer} kind="days" />);
  fireEvent.click(screen.getByTestId(`day-${ids[0]}-maybe`), { detail: 0 });
  await reviewAndSave();
  expect(saveDateFirst).toHaveBeenCalledWith(
    expect.objectContaining({ changes: [{ id: ids[0], status: null }] }),
  );
  expect(screen.getByText('入力を保持しています')).toBeInTheDocument();
});
it('複数日への△ドラッグで自動的に一括入力を開き、設定後は個別に修正できる', () => {
  render(<DateFirstAnswerEditor data={data} initialAnswer={answer} kind="days" />);
  const first = screen.getByTestId(`day-${ids[0]}-maybe`);
  const second = screen.getByTestId(`day-${ids[1]}-maybe`);
  Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => second });
  fireEvent.pointerDown(first, { pointerId: 1, button: 0, clientX: 10, clientY: 10 });
  fireEvent.pointerMove(window, { pointerId: 1, clientX: 10, clientY: 80, buttons: 1 });
  expect(second).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByTestId(`day-answer-${ids[1]}`).querySelector('[data-time-grid]')).toBeNull();
  fireEvent.pointerUp(window, { pointerId: 1 });
  Reflect.deleteProperty(document, 'elementFromPoint');
  const modal = screen.getByRole('dialog', { name: '△の日の参加可能時間' });
  expect(within(modal).getAllByRole('checkbox', { checked: true })).toHaveLength(3);
  expect(within(modal).getByRole('button', { name: '選択した日へ設定' })).toBeDisabled();
  fireEvent.click(within(modal).getByRole('button', { name: '11:00〜12:00' }), { detail: 0 });
  fireEvent.click(within(modal).getByRole('button', { name: '選択した日へ設定' }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  const firstTime = within(screen.getByTestId(`day-answer-${ids[0]}`)).getByRole('button', {
    name: '11:00〜12:00',
  });
  fireEvent.click(firstTime, { detail: 0 });
  expect(firstTime).toHaveAttribute('aria-pressed', 'false');
  expect(
    within(screen.getByTestId(`day-answer-${ids[1]}`)).getByRole('button', {
      name: '11:00〜12:00',
    }),
  ).toHaveAttribute('aria-pressed', 'true');
});

it('△から×を経て△へ戻すと個別の時間とコメントが復元する', () => {
  render(<DateFirstAnswerEditor data={data} initialAnswer={answer} kind="days" />);
  fireEvent.click(screen.getByTestId(`day-${ids[0]}-no`), { detail: 0 });
  fireEvent.click(screen.getByTestId(`day-${ids[0]}-maybe`), { detail: 0 });
  expect(
    within(screen.getByTestId(`day-answer-${ids[0]}`)).getByRole('button', {
      name: '10:00〜11:00',
    }),
  ).toHaveAttribute('aria-pressed', 'true');
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /のコメント（入力済み）/ }));
  expect(screen.getByRole('textbox', { name: /のコメント/ })).toHaveValue('元のコメント');
});

it('自動表示した一括入力をキャンセルすると、各日付の時間を維持する', () => {
  render(<DateFirstAnswerEditor data={data} initialAnswer={answer} kind="days" />);
  const second = screen.getByTestId(`day-${ids[1]}-maybe`);
  Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => second });
  fireEvent.pointerDown(screen.getByTestId(`day-${ids[0]}-maybe`), { pointerId: 1, button: 0 });
  fireEvent.pointerMove(window, { pointerId: 1, buttons: 1, clientY: 80 });
  fireEvent.pointerUp(window, { pointerId: 1 });
  Reflect.deleteProperty(document, 'elementFromPoint');
  const modal = screen.getByRole('dialog', { name: '△の日の参加可能時間' });
  fireEvent.click(within(modal).getByRole('button', { name: '11:00〜12:00' }), { detail: 0 });
  fireEvent.click(within(modal).getByRole('button', { name: 'キャンセル' }));
  const first = within(screen.getByTestId(`day-answer-${ids[0]}`));
  expect(first.getByRole('button', { name: '10:00〜11:00' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  expect(first.getByRole('button', { name: '11:00〜12:00' })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  expect(saveDateFirst).not.toHaveBeenCalled();
});

it('コメント単独編集では記号・時間・sourceを送信しない', async () => {
  render(<DateFirstAnswerEditor data={data} initialAnswer={answer} kind="days" />);
  fireEvent.click(screen.getByRole('button', { name: /のコメント（入力済み）/ }));
  fireEvent.change(screen.getByRole('textbox', { name: /のコメント/ }), {
    target: { value: 'コメント更新' },
  });
  await reviewAndSave();
  expect(saveDateFirst).toHaveBeenCalledWith(
    expect.objectContaining({ changes: [{ id: ids[0], comment: 'コメント更新' }] }),
  );
});
it.each([true, false])('候補期間の予定は確認後にだけ入力する（取り込む: %s）', (apply) => {
  render(
    <DateFirstAnswerEditor
      data={data}
      initialAnswer={answer}
      kind="days"
      scheduleDraft={{
        days: [{ id: ids[1], status: 'maybe', intervals: [[660, 720]] }],
        times: [],
      }}
    />,
  );
  const dialog = screen.getByRole('dialog', { name: '予定を取り込みますか？' });
  const day = screen.getByTestId(`day-${ids[1]}-maybe`);
  expect(day).toHaveAttribute('aria-pressed', 'false');
  fireEvent.click(
    within(dialog).getByRole('button', { name: apply ? '取り込む' : '取り込まずに続ける' }),
  );
  expect(dialog).not.toBeInTheDocument();
  expect(day).toHaveAttribute('aria-pressed', String(apply));
  expect(saveDateFirst).not.toHaveBeenCalled();
});
it('同じ自動回答や未登録の予定では確認を表示せず、コメントだけの編集を維持する', async () => {
  render(
    <DateFirstAnswerEditor
      data={data}
      initialAnswer={answer}
      kind="days"
      scheduleDraft={{
        days: [
          { id: ids[0], status: 'maybe', intervals: [[600, 660]] },
          { id: ids[1], status: null, intervals: [] },
        ],
        times: [],
      }}
    />,
  );
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /のコメント（入力済み）/ }));
  fireEvent.change(screen.getByRole('textbox', { name: /のコメント/ }), {
    target: { value: 'コメントだけ更新' },
  });
  await reviewAndSave();
  expect(saveDateFirst).toHaveBeenCalledWith(
    expect.objectContaining({ changes: [{ id: ids[0], comment: 'コメントだけ更新' }] }),
  );
});
it('保存後は同じ参加者IDを保って完了画面へ進む', async () => {
  jest.mocked(saveDateFirst).mockResolvedValue({ success: true, value: { id: participant } });
  render(<DateFirstAnswerEditor data={data} initialAnswer={answer} kind="days" />);
  fireEvent.click(screen.getByTestId(`day-${ids[0]}-yes`), { detail: 0 });
  await reviewAndSave();
  await waitFor(() =>
    expect(mockPush).toHaveBeenCalledWith(
      `/event/${data.event.token}/input/complete?participant_id=${participant}&kind=days`,
    ),
  );
});
it('時間回答の入口では本人の既存回答を継続し、初回回答を区別する', () => {
  render(<DateFirstEventView data={data} myParticipantId={participant} />);
  expect(screen.getByRole('link', { name: '時間を回答する' })).toHaveAttribute(
    'href',
    `/event/${data.event.token}/input?participant_id=${participant}&kind=times`,
  );
  expect(screen.getByRole('link', { name: '初めて回答する' })).toHaveAttribute(
    'href',
    `/event/${data.event.token}/input?kind=times`,
  );
});
it('参加者を非表示にすると、ヒートマップの人数も選択対象に揃う', async () => {
  jest.mocked(getDateFirstAnswer).mockResolvedValue({
    ...answer,
    days: [{ ...answer.days[0], status: 'yes', comment: null, intervals: [] }],
  });
  render(<DateFirstEventView data={data} />);
  const summary = screen.getByText('参加者の表示・共通日程の共有');
  const panel = summary.closest('details')!;
  fireEvent.click(summary);
  const participantButton = await within(panel).findByRole('button', { name: '参加者' });
  fireEvent.click(participantButton);
  expect(screen.getByTestId(`day-results-${ids[0]}`)).toHaveAccessibleName(
    /○0人、△0人、×0人、未回答0人/,
  );
  expect(screen.getByText('表示0人 / 参加者1人')).toBeInTheDocument();
});
it('△からは全枠が被覆される候補だけを提案し、明示採用・保存するまで正式回答にしない', async () => {
  render(<DateFirstAnswerEditor data={data} initialAnswer={answer} kind="times" />);
  fireEvent.click(screen.getByRole('button', { name: '△の時間から提案を確認' }));
  const modal = screen.getByRole('dialog', { name: '△の時間からの提案' });
  expect(within(modal).getAllByRole('listitem')).toHaveLength(1);
  expect(saveDateFirst).not.toHaveBeenCalled();
  fireEvent.click(within(modal).getByRole('button', { name: '提案を入力に採用' }));
  await reviewAndSave();
  expect(saveDateFirst).toHaveBeenCalledWith(
    expect.objectContaining({ changes: [{ id: slots[0], availability: true }] }),
  );
});
it('手動の未回答は、△からの提案でも上書きしない', () => {
  render(
    <DateFirstAnswerEditor
      data={data}
      initialAnswer={{ ...answer, times: [{ id: slots[0], availability: null, source: 'manual' }] }}
      kind="times"
    />,
  );
  expect(screen.queryByRole('button', { name: '△の時間から提案を確認' })).not.toBeInTheDocument();
});
it('競合時は入力を保持し、最新確認後も未編集コメントを上書きしない', async () => {
  jest
    .mocked(saveDateFirst)
    .mockResolvedValue({ success: false, code: 'stale_revision', message: '競合' });
  jest.mocked(getDateFirstAnswer).mockResolvedValue({
    ...answer,
    dayRevision: '1',
    days: [{ ...answer.days[0], comment: '別の人の更新' }],
  });
  render(<DateFirstAnswerEditor data={data} initialAnswer={answer} kind="days" />);
  fireEvent.click(screen.getByTestId(`day-${ids[0]}-yes`), { detail: 0 });
  await reviewAndSave();
  const modal = await screen.findByRole('dialog', { name: '他の変更が保存されています' });
  expect(within(modal).getByText(/別の人の更新/)).toBeInTheDocument();
  fireEvent.click(within(modal).getByRole('button', { name: '最新内容を踏まえて編集を続ける' }));
  expect(screen.getByTestId(`day-${ids[0]}-yes`)).toHaveAttribute('aria-pressed', 'true');
  fireEvent.click(screen.getByTestId('date-first-answer-review'));
  fireEvent.click(
    within(screen.getByRole('dialog', { name: '回答を保存する' })).getByRole('button', {
      name: 'この内容で保存',
    }),
  );
  await waitFor(() => expect(saveDateFirst).toHaveBeenCalledTimes(2));
  expect(saveDateFirst).toHaveBeenLastCalledWith(
    expect.objectContaining({ revision: '1', changes: [{ id: ids[0], status: 'yes' }] }),
  );
});
