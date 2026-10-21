import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import 'express-async-errors';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import mammoth from 'mammoth';
import { getDocumentProxy, extractText as pdfText } from 'unpdf';
import { extractClaims, describeImage } from './gemini.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROD = process.env.NODE_ENV === 'production';
// Vercel rejects request bodies over 4.5 MB, so set MAX_UPLOAD_MB=4 there
const MAX_MB = Number(process.env.MAX_UPLOAD_MB) || 10;

if (!process.env.JWT_SECRET || !process.env.MONGO_URI) {
  console.error('Missing JWT_SECRET or MONGO_URI. Copy .env.example to .env and fill it in.');
  process.exit(1);
}
if (PROD && process.env.JWT_SECRET.length < 24) {
  console.error('JWT_SECRET is too short. Use a random string of 24+ characters in production.');
  process.exit(1);
}

const { Schema, model } = mongoose;
const str = (v) => (typeof v === 'string' ? v.trim() : '');
const ref = (to) => ({ type: Schema.Types.ObjectId, ref: to });

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
// Allowed types, each with a check of the file's first bytes (the browser's mime type can be faked)
const MAGIC = {
  'application/pdf': (b) => b.subarray(0, 4).toString() === '%PDF',
  [DOCX]: (b) => b[0] === 0x50 && b[1] === 0x4b,
  'image/jpeg': (b) => b[0] === 0xff && b[1] === 0xd8,
  'image/png': (b) => b.subarray(1, 4).toString() === 'PNG',
  'text/plain': (b) => !b.subarray(0, 1024).includes(0),
};

const User = model('User', new Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  badgeId: String,
  password: { type: String, required: true },
  role: { type: String, enum: ['officer', 'admin'], default: 'officer' },
}, { timestamps: true }));

const Case = model('Case', new Schema({
  caseNo: String,
  title: { type: String, required: true },
  description: String,
  status: { type: String, enum: ['open', 'review', 'closed'], default: 'open' },
  owner: { ...ref('User'), index: true },
}, { timestamps: true }));

const Doc = model('Doc', new Schema({
  case: { ...ref('Case'), index: true },
  owner: ref('User'),
  name: { type: String, required: true },
  size: Number,
  type: String,
  mimeType: String,
  fileId: Schema.Types.ObjectId, // the file itself lives in MongoDB GridFS, so no server disk is needed
  extractedText: String,
  aiDescription: String,
  tags: [String],
  ocrText: String,
  officerTags: [String],
  error: String,
  status: { type: String, enum: ['uploaded', 'processing', 'analyzed', 'failed'], default: 'uploaded' },
}, { timestamps: true }));

const Claim = model('Claim', new Schema({
  case: { ...ref('Case'), index: true },
  doc: { ...ref('Doc'), index: true },
  owner: ref('User'),
  type: String, person: String, place: String, date: String,
  startTime: String, endTime: String, description: String, quote: String,
}, { timestamps: true }));

const Flag = model('Flag', new Schema({
  case: { ...ref('Case'), index: true },
  owner: { ...ref('User'), index: true },
  fp: String, // fingerprint, so re-running analysis keeps the officer's decisions
  type: String, severity: { type: String, enum: ['high', 'medium', 'low'], default: 'medium' },
  title: String, explanation: String,
  quoteA: String, sourceA: String, quoteB: String, sourceB: String,
  status: { type: String, enum: ['open', 'verified', 'dismissed'], default: 'open' },
  demo: { type: Boolean, default: false },
  auto: { type: Boolean, default: false },
  claimIds: [ref('Claim')],
}, { timestamps: true }));

// ---------- file storage (GridFS) ----------
const bucket = () => new mongoose.mongo.GridFSBucket(mongoose.connection.db, { bucketName: 'evidence' });
const putFile = (buf, name, type) => new Promise((ok, no) => {
  const s = bucket().openUploadStream(name, { contentType: type });
  s.once('error', no);
  s.once('finish', () => ok(s.id));
  s.end(buf);
});
const getFile = async (id) => {
  const parts = [];
  for await (const c of bucket().openDownloadStream(id)) parts.push(c);
  return Buffer.concat(parts);
};
const dropFile = (id) => (id ? bucket().delete(id).catch(() => {}) : Promise.resolve());

