const WS_URL = 'https://kbase.us/services/ws';

// ---- JSONRPC ----------------------------------------------------------------

let _reqId = 0;

async function rpc<T>(
  method: string,
  params: unknown[],
  token?: string,
): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = token;

  const body = JSON.stringify({
    version: '1.1',
    method: `Workspace.${method}`,
    id: String(++_reqId),
    params,
  });

  const res = await fetch(WS_URL, { method: 'POST', headers, body });
  const json = await res.json();
  if (json.error) {
    const msg = json.error.message ?? JSON.stringify(json.error);
    throw new Error(`Workspace.${method}: ${msg}`);
  }
  return json.result as T;
}

// ---- Types ------------------------------------------------------------------

/** ws_id, ws_name, owner, moddate, max_objid, user_perm, globalread, lockstat, metadata */
export type WorkspaceInfo = [
  number,   // 0 ws_id
  string,   // 1 ws_name
  string,   // 2 owner
  string,   // 3 moddate
  number,   // 4 max_objid
  string,   // 5 user_permission
  string,   // 6 globalread
  string,   // 7 lockstat
  Record<string, string>, // 8 metadata
];

/**
 * obj_id, obj_name, type, save_date, version, saved_by,
 * ws_id, ws_name, checksum, size, metadata
 */
export type ObjectInfo = [
  number,   // 0 obj_id
  string,   // 1 obj_name
  string,   // 2 type
  string,   // 3 save_date
  number,   // 4 version
  string,   // 5 saved_by
  number,   // 6 ws_id
  string,   // 7 ws_name
  string,   // 8 checksum
  number,   // 9 size (bytes)
  Record<string, string> | null, // 10 metadata
];

export interface ExternalDataUnit {
  resource_name: string;
  resource_url?: string;
  resource_version?: string;
  resource_release_date?: string;
  resource_release_epoch?: number;
  data_url?: string;
  data_id?: string;
  description?: string;
}

export interface SubAction {
  name?: string;
  ver?: string;
  code_url?: string;
  commit?: string;
  endpoint_url?: string;
}

export interface ProvenanceAction {
  time?: string;
  epoch?: number;
  caller?: string;
  service?: string;
  service_ver?: string;
  method?: string;
  method_params?: unknown[];
  script?: string;
  script_ver?: string;
  script_command_line?: string;
  input_ws_objects?: string[];
  resolved_ws_objects?: string[];
  intermediate_incoming?: string[];
  intermediate_outgoing?: string[];
  external_data?: ExternalDataUnit[];
  subactions?: SubAction[];
  custom?: Record<string, string>;
  description?: string;
}

export interface ObjectData {
  data?: unknown;
  info: ObjectInfo;
  path: string[];
  provenance: ProvenanceAction[];
  creator: string;
  orig_wsid?: number;
  created: string;
  epoch: number;
  refs: string[];
  copied?: string;
  copy_source_inaccessible?: boolean;
}

// ---- API calls --------------------------------------------------------------

export interface ListWorkspaceInfoParams {
  perm?: string;
  owners?: string[];
  meta?: Record<string, string>;
  after?: string;
  before?: string;
  excludeGlobal?: 0 | 1;
  showDeleted?: 0 | 1;
}

export async function listWorkspaceInfo(
  params: ListWorkspaceInfoParams,
  token?: string,
): Promise<WorkspaceInfo[]> {
  const result = await rpc<[WorkspaceInfo[]]>('list_workspace_info', [params], token);
  return result[0];
}

export interface ListObjectsParams {
  workspaces?: string[];
  ids?: number[];
  type?: string;
  limit?: number;
  showHidden?: 0 | 1;
  includeMetadata?: 0 | 1;
  startafter?: string;
}

export async function listObjects(
  params: ListObjectsParams,
  token?: string,
): Promise<ObjectInfo[]> {
  const result = await rpc<[ObjectInfo[]]>('list_objects', [params], token);
  return result[0];
}

export interface GetNamesByPrefixParams {
  workspaces: Array<{ id?: number; workspace?: string }>;
  prefix: string;
  includeHidden?: 0 | 1;
}

export async function getNamesbyPrefix(
  params: GetNamesByPrefixParams,
  token?: string,
): Promise<string[][]> {
  const result = await rpc<[{ names: string[][] }]>('get_names_by_prefix', [params], token);
  return result[0].names;
}

export interface ObjectSpecification {
  workspace?: string;
  wsid?: number;
  name?: string;
  objid?: number;
  ver?: number;
  /** UPA (`wsid/objid/ver`) or semicolon-separated chain (`root;hop1;target`) for reference-path access */
  ref?: string;
  find_reference_path?: 0 | 1;
}

export interface GetObjectInfo3Params {
  objects: ObjectSpecification[];
  infostruct?: 0 | 1;
  includeMetadata?: 0 | 1;
  ignoreErrors?: 0 | 1;
}

export async function getObjectInfo3(
  params: GetObjectInfo3Params,
  token?: string,
): Promise<{ infos: ObjectInfo[]; paths: string[][] }> {
  const result = await rpc<[{ infos: ObjectInfo[]; paths: string[][] }]>(
    'get_object_info3',
    [params],
    token,
  );
  return result[0];
}

export interface GetObjects2Params {
  objects: ObjectSpecification[];
  ignoreErrors?: 0 | 1;
  no_data?: 0 | 1;
}

export async function getObjects2(
  params: GetObjects2Params,
  token?: string,
): Promise<ObjectData[]> {
  const result = await rpc<[{ data: ObjectData[] }]>('get_objects2', [params], token);
  return result[0].data;
}

export async function getWorkspaceInfo(
  params: { id?: number; workspace?: string },
  token?: string,
): Promise<WorkspaceInfo> {
  const result = await rpc<[WorkspaceInfo]>('get_workspace_info', [params], token);
  return result[0];
}

export async function listReferencingObjects(
  objectIds: ObjectSpecification[],
  token?: string,
): Promise<ObjectInfo[][]> {
  const result = await rpc<[ObjectInfo[][]]>('list_referencing_objects', [objectIds], token);
  return result[0];
}
