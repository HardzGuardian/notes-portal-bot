const path = require('path');
const express = require('express');

const { initDb } = require('./database');
const { createBot } = require('./bot');
const { createAdminRouter } = require('./routes/admin');

async function main() {
  const app = express();
  const preferredPort = Number(process.env.PORT || 3000);

  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, 'views'));

  app.use(express.urlencoded({ extended: true }));
  app.use(express.json());
  app.use('/public', express.static(path.join(__dirname, 'public')));

  const db = await initDb();
  const pdfRoot = path.join(__dirname, 'pdf');

  const bot = createBot({ db, pdfRoot });
  await bot.start();

  app.get('/health', (req, res) => res.json({ ok: true }));
  app.use('/admin', createAdminRouter({ db, bot, pdfRoot }));

  app.use((err, req, res, next) => {
    // Centralized error handler for the admin panel
    console.error('Server error:', err);
    res.status(500).send('Server error.');
  });

  async function listenWithFallback(startPort, maxAttempts = 10) {
    let port = startPort;
    for (let i = 0; i < maxAttempts; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      const server = await new Promise((resolve, reject) => {
        const s = app.listen(port, () => resolve(s));
        s.on('error', reject);
      }).catch((err) => {
        if (err && err.code === 'EADDRINUSE') return null;
        throw err;
      });

      if (server) {
        console.log(`Admin panel running on port ${port}`);
        console.log('Open: /admin (Basic Auth required)');
        return;
      }
      port += 1;
    }
    throw new Error(`No free port found starting at ${startPort}`);
  }

  await listenWithFallback(preferredPort);
}

main().catch((e) => {
  console.error('Fatal startup error:', e);
  process.exit(1);
});

