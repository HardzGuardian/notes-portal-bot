const path = require('path');
const fs = require('fs');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');

const DB_PATH = process.env.SQLITE_PATH
  ? path.resolve(process.env.SQLITE_PATH)
  : path.join(__dirname, 'data', 'database.sqlite');

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

async function initDb() {
  ensureDir(path.dirname(DB_PATH));

  const db = await open({
    filename: DB_PATH,
    driver: sqlite3.Database,
  });

  await db.exec('PRAGMA journal_mode = WAL;');

  await db.exec(`
    CREATE TABLE IF NOT EXISTS students (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      phone TEXT UNIQUE NOT NULL,
      first_visit_at TEXT NOT NULL,
      last_request_at TEXT NOT NULL,
      last_subject TEXT
    );

    CREATE TABLE IF NOT EXISTS notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      subject TEXT NOT NULL,
      type TEXT NOT NULL,
      original_name TEXT NOT NULL,
      stored_name TEXT NOT NULL,
      relative_path TEXT NOT NULL,
      uploaded_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS usage_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      phone TEXT NOT NULL,
      subject TEXT,
      action TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS subject_stats (
      subject TEXT PRIMARY KEY,
      request_count INTEGER NOT NULL DEFAULT 0,
      last_requested_at TEXT
    );
  `);

  return db;
}

function nowIso() {
  return new Date().toISOString();
}

async function upsertStudent(db, phone, { lastSubject = null } = {}) {
  const ts = nowIso();
  const existing = await db.get('SELECT phone FROM students WHERE phone = ?', phone);
  const normalizedLastSubject = typeof lastSubject === 'string' && lastSubject.trim()
    ? lastSubject.trim()
    : null;

  if (!existing) {
    await db.run(
      `INSERT INTO students (phone, first_visit_at, last_request_at, last_subject)
       VALUES (?, ?, ?, ?)`,
      phone,
      ts,
      ts,
      normalizedLastSubject
    );
  } else {
    await db.run(
      `UPDATE students
       SET last_request_at = ?, last_subject = COALESCE(?, last_subject)
       WHERE phone = ?`,
      ts,
      normalizedLastSubject,
      phone
    );
  }
}

async function logUsage(db, { phone, subject = null, action }) {
  await db.run(
    `INSERT INTO usage_logs (phone, subject, action, created_at)
     VALUES (?, ?, ?, ?)`,
    phone,
    subject,
    action,
    nowIso()
  );
}

async function incrementSubjectStat(db, subject) {
  const ts = nowIso();
  await db.run(
    `INSERT INTO subject_stats (subject, request_count, last_requested_at)
     VALUES (?, 1, ?)
     ON CONFLICT(subject) DO UPDATE SET
       request_count = request_count + 1,
       last_requested_at = excluded.last_requested_at`,
    subject,
    ts
  );
}

async function addNoteRecord(db, { subject, type, originalName, storedName, relativePath }) {
  await db.run(
    `INSERT INTO notes (subject, type, original_name, stored_name, relative_path, uploaded_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    subject,
    type,
    originalName,
    storedName,
    relativePath,
    nowIso()
  );
}

async function getDashboardStats(db) {
  const totalStudentsRow = await db.get('SELECT COUNT(*) as total FROM students');
  const mostRequestedRow = await db.get(
    `SELECT subject, request_count
     FROM subject_stats
     ORDER BY request_count DESC
     LIMIT 1`
  );

  return {
    totalStudents: totalStudentsRow?.total ?? 0,
    mostRequested: mostRequestedRow || null,
  };
}

async function getAllStudents(db) {
  return db.all(
    `SELECT phone, first_visit_at, last_request_at, last_subject
     FROM students
     ORDER BY last_request_at DESC`
  );
}

module.exports = {
  DB_PATH,
  initDb,
  upsertStudent,
  logUsage,
  incrementSubjectStat,
  addNoteRecord,
  getDashboardStats,
  getAllStudents,
};

