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
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn() }) }));

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

it('日付・コメントを複数展開でき、日付を閉じるとそのコメント展開だけリセットする', async () => {
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
  await screen.findByRole('button', { name: '参加者さんのコメント' });
  fireEvent.click(screen.getByRole('button', { name: '参加者さんのコメント' }));
  fireEvent.click(screen.getByTestId(`day-results-${ids[1]}`));
  await waitFor(() =>
    expect(screen.getAllByRole('button', { name: '参加者さんのコメント' })).toHaveLength(2),
  );
  fireEvent.click(screen.getAllByRole('button', { name: '参加者さんのコメント' })[1]);
  expect(screen.getAllByText('詳細コメント')).toHaveLength(2);
  expect(screen.getAllByText('10:00〜11:00、24:00〜翌6:00')).toHaveLength(2);
  fireEvent.click(screen.getByTestId(`day-results-${ids[0]}`));
  expect(screen.getAllByText('詳細コメント')).toHaveLength(1);
  fireEvent.click(screen.getByTestId(`day-results-${ids[0]}`));
  await waitFor(() =>
    expect(screen.getAllByRole('button', { name: '参加者さんのコメント' })).toHaveLength(2),
  );
  expect(screen.getAllByText('詳細コメント')).toHaveLength(1);
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
it('選択済み△からのドラッグは解除せず、終了後に新しい△の時間欄を開く', () => {
  render(<DateFirstAnswerEditor data={data} initialAnswer={answer} kind="days" />);
  const first = screen.getByTestId(`day-${ids[0]}-maybe`),
    second = screen.getByTestId(`day-${ids[1]}-maybe`);
  Object.defineProperty(document, 'elementFromPoint', {
    configurable: true,
    value: jest.fn(() => second),
  });
  fireEvent.pointerDown(first, { pointerId: 1, button: 0, clientX: 10, clientY: 10 });
  fireEvent.pointerMove(window, { pointerId: 1, clientX: 10, clientY: 80, buttons: 1 });
  expect(second).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByTestId(`day-answer-${ids[1]}`).querySelector('[data-time-grid]')).toBeNull();
  fireEvent.pointerUp(window, { pointerId: 1 });
  expect(first).toHaveAttribute('aria-pressed', 'true');
  expect(
    screen.getByTestId(`day-answer-${ids[1]}`).querySelector('[data-time-grid]'),
  ).not.toBeNull();
  Reflect.deleteProperty(document, 'elementFromPoint');
});
it('△から×を経て△へ戻すと時間とコメントが復元し、コメントだけの編集はsourceを変えないパッチにする', async () => {
  render(<DateFirstAnswerEditor data={data} initialAnswer={answer} kind="days" />);
  fireEvent.click(screen.getByTestId(`day-${ids[0]}-no`), { detail: 0 });
  fireEvent.click(screen.getByTestId(`day-${ids[0]}-maybe`), { detail: 0 });
  expect(
    within(screen.getByTestId(`day-answer-${ids[0]}`)).getByRole('button', {
      name: '10:00〜11:00',
    }),
  ).toHaveAttribute('aria-pressed', 'true');
  fireEvent.click(screen.getByRole('button', { name: /のコメント（入力済み）/ }));
  expect(screen.getByRole('textbox', { name: /のコメント/ })).toHaveValue('元のコメント');
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
it('△からは全枠が被覆される候補だけを提案し、明示採用・保存するまで正式回答にしない', async () => {
  render(<DateFirstAnswerEditor data={data} initialAnswer={answer} kind="times" />);
  fireEvent.click(screen.getByRole('button', { name: '△の時間から提案を確認' }));
  const modal = screen.getByRole('dialog', { name: '△時間からの提案' });
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
