import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { ObjectData, ProvenanceAction, SubAction } from '../api/workspace';
import { getWorkspaceInfo } from '../api/workspace';
import { getAppBriefInfo } from '../api/catalog';

// Module-level cache: ws_id → narrative_nice_name (null if not a narrative)
const wsNiceNameCache = new Map<number, string | null>();

type Tab = 'general' | 'metadata' | 'provenance';

// TODO: make these selectable when multi-env support is added
const NARRATIVE_HOST = 'https://narrative.kbase.us';

// ---- helpers ----------------------------------------------------------------

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string): string {
  try { return new Date(iso).toLocaleString(); } catch { return iso; }
}

// ---- shared primitives ------------------------------------------------------

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="obj-dialog__field">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

// ---- General tab ------------------------------------------------------------

function GeneralTab({ objData, wsNiceName }: { objData: ObjectData; wsNiceName: string | null }) {
  const [objId, name, type, saveDate, version, savedBy, wsId, wsName, checksum, size] = objData.info;
  const upa = `${wsId}/${objId}/${version}`;
  const dataviewUrl = `${NARRATIVE_HOST}/legacy/dataview/${upa}`;
  const typeUrl = `${NARRATIVE_HOST}/#spec/type/${type}`;
  const typeMatch = type.match(/^(.+?)-(\d+\.\d+)$/);
  const typeName = typeMatch?.[1] ?? type;
  const typeVer  = typeMatch?.[2];

  return (
    <dl className="obj-dialog__dl">
      <Field label="UPA"><code>{upa}</code></Field>
      <Field label="Type">
        <a href={typeUrl} target="_blank" rel="noreferrer">{typeName}</a>
        {typeVer && <span className="obj-dialog__muted"> v{typeVer}</span>}
      </Field>
      <Field label="Name">
        <a href={dataviewUrl} target="_blank" rel="noreferrer">{name}</a>
      </Field>
      <Field label="Version">{version}</Field>
      <Field label="Saved by"><a href={`${NARRATIVE_HOST}/legacy/people/${savedBy}`} target="_blank" rel="noreferrer">{savedBy}</a></Field>
      <Field label="Save date">{formatDate(saveDate)}</Field>
      <Field label="Workspace">{wsName} <span className="obj-dialog__muted">(ID: {wsId})</span></Field>
      {wsNiceName && (
        <Field label="Narrative">
          <a href={`${NARRATIVE_HOST}/narrative/${wsId}`} target="_blank" rel="noreferrer">{wsNiceName}</a>
        </Field>
      )}
      <Field label="Object ID">{objId}</Field>
      <Field label="Size">
        {formatBytes(size)} <span className="obj-dialog__muted">({size.toLocaleString()} bytes)</span>
      </Field>
      <Field label="Checksum"><code>{checksum}</code></Field>
      <Field label="Creator"><a href={`${NARRATIVE_HOST}/legacy/people/${objData.creator}`} target="_blank" rel="noreferrer">{objData.creator}</a></Field>
      <Field label="Created">{formatDate(objData.created)}</Field>
      {objData.copied && (
        <Field label="Copied from"><code>{objData.copied}</code></Field>
      )}
      {objData.orig_wsid !== undefined && (
        <Field label="Original workspace">{objData.orig_wsid}</Field>
      )}
      {objData.refs.length > 0 && (
        <Field label={`References (${objData.refs.length})`}>
          <ul className="obj-dialog__ref-list">
            {objData.refs.map(r => <li key={r}><code>{r}</code></li>)}
          </ul>
        </Field>
      )}
    </dl>
  );
}

// ---- Metadata tab -----------------------------------------------------------

function MetadataTab({ objData }: { objData: ObjectData }) {
  const metadata = objData.info[10];
  const entries = metadata ? Object.entries(metadata) : [];
  if (entries.length === 0) {
    return <p className="obj-dialog__empty">No metadata.</p>;
  }
  return (
    <table className="obj-dialog__meta-table">
      <thead><tr><th>Key</th><th>Value</th></tr></thead>
      <tbody>
        {entries.map(([k, v]) => <tr key={k}><td>{k}</td><td>{v}</td></tr>)}
      </tbody>
    </table>
  );
}

