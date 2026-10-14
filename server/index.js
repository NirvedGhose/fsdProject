import 'dotenv/config';
import express from 'express';
import multer from 'multer';
import { PDFParse } from 'pdf-parse';
import mammoth from 'mammoth';
import path from 'path';
import fs from 'fs/promises';
import { extractClaims, describeImage } from './gemini.js';
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import 'express-async-errors';
const upload = multer({
  dest: path.join(__dirname, 'uploads'),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) =>
  allowed.includes(file.mimetype) ? cb(null, true) : cb(new Error('UNSUPPORTED_TYPE')),
});

import cors from 'cors';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

if (!process.env.JWT_SECRET || !process.env.MONGO_URI) {
  console.error('Missing JWT_SECRET or MONGO_URI. Copy .env.example to .env and fill it in.');
  process.exit(1);
}
const { Schema, model } = mongoose;
const str = (v) => (typeof v === 'string' ? v.trim() : '');

const allowed = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
  'image/jpeg',
  'image/png'
];

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
  owner: { type: Schema.Types.ObjectId, ref: 'User', index: true },
}, { timestamps: true }));

const Doc = model('Doc', new Schema({
  case: { type: Schema.Types.ObjectId, ref: 'Case', index: true },
  owner: { type: Schema.Types.ObjectId, ref: 'User' },
  name: { type: String, required: true },
  size: Number,
  type: String,
  path: { type: String },
  mimeType: { type: String },
  extractedText: { type: String },
  aiDescription: String,
  tags: [String],
  ocrText: String,
  officerTags: [String],
  status: { type: String, enum: ['uploaded', 'processing', 'analyzed', 'failed'], default: 'uploaded' },
}, { timestamps: true }));

const Flag = model('Flag', new Schema({
  case: { type: Schema.Types.ObjectId, ref: 'Case', index: true },
  owner: { type: Schema.Types.ObjectId, ref: 'User', index: true },
  type: String, severity: { type: String, enum: ['high', 'medium', 'low'], default: 'medium' },
  title: String, explanation: String,
  quoteA: String, sourceA: String, quoteB: String, sourceB: String,
  status: { type: String, enum: ['open', 'verified', 'dismissed'], default: 'open' },
  demo: { type: Boolean, default: false },
  auto: { type: Boolean, default: false },
  claimIds: [{ type: Schema.Types.ObjectId, ref: 'Claim' }],
}, { timestamps: true }));

const Claim = model('Claim', new Schema({
  case: { type: Schema.Types.ObjectId, ref: 'Case', index: true },
  doc: { type: Schema.Types.ObjectId, ref: 'Doc', index: true },
  owner: { type: Schema.Types.ObjectId, ref: 'User' },
  type: String, person: String, place: String, date: String,
  startTime: String, endTime: String, description: String, quote: String,
}, { timestamps: true }));

const SAMPLE = [
  { type: 'Timeline conflict', severity: 'high', title: 'Person X placed at two locations around 9 PM',
    quoteA: 'Person X was at Location A at 9 PM.', quoteB: 'Person X was at Location B at 9 PM.',
    explanation: 'The two statements place Person X at different locations at about the same time. This may need verification against other evidence.' },
  { type: 'Detail discrepancy', severity: 'medium', title: 'Vehicle colour described differently',
    quoteA: 'A red hatchback was parked outside.', quoteB: 'The car was dark blue and parked by the gate.',
    explanation: 'The statements describe the vehicle differently. They may refer to different vehicles, or one description may be mistaken.' },
  { type: 'Missing information', severity: 'low', title: 'No time given for the second visit',
    quoteA: 'He came back later that evening.', quoteB: 'No time or location is mentioned.',
    explanation: 'A visit is mentioned without a time, so it cannot be placed on the timeline yet.' },
];

const sign = (u) => jwt.sign({ id: u._id }, process.env.JWT_SECRET, { expiresIn: '7d' });
const pub = (u) => ({ id: u._id, name: u.name, email: u.email, badgeId: u.badgeId, role: u.role });

const auth = async (req, res, next) => {
  try {
    const t = (req.headers.authorization || '').replace('Bearer ', '') || req.query.token || '';
    req.user = await User.findById(jwt.verify(t, process.env.JWT_SECRET).id);
    if (!req.user) throw new Error();
    next();
  } catch { res.status(401).json({ error: 'Please sign in again.' }); }
};

