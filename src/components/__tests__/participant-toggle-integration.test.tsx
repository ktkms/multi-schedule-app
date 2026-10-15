/**
 * 参加者トグル機能の統合テスト
 * EventDetailsSectionとAvailabilitySummary(ヒートマップ固定)の連携をテスト
 */
if (!HTMLFormElement.prototype.requestSubmit) {
  HTMLFormElement.prototype.requestSubmit = function () {
    this.submit();
  };
}

jest.mock('@/components/finalize-event-section', () => {
  return function MockFinalizeEventSection() {
    return <div data-testid="mock-finalize-event-section">Finalize Event Section</div>;
  };
});

jest.mock('@/components/event-history', () => {
  return function MockEventHistory() {
    return <div data-testid="mock-event-history">Event History</div>;
  };
});

jest.mock('@/components/event-client/event-date-add-section', () => {
  return function MockEventDateAddSection() {
    return <div data-testid="mock-event-date-add-section">Event Date Add Section</div>;
  };
});

import { fireEvent, render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import EventDetailsSection from '@/components/event-client/event-details-section';
import type {
  Availability,
  EventDate,
  Participant,
} from '@/components/event-client/event-details-section';

const mockEvent = {
  id: 'test-event-id',
  title: '統合テストイベント',
  public_token: 'test-public-token',
  is_finalized: false,
};

const mockEventDates: EventDate[] = [
  {
    id: 'date1',
    start_time: '2024-01-01T10:00:00',
    end_time: '2024-01-01T12:00:00',
    label: '朝の部',
  },
  {
    id: 'date2',
    start_time: '2024-01-02T14:00:00',
    end_time: '2024-01-02T16:00:00',
    label: '昼の部',
  },
];

const mockParticipants: Participant[] = [
  { id: 'participant1', name: '田中太郎' },
  { id: 'participant2', name: '佐藤花子' },
  { id: 'participant3', name: '鈴木次郎' },
  { id: 'participant4', name: '高橋美咲' },
];

const mockAvailabilities: Availability[] = [
  { participant_id: 'participant1', event_date_id: 'date1', availability: true },
  { participant_id: 'participant2', event_date_id: 'date1', availability: true },
  { participant_id: 'participant3', event_date_id: 'date1', availability: false },
  { participant_id: 'participant4', event_date_id: 'date1', availability: true },
  { participant_id: 'participant1', event_date_id: 'date2', availability: false },
  { participant_id: 'participant2', event_date_id: 'date2', availability: true },
  { participant_id: 'participant3', event_date_id: 'date2', availability: true },
  { participant_id: 'participant4', event_date_id: 'date2', availability: false },
];

const mockFinalizedDateIds: string[] = [];

describe('参加者トグル機能の統合テスト', () => {
  test('ヒートマップ表示が初期描画される', () => {
    render(
      <EventDetailsSection
        event={mockEvent}
        eventDates={mockEventDates}
        participants={mockParticipants}
        availabilities={mockAvailabilities}
        finalizedDateIds={mockFinalizedDateIds}
      />,
    );

    expect(screen.getByText('みんなの回答状況')).toBeInTheDocument();
    expect(screen.getByText('時間')).toBeInTheDocument();
  });

  test('参加者を除外するとトグル表示が更新される', () => {
    render(
      <EventDetailsSection
        event={mockEvent}
        eventDates={mockEventDates}
        participants={mockParticipants}
        availabilities={mockAvailabilities}
        finalizedDateIds={mockFinalizedDateIds}
      />,
    );

    const taroButton = screen.getByRole('button', { name: '田中太郎' });
    fireEvent.click(taroButton!);

    expect(taroButton).toHaveAttribute('aria-pressed', 'true');
  });

  test('自分の回答は参加者名と区切って表示する', () => {
    render(
      <EventDetailsSection
        event={mockEvent}
        eventDates={mockEventDates}
        participants={mockParticipants}
        availabilities={mockAvailabilities}
        finalizedDateIds={mockFinalizedDateIds}
        myParticipantId="participant1"
      />,
    );

    expect(screen.getByRole('button', { name: '田中太郎 （自分）' })).toBeInTheDocument();
  });

  test('複数参加者の除外状態が同時に維持される', () => {
    render(
      <EventDetailsSection
        event={mockEvent}
        eventDates={mockEventDates}
        participants={mockParticipants}
        availabilities={mockAvailabilities}
        finalizedDateIds={mockFinalizedDateIds}
      />,
    );

    const taroButton = screen.getByRole('button', { name: '田中太郎' });
    const misakiButton = screen.getByRole('button', { name: '高橋美咲' });
    fireEvent.click(taroButton!);
    fireEvent.click(misakiButton!);

    expect(taroButton).toHaveAttribute('aria-pressed', 'true');
    expect(misakiButton).toHaveAttribute('aria-pressed', 'true');
  });

  test('除外を解除すると元の表示状態に戻る', () => {
    render(
      <EventDetailsSection
        event={mockEvent}
        eventDates={mockEventDates}
        participants={mockParticipants}
        availabilities={mockAvailabilities}
        finalizedDateIds={mockFinalizedDateIds}
      />,
    );

    const hanakoButton = screen.getByRole('button', { name: '佐藤花子' });

    fireEvent.click(hanakoButton!);
    expect(hanakoButton).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(hanakoButton!);
    expect(hanakoButton).toHaveAttribute('aria-pressed', 'false');
  });

  test('全員除外してもヒートマップは表示されたまま', () => {
    render(
      <EventDetailsSection
        event={mockEvent}
        eventDates={mockEventDates}
        participants={mockParticipants}
        availabilities={mockAvailabilities}
        finalizedDateIds={mockFinalizedDateIds}
      />,
    );

    const toggleSection = screen.getByText('表示選択:').parentElement!;
    mockParticipants.forEach((participant) => {
      const button = within(toggleSection).getByRole('button', {
        name: new RegExp(participant.name),
      });
      fireEvent.click(button);
    });

    expect(screen.getByText('みんなの回答状況')).toBeInTheDocument();
    expect(screen.getByText('時間')).toBeInTheDocument();
  });
});
