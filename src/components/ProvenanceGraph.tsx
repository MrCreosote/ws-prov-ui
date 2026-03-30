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

/** Compare UPAs numerically: workspace id, then object id, then version */
function compareUpa(a: string, b: string): number {
  const [aws, aobj, aver] = a.split('/').map(Number);
  const [bws, bobj, bver] = b.split('/').map(Number);
  return aws - bws || aobj - bobj || aver - bver;
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
  {
    selector: 'node.dup-hover',
    style: { 'border-style': 'solid', 'border-width': 3, 'border-color': '#9b59b6' },
  },
  {
    selector: 'edge.dup-link',
    style: {
      'curve-style': 'straight',
      'line-style': 'dashed',
      'line-dash-pattern': [6, 4],
      width: 1.5,
      'line-color': '#9b59b6',
      'target-arrow-shape': 'none',
    },
  },
];

const REFERRER_LIMIT = 50;

// ---- component --------------------------------------------------------------

interface Props {
  token: string;
  rootObject: ObjOption;
  onReroot: (opt: ObjOption) => void;
}

export function ProvenanceGraph({ token, rootObject, onReroot }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | null>(null);
  const tokenRef = useRef(token);
  const onRerootRef = useRef(onReroot);
  const cacheRef = useRef<Map<string, ObjectData>>(new Map());
  const clickedNodeIdRef = useRef<string | null>(null);
  const expandedSetRef = useRef<Set<string>>(new Set());
  const overlayElsRef = useRef<Map<string, HTMLElement>>(new Map());
  // Tracks the above-node expand button container for upstream-expandable nodes
  const overlayAboveElsRef = useRef<Map<string, HTMLElement>>(new Map());
  // Tracks the right-of-node reroot button container
  const overlayRightElsRef = useRef<Map<string, HTMLElement>>(new Map());
  const [dialogData, setDialogData] = useState<ObjectData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [bannerMsg, setBannerMsg] = useState<string | null>(null);

  // Sync token ref and clear cache when token changes
  useEffect(() => {
    tokenRef.current = token;
    cacheRef.current.clear();
  }, [token]);

  // Keep onRerootRef current so DOM handlers always call the latest callback
  useEffect(() => { onRerootRef.current = onReroot; }, [onReroot]);

  // Auto-dismiss the inaccessible-node banner
  useEffect(() => {
    if (!bannerMsg) return;
    const t = setTimeout(() => setBannerMsg(null), 3500);
    return () => clearTimeout(t);
  }, [bannerMsg]);

  // ---- init cytoscape -------------------------------------------------------
  useEffect(() => {
    if (!containerRef.current) return;
    const cy = cytoscape({ container: containerRef.current, style: STYLE, elements: [], autoungrabify: true });
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

    // Highlight duplicate nodes (same UPA) on mouseover with purple outlines + dashed links
    cy.on('mouseover', 'node:not(.truncated)', (evt) => {
      const node = evt.target as NodeSingular;
      const upa = node.data('upa') as string;
      if (!upa) return;
      const dupes = cy.nodes(':not(.truncated)').filter((n) => n.data('upa') === upa);
      if (dupes.length < 2) return;
      dupes.addClass('dup-hover');
      dupes.forEach((a, i) => {
        dupes.forEach((b, j) => {
          if (i < j) {
            cy.add({ group: 'edges', classes: 'dup-link', data: { id: `dup-${i}-${j}`, source: a.id(), target: b.id() } });
          }
        });
      });
    });

    cy.on('mouseout', 'node:not(.truncated)', () => {
      cy.nodes().removeClass('dup-hover');
      cy.edges('.dup-link').remove();
    });

    // Keep overlay label positions and scale in sync with graph on every render (pan/zoom/layout)
    cy.on('render', () => {
      if (cy.destroyed()) return;
      const zoom = cy.zoom();
      cy.nodes(':not(.truncated)').forEach((node) => {
        const pos = node.renderedPosition();
        const r = node.renderedHeight() / 2;

        // Below-node label
        const el = overlayElsRef.current.get(node.id());
        if (el) {
          el.style.left = `${Math.round(pos.x - 75 * zoom)}px`;
          el.style.top = `${Math.round(pos.y + r + 6 * zoom)}px`;
          el.style.transform = `scale(${zoom})`;
        }

        // Above-node expand button (upstream-expandable nodes only)
        const aboveEl = overlayAboveElsRef.current.get(node.id());
        if (aboveEl) {
          const btnH = aboveEl.offsetHeight || 20;
          aboveEl.style.left = `${Math.round(pos.x - 15 * zoom)}px`;
          aboveEl.style.top = `${Math.round(pos.y - r - (btnH + 4) * zoom)}px`;
          aboveEl.style.transform = `scale(${zoom})`;
        }

        // Right-of-node reroot button
        const rightEl = overlayRightElsRef.current.get(node.id());
        if (rightEl) {
          const btnH = rightEl.offsetHeight || 22;
          rightEl.style.left = `${Math.round(pos.x + r + 4 * zoom)}px`;
          rightEl.style.top  = `${Math.round(pos.y - (btnH * zoom) / 2)}px`;
          rightEl.style.transform = `scale(${zoom})`;
        }
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
    overlayAboveElsRef.current.clear();
    overlayRightElsRef.current.clear();
    setBannerMsg(null);

    const ref = rootObject.value;
    let cancelled = false;

    /**
     * Append a styled label div below the node.
     * expandDirection:
     *   'down' — expand button at the top of the label block (downstream refs)
     *   'up'   — expand button in a separate div above the node dot (upstream referrers)
     *   'none' — no expand button
     */
    function addOverlayLabel(
      id: string, name: string, type: string, upa: string,
      expandDirection: 'up' | 'down' | 'none',
      expandRefPath?: string,  // refPath to use for the expand button; defaults to id
    ) {
      const overlay = overlayRef.current;
      if (!overlay) return;

      // Below-node label element
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

      if (expandDirection === 'down') {
        const btn = document.createElement('button');
        btn.className = 'expand-btn';
        btn.textContent = '⊕';
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          expandNode(id, id, 'down');
        });
        el.appendChild(btn);
      }

      el.appendChild(nameEl);
      el.appendChild(typeEl);
      el.appendChild(wsEl);
      overlayElsRef.current.set(id, el);
      overlay.appendChild(el);

      // Above-node element for upstream expand button
      if (expandDirection === 'up') {
        const aboveEl = document.createElement('div');
        aboveEl.className = 'node-expand-above';
        const btn = document.createElement('button');
        btn.className = 'expand-btn';
        btn.textContent = '⊕';
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          expandNode(id, expandRefPath ?? id, 'up');
        });
        aboveEl.appendChild(btn);
        overlayAboveElsRef.current.set(id, aboveEl);
        overlay.appendChild(aboveEl);
      }

      // Right-of-node reroot button (all non-root nodes)
      if (expandDirection !== 'none') {
        const rightEl = document.createElement('div');
        rightEl.className = 'node-action-right';
        const rerootBtn = document.createElement('button');
        rerootBtn.className = 'reroot-btn';
        rerootBtn.title = 'Make this the root object';
        rerootBtn.textContent = '⊙';

        rerootBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          rerootBtn.disabled = true;
          rerootBtn.textContent = '…';

          if (expandDirection === 'up') {
            // Upstream nodes are always directly accessible — build ObjOption from node data.
            const [, , verStr] = upa.split('/');
            onRerootRef.current({
              value: upa, name, type,
              version: parseInt(verStr, 10),
              saveDate: '', savedBy: '', sizeBytes: 0, label: name,
            });
          } else {
            // Downstream nodes may require a ref chain. Check bare-UPA accessibility first.
            try {
              const { infos } = await getObjectInfo3(
                { objects: [{ ref: upa }], ignoreErrors: 1 },
                tokenRef.current,
              );
              const info = infos[0];
              if (!info) {
                setBannerMsg('This object is not directly accessible — cannot reroot here.');
                rerootBtn.disabled = false;
                rerootBtn.textContent = '⊙';
                return;
              }
              onRerootRef.current({
                value: upa,
                name: info[1], type: info[2], version: info[4],
                saveDate: new Date(info[3]).toLocaleString(),
                savedBy: info[5], sizeBytes: info[9], label: info[1],
              });
            } catch {
              rerootBtn.disabled = false;
              rerootBtn.textContent = '⊙';
            }
          }
        });

        rightEl.appendChild(rerootBtn);
        overlayRightElsRef.current.set(id, rightEl);
        overlay.appendChild(rightEl);
      }
    }

    /** Expand a node upstream (find referrers) or downstream (find refs). */
    async function expandNode(nodeId: string, refPath: string, direction: 'up' | 'down') {
      const expandKey = `${direction}:${nodeId}`;
      if (expandedSetRef.current.has(expandKey)) return;
      expandedSetRef.current.add(expandKey);

      const containerEl = direction === 'up'
        ? overlayAboveElsRef.current.get(nodeId)
        : overlayElsRef.current.get(nodeId);
      const btn = containerEl?.querySelector<HTMLButtonElement>('.expand-btn');
      if (btn) { btn.disabled = true; btn.textContent = '…'; }

      try {
        if (direction === 'down') {
          // ---- downstream: expand references from this node ----------------
          const upa = nodeId.includes(';') ? nodeId.split(';').pop()! : nodeId;

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
          ])].sort(compareUpa);
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
              if (!_cy.nodes().filter((n) => n.id() === childId).length) {
                _cy.add({ group: 'nodes', data: { id: childId, refPath: childId, upa: rUpa, name: d?.name ?? rUpa, type: d?.type ?? '' } });
              }
              if (!_cy.edges().filter((e) => e.id() === `${nodeId}→${childId}`).length) {
                _cy.add({ group: 'edges', data: { id: `${nodeId}→${childId}`, source: nodeId, target: childId } });
              }
            });
          });

          allRefUpas.forEach((rUpa, i) => {
            const d = refNodeData[i];
            const childId = `${refPath};${rUpa}`;
            if (!overlayElsRef.current.has(childId)) {
              addOverlayLabel(childId, d?.name ?? rUpa, d?.type ?? '', rUpa, 'down');
            }
          });

        } else {
          // ---- upstream: find objects that reference this node ---------------
          const referrerResult = await listReferencingObjects([{ ref: refPath }], tokenRef.current);

          if (btn) btn.textContent = '⊘';

          const _cy = cyRef.current;
          if (!_cy || _cy.destroyed()) return;

          const allReferrers = [...(referrerResult[0] ?? [])].sort((a, b) =>
            compareUpa(`${a[6]}/${a[0]}/${a[4]}`, `${b[6]}/${b[0]}/${b[4]}`),
          );
          if (allReferrers.length === 0) return;

          const referrers = allReferrers.slice(0, REFERRER_LIMIT);
          const truncatedCount = allReferrers.length - referrers.length;

          // Each referrer gets a unique path-based ID (nodeId←upa), mirroring how
          // downstream uses nodeId;upa — so the same physical object can appear
          // multiple times if discovered via different expansion paths.
          _cy.batch(() => {
            referrers.forEach((rinfo) => {
              const rRef = `${rinfo[6]}/${rinfo[0]}/${rinfo[4]}`;
              const childId = `${nodeId}←${rRef}`;
              _cy.add({ group: 'nodes', data: { id: childId, refPath: rRef, upa: rRef, name: rinfo[1], type: rinfo[2] } });
              _cy.add({ group: 'edges', data: { id: `${childId}→${nodeId}`, source: childId, target: nodeId } });
            });
            if (truncatedCount > 0) {
              const moreId = `${nodeId}__more_up`;
              _cy.add({ group: 'nodes', data: { id: moreId, label: `+${truncatedCount} more` }, classes: 'truncated' });
              _cy.add({ group: 'edges', data: { id: `${moreId}→${nodeId}`, source: moreId, target: nodeId } });
            }
          });

          referrers.forEach((rinfo) => {
            const rRef = `${rinfo[6]}/${rinfo[0]}/${rinfo[4]}`;
            const childId = `${nodeId}←${rRef}`;
            // Pass rRef as expandRefPath so the expand button fetches by direct UPA
            addOverlayLabel(childId, rinfo[1], rinfo[2], rRef, 'up', rRef);
          });
        }

        const _cy = cyRef.current;
        if (_cy && !_cy.destroyed()) {
          // Remove transient dup-link edges before layout so dagre doesn't treat
          // them as real constraints and misassign node ranks.
          _cy.edges('.dup-link').remove();
          _cy.nodes().removeClass('dup-hover');
          _cy.layout(LAYOUT as cytoscape.LayoutOptions).run();
          requestAnimationFrame(updateEdgeStyle);
        }

      } catch (e) {
        console.error('expand failed', e);
        expandedSetRef.current.delete(expandKey);
        if (btn) { btn.textContent = '⊕'; btn.disabled = false; }
      }
    }

    /** Set source-endpoint per rank, add vertical stems for sub-max-height nodes,
     *  and offset target-endpoints for nodes with above-node expand buttons. */
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
      byRank.forEach((nodes) => {
        const heights = nodes.map((node) => {
          const el = overlayElsRef.current.get(node.id());
          return el ? el.offsetHeight : 0;
        });
        const maxH = Math.max(0, ...heights);
        if (!maxH) return;

        const offset = Math.ceil(21 + maxH);
        nodes.forEach((node, i) => {
          node.outgoers('edge:not(.dup-link)').style({ 'source-endpoint': `0px ${offset}px` });

          const el = overlayElsRef.current.get(node.id());
          if (!el) return;

          // Remove any stale stem from a previous layout run.
          el.querySelector('.node-stem')?.remove();

          const h = heights[i];
          if (h > 0 && maxH - h > 1 && node.outgoers('edge:not(.dup-link)').length > 0) {
            const stem = document.createElement('div');
            stem.className = 'node-stem';
            stem.style.cssText =
              `position:absolute;left:74px;width:2px;top:${h + 4}px;` +
              `height:${maxH - h}px;background:#888;pointer-events:none;`;
            el.appendChild(stem);
          }
        });
      });

      // For nodes with upstream expand buttons, shift the incoming arrowhead
      // upward to clear the button above the node dot.
      _cy.nodes(':not(.truncated)').forEach((node) => {
        const aboveEl = overlayAboveElsRef.current.get(node.id());
        if (aboveEl) {
          const btnH = aboveEl.offsetHeight || 20;
          // radius (11) + gap (4) + button height — all in graph units (= DOM px at zoom 1)
          const upOffset = Math.ceil(11 + 4 + btnH);
          node.incomers('edge:not(.dup-link)').style({ 'target-endpoint': `0px -${upOffset}px` });
        }
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
      const refArray = [...refSet].sort(compareUpa);

      // 3. Fetch referrers (top row)
      const referrerResult = await listReferencingObjects([{ ref }], token);
      if (cancelled || cy.destroyed()) return;
      const allReferrers = [...(referrerResult[0] ?? [])].sort((a, b) =>
        compareUpa(`${a[6]}/${a[0]}/${a[4]}`, `${b[6]}/${b[0]}/${b[4]}`),
      );
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

      // Cache root data and mark it as downstream-expanded (refs are already shown)
      cacheRef.current.set(ref, objData);
      expandedSetRef.current.add(`down:${ref}`);

      // 5. Build graph in one batch
      const rootInfo = objData.info;
      cy.batch(() => {
        // Root node (middle row) — no expand buttons
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
        // ID uses ref←upa so the path always starts at the selected node,
        // mirroring how downstream uses ref;upa.
        referrers.forEach((rinfo) => {
          const rRef = `${rinfo[6]}/${rinfo[0]}/${rinfo[4]}`;
          const referrerId = `${ref}←${rRef}`;
          cy.add({ group: 'nodes', data: { id: referrerId, refPath: rRef, upa: rRef, name: rinfo[1], type: rinfo[2] }, classes: 'referrer' });
          cy.add({ group: 'edges', data: { id: `${referrerId}→${ref}`, source: referrerId, target: ref } });
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
        let expandDirection: 'up' | 'down' | 'none';
        if (nodeId === ref) expandDirection = 'none';
        else if (node.hasClass('referrer')) expandDirection = 'up';
        else expandDirection = 'down';
        // Pass refPath from node data so the expand button uses the bare UPA for
        // upstream nodes (id ≠ refPath there), and the full chain for downstream.
        addOverlayLabel(nodeId, node.data('name') as string, node.data('type') as string, node.data('upa') as string, expandDirection, node.data('refPath') as string);
      });

      cy.layout(LAYOUT as cytoscape.LayoutOptions).run();

      // After the first paint, measure label heights and set source/target endpoints
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
      {bannerMsg && <div className="graph-notice">{bannerMsg}</div>}
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
