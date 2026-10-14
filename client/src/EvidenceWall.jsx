import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from './api.js';
const TYPES = ['Person', 'Statement', 'Location', 'Event', 'Document', 'Object'];
const RELATIONS = [
  'Related to',
  'Mentioned in',
  'Occurred at',
  'Conflicts with',
  'Supports',
  'Observed by',
];
const COLORS = {
  Person: '#4FD1C5',
  Statement: '#FFC400',
  Location: '#8DB8FF',
  Event: '#D4A5FF',
  Document: '#FFA879',
  Object: '#A78BFA',
};
const STARTERS = [];
export default function EvidenceWall({ caseId, docs = [], flags = [] }) {
  const boardRef = useRef(null);
  const dragRef = useRef(null);
  const panRef = useRef(null);
  const movedRef = useRef(false);
  const [nodes, setNodes] = useState([]);
  const [edges, setEdges] = useState([]);
  const [history, setHistory] = useState({ past: [], future: [] });
  const [loaded, setLoaded] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [selected, setSelected] = useState([]);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('All');
  const [relation, setRelation] = useState('Related to');
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState({
    type: 'Person',
    title: '',
    detail: '',
  });
  const storageKey = `veritas-evidence-wall-${caseId}`;
  useEffect(() => {
    setLoaded(false);
    setHistory({ past: [], future: [] });
    setSelected([]);
    setZoom(1);
    setOffset({ x: 0, y: 0 });
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        const parsed = JSON.parse(saved);
        setNodes(parsed.nodes || []);
        setEdges(parsed.edges || []);
      } else {
        setNodes(STARTERS.map((n) => ({ ...n })));
        setEdges([]);
      }
    } catch {
      setNodes(STARTERS.map((n) => ({ ...n })));
      setEdges([]);
    }
    setLoaded(true);
  }, [storageKey]);
  useEffect(() => {
    if (!loaded) return;
    localStorage.setItem(storageKey, JSON.stringify({ nodes, edges }));
  }, [nodes, edges, loaded, storageKey]);
  // Add actual case documents and findings to the board.
  useEffect(() => {
    if (!loaded) return;
    api(`/cases/${caseId}/graph`).then((g) => {
      const T = { person: 'Person', place: 'Location', object: 'Object' };
      const X = { person: 700, place: 980, object: 1260 };
      const nid = (id) => (/^d[0-9a-f]{24}$/.test(id) ? 'doc-' + id.slice(1) : 'auto-' + id);
      const row = {};
      setNodes((cur) => {
        const keep = cur.filter((n) => !n.id.startsWith('auto-'));
        const add = g.nodes.filter((n) => T[n.type]).map((n) => {
          row[n.type] = (row[n.type] ?? -1) + 1;
          const old = cur.find((x) => x.id === nid(n.id));
          return old || { id: nid(n.id), type: T[n.type], title: n.label, detail: 'From analysis', x: X[n.type], y: 60 + row[n.type] * 150 };
        });
        return [...keep, ...add];
      });
      setEdges((cur) => [
        ...cur.filter((e) => !e.id.startsWith('auto-')),
        ...g.edges.map((e) => ({ id: 'auto-' + e.id, source: nid(e.source), target: nid(e.target), label: e.label, conflict: e.conflict })),
      ]);
    }).catch(() => {});
  }, [caseId, docs, flags, loaded]);
  useEffect(() => {
    if (!loaded) return;
    setNodes((current) => {
        let next = current.filter((n) =>
        (!n.id.startsWith('doc-') || docs.some((d) => 'doc-' + d._id === n.id)) &&
        (!n.id.startsWith('flag-') || flags.some((f) => 'flag-' + f._id === n.id)));
      const additions = [];
      docs.forEach((doc, i) => {
        const id = `doc-${doc._id}`;
        if (!next.some((n) => n.id === id)) {
          additions.push({
            id,
            type: 'Document',
            title: doc.name || 'Untitled document',
            detail: `${Math.max(1, Math.round((doc.size || 0) / 1024))} KB · Uploaded document`,
            x: 70 + (i % 3) * 260,
            y: 480 + Math.floor(i / 3) * 160,
          });
        }
      });
      flags.forEach((flag, i) => {
        const id = `flag-${flag._id}`;
        if (!next.some((n) => n.id === id)) {
          additions.push({
            id,
            type: 'Statement',
            title: flag.title || 'Finding',
            detail: `${flag.severity || 'Unspecified'} · ${flag.status || 'Open'} · Finding`,
            x: 70 + (i % 3) * 260,
            y: 680 + Math.floor(i / 3) * 160,
          });
        }
      });
      next = [...next, ...additions];
      return next;
    });
  }, [docs, flags, loaded]);
  // History only records investigator edits, not automatic analysis refreshes.
  const snap = () => {
    setHistory((h) => ({
      past: [...h.past, { nodes, edges }].slice(-30),
      future: [],
    }));
  };

  const undo = () => {
    if (!history.past.length) return;
    const previous = history.past[history.past.length - 1];
    setHistory((h) => ({
      past: h.past.slice(0, -1),
      future: [...h.future, { nodes, edges }],
    }));
    setNodes(previous.nodes);
    setEdges(previous.edges);
    setSelected([]);
  };

  const redo = () => {
    if (!history.future.length) return;
    const next = history.future[history.future.length - 1];
    setHistory((h) => ({
      past: [...h.past, { nodes, edges }].slice(-30),
      future: h.future.slice(0, -1),
    }));
    setNodes(next.nodes);
    setEdges(next.edges);
    setSelected([]);
  };

  useEffect(() => {
    const onKeyDown = (e) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey ||
          /^(INPUT|SELECT|TEXTAREA)$/.test(e.target?.tagName) ||
          e.target?.isContentEditable) return;
      const key = e.key.toLowerCase();
      if (key === 'z' && !e.shiftKey) {
        if (history.past.length) { e.preventDefault(); undo(); }
      } else if (key === 'y' || (key === 'z' && e.shiftKey)) {
        if (history.future.length) { e.preventDefault(); redo(); }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  // Reset only the wall; it never deletes uploaded evidence or database records.
  const resetBoard = async () => {
    if (!window.confirm('Reset the wall to the AI analysis? Manual cards, links and positions will be removed. You can Undo this reset.')) return;
    try {
      const g = await api(`/cases/${caseId}/graph`);
      const typeMap = { person: 'Person', place: 'Location', object: 'Object' };
      const xMap = { person: 700, place: 980, object: 1260 };
      const nid = (id) => /^d[0-9a-f]{24}$/.test(id) ? 'doc-' + id.slice(1) : 'auto-' + id;
      const rows = {};
      const documentNodes = docs.map((doc, i) => ({
        id: `doc-${doc._id}`, type: 'Document',
        title: doc.name || 'Untitled document',
        detail: `${Math.max(1, Math.round((doc.size || 0) / 1024))} KB · Uploaded document`,
        x: 70 + (i % 3) * 260, y: 480 + Math.floor(i / 3) * 160,
      }));
      const flagNodes = flags.map((flag, i) => ({
        id: `flag-${flag._id}`, type: 'Statement',
        title: flag.title || 'Finding',
        detail: `${flag.severity || 'Unspecified'} · ${flag.status || 'Open'} · Finding`,
        x: 70 + (i % 3) * 260, y: 680 + Math.floor(i / 3) * 160,
      }));
      const autoNodes = (g.nodes || []).filter((n) => typeMap[n.type]).map((n) => {
        rows[n.type] = (rows[n.type] ?? -1) + 1;
        return {
          id: nid(n.id), type: typeMap[n.type], title: n.label,
          detail: 'From analysis', x: xMap[n.type], y: 60 + rows[n.type] * 150,
        };
      });
      const freshNodes = [...documentNodes, ...flagNodes, ...autoNodes];
      const validIds = new Set(freshNodes.map((n) => n.id));
      const freshEdges = (g.edges || []).map((e) => ({
        id: 'auto-' + e.id, source: nid(e.source), target: nid(e.target),
        label: e.label, conflict: e.conflict,
      })).filter((e) => validIds.has(e.source) && validIds.has(e.target));
      snap();
      setNodes(freshNodes);
      setEdges(freshEdges);
      setSelected([]);
      setSearch('');
      setFilter('All');
      setError('');
      setZoom(1);
      setOffset({ x: 0, y: 0 });
      // Existing persistence effect saves this clean board to localStorage.
    } catch (e) {
      setError('Could not reload analysis. Your current wall was not changed.');
    }
  };

   const visibleNodes = useMemo(() => {
    const q = search.trim().toLowerCase();
    const hit = nodes.filter((n) =>
      (filter === 'All' || n.type === filter) &&
      (!q || n.title.toLowerCase().includes(q) || n.detail.toLowerCase().includes(q)));
    if (!q) return hit;
    const ids = new Set(hit.map((n) => n.id));
    edges.forEach((e) => {
      if (ids.has(e.source)) ids.add(e.target);
      if (ids.has(e.target)) ids.add(e.source);
    });
    return nodes.filter((n) => ids.has(n.id));
  }, [nodes, edges, search, filter]);

  const addNode = (e) => {
    e.preventDefault();
    if (!draft.title.trim()) {
      setError('Enter a title for this evidence card.');
      return;
    }
    snap();
    setNodes((current) => [
      ...current,
      {
        id: `manual-${Date.now()}`,
        type: draft.type,
        title: draft.title.trim(),
        detail: draft.detail.trim() || 'No additional details',
        x: 80 + (current.length % 3) * 255,
        y: 80 + Math.floor(current.length / 3) * 170,
      },
    ]);
    setDraft({ type: 'Person', title: '', detail: '' });
    setError('');
    setShowForm(false);
  };
  const toggleSelect = (id) => {
    setSelected((current) => {
      if (current.includes(id)) return current.filter((x) => x !== id);
      if (current.length >= 2) return [id];
      return [...current, id];
    });
  };
  const connectSelected = () => {
    if (selected.length !== 2) {
      setError('Select two evidence cards first.');
      return;
    }
    if (selected[0] === selected[1]) return;
    const exists = edges.some(
      (e) =>
        e.source === selected[0] &&
        e.target === selected[1] &&
        e.label === relation
    );
    if (exists) {
      setError('That connection already exists.');
      return;
    }
    snap();
    setEdges((current) => [
      ...current,
      {
        id: `edge-${Date.now()}`,
        source: selected[0],
        target: selected[1],
        label: relation,
      },
    ]);
    setSelected([]);
    setError('');
  };
  const removeSelected = () => {
    if (!selected.length) return;
    snap();
    const ids = [...selected];
    setNodes((current) => current.filter((n) => !ids.includes(n.id)));
    setEdges((current) =>
      current.filter((e) => !ids.includes(e.source) && !ids.includes(e.target))
    );
    setSelected([]);
    setError('');
  };
  const resetView = () => {
    setZoom(1);
    setOffset({ x: 0, y: 0 });
  };
  const onNodePointerDown = (e, node) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    dragRef.current = {
      id: node.id,
      startX: e.clientX,
      startY: e.clientY,
      nodeX: node.x,
      nodeY: node.y,
      snapped: false,
    };
    movedRef.current = false;
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onNodePointerMove = (e) => {
    if (!dragRef.current) return;
    const d = dragRef.current;
    const dx = (e.clientX - d.startX) / zoom;
    const dy = (e.clientY - d.startY) / zoom;
    if (Math.abs(dx) + Math.abs(dy) <= 3 && !d.snapped) return;
    if (!d.snapped) {
      snap();
      d.snapped = true;
    }
    movedRef.current = true;
    setNodes((current) =>
      current.map((n) =>
        n.id === d.id
          ? {
              ...n,
              x: Math.max(0, d.nodeX + dx),
              y: Math.max(0, d.nodeY + dy),
            }
          : n
      )
    );
  };
  const onNodePointerUp = () => {
    dragRef.current = null;
  };
  const onBoardPointerDown = (e) => {
    if (e.target !== boardRef.current) return;
    panRef.current = {
      x: e.clientX,
      y: e.clientY,
      offsetX: offset.x,
      offsetY: offset.y,
    };
    boardRef.current.setPointerCapture(e.pointerId);
  };
  const onBoardPointerMove = (e) => {
    if (!panRef.current) return;
    const p = panRef.current;
    setOffset({
      x: p.offsetX + e.clientX - p.x,
      y: p.offsetY + e.clientY - p.y,
    });
  };
  const stopPan = () => {
    panRef.current = null;
  };
  return (
    <section className="ew">
      <div className="ew-heading">
        <div>
          <span className="ew-eyebrow">INVESTIGATION TOOLS / 01</span>
          <h3>Evidence Wall<span className="ew-period">.</span></h3>
          <p>Map the connections. Keep every lead traceable.</p>
        </div>
        <div className="ew-count">
          <b>{nodes.length.toString().padStart(2, '0')}</b>
          <span>EVIDENCE ITEMS</span>
        </div>
      </div>
      <div className="ew-toolbar">
        <button className="ew-btn ew-primary" onClick={() => setShowForm(!showForm)}>
          {showForm ? 'Cancel' : '+ Add evidence'}
        </button>
        <select
          aria-label="Filter evidence type"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        >
          <option>All</option>
          {TYPES.map((t) => <option key={t}>{t}</option>)}
        </select>
        <input
          aria-label="Search evidence"
          placeholder="Search evidence..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          aria-label="Connection type"
          value={relation}
          onChange={(e) => setRelation(e.target.value)}
        >
          {RELATIONS.map((r) => <option key={r}>{r}</option>)}
        </select>
        <button className="ew-btn" onClick={connectSelected}>
          Connect {selected.length ? `(${selected.length}/2)` : ''}
        </button>
        <button
          className="ew-btn"
          disabled={!selected.length}
          onClick={removeSelected}
        >
          Delete selected
        </button>
        <button className="ew-btn" onClick={undo} disabled={!history.past.length}>Undo</button>
        <button className="ew-btn" onClick={redo} disabled={!history.future.length}>Redo</button>
        <button className="ew-btn" onClick={resetBoard}>Reset to analysis</button>
      </div>
      {showForm && (
        <form className="ew-form" onSubmit={addNode}>
          <div className="ew-form-grid">
            <label>
              Evidence type
              <select
                value={draft.type}
                onChange={(e) => setDraft({ ...draft, type: e.target.value })}
              >
                {TYPES.map((t) => <option key={t}>{t}</option>)}
              </select>
            </label>
            <label>
              Title
              <input
                autoFocus
                value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                placeholder="e.g. Witness statement"
                maxLength={100}
              />
            </label>
            <label className="ew-detail-field">
              Details
              <input
                value={draft.detail}
                onChange={(e) => setDraft({ ...draft, detail: e.target.value })}
                placeholder="Source, time, location or notes"
                maxLength={240}
              />
            </label>
          </div>
          {error && <p className="ew-error">{error}</p>}
          <button className="ew-btn ew-primary" type="submit">Add to wall</button>
        </form>
      )}
      {error && !showForm && <p className="ew-error">{error}</p>}
      <div className="ew-instructions">
        <span><i /> Drag cards to arrange them</span>
        <span><i /> Select two cards, then Connect</span>
        <span>{edges.length} connection{edges.length === 1 ? '' : 's'}</span>
      </div>
      <div className="ew-canvas-shell">
        <div
          className="ew-canvas"
          ref={boardRef}
          onPointerDown={onBoardPointerDown}
          onPointerMove={onBoardPointerMove}
          onPointerUp={stopPan}
          onPointerCancel={stopPan}
          onWheel={(e) => {
            if (e.ctrlKey || e.metaKey) {
              e.preventDefault();
              setZoom((z) => Math.min(1.6, Math.max(0.55, z - e.deltaY * 0.001)));
            }
          }}
        >
          <div className="ew-grid" />
          <div
            className="ew-world"
            style={{
              transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})`,
            }}
          >
            <svg className="ew-lines" width="1800" height="1200">
              {edges.map((edge) => {
                const a = visibleNodes.find((n) => n.id === edge.source);
                const b = visibleNodes.find((n) => n.id === edge.target);
                if (!a || !b) return null;
                const x1 = a.x + 100;
                const y1 = a.y + 60;
                const x2 = b.x + 100;
                const y2 = b.y + 60;
                const mx = (x1 + x2) / 2;
                const my = (y1 + y2) / 2;
                return (
                  <g key={edge.id} className="ew-edge">
                    <line x1={x1} y1={y1} x2={x2} y2={y2} className={edge.conflict ? 'bad' : undefined} />
                    <rect x={mx - 48} y={my - 12} width="96" height="24" rx="6" />
                    <text x={mx} y={my + 4} textAnchor="middle">{edge.label}</text>
                    <title>{edge.label}</title>
                  </g>
                );
              })}
            </svg>
            {visibleNodes.map((node) => (
              <div
                key={node.id}
                className={`ew-node ${selected.includes(node.id) ? 'is-selected' : ''}`}
                style={{
                  left: node.x,
                  top: node.y,
                  '--node-color': COLORS[node.type] || '#FFC400',
                }}
                onPointerDown={(e) => onNodePointerDown(e, node)}
                onPointerMove={onNodePointerMove}
                onPointerUp={onNodePointerUp}
                onPointerCancel={onNodePointerUp}
                onClick={() => {
                  if (movedRef.current) {
                    movedRef.current = false;
                    return;
                  }
                  toggleSelect(node.id);
                }}
                role="button"
                tabIndex={0}
                aria-pressed={selected.includes(node.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    toggleSelect(node.id);
                  }
                }}
              >
                <div className="ew-node-top">
                  <span className="ew-type-dot" />
                  <span>{node.type}</span>
                </div>
                <strong>{node.title}</strong>
                <p>{node.detail}</p>
              </div>
            ))}
          </div>
          {!visibleNodes.length && (
            <div className="ew-no-results">
              No evidence matches your search.
              <button className="ew-btn" onClick={() => { setSearch(''); setFilter('All'); }}>
                Clear filters
              </button>
            </div>
          )}
          <div className="ew-zoom">
            <button aria-label="Zoom out" onClick={() => setZoom((z) => Math.max(0.55, z - 0.1))}>−</button>
            <span>{Math.round(zoom * 100)}%</span>
            <button aria-label="Zoom in" onClick={() => setZoom((z) => Math.min(1.6, z + 0.1))}>+</button>
            <button onClick={resetView}>Reset</button>
          </div>
        </div>
      </div>
      <p className="ew-footnote">
        Evidence cards and connections are organizational aids, not proof of guilt
        or factual verification. Manual board edits are saved in this browser.
      </p>
    </section>
  );
}
