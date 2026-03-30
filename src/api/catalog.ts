const NMS_URL = 'https://narrative.kbase.us/services/narrative_method_store/rpc';

let _reqId = 0;

async function nmsRpc<T>(method: string, params: unknown[]): Promise<T> {
  const res = await fetch(NMS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ version: '1.1', id: String(++_reqId), method: `NarrativeMethodStore.${method}`, params }),
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error.message ?? String(json.error));
  return json.result as T;
}

// ---- App brief info (NMS) ---------------------------------------------------

export interface AppBriefInfo {
  id: string;
  module_name: string;
  name: string;   // human-readable display name
}

const _appCache = new Map<string, AppBriefInfo | null>();

/**
 * Fetch human-readable info for one app from the NarrativeMethodStore.
 * @param moduleMethod  e.g. "fba_tools/run_flux_balance_analysis"
 */
export async function getAppBriefInfo(moduleMethod: string): Promise<AppBriefInfo | null> {
  if (_appCache.has(moduleMethod)) return _appCache.get(moduleMethod)!;
  try {
    const [[result]] = await nmsRpc<[[AppBriefInfo | null]]>(
      'get_method_brief_info',
      [{ ids: [moduleMethod] }],
    );
    _appCache.set(moduleMethod, result ?? null);
    return result ?? null;
  } catch {
    _appCache.set(moduleMethod, null);
    return null;
  }
}
