import 'dotenv/config';
import 'express-async-errors';
import express from 'express';
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
  name: { type: String, required: true }, size: Number, type: String,
}, { timestamps: true }));

const Flag = model('Flag', new Schema({
  case: { type: Schema.Types.ObjectId, ref: 'Case', index: true },
  owner: { type: Schema.Types.ObjectId, ref: 'User', index: true },
  type: String, severity: { type: String, enum: ['high', 'medium', 'low'], default: 'medium' },
  title: String, explanation: String,
  quoteA: String, sourceA: String, quoteB: String, sourceB: String,
  status: { type: String, enum: ['open', 'verified', 'dismissed'], default: 'open' },
  demo: { type: Boolean, default: false },
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
    const t = (req.headers.authorization || '').replace('Bearer ', '');
    req.user = await User.findById(jwt.verify(t, process.env.JWT_SECRET).id);
    if (!req.user) throw new Error();
    next();
  } catch { res.status(401).json({ error: 'Please sign in again.' }); }
};

const app = express();
app.use(cors(), express.json());

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

app.post('/api/cases/:id/documents', auth, async (req, res) => {
  const c = await own(req);
  if (!c) return nf(res);
  const name = str(req.body.name);
  if (!name) return res.status(400).json({ error: 'A file name is required.' });
  res.json(await Doc.create({ case: c._id, owner: req.user._id, name, size: Number(req.body.size) || 0, type: str(req.body.type) }));
});

// Demo analysis: seeds sample flags until the Python AI service is connected.
app.post('/api/cases/:id/analyze', auth, async (req, res) => {
  const c = await own(req);
  if (!c) return nf(res);
  const docs = await Doc.find({ case: c._id }).sort('createdAt');
  if (!docs.length) return res.status(400).json({ error: 'Upload at least one statement first.' });
  await Flag.deleteMany({ case: c._id, demo: true });
  const a = docs[0].name, b = (docs[1] || docs[0]).name;
  res.json(await Promise.all(SAMPLE.map((t) => Flag.create({ ...t, case: c._id, owner: req.user._id, demo: true, sourceA: a, sourceB: b }))));
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
  if (r?.deletedCount) { await Doc.deleteMany({ case: req.params.id }); await Flag.deleteMany({ case: req.params.id }); }
  res.json({ ok: true });
});

app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed' || err.name === 'CastError' || err.name === 'ValidationError')
    return res.status(400).json({ error: 'Invalid request.' });
  if (err.code === 11000) return res.status(409).json({ error: 'An account with this email already exists.' });
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on the server.' });
});

try { await mongoose.connect(process.env.MONGO_URI); }
catch (e) { console.error('Could not connect to MongoDB:', e.message); process.exit(1); }
app.listen(process.env.PORT || 5000, () => console.log('VERITAS API ready'));
