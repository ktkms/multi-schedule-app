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
  expect(screen.getByText('0日選択 / 残り89日追加可能')).toBeInTheDocument();
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
  expect(screen.getByText('0日選択 / 残り90日追加可能')).toBeInTheDocument();
});

it('ドラッグでまとめて選んでも、追加済みを含めた90日上限を超えない', () => {
  const existing = Array.from({ length: 89 }, (_, i) =>
    new Date(Date.UTC(2098, 0, i + 1)).toISOString().slice(0, 10),
  );
  render(<Picker existing={existing} />);
  fireEvent.change(screen.getByLabelText('表示月'), { target: { value: '2099-11' } });
  drag('2099-11-07', '2099-11-09');
  expect(screen.getByText('1日選択 / 残り0日追加可能')).toBeInTheDocument();
  expect(screen.getByTestId('candidate-date-2099-11-09')).toHaveAttribute('aria-pressed', 'false');
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
  fireEvent.click(screen.getByRole('button', { name: '夜（18〜24時）' }));
  expect(screen.getByText('表示する時間帯：18:00〜24:00')).toBeInTheDocument();
  fireEvent.click(screen.getByText('時刻を指定', { exact: true }));
  expect(screen.getByLabelText('表示開始時刻')).toHaveValue('18:00');
  expect(screen.getByLabelText('表示終了の日付')).toHaveValue('next');
  fireEvent.change(screen.getByLabelText('表示開始時刻'), { target: { value: '22:00' } });
  fireEvent.change(screen.getByLabelText('表示終了の日付'), { target: { value: 'next' } });
  fireEvent.change(screen.getByLabelText('表示終了時刻'), { target: { value: '02:00' } });
  fireEvent.click(screen.getByRole('button', { name: 'この時間帯を使う' }));
  expect(screen.getByText('表示する時間帯：22:00〜翌2:00')).toBeInTheDocument();
  fireEvent.click(screen.getByTestId('date-first-create-next'));
  const list = screen.getByTestId('date-first-create-days');
  expect(within(list).getAllByRole('listitem')).toHaveLength(2);
  expect(list).not.toHaveTextContent('2099-11-07');
  expect(within(list).getByText('2099/11/7(土)')).toBeInTheDocument();
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
