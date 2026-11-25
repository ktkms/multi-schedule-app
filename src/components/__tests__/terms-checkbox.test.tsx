import { fireEvent, render, screen } from '@testing-library/react';
import TermsCheckbox from '@/components/terms/terms-checkbox';

describe('TermsCheckbox', () => {
  it('複数フォームを保持しても、それぞれのラベルが対応するチェック欄だけを操作する', () => {
    const first = jest.fn(),
      second = jest.fn();
    const { container } = render(
      <>
        <TermsCheckbox isChecked={false} onChange={first} />
        <TermsCheckbox isChecked={false} onChange={second} />
      </>,
    );
    const labels = container.querySelectorAll('label');
    fireEvent.click(labels[1]);
    expect(second).toHaveBeenCalledWith(true);
    expect(first).not.toHaveBeenCalled();
  });
  test('ラベルクリックとキーボード操作に使える標準チェックボックスを表示する', () => {
    const onChange = jest.fn();
    render(<TermsCheckbox isChecked={false} onChange={onChange} id="terms-test" />);

    const checkbox = screen.getByRole('checkbox', { name: /利用規約\s*を読み、同意します/ });
    expect(checkbox).toHaveAttribute('id', 'terms-test');
    expect(checkbox).not.toBeChecked();

    fireEvent.click(checkbox);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  test('利用規約を別タブで確認できる', () => {
    const onChange = jest.fn();
    render(<TermsCheckbox isChecked={true} onChange={onChange} />);

    const termsLink = screen.getByRole('link', { name: '利用規約' });
    expect(termsLink).toHaveAttribute('href', '/terms');
    expect(termsLink).toHaveAttribute('target', '_blank');

    fireEvent.click(termsLink);
    expect(onChange).not.toHaveBeenCalled();
  });
});
