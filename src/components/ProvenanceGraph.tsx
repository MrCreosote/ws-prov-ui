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
  nodeSep: 160,
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
  const expandedSetRef = useRef<Set<string>>(new Set());
  const overlayElsRef = useRef<Map<string, HTMLElement>>(new Map());
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
      const upa = node.data('upa') as string;
      clickedNodeIdRef.current = nodeId;

      if (cacheRef.current.has(upa)) {
        setDialogData(cacheRef.current.get(upa)!);
        return;
      }
      const refPath = node.data('refPath') as string;
      getObjects2({ objects: [{ ref: refPath }], no_data: 1 }, tokenRef.current)
        .then(([data]) => {
          if (data && clickedNodeIdRef.current === nodeId) {
            cacheRef.current.set(upa, data);
            setDialogData(data);
          }
        })
        .catch(console.error);
    });

    // Keep overlay label positions and scale in sync with graph on every render (pan/zoom/layout)
    cy.on('render', () => {
      if (cy.destroyed()) return;
      const zoom = cy.zoom();
      cy.nodes(':not(.truncated)').forEach((node) => {
        const el = overlayElsRef.current.get(node.id());
        if (!el) return;
        const pos = node.renderedPosition();
        const r = node.renderedHeight() / 2;
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
    expandedSetRef.current.clear();
    setLoadError(null);
    setLoading(true);

    if (overlayRef.current) overlayRef.current.innerHTML = '';
    overlayElsRef.current.clear();

    const ref = rootObject.value;
    let cancelled = false;

    /** Append a styled label div to the overlay for a non-truncated node */
    function addOverlayLabel(id: string, name: string, type: string, upa: string, expandable: boolean) {
      const overlay = overlayRef.current;
      if (!overlay) return;
      const el = document.createElement('div');
      el.setAttribute('data-nid', id);
      el.className = 'node-overlay';
      const nameEl = document.createElement('span');
      nameEl.className = 'node-overlay__name';
      nameEl.innerHTML = formatName(name);
      const typeEl = document.createElement('span');
      typeEl.className = 'node-overlay__type';
      typeEl.textContent = parseType(type);
      const wsEl = document.createElement('span');
      wsEl.className = 'node-overlay__ws';
      wsEl.textContent = upa;
      if (expandable) {
        const btn = document.createElement('button');
        btn.className = 'expand-btn';
        btn.textContent = '⊕';
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          expandNode(id, id);  // node ID is the refPath
        });
        el.appendChild(btn);
      }
      el.appendChild(nameEl);
      el.appendChild(typeEl);
      el.appendChild(wsEl);
      overlayElsRef.current.set(id, el);
      overlay.appendChild(el);
    }

    /** Expand a node's downstream references. */
    async function expandNode(nodeId: string, refPath: string) {
      if (expandedSetRef.current.has(nodeId)) return;
      expandedSetRef.current.add(nodeId);

      const btn = overlayElsRef.current.get(nodeId)?.querySelector<HTMLButtonElement>('.expand-btn');
      if (btn) { btn.disabled = true; btn.textContent = '…'; }

      try {
        const upa = nodeId.includes(';') ? nodeId.split(';').pop()! : nodeId;

        // Prefer cached data — same object regardless of which ref-chain path reached it.
        // This avoids re-fetching via a deep chain that may not be a valid access path.
        let objData = cacheRef.current.get(upa) ?? null;
        if (!objData) {
          const [fetched] = await getObjects2(
            { objects: [{ ref: refPath }], no_data: 1 },
            tokenRef.current,
          );
          objData = fetched ?? null;
          if (objData) cacheRef.current.set(upa, objData);
        }

        if (btn) btn.textContent = '⊘';

        const _cy = cyRef.current;
        if (!_cy || _cy.destroyed()) return;

        const allRefUpas = [...new Set<string>([
          ...(objData?.refs ?? []),
          ...(objData?.provenance.flatMap((a) => a.resolved_ws_objects ?? []) ?? []),
        ])];
        if (allRefUpas.length === 0) return;

        let refNodeData: ({ name: string; type: string } | null)[] = allRefUpas.map(() => null);
        const { infos } = await getObjectInfo3(
          { objects: allRefUpas.map((r) => ({ ref: `${refPath};${r}` })), ignoreErrors: 1 },
          tokenRef.current,
        );
        if (!_cy.destroyed()) {
          refNodeData = infos.map((info) => info ? { name: info[1], type: info[2] } : null);
        } else {
          return;
        }
        _cy.batch(() => {
          allRefUpas.forEach((rUpa, i) => {
            const d = refNodeData[i];
            const childId = `${refPath};${rUpa}`;
            _cy.add({ group: 'nodes', data: { id: childId, refPath: childId, upa: rUpa, name: d?.name ?? rUpa, type: d?.type ?? '' } });
            _cy.add({ group: 'edges', data: { id: `${nodeId}→${childId}`, source: nodeId, target: childId } });
          });
        });

        allRefUpas.forEach((rUpa, i) => {
          const d = refNodeData[i];
          const childId = `${refPath};${rUpa}`;
          addOverlayLabel(childId, d?.name ?? rUpa, d?.type ?? '', rUpa, true);
        });

        _cy.layout(LAYOUT as cytoscape.LayoutOptions).run();
        requestAnimationFrame(updateEdgeStyle);

      } catch (e) {
        console.error('expand failed', e);
        expandedSetRef.current.delete(nodeId);
        if (btn) { btn.textContent = '⊕'; btn.disabled = false; }
      }
    }

    /** Set source-endpoint per rank and add vertical stems for sub-max-height nodes. */
    function updateEdgeStyle() {
      const _cy = cyRef.current;
      if (!_cy || _cy.destroyed()) return;

      // Group nodes by rank (same y position in the TB layout).
      const byRank = new Map<number, cytoscape.NodeSingular[]>();
      _cy.nodes(':not(.truncated)').forEach((node) => {
        const rank = Math.round(node.position().y);
        if (!byRank.has(rank)) byRank.set(rank, []);
        byRank.get(rank)!.push(node);
      });

      // For each rank: use the tallest label height to set a shared source-endpoint,
      // and add a vertical stem on shorter nodes to bridge the gap.
      //
      // Overlay local coords (before scale(zoom)):
      //   label occupies 0 → h px; tail gap ends at h+4; row arrow-start at maxH+4.
      //   stem: top = h+4, height = maxH−h.
      // With scale(zoom) applied, these DOM-px values equal graph units, so the
      // stem aligns exactly with the cytoscape edge geometry.
      byRank.forEach((nodes) => {
        const heights = nodes.map((node) => {
          const el = overlayElsRef.current.get(node.id());
          return el ? el.offsetHeight : 0;
        });
        const maxH = Math.max(0, ...heights);
        if (!maxH) return;

        const offset = Math.ceil(21 + maxH);
        nodes.forEach((node, i) => {
          node.outgoers('edge').style({ 'source-endpoint': `0px ${offset}px` });

          const el = overlayElsRef.current.get(node.id());
          if (!el) return;

          // Remove any stale stem from a previous layout run.
          el.querySelector('.node-stem')?.remove();

          const h = heights[i];
          if (h > 0 && maxH - h > 1 && node.outdegree() > 0) {
            const stem = document.createElement('div');
            stem.className = 'node-stem';
            stem.style.cssText =
              `position:absolute;left:74px;width:2px;top:${h + 4}px;` +
              `height:${maxH - h}px;background:#888;pointer-events:none;`;
            el.appendChild(stem);
          }
        });
      });
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

      // Cache root data and mark it as expanded
      cacheRef.current.set(ref, objData);
      expandedSetRef.current.add(ref);

      // 5. Build graph in one batch
      const rootInfo = objData.info;
      cy.batch(() => {
        // Root node (middle row)
        cy.add({
          group: 'nodes',
          data: { id: ref, refPath: ref, upa: ref, name: rootInfo[1], type: rootInfo[2] },
          classes: 'root',
        });

        // Referenced objects (bottom row): root → child
        refArray.forEach((rRef, i) => {
          const d = refNodeData[i];
          const childId = `${ref};${rRef}`;
          cy.add({ group: 'nodes', data: { id: childId, refPath: childId, upa: rRef, name: d?.name ?? rRef, type: d?.type ?? '' } });
          cy.add({
            group: 'edges',
            data: { id: `${ref}→${childId}`, source: ref, target: childId },
          });
        });

        // Referrer objects (top row): referrer → root
        referrers.forEach((rinfo) => {
          const rRef = `${rinfo[6]}/${rinfo[0]}/${rinfo[4]}`;
          cy.add({ group: 'nodes', data: { id: rRef, refPath: rRef, upa: rRef, name: rinfo[1], type: rinfo[2] }, classes: 'referrer' });
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
        const nodeId = node.id();
        const expandable = nodeId !== ref && !node.hasClass('referrer');
        addOverlayLabel(nodeId, node.data('name') as string, node.data('type') as string, node.data('upa') as string, expandable);
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
        <ObjectInfoDialog objData={dialogData} token={token} onClose={() => setDialogData(null)} />
      )}
    </div>
  );
}
