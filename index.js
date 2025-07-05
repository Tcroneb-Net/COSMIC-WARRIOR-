import dotenv from 'dotenv';
dotenv.config();

import fs from 'fs';
import path from 'path';
import express from 'express';
import P from 'pino';
import { File } from 'megajs';

import {
  makeWASocket,
  Browsers,
  fetchLatestBaileysVersion,
  DisconnectReason,
  useMultiFileAuthState,
} from '@whiskeysockets/baileys';

import config from './config.cjs';

const __dirname = path.dirname(new URL(import.meta.url).pathname);

//===================SESSION-AUTH============================
const sessionDir = path.join(__dirname, '/sessions/');
const credsPath = path.join(sessionDir, 'creds.json');

if (!fs.existsSync(sessionDir)) {
  fs.mkdirSync(sessionDir, { recursive: true });
}

if (!fs.existsSync(credsPath)) {
  if (!config.SESSION_ID) {
    console.log('❌ Please add your session to SESSION_ID env !!');
    process.exit(1);
  }

  const sessdata = config.SESSION_ID.replace("cosmic~", '');
  const file = File.fromURL(`https://mega.nz/file/${sessdata}`);

  console.log("🔄 Downloading session from MEGA...");
  file.download((err, data) => {
    if (err) {
      console.error("❌ Error downloading session:", err);
      process.exit(1);
    }
    fs.writeFileSync(credsPath, data);
    console.log("✅ Session downloaded and saved!");
    // Important: you must exit so user restarts with creds now in place
    process.exit(0);
  });
}

//===========================================================

const app = express();
const PORT = process.env.PORT || 9090;

async function connectToWA() {
  console.log("Connecting to WhatsApp ⏳️...");
  const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
  const { version } = await fetchLatestBaileysVersion();

  const conn = makeWASocket({
    logger: P({ level: 'silent' }),
    printQRInTerminal: false,
    browser: Browsers.macOS("Firefox"),
    syncFullHistory: true,
    auth: state,
    version
  });

  conn.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect } = update;

    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      console.log("Connection closed, status:", statusCode);
      if (statusCode !== DisconnectReason.loggedOut) {
        connectToWA();
      } else {
        console.log("Logged out. Please delete creds.json to login again.");
      }
    } else if (connection === 'open') {
      console.log('🧬 Installing Plugins...');
      fs.readdirSync("./plugins/").forEach((plugin) => {
        if (path.extname(plugin).toLowerCase() === ".js") {
          require(`./plugins/${plugin}`);
        }
      });
      console.log('✅ Plugins installed');
      console.log('✅ Bot connected to WhatsApp');
    }
  });

  conn.ev.on('creds.update', saveCreds);
}

connectToWA();

app.get('/', (_, res) => res.send('Hello World! Bot is running.'));
app.listen(PORT, () => console.log(`🌐 Server running on port ${PORT}`));
