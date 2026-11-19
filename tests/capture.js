/* 开发用：用 Edge + CDP 打开游戏、注入测试局面并截图。 */
'use strict';

const fs = require('fs');
const path = require('path');
const { spawn, execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9333 + Math.floor(Math.random() * 200);
const PROFILE = path.join(ROOT, '.tmp-edge-cdp-' + Date.now());
const SHOTS = path.join(__dirname);
const WIDTH = Number(process.env.SHOT_W || 1440);
const HEIGHT = Number(process.env.SHOT_H || 1200);
const SUFFIX = process.env.SHOT_SUFFIX || '';
let activeChild = null;

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function waitJson(url, tries) {
  for (let i = 0; i < (tries || 80); i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return await res.json();
    } catch (e) { /* retry */ }
    await sleep(150);
  }
  throw new Error('CDP endpoint not ready: ' + url);
}

async function main() {
  const url = 'file:///' + path.join(ROOT, 'index.html').replace(/\\/g, '/') +
    '?autostart=1&difficulty=normal&rounds=25&count=3';
  const child = spawn(EDGE, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--hide-scrollbars', '--mute-audio',
    '--remote-allow-origins=*', '--remote-debugging-port=' + PORT,
    '--user-data-dir=' + PROFILE, '--window-size=' + WIDTH + ',' + HEIGHT, url
  ], { stdio: 'ignore' });
  activeChild = child;

  const targets = await waitJson('http://127.0.0.1:' + PORT + '/json/list');
  const page = targets.find((t) => t.type === 'page' && /index\.html/.test(t.url)) ||
    targets.find((t) => t.type === 'page');
  if (!page) throw new Error('no page target');

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });

  let seq = 0;
  const waiting = new Map();
  const errors = [];
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && waiting.has(msg.id)) {
      const p = waiting.get(msg.id);
      waiting.delete(msg.id);
      if (msg.error) p.reject(new Error(msg.error.message));
      else p.resolve(msg.result);
      return;
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      errors.push(msg.params.exceptionDetails.text + ' ' +
        (msg.params.exceptionDetails.exception && msg.params.exceptionDetails.exception.description || ''));
    }
  };
  function send(method, params) {
    return new Promise((resolve, reject) => {
      const id = ++seq;
      waiting.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params: params || {} }));
    });
  }
  async function evalJs(expression) {
    const res = await send('Runtime.evaluate', {
      expression, awaitPromise: true, returnByValue: true, userGesture: true
    });
    if (res.exceptionDetails) {
      throw new Error('eval failed: ' + (res.exceptionDetails.exception && res.exceptionDetails.exception.description || res.exceptionDetails.text));
    }
    return res.result ? res.result.value : undefined;
  }
  async function shot(name) {
    await sleep(450);
    const res = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    const file = path.join(SHOTS, name.replace(/\.png$/, SUFFIX + '.png'));
    fs.writeFileSync(file, Buffer.from(res.data, 'base64'));
    console.log('shot:', file);
  }

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', {
    width: WIDTH, height: HEIGHT, deviceScaleFactor: 1, mobile: WIDTH < 600
  });
  for (let i = 0; i < 60; i++) {
    if (await evalJs('!!(window.OI && window.OI.Game && window.OI.Game.state && window.OI_UI)')) break;
    await sleep(250);
  }
  await sleep(900);

  const setup = await evalJs(`(() => {
    const G = OI.Game, p = G.state.players[0], ai = G.state.players[1];
    G.state.current = 0;
    G.state.phase = 'action';
    [1, 3, 13, 16].forEach((id) => G.buy(p, id));
    [1, 1, 1, 16, 16].forEach((id) => G.build(p, id));
    G.build(p, 13);
    G.buy(ai, 8); G.build(ai, 8); G.build(ai, 8);
    G.buy(ai, 11); G.build(ai, 11);
    p.tokens = 24680;
    ai.tokens = 15320;
    G.state.props[1].algos.length; // keep
    OI_UI.refresh();
    return { humanTokens: p.tokens, lv1: G.state.props[1].algos.length, lv16: G.state.props[16].algos.length };
  })()`);
  console.log('setup:', setup);
  await shot('shot-buildings.png');

  const before = await evalJs(`(() => {
    const G = OI.Game, p = G.state.players[0];
    G.state.current = 0;
    G.state.phase = 'roll';
    G.state.doubles = 0;
    G.state.lastRoll = null;
    p.pos = 39;
    p.inJail = false;
    Math.random = () => 0;
    return { pos: p.pos, level: G.state.props[1].algos.length, tokens: p.tokens };
  })()`);
  console.log('before roll:', before);

  const rolled = await evalJs(`(async () => {
    await OI_UI.humanRoll();
    return {
      busy: OI_UI.busy,
      pending: OI_UI.pendingUpgrade,
      pos: OI.Game.state.players[0].pos,
      level: OI.Game.state.props[1].algos.length
    };
  })()`);
  console.log('after roll:', rolled);
  await shot('shot-upgrade-prompt.png');

  const upgraded = await evalJs(`(() => {
    OI_UI.humanUpgrade();
    const G = OI.Game;
    return { level: G.state.props[1].algos.length, tokens: G.state.players[0].tokens, pending: OI_UI.pendingUpgrade };
  })()`);
  console.log('after upgrade:', upgraded);
  await shot('shot-upgraded.png');

  await evalJs(`OI_UI.openTile(1)`);
  await shot('shot-tile-detail.png');

  await evalJs(`OI_UI.showCardModal(OI.DATA.CHANCE.find(c => c.id === 'c19'), 'chance'); true`);
  await shot('shot-event-machine.png');

  console.log('runtime errors:', errors.length ? errors : 'none');
  ws.close();
  try { execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) { /* ignore */ }
  activeChild = null;
  try { fs.rmSync(PROFILE, { recursive: true, force: true }); } catch (e) { /* ignore */ }
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  if (activeChild) {
    try { execFileSync('taskkill', ['/PID', String(activeChild.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) { /* ignore */ }
  }
  process.exitCode = 1;
});
