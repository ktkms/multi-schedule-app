import { fireEvent, render, screen } from '@testing-library/react';
import CreateModeReset from '@/components/create-mode-reset';

const mockPush = jest.fn();
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: mockPush }) }));

it('選び直しの確認を取り消すと留まり、確定すると選択画面へ戻る', () => {
  render(<CreateModeReset />);
  fireEvent.click(screen.getByRole('button', { name: '調整方法を選び直す' }));
  expect(screen.getByRole('dialog')).toHaveTextContent('入力した内容は破棄されます。');
  fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }));
  expect(mockPush).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '調整方法を選び直す' }));
  fireEvent.click(screen.getByRole('button', { name: '選び直す' }));
  expect(mockPush).toHaveBeenCalledWith('/create');
});