// ---- Provenance tab ---------------------------------------------------------

function ProvField({ label, value }: { label: string; value: unknown }) {
  if (value == null) return null;
  if (Array.isArray(value) && value.length === 0) return null;
  if (typeof value === 'object' && !Array.isArray(value) && Object.keys(value as object).length === 0) return null;
  const display = typeof value === 'object'
    ? <pre className="obj-dialog__pre">{JSON.stringify(value, null, 2)}</pre>
    : <span>{String(value)}</span>;
  return (
    <div className="obj-dialog__field">
      <dt>{label}</dt>
      <dd>{display}</dd>
    </div>
  );
}

function InputResolvedTable({ inputs, resolved }: { inputs?: string[]; resolved?: string[] }) {
  const len = Math.max(inputs?.length ?? 0, resolved?.length ?? 0);
  if (len === 0) return null;
  return (
    <div className="obj-dialog__field">
      <dt>Input → Resolved</dt>
      <dd>
        <table className="obj-dialog__meta-table">
          <thead><tr><th>Input object</th><th>Resolved object</th></tr></thead>
          <tbody>
            {Array.from({ length: len }, (_, i) => (
              <tr key={i}>
                <td><code>{inputs?.[i] ?? '—'}</code></td>
                <td><code>{resolved?.[i] ?? '—'}</code></td>
              </tr>
            ))}
          </tbody>
        </table>
      </dd>
    </div>
  );
}

function SubActionsDisplay({ subactions }: { subactions?: SubAction[] }) {
  if (!subactions || subactions.length === 0) return null;
  return (
    <div className="obj-dialog__field">
      <dt>Subactions</dt>
      <dd>
        {subactions.map((sa, i) => (
          <div key={i} className="obj-dialog__subaction">
            <span className="obj-dialog__subaction-name">
              {sa.name
                ? <a href={`${NARRATIVE_HOST}/legacy/catalog/modules/${sa.name}`} target="_blank" rel="noreferrer">{sa.name}</a>
                : '(unnamed)'}
            </span>
            {sa.ver        && <div className="obj-dialog__subfield"><span className="obj-dialog__subfield-label">Version</span> {sa.ver}</div>}
            {sa.code_url   && <div className="obj-dialog__subfield"><span className="obj-dialog__subfield-label">Code</span> <a href={sa.code_url} target="_blank" rel="noreferrer">{sa.code_url}</a></div>}
            {sa.commit     && <div className="obj-dialog__subfield"><span className="obj-dialog__subfield-label">Commit</span> <code>{sa.commit}</code></div>}
            {sa.endpoint_url && <div className="obj-dialog__subfield"><span className="obj-dialog__subfield-label">Endpoint</span> {sa.endpoint_url}</div>}
          </div>
        ))}
      </dd>
    </div>
  );
}

// ---- Catalog linkout helpers ------------------------------------------------

interface CatalogAppRefProps {
  service: string;
  method?: string;
  serviceVer?: string;
}

/** Renders linked Module + App rows, fetching the human-readable app name async. */
function CatalogAppRef({ service, method, serviceVer }: CatalogAppRefProps) {
  const [appName, setAppName] = useState<string | null>(null);

  useEffect(() => {
    if (!method) return;
    const key = `${service}/${method}`;
    getAppBriefInfo(key).then((info) => { if (info) setAppName(info.name); }).catch(() => {});
  }, [service, method]);

  const moduleUrl = `${NARRATIVE_HOST}/legacy/catalog/modules/${service}`;
  const appUrl = method
    ? `${NARRATIVE_HOST}/legacy/catalog/apps/${service}/${method}/${serviceVer ?? ''}`
    : null;

  return (
    <>
      <div className="obj-dialog__field">
        <dt>Module</dt>
        <dd><a href={moduleUrl} target="_blank" rel="noreferrer">{service}</a></dd>
      </div>
      {appUrl && (
        <div className="obj-dialog__field">
          <dt>App</dt>
          <dd><a href={appUrl} target="_blank" rel="noreferrer">{appName ?? method}</a></dd>
        </div>
      )}
      {method && (
        <div className="obj-dialog__field">
          <dt>Method</dt>
          <dd><code>{method}</code></dd>
        </div>
      )}
    </>
  );
}

