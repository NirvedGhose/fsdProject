import { useEffect, useState } from 'react';
import { api } from './api.js';

const toMin = (t) => { const m = /^(\d{1,2}):(\d{2})$/.exec(t || ''); return m ? +m[1] * 60 + +m[2] : null; };
const fmt = (m) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

export default function Timeline({ caseId, docs, flags }) {
  const [claims, setClaims] = useState([]);
  useEffect(() => { api(`/cases/${caseId}/claims`).then(setClaims).catch(() => {}); }, [caseId, docs, flags]);

  const bad = new Set(flags.filter((f) => f.status !== 'dismissed').flatMap((f) => (f.claimIds || []).map(String)));
  const name = Object.fromEntries(docs.map((d) => [String(d._id), d.name]));
  const ev = claims.filter((c) => toMin(c.startTime) !== null)
    .map((c) => ({ ...c, t: toMin(c.startTime) })).sort((a, b) => a.t - b.t);

  const rows = [];
  ev.forEach((e, i) => {
    const prev = ev[i - 1];
    if (prev && e.t - (toMin(prev.endTime) ?? prev.t) >= 30)
      rows.push({ gap: true, from: toMin(prev.endTime) ?? prev.t, to: e.t });
    rows.push(e);
  });

  return (
    <section className="tl">
      <h3>Timeline</h3>
      <small>Gaps and red markers are leads that require verification, not conclusions.</small>
      {!rows.length ? <p className="empty">Run an analysis to build the timeline.</p> : rows.map((r, i) => r.gap ? (
        <div className="tl-gap" key={i}>Gap: {fmt(r.from)} to {fmt(r.to)}, no source</div>
      ) : (
        <div className={'tl-row' + (bad.has(String(r._id)) ? ' bad' : '')} key={r._id}>
          <b>{fmt(r.t)}</b>
          <div>
            <strong>{r.person || r.description}{r.place ? ' at ' + r.place : ''}</strong>
            <small>{name[String(r.doc)] || 'Document'}</small>
            {bad.has(String(r._id)) && <span className="pill">Conflict</span>}
          </div>
        </div>
      ))}
    </section>
  );
}