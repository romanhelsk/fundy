import { useState, type ReactNode } from 'react';
import type { User } from '../../types';
import { Modal } from '../Modal';

/** Shows an admin-issued temporary password exactly once, with a copy button. */
export function TemporaryPasswordModal({
  title,
  user,
  temporaryPassword,
  onClose,
  primary,
}: {
  title: string;
  user: User;
  temporaryPassword: string;
  onClose: () => void;
  /** Optional main action; defaults to "Done". */
  primary?: { label: string; onClick: () => void };
}) {
  const [copied, setCopied] = useState<boolean | null>(null);

  async function copy() {
    try {
      await navigator.clipboard.writeText(temporaryPassword);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  const description: ReactNode = (
    <>
      Share this temporary password with {user.name} through a secure channel. It won't be shown again, and they'll
      be asked to set their own password the next time they sign in.
    </>
  );

  return (
    <Modal title={title} description={description} onClose={onClose}>
      <dl className="details" style={{ margin: 0 }}>
        <div>
          <dt>Email</dt>
          <dd>{user.email}</dd>
        </div>
        <div>
          <dt>Temporary password</dt>
          <dd className="mono">{temporaryPassword}</dd>
        </div>
      </dl>
      {copied === false && <span className="small">Couldn't copy automatically. Select the password and copy it.</span>}
      <div className="modal-actions">
        <button type="button" className="btn btn-secondary" onClick={copy} data-autofocus>
          {copied ? 'Copied' : 'Copy password'}
        </button>
        <button type="button" className="btn btn-primary" onClick={primary?.onClick ?? onClose}>
          {primary?.label ?? 'Done'}
        </button>
      </div>
    </Modal>
  );
}
