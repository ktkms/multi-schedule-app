import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ShareAvailableDatesButton from '../share-available-dates-button';

jest.mock('@/components/analytics/google-analytics', () => ({ trackEvent: jest.fn() }));

const props = {
  eventTitle: 'バンド練習',
  publicToken: 'share-preview',
  participants: [
    { id: 'a', name: 'A' },
    { id: 'b', name: 'B' },
    { id: 'c', name: 'C' },
  ],
  eventDates: [10, 11].map((hour, i) => ({
    id: `d${i}`,
    start_time: `2026-10-20T${hour}:00:00`,
    end_time: `2026-10-20T${hour + 1}:00:00`,
  })),
  availabilities: [
    ['a', 'b'],
    ['b', 'c'],
  ].flatMap((ids, i) =>
    ids.map((id) => ({ participant_id: id, event_date_id: `d${i}`, availability: true })),
  ),
};
const originalShare = navigator.share;
const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');

afterEach(() => {
  navigator.share = originalShare;
  if (originalClipboard) Object.defineProperty(navigator, 'clipboard', originalClipboard);
  else Reflect.deleteProperty(navigator, 'clipboard');
});

it('共有前に本文を確認し、プレビューと同じ本文をコピーする', async () => {
  const share = jest.fn();
  navigator.share = share;
  const writeText = jest.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  render(<ShareAvailableDatesButton {...props} />);
  expect(screen.queryByLabelText('共有する本文')).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('最低参加人数'), { target: { value: '2' } });
  fireEvent.click(screen.getByRole('button', { name: '共有内容を確認' }));
  const preview = screen.getByLabelText<HTMLTextAreaElement>('共有する本文');
  expect(preview.value).toContain('10:00-11:00, 11:00-12:00');
  expect(share).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '共通日程の本文をコピー' }));
  await waitFor(() => expect(writeText).toHaveBeenCalledWith(preview.value));
  expect(share).not.toHaveBeenCalled();
});

it('Web Shareへプレビューの本文とURLを渡す', async () => {
  const share = jest.fn().mockResolvedValue(undefined);
  navigator.share = share;
  render(<ShareAvailableDatesButton {...props} />);
  fireEvent.change(screen.getByLabelText('最低参加人数'), { target: { value: '1' } });
  fireEvent.click(screen.getByRole('button', { name: '共有内容を確認' }));
  const preview = screen.getByLabelText<HTMLTextAreaElement>('共有する本文').value;
  fireEvent.click(screen.getByRole('button', { name: '共通日程を共有' }));
  await waitFor(() => expect(share).toHaveBeenCalled());
  const { text, url } = share.mock.calls[0][0];
  expect(`${text}\n${url}`).toBe(preview);
});

it('条件変更で本文を更新し、候補なしから復帰できる', () => {
  render(<ShareAvailableDatesButton {...props} />);
  fireEvent.change(screen.getByLabelText('最低参加人数'), { target: { value: '2' } });
  fireEvent.click(screen.getByRole('button', { name: '共有内容を確認' }));
  fireEvent.change(screen.getByLabelText('必要な連続時間'), { target: { value: '120' } });
  expect(screen.getByRole('status')).toHaveTextContent('条件に合う日程がありません');
  expect(screen.getByRole('button', { name: '共通日程を共有' })).toBeDisabled();
  expect(screen.getByRole('button', { name: '共通日程の本文をコピー' })).toBeDisabled();
  fireEvent.change(screen.getByLabelText('最低参加人数'), { target: { value: '1' } });
  fireEvent.click(screen.getByLabelText('A'));
  expect(screen.getByRole('status')).toBeInTheDocument();
  fireEvent.click(screen.getByLabelText('A'));
  fireEvent.click(screen.getByLabelText('B'));
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  expect(screen.getByLabelText<HTMLTextAreaElement>('共有する本文').value).toContain(
    '必須参加者: B',
  );
  expect(screen.getByRole('button', { name: '共通日程を共有' })).toBeEnabled();
});

it.each(['', '0', '4', '1.5'])('人数の不正入力 %s ではプレビューを開始できない', (value) => {
  render(<ShareAvailableDatesButton {...props} />);
  fireEvent.change(screen.getByLabelText('最低参加人数'), { target: { value } });
  expect(screen.getByRole('alert')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '共有内容を確認' })).toBeDisabled();
});

it('プレビューを閉じて条件設定に戻れる', () => {
  render(<ShareAvailableDatesButton {...props} />);
  fireEvent.click(screen.getByRole('button', { name: '共有内容を確認' }));
  fireEvent.click(screen.getByRole('button', { name: 'プレビューを閉じる' }));
  expect(screen.queryByLabelText('共有する本文')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: '共有内容を確認' })).toBeInTheDocument();
});
