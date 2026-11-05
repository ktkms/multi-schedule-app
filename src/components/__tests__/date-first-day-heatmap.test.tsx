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
