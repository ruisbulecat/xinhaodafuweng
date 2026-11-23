/* ============================================================
   信奥大富翁 · 局域网联机服务器（零依赖 Node.js）
   用法：node server.js  或双击 start-lan.bat
   默认端口 8765，可用环境变量 PORT 修改。
   ============================================================ */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const ROOT = __dirname;
const PORT = Number(process.env.PORT) || 8765;
const HOST = process.env.HOST || '0.0.0.0';
const MAX_PLAYERS = 4;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8'
};

const rooms = new Map();

function log(...args) {
  console.log('[OI-LAN]', ...args);
}

function lanAddresses() {
  const out = [];
  const nets = os.networkInterfaces();
  Object.keys(nets).forEach((name) => {
    (nets[name] || []).forEach((info) => {
      if (info && info.family === 'IPv4' && !info.internal) {
        out.push({ name, address: info.address });
      }
    });
  });
  return out;
}

function sendJson(res, status, obj) {
  const body = Buffer.from(JSON.stringify(obj), 'utf8');
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*'
  });
  res.end(body);
}

function sendError(res, status, message) {
  sendJson(res, status, { ok: false, error: message });
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > (limit || 2 * 1024 * 1024)) {
        reject(new Error('请求体过大'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve(text ? JSON.parse(text) : {});
      } catch (e) {
        reject(new Error('JSON 解析失败'));
      }
    });
    req.on('error', reject);
  });
}

function cleanName(name) {
  return String(name == null ? '' : name).replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 12) || '选手';
}

function cleanConfig(config) {
  const c = config || {};
  const size = [40, 72, 96].indexOf(Number(c.size)) >= 0 ? Number(c.size) : 40;
  const difficulty = ['easy', 'normal', 'hard'].indexOf(c.difficulty) >= 0 ? c.difficulty : 'normal';
  const rounds = [15, 25, 40].indexOf(Number(c.rounds)) >= 0 ? Number(c.rounds) : 25;
  const count = Math.min(4, Math.max(2, Number(c.count) || 3));
  return { size, difficulty, rounds, count };
}

function makeRoomCode() {
  for (let i = 0; i < 200; i++) {
    const code = String(Math.floor(1000 + Math.random() * 9000));
    if (!rooms.has(code)) return code;
  }
  return String(Date.now()).slice(-6);
}

function makeToken() {
  return crypto.randomBytes(12).toString('hex');
}

function roomView(room) {
  const now = Date.now();
  const players = [];
  room.players.forEach((p, slot) => {
    players.push({
      slot,
      name: p.name,
      host: slot === room.hostSlot,
      connected: now - p.lastSeen < 22000
    });
  });
  players.sort((a, b) => a.slot - b.slot);
  return {
    code: room.code,
    hostSlot: room.hostSlot,
    started: room.started,
    config: room.config,
    players,
    maxPlayers: MAX_PLAYERS,
    createdAt: room.createdAt
  };
}

function pushMessage(room, message) {
  const msg = Object.assign({
    i: room.nextIndex++,
    at: Date.now()
  }, message);
  room.messages.push(msg);
  let raw = '';
  try { raw = JSON.stringify(msg); } catch (e) { raw = '{}'; }
  room.bytes += raw.length;
  while (room.messages.length > 700 || room.bytes > 3 * 1024 * 1024) {
    const removed = room.messages.shift();
    if (!removed) break;
    try { room.bytes -= JSON.stringify(removed).length; } catch (e) { room.bytes = 0; }
  }
  room.lastActivity = Date.now();
  return msg;
}

function pushRoom(room) {
  return pushMessage(room, { type: 'room', payload: roomView(room) });
}

function appendSystem(room, text) {
  return pushMessage(room, { type: 'chat', from: -1, fromName: '机房广播', payload: { text } });
}

function auth(req, body) {
  const code = String((body && body.room) || '').trim();
  const token = String((body && body.token) || '').trim();
  const room = rooms.get(code);
  if (!room) return { error: '房间不存在或已解散' };
  if (room.closed) return { error: '房间已关闭' };
  const slot = room.tokens.get(token);
  if (slot == null) return { error: '身份已失效，请重新加入' };
  const player = room.players.get(slot);
  if (!player) return { error: '座位已释放，请重新加入' };
  player.lastSeen = Date.now();
  room.lastActivity = Date.now();
  return { room, slot, player };
}

function currentRooms() {
  return rooms.size;
}

