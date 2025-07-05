import dotenv from 'dotenv';
dotenv.config();

import {
  makeWASocket,
  Browsers,
  fetchLatestBaileysVersion,
  DisconnectReason,
  useMultiFileAuthState,
} from '@whiskeysockets/baileys';

import { Handler, Callupdate, GroupUpdate } from './data/index.js';
import express from 'express';
import pino from 'pino';
import fs from 'fs';
import { File } from 'megajs';
import NodeCache from 'node-cache';
import path from 'path';
import chalk from 'chalk';
import config from './config.cjs';
import pkg from './lib/autoreact.cjs';

const { emojis: autoReactEmojis, doReact } = pkg;

const prefix = process.env.PREFIX || config.PREFIX;
const sessionName = "session";
const app = express();
const orange = chalk.bold.hex("#FFA500");
const lime = chalk.bold.hex("#32CD32");
let useQR = false;
let initialConnection = true;
const PORT = process.env.PORT || 3000;

const MAIN_LOGGER = pino({
  timestamp: () => `,"time":"${new Date().toJSON()}"`
});
const logger = MAIN_LOGGER.child({});
logger.level = "trace";

const msgRetryCounterCache = new NodeCache();

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);

const sessionDir = path.join(__dirname, 'session');
const credsPath = path.join(sessionDir, 'creds.json');

if (!fs.existsSync(sessionDir)) {
  fs.mkdirSync(sessionDir, { recursive: true });
}

async function downloadSessionData() {
  if (!config.SESSION_ID) {
    console.error('❌ Please add your session to SESSION_ID env !!');
    return false;
  }

  const sessdata = config.SESSION_ID.split("cosmic~")[1];
  if (!sessdata || !sessdata.includes("*")) {
    console.error('❌ Invalid SESSION_ID format!');
    return false;
  }

  const [fileID, decryptKey] = sessdata.split("*");

  try {
    console.log("🔄 Downloading Session...");
    const file = File.fromURL(`https://mega.nz/file/${fileID}#${decryptKey}`);
    const data = await new Promise((resolve, reject) => {
      file.download((err, data) => {
        if (err) reject(err);
        else resolve(data);
      });
    });
    await fs.promises.writeFile(credsPath, data);
    console.log("🔒 Session Successfully Loaded!");
    return true;
  } catch (err) {
    console.error('❌ Failed to download session:', err);
    return false;
  }
}

async function start() {
  try {
    const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
    const { version, isLatest } = await fetchLatestBaileysVersion();
    console.log(`🤖 Using WA v${version.join('.')}, latest: ${isLatest}`);

    const Matrix = makeWASocket({
      version,
      logger: pino({ level: 'silent' }),
      printQRInTerminal: useQR,
      browser: ["COSMIC-WARRIOR", "safari", "3.3"],
      auth: state,
    });

    Matrix.ev.on('connection.update', ({ connection, lastDisconnect }) => {
      if (connection === 'close') {
        if (lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut) {
          start();
        }
      } else if (connection === 'open') {
        if (initialConnection) {
          console.log(chalk.green("✅ Connected: COSMIC 🪖 WARRIOR"));
          Matrix.sendMessage(Matrix.user.id, { text: "✅ Bot connected successfully!" });
          initialConnection = false;
        } else {
          console.log("♻️ Reconnected.");
        }
      }
    });

    Matrix.ev.on('creds.update', saveCreds);

    // Core handlers
    Matrix.ev.on('messages.upsert', async (chatUpdate) => {
      try {
        const mek = chatUpdate.messages[0];
        if (!mek || !mek.message) return;

        // General handler
        await Handler(chatUpdate, Matrix, logger);

        // Auto react
        if (config.AUTO_REACT && !mek.key.fromMe) {
          const emoji = autoReactEmojis[Math.floor(Math.random() * autoReactEmojis.length)];
          await doReact(emoji, mek, Matrix);
        }

        // Auto status seen/react/reply
        if (mek.key.remoteJid === 'status@broadcast') {
          if (config.AUTO_STATUS_SEEN) {
            await Matrix.readMessages([mek.key]);
            console.log(`✅ Status seen for ${mek.key.participant}`);
          }

          if (config.READ_MESSAGE === 'true') {
            await Matrix.readMessages([mek.key]);
          }

          if (config.AUTO_STATUS_REACT === "true") {
            const emojis = ['❤️', '🔥', '💯', '😍', '✅', '💎'];
            const emoji = emojis[Math.floor(Math.random() * emojis.length)];
            await Matrix.sendMessage(mek.key.remoteJid, {
              react: { text: emoji, key: mek.key }
            });
            console.log(`✅ Reacted to status with ${emoji}`);
          }

          if (config.AUTO_STATUS_REPLY) {
            const msg = config.STATUS_READ_MSG || '✅ Status Seen by COSMIC 🪖 WARRIOR';
            await Matrix.sendMessage(mek.key.participant, { text: msg });
          }
        }
      } catch (err) {
        console.error('Error handling messages.upsert:', err);
      }
    });

    Matrix.ev.on('call', json => Callupdate(json, Matrix));
    Matrix.ev.on('group-participants.update', messag => GroupUpdate(Matrix, messag));

    Matrix.public = config.MODE === "public";

  } catch (err) {
    console.error('Critical Error:', err);
    process.exit(1);
  }
}

async function init() {
  if (fs.existsSync(credsPath)) {
    console.log("🔒 Session found, no QR needed.");
    await start();
  } else {
    const ok = await downloadSessionData();
    if (ok) {
      console.log("🔒 Session downloaded, starting bot.");
      await start();
    } else {
      console.log("⚠️ No session, showing QR for auth.");
      useQR = true;
      await start();
    }
  }
}

init();

app.get('/', (_, res) => res.send('Hello Cosmic World!'));
app.listen(PORT, () => console.log(`🌐 Server on port ${PORT}`));
