import type { ProvenanceAction } from '../api/workspace';

interface Props {
  actions: ProvenanceAction[];
  onClose: () => void;
}

function Field({ label, value }: { label: string; value: unknown }) {
  if (value === undefined || value === null) return null;
  const display =
    typeof value === 'object' ? (
      <pre className="prov-panel__pre">{JSON.stringify(value, null, 2)}</pre>
    ) : (
      <span>{String(value)}</span>
    );
  return (
    <div className="prov-panel__field">
      <dt>{label}</dt>
      <dd>{display}</dd>
    </div>
  );
}

function ActionDetail({ action, index }: { action: ProvenanceAction; index: number }) {
  return (
    <section className="prov-panel__action">
      <h3>Action {index + 1}</h3>
      <dl>
        <Field label="Time" value={action.time} />
        <Field label="Service" value={action.service} />
        <Field label="Service version" value={action.service_ver} />
        <Field label="Method" value={action.method} />
        <Field label="Method params" value={action.method_params} />
        <Field label="Script" value={action.script} />
        <Field label="Script version" value={action.script_ver} />
        <Field label="Script command line" value={action.script_command_line} />
        <Field label="Input objects" value={action.input_ws_objects} />
        <Field label="Resolved inputs" value={action.resolved_ws_objects} />
        <Field label="Intermediate incoming" value={action.intermediate_incoming} />
        <Field label="Intermediate outgoing" value={action.intermediate_outgoing} />
        <Field label="External data" value={action.external_data} />
        <Field label="Subactions" value={action.subactions} />
        <Field label="Custom" value={action.custom} />
        <Field label="Description" value={action.description} />
        <Field label="Caller" value={action.caller} />
      </dl>
    </section>
  );
}

export function ProvenancePanel({ actions, onClose }: Props) {
  return (
    <aside className="prov-panel">
      <div className="prov-panel__header">
        <h2>Provenance</h2>
        <button onClick={onClose} aria-label="Close">✕</button>
      </div>
      {actions.length === 0 ? (
        <p>No provenance recorded.</p>
      ) : (
        actions.map((a, i) => <ActionDetail key={i} action={a} index={i} />)
      )}
    </aside>
  );
}