/* ---------------- API ---------------- */
async function handleApi(req, res, url) {
  const action = url.pathname.replace(/^\/api\//, '');

  if (action === 'health' && req.method === 'GET') {
    return sendJson(res, 200, {
      ok: true,
      app: 'oiopoly-lan',
      rooms: currentRooms(),
      port: PORT,
      time: Date.now()
    });
  }

  if (action === 'create' && req.method === 'POST') {
    const body = await readBody(req);
    const room = {
      code: makeRoomCode(),
      hostSlot: 0,
      started: false,
      config: cleanConfig(body.config),
      players: new Map(),
      tokens: new Map(),
      messages: [],
      nextIndex: 1,
      bytes: 0,
      createdAt: Date.now(),
      lastActivity: Date.now(),
      closed: false
    };
    const token = makeToken();
    room.players.set(0, { name: cleanName(body.name), lastSeen: Date.now() });
    room.tokens.set(token, 0);
    rooms.set(room.code, room);
    pushRoom(room);
    appendSystem(room, `${cleanName(body.name)} 创建了房间 ${room.code}`);
    log('创建房间', room.code, '房主', cleanName(body.name));
    return sendJson(res, 200, { ok: true, room: room.code, token, slot: 0, view: roomView(room) });
  }

  if (action === 'join' && req.method === 'POST') {
    const body = await readBody(req);
    const code = String(body.room || '').trim();
    const room = rooms.get(code);
    if (!room || room.closed) return sendError(res, 404, '房间不存在或已解散');
    if (room.started) return sendError(res, 409, '这局比赛已经开始了');
    if (room.players.size >= MAX_PLAYERS) return sendError(res, 409, '房间已满（最多 4 人）');
    let slot = -1;
    for (let i = 0; i < MAX_PLAYERS; i++) {
      if (!room.players.has(i)) { slot = i; break; }
    }
    if (slot < 0) return sendError(res, 409, '房间已满');
    const token = makeToken();
    const name = cleanName(body.name);
    room.players.set(slot, { name, lastSeen: Date.now() });
    room.tokens.set(token, slot);
    pushRoom(room);
    appendSystem(room, `${name} 加入了房间`);
    log('加入房间', code, name, '座位', slot);
    return sendJson(res, 200, { ok: true, room: code, token, slot, view: roomView(room) });
  }

  if (action === 'state' && req.method === 'GET') {
    const code = String(url.searchParams.get('room') || '').trim();
    const token = String(url.searchParams.get('token') || '').trim();
    const room = rooms.get(code);
    if (!room || room.closed) return sendError(res, 404, '房间不存在或已解散');
    const slot = room.tokens.get(token);
    if (slot == null) return sendError(res, 403, '身份已失效');
    const player = room.players.get(slot);
    if (player) player.lastSeen = Date.now();
    room.lastActivity = Date.now();
    let since = Number(url.searchParams.get('since'));
    if (!Number.isFinite(since) || since < 0) since = 0;
    const oldest = room.messages.length ? room.messages[0].i : room.nextIndex;
    const reset = since < oldest - 1;
    if (reset) since = Math.max(0, oldest - 1);
    const messages = room.messages.filter((m) => m.i > since).slice(-320);
    const cursor = room.messages.length ? room.messages[room.messages.length - 1].i : 0;
    return sendJson(res, 200, {
      ok: true,
      cursor,
      oldest,
      reset,
      messages
    });
  }

  if (action === 'send' && req.method === 'POST') {
    const body = await readBody(req, 3 * 1024 * 1024);
    const ctx = auth(req, body);
    if (ctx.error) return sendError(res, 403, ctx.error);
    const type = String(body.type || '');
    if (['action', 'snapshot', 'chat'].indexOf(type) < 0) return sendError(res, 400, '未知消息类型');
    if (type === 'action' && ctx.slot !== 0 && ctx.slot !== ctx.room.hostSlot) {
      /* 客机操作统一发给房主 */
    }
    const toSlot = body.toSlot == null ? null : Number(body.toSlot);
    const msg = pushMessage(ctx.room, {
      type,
      from: ctx.slot,
      fromName: ctx.player.name,
      toSlot,
      payload: body.payload == null ? null : body.payload
    });
    return sendJson(res, 200, { ok: true, i: msg.i });
  }

  if (action === 'config' && req.method === 'POST') {
    const body = await readBody(req);
    const ctx = auth(req, body);
    if (ctx.error) return sendError(res, 403, ctx.error);
    if (ctx.slot !== ctx.room.hostSlot) return sendError(res, 403, '只有房主可以修改设置');
    if (ctx.room.started) return sendError(res, 409, '比赛已经开始');
    ctx.room.config = cleanConfig(body.config || body.payload);
    pushRoom(ctx.room);
    return sendJson(res, 200, { ok: true, view: roomView(ctx.room) });
  }

  if (action === 'start' && req.method === 'POST') {
    const body = await readBody(req);
    const ctx = auth(req, body);
    if (ctx.error) return sendError(res, 403, ctx.error);
    if (ctx.slot !== ctx.room.hostSlot) return sendError(res, 403, '只有房主可以开始比赛');
    if (ctx.room.started) return sendError(res, 409, '比赛已经开始了');
    ctx.room.started = true;
    ctx.room.config = cleanConfig(body.config || ctx.room.config);
    const roster = [];
    ctx.room.players.forEach((p, slot) => roster.push({ slot, name: p.name }));
    roster.sort((a, b) => a.slot - b.slot);
    pushMessage(ctx.room, {
      type: 'start',
      from: ctx.room.hostSlot,
      payload: { config: ctx.room.config, roster }
    });
    pushRoom(ctx.room);
    log('开始比赛', ctx.room.code, roster.map((r) => r.name).join(' / '));
    return sendJson(res, 200, { ok: true, config: ctx.room.config, roster });
  }

  if (action === 'leave' && req.method === 'POST') {
    const body = await readBody(req);
    const code = String(body.room || '').trim();
    const token = String(body.token || '').trim();
    const room = rooms.get(code);
    if (!room) return sendJson(res, 200, { ok: true });
    const slot = room.tokens.get(token);
    if (slot == null) return sendJson(res, 200, { ok: true });
    const player = room.players.get(slot);
    room.tokens.delete(token);
    room.players.delete(slot);
    if (slot === room.hostSlot) {
      room.closed = true;
      pushMessage(room, { type: 'closed', payload: { reason: '房主离开了房间' } });
      log('房主离开，关闭房间', code);
      setTimeout(() => rooms.delete(code), 5000);
    } else {
      pushRoom(room);
      appendSystem(room, `${player ? player.name : '一名选手'} 离开了房间`);
      log('离开房间', code, slot);
    }
    return sendJson(res, 200, { ok: true });
  }

  return sendError(res, 404, '接口不存在');
}

/* ---------------- 静态文件 ---------------- */
function serveStatic(req, res, url) {
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === '/' || pathname === '') pathname = '/index.html';
  const unsafe = pathname.indexOf('\0') >= 0;
  const filePath = path.normalize(path.join(ROOT, pathname));
  if (unsafe || (filePath !== ROOT && !filePath.startsWith(ROOT + path.sep))) {
    return sendError(res, 403, '禁止访问');
  }
  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('404 Not Found');
    }
    const ext = path.extname(filePath).toLowerCase();
    const type = MIME[ext] || 'application/octet-stream';
    const headers = {
      'Content-Type': type,
      'Content-Length': stat.size,
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=60',
      'X-Content-Type-Options': 'nosniff'
    };
    if (req.method === 'HEAD') {
      res.writeHead(200, headers);
      return res.end();
    }
    res.writeHead(200, headers);
    const stream = fs.createReadStream(filePath);
    stream.on('error', () => res.end());
    stream.pipe(res);
  });
}

