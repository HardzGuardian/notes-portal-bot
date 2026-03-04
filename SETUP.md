# Setup + Hosting Guide (Render + WhatsApp)

This project runs:
- an **Express admin panel** (web service)
- a **WhatsApp bot** (`whatsapp-web.js`) that logs in using **WhatsApp Web QR**

> Important: WhatsApp may restrict automation. Use responsibly and at your own risk.

## 1) What you need

- A GitHub repo containing `notes-portal-bot/`
- A WhatsApp account on your phone (to scan QR)
- A Render account: [Render](https://render.com/)

## 2) Recommended Render architecture

Use **one Render Web Service** for both:
- Express admin panel
- WhatsApp bot process

Add a **Persistent Disk** so these survive restarts:
- SQLite database file
- WhatsApp session (`.wwebjs_auth`)

## 3) Prepare your repo

Make sure your `package.json` has:
- **Build**: `npm ci` (recommended on Render)
- **Start**: `npm start`

This project already uses:
- `npm start` → runs `node server.js`

Also ensure:
- **Do not commit** `node_modules/` to GitHub (use `.gitignore`)
- Node engine is set to an LTS version (this repo uses **Node 20.x**) to avoid native module issues with `sqlite3`

## 4) Create the Render Web Service

In Render:
- Click **New +** → **Web Service**
- Connect your Git repo
- **Root Directory**: `notes-portal-bot`
- **Runtime**: Node
- **Build Command**: `npm install`
- Recommended **Build Command**: `npm ci`
- **Start Command**: `npm start`

Render docs/landing: [Render](https://render.com/)

## 5) Add a Persistent Disk (strongly recommended)

In the Render service settings:
- Add **Persistent Disk**
- **Mount path** (example): `/var/data`

Then set these environment variables so data is stored on the disk:
- `SQLITE_PATH=/var/data/database.sqlite`
- `WWEBJS_AUTH_DIR=/var/data/.wwebjs_auth`

Without a disk, you will likely need to re-scan the QR after restarts/deploys.

## 6) Set environment variables (Render → Environment)

Required / recommended:
- `ADMIN_USER=admin`
- `ADMIN_PASS=your_strong_password`
- `SQLITE_PATH=/var/data/database.sqlite` (or `./data/database.sqlite` if no disk)
- `WWEBJS_AUTH_DIR=/var/data/.wwebjs_auth` (or `./.wwebjs_auth` if no disk)

Render sets `PORT` automatically.

Optional:
- `PUPPETEER_EXECUTABLE_PATH=...` (only if Chromium launch fails on your environment)

## 7) Deploy and connect WhatsApp (QR scan)

After deploying:
1. Open your Render service **Logs**
2. Find the printed **QR code** (ASCII QR)
3. On your phone: **WhatsApp → Linked devices → Link a device**
4. Scan the QR shown in Render logs

When successful, logs will show:
- `WhatsApp authenticated.`
- `WhatsApp client is ready.`

## Troubleshooting: `sqlite3` “invalid ELF header” on Render

This usually happens when a **Windows-built** `sqlite3` binary ends up in your deploy (for example, if `node_modules/` was committed).

Fix:
- Ensure `node_modules/` is **not** in your GitHub repo
- In Render, use build command **`npm ci`**
- In Render, click **Clear build cache & deploy** (so it reinstall dependencies for Linux)

### If the QR does not render correctly in Render logs

The logs also include a line like:
- `QR RECEIVED <very long string>`

If the ASCII QR is unreadable, copy that string and generate a QR locally
(for example, using a QR generator page or a small script), then scan it.

## 8) Access the admin panel

Your admin panel URL:
- `https://<your-render-service>.onrender.com/admin`

Login with:
- `ADMIN_USER`
- `ADMIN_PASS`

Admin pages:
- `/admin` dashboard
- `/admin/upload` upload PDFs
- `/admin/broadcast` broadcast message + optional PDF

## 9) Uploading PDFs on Render

By default, uploads go into the project `pdf/` folders.

If you want uploaded PDFs to persist across deploys, you should also store PDFs on the Persistent Disk.
Two common approaches:
- **Approach A (simple)**: keep PDFs in repo, redeploy to update
- **Approach B (recommended for uploads)**: change code to save PDFs under `/var/data/pdf/...`

If you want, I can update the code so `pdfRoot` points to `/var/data/pdf` automatically when a disk is present.

