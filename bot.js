const path = require('path');
const fs = require('fs');
const qrcode = require('qrcode-terminal');
const { Client, LocalAuth, List, MessageMedia } = require('whatsapp-web.js');

const SUBJECTS = [
  { key: 'SE', label: 'SE' },
  { key: 'CC', label: 'CC' },
  { key: 'CN', label: 'CN' },
  { key: 'EMSD', label: 'EMSD' },
  { key: 'IOT', label: 'IOT' },
  { key: 'AEC', label: 'AEC' },
];

const NOTE_TYPES = [
  { key: 'IMP', label: 'Important Questions' },
  { key: 'BOOK', label: 'Full Book' },
  { key: 'ASSIGNMENT', label: 'Assignment' },
  { key: 'WRITEUP', label: 'Write-up' },
];

function normalizePhone(from) {
  // whatsapp-web.js uses "12345@c.us" for normal chats
  return String(from || '').replace(/@c\.us$/i, '');
}

function safeBasename(fileName) {
  return path.basename(fileName).replace(/[^\w.\- ()\[\]]+/g, '_');
}

function getChoiceId(message) {
  // Depending on the interactive type, whatsapp-web.js exposes different fields.
  return (
    message?.selectedButtonId ||
    message?.selectedRowId ||
    message?.body ||
    ''
  ).trim();
}

function makeMainMenuList() {
  const rows = SUBJECTS.map((s, idx) => ({
    id: `SUBJECT:${s.key}`,
    title: `${idx + 1} ${s.label}`,
    description: `Open ${s.label} notes`,
  }));

  return new List(
    [
      '📚 SEM 4 NOTES PORTAL',
      '',
      '1️⃣ SE',
      '2️⃣ CC',
      '3️⃣ CN',
      '4️⃣ EMSD',
      '5️⃣ IOT',
      '6️⃣ AEC',
      '',
      'Select a subject from the list:',
    ].join('\n'),
    'Choose',
    [
      {
        title: 'Subjects',
        rows,
      },
    ],
    'SEM 4 Notes',
    'Pick your subject'
  );
}

function makeTypeMenuList(subjectKey) {
  const rows = NOTE_TYPES.map((t, idx) => ({
    id: `TYPE:${subjectKey}:${t.key}`,
    title: `${idx + 1} ${t.label}`,
    description: `Browse ${t.label} PDFs`,
  }));

  return new List(
    [
      `📚 ${subjectKey} NOTES`,
      '',
      '1️⃣ Important Questions',
      '2️⃣ Full Book',
      '3️⃣ Assignment',
      '4️⃣ Write-up',
      '',
      'Select a category from the list:',
    ].join('\n'),
    'Choose',
    [
      {
        title: `${subjectKey} Categories`,
        rows,
      },
    ],
    `${subjectKey} Notes`,
    'Pick category'
  );
}

function listPdfFiles(pdfRoot, subjectKey, typeKey) {
  const dir = path.join(pdfRoot, subjectKey, typeKey);
  if (!fs.existsSync(dir)) return { dir, files: [] };
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith('.pdf'))
    .sort((a, b) => a.localeCompare(b));
  return { dir, files };
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function makePdfPickLists(subjectKey, typeKey, files) {
  // WhatsApp List messages can be picky about row limits; chunk to keep safe.
  const groups = chunk(files, 10);
  return groups.map((groupFiles, groupIdx) => {
    const rows = groupFiles.map((file) => ({
      id: `PDF:${subjectKey}:${typeKey}:${encodeURIComponent(file)}`,
      title: safeBasename(file).slice(0, 24),
      description: safeBasename(file).slice(0, 70),
    }));

    const header =
      groups.length > 1
        ? `📄 Choose a PDF (${groupIdx + 1}/${groups.length})`
        : '📄 Choose a PDF';

    return new List(
      header,
      'Open list',
      [
        {
          title: `${subjectKey} • ${typeKey}`,
          rows,
        },
      ],
      'PDF Picker',
      'Tap to select'
    );
  });
}

