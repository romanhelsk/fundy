import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { CloseIcon } from './Icons';

interface Props {
  title: string;
  description?: ReactNode;
  onClose: () => void;
  /** Blocks Escape / backdrop close (e.g. while saving). */
  locked?: boolean;
  children: ReactNode;
}

/** Form-style dialog: focus moves in, Tab stays in, Escape and backdrop close. */
export function Modal({ title, description, onClose, locked, children }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    returnFocus.current = document.activeElement as HTMLElement | null;
    const el = ref.current;
    (el?.querySelector<HTMLElement>('[data-autofocus]') ?? el)?.focus();
    return () => returnFocus.current?.focus();
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !locked) onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [locked, onClose]);

  function trapTab(e: ReactKeyboardEvent) {
    if (e.key !== 'Tab' || !ref.current) return;
    const items = ref.current.querySelectorAll<HTMLElement>('button:not([disabled]), input, select, textarea, a[href]');
    if (items.length === 0) return e.preventDefault();
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  return (
    <div
      className="overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !locked) onClose();
      }}
    >
      <div
        ref={ref}
        className="modal modal--form"
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        aria-describedby={description ? 'modal-desc' : undefined}
        tabIndex={-1}
        onKeyDown={trapTab}
      >
        <div className="modal-head">
          <h2 id="modal-title">{title}</h2>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose} disabled={locked}>
            <CloseIcon />
          </button>
        </div>
        {description && <p id="modal-desc">{description}</p>}
        {children}
      </div>
    </div>
  );
}
