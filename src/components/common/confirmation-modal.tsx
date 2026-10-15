'use client';

import { useEffect, useRef, type ReactNode } from 'react';

type ConfirmationModalBaseProps = {
  isOpen: boolean;
  title: string;
  description?: ReactNode;
  cancelLabel?: string;
  onCancel: () => void;
  confirmButtonClassName?: string;
  isConfirming?: boolean;
  confirmingLabel?: string;
  children?: ReactNode;
  widthClassName?: string;
};

type ConfirmationModalProps = ConfirmationModalBaseProps &
  (
    | { confirmLabel: string; onConfirm: () => void; confirmAction?: never }
    | { confirmAction: ReactNode; confirmLabel?: never; onConfirm?: never }
  );

/**
 * 操作確認用の共通モーダル
 * @param {ConfirmationModalProps} props モーダル表示に必要なプロパティ
 * @returns {JSX.Element | null} 確認モーダル
 */
export default function ConfirmationModal({
  isOpen,
  title,
  description,
  confirmLabel,
  confirmAction,
  cancelLabel = 'キャンセル',
  onConfirm,
  onCancel,
  confirmButtonClassName = 'btn-primary',
  isConfirming = false,
  confirmingLabel,
  children,
  widthClassName = 'max-w-lg',
}: ConfirmationModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!isOpen) return;
    const previousFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    cancelRef.current?.focus();
    return () => {
      previousFocus?.focus();
    };
  }, [isOpen]);

  if (!isOpen) {
    return null;
  }

  return (
    <div
      className="modal modal-open"
      // visibilityの開始遷移中にもフォーカスできるよう、可視性は即時に切り替える。
      style={{ visibility: 'visible', transitionProperty: 'background-color, opacity' }}
      role="dialog"
      aria-modal="true"
      aria-label={title}
      ref={dialogRef}
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !isConfirming) {
          event.preventDefault();
          event.stopPropagation();
          onCancel();
        }
        if (event.key !== 'Tab') return;
        const focusable = Array.from(
          dialogRef.current?.querySelectorAll<HTMLElement>(
            'summary, button:not(:disabled):not([tabindex="-1"]), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]',
          ) ?? [],
        ).filter((element) => {
          const closedDetails = element.closest('details:not([open])');
          return (
            !element.closest('[hidden]') &&
            (!closedDetails ||
              (element.tagName === 'SUMMARY' && element.parentElement === closedDetails))
          );
        });
        const first = focusable[0];
        const last = focusable.at(-1);
        if (
          !first ||
          (event.shiftKey && document.activeElement === first) ||
          (!event.shiftKey && document.activeElement === last)
        ) {
          event.preventDefault();
          (event.shiftKey ? last : first)?.focus();
          if (!first) dialogRef.current?.focus();
        }
      }}
    >
      <div className={`modal-box w-11/12 ${widthClassName}`}>
        <h3 className="text-lg font-bold">{title}</h3>
        {description && (
          <div className="text-base-content/75 mt-3 text-sm leading-relaxed">{description}</div>
        )}
        {children && <div className="mt-4">{children}</div>}
        <div className="modal-action flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            className="btn btn-ghost"
            onClick={onCancel}
            disabled={isConfirming}
            ref={cancelRef}
          >
            {cancelLabel}
          </button>
          {confirmAction ?? (
            <button
              type="button"
              className={`btn ${confirmButtonClassName}`}
              onClick={onConfirm}
              disabled={isConfirming}
            >
              {isConfirming ? (confirmingLabel ?? `${confirmLabel}中...`) : confirmLabel}
            </button>
          )}
        </div>
      </div>
      <button
        type="button"
        aria-label="確認モーダルを閉じる"
        className="modal-backdrop"
        onClick={onCancel}
        disabled={isConfirming}
        tabIndex={-1}
      />
    </div>
  );
}
