import { fireEvent, render, screen } from '@testing-library/react';
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
});

it('複数の候補月があることを示し、月送りで候補月だけを切り替える', () => {
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
  expect(screen.getByText('候補月 1 / 2')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '次の候補月' }));
  expect(screen.getByLabelText('回答を表示する月')).toHaveValue('2027-01');
  expect(screen.getByText('候補月 2 / 2')).toBeInTheDocument();
  expect(screen.getByTestId('day-results-day-1')).toBeInTheDocument();
});
