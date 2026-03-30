import { useState } from 'react';

const TOKEN_KEY = 'kbase_token';

export function loadToken(): string {
  return localStorage.getItem(TOKEN_KEY) ?? '';
}

function saveToken(token: string) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

interface Props {
  token: string;
  onChange: (token: string) => void;
}

export function TokenInput({ token, onChange }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  function submit() {
    const trimmed = draft.trim();
    saveToken(trimmed);
    onChange(trimmed);
    setDraft('');
    setEditing(false);
  }

  function clear() {
    saveToken('');
    onChange('');
    setDraft('');
    setEditing(true);
  }

  if (editing) {
    return (
      <div className="token-input">
        <input
          type="password"
          placeholder="Paste KBase token…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          autoFocus
        />
        <button onClick={submit} disabled={!draft.trim()}>
          Set token
        </button>
        <button className="token-input__skip" onClick={() => setEditing(false)}>
          Browse anonymously
        </button>
      </div>
    );
  }

  if (!token) {
    return (
      <div className="token-input token-input--anon">
        <span className="token-input__label">Anonymous</span>
        <button onClick={() => setEditing(true)}>Sign in</button>
      </div>
    );
  }

  return (
    <div className="token-input token-input--set">
      <span className="token-input__label">Token set</span>
      <button onClick={clear}>Change</button>
    </div>
  );
}
