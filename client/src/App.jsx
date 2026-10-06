import { useEffect, useRef, useState } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useGSAP } from '@gsap/react';
import { ScrambleTextPlugin } from 'gsap/ScrambleTextPlugin';
import { DrawSVGPlugin } from 'gsap/DrawSVGPlugin';
import Lenis from 'lenis';
import { api } from './api.js';
import Workspace from './Workspace.jsx';

gsap.registerPlugin(ScrollTrigger, ScrambleTextPlugin, DrawSVGPlugin, useGSAP);

const Chars = ({ t }) => <>{[...t].map((c, i) => <span className="cm" key={i}><span className="hc">{c}</span></span>)}</>;

function Mag({ children, ...p }) {
  const r = useRef();
  const mv = (e) => {
    const b = r.current.getBoundingClientRect();
    gsap.to(r.current, { x: (e.clientX - b.left - b.width / 2) * 0.3, y: (e.clientY - b.top - b.height / 2) * 0.3, duration: 0.4, ease: 'power3.out' });
  };
  const lv = () => gsap.to(r.current, { x: 0, y: 0, duration: 0.9, ease: 'elastic.out(1,0.4)' });
  return <button ref={r} onMouseMove={mv} onMouseLeave={lv} {...p}>{children}</button>;
}

function Loader({ onReveal, onDone }) {
  const root = useRef(), num = useRef();
  useEffect(() => { document.body.style.overflow = 'hidden'; return () => { document.body.style.overflow = ''; }; }, []);
  useGSAP(() => {
    const n = { v: 0 };
    gsap.timeline({ onComplete: onDone })
      .to(n, { v: 100, duration: 2, ease: 'power2.inOut', onUpdate: () => (num.current.textContent = Math.round(n.v)) })
      .to('.ld-bar', { scaleX: 1, duration: 2, ease: 'power2.inOut' }, 0)
      .to('.ld-in', { yPercent: -60, opacity: 0, duration: 0.5, ease: 'power3.in' })
      .to(root.current, { yPercent: -100, duration: 1, ease: 'expo.inOut' }, '-=0.1')
      .call(onReveal, null, '-=0.5');
  }, { scope: root });
  return (
    <div className="ld" ref={root}>
      <div className="ld-in">
        <p>Preparing case workspace</p>
        <span className="disp ld-num" ref={num}>0</span>
        <div className="ld-bar" />
      </div>
    </div>
  );
}

// Entity network: nodes link to each other and to the cursor (signal-particle idea from ThreeUI)
function Net() {
  const ref = useRef();
  useEffect(() => {
    const c = ref.current, g = c.getContext('2d'), dpr = Math.min(devicePixelRatio, 2), m = { x: -999, y: -999 };
    let w, h;
    const size = () => { w = c.clientWidth; h = c.clientHeight; c.width = w * dpr; c.height = h * dpr; g.setTransform(dpr, 0, 0, dpr, 0, 0); };
    size();
    const p = Array.from({ length: innerWidth < 700 ? 38 : 80 }, () => ({ x: Math.random() * w, y: Math.random() * h, vx: (Math.random() - 0.5) * 0.35, vy: (Math.random() - 0.5) * 0.35 }));
    const mv = (e) => { const b = c.getBoundingClientRect(); m.x = e.clientX - b.left; m.y = e.clientY - b.top; };
    const tick = () => {
      g.clearRect(0, 0, w, h);
      p.forEach((a, i) => {
        a.x += a.vx; a.y += a.vy;
        if (a.x < 0 || a.x > w) a.vx *= -1;
        if (a.y < 0 || a.y > h) a.vy *= -1;
        g.fillStyle = '#4FD1C5'; g.fillRect(a.x - 1.5, a.y - 1.5, 3, 3);
        for (let j = i + 1; j < p.length; j++) {
          const b = p[j], d = Math.hypot(a.x - b.x, a.y - b.y);
          if (d < 120) { g.strokeStyle = `rgba(79,209,197,${0.28 * (1 - d / 120)})`; g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke(); }
        }
        const dm = Math.hypot(a.x - m.x, a.y - m.y);
        if (dm < 170) { g.strokeStyle = `rgba(255,196,0,${0.8 * (1 - dm / 170)})`; g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(m.x, m.y); g.stroke(); }
      });
    };
    gsap.ticker.add(tick);
    addEventListener('mousemove', mv); addEventListener('resize', size);
    return () => { gsap.ticker.remove(tick); removeEventListener('mousemove', mv); removeEventListener('resize', size); };
  }, []);
  return <canvas className="net" ref={ref} aria-hidden="true" />;
}

