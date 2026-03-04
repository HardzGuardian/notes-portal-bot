const path = require('path');
const fs = require('fs');
const express = require('express');
const multer = require('multer');

const { SUBJECTS, NOTE_TYPES } = require('../bot');
const { addNoteRecord, getDashboardStats } = require('../database');

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function requireAdminAuth() {
  // Basic auth is simple and Render-friendly. Set ADMIN_USER / ADMIN_PASS.
  const basicAuth = require('basic-auth');

  return (req, res, next) => {
    const credentials = basicAuth(req);
    const user = process.env.ADMIN_USER || 'admin';
    const pass = process.env.ADMIN_PASS || 'admin123';

    const ok = credentials && credentials.name === user && credentials.pass === pass;
    if (ok) return next();

    res.set('WWW-Authenticate', 'Basic realm="Notes Portal Admin"');
    return res.status(401).send('Authentication required.');
  };
}

function safeFileName(name) {
  return String(name || '').replace(/[^\w.\- ()\[\]]+/g, '_');
}

function createAdminRouter({ db, bot, pdfRoot }) {
  if (!db) throw new Error('createAdminRouter requires { db }');
  if (!bot) throw new Error('createAdminRouter requires { bot }');
  if (!pdfRoot) throw new Error('createAdminRouter requires { pdfRoot }');

  const router = express.Router();
  router.use(requireAdminAuth());

  const uploadStorage = multer.diskStorage({
    destination: (req, file, cb) => {
      const subject = String(req.body.subject || '').toUpperCase();
      const type = String(req.body.type || '').toUpperCase();
      const dest = path.join(pdfRoot, subject, type);
      ensureDir(dest);
      cb(null, dest);
    },
    filename: (req, file, cb) => {
      const ts = Date.now();
      const original = safeFileName(file.originalname);
      cb(null, `${ts}-${original}`);
    },
  });

  const uploadPdf = multer({
    storage: uploadStorage,
    fileFilter: (req, file, cb) => {
      if ((file.originalname || '').toLowerCase().endsWith('.pdf')) return cb(null, true);
      cb(new Error('Only PDF files are allowed.'));
    },
    limits: { fileSize: 25 * 1024 * 1024 },
  });

  const broadcastStorage = multer.diskStorage({
    destination: (req, file, cb) => {
      const dest = path.join(__dirname, '..', 'uploads');
      ensureDir(dest);
      cb(null, dest);
    },
    filename: (req, file, cb) => {
      const ts = Date.now();
      const original = safeFileName(file.originalname);
      cb(null, `${ts}-${original}`);
    },
  });

  const uploadBroadcast = multer({
    storage: broadcastStorage,
    fileFilter: (req, file, cb) => {
      if (!file) return cb(null, true);
      if ((file.originalname || '').toLowerCase().endsWith('.pdf')) return cb(null, true);
      cb(new Error('Only PDF files are allowed.'));
    },
    limits: { fileSize: 25 * 1024 * 1024 },
  });

  router.get('/', async (req, res, next) => {
    try {
      const stats = await getDashboardStats(db);
      res.render('dashboard', { stats });
    } catch (e) {
      next(e);
    }
  });

  router.get('/upload', (req, res) => {
    res.render('upload', { subjects: SUBJECTS, types: NOTE_TYPES, message: null, error: null });
  });

  router.post('/upload', uploadPdf.single('pdf'), async (req, res) => {
    try {
      const subject = String(req.body.subject || '').toUpperCase();
      const type = String(req.body.type || '').toUpperCase();
      const file = req.file;

      const subjectOk = SUBJECTS.some((s) => s.key === subject);
      const typeOk = NOTE_TYPES.some((t) => t.key === type);
      if (!subjectOk || !typeOk) throw new Error('Invalid subject or type.');
      if (!file) throw new Error('No file uploaded.');

      const relativePath = path.relative(path.join(__dirname, '..'), file.path).replace(/\\/g, '/');
      await addNoteRecord(db, {
        subject,
        type,
        originalName: file.originalname,
        storedName: path.basename(file.path),
        relativePath,
      });

      res.render('upload', {
        subjects: SUBJECTS,
        types: NOTE_TYPES,
        message: `Uploaded to ${subject}/${type}: ${file.originalname}`,
        error: null,
      });
    } catch (err) {
      res.status(400).render('upload', {
        subjects: SUBJECTS,
        types: NOTE_TYPES,
        message: null,
        error: err?.message || 'Upload failed.',
      });
    }
  });

  router.get('/broadcast', (req, res) => {
    res.render('broadcast', { message: null, error: null });
  });

  router.post('/broadcast', uploadBroadcast.single('pdf'), async (req, res) => {
    try {
      const text = String(req.body.message || '').trim();
      const pdfPath = req.file ? req.file.path : null;

      if (!text && !pdfPath) throw new Error('Please enter a message or attach a PDF.');

      await bot.broadcast({ text, pdfAbsolutePath: pdfPath });
      res.render('broadcast', { message: 'Broadcast started. Check server logs for progress.', error: null });
    } catch (err) {
      res.status(400).render('broadcast', { message: null, error: err?.message || 'Broadcast failed.' });
    }
  });

  return router;
}

module.exports = { createAdminRouter };

