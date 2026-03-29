import { useEffect, useRef, useState } from 'react';
import cytoscape, { type Core, type NodeSingular } from 'cytoscape';
import dagre from 'cytoscape-dagre';
import {
  getObjects2,
  getObjectInfo3,
  listReferencingObjects,
  type ObjectData,
} from '../api/workspace';
import type { ObjOption } from './ObjectSelector';
import { ObjectInfoDialog } from './ObjectInfoDialog';

cytoscape.use(dagre);

// ---- helpers ----------------------------------------------------------------

/** Strip KBase type version suffix: "KBaseFBA.FBA-13.2" → "KBaseFBA.FBA" */
function parseType(fullType: string): string {
  return fullType.replace(/-[\d.]+$/, '');
}

/** Insert zero-width spaces after _ and . so CSS can word-wrap at natural breakpoints */
function formatName(name: string): string {
  return name.replace(/[_.]/g, (c) => c + '\u200B');
}

// ---- layout & style ---------------------------------------------------------

const LAYOUT = {
  name: 'dagre',
  rankDir: 'TB',   // top-to-bottom: referrers → selected → referenced
  nodeSep: 140,
  rankSep: 170,
};

const STYLE: cytoscape.StylesheetStyle[] = [
  {
    selector: 'node',
    style: {
      shape: 'ellipse',
      width: 22,
      height: 22,
      'background-color': '#4a90d9',
      'border-width': 2,
      'border-color': '#4a90d9',
      label: '',  // HTML overlay used for labels instead of native text
    },
  },
  {
    selector: 'node.root',
    style: {
      'background-color': '#1a5fa8',
      'border-style': 'solid',
      'border-width': 3,
      'border-color': '#f0a500',
    },
  },
  {
    selector: 'node.info-selected',
    style: { 'border-style': 'dashed', 'border-width': 3, 'border-color': '#56b4e9' },
  },
  {
    // Root node when info-selected: keep gold but make dashed
    selector: 'node.root.info-selected',
    style: { 'border-style': 'dashed', 'border-color': '#f0a500' },
  },
  {
    selector: 'node.truncated',
    style: {
      shape: 'roundrectangle',
      width: 90,
      height: 28,
      'background-color': '#888',
      'border-style': 'dotted',
      'border-color': '#bbb',
      'text-valign': 'center',
      'text-halign': 'center',
      'font-size': '10px',
      color: '#fff',
      label: 'data(label)',  // truncated pill keeps native text
    },
  },
  {
    selector: 'edge',
    style: {
      'curve-style': 'bezier',
      'target-arrow-shape': 'triangle',
      width: 2,
      'line-color': '#888',
      'target-arrow-color': '#888',
    },
  },
];

const REFERRER_LIMIT = 50;

// ---- component --------------------------------------------------------------

interface Props {
  token: string;
  rootObject: ObjOption;
}

