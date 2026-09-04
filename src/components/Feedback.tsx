import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

export type Confirmation = {
  title?: string;
  description: string;
  label?: string;
  danger?: boolean;
  keyword?: string;
};

export function ConfirmModal({
  title = "操作を確認",
  description,
  label = "実行する",
  danger = false,
  keyword,
  onClose,
}: Confirmation & { onClose: (answer: boolean) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [typed, setTyped] = useState("");
  const id = useId();
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const el = dialog.current;
    el?.showModal();
    return () => {
      el?.close();
      previous?.focus();
    };
  }, []);
  return createPortal(
    <dialog
      ref={dialog}
      className="confirm-modal"
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-body`}
      onCancel={(event) => {
        event.preventDefault();
        onClose(false);
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose(false);
      }}
    >
      <section>
        <p className="eyebrow">{danger ? "PLEASE CONFIRM" : "CONFIRMATION"}</p>
        <h2 id={`${id}-title`}>{title}</h2>
        <p id={`${id}-body`}>{description}</p>
        {keyword && (
          <label className="confirm-keyword">
            「{keyword}」と入力してください
            <input
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              autoComplete="off"
            />
          </label>
        )}
        <div className="confirm-actions">
          <button
            autoFocus
            className="button-secondary"
            onClick={() => onClose(false)}
          >
            キャンセル
          </button>
          <button
            className={danger ? "button-danger" : "button-primary"}
            disabled={Boolean(keyword && typed !== keyword)}
            onClick={() => onClose(true)}
          >
            {label}
          </button>
        </div>
      </section>
    </dialog>,
    document.body,
  );
}

export function Toast({
  message,
  error = false,
}: {
  message: string;
  error?: boolean;
}) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    setVisible(Boolean(message));
    const timer = window.setTimeout(
      () => setVisible(false),
      error ? 8000 : 4000,
    );
    return () => clearTimeout(timer);
  }, [message, error]);
  return visible
    ? createPortal(
        <div
          className={`toast ${error ? "toast-error" : ""}`}
          role={error ? "alert" : "status"}
        >
          {message}
          <button aria-label="通知を閉じる" onClick={() => setVisible(false)}>
            ×
          </button>
        </div>,
        document.body,
      )
    : null;
}
