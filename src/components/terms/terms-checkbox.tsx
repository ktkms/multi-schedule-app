import React from 'react';
import Link from 'next/link';
import styles from './terms-checkbox.module.css';

type TermsCheckboxProps = {
  isChecked: boolean;
  onChange: (checked: boolean) => void;
  id?: string;
  disabled?: boolean;
};

export default function TermsCheckbox({
  isChecked,
  onChange,
  id,
  disabled = false,
}: TermsCheckboxProps) {
  const generatedId = React.useId();
  const inputId = id ?? generatedId;
  return (
    <div className={styles.control}>
      <label className={styles.label} htmlFor={inputId}>
        <input
          type="checkbox"
          id={inputId}
          className={styles.checkbox}
          checked={isChecked}
          onChange={(e) => onChange(e.target.checked)}
          disabled={disabled}
        />
        <span>
          <Link
            href="/terms"
            className={styles.link}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(event) => event.stopPropagation()}
          >
            利用規約
          </Link>
          を読み、同意します
        </span>
      </label>
    </div>
  );
}
