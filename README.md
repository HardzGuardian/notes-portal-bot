# WhatsApp Notes Portal (Node.js)

A complete **SEM 4 Notes Portal** system:
- **WhatsApp Bot** (QR login) using `whatsapp-web.js`
- **Admin Panel** using `Express + EJS`
- **SQLite** database for students + notes + usage stats
- Local PDF storage under `pdf/<SUBJECT>/<TYPE>/`

## Project structure

```
notes-portal-bot/
 ├── bot.js
 ├── server.js
 ├── database.js
 ├── routes/
 ├── pdf/
 ├── public/
 ├── views/
 └── package.json
```

## Setup (Local)

```bash
cd notes-portal-bot
npm install
npm start
```

On first run, the terminal prints a **QR code**. Scan it using:
**WhatsApp → Linked devices → Link a device**.

## Bot usage

Send: **hi** / **menu** / **notes**

Then pick:
- Subject: `SE | CC | CN | EMSD | IOT | AEC`
- Type: `IMP | BOOK | ASSIGNMENT | WRITEUP`
- PDF: pick from the interactive list (sent from local `pdf/` folders)

## PDF folders

Put PDFs in:

```
pdf/
  SE/IMP/
  SE/BOOK/
  SE/ASSIGNMENT/
  SE/WRITEUP/
  ... (same for CC, CN, EMSD, IOT, AEC)
```

## Admin panel

Open:
- `http://localhost:3000/admin`

This uses **Basic Auth**:
- `ADMIN_USER` (default `admin`)
- `ADMIN_PASS` (default `admin123`)

Pages:
- **Dashboard**: total students, most requested subject
- **Upload**: upload a PDF to a subject + type folder (also recorded in SQLite)
- **Broadcast**: send a message + optional PDF to all students

## Environment variables

Copy `.env.example` values into your host environment (Render) or set them in PowerShell before starting:

```powershell
$env:ADMIN_USER="admin"
$env:ADMIN_PASS="yourStrongPassword"
$env:PORT="3000"
```

Key vars:
- **PORT**: Render sets this automatically
- **ADMIN_USER / ADMIN_PASS**: admin panel access
- **SQLITE_PATH**: database file location
- **WWEBJS_AUTH_DIR**: WhatsApp session storage
- **PUPPETEER_EXECUTABLE_PATH**: optional override for Chromium/Chrome path

## Deployment (Render)

- **Build command**: `npm install`
- **Start command**: `npm start`
- Add env vars in Render Dashboard:
  - `ADMIN_USER`, `ADMIN_PASS`
  - `SQLITE_PATH` (example: `./data/database.sqlite`)
  - `WWEBJS_AUTH_DIR` (example: `./.wwebjs_auth`)

Notes:
- Render services are often ephemeral; if the instance restarts, you may need to **scan QR again**.
- For stable storage, attach a persistent disk and point `SQLITE_PATH` + `WWEBJS_AUTH_DIR` into that mount.