const extractText = async (f) => {
  if (f.mimetype === 'application/pdf') {
    const pdf = await getDocumentProxy(new Uint8Array(f.buffer)); // a copy: pdf.js may detach its input
    return (await pdfText(pdf, { mergePages: true })).text;
  }
  if (f.mimetype === DOCX) return (await mammoth.extractRawText({ buffer: f.buffer })).value;
  if (f.mimetype === 'text/plain') return f.buffer.toString('utf8');
  return '';
};

// ---------- conflict rules ----------
const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const STOP = new Set(['the', 'a', 'an', 'mr', 'mrs', 'ms', 'dr', 'shri', 'smt']);
const toks = (s) => (s || '').toLowerCase().replace(/[^a-z0-9 ]/g, '').split(/\s+/).filter((t) => t && !STOP.has(t));
// every token of a appears in b; a single letter matches an initial ("A." ~ "Anil")
const sub = (a, b) => a.every((x) => b.some((y) => x === y || (x.length === 1 && /[a-z]/.test(x) && y.startsWith(x))));
const same = (a, b) => { const ta = toks(a), tb = toks(b); return !!ta.length && !!tb.length && (sub(ta, tb) || sub(tb, ta)); };
const toMin = (t) => { const m = /^(\d{1,2}):(\d{2})$/.exec(t || ''); return m ? +m[1] * 60 + +m[2] : null; };
const sameDate = (a, b) => !a || !b || norm(a) === norm(b);
const window = (c) => {
  const s = toMin(c.startTime);
  let e = toMin(c.endTime) ?? s;
  if (e < s) e += 1440; // overnight
  return [s, e];
};

// Same person, different place, overlapping time, same or unknown date.
function findConflicts(claims) {
  const p = claims.filter((c) => c.type === 'presence' && c.person && c.place && toMin(c.startTime) !== null);
  const out = [];
  for (let i = 0; i < p.length; i++) for (let j = i + 1; j < p.length; j++) {
    const a = p[i], b = p[j];
    if (!same(a.person, b.person) || !sameDate(a.date, b.date) || same(a.place, b.place)) continue;
    const [a1, a2] = window(a), [b1, b2] = window(b);
    if (Math.max(a1, b1) <= Math.min(a2, b2)) out.push([a, b]);
  }
  return out;
}
const fingerprint = (a, b) => crypto.createHash('sha1')
  .update([a, b].map((k) => String(k.doc) + '|' + norm(k.quote)).sort().join('#')).digest('hex');

const pool = async (items, n, fn) => {
  const q = [...items];
  await Promise.all(Array.from({ length: Math.min(n, q.length) }, async () => { for (let x; (x = q.shift());) await fn(x); }));
};

// ---------- app ----------
const sign = (u) => jwt.sign({ id: u._id }, process.env.JWT_SECRET, { expiresIn: '7d' });
const pub = (u) => ({ id: u._id, name: u.name, email: u.email, badgeId: u.badgeId, role: u.role });
const nf = (res) => res.status(404).json({ error: 'Not found.' });
const own = (req) => Case.findOne({ _id: req.params.id, owner: req.user._id });

const auth = async (req, res, next) => {
  try {
    const t = (req.headers.authorization || '').replace('Bearer ', '');
    req.user = await User.findById(jwt.verify(t, process.env.JWT_SECRET).id);
    if (!req.user) throw new Error();
    next();
  } catch { res.status(401).json({ error: 'Please sign in again.' }); }
};

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_MB * 1024 * 1024, files: 10 },
  fileFilter: (req, f, cb) => (MAGIC[f.mimetype] ? cb(null, true) : cb(new Error('UNSUPPORTED_TYPE'))),
});

const limiter = (windowMs, limit) => rateLimit({ windowMs, limit, standardHeaders: true, legacyHeaders: false,
  handler: (req, res) => res.status(429).json({ error: 'Too many requests. Please wait a moment and try again.' }) });

const app = express();
if (PROD) app.set('trust proxy', 1); // behind the host's load balancer
app.use(helmet({ crossOriginResourcePolicy: { policy: process.env.CLIENT_ORIGIN ? 'cross-origin' : 'same-origin' }, contentSecurityPolicy: { directives: { ...helmet.contentSecurityPolicy.getDefaultDirectives(), 'upgrade-insecure-requests': null } } }));
app.use(cors({ origin: process.env.CLIENT_ORIGIN ? process.env.CLIENT_ORIGIN.split(',').map((s) => s.trim()) : false }));
app.use(express.json({ limit: '100kb' }));

