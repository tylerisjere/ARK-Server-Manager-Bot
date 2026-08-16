/**
 * ARK Nitrado Bot - index.js
 * Dependencies: npm i discord.js basic-ftp sqlite3 rcon-client dotenv
 *
 * Hinweis: Setze sensible Werte als Umgebungsvariablen (empfohlen) oder in config.json.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Client, GatewayIntentBits } = require('discord.js');
const ftp = require('basic-ftp');
const sqlite3 = require('sqlite3').verbose();
const { Rcon } = require('rcon-client');

const env = process.env;

// optionales config-Fallback
let config = {};
if (fs.existsSync('./config.json')) {
  try { config = JSON.parse(fs.readFileSync('./config.json','utf8')); } catch(e){ config = {}; }
}
const get = (key, fallback) => {
  if (env[key] !== undefined) return env[key];
  return (fallback !== undefined ? fallback : (config[key] || null));
};

const DISCORD_TOKEN = get('DISCORD_TOKEN', config.token);
const ALERT_CHANNEL_ID = get('ALERT_CHANNEL_ID', config.alertChannelId);
const MOD_ROLE_IDS = (get('MOD_ROLE_IDS', (config.moderatorRoleIds||[])) || '').toString().split(',').filter(Boolean);

const ftpCfg = {
  host: get('FTP_HOST', (config.ftp && config.ftp.host)),
  port: Number(get('FTP_PORT', (config.ftp && config.ftp.port) || 21)),
  user: get('FTP_USER', (config.ftp && config.ftp.user)),
  password: get('FTP_PASS', (config.ftp && config.ftp.password)),
  logsPath: get('FTP_LOGS_PATH', (config.ftp && config.ftp.logsPath) || 'ShooterGame/Saved/Logs'),
  secure: (get('FTP_SECURE', (config.ftp && config.ftp.secure)) === 'true' || config.ftp?.secure === true)
};

const rconCfg = {
  enabled: (get('RCON_ENABLED', (config.rcon && config.rcon.enabled)) === 'true' || config.rcon?.enabled === true),
  host: get('RCON_HOST', (config.rcon && config.rcon.host)),
  port: Number(get('RCON_PORT', (config.rcon && config.rcon.port) || 27020)),
  password: get('RCON_PASS', (config.rcon && config.rcon.password))
};

const POLL_MIN = Number(get('POLL_INTERVAL_MINUTES', config.pollIntervalMinutes || 3));

if (!DISCORD_TOKEN) {
  console.error('ERROR: DISCORD_TOKEN fehlt. Setze die Umgebungsvariable DISCORD_TOKEN.');
  process.exit(1);
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

const db = new sqlite3.Database('./data.sqlite');
fs.mkdirSync('./logs', { recursive: true });

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS processed_files(filename TEXT PRIMARY KEY, ts DATETIME DEFAULT CURRENT_TIMESTAMP)`);
  db.run(`CREATE TABLE IF NOT EXISTS cmdlogs(id INTEGER PRIMARY KEY, admin TEXT, command TEXT, ts DATETIME DEFAULT CURRENT_TIMESTAMP)`);
  db.run(`CREATE TABLE IF NOT EXISTS banlogs(id INTEGER PRIMARY KEY, player TEXT, reason TEXT, ts DATETIME DEFAULT CURRENT_TIMESTAMP)`);
  db.run(`CREATE TABLE IF NOT EXISTS watchbans(id INTEGER PRIMARY KEY AUTOINCREMENT, player TEXT)`);
});

client.once('ready', () => {
  console.log('Bot online als', client.user.tag);
  startPolling();
});

/* --- RCON helper --- */
async function rconSend(command) {
  if (!rconCfg.enabled) throw new Error('RCON nicht aktiviert.');
  if (!rconCfg.host || !rconCfg.password) throw new Error('RCON Konfiguration unvollständig.');
  const conn = await Rcon.connect({ host: rconCfg.host, port: rconCfg.port, password: rconCfg.password });
  try {
    const res = await conn.send(command);
    await conn.end();
    return res;
  } catch (err) {
    try { await conn.end(); } catch(e) {}
    throw err;
  }
}

