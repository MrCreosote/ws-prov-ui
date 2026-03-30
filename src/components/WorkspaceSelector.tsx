import { useEffect, useRef, useState } from 'react';
import Select, { type SingleValue, type StylesConfig, type OptionProps, components } from 'react-select';
import { listWorkspaceInfo, type WorkspaceInfo } from '../api/workspace';

interface WsOption {
  value: number;       // ws_id
  wsName: string;
  niceName: string;
  owner: string;
  label: string;       // used by react-select for default filtering
}

function toOption(ws: WorkspaceInfo): WsOption {
  const niceName = ws[8]?.['narrative_nice_name'] ?? '';
  return {
    value: ws[0],
    wsName: ws[1],
    niceName,
    owner: ws[2],
    label: `${niceName} ${ws[1]} ${ws[0]}`.toLowerCase(),
  };
}

function filterOption(option: { data: WsOption }, inputValue: string): boolean {
  if (!inputValue) return true;
  const q = inputValue.toLowerCase();
  const { niceName, wsName, value } = option.data;
  return (
    niceName.toLowerCase().includes(q) ||
    wsName.toLowerCase().includes(q) ||
    String(value).includes(q)
  );
}

function WorkspaceOption(props: OptionProps<WsOption>) {
  const { niceName, wsName, value } = props.data;
  return (
    <components.Option {...props}>
      {niceName && <div className="ws-option__nice">{niceName}</div>}
      <div className="ws-option__name">{wsName}</div>
      <div className="ws-option__id">ID: {value}</div>
    </components.Option>
  );
}

const selectStyles: StylesConfig<WsOption> = {
  option: (base) => ({ ...base, cursor: 'pointer', color: '#1a1a2e' }),
  singleValue: (base) => ({ ...base, color: '#1a1a2e' }),
  input: (base) => ({ ...base, color: '#1a1a2e' }),
};

interface Props {
  token: string;
  username: string | null;
  initialWsId?: number | null;
  onSelect: (ws: WorkspaceInfo | null) => void;
}

export function WorkspaceSelector({ token, username, initialWsId, onSelect }: Props) {
  const [options, setOptions] = useState<WsOption[]>([]);
  const [ownOnly, setOwnOnly] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<WsOption | null>(null);
  const [copied, setCopied] = useState(false);
  const initialAppliedRef = useRef(false);

  function copyName() {
    const name = selected ? (selected.niceName || selected.wsName) : '';
    navigator.clipboard.writeText(name).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  useEffect(() => {
    setOptions([]);
    setSelected(null);
    onSelect(null);

    const params = ownOnly && username ? { owners: [username] } : {};

    setLoading(true);
    setError(null);
    listWorkspaceInfo(params, token)
      .then((infos) => {
        const opts = infos.map(toOption);
        setOptions(opts);
        if (!initialAppliedRef.current && initialWsId != null) {
          const match = opts.find((o) => o.value === initialWsId);
          if (match) {
            initialAppliedRef.current = true;
            setSelected(match);
            onSelect([match.value, match.wsName, match.owner, '', 0, '', '', '', {}] as WorkspaceInfo);
          }
        }
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, ownOnly, username]);

  function handleChange(opt: SingleValue<WsOption>) {
    setSelected(opt ?? null);
    if (!opt) { onSelect(null); return; }
    onSelect([opt.value, opt.wsName, opt.owner, '', 0, '', '', '', {}] as WorkspaceInfo);
  }

  return (
    <div className="selector-group">
      <div className="selector-group__header">
        <label>Workspace</label>
        {selected && (
          <button className="copy-btn" onClick={copyName} title="Copy name">
            {copied ? '✓' : '⎘'}
          </button>
        )}
        {username && (
          <label className="toggle">
            <input
              type="checkbox"
              checked={ownOnly}
              onChange={(e) => setOwnOnly(e.target.checked)}
            />
            Mine only
          </label>
        )}
      </div>
      {error && <div className="error">{error}</div>}
      <Select<WsOption>
        options={options}
        value={selected}
        onChange={handleChange}
        isLoading={loading}
        placeholder="Search workspaces…"
        filterOption={filterOption}
        components={{ Option: WorkspaceOption }}
        styles={selectStyles}
        isClearable
      />
    </div>
  );
}
