import { fireEvent, render, screen } from '@testing-library/react';
import ConfirmationModal from '@/components/common/confirmation-modal';

describe('ConfirmationModal', () => {
  it('キャンセルへフォーカスし、Tabを閉じ込め、Escapeで閉じた後に元へ戻す', () => {
    const onCancel = jest.fn();
    const props = { title: '保存確認', confirmLabel: '保存する', onConfirm: jest.fn(), onCancel };
    const { rerender } = render(
      <>
        <button>開く</button>
        <ConfirmationModal {...props} isOpen={false} />
      </>,
    );
    const opener = screen.getByRole('button', { name: '開く' });
    opener.focus();
    rerender(
      <>
        <button>開く</button>
        <ConfirmationModal {...props} isOpen />
      </>,
    );
    const cancel = screen.getByRole('button', { name: 'キャンセル' });
    const confirm = screen.getByRole('button', { name: '保存する' });
    expect(cancel).toHaveFocus();
    fireEvent.keyDown(cancel, { key: 'Tab', shiftKey: true });
    expect(confirm).toHaveFocus();
    fireEvent.keyDown(confirm, { key: 'Tab' });
    expect(cancel).toHaveFocus();
    fireEvent.keyDown(cancel, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(1);
    rerender(
      <>
        <button>開く</button>
        <ConfirmationModal {...props} isOpen={false} />
      </>,
    );
    expect(opener).toHaveFocus();
  });

  it('処理中はEscapeや背景から閉じない', () => {
    const onCancel = jest.fn();
    render(
      <ConfirmationModal
        isOpen
        isConfirming
        title="保存確認"
        confirmLabel="保存する"
        onConfirm={jest.fn()}
        onCancel={onCancel}
      />,
    );
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: '確認モーダルを閉じる' }));
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('閉じた詳細条件の入力へフォーカスを移さず、共有操作からsummaryへ循環する', () => {
    render(
      <ConfirmationModal
        isOpen
        title="共有内容を確認"
        onCancel={jest.fn()}
        confirmAction={<button>共有する</button>}
      >
        <details>
          <summary>条件を絞る</summary>
          <input aria-label="非表示の条件" />
        </details>
      </ConfirmationModal>,
    );
    const share = screen.getByRole('button', { name: '共有する' });
    share.focus();
    fireEvent.keyDown(share, { key: 'Tab' });
    expect(screen.getByText('条件を絞る')).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: 'Tab', shiftKey: true });
    expect(share).toHaveFocus();
  });
});
