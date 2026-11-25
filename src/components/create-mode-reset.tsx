'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import ConfirmationModal from '@/components/common/confirmation-modal';

export default function CreateModeReset() {
  const [confirming, setConfirming] = useState(false);
  const router = useRouter();

  return (
    <>
      <button
        type="button"
        className="link mb-4 inline-flex min-h-11 items-center text-sm"
        onClick={() => setConfirming(true)}
      >
        調整方法を選び直す
      </button>
      <ConfirmationModal
        isOpen={confirming}
        title="調整方法を選び直しますか？"
        description="入力した内容は破棄されます。"
        confirmLabel="選び直す"
        onCancel={() => setConfirming(false)}
        onConfirm={() => router.push('/create')}
      />
    </>
  );
}