app.get('/api/health', (req, res) => res.json({ ok: true, db: mongoose.connection.readyState === 1 }));

// ---------- auth ----------
app.use(['/api/auth/login', '/api/auth/register'], limiter(15 * 60 * 1000, 20));

app.post('/api/auth/register', async (req, res) => {
  const name = str(req.body.name), email = str(req.body.email), badgeId = str(req.body.badgeId);
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  if (!name || !/^\S+@\S+\.\S+$/.test(email) || password.length < 6 || password.length > 128)
    return res.status(400).json({ error: 'Enter your name, a valid email and a password of 6 to 128 characters.' });
  if (await User.findOne({ email: email.toLowerCase() }))
    return res.status(409).json({ error: 'An account with this email already exists.' });
  const u = await User.create({ name, email, badgeId, password: await bcrypt.hash(password, 10) });
  res.json({ token: sign(u), user: pub(u) });
});

app.post('/api/auth/login', async (req, res) => {
  const u = await User.findOne({ email: str(req.body.email).toLowerCase() });
  const pw = typeof req.body.password === 'string' ? req.body.password : '';
  if (!u || !(await bcrypt.compare(pw, u.password)))
    return res.status(401).json({ error: 'Email or password is incorrect.' });
  res.json({ token: sign(u), user: pub(u) });
});

app.get('/api/auth/me', auth, (req, res) => res.json({ user: pub(req.user) }));

// ---------- cases ----------
app.get('/api/cases', auth, async (req, res) =>
  res.json(await Case.find({ owner: req.user._id }).sort('-createdAt')));

app.post('/api/cases', auth, async (req, res) => {
  const title = str(req.body.title);
  if (!title) return res.status(400).json({ error: 'A case title is required.' });
  res.json(await Case.create({
    title, description: str(req.body.description), owner: req.user._id,
    caseNo: 'VR-' + Date.now().toString(36).toUpperCase(),
  }));
});

app.get('/api/cases/:id', auth, async (req, res) => {
  const c = await own(req);
  if (!c) return nf(res);
  res.json({
    case: c,
    docs: await Doc.find({ case: c._id }).select('-extractedText -fileId').sort('-createdAt'),
    flags: await Flag.find({ case: c._id }).sort('createdAt'),
  });
});

app.get('/api/cases/:id/claims', auth, async (req, res) => {
  const c = await own(req);
  if (!c) return nf(res);
  res.json(await Claim.find({ case: c._id }).sort('createdAt'));
});

app.get('/api/cases/:id/graph', auth, async (req, res) => {
  const c = await own(req);
  if (!c) return nf(res);
  const [claims, docs, flags] = await Promise.all([
    Claim.find({ case: c._id }).lean(), Doc.find({ case: c._id }).select('name mimeType').lean(), Flag.find({ case: c._id }).lean(),
  ]);
  const bad = new Set(flags.filter((f) => f.status !== 'dismissed').flatMap((f) => (f.claimIds || []).map(String)));
  const nodes = new Map(), edges = new Map();
  const node = (id, type, label) => { if (!nodes.has(id)) nodes.set(id, { id, type, label }); };
  const edge = (id, source, target, label, conflict = false) => { if (!edges.has(id)) edges.set(id, { id, source, target, label, conflict }); };
  docs.forEach((d) => node('d' + d._id, d.mimeType?.startsWith('image/') ? 'image' : 'doc', d.name));
  for (const k of claims) {
    const src = 'd' + k.doc;
    if (k.person) {
      const p = 'p:' + norm(k.person);
      node(p, 'person', k.person);
      edge('m' + src + p, src, p, 'mentions');
      if (k.place) {
        const l = 'l:' + norm(k.place);
        node(l, 'place', k.place);
        edge('w' + k._id, p, l, 'was_at ' + (k.startTime || ''), bad.has(String(k._id)));
      }
    } else if (k.type === 'object' && k.description) {
      const o = 'o:' + norm(k.description);
      node(o, 'object', k.description);
      edge('m' + src + o, src, o, 'mentions');
    }
  }
  res.json({ nodes: [...nodes.values()], edges: [...edges.values()] });
});