const TYPES = ['People', 'Locations', 'Dates', 'Events', 'Vehicles', 'Phone numbers', 'Documents', 'Statements'];
function Marquee() {
  const r = useRef();
  useGSAP(() => { gsap.to('.mq-in', { xPercent: -50, duration: 32, ease: 'none', repeat: -1 }); }, { scope: r });
  return (
    <div className="mq" ref={r} aria-hidden="true">
      <div className="mq-in">{[0, 1].map((k) => TYPES.map((t) => <span key={k + t}>{t}<i /></span>))}</div>
    </div>
  );
}

const Nd = ({ x, y, t, w = 150 }) => (
  <g className="nd"><g transform={`translate(${x},${y})`}><rect x={-w / 2} y="-24" width={w} height="48" rx="24" /><text textAnchor="middle" y="6">{t}</text></g></g>
);
function Graph() {
  const r = useRef();
  useGSAP(() => {
    const tl = gsap.timeline({ scrollTrigger: { trigger: r.current, start: 'top 65%', toggleActions: 'play none none reverse' } });
    tl.from('.nd', { opacity: 0, y: 24, stagger: 0.12, duration: 0.6, ease: 'back.out(2)' })
      .from('.ed:not(.warn)', { drawSVG: '0%', duration: 1, stagger: 0.18, ease: 'power2.inOut' }, 0.3)
      .from('.warn', { attr: { y2: 96 }, duration: 0.8, ease: 'power2.out' })
      .from('.wl', { opacity: 0, scale: 0.8, svgOrigin: '400 211', duration: 0.4 });
  }, { scope: r });
  return (
    <section className="graph" ref={r}>
      <h2 className="pipe-h">Everything connects. Conflicts stand out.</h2>
      <svg viewBox="0 0 800 420" role="img" aria-label="Relationship graph: Person X linked to two locations, each tied to a statement">
        <path className="ed" d="M170 210 L400 70" /><path className="ed" d="M170 210 L400 350" />
        <path className="ed" d="M400 70 L640 70" /><path className="ed" d="M400 350 L640 350" />
        <line className="ed warn" x1="400" y1="96" x2="400" y2="324" /><g className="wl"><rect x="318" y="196" width="164" height="30" rx="15" /><text x="400" y="216" textAnchor="middle">Same time, 9 PM</text></g>
        <Nd x={110} y={210} t="Person X" w={120} /><Nd x={400} y={70} t="Location A" /><Nd x={400} y={350} t="Location B" />
        <Nd x={700} y={70} t="Statement A" /><Nd x={700} y={350} t="Statement B" />
      </svg>
      <p className="gp">People, places and statements become a network. A yellow line marks two places claimed for the same time.</p>
    </section>
  );
}

function Cursor() {
  const r = useRef();
  useEffect(() => {
    if (!matchMedia('(pointer:fine)').matches) return;
    const xs = gsap.quickTo(r.current, 'x', { duration: 0.4, ease: 'power3' }), ys = gsap.quickTo(r.current, 'y', { duration: 0.4, ease: 'power3' });
    const mv = (e) => { xs(e.clientX); ys(e.clientY); };
    const ov = (e) => r.current.classList.toggle('big', !!e.target.closest?.('button,a,input,textarea'));
    addEventListener('mousemove', mv); addEventListener('mouseover', ov);
    return () => { removeEventListener('mousemove', mv); removeEventListener('mouseover', ov); };
  }, []);
  return <div className="cur" ref={r} />;
}

const STEPS = [
  ['Ingest', 'Upload statements, interview transcripts and case files. Text is extracted with page and character positions kept.'],
  ['Extract', 'People, places, times and events become structured claims, each tied to its exact quote.'],
  ['Normalize', '"He", "the suspect" and "J. Sharma" resolve to one person. "Around 9 PM" becomes a time range.'],
  ['Compare', 'Claims are checked against each other for conflicting timelines, differing details and missing information.'],
  ['Review', 'Every flag shows both quotes and why it matters. An officer verifies or dismisses it.'],
];

