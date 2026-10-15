import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
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

const openPreview = (count = '2') => {
  fireEvent.change(screen.getByLabelText('最低参加人数'), { target: { value: count } });
  fireEvent.click(screen.getByRole('button', { name: '共通日程を共有' }));
  return within(screen.getByRole('dialog', { name: '共有内容を確認' }));
};

it('通常表示を簡潔にし、共有内容からポップアップを開く', () => {
  render(<ShareAvailableDatesButton {...props} />);
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('連続時間')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /コピー/ })).not.toBeInTheDocument();
  const dialog = openPreview();
  expect(dialog.getByRole('document').textContent).toContain('10:00-11:00, 11:00-12:00');
  expect(dialog.queryByRole('button', { name: /コピー/ })).not.toBeInTheDocument();
});

it('ポップアップ内から、確認した本文とURLをWeb Shareへ渡す', async () => {
  const share = jest.fn().mockResolvedValue(undefined);
  navigator.share = share;
  render(<ShareAvailableDatesButton {...props} />);
  const dialog = openPreview('1');
  const preview = dialog.getByRole('document').textContent;
  expect(share).not.toHaveBeenCalled();
  fireEvent.click(dialog.getByRole('button', { name: '共有する' }));
  await waitFor(() => expect(share).toHaveBeenCalled());
  const { text, url } = share.mock.calls[0][0];
  expect(`${text}\n${url}`).toBe(preview);
});

it('端末共有が非対応の場合は同じ共有操作で本文とURLをコピーする', async () => {
  Object.defineProperty(navigator, 'share', {
    value: undefined,
    configurable: true,
    writable: true,
  });
  const writeText = jest.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  render(<ShareAvailableDatesButton {...props} />);
  const dialog = openPreview();
  const preview = dialog.getByRole('document').textContent;
  fireEvent.click(dialog.getByRole('button', { name: '共有する' }));
  await waitFor(() => expect(writeText).toHaveBeenCalledWith(preview));
});

it('ポップアップ内の条件変更で本文を更新し、候補なしから復帰できる', () => {
  render(<ShareAvailableDatesButton {...props} />);
  const dialog = openPreview();
  fireEvent.change(dialog.getByLabelText('連続時間'), { target: { value: '120' } });
  expect(dialog.getByRole('status')).toHaveTextContent('条件に合う日程がありません');
  expect(dialog.getByRole('button', { name: '共有する' })).toBeDisabled();
  fireEvent.change(dialog.getByLabelText('参加人数'), { target: { value: '1' } });
  fireEvent.click(dialog.getByLabelText('A'));
  expect(dialog.getByRole('status')).toBeInTheDocument();
  fireEvent.click(dialog.getByLabelText('A'));
  fireEvent.click(dialog.getByLabelText('B'));
  expect(dialog.queryByRole('status')).not.toBeInTheDocument();
  expect(dialog.getByRole('document').textContent).toContain('必須参加者: B');
  expect(dialog.getByRole('button', { name: '共有する' })).toBeEnabled();
  fireEvent.change(dialog.getByLabelText('参加人数'), { target: { value: '0' } });
  expect(dialog.getByRole('alert')).toBeInTheDocument();
  expect(dialog.getByRole('button', { name: '共有する' })).toBeDisabled();
});

it.each(['', '0', '4', '1.5'])('人数の不正入力 %s ではプレビューを開始できない', (value) => {
  render(<ShareAvailableDatesButton {...props} />);
  fireEvent.change(screen.getByLabelText('最低参加人数'), { target: { value } });
  expect(screen.getByRole('alert')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '共通日程を共有' })).toBeDisabled();
});

it('閉じる・Escapeでポップアップを閉じ、元のボタンへフォーカスを戻す', () => {
  render(<ShareAvailableDatesButton {...props} />);
  const trigger = screen.getByRole('button', { name: '共通日程を共有' });
  trigger.focus();
  const dialog = openPreview();
  fireEvent.click(dialog.getByRole('button', { name: '閉じる' }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(trigger).toHaveFocus();
  fireEvent.click(trigger);
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(trigger).toHaveFocus();
});