app.delete('/api/cases/:id', auth, async (req, res) => {
  const c = await own(req);
  if (c) {
    for (const d of await Doc.find({ case: c._id }).select('fileId')) await dropFile(d.fileId);
    await Promise.all([Doc, Flag, Claim].map((M) => M.deleteMany({ case: c._id })));
    await Case.deleteOne({ _id: c._id });
  }
  res.json({ ok: true });
});

// ---------- documents ----------
app.post('/api/cases/:id/documents', auth,
  async (req, res, next) => { req.c = await own(req); return req.c ? next() : nf(res); },
  upload.array('files', 10),
  async (req, res) => {
    if (!req.files?.length) return res.status(400).json({ error: 'No files uploaded.' });
    for (const f of req.files)
      if (!MAGIC[f.mimetype](f.buffer)) return res.status(400).json({ error: `${f.originalname}: the file content does not match its type.` });

    const made = [];
    for (const f of req.files) {
      const name = Buffer.from(f.originalname, 'latin1').toString('utf8');
      const d = { case: req.c._id, owner: req.user._id, name, size: f.size, type: f.mimetype, mimeType: f.mimetype, status: 'uploaded' };
      d.fileId = await putFile(f.buffer, name, f.mimetype);
      if (!f.mimetype.startsWith('image/')) {
        try {
          d.extractedText = await extractText(f);
          if (!d.extractedText.trim()) { d.status = 'failed'; d.error = 'No readable text found. Scanned documents need OCR.'; }
        } catch (e) {
          console.error('Extraction error:', e.message);
          d.status = 'failed'; d.error = 'Could not read text from this file.';
        }
      }
      const created = await Doc.create(d);
      const doc = created.toObject ? created.toObject() : { ...created };
      delete doc.extractedText; delete doc.fileId;
      made.push(doc);
    }
    res.json(made);
  });

app.get('/api/docs/:id', auth, async (req, res) => {
  const d = await Doc.findOne({ _id: req.params.id, owner: req.user._id }).select('-fileId');
  if (!d) return nf(res);
  res.json(d);
});

