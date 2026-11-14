import { useState } from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import DateFirstCreate from '@/components/date-first/create';
import DateFirstDatePicker from '@/components/date-first/date-picker';
import { saveDateFirst } from '@/lib/date-first-actions';

jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock('@/lib/date-first-actions', () => ({ saveDateFirst: jest.fn() }));
jest.mock('@/lib/event-history-actions', () => ({
  recordEventHistory: jest.fn().mockResolvedValue({ success: true }),
}));

function Picker({ existing = [] }: { existing?: string[] }) {
  const [days, setDays] = useState<string[]>([]);
  return <DateFirstDatePicker value={days} onChange={setDays} existing={existing} />;
}

function drag(from: string, to: string, via: string[] = []) {
  let target = screen.getByTestId(`candidate-date-${from}`);
  Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => target });
  fireEvent.pointerDown(screen.getByTestId(`candidate-date-${from}`), { pointerId: 1, button: 0 });
  for (const day of [...via, to]) {
    target = screen.getByTestId(`candidate-date-${day}`);
    fireEvent.pointerMove(window, { pointerId: 1, buttons: 1, clientX: 10, clientY: 10 });
  }
  fireEvent.pointerUp(window, { pointerId: 1 });
  Reflect.deleteProperty(document, 'elementFromPoint');
}

it('日付をドラッグして連続選択・解除でき、追加済みの日付は変更しない', () => {
  render(<Picker existing={['2099-11-08']} />);
  fireEvent.change(screen.getByLabelText('表示月'), { target: { value: '2099-11' } });
  drag('2099-11-07', '2099-11-09');
  expect(screen.getByTestId('candidate-date-2099-11-07')).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByTestId('candidate-date-2099-11-09')).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByTestId('candidate-date-2099-11-08')).toBeDisabled();
  expect(screen.getByTestId('candidate-date-2099-11-08')).toHaveAttribute('aria-pressed', 'false');
  drag('2099-11-07', '2099-11-09');
  expect(screen.getByText('0日選択中')).toBeInTheDocument();
  fireEvent.keyDown(screen.getByTestId('candidate-date-2099-11-09'), { key: ' ' });
  expect(screen.getByTestId('candidate-date-2099-11-09')).toHaveAttribute('aria-pressed', 'true');
});

it('縦のドラッグでは通過した週のマスだけを選び、間の暦日を補完しない', () => {
  render(<Picker />);
  fireEvent.change(screen.getByLabelText('表示月'), { target: { value: '2099-11' } });
  drag('2099-11-07', '2099-11-21', ['2099-11-14', '2099-11-07', '2099-11-14']);
  for (const day of ['07', '14', '21'])
    expect(screen.getByTestId(`candidate-date-2099-11-${day}`)).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  for (const day of ['08', '13', '15', '20'])
    expect(screen.getByTestId(`candidate-date-2099-11-${day}`)).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  drag('2099-11-07', '2099-11-21', ['2099-11-14']);
  expect(screen.getByText('0日選択中')).toBeInTheDocument();
});

it('ドラッグでまとめて選んでも、追加済みを含めた90日上限を超えない', () => {
  const existing = Array.from({ length: 89 }, (_, i) =>
    new Date(Date.UTC(2098, 0, i + 1)).toISOString().slice(0, 10),
  );
  render(<Picker existing={existing} />);
  fireEvent.change(screen.getByLabelText('表示月'), { target: { value: '2099-11' } });
  drag('2099-11-07', '2099-11-09');
  expect(screen.getByText('1日選択中（上限に達しました）')).toBeInTheDocument();
  expect(screen.getByTestId('candidate-date-2099-11-09')).toHaveAttribute('aria-pressed', 'false');
});

it('月を移動しても選択を保持し、一覧から別の月の日付を解除できる', () => {
  render(<Picker />);
  fireEvent.change(screen.getByLabelText('表示月'), { target: { value: '2099-11' } });
  fireEvent.click(screen.getByTestId('candidate-date-2099-11-07'));
  fireEvent.click(screen.getByRole('button', { name: '次の月' }));
  expect(screen.getByLabelText('表示月')).toHaveValue('2099-12');
  expect(screen.getByText('1日選択中')).toBeInTheDocument();
  fireEvent.click(screen.getByText('選択した日付を確認・解除'));
  fireEvent.click(screen.getByRole('button', { name: '2099/11/7(土)を外す' }));
  expect(screen.getByText('0日選択中')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '前の月' }));
  expect(screen.getByTestId('candidate-date-2099-11-07')).toHaveAttribute('aria-pressed', 'false');
});