async function sendWelcome(message, dbApi) {
  const phone = normalizePhone(message.from);
  await dbApi.upsertStudent(phone);
  await dbApi.logUsage({ phone, action: 'welcome' });

  try {
    await message.reply(makeMainMenuList());
  } catch {
    // Fallback for clients that don't support interactive lists.
    await message.reply(
      [
        '📚 SEM 4 NOTES PORTAL',
        '',
        '1️⃣ SE',
        '2️⃣ CC',
        '3️⃣ CN',
        '4️⃣ EMSD',
        '5️⃣ IOT',
        '6️⃣ AEC',
        '',
        'Reply with: SE / CC / CN / EMSD / IOT / AEC',
      ].join('\n')
    );
  }
}

function createBot({ db, pdfRoot = path.join(__dirname, 'pdf') } = {}) {
  if (!db) throw new Error('createBot requires { db }');

  const dbApi = {
    upsertStudent: (phone, opts) => require('./database').upsertStudent(db, phone, opts),
    logUsage: (payload) => require('./database').logUsage(db, payload),
    incrementSubjectStat: (subject) => require('./database').incrementSubjectStat(db, subject),
  };

  const baseAuthDataPath = process.env.WWEBJS_AUTH_DIR
    ? path.resolve(process.env.WWEBJS_AUTH_DIR)
    : path.join(__dirname, '.wwebjs_auth');

  function pickAuthDataPath(basePath) {
    // On Windows, Chromium can keep the profile "lockfile" open even after crashes.
    // If we can't remove it, fall back to an alternate auth directory so the bot can start.
    const candidates = [`${basePath}-alt`, basePath, `${basePath}-run-${Date.now()}`];
    for (const candidate of candidates) {
      try {
        const sessionDir = path.join(candidate, 'session');
        fs.mkdirSync(sessionDir, { recursive: true });

        const lock = path.join(sessionDir, 'lockfile');
        if (fs.existsSync(lock)) {
          try {
            fs.unlinkSync(lock);
          } catch {
            // Can't remove lock in this directory, try next candidate.
            continue;
          }
        }
        return candidate;
      } catch {
        // Try next candidate
      }
    }
    return basePath;
  }

  const authDataPath = pickAuthDataPath(baseAuthDataPath);
  const authStrategy = new LocalAuth({ dataPath: authDataPath });

  function cleanupChromiumSingletonLocks() {
    // If the process is killed unexpectedly, Chromium may leave singleton lock files behind,
    // causing "The browser is already running" on next boot.
    const sessionDir = path.join(authDataPath, 'session');
    const lockFiles = [
      'SingletonLock',
      'SingletonCookie',
      'SingletonSocket',
      'DevToolsActivePort',
      'lockfile',
    ];

    const candidateDirs = [sessionDir, path.join(sessionDir, 'Default')];
    for (const dir of candidateDirs) {
      for (const f of lockFiles) {
        const p = path.join(dir, f);
        try {
          if (fs.existsSync(p)) fs.unlinkSync(p);
        } catch {
          // ignore (best-effort)
        }
      }
    }
  }

  const client = new Client({
    authStrategy,
    puppeteer: {
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    },
  });

  client.on('qr', (qr) => {
    // Log a direct QR image URL instead of an ASCII QR.
    const encoded = encodeURIComponent(qr);
    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encoded}`;
    console.log('QR LOGIN URL (open in browser to scan):', qrUrl);
    // Still log the raw string once for debugging if needed.
    console.log('QR RAW STRING:', qr);
  });

  client.on('authenticated', () => console.log('WhatsApp authenticated.'));
  client.on('auth_failure', (msg) => console.error('Auth failure:', msg));
  client.on('ready', () => console.log('WhatsApp client is ready.'));

  client.on('message', async (message) => {
    try {
      const body = (message.body || '').trim().toLowerCase();
      const choice = getChoiceId(message);
      const phone = normalizePhone(message.from);

      // Main triggers
      if (['hi', 'hello', 'menu', 'notes'].includes(body)) {
        await sendWelcome(message, dbApi);
        return;
      }

      // Interactive choices
      if (choice.startsWith('SUBJECT:')) {
        const subjectKey = choice.split(':')[1];
        await dbApi.upsertStudent(phone, { lastSubject: subjectKey });
        await dbApi.incrementSubjectStat(subjectKey);
        await dbApi.logUsage({ phone, subject: subjectKey, action: 'subject_selected' });

        try {
          await message.reply(makeTypeMenuList(subjectKey));
        } catch {
          await message.reply(
            [
              `📚 ${subjectKey} NOTES`,
              '',
              'Reply with:',
              'IMP (Important Questions)',
              'BOOK (Full Book)',
              'ASSIGNMENT (Assignment)',
              'WRITEUP (Write-up)',
            ].join('\n')
          );
        }
        return;
      }

      if (choice.startsWith('TYPE:')) {
        const [, subjectKey, typeKey] = choice.split(':');
        await dbApi.upsertStudent(phone, { lastSubject: subjectKey });
        await dbApi.logUsage({ phone, subject: subjectKey, action: `type_selected:${typeKey}` });

        const { files } = listPdfFiles(pdfRoot, subjectKey, typeKey);
        if (files.length === 0) {
          await message.reply(`No PDFs found for ${subjectKey} → ${typeKey}.`);
          return;
        }

        const lists = makePdfPickLists(subjectKey, typeKey, files);
        for (const list of lists) {
          try {
            // eslint-disable-next-line no-await-in-loop
            await message.reply(list);
          } catch {
            // eslint-disable-next-line no-await-in-loop
            await message.reply(
              `Found ${files.length} PDFs. Reply with the exact PDF name you want.`
            );
            break;
          }
        }
        return;
      }

      if (choice.startsWith('PDF:')) {
        const [, subjectKey, typeKey, fileEnc] = choice.split(':');
        const file = decodeURIComponent(fileEnc || '');
        const filePath = path.join(pdfRoot, subjectKey, typeKey, file);

        if (!fs.existsSync(filePath)) {
          await message.reply('Sorry, that file is missing on the server.');
          return;
        }

        await dbApi.upsertStudent(phone, { lastSubject: subjectKey });
        await dbApi.logUsage({ phone, subject: subjectKey, action: `send_pdf:${typeKey}` });

        const media = MessageMedia.fromFilePath(filePath);
        await message.reply(media, undefined, {
          caption: `📄 ${subjectKey} • ${typeKey}\n${safeBasename(file)}`,
        });
        return;
      }

      // Text fallbacks (quick parsing)
      const upper = (message.body || '').trim().toUpperCase();
      const subjectHit = SUBJECTS.find((s) => s.key === upper);
      if (subjectHit) {
        await message.reply(makeTypeMenuList(subjectHit.key));
        return;
      }
    } catch (err) {
      console.error('Bot message handler error:', err);
      try {
        await message.reply('Something went wrong. Please type "menu" and try again.');
      } catch {
        // ignore
      }
    }
  });

  async function broadcast({ text, pdfAbsolutePath } = {}) {
    const { getAllStudents, logUsage } = require('./database');
    const students = await getAllStudents(db);

    let media = null;
    if (pdfAbsolutePath) {
      media = MessageMedia.fromFilePath(pdfAbsolutePath);
    }

    for (const s of students) {
      const chatId = `${s.phone}@c.us`;
      try {
        if (media) {
          // eslint-disable-next-line no-await-in-loop
          await client.sendMessage(chatId, media, { caption: text || '' });
        } else if (text) {
          // eslint-disable-next-line no-await-in-loop
          await client.sendMessage(chatId, text);
        }

        // eslint-disable-next-line no-await-in-loop
        await logUsage(db, { phone: s.phone, action: 'broadcast_sent' });
      } catch (err) {
        console.error('Broadcast failed for', chatId, err?.message || err);
      }
    }
  }

  async function start() {
    cleanupChromiumSingletonLocks();
    try {
      await client.initialize();
    } catch (err) {
      const msg = String(err?.message || err || '');
      if (!msg.toLowerCase().includes('browser is already running')) throw err;

      // As a recovery strategy, rotate the session directory and force a clean QR login.
      const sessionDir = path.join(authDataPath, 'session');
      try {
        if (fs.existsSync(sessionDir)) {
          const rotated = path.join(authDataPath, `session-stale-${Date.now()}`);
          fs.renameSync(sessionDir, rotated);
        }
      } catch {
        // ignore (best-effort)
      }

      cleanupChromiumSingletonLocks();
      await client.initialize();
    }
  }

  return { client, start, broadcast, SUBJECTS, NOTE_TYPES, pdfRoot };
}

module.exports = { createBot, SUBJECTS, NOTE_TYPES };