app.get('/api/docs/:id/file', auth, async (req, res) => {
  const d = await Doc.findOne({ _id: req.params.id, owner: req.user._id });
  if (!d || !d.fileId) return nf(res);
  res.setHeader('Content-Type', d.mimeType || 'application/octet-stream');
  res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(d.name)}`);
  bucket().openDownloadStream(d.fileId).on('error', () => res.destroy()).pipe(res);
});

app.delete('/api/docs/:id', auth, async (req, res) => {
  const d = await Doc.findOne({ _id: req.params.id, owner: req.user._id });
  if (!d) return nf(res);
  const ids = (await Claim.find({ doc: d._id }).select('_id')).map((x) => x._id);
  await Flag.deleteMany({ claimIds: { $in: ids } });
  await Claim.deleteMany({ doc: d._id });
  await dropFile(d.fileId);
  await Doc.deleteOne({ _id: d._id });
  res.json({ ok: true });
});

// ---------- analysis ----------
async function processDoc(d, c, userId, force) {
  if (!force && d.status === 'analyzed') return;
  await Doc.updateOne({ _id: d._id }, { status: 'processing', error: '' });
  try {
    if (d.mimeType?.startsWith('image/')) {
      const r = await describeImage(await getFile(d.fileId), d.mimeType);
      await Doc.updateOne({ _id: d._id }, { aiDescription: r.description, tags: r.tags, ocrText: r.ocrText, status: 'analyzed' });
      return;
    }
    if (!d.extractedText?.trim()) {
      await Doc.updateOne({ _id: d._id }, { status: 'failed', error: 'No readable text in this file.' });
      return;
    }
    const found = await extractClaims(d.extractedText);
    const text = norm(d.extractedText);
    // Keep a claim only if its quote really appears in the document
    const ok = found.filter((x) => x && typeof x.quote === 'string' && norm(x.quote) && text.includes(norm(x.quote)));
    const S = (v) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
    const T = (v) => (toMin(v) === null ? undefined : v);
    await Claim.deleteMany({ doc: d._id });
    if (ok.length) await Claim.insertMany(ok.map((x) => ({
      case: c._id, doc: d._id, owner: userId, type: S(x.type), person: S(x.person), place: S(x.place), date: S(x.date),
      startTime: T(x.startTime), endTime: T(x.endTime), description: S(x.description), quote: x.quote,
    })));
    const skipped = found.length - ok.length;
    await Doc.updateOne({ _id: d._id }, { status: 'analyzed', error: skipped ? `${skipped} extracted claim(s) were ignored because their quote was not found in the document.` : '' });
  } catch (e) {
    console.error('Analysis failed for', d.name, '-', e.message);
    await Doc.updateOne({ _id: d._id }, { status: 'failed', error: 'Analysis failed. Please try again.' });
  }
}

app.post('/api/cases/:id/analyze', auth, limiter(60 * 1000, 6), async (req, res) => {
  const c = await own(req);
  if (!c) return nf(res);
  const docs = await Doc.find({ case: c._id }).sort('createdAt');
  if (!docs.length) return res.status(400).json({ error: 'Upload at least one statement first.' });
  await pool(docs, 3, (d) => processDoc(d, c, req.user._id, req.query.force === '1'));

  await Flag.deleteMany({ case: c._id, demo: true });
  const claims = await Claim.find({ case: c._id }).lean();
  const nameOf = Object.fromEntries((await Doc.find({ case: c._id }).select('name')).map((d) => [String(d._id), d.name]));
  const span = (x) => x.startTime + (x.endTime ? '–' + x.endTime : '');
  const conflicts = findConflicts(claims).map(([a, b]) => ({ a, b, fp: fingerprint(a, b) }));

  // Drop stale open flags; keep ones the officer already reviewed
  await Flag.deleteMany({ case: c._id, auto: true, status: 'open', fp: { $nin: conflicts.map((x) => x.fp) } });
  const have = new Map((await Flag.find({ case: c._id, auto: true }).select('fp')).map((f) => [f.fp, f._id]));
  for (const { a, b, fp } of conflicts) {
    if (have.has(fp)) { await Flag.updateOne({ _id: have.get(fp) }, { claimIds: [a._id, b._id] }); continue; }
    await Flag.create({
      case: c._id, owner: req.user._id, auto: true, fp,
      type: 'Timeline conflict', severity: 'high',
      title: `${a.person} placed at two locations`,
      quoteA: a.quote, sourceA: nameOf[String(a.doc)],
      quoteB: b.quote, sourceB: nameOf[String(b.doc)],
      explanation: `${nameOf[String(a.doc)]} puts ${a.person} at ${a.place} (${span(a)}). ${nameOf[String(b.doc)]} puts them at ${b.place} (${span(b)}). The times overlap, so this may need verification.`,
      claimIds: [a._id, b._id],
    });
  }
  res.json(await Flag.find({ case: c._id }).sort('createdAt'));
});

app.patch('/api/flags/:id', auth, async (req, res) => {
  const status = str(req.body.status);
  if (!['open', 'verified', 'dismissed'].includes(status)) return res.status(400).json({ error: 'Invalid status.' });
  const f = await Flag.findOneAndUpdate({ _id: req.params.id, owner: req.user._id }, { status }, { new: true });
  if (!f) return nf(res);
  res.json(f);
});

app.use('/api', (req, res) => nf(res));

// ---------- serve the built client (production) ----------
const DIST = path.resolve(__dirname, '../client/dist');
if (fs.existsSync(DIST)) {
  app.use(express.static(DIST, {
    index: false,
    setHeaders: (res, p) => { if (p.includes(`${path.sep}assets${path.sep}`)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable'); },
  }));
  app.get('*', (req, res) => { res.setHeader('Cache-Control', 'no-cache'); res.sendFile(path.join(DIST, 'index.html')); });
}

app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed' || err.name === 'CastError' || err.name === 'ValidationError')
    return res.status(400).json({ error: 'Invalid request.' });
  if (err.code === 11000) return res.status(409).json({ error: 'An account with this email already exists.' });
  if (err.message === 'UNSUPPORTED_TYPE') return res.status(400).json({ error: 'Only PDF, DOCX, TXT, JPG or PNG files are allowed.' });
  if (err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: `File is too large (max ${MAX_MB} MB).` });
  if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') return res.status(400).json({ error: 'You can upload up to 10 files at a time.' });
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on the server.' });
});

try { await mongoose.connect(process.env.MONGO_URI); }
catch (e) { console.error('Could not connect to MongoDB:', e.message); process.exit(1); }
if (!process.env.VERCEL) app.listen(process.env.PORT || 5000, () => console.log('VERITAS API ready'));

export default app; // Vercel runs the exported app as a function