const server = http.createServer((req, res) => {
  let url;
  try {
    url = new URL(req.url, 'http://localhost');
  } catch (e) {
    return sendError(res, 400, '非法请求');
  }
  if (url.pathname.indexOf('/api/') === 0) {
    handleApi(req, res, url).catch((err) => {
      log('API 错误', err && err.message);
      if (!res.headersSent) sendError(res, 500, err && err.message ? err.message : '服务器错误');
    });
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return sendError(res, 405, '只支持 GET / HEAD');
  }
  serveStatic(req, res, url);
});

/* 清理长时间无人的房间 */
setInterval(() => {
  const now = Date.now();
  rooms.forEach((room, code) => {
    if (room.closed && now - room.lastActivity > 60000) {
      rooms.delete(code);
      return;
    }
    if (!room.closed && now - room.lastActivity > 4 * 60 * 60 * 1000) {
      rooms.delete(code);
    }
  });
}, 30000).unref();

server.listen(PORT, HOST, () => {
  const addrs = lanAddresses();
  console.log('');
  console.log('  ==============================================');
  console.log('   信奥大富翁 · 局域网对战服务器已启动');
  console.log('  ==============================================');
  console.log('   本机地址:  http://127.0.0.1:' + PORT);
  addrs.forEach((a) => {
    console.log('   局域网:    http://' + a.address + ':' + PORT + '   (' + a.name + ')');
  });
  if (!addrs.length) console.log('   未检测到局域网 IPv4 地址，请检查网络连接。');
  console.log('');
  console.log('   同一 Wi-Fi 下的电脑/手机打开上面的「局域网」地址。');
  console.log('   若无法访问，请允许 Node.js 通过 Windows 防火墙。');
  console.log('   按 Ctrl+C 停止服务器。');
  console.log('');

  if (process.platform === 'win32' && process.env.OI_NO_OPEN !== '1') {
    try {
      require('child_process').spawn('cmd', ['/c', 'start', '', 'http://127.0.0.1:' + PORT], {
        detached: true,
        stdio: 'ignore'
      }).unref();
    } catch (e) { /* ignore */ }
  }
});

server.on('error', (err) => {
  if (err && err.code === 'EADDRINUSE') {
    console.error('端口 ' + PORT + ' 已被占用，请关闭占用程序，或设置 PORT 后重试。');
  } else {
    console.error('服务器启动失败：', err);
  }
  process.exitCode = 1;
});
