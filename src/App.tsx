import { useState, useEffect } from 'react';
import { TokenInput, loadToken } from './components/TokenInput';
import { WorkspaceSelector } from './components/WorkspaceSelector';
import { ObjectSelector, type ObjOption } from './components/ObjectSelector';
import { ProvenanceGraph } from './components/ProvenanceGraph';
import { getCurrentUser } from './api/auth';
import type { WorkspaceInfo } from './api/workspace';
import './App.css';

export default function App() {
  const [token, setToken] = useState<string>(loadToken);
  const [username, setUsername] = useState<string | null>(null);
  const [workspace, setWorkspace] = useState<WorkspaceInfo | null>(null);
  const [object, setObject] = useState<ObjOption | null>(null);

  useEffect(() => {
    setUsername(null);
    if (!token) return;
    getCurrentUser(token)
      .then(setUsername)
      .catch(() => setUsername(null));
  }, [token]);

  function handleTokenChange(t: string) {
    setToken(t);
    setWorkspace(null);
    setObject(null);
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1>KBase Workspace Provenance Browser</h1>
        <div className="app-selectors">
          <WorkspaceSelector
            token={token}
            username={username}
            onSelect={(ws) => { setWorkspace(ws); setObject(null); }}
          />
          <ObjectSelector
            token={token}
            workspace={workspace}
            onSelect={setObject}
          />
        </div>
        {username && <span className="app-header__user">{username}</span>}
        <TokenInput token={token} onChange={handleTokenChange} />
      </header>

      <main className="app-main">
        {object ? (
          <ProvenanceGraph token={token} rootObject={object} />
        ) : (
          <div className="app-empty">
            {!token
              ? 'Enter your KBase token to get started.'
              : !workspace
              ? 'Select a workspace.'
              : 'Select an object to view its provenance graph.'}
          </div>
        )}
      </main>
    </div>
  );
}