const app = express();
app.use(cors(), express.json());

app.delete('/api/docs/:id', auth, async (req, res) => {
  const d = await Doc.findOne({ _id: req.params.id, owner: req.user._id });
  if (!d) return nf(res);
  const ids = (await Claim.find({ doc: d._id }).select('_id')).map((x) => x._id);
  await Flag.deleteMany({ claimIds: { $in: ids } });
  const old = (await Claim.find({ doc: d._id }).select('_id')).map((x) => x._id);
  await Flag.deleteMany({ claimIds: { $in: old } });
  await Claim.deleteMany({ doc: d._id });
  if (d.path) await fs.unlink(d.path).catch(() => {});
  await d.deleteOne();
  res.json({ ok: true });
});

app.post('/api/auth/register', async (req, res) => {
  const name = str(req.body.name), email = str(req.body.email), badgeId = str(req.body.badgeId);
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  if (!name || !/^\S+@\S+\.\S+$/.test(email) || password.length < 6)
    return res.status(400).json({ error: 'Enter your name, a valid email and a password of 6+ characters.' });
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

app.get('/api/cases', auth, async (req, res) =>
  res.json(await Case.find({ owner: req.user._id }).sort('-createdAt')));

app.get('/api/cases/:id/claims', auth, async (req, res) => {
  const c = await own(req);
  if (!c) return nf(res);
  res.json(await Claim.find({ case: c._id }).sort('createdAt'));
});

app.post('/api/cases', auth, async (req, res) => {
  const title = str(req.body.title);
  if (!title) return res.status(400).json({ error: 'A case title is required.' });
  const c = await Case.create({
    title, description: str(req.body.description), owner: req.user._id,
    caseNo: 'VR-' + Date.now().toString(36).toUpperCase(),
  });
  res.json(c);
});

const nf = (res) => res.status(404).json({ error: 'Not found.' });
const own = (req) => Case.findOne({ _id: req.params.id, owner: req.user._id });

app.get('/api/cases/:id', auth, async (req, res) => {
  const c = await own(req);
  if (!c) return nf(res);
  res.json({ case: c, docs: await Doc.find({ case: c._id }).sort('-createdAt'), flags: await Flag.find({ case: c._id }).sort('createdAt') });
});

app.get('/api/docs/:id', auth, async (req, res) => {
  const doc = await Doc.findOne({ _id: req.params.id, owner: req.user._id });;
  if (!doc) return res.status(404).json({ error: 'Document not found.' });
  res.json(doc);
});

app.get('/api/docs/:id/file', auth, async (req, res) => {
  const d = await Doc.findOne({ _id: req.params.id, owner: req.user._id });
  if (!d || !d.path) return nf(res);
  res.setHeader('Content-Type', d.mimeType || 'application/octet-stream');
  res.sendFile(path.resolve(d.path));
});

app.post('/api/cases/:id/documents', auth, upload.array('files'), async (req, res) => {
  const c = await own(req);
  if (!c) return nf(res);
  if (!req.files || !req.files.length) return res.status(400).json({ error: 'No files uploaded.' });
  const made = [];
  for (const f of req.files) {
    const docData = {
      case: c._id,
      owner: req.user._id,
      name: f.originalname,
      size: f.size,
      type: f.mimetype,
      path: f.path,
      mimeType: f.mimetype,
      status: 'uploaded',
    };
    let extracted = '';
    try {
      if (f.mimetype === 'application/pdf') {
      const data = await fs.readFile(f.path);
      const parser = new PDFParse({ data });
      const pdf = await parser.getText();
      extracted = pdf.text;
      await parser.destroy();
      } else if (f.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
        const result = await mammoth.extractRawText({ path: f.path });
        extracted = result.value;
      } else if (f.mimetype === 'text/plain') {
        extracted = await fs.readFile(f.path, 'utf8');
      } else {
        // images: no extraction
        extracted = '';
      }
      docData.extractedText = extracted;
      docData.status = 'uploaded';
    } catch (e) {
      console.error('Extraction error:', e);
      docData.extractedText = '';
      docData.status = 'failed';
    }
    const doc = await Doc.create(docData);
    made.push(doc);
  }
  res.json(made);
});

// The rule is: same person, different place, overlapping time, same or unknown date.
const toMin = (t) => { const m = /^(\d{1,2}):(\d{2})$/.exec(t || ''); return m ? +m[1] * 60 + +m[2] : null; };
const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const samePlace = (a, b) => a && b && (a === b || a.includes(b) || b.includes(a));
const sameDate = (a, b) => !a || !b || norm(a) === norm(b);

function findConflicts(claims) {
  const p = claims.filter((c) => c.type === 'presence' && c.person && c.place && toMin(c.startTime) !== null);
  const out = [];
  for (let i = 0; i < p.length; i++) for (let j = i + 1; j < p.length; j++) {
    const a = p[i], b = p[j];
    if (norm(a.person) !== norm(b.person) || !sameDate(a.date, b.date)) continue;
    if (samePlace(norm(a.place), norm(b.place))) continue;
    const a1 = toMin(a.startTime), a2 = toMin(a.endTime) ?? a1;
    const b1 = toMin(b.startTime), b2 = toMin(b.endTime) ?? b1;
    if (Math.max(a1, b1) <= Math.min(a2, b2)) out.push([a, b]);
  }
  return out;
}

// Demo analysis: seeds sample flags until the Python AI service is connected.
app.post('/api/cases/:id/analyze', auth, async (req, res) => {
  const c = await own(req);
  if (!c) return nf(res);
  const docs = await Doc.find({ case: c._id }).sort('createdAt');
  if (!docs.length) return res.status(400).json({ error: 'Upload at least one statement first.' });
  for (const d of docs) {
  if (d.mimeType?.startsWith('image/')) {
    if (d.status === 'analyzed') continue;
    try {
      d.status = 'processing';
      await d.save();
      const r = await describeImage(d.path, d.mimeType);
      d.aiDescription = r.description;
      d.tags = r.tags;
      d.ocrText = r.ocrText;
      d.status = 'analyzed';
    } catch (e) {
      console.error('Image analysis failed:', e.message);
      d.status = 'failed';
    }
    await d.save();
    continue;
  }
  if (!d.extractedText?.trim() || d.status === 'analyzed') continue;
  try {
    d.status = 'processing'; await d.save();
    const cl = await extractClaims(d.extractedText);
    await Claim.deleteMany({ doc: d._id });
    if (cl.length) await Claim.insertMany(cl.map((x) => ({
      case: c._id, doc: d._id, owner: req.user._id,
      type: x.type, person: x.person, place: x.place, date: x.date,
      startTime: x.startTime, endTime: x.endTime, description: x.description, quote: x.quote,
    })));
    d.status = 'analyzed';
  } catch (e) { console.error('Claim extraction failed:', e.message); d.status = 'failed'; }
  await d.save();
}
  await Flag.deleteMany({ case: c._id, demo: true });
const claims = await Claim.find({ case: c._id }).lean();
const nameOf = Object.fromEntries(docs.map((d) => [String(d._id), d.name]));
const span = (x) => x.startTime + (x.endTime ? '–' + x.endTime : '');
for (const [a, b] of findConflicts(claims)) {
  if (await Flag.exists({ case: c._id, claimIds: { $all: [a._id, b._id] } })) continue;
  await Flag.create({
    case: c._id, owner: req.user._id, auto: true,
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

app.delete('/api/cases/:id', auth, async (req, res) => {
  const r = await Case.deleteOne({ _id: req.params.id, owner: req.user._id });
  if (r?.deletedCount) {
    const docsToDelete = await Doc.find({ case: req.params.id });
    await Promise.all(docsToDelete.map(d => fs.unlink(d.path).catch(() => {})));
    await Doc.deleteMany({ case: req.params.id });
    await Flag.deleteMany({ case: req.params.id });
    await Claim.deleteMany({ case: req.params.id });
  }
  res.json({ ok: true });
});



app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed' || err.name === 'CastError' || err.name === 'ValidationError')
    return res.status(400).json({ error: 'Invalid request.' });
  if (err.code === 11000) return res.status(409).json({ error: 'An account with this email already exists.' });
  if (err.message === 'UNSUPPORTED_TYPE') return res.status(400).json({ error: 'Only PDF, DOCX, TXT, JPG or PNG files are allowed.' });
  if (err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: 'File is too large (max 10 MB).' });
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on the server.' });
});

try { await mongoose.connect(process.env.MONGO_URI); }
catch (e) { console.error('Could not connect to MongoDB:', e.message); process.exit(1); }
app.listen(process.env.PORT || 5000, () => console.log('VERITAS API ready'));
