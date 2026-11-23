/* 开发用：双浏览器局域网联机端到端测试。 */
'use strict';

const fs = require('fs');
const path = require('path');
const { spawn, execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const NODE = process.execPath;
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9100 + Math.floor(Math.random() * 300);
const CDP_HOST = 9700 + Math.floor(Math.random() * 100);
const CDP_GUEST = 9900 + Math.floor(Math.random() * 100);
let server = null;
let hostEdge = null;
let guestEdge = null;

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function waitJson(url, tries) {
  for (let i = 0; i < (tries || 100); i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return await res.json();
    } catch (e) { /* retry */ }
    await sleep(150);
  }
  throw new Error('not ready: ' + url);
}

class Page {
  constructor(edge, cdpPort, url) {
    this.edge = edge;
    this.cdpPort = cdpPort;
    this.url = url;
    this.errors = [];
  }
  async start() {
    this.edge = spawn(EDGE, [
      '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
      '--disable-extensions', '--hide-scrollbars', '--mute-audio',
      '--remote-allow-origins=*', '--remote-debugging-port=' + this.cdpPort,
      '--user-data-dir=' + path.join(ROOT, '.tmp-edge-lan-' + this.cdpPort + '-' + Date.now()),
      '--window-size=1280,1000', this.url
    ], { stdio: 'ignore' });
    const targets = await waitJson('http://127.0.0.1:' + this.cdpPort + '/json/list');
    const page = targets.find((t) => t.type === 'page');
    this.ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { this.ws.onopen = resolve; this.ws.onerror = reject; });
    let seq = 0;
    this.waiting = new Map();
    this.ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.waiting.has(msg.id)) {
        const p = this.waiting.get(msg.id);
        this.waiting.delete(msg.id);
        if (msg.error) p.reject(new Error(msg.error.message));
        else p.resolve(msg.result);
        return;
      }
      if (msg.method === 'Runtime.exceptionThrown') {
        this.errors.push(msg.params.exceptionDetails.text + ' ' +
          (msg.params.exceptionDetails.exception && msg.params.exceptionDetails.exception.description || ''));
      }
    };
    this.seq = () => ++seq;
    await this.send('Page.enable');
    await this.send('Runtime.enable');
    await this.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 1000, deviceScaleFactor: 1, mobile: false });
    for (let i = 0; i < 100; i++) {
      await sleep(150);
      const ready = await this.eval('!!(window.OI && window.OI_UI && window.OI.Net)').catch(() => false);
      if (ready) return;
    }
    throw new Error('page app not ready');
  }
  send(method, params) {
    return new Promise((resolve, reject) => {
      const id = this.seq();
      this.waiting.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params: params || {} }));
    });
  }
  async eval(expression) {
    const res = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
    if (res.exceptionDetails) {
      throw new Error('eval: ' + (res.exceptionDetails.exception && res.exceptionDetails.exception.description || res.exceptionDetails.text));
    }
    return res.result ? res.result.value : undefined;
  }
  async shot(name) {
    await sleep(500);
    const res = await this.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.writeFileSync(path.join(__dirname, name), Buffer.from(res.data, 'base64'));
    console.log('shot:', name);
  }
  close() {
    try { this.ws.close(); } catch (e) { /* ignore */ }
    try { execFileSync('taskkill', ['/PID', String(this.edge.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) { /* ignore */ }
  }
}

async function main() {
  const external = process.env.LAN_BASE ? process.env.LAN_BASE.replace(/\/$/, '') : '';
  let baseRoot = external;
  if (!external) {
    server = spawn(NODE, [path.join(ROOT, 'server.js')], {
      cwd: ROOT,
      env: Object.assign({}, process.env, { PORT: String(PORT), OI_NO_OPEN: '1' }),
      stdio: 'ignore'
    });
    await waitJson('http://127.0.0.1:' + PORT + '/api/health');
    baseRoot = 'http://127.0.0.1:' + PORT;
  } else {
    await waitJson(baseRoot + '/api/health');
  }

  const base = baseRoot + '/index.html?debug=1';
  const host = new Page(null, CDP_HOST, base);
  await host.start();
  const guest = new Page(null, CDP_GUEST, base);
  await guest.start();
  console.log('pages ready');

  // 房主创建房间
  await host.eval(`(() => {
    document.getElementById('lanBtn').click();
    document.getElementById('lanNameInput').value = '房主阿一';
    document.querySelector('[data-lan-act="create"]').click();
    return true;
  })()`);
  let room = null;
  for (let i = 0; i < 60; i++) {
    await sleep(200);
    room = await host.eval('OI.Net.room').catch(() => null);
    if (room) break;
  }
  if (!room) throw new Error('host room not created');
  console.log('room:', room);
  for (let i = 0; i < 40; i++) {
    await sleep(150);
    const hasSelect = await host.eval(`!!document.querySelector('[data-lan-config="size"]')`).catch(() => false);
    if (hasSelect) break;
  }
  await host.eval(`(() => { const s = document.querySelector('[data-lan-config="size"]'); if (!s) throw new Error('no size select'); s.value = '72'; s.dispatchEvent(new Event('change', {bubbles:true})); return true; })()`);
  await sleep(1000);
  console.log('host config:', await host.eval('OI.Net.config'));

  // 客机加入
  await guest.eval(`(() => {
    document.getElementById('lanBtn').click();
    document.getElementById('lanNameInput').value = '队友小七';
    document.getElementById('lanCodeInput').value = '${room}';
    document.querySelector('[data-lan-act="join"]').click();
    return true;
  })()`);
  let joined = false;
  for (let i = 0; i < 60; i++) {
    await sleep(250);
    joined = await guest.eval('OI.Net.mode === "guest"').catch(() => false);
    if (joined) break;
  }
  if (!joined) throw new Error('guest did not join');
  console.log('guest joined');
  await sleep(900);
  await host.shot('shot-lan-lobby.png');

  // 房主开始
  await host.eval(`(() => { const b = document.querySelector('[data-lan-act="start"]'); if (!b) throw new Error('no start button'); b.click(); return true; })()`);
  for (let i = 0; i < 80; i++) {
    await sleep(250);
    const both = await Promise.all([
      host.eval('!!(OI.Game.state && !document.getElementById("gameScreen").hidden)'),
      guest.eval('!!(OI.Game.state && !document.getElementById("gameScreen").hidden)')
    ]);
    if (both[0] && both[1]) break;
  }
  const startInfo = await host.eval(`(() => ({
    size: OI.Game.board.length,
    players: OI.Game.state.players.map(p => ({ slot: p.slot, name: p.name, human: p.isHuman, remote: p.remote })),
    current: OI.Game.current().name
  }))()`);
  console.log('host start:', startInfo);
  console.log('host net after start:', await host.eval(`(() => ({
    mode: OI.Net.mode, room: OI.Net.room, token: OI.Net.token,
    busy: OI.Net.snapshotBusy, pending: !!OI.Net.pendingSnapshot,
    jsonLen: OI.Net.lastSnapshotJson.length, cursor: OI.Net.lastIndex,
    hostGame: !!OI.Game.state
  }))()`));
  const guestBoot = await guest.eval(`(() => ({ mode: OI.Net.mode, slot: OI.Net.slot, idx: OI.Net.lastIndex, room: OI.Net.room, token: OI.Net.token, hasState: !!OI.Game.state, started: OI.Net.started, dbg: window.__OI_NET_DEBUG, onSnap: !!OI.Net.onSnapshot, onStart: typeof OI.Net.onStart, screen: !document.getElementById('gameScreen').hidden, msgs: window.__NET_MSGS }))()`);
  console.log('guest boot:', guestBoot);
  const msgDump = await fetch(`http://127.0.0.1:${PORT}/api/state?room=${guestBoot.room}&token=${guestBoot.token}&since=0`).then((r) => r.json()).catch((e) => ({ error: String(e) }));
  console.log('server messages:', msgDump.messages ? msgDump.messages.map((m) => m.i + ':' + m.type + ':' + (m.payload && m.payload.state ? 'state' : '')).join(',') : msgDump);
  const guestInfo = await guest.eval(`(() => ({
    mode: OI.Net.mode, slot: OI.Net.slot, size: OI.Game.board.length,
    players: OI.Game.state ? OI.Game.state.players.map(p => p.name) : null,
    tiles: document.querySelectorAll('.board .tile').length,
    current: OI.Game.current() ? OI.Game.current().name : null
  }))()`);
  console.log('guest state:', guestInfo);
  await host.shot('shot-lan-host.png');
  await guest.shot('shot-lan-guest.png');

  // 房主掷骰 / 跳过购买 / 结束回合
  await host.eval('OI_UI.humanRoll()');
  for (let i = 0; i < 30; i++) {
    await sleep(300);
    const busy = await host.eval('OI_UI.busy');
    if (!busy) break;
  }
  await sleep(1600);
  const afterRoll = await guest.eval(`(() => ({ pos: OI.Game.state.players[0].pos, log: OI.Game.state.log.slice(-2).map(l=>l.text) }))()`);
  console.log('guest sees host roll:', afterRoll);
  console.log('host net:', await host.eval(`(() => ({
    pos: OI.Game.state.players[0].pos,
    logLen: OI.Game.state.log.length,
    busy: OI.Net.snapshotBusy,
    pending: !!OI.Net.pendingSnapshot,
    jsonLen: OI.Net.lastSnapshotJson.length,
    cursor: OI.Net.lastIndex
  }))()`));
  const guestNet = await guest.eval(`(() => ({ idx: OI.Net.lastIndex, room: OI.Net.room, token: OI.Net.token, cursorRoom: OI.Net.room }))()`);
  console.log('guest net:', guestNet);
  console.log('guest errors internal:', await guest.eval(`(() => ({ count: OI.Net.errorCount, errs: window.__NET_ERRORS, msgs: (window.__NET_MSGS || []).slice(-6), dbg: window.__OI_NET_DEBUG }))()`));
  const serverState = await fetch(`http://127.0.0.1:${PORT}/api/state?room=${guestNet.room}&token=${guestNet.token}&since=0`).then((r) => r.json()).catch((e) => ({ error: String(e) }));
  console.log('server messages:', serverState.messages ? serverState.messages.map((m) => m.i + ':' + m.type).join(',') : serverState);
  await host.eval(`(() => { if (OI_UI.pendingBuy != null) OI_UI.humanSkipBuy(); if (OI_UI.pendingUpgrade != null) OI_UI.humanSkipUpgrade(); return true; })()`);
  await sleep(300);
  await host.eval('OI_UI.humanEndTurn()');
  await sleep(2000);
  const guestTurn = await guest.eval(`(() => ({
    current: OI.Game.current().name,
    slot: OI.Game.current().slot,
    mySlot: OI.Net.slot,
    rollBtn: !!document.querySelector('[data-act="roll"]'),
    state: document.getElementById('turnState').textContent
  }))()`);
  console.log('guest turn:', guestTurn);
  await guest.shot('shot-lan-guest-turn.png');

  // 客机操作
  if (guestTurn.rollBtn) {
    await guest.eval(`document.querySelector('[data-act="roll"]').click()`);
    for (let i = 0; i < 40; i++) {
      await sleep(300);
      const still = await guest.eval(`!!document.querySelector('[data-act="roll"]') && OI.Game.current().slot === OI.Net.slot`);
      if (!still) break;
    }
  }
  const afterGuestRoll = await host.eval(`(() => ({
    current: OI.Game.current().name,
    pos: OI.Game.state.players.find(p => p.slot === 1).pos,
    log: OI.Game.state.log.slice(-3).map(l=>l.text)
  }))()`);
  console.log('host after guest action:', afterGuestRoll);
  await host.shot('shot-lan-host-after.png');

  console.log('host errors:', host.errors.length ? host.errors : 'none');
  console.log('guest errors:', guest.errors.length ? guest.errors : 'none');

  host.close();
  guest.close();
  if (server) {
    try { execFileSync('taskkill', ['/PID', String(server.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) { /* ignore */ }
    server = null;
  }
  await sleep(300);
  process.exit(0);
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  [hostEdge, guestEdge].forEach((e) => { if (e) { try { execFileSync('taskkill', ['/PID', String(e.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (x) { /* ignore */ } } });
  if (server) { try { execFileSync('taskkill', ['/PID', String(server.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) { /* ignore */ } }
  process.exitCode = 1;
});