export function ProvenanceGraph({ token, rootObject }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | null>(null);
  const tokenRef = useRef(token);
  const cacheRef = useRef<Map<string, ObjectData>>(new Map());
  const clickedNodeIdRef = useRef<string | null>(null);
  const [dialogData, setDialogData] = useState<ObjectData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Sync token ref and clear cache when token changes
  useEffect(() => {
    tokenRef.current = token;
    cacheRef.current.clear();
  }, [token]);

  // ---- init cytoscape -------------------------------------------------------
  useEffect(() => {
    if (!containerRef.current) return;
    const cy = cytoscape({ container: containerRef.current, style: STYLE, elements: [] });
    cyRef.current = cy;

    cy.on('tap', 'node:not(.truncated)', (evt) => {
      const node = evt.target as NodeSingular;
      cy.nodes().removeClass('info-selected');
      node.addClass('info-selected');
      const nodeId = node.id();
      clickedNodeIdRef.current = nodeId;

      if (cacheRef.current.has(nodeId)) {
        setDialogData(cacheRef.current.get(nodeId)!);
        return;
      }
      const refPath = node.data('refPath') as string;
      getObjects2({ objects: [{ ref: refPath }], no_data: 1 }, tokenRef.current)
        .then(([data]) => {
          if (data && clickedNodeIdRef.current === nodeId) {
            cacheRef.current.set(nodeId, data);
            setDialogData(data);
          }
        })
        .catch(console.error);
    });

    // Keep overlay label positions and scale in sync with graph on every render (pan/zoom/layout)
    cy.on('render', () => {
      const overlay = overlayRef.current;
      if (!overlay || cy.destroyed()) return;
      const zoom = cy.zoom();
      cy.nodes(':not(.truncated)').forEach((node) => {
        const el = overlay.querySelector<HTMLElement>(`[data-nid="${node.id()}"]`);
        if (!el) return;
        const pos = node.renderedPosition();
        const r = node.renderedHeight() / 2;
        // left = pos.x - 75*zoom keeps visual center at pos.x at any zoom level
        // (label is 150px wide; with scale(zoom) from top-left, right edge = pos.x+75*zoom)
        el.style.left = `${Math.round(pos.x - 75 * zoom)}px`;
        el.style.top = `${Math.round(pos.y + r + 6 * zoom)}px`;
        el.style.transform = `scale(${zoom})`;
      });
    });

    return () => { cy.destroy(); cyRef.current = null; };
  }, []);

  // ---- load 3-row graph when object changes ---------------------------------
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;

    cy.elements().remove();
    setDialogData(null);
    clickedNodeIdRef.current = null;
    setLoadError(null);
    setLoading(true);

    if (overlayRef.current) overlayRef.current.innerHTML = '';

    const ref = rootObject.value;
    let cancelled = false;

    /** Append a styled label div to the overlay for a non-truncated node */
    function addOverlayLabel(id: string, name: string, type: string) {
      const overlay = overlayRef.current;
      if (!overlay) return;
      const el = document.createElement('div');
      el.setAttribute('data-nid', id);
      el.className = 'node-overlay';
      const nameEl = document.createElement('span');
      nameEl.className = 'node-overlay__name';
      // Insert zero-width spaces so the browser can wrap at _ and .
      nameEl.innerHTML = formatName(name);
      const typeEl = document.createElement('span');
      typeEl.className = 'node-overlay__type';
      typeEl.textContent = parseType(type);
      const wsEl = document.createElement('span');
      wsEl.className = 'node-overlay__ws';
      wsEl.textContent = id;
      el.appendChild(nameEl);
      el.appendChild(typeEl);
      el.appendChild(wsEl);
      overlay.appendChild(el);
    }

    /** Measure overlay label heights and set edge source-endpoint (zoom-invariant with scaled labels) */
    function updateEdgeStyle() {
      const _cy = cyRef.current;
      if (!_cy || _cy.destroyed() || !overlayRef.current) return;
      const els = overlayRef.current.querySelectorAll<HTMLElement>('.node-overlay');
      let maxH = 0;
      els.forEach((el) => { maxH = Math.max(maxH, el.offsetHeight); });
      if (!maxH) return;
      // With scale(zoom) applied to labels, they occupy maxH graph units regardless of zoom.
      // So source-endpoint = radius(11) + gap(6) + label(maxH) + tail-gap(4) = 21 + maxH graph units.
      const offset = Math.ceil(21 + maxH);
      _cy.style().selector('edge').style({ 'source-endpoint': `0px ${offset}px` }).update();
    }

    async function load() {
      if (!cy) return;
      // 1. Fetch selected object (refs + provenance)
      const [objData] = await getObjects2({ objects: [{ ref }], no_data: 1 }, token);
      if (cancelled || cy.destroyed()) return;

      if (!objData) {
        setLoadError(`Cannot access object ${ref}`);
        return;
      }

      // 2. Collect referenced objects (bottom row)
      const refSet = new Set<string>([
        ...objData.refs,
        ...objData.provenance.flatMap((a) => a.resolved_ws_objects ?? []),
      ]);
      const refArray = [...refSet];

      // 3. Fetch referrers (top row)
      const referrerResult = await listReferencingObjects([{ ref }], token);
      if (cancelled || cy.destroyed()) return;
      const allReferrers = referrerResult[0] ?? [];
      const referrers = allReferrers.slice(0, REFERRER_LIMIT);
      const truncatedCount = allReferrers.length - referrers.length;

      // 4. Fetch name+type for referenced objects via ref chain
      let refNodeData: ({ name: string; type: string } | null)[] = refArray.map(() => null);
      if (refArray.length) {
        const { infos } = await getObjectInfo3(
          { objects: refArray.map((r) => ({ ref: `${ref};${r}` })), ignoreErrors: 1 },
          token,
        );
        if (cancelled || cy.destroyed()) return;
        refNodeData = infos.map((info) => info ? { name: info[1], type: info[2] } : null);
      }

      // Cache root data now that we have it
      cacheRef.current.set(ref, objData);

      // 5. Build graph in one batch
      const rootInfo = objData.info;
      cy.batch(() => {
        // Root node (middle row)
        cy.add({
          group: 'nodes',
          data: { id: ref, refPath: ref, name: rootInfo[1], type: rootInfo[2] },
          classes: 'root',
        });

        // Referenced objects (bottom row): root → ref
        refArray.forEach((rRef, i) => {
          const d = refNodeData[i];
          cy.add({ group: 'nodes', data: { id: rRef, refPath: `${ref};${rRef}`, name: d?.name ?? rRef, type: d?.type ?? '' } });
          cy.add({
            group: 'edges',
            data: { id: `${ref}→${rRef}`, source: ref, target: rRef },
          });
        });

        // Referrer objects (top row): referrer → root
        referrers.forEach((rinfo) => {
          const rRef = `${rinfo[6]}/${rinfo[0]}/${rinfo[4]}`;
          cy.add({ group: 'nodes', data: { id: rRef, refPath: rRef, name: rinfo[1], type: rinfo[2] } });
          cy.add({ group: 'edges', data: { id: `${rRef}→${ref}`, source: rRef, target: ref } });
        });

        // "+N more" placeholder if referrers were truncated
        if (truncatedCount > 0) {
          const moreId = `${ref}__more`;
          cy.add({ group: 'nodes', data: { id: moreId, label: `+${truncatedCount} more` }, classes: 'truncated' });
          cy.add({ group: 'edges', data: { id: `${moreId}→${ref}`, source: moreId, target: ref } });
        }
      });

      // Add overlay labels (must happen before layout so positions are ready on first render)
      cy.nodes(':not(.truncated)').forEach((node) => {
        addOverlayLabel(node.id(), node.data('name') as string, node.data('type') as string);
      });

      cy.layout(LAYOUT as cytoscape.LayoutOptions).run();

      // After the first paint, measure label heights and set source-endpoint
      requestAnimationFrame(updateEdgeStyle);
    }

    load()
      .catch((e) => {
        if (!cancelled && !cy.destroyed())
          setLoadError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled && !cy.destroyed()) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [rootObject.value, token]);

  return (
    <div className="graph-wrapper">
      <div ref={containerRef} className="graph-container" />
      <div ref={overlayRef} className="graph-overlay" />
      {loading && <div className="graph-loading">Loading…</div>}
      {loadError && <div className="graph-error">{loadError}</div>}
      <div className="graph-legend">
        <span className="legend-item">Gold border = selected object</span>
        <span className="legend-item">Arrow tip = referenced object</span>
      </div>
      {dialogData && (
        <ObjectInfoDialog objData={dialogData} onClose={() => setDialogData(null)} />
      )}
    </div>
  );
}
