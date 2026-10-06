import { useEffect, useRef, useState } from 'react';
import gsap from 'gsap';
import { Flip } from 'gsap/Flip';
import { useGSAP } from '@gsap/react';
import { api } from './api.js';

gsap.registerPlugin(Flip);

const COLS = [['open', 'Open'], ['verified', 'Verified'], ['dismissed', 'Dismissed']];
const ext = (n) => (n.includes('.') ? n.split('.').pop() : 'file').slice(0, 4);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Dynamic-island status pill: springs open to show progress, then closes
function Island({ text, pct, open }) {
  const r = useRef();
  useGSAP(() => {
    gsap.to(r.current, { width: open ? 360 : 0, height: open ? 64 : 0, opacity: open ? 1 : 0, duration: open ? 0.9 : 0.5, ease: open ? 'elastic.out(1,0.65)' : 'power3.in' });
  }, { dependencies: [open] });
  return <div className="isl" ref={r} role="status"><span>{text}</span><i style={{ width: pct + '%' }} /></div>;
}

function Dropzone({ onFiles }) {
  const r = useRef(), inp = useRef();
  const [over, setOver] = useState(false);
  useGSAP(() => { gsap.to(r.current, { scale: over ? 1.02 : 1, duration: 0.4, ease: 'power3.out' }); }, { dependencies: [over] });
  const take = (list) => { const f = [...list]; if (f.length) onFiles(f); };
  return (
    <div className="box sp drop" ref={r} data-over={over} tabIndex={0} role="button" aria-label="Upload statements"
      onClick={() => inp.current.click()} onKeyDown={(e) => e.key === 'Enter' && inp.current.click()}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); take(e.dataTransfer.files); }}>
      <input ref={inp} type="file" multiple hidden onChange={(e) => { take(e.target.files); e.target.value = ''; }} />
      <b className="disp">Drop statements here</b>
      <span>PDF, DOCX or TXT. Click to choose files. For now only file names and sizes are saved.</span>
    </div>
  );
}

function Card({ f, hidden, onOpen }) {
  return (
    <div className="box sp kc" draggable tabIndex={0} data-flip-id={hidden ? undefined : 'm-' + f._id} style={hidden ? { visibility: 'hidden' } : null}
      onDragStart={(e) => e.dataTransfer.setData('text/plain', f._id)}
      onClick={(e) => onOpen(f, e.currentTarget)} onKeyDown={(e) => e.key === 'Enter' && onOpen(f, e.currentTarget)}>
      <span className={'sev ' + f.severity}>{f.severity}</span><small>{f.type}</small>
      <h4>{f.title}</h4>
    </div>
  );
}