/* --- FTP log polling --- */
async function pollLogsOnce() {
  const ftpClient = new ftp.Client(10000);
  try {
    await ftpClient.access({
      host: ftpCfg.host,
      port: ftpCfg.port,
      user: ftpCfg.user,
      password: ftpCfg.password,
      secure: ftpCfg.secure
    });
    await ftpClient.cd(ftpCfg.logsPath);
    const list = await ftpClient.list();
    for (const file of list) {
      if (!file.name) continue;
      const remoteName = file.name;
      if (!remoteName.match(/\.(log|txt)$/i)) continue;
      const already = await new Promise((res) =>
        db.get('SELECT filename FROM processed_files WHERE filename = ?', [remoteName], (err, row) => res(row ? true : false))
      );
      if (already) continue;
      const localPath = path.join(__dirname, 'logs', remoteName);
      await ftpClient.downloadTo(localPath, remoteName);
      console.log('Heruntergeladen:', remoteName);
      const data = fs.readFileSync(localPath, 'utf8');
      const suspects = analyzeLog(data);
      if (suspects.length && ALERT_CHANNEL_ID) {
        const channel = await client.channels.fetch(ALERT_CHANNEL_ID).catch(() => null);
        const msg = `Verdacht in Log ${remoteName}:\n` + suspects.map(s => `- ${s}`).join('\n');
        if (channel) channel.send({ content: msg });
      }
      db.run('INSERT INTO processed_files(filename) VALUES(?)', [remoteName]);
      extractAndStoreEvents(data);
    }
  } catch (err) {
    console.error('FTP Fehler:', err.message);
  } finally {
    ftpClient.close();
  }
}

function startPolling() {
  pollLogsOnce();
  setInterval(pollLogsOnce, POLL_MIN * 60 * 1000);
}

/* --- Analyse / DB Funktionen --- */
function analyzeLog(text) {
  const suspects = new Set();
  const ipRegex = /(\d{1,3}\.){3}\d{1,3}/g;
  const ips = text.match(ipRegex) || [];
  const ipCounts = {};
  ips.forEach(ip => ipCounts[ip] = (ipCounts[ip] || 0) + 1);
  for (const [ip, c] of Object.entries(ipCounts)) if (c > 4) suspects.add(`Wiederholte IP: ${ip} (${c} Einträge)`);

  const idRegex = /(XUID|XboxId|PlayerId|SteamID|PlayerID)[:=]?\s*([0-9A-Za-z\-_]+)/gi;
  let m;
  const ids = [];
  while ((m = idRegex.exec(text)) !== null) ids.push(m[2]);
  const idCounts = {};
  ids.forEach(id => idCounts[id] = (idCounts[id] || 0) + 1);
  for (const [id, c] of Object.entries(idCounts)) if (c > 3) suspects.add(`Wiederholte ID: ${id} (${c} Einträge)`);

  const cheatPatterns = [/GiveItemToPlayer/i, /SummonActor/i, /cheat\s+giveitem/i, /SetPlayerPos/i, /SpawnEgg/i];
  for (const p of cheatPatterns) if (p.test(text)) suspects.add(`Cheat-Muster gefunden: ${p}`);

  if (/duplicated|duplicate|Crafted|crafted item/i.test(text)) suspects.add('Hinweis auf Dupe/Crafting-Muster');

  return Array.from(suspects);
}

function extractAndStoreEvents(text) {
  const banRegex = /(banned|ban)\s+player[: ]\s*(.+)/i;
  const cmdRegex = /(admin|console)\s+command[: ]\s*(.+)/i;
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    let m;
    if ((m = banRegex.exec(line))) {
      const player = m[2].trim();
      db.run('INSERT INTO banlogs(player, reason) VALUES(?,?)', [player, line]);
      notifyWatch(player, `Neuer Ban gefunden: ${player}\nLog-Zeile: ${line}`);
    }
    if ((m = cmdRegex.exec(line))) {
      const command = m[2].trim();
      db.run('INSERT INTO cmdlogs(admin, command) VALUES(?,?)', ['log-extract', command]);
    }
  }
}

async function notifyWatch(player, text) {
  db.get('SELECT id FROM watchbans WHERE player = ?', [player], async (err, row) => {
    if (row && ALERT_CHANNEL_ID) {
      const channel = await client.channels.fetch(ALERT_CHANNEL_ID).catch(() => null);
      if (channel) channel.send({ content: `WATCHBAN: ${player} wurde in Logs gefunden.\n${text}` });
    }
  });
}