function ActionDetail({ action, i, showTitle }: { action: ProvenanceAction; i: number; showTitle: boolean }) {
  return (
    <section className="obj-dialog__prov-action">
      {showTitle && <h3 className="obj-dialog__prov-action-title">Action {i + 1}</h3>}
      <dl>
        <ProvField label="Time"                    value={action.time} />
        <ProvField label="Caller"                  value={action.caller} />
        <ProvField label="Description"             value={action.description} />
        {action.service
          ? <CatalogAppRef service={action.service} method={action.method} serviceVer={action.service_ver} />
          : <>
              <ProvField label="Service" value={action.service} />
              <ProvField label="Method"  value={action.method} />
            </>
        }
        <ProvField label="Service version"         value={action.service_ver} />
        <ProvField label="Method params"           value={action.method_params} />
        <ProvField label="Script"                  value={action.script} />
        <ProvField label="Script version"          value={action.script_ver} />
        <ProvField label="Script command line"     value={action.script_command_line} />
        <InputResolvedTable inputs={action.input_ws_objects} resolved={action.resolved_ws_objects} />
        <ProvField label="Intermediate incoming"   value={action.intermediate_incoming} />
        <ProvField label="Intermediate outgoing"   value={action.intermediate_outgoing} />
        <ProvField label="External data"           value={action.external_data} />
        <SubActionsDisplay subactions={action.subactions} />
        <ProvField label="Custom"                  value={action.custom} />
      </dl>
    </section>
  );
}

function ProvenanceTab({ actions }: { actions: ProvenanceAction[] }) {
  if (actions.length === 0) return <p className="obj-dialog__empty">No provenance recorded.</p>;
  const multi = actions.length > 1;
  return <div>{actions.map((a, i) => <ActionDetail key={i} action={a} i={i} showTitle={multi} />)}</div>;
}

// ---- Dialog -----------------------------------------------------------------

interface Props {
  objData: ObjectData;
  token: string;
  onClose: () => void;
}

export function ObjectInfoDialog({ objData, token, onClose }: Props) {
  const [tab, setTab] = useState<Tab>('general');
  const [wsNiceName, setWsNiceName] = useState<string | null>(null);

  const wsId = objData.info[6];
  useEffect(() => {
    if (wsNiceNameCache.has(wsId)) {
      setWsNiceName(wsNiceNameCache.get(wsId) ?? null);
      return;
    }
    getWorkspaceInfo({ id: wsId }, token)
      .then(info => {
        const name = info[8]?.narrative_nice_name ?? null;
        wsNiceNameCache.set(wsId, name);
        setWsNiceName(name);
      })
      .catch(() => { wsNiceNameCache.set(wsId, null); });
  }, [wsId, token]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const info = objData.info;

  return (
    <div className="obj-dialog__backdrop" onClick={onClose}>
      <div
        className="obj-dialog"
        role="dialog"
        aria-modal="true"
        onClick={e => e.stopPropagation()}
      >
        <div className="obj-dialog__header">
          <span className="obj-dialog__title">
            {info[1]} <span className="obj-dialog__muted">v{info[4]}</span>
          </span>
          <button className="obj-dialog__close" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="obj-dialog__tabs">
          {(['general', 'metadata', 'provenance'] as Tab[]).map(t => (
            <button
              key={t}
              className={`obj-dialog__tab${tab === t ? ' obj-dialog__tab--active' : ''}`}
              onClick={() => setTab(t)}
            >
              {t[0].toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>
        <div className="obj-dialog__body">
          {tab === 'general'    && <GeneralTab objData={objData} wsNiceName={wsNiceName} />}
          {tab === 'metadata'   && <MetadataTab objData={objData} />}
          {tab === 'provenance' && <ProvenanceTab actions={objData.provenance} />}
        </div>
      </div>
    </div>
  );
}
