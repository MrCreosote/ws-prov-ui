import { useCallback, useEffect, useRef, useState } from 'react';
import Select, {
  type SingleValue,
  type StylesConfig,
  type OptionProps,
  type InputActionMeta,
  components,
} from 'react-select';
import {
  listObjects,
  getNamesbyPrefix,
  getObjectInfo3,
  type ObjectInfo,
  type WorkspaceInfo,
} from '../api/workspace';

export interface ObjOption {
  value: string;   // UPA: wsid/objid/ver
  name: string;
  type: string;
  version: number;
  saveDate: string;
  savedBy: string;
  sizeBytes: number;
  label: string;
}

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function infoToOption(info: ObjectInfo): ObjOption {
  const upa = `${info[6]}/${info[0]}/${info[4]}`;
  return {
    value: upa,
    name: info[1],
    type: info[2],
    version: info[4],
    saveDate: new Date(info[3]).toLocaleString(),
    savedBy: info[5],
    sizeBytes: info[9],
    label: info[1],
  };
}

function ObjectOption(props: OptionProps<ObjOption>) {
  const { name, type, version, saveDate, savedBy, sizeBytes, value } = props.data;
  return (
    <components.Option {...props}>
      <div className="obj-option__name">{name} <span className="obj-option__ver">v{version}</span></div>
      <div className="obj-option__type">{type}</div>
      <div className="obj-option__upa">{value}</div>
      <div className="obj-option__meta">
        <span>{saveDate}</span>
        <span> · {savedBy}</span>
        <span title={`${sizeBytes.toLocaleString()} bytes`}> · {humanSize(sizeBytes)}</span>
      </div>
    </components.Option>
  );
}

const selectStyles: StylesConfig<ObjOption> = {
  option: (base) => ({ ...base, cursor: 'pointer', color: '#1a1a2e' }),
  singleValue: (base) => ({ ...base, color: '#1a1a2e' }),
  input: (base) => ({ ...base, color: '#1a1a2e' }),
};

const MIN_SEARCH_CHARS = 2;
const DEBOUNCE_MS = 300;

interface Props {
  token: string;
  workspace: WorkspaceInfo | null;
  onSelect: (obj: ObjOption | null) => void;
}

export function ObjectSelector({ token, workspace, onSelect }: Props) {
  const [options, setOptions] = useState<ObjOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<ObjOption | null>(null);
  const [copied, setCopied] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function copyName() {
    const name = selected?.name ?? '';
    navigator.clipboard.writeText(name).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  // Prefill when workspace changes
  useEffect(() => {
    setOptions([]);
    setSelected(null);
    onSelect(null);
    setError(null);
    if (!token || !workspace) return;

    setLoading(true);
    listObjects({ ids: [workspace[0]], limit: 1000 }, token)
      .then((infos) => setOptions(infos.map(infoToOption)))
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, workspace?.[0]]);

  const searchByPrefix = useCallback(
    async (prefix: string) => {
      if (!workspace || !token) return;
      setLoading(true);
      setError(null);
      try {
        const namesByWs = await getNamesbyPrefix(
          { workspaces: [{ id: workspace[0] }], prefix },
          token,
        );
        const names = namesByWs[0] ?? [];
        if (names.length === 0) { setOptions([]); return; }
        const specs = names.map((name) => ({ wsid: workspace[0], name }));
        const { infos } = await getObjectInfo3({ objects: specs, ignoreErrors: 1 }, token);
        setOptions(infos.filter(Boolean).map(infoToOption));
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [token, workspace],
  );

  function handleInputChange(inputValue: string, { action }: InputActionMeta) {
    if (action !== 'input-change') return;

    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (inputValue.length < MIN_SEARCH_CHARS) {
      // Revert to prefill list when input is cleared
      if (inputValue.length === 0 && workspace && token) {
        setLoading(true);
        listObjects({ ids: [workspace[0]], limit: 1000 }, token)
          .then((infos) => setOptions(infos.map(infoToOption)))
          .catch((e: Error) => setError(e.message))
          .finally(() => setLoading(false));
      }
      return;
    }

    debounceRef.current = setTimeout(() => searchByPrefix(inputValue), DEBOUNCE_MS);
  }

  function handleChange(opt: SingleValue<ObjOption>) {
    setSelected(opt ?? null);
    onSelect(opt ?? null);
  }

  const disabled = !token || !workspace;

  return (
    <div className="selector-group">
      <div className="selector-group__header">
        <label>Object</label>
        {selected && (
          <button className="copy-btn" onClick={copyName} title="Copy name">
            {copied ? '✓' : '⎘'}
          </button>
        )}
      </div>
      {error && <div className="error">{error}</div>}
      <Select<ObjOption>
        options={options}
        value={selected}
        onChange={handleChange}
        onInputChange={handleInputChange}
        isLoading={loading}
        isDisabled={disabled}
        placeholder={
          !token ? 'Set a token first' :
          !workspace ? 'Select a workspace first' :
          'Search objects…'
        }
        components={{ Option: ObjectOption }}
        styles={selectStyles}
        filterOption={null}  // server-side filtering via prefix search
        isClearable
        noOptionsMessage={({ inputValue }) =>
          inputValue.length > 0 && inputValue.length < MIN_SEARCH_CHARS
            ? `Type at least ${MIN_SEARCH_CHARS} characters to search`
            : 'No objects found'
        }
      />
    </div>
  );
}
