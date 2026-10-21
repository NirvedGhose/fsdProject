
import { useEffect, useMemo, useRef, useState } from 'react';

const TYPES = ['Person', 'Statement', 'Location', 'Event', 'Document'];
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
};

const STARTERS = [
  { id: 'starter-1', type: 'Person', title: 'Witness A', detail: 'Add a person or witness', x: 70, y: 70 },
  { id: 'starter-2', type: 'Statement', title: 'Statement 01', detail: 'Add a claim or quotation', x: 350, y: 95 },
  { id: 'starter-3', type: 'Event', title: 'Reported event', detail: 'Add an event or timestamp', x: 180, y: 310 },
];

export default function EvidenceWall({ caseId, docs = [], flags = [] }) {
  const boardRef = useRef(null);
  const dragRef = useRef(null);
  const panRef = useRef(null);
  const movedRef = useRef(false);
  const [nodes, setNodes] = useState([]);
  const [edges, setEdges] = useState([]);
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

    setNodes((current) => {
      let next = [...current];
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

  const visibleNodes = useMemo(() => {
    const q = search.trim().toLowerCase();
    return nodes.filter((n) => {
      const matchesType = filter === 'All' || n.type === filter;
      const matchesSearch =
        !q ||
        n.title.toLowerCase().includes(q) ||
        n.detail.toLowerCase().includes(q);
      return matchesType && matchesSearch;
    });
  }, [nodes, search, filter]);

  const addNode = (e) => {
    e.preventDefault();
    if (!draft.title.trim()) {
      setError('Enter a title for this evidence card.');
      return;
    }

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
    };

    movedRef.current = false;
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onNodePointerMove = (e) => {
    if (!dragRef.current) return;

    const d = dragRef.current;
    const dx = (e.clientX - d.startX) / zoom;
    const dy = (e.clientY - d.startY) / zoom;

    if (Math.abs(dx) + Math.abs(dy) > 3) movedRef.current = true;

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

  const positions = Object.fromEntries(nodes.map((n) => [n.id, n]));

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
                const a = positions[edge.source];
                const b = positions[edge.target];
                if (!a || !b) return null;

                const x1 = a.x + 100;
                const y1 = a.y + 60;
                const x2 = b.x + 100;
                const y2 = b.y + 60;
                const mx = (x1 + x2) / 2;
                const my = (y1 + y2) / 2;

                return (
                  <g key={edge.id} className="ew-edge">
                    <line x1={x1} y1={y1} x2={x2} y2={y2} />
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
                  <span className="ew-node-mark">
                    {selected.includes(node.id) ? '✓' : '+'}
                  </span>
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
        Document cards represent uploaded metadata; original file contents are not
        stored by this wall.
      </p>
    </section>
  );
}
