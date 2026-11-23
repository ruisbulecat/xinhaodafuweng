/* 开发用：检查 40/72/96 格、铭牌、联动、贷款与新增大厅 UI，并截图。 */
'use strict';

const fs = require('fs');
const path = require('path');
const { spawn, execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9600 + Math.floor(Math.random() * 200);
const PROFILE = path.join(ROOT, '.tmp-edge-feature-' + Date.now());
const WIDTH = 1440;
const HEIGHT = 1200;
let child = null;

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function waitJson(url, tries) {
  for (let i = 0; i < (tries || 80); i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return await res.json();
    } catch (e) { /* retry */ }
    await sleep(150);
  }
  throw new Error('CDP not ready');
}

async function main() {
  child = spawn(EDGE, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--hide-scrollbars', '--mute-audio',
    '--remote-allow-origins=*', '--remote-debugging-port=' + PORT,
    '--user-data-dir=' + PROFILE, '--window-size=' + WIDTH + ',' + HEIGHT,
    'file:///' + path.join(ROOT, 'index.html').replace(/\\/g, '/')
  ], { stdio: 'ignore' });

  const targets = await waitJson('http://127.0.0.1:' + PORT + '/json/list');
  const page = targets.find((t) => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });

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
    const res = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
    if (res.exceptionDetails) {
      throw new Error('eval failed: ' + (res.exceptionDetails.exception && res.exceptionDetails.exception.description || res.exceptionDetails.text));
    }
    return res.result ? res.result.value : undefined;
  }
  async function shot(name) {
    await sleep(500);
    const res = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.writeFileSync(path.join(__dirname, name), Buffer.from(res.data, 'base64'));
    console.log('shot:', name);
  }

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: HEIGHT, deviceScaleFactor: 1, mobile: false });

  const fileUrl = 'file:///' + path.join(ROOT, 'index.html').replace(/\\/g, '/');
  async function load(query) {
    await send('Page.navigate', { url: fileUrl + query });
    for (let i = 0; i < 80; i++) {
      await sleep(150);
      const ready = await evalJs('!!(window.OI && window.OI_UI && window.OI.Game)').catch(() => false);
      if (ready) break;
    }
    await sleep(500);
  }

  // 1) 大厅新 UI
  await load('?debug=1');
  const setupInfo = await evalJs(`(() => ({
    sizeChoices: document.querySelectorAll('#sizeChoices .segment').length,
    lanBtn: !!document.getElementById('lanBtn'),
    summary: document.getElementById('setupSummary').textContent,
    sizeNote: document.getElementById('sizeNote').textContent
  }))()`);
  console.log('setup:', setupInfo);
  await shot('shot-setup-v2.png');

  // 2) 72 格
  await load('?autostart=1&size=72&count=3&rounds=25&difficulty=normal');
  const info72 = await evalJs(`(() => {
    const G = OI.Game, st = G.state, p = st.players[0];
    p.tokens = 300000;
    const props = G.board.filter(t => t.type === 'property').slice(0, 8);
    props.forEach(t => { G.buy(p, t.id); });
    [1,2,3].forEach(id => { G.build(p, id); });
    st.current = 0; st.phase = 'action';
    OI_UI.refresh();
    return {
      size: G.board.length, side: G.board.side, tiles: document.querySelectorAll('.board .tile').length,
      grid: document.getElementById('board').style.gridTemplateColumns,
      plate: document.querySelector('.turn-card .nameplate') && document.querySelector('.turn-card .nameplate').textContent,
      prism: !!document.querySelector('.nameplate--prism'),
      synergy: OI.Game.activeSynergies(p.id).map(s => s.name),
      loan: (G.takeLoan(p), { taken: p.loanTaken, owed: p.loanOwed })
    };
  })()`);
  console.log('72:', info72);
  await shot('shot-72.png');

  // 3) 96 格 + 隐藏铭牌
  await load('?autostart=1&size=96&count=3&rounds=25&difficulty=normal&autoroll=0');
  const info96 = await evalJs(`(() => {
    const G = OI.Game, st = G.state, p = st.players[0];
    p.tokens = 600000;
    const props = G.board.filter(t => t.type === 'property').slice(0, 4);
    props.forEach(t => { G.buy(p, t.id); });
    [0,1,2,3].forEach(i => { G.build(p, props[0].id); });
    [1,2,3].forEach(i => { G.build(p, props[1].id); });
    st.current = 0; st.phase = 'action'; st.pendingBuy = null;
    OI_UI.refresh();
    return {
      size: G.board.length, side: G.board.side, tiles: document.querySelectorAll('.board .tile').length,
      grid: document.getElementById('board').style.gridTemplateColumns,
      prism: !!document.querySelector('.nameplate--prism'),
      plate: document.querySelector('.turn-card .nameplate') && document.querySelector('.turn-card .nameplate').textContent,
      net: G.netWorth(p),
      synergyMult: G.synergyMult(p.id)
    };
  })()`);
  console.log('96:', info96);
  await shot('shot-96.png');

  // 4) 时间事件 + 单元测试接口
  const timer = await evalJs(`(() => {
    const G = OI.Game, st = G.state;
    st.round = 10; st.era = 2; st.nextEventRound = 10;
    const ev = G.maybeTimedEvent();
    G.updateEra();
    return { era: st.era, eraName: st.eraName, event: ev && ev.event.title, eventCount: st.eventCount };
  })()`);
  console.log('timed:', timer);
  await shot('shot-96-event.png');

  console.log('runtime errors:', errors.length ? errors : 'none');
  ws.close();
  try { execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) { /* ignore */ }
  child = null;
  try { fs.rmSync(PROFILE, { recursive: true, force: true }); } catch (e) { /* ignore */ }
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  if (child) {
    try { execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) { /* ignore */ }
  }
  process.exitCode = 1;
});
