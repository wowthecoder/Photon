import { useState, type ReactNode } from "react";

type Props = { onConfirm: () => void; title: string; className?: string; children: ReactNode };

export function ConfirmButton({ onConfirm, title, className = "", children }: Props) {
  const [confirming, setConfirming] = useState(false);
  return confirming ? (
    <button className="danger-btn" autoFocus onBlur={() => setConfirming(false)} onClick={(e) => (e.stopPropagation(), onConfirm())}>
      Delete
    </button>
  ) : (
    <button className={`icon-btn ${className}`} title={title} onClick={(e) => (e.stopPropagation(), setConfirming(true))}>
      {children}
    </button>
  );
}
