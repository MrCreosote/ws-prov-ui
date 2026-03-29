import { useEffect, useRef, useState } from 'react';
import cytoscape, { type Core, type EdgeSingular } from 'cytoscape';
import dagre from 'cytoscape-dagre';
import {
  getObjects2,
  getObjectInfo3,
  listReferencingObjects,
  type ProvenanceAction,
} from '../api/workspace';
import { ProvenancePanel } from './ProvenancePanel';
import type { ObjOption } from './ObjectSelector';

cytoscape.use(dagre);

// ---- helpers ----------------------------------------------------------------

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

/** Wrap a string at character boundaries (names have no spaces) */
function wrapChars(s: string, w: number): string {
  const chunks: string[] = [];
  for (let i = 0; i < s.length; i += w) chunks.push(s.slice(i, i + w));
  return chunks.join('\n');
}

function nodeLabel(name: string, type: string, version: number, upa: string): string {
  return `${wrapChars(name, 24)}\n${truncate(type, 32)}\nv${version}\n${upa}`;
}

// ---- layout & style ---------------------------------------------------------

const LAYOUT = {
  name: 'dagre',
  rankDir: 'TB',   // top-to-bottom: referrers → selected → referenced
  nodeSep: 120,
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
      label: 'data(label)',
      'text-valign': 'bottom',
      'text-halign': 'center',
      'text-margin-y': 6,
      'text-wrap': 'wrap',
      'text-max-width': '200px',
      color: '#1a1a2e',
      'font-size': '11px',
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
    selector: 'node.truncated',
    style: {
      shape: 'roundrectangle',
      width: 90,
      height: 28,
      'background-color': '#888',
      'border-style': 'dotted',
      'border-color': '#bbb',
      'text-valign': 'center',
      'text-margin-y': 0,
      'font-size': '10px',
      color: '#fff',
    },
  },
  {
    selector: 'edge',
    style: {
      'curve-style': 'bezier',
      'target-arrow-shape': 'triangle',
      // Dynamic offset: radius(11) + text-margin-y(6) + lines × font-size(11) + gap(4)
      // For truncated nodes (pill shape, height 28), just clear the pill bottom.
      'source-endpoint': ((ele: cytoscape.EdgeSingular) => {
        const src = ele.source();
        if (src.hasClass('truncated')) return '0px 16px';
        const label = (src.data('label') as string) ?? '';
        const lines = label.split('\n').length;
        return `0px ${21 + lines * 11}px`;
      }) as unknown as string,
      width: 2,
      'line-color': '#888',
      'target-arrow-color': '#888',
    },
  },
  {
    selector: 'edge:selected',
    style: { 'line-color': '#f0a500', 'target-arrow-color': '#f0a500', width: 3 },
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
  const cyRef = useRef<Core | null>(null);
  const [selectedProvenance, setSelectedProvenance] = useState<ProvenanceAction[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // ---- init cytoscape -------------------------------------------------------
  useEffect(() => {
    if (!containerRef.current) return;
    const cy = cytoscape({ container: containerRef.current, style: STYLE, elements: [] });
    cyRef.current = cy;

    cy.on('tap', 'edge', (evt) => {
      const edge = evt.target as EdgeSingular;
      setSelectedProvenance(edge.data('provenance') ?? []);
    });

    return () => { cy.destroy(); cyRef.current = null; };
  }, []);

  // ---- load 3-row graph when object changes ---------------------------------
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;

    cy.elements().remove();
    setSelectedProvenance(null);
    setLoadError(null);
    setLoading(true);

    const ref = rootObject.value;
    let cancelled = false;

    async function load() {
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

      // 4. Fetch labels for referenced objects via the ref chain
      let refLabels: (string | null)[] = refArray.map(() => null);
      if (refArray.length) {
        const { infos } = await getObjectInfo3(
          { objects: refArray.map((r) => ({ ref: `${ref};${r}` })), ignoreErrors: 1 },
          token,
        );
        if (cancelled || cy.destroyed()) return;
        refLabels = infos.map((info, i) =>
          info ? nodeLabel(info[1], info[2], info[4], refArray[i]) : null,
        );
      }

      // 5. Build graph in one batch
      const rootInfo = objData.info;
      cy.batch(() => {
        // Root node (middle row)
        cy.add({
          group: 'nodes',
          data: { id: ref, label: nodeLabel(rootInfo[1], rootInfo[2], rootInfo[4], ref) },
          classes: 'root',
        });

        // Referenced objects (bottom row): root → ref
        refArray.forEach((rRef, i) => {
          cy.add({
            group: 'nodes',
            data: { id: rRef, label: refLabels[i] ?? rRef },
          });
          cy.add({
            group: 'edges',
            data: {
              id: `${ref}→${rRef}`,
              source: ref,
              target: rRef,
              provenance: objData.provenance,
            },
          });
        });

        // Referrer objects (top row): referrer → root
        referrers.forEach((rinfo) => {
          const rRef = `${rinfo[6]}/${rinfo[0]}/${rinfo[4]}`;
          cy.add({
            group: 'nodes',
            data: { id: rRef, label: nodeLabel(rinfo[1], rinfo[2], rinfo[4], rRef) },
          });
          cy.add({
            group: 'edges',
            data: { id: `${rRef}→${ref}`, source: rRef, target: ref, provenance: [] },
          });
        });

        // "+N more" placeholder if referrers were truncated
        if (truncatedCount > 0) {
          const moreId = `${ref}__more`;
          cy.add({
            group: 'nodes',
            data: { id: moreId, label: `+${truncatedCount} more` },
            classes: 'truncated',
          });
          cy.add({
            group: 'edges',
            data: { id: `${moreId}→${ref}`, source: moreId, target: ref, provenance: [] },
          });
        }
      });

      cy.layout(LAYOUT as cytoscape.LayoutOptions).run();
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rootObject.value, token]);

  return (
    <div className="graph-wrapper">
      <div ref={containerRef} className="graph-container" />
      {loading && <div className="graph-loading">Loading…</div>}
      {loadError && <div className="graph-error">{loadError}</div>}
      <div className="graph-legend">
        <span className="legend-item">Gold border = selected object</span>
        <span className="legend-item legend-item--edge">Click an edge to view provenance details</span>
      </div>
      {selectedProvenance !== null && (
        <ProvenancePanel
          actions={selectedProvenance}
          onClose={() => setSelectedProvenance(null)}
        />
      )}
    </div>
  );
}
