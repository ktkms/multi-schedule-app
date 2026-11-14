'use client';

import Link from 'next/link';
import { useEffect, useId, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';

interface ExistingAnswerMenuProps {
  eventPublicToken: string;
  linkedParticipantId: string | null;
  participants: { id: string; name: string }[];
  /** 日付先行型の詳細時間を編集する場合だけ指定する。 */
  answerKind?: 'times';
}

/**
 * 既存回答の編集対象を選択するメニュー。
 * @param eventPublicToken {string} イベントの公開トークン
 * @param linkedParticipantId {string | null} 現在の利用者に紐づく参加者ID
 * @param participants {{ id: string; name: string }[]} 回答済み参加者の一覧
 * @returns 明示的な開閉状態とキーボード操作を備えた編集メニュー
 */
export default function ExistingAnswerMenu({
  eventPublicToken,
  linkedParticipantId,
  participants,
  answerKind,
}: ExistingAnswerMenuProps) {
  const answerSuffix = answerKind === 'times' ? '&kind=times' : '';
  const [isOpen, setIsOpen] = useState(false);
  const menuId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLUListElement>(null);
  const focusFirstItemOnOpenRef = useRef(false);

  useEffect(() => {
    if (!isOpen) return;

    const closeWhenOutside = (event: PointerEvent | FocusEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    const closeWithEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setIsOpen(false);
      buttonRef.current?.focus();
    };

    document.addEventListener('pointerdown', closeWhenOutside);
    document.addEventListener('focusin', closeWhenOutside);
    document.addEventListener('keydown', closeWithEscape);

    return () => {
      document.removeEventListener('pointerdown', closeWhenOutside);
      document.removeEventListener('focusin', closeWhenOutside);
      document.removeEventListener('keydown', closeWithEscape);
    };
  }, [isOpen]);

  useEffect(() => {
    if (isOpen && focusFirstItemOnOpenRef.current) {
      focusFirstItemOnOpenRef.current = false;
      menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    }
  }, [isOpen]);

  const focusFirstMenuItem = () => {
    menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  };

  const handleButtonKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== 'ArrowDown') return;
    event.preventDefault();
    if (isOpen) {
      focusFirstMenuItem();
      focusFirstItemOnOpenRef.current = false;
      return;
    }
    focusFirstItemOnOpenRef.current = true;
    setIsOpen(true);
  };

  const handleMenuKeyDown = (event: ReactKeyboardEvent<HTMLUListElement>) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;

    const items = Array.from(
      menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [],
    );
    if (items.length === 0) return;

    event.preventDefault();
    const currentIndex = items.indexOf(document.activeElement as HTMLElement);
    if (event.key === 'Home') {
      items[0].focus();
      return;
    }
    if (event.key === 'End') {
      items.at(-1)?.focus();
      return;
    }

    const direction = event.key === 'ArrowDown' ? 1 : -1;
    const nextIndex = (currentIndex + direction + items.length) % items.length;
    items[nextIndex].focus();
  };

  return (
    <div
      ref={containerRef}
      className={`dropdown dropdown-bottom dropdown-start sm:dropdown-end relative w-full sm:w-auto ${isOpen ? 'dropdown-open' : ''}`}
    >
      <button
        ref={buttonRef}
        type="button"
        className="btn btn-outline"
        aria-controls={menuId}
        aria-expanded={isOpen}
        aria-haspopup="menu"
        onClick={() => setIsOpen((current) => !current)}
        onKeyDown={handleButtonKeyDown}
      >
        既存の回答を編集
      </button>
      {isOpen && (
        <ul
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label="編集する回答を選択"
          onKeyDown={handleMenuKeyDown}
          className="dropdown-content menu bg-base-100 border-base-300 absolute z-[100] mt-2 max-h-[min(300px,calc(100vh-1rem))] w-56 max-w-[calc(100vw-2rem)] overflow-y-auto rounded-lg border p-2 shadow-lg"
        >
          {linkedParticipantId && (
            <li role="none">
              <Link
                role="menuitem"
                href={`/event/${eventPublicToken}/input?participant_id=${linkedParticipantId}${answerSuffix}`}
                onClick={() => setIsOpen(false)}
              >
                自分の回答を編集
              </Link>
            </li>
          )}
          {participants.map((participant) => (
            <li key={participant.id} role="none">
              <Link
                role="menuitem"
                href={`/event/${eventPublicToken}/input?participant_id=${participant.id}${answerSuffix}`}
                onClick={() => setIsOpen(false)}
              >
                {participant.name}
                {participant.id === linkedParticipantId ? '（自分）' : ''}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
