import { fireEvent, render, screen, within } from '@testing-library/react';
import DateFirstDayHeatmap from '@/components/date-first/day-heatmap';
import type { DateFirstEvent } from '@/lib/date-first-schema';

it('コメントのあるマスを識別でき、ホバーと操作でその場の詳細へ進める', () => {
  const days: DateFirstEvent['days'] = ['2026-11-07', '2026-11-08'].map((date, i) => ({
    id: `day-${i}`,
    date,
    confirmed: false,
    target: true,
    yes: 1,
    maybe: 1,
    no: 0,
    unanswered: 0,
    hasComment: i === 0,
  }));
  const toggle = jest.fn();
  render(
    <DateFirstDayHeatmap
      days={days}
      participantCount={2}
      activeDayId={null}
      onInspect={toggle}
      onLeave={jest.fn()}
    />,
  );
  const marked = screen.getByRole('button', { name: /2026\/11\/7.*コメントあり/ });
  expect(screen.getByTestId('day-results-day-1')).not.toHaveAccessibleName(/コメントあり/);
  fireEvent.pointerEnter(marked, { pointerType: 'mouse' });
  expect(toggle).toHaveBeenCalledWith('day-0', marked, false);
  fireEvent.click(marked);
  expect(toggle).toHaveBeenCalledWith('day-0', marked, true);
});

it('回答がない候補日には人数を表示せず、回答済みの○0とは区別できる', () => {
  const days: DateFirstEvent['days'] = [
    {
      id: 'empty',
      date: '2026-11-07',
      confirmed: false,
      target: true,
      yes: 0,
      maybe: 0,
      no: 0,
      unanswered: 2,
    },
    {
      id: 'conditional',
      date: '2026-11-08',
      confirmed: false,
      target: true,
      yes: 0,
      maybe: 1,
      no: 0,
      unanswered: 1,
    },
  ];
  render(
    <DateFirstDayHeatmap
      days={days}
      participantCount={2}
      activeDayId={null}
      onInspect={jest.fn()}
      onLeave={jest.fn()}
    />,
  );
  expect(screen.getByTestId('day-results-empty')).toHaveTextContent(/^7$/);
  expect(screen.getByTestId('day-results-empty')).toHaveAccessibleName(/回答なし、未回答2人/);
  expect(screen.getByTestId('day-results-conditional')).toHaveTextContent('○0');
  expect(screen.getByTestId('day-results-conditional')).toHaveTextContent('△1');
  fireEvent.click(screen.getByRole('button', { name: 'リスト' }));
  expect(screen.getByTestId('day-results-empty')).not.toHaveTextContent('未回答2');
  expect(screen.getByTestId('day-results-empty')).toHaveAccessibleName(/回答なし、未回答2人/);
});

it('候補のある月を時系列に縦積みし、候補の最終週まで表示する', () => {
  const days: DateFirstEvent['days'] = ['2026-11-07', '2027-01-08'].map((date, i) => ({
    id: `day-${i}`,
    date,
    confirmed: false,
    target: true,
    yes: 0,
    maybe: 0,
    no: 0,
    unanswered: 0,
  }));
  render(
    <DateFirstDayHeatmap
      days={days}
      participantCount={0}
      activeDayId={null}
      onInspect={jest.fn()}
      onLeave={jest.fn()}
    />,
  );
  expect(screen.getByRole('region', { name: '2026年11月' })).toBeInTheDocument();
  expect(screen.getByRole('region', { name: '2027年1月' })).toBeInTheDocument();
  expect(screen.queryByText('候補月 1 / 2')).not.toBeInTheDocument();
  expect(screen.getByTestId('day-results-day-1')).toBeInTheDocument();
  const january = screen.getByRole('region', { name: '2027年1月' });
  expect(within(january).getByRole('button', { name: /2027\/1\/8/ })).toBeInTheDocument();
  expect(within(january).getByText('9', { exact: true })).toBeInTheDocument();
  expect(within(january).queryByText('10', { exact: true })).not.toBeInTheDocument();
});

it('月をまたぐ候補日をリストで月別に表示し、切り替え時に詳細を閉じる', () => {
  const days: DateFirstEvent['days'] = ['2026-12-31', '2027-01-02'].map((date, i) => ({
    id: `day-${i}`,
    date,
    confirmed: i === 1,
    target: true,
    yes: 1,
    maybe: 1,
    no: 0,
    unanswered: 0,
    hasComment: true,
  }));
  const close = jest.fn();
  render(
    <DateFirstDayHeatmap
      days={days}
      participantCount={2}
      activeDayId={null}
      onInspect={jest.fn()}
      onLeave={jest.fn()}
      onViewChange={close}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'リスト' }));
  expect(close).toHaveBeenCalled();
  expect(screen.getByTestId('date-first-list-view')).toBeInTheDocument();
  expect(screen.getByTestId('day-results-day-0')).toHaveAccessibleName(/2026\/12\/31\(木\)/);
  expect(screen.getByTestId('day-results-day-1')).toHaveAccessibleName(
    /2027\/1\/2\(土\).*確定済み.*コメントあり/,
  );
  fireEvent.click(screen.getByRole('button', { name: 'カレンダー' }));
  expect(screen.getByTestId('date-first-calendar-view')).toBeInTheDocument();
});

it('候補日がない場合は空状態を表示する', () => {
  render(
    <DateFirstDayHeatmap
      days={[]}
      participantCount={0}
      activeDayId={null}
      onInspect={jest.fn()}
      onLeave={jest.fn()}
    />,
  );
  expect(screen.getByText('候補日はまだありません。')).toBeInTheDocument();
});