it('確認画面では候補がある月を切り替えて候補日を確認できる', () => {
  render(<DateFirstCreate />);
  fireEvent.change(screen.getByTestId('date-first-title'), { target: { value: '複数月の予定' } });
  fireEvent.click(screen.getByTestId('date-first-create-next'));
  fireEvent.change(screen.getByLabelText('表示月'), { target: { value: '2099-11' } });
  fireEvent.click(screen.getByTestId('candidate-date-2099-11-07'));
  fireEvent.click(screen.getByRole('button', { name: '次の月' }));
  fireEvent.click(screen.getByTestId('candidate-date-2099-12-01'));
  fireEvent.click(screen.getByRole('button', { name: '朝（6〜12時）' }));
  fireEvent.click(screen.getByTestId('date-first-create-next'));
  expect(screen.getByRole('img')).toHaveAttribute('aria-label', '候補日：2099/11/7(土)');
  fireEvent.click(screen.getByRole('button', { name: '次の候補月' }));
  expect(screen.getByRole('img')).toHaveAttribute('aria-label', '候補日：2099/12/1(火)');
  fireEvent.click(screen.getByRole('button', { name: '戻る' }));
  expect(screen.getByTestId('candidate-date-2099-11-07')).toHaveAttribute('aria-pressed', 'true');
});

it('時刻ピッカーで翌朝の表示時間を設定し、重複しない候補日を確認して作成できる', async () => {
  jest.mocked(saveDateFirst).mockResolvedValue({
    success: true,
    value: { id: '77777777-7777-4777-8777-777777777777', token: 'created-event-token' },
  });
  render(<DateFirstCreate />);
  fireEvent.change(screen.getByTestId('date-first-title'), { target: { value: '会食の日付調整' } });
  fireEvent.click(screen.getByTestId('date-first-create-next'));
  fireEvent.change(screen.getByLabelText('表示月'), { target: { value: '2099-11' } });
  drag('2099-11-07', '2099-11-08');
  fireEvent.click(screen.getByTestId('date-first-create-next'));
  expect(screen.getByRole('alert')).toHaveTextContent('時間帯を選択してください。');
  fireEvent.click(screen.getByRole('button', { name: '夜（18〜24時）' }));
  expect(screen.getByText('選択した時間帯：18:00〜24:00')).toBeInTheDocument();
  fireEvent.click(screen.getByText('時刻を指定', { exact: true }));
  expect(screen.getByLabelText('開始の時')).toHaveValue('18');
  expect(screen.getByLabelText('終了の時')).toHaveValue('24');
  fireEvent.change(screen.getByLabelText('開始の時'), { target: { value: '22' } });
  fireEvent.change(screen.getByLabelText('終了の時'), { target: { value: '26' } });
  fireEvent.change(screen.getByLabelText('終了の分'), { target: { value: '01' } });
  fireEvent.click(screen.getByRole('button', { name: 'この時間帯を使う' }));
  expect(screen.getByRole('alert')).toHaveTextContent('26:00まで');
  fireEvent.change(screen.getByLabelText('終了の分'), { target: { value: '00' } });
  fireEvent.click(screen.getByRole('button', { name: 'この時間帯を使う' }));
  expect(screen.getByText('選択した時間帯：22:00〜翌2:00')).toBeInTheDocument();
  fireEvent.click(screen.getByTestId('date-first-create-next'));
  const list = screen.getByTestId('date-first-create-days');
  expect(within(list).getByRole('img')).toHaveAttribute(
    'aria-label',
    '候補日：2099/11/7(土)、2099/11/8(日)',
  );
  fireEvent.click(screen.getByLabelText(/利用規約/));
  fireEvent.click(screen.getByTestId('date-first-create-next'));
  await waitFor(() =>
    expect(saveDateFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'create',
        days: ['2099-11-07', '2099-11-08'],
        baseRanges: [[1320, 1560]],
      }),
    ),
  );
});