function Landing({ ready, onEnter, user }) {
  const root = useRef();
  useGSAP(() => {
    if (ready) {
      gsap.from('.hc', { yPercent: 115, stagger: 0.06, duration: 1.3, ease: 'expo.out' });
      gsap.from('.hero p, .hero .row', { opacity: 0, y: 24, duration: 1, stagger: 0.15, delay: 0.7, ease: 'power3.out' });
      gsap.to('.scr', { duration: 1.8, delay: 0.9, scrambleText: { text: '12 statements read. 1 conflict flagged.', chars: '0123456789', speed: 0.5 } });
    }
  }, { scope: root, dependencies: [ready] });

  useGSAP(() => {
    gsap.timeline({ scrollTrigger: { trigger: '.demo', start: 'top top', end: '+=130%', scrub: 1, pin: true } })
      .from('.stmt', { y: 60, opacity: 0, stagger: 0.3 })
      .to('.hl', { backgroundSize: '100% 100%', stagger: 0.4 })
      .from('.flag', { y: 80, opacity: 0, duration: 1 });

    const track = document.querySelector('.track');
    gsap.to(track, {
      x: () => -(track.scrollWidth - window.innerWidth),
      ease: 'none',
      scrollTrigger: { trigger: '.pipe', start: 'top top', end: () => '+=' + track.scrollWidth, scrub: 1, pin: true, invalidateOnRefresh: true },
    });
    gsap.from('.foot > *', { y: 50, opacity: 0, stagger: 0.12, scrollTrigger: { trigger: '.foot', start: 'top 70%' } });
  }, { scope: root });

  return (
    <div ref={root}>
      <nav className="nav"><b className="disp">VERITAS</b><button className="btn" onClick={onEnter}>{user ? 'Open dashboard' : 'Officer sign in'}</button></nav>
      <section className="hero">
        <Net />
        <span className="chip"><i /><span className="scr">Reading statements</span></span>
        <h1><Chars t="VERITAS" /></h1>
        <p>Case and statement intelligence for investigators. Upload statements, see what conflicts, and decide what to verify.</p>
        <div className="row"><Mag className="btn" onClick={onEnter}>Start a case</Mag></div>
      </section>
      <Marquee />
      <section className="demo">
        <h2>It flags. You decide.</h2>
        <div className="pair">
          <div className="box stmt"><small>Statement A</small>Person X was at <span className="hl">Location A</span> at 9 PM.</div>
          <div className="box stmt"><small>Statement B</small>Person X was at <span className="hl">Location B</span> at 9 PM.</div>
        </div>
        <div className="flag"><b>Possible timeline conflict</b><p>The two statements place Person X at different locations at about the same time. Verify before relying on either.</p></div>
      </section>
      <Graph />
      <section className="pipe">
        <h2 className="pipe-h">From documents to leads</h2>
        <div className="track">
          {STEPS.map(([t, d], i) => (
            <div className="panel sp" key={t}><span className="disp n">{i + 1}</span><div><h3>{t}</h3><p>{d}</p></div></div>
          ))}
        </div>
      </section>
      <section className="foot">
        <h2>VERITAS highlights information. It never decides who is truthful.</h2>
        <Mag className="btn" onClick={onEnter}>Open the workspace</Mag>
      </section>
    </div>
  );
}

function Auth({ onAuth, onBack }) {
  const root = useRef();
  const [mode, setMode] = useState('login');
  const [f, setF] = useState({ name: '', email: '', badgeId: '', password: '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  useGSAP(() => {
    gsap.from('.au-box', { y: 50, opacity: 0, duration: 1, ease: 'expo.out' });
    gsap.from('.au-box > *', { y: 16, opacity: 0, stagger: 0.06, delay: 0.25, duration: 0.6, ease: 'power3.out' });
  }, { scope: root });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setErr('');
    try { const d = await api('/auth/' + mode, { method: 'POST', body: f }); localStorage.setItem('vt', d.token); gsap.to('.au-box', { y: -30, opacity: 0, scale: 0.97, duration: 0.45, ease: 'power3.in', onComplete: () => onAuth(d.user) }); }
    catch (x) { setErr(x.message); gsap.fromTo('.au-box', { x: -10 }, { x: 0, duration: 0.6, ease: 'elastic.out(1,0.3)' }); }
    setBusy(false);
  };
  return (
    <div className="au" ref={root}>
      <form className="box au-box" onSubmit={submit}>
        <h2>{mode === 'login' ? 'Sign in' : 'Create officer account'}</h2>
        {mode === 'register' && <><input placeholder="Full name" value={f.name} onChange={set('name')} required /><input placeholder="Badge ID" value={f.badgeId} onChange={set('badgeId')} /></>}
        <input type="email" placeholder="Email" value={f.email} onChange={set('email')} required />
        <input type="password" placeholder="Password (6+ characters)" value={f.password} onChange={set('password')} required />
        {err && <p className="err">{err}</p>}
        <button className="btn" disabled={busy}>{busy ? 'Please wait' : mode === 'login' ? 'Sign in' : 'Create account'}</button>
        <button type="button" className="link" onClick={() => setMode(mode === 'login' ? 'register' : 'login')}>{mode === 'login' ? 'Need an account? Register' : 'Have an account? Sign in'}</button>
        <button type="button" className="link" onClick={onBack}>Back to home</button>
      </form>
    </div>
  );
}