export default function Workspace({ caseId, onBack, onLogout }) {
  const root = useRef();
  const [c, setC] = useState(null);
  const [docs, setDocs] = useState([]);
  const [flags, setFlags] = useState([]);
  const [isl, setIsl] = useState({ open: false, text: '', pct: 0 });
  const [busy, setBusy] = useState(false);
  const [dlg, setDlg] = useState(null);
  const [err, setErr] = useState('');
  const fail = (e) => (e.status === 401 ? onLogout() : setErr(e.message));

  useEffect(() => { api('/cases/' + caseId).then((d) => { setC(d.case); setDocs(d.docs); setFlags(d.flags); }).catch(fail); }, [caseId]);
  useGSAP(() => { if (c) gsap.from('.ws-in', { y: 30, opacity: 0, stagger: 0.08, duration: 0.8, ease: 'power3.out' }); }, { scope: root, dependencies: [c === null] });

  const upload = async (files) => {
    try {
      const made = [];
      for (const f of files) made.push(await api(`/cases/${caseId}/documents`, { method: 'POST', body: { name: f.name, size: f.size, type: f.type } }));
      setDocs((d) => [...made, ...d]);
      requestAnimationFrame(() => gsap.from('.dc', { y: 16, opacity: 0, stagger: 0.05, duration: 0.5, clearProps: 'all' }));
    } catch (e) { fail(e); }
  };

  const step = async (text, pct) => { setIsl({ open: true, text, pct }); await wait(750); };
  const analyze = async () => {
    setBusy(true); setErr('');
    try {
      const n = Math.min(docs.length, 4);
      for (let i = 1; i <= n; i++) await step(`Reading statement ${i} of ${docs.length}`, Math.round((i / (n + 2)) * 100));
      await step('Comparing claims', 88);
      const d = await api(`/cases/${caseId}/analyze`, { method: 'POST' });
      setFlags(d);
      setIsl({ open: true, text: `${d.length} flags ready for review`, pct: 100 });
      requestAnimationFrame(() => gsap.from('.kc', { y: 30, opacity: 0, stagger: 0.1, duration: 0.7, ease: 'power3.out', clearProps: 'all' }));
      await wait(2200);
    } catch (e) { fail(e); }
    setIsl((s) => ({ ...s, open: false })); setBusy(false);
  };

  const move = async (id, status, animate = true) => {
    const st = animate && Flip.getState('.kc');
    setFlags((fs) => fs.map((x) => (x._id === id ? { ...x, status } : x)));
    if (st) requestAnimationFrame(() => Flip.from(st, { duration: 0.6, ease: 'expo.out', nested: true }));
    try { await api('/flags/' + id, { method: 'PATCH', body: { status } }); } catch (e) { fail(e); }
  };

  // Morphing dialog: the card itself grows into the dialog (and shrinks back)
  const openDlg = (f, el) => {
    const st = Flip.getState(el);
    setDlg(f._id);
    requestAnimationFrame(() => {
      Flip.from(st, { targets: document.querySelector('.dlg'), duration: 0.7, ease: 'expo.inOut' });
      gsap.from('.dlg-body', { opacity: 0, y: 16, delay: 0.35, duration: 0.5 });
      gsap.from('.scrim', { opacity: 0, duration: 0.4 });
    });
  };
  const closeDlg = () => {
    const id = dlg, st = Flip.getState(document.querySelector('.dlg'));
    setDlg(null);
    requestAnimationFrame(() => {
      const el = document.querySelector(`[data-flip-id="m-${id}"]`);
      if (el) Flip.from(st, { targets: el, duration: 0.6, ease: 'expo.inOut' });
    });
  };
  useEffect(() => {
    if (!dlg) return;
    const k = (e) => e.key === 'Escape' && closeDlg();
    addEventListener('keydown', k);
    return () => removeEventListener('keydown', k);
  }, [dlg]);

  const f = flags.find((x) => x._id === dlg);
  return (
    <div className="app" ref={root}>
      <Island {...isl} />
      <div className="bar ws-in"><button className="btn alt" onClick={onBack}>Back to cases</button></div>
      {err && <p className="err">{err}</p>}
      {c && (<>
        <div className="ws-h ws-in"><div><span className="tag">{c.caseNo}</span><h2 className="disp" style={{ fontSize: '3rem', marginTop: 8 }}>{c.title}</h2></div></div>
        <div className="ws-in"><Dropzone onFiles={upload} /></div>
        {docs.length > 0 && <div className="docs ws-in">{docs.map((d) => (
          <div className="box dc" key={d._id}><span className="fi">{ext(d.name)}</span><div><b>{d.name}</b><br /><small>{Math.max(1, Math.round(d.size / 1024))} KB</small></div></div>
        ))}</div>}
        <div className={'box run ws-in' + (busy ? ' glow' : '')}>
          <div><b>Analysis</b><br /><small>{docs.length ? 'Compare statements and flag what may need checking.' : 'Upload at least one statement first.'}</small></div>
          <button className="btn" disabled={!docs.length || busy} onClick={analyze}>{busy ? 'Analyzing' : 'Run analysis'}</button>
        </div>
        {flags.some((x) => x.demo) && <p className="note ws-in">These are sample flags. Real analysis arrives when the AI service is connected. Flags are leads for an investigator to check.</p>}
        <div className="kb ws-in">{COLS.map(([k, label]) => {
          const list = flags.filter((x) => x.status === k);
          return (
            <div className="col" key={k} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { const id = e.dataTransfer.getData('text/plain'); if (id) move(id, k); }}>
              <h4>{label}<span>{list.length}</span></h4>
              {list.map((x) => <Card key={x._id} f={x} hidden={dlg === x._id} onOpen={openDlg} />)}
              {!list.length && <p className="empty">{k === 'open' ? 'No flags yet. Run an analysis.' : 'Drag a flag here.'}</p>}
            </div>
          );
        })}</div>
      </>)}
      {f && (<>
        <div className="scrim" onClick={closeDlg} />
        <div className="box dlg" data-flip-id={'m-' + f._id} role="dialog" aria-modal="true" aria-label={f.title}>
          <div className="dlg-body">
            <span className={'sev ' + f.severity}>{f.severity}</span><small>{f.type}</small>
            <h3>{f.title}</h3>
            <div className="pair">
              <blockquote><small>{f.sourceA}</small>{f.quoteA}</blockquote>
              <blockquote><small>{f.sourceB}</small>{f.quoteB}</blockquote>
            </div>
            <p>{f.explanation}</p>
            <div className="row">
              {f.status !== 'verified' && <button className="btn" onClick={() => { move(f._id, 'verified', false); closeDlg(); }}>Mark verified</button>}
              {f.status !== 'dismissed' && <button className="btn alt" onClick={() => { move(f._id, 'dismissed', false); closeDlg(); }}>Dismiss</button>}
              {f.status !== 'open' && <button className="btn alt" onClick={() => { move(f._id, 'open', false); closeDlg(); }}>Reopen</button>}
              <button className="btn alt" onClick={closeDlg}>Close</button>
            </div>
          </div>
        </div>
      </>)}
    </div>
  );
}