/* --- Discord Commands (inkl. RCON) --- */
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  if (!message.content) return;
  const prefix = get('PREFIX', config.prefix || '!');
  if (!message.content.startsWith(prefix)) return;
  const args = message.content.slice(prefix.length).trim().split(/\s+/);
  const cmd = args.shift().toLowerCase();

  if (cmd === 'serverstatus') {
    if (!rconCfg.enabled) return message.reply('RCON ist deaktiviert. Aktiviere RCON in der Konfiguration.');
    try {
      const res = await rconSend('ListPlayers');
      message.reply('RCON Antwort:\n' + (res || 'Keine Daten'));
    } catch (err) {
      message.reply('RCON Fehler: ' + err.message);
    }
  }

  else if (cmd === 'playerlist') {
    if (!rconCfg.enabled) return message.reply('RCON ist deaktiviert.');
    try {
      const res = await rconSend('ListPlayers');
      message.reply('Playerlist:\n' + (res || 'Keine Spieler gefunden'));
    } catch (err) {
      message.reply('RCON Fehler: ' + err.message);
    }
  }

  else if (cmd === 'rcon') {
    if (!isModerator(message.member)) return message.reply('Nur Moderatoren dürfen RCON-Befehle ausführen.');
    if (!rconCfg.enabled) return message.reply('RCON ist deaktiviert in der Konfiguration.');
    const command = args.join(' ');
    if (!command) return message.reply('Syntax: !rcon <befehl>');
    try {
      const res = await rconSend(command);
      if (res && res.length > 1900) {
        return message.reply({ files: [{ attachment: Buffer.from(res, 'utf8'), name: 'rcon-result.txt' }] });
      }
      return message.reply('RCON Ergebnis:\n' + (res || '(keine Antwort)'));
    } catch (err) {
      return message.reply('RCON Fehler: ' + err.message);
    }
  }

  else if (cmd === 'cmdlogs') {
    db.all('SELECT admin,command,ts FROM cmdlogs ORDER BY ts DESC LIMIT 30', (err, rows) => {
      if (err) return message.reply('Fehler beim Lesen der DB');
      if (!rows.length) return message.reply('Keine Admin-Logs vorhanden.');
      const out = rows.map(r => `${r.ts} — ${r.admin}: ${r.command}`).join('\n');
      if (out.length > 1900) return message.reply({ files: [{ attachment: Buffer.from(out,'utf8'), name: 'cmdlogs.txt' }] });
      message.reply('Letzte Admin-Kommandos:\n' + out);
    });
  }

  else if (cmd === 'watchban') {
    if (!isModerator(message.member)) return message.reply('Nur Moderatoren können watchban verwalten.');
    const sub = args[0];
    if (sub === 'add') {
      const player = args.slice(1).join(' ');
      if (!player) return message.reply('Syntax: !watchban add <player>');
      db.run('INSERT INTO watchbans(player) VALUES(?)', [player], function(err) {
        if (err) return message.reply('Fehler: ' + err.message);
        message.reply(`Watchban für ${player} hinzugefügt.`);
      });
    } else if (sub === 'remove') {
      const player = args.slice(1).join(' ');
      db.run('DELETE FROM watchbans WHERE player = ?', [player], function(err) {
        if (err) return message.reply('Fehler: ' + err.message);
        message.reply(`Watchban für ${player} entfernt.`);
      });
    } else if (sub === 'list') {
      db.all('SELECT player FROM watchbans', (err, rows) => {
        if (err) return message.reply('Fehler: ' + err.message);
        if (!rows.length) return message.reply('Keine Watchbans gesetzt.');
        message.reply('Watchbans:\n' + rows.map(r => '- ' + r.player).join('\n'));
      });
    } else {
      message.reply('Syntax: !watchban add/remove/list <player>');
    }
  }
});

function isModerator(member) {
  if (!member || !member.roles) return false;
  return member.roles.cache.some(r => MOD_ROLE_IDS.includes(r.id) || MOD_ROLE_IDS.includes(r.name));
}

client.login(DISCORD_TOKEN);