function Dashboard({ user, onLogout, onOpen }) {
  const root = useRef();
  const [cases, setCases] = useState(null);
  const [t, setT] = useState('');
  const [d, setD] = useState('');
  const [err, setErr] = useState('');
  useEffect(() => { api('/cases').then(setCases).catch((e) => (e.status === 401 ? onLogout() : setErr(e.message))); }, []);
  useGSAP(() => {
    if (!cases) return;
    gsap.from('.stats .box, .form, .case', { y: 30, opacity: 0, stagger: 0.07, duration: 0.8, ease: 'power3.out' });
    gsap.to('.tag', { duration: 1.2, stagger: 0.06, scrambleText: { text: '{original}', chars: '0123456789ABCDEF', speed: 0.5 } });
  }, { scope: root, dependencies: [cases === null] });
  const add = async (e) => {
    e.preventDefault();
    try { const c = await api('/cases', { method: 'POST', body: { title: t, description: d } }); setCases([c, ...cases]); setT(''); setD(''); }
    catch (x) { x.status === 401 ? onLogout() : setErr(x.message); }
  };
  const del = async (id) => {
    try { await api('/cases/' + id, { method: 'DELETE' }); setCases(cases.filter((c) => c._id !== id)); }
    catch (x) { x.status === 401 ? onLogout() : setErr(x.message); }
  };
  return (
    <div className="app" ref={root}>
      <div className="bar"><h2 className="disp">Hello, {user.name.split(' ')[0]}</h2><button className="btn alt" onClick={onLogout}>Sign out</button></div>
      {err && <p className="err">{err}</p>}
      {cases && (<>
        <div className="stats"><div className="box"><b>{cases.length}</b>Cases</div><div className="box"><b>{cases.filter((c) => c.status === 'open').length}</b>Open</div><div className="box"><b>0</b>Flags to review</div></div>
        <form className="box form" onSubmit={add}>
          <input placeholder="Case title" value={t} onChange={(e) => setT(e.target.value)} required />
          <textarea rows="2" placeholder="Short description" value={d} onChange={(e) => setD(e.target.value)} />
          <button className="btn" style={{ justifySelf: 'start' }}>Create case</button>
        </form>
        <div>
          {cases.length === 0 && <p>No cases yet. Create your first case above.</p>}
          {cases.map((c) => (
            <div className="box case sp" key={c._id}>
              <div><span className="tag">{c.caseNo}</span><h3 style={{ fontSize: '1.4rem', margin: '8px 0 4px' }}>{c.title}</h3><p>{c.description}</p></div>
              <div className="row"><button className="btn" onClick={() => onOpen(c._id)}>Open</button><button className="btn alt" onClick={() => del(c._id)}>Delete</button></div>
            </div>
          ))}
        </div>
      </>)}
    </div>
  );
}

export default function App() {
  const [loading, setLoading] = useState(true);
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState(null);
  const [view, setView] = useState('landing');
  const [caseId, setCaseId] = useState(null);

  const lenisRef = useRef();
  useEffect(() => {
    const lenis = (lenisRef.current = new Lenis());
    document.fonts?.ready.then(() => ScrollTrigger.refresh());
    lenis.on('scroll', ScrollTrigger.update);
    const tick = (t) => lenis.raf(t * 1000);
    gsap.ticker.add(tick); gsap.ticker.lagSmoothing(0);
    return () => { gsap.ticker.remove(tick); lenis.destroy(); };
  }, []);

  useEffect(() => {
    if (localStorage.getItem('vt')) api('/auth/me').then((d) => setUser(d.user)).catch((e) => { if (e.status === 401) localStorage.removeItem('vt'); });
  }, []);

  useEffect(() => {
    const mv = (e) => {
      const el = e.target.closest?.('.sp');
      if (!el) return;
      const r = el.getBoundingClientRect();
      el.style.setProperty('--x', e.clientX - r.left + 'px'); el.style.setProperty('--y', e.clientY - r.top + 'px');
    };
    addEventListener('mousemove', mv);
    return () => removeEventListener('mousemove', mv);
  }, []);

  useEffect(() => { lenisRef.current?.scrollTo(0, { immediate: true }); window.scrollTo(0, 0); ScrollTrigger.refresh(); }, [view]);

  const enter = () => setView(user ? 'app' : 'auth');
  const logout = () => { localStorage.removeItem('vt'); setUser(null); setView('landing'); };

  return (
    <>
      <Cursor />
      {loading && <Loader onReveal={() => setReady(true)} onDone={() => setLoading(false)} />}
      {view === 'landing' && <Landing ready={ready} onEnter={enter} user={user} />}
      {view === 'auth' && <Auth onBack={() => setView('landing')} onAuth={(u) => { setUser(u); setView('app'); }} />}
      {view === 'app' && user && <Dashboard user={user} onLogout={logout} onOpen={(id) => { setCaseId(id); setView('case'); }} />}
      {view === 'case' && user && <Workspace caseId={caseId} onBack={() => setView('app')} onLogout={logout} />}
    </>
  );
}
