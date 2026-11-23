/* ============================================================
   信奥大富翁 · 界面层
   棋盘渲染 / 交互流程 / 动画 / 弹窗 / 结算
   ============================================================ */
(function (OI) {
  'use strict';

  const D = OI.DATA;
  const Game = OI.Game;
  const net = OI.Net;
  const util = OI.util;
  const sound = OI.sound;
  const storage = OI.storage;

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel, root) => Array.prototype.slice.call((root || document).querySelectorAll(sel));

  /* DOM */
  const dom = {};
  let selected = { diff: 'normal', count: 3, rounds: 25, size: 40 };
  let busy = false;
  let awaiting = false;
  let pendingBuy = null;
  let pendingUpgrade = null;
  let aiTimer = null;
  let modalClose = null;
  let endShown = false;
  let endingTimer = null;
  let remoteTurnTimer = null;
  let tileEls = {};
  let tileRefs = {};
  let pawnEls = {};
  let logCursor = 0;
  let autoPlayed = false;
  let autoMode = false;
  let autoTimer = null;
  let lanLobbyOpen = false;
  let lastRoomView = null;
  let guestInit = false;
  let awaitingSince = 0;
  let awaitingTurn = -1;
  let lobbyConfig = null;
  const netDebug = { start: 0, snapshot: 0, skip: '', error: '' };
  window.__OI_NET_DEBUG = netDebug;

  /* ============================================================
     初始化
     ============================================================ */
  function init() {
    [
      'setupScreen', 'gameScreen', 'board', 'pawnLayer', 'dieA', 'dieB', 'diceVerdict',
      'centerTile', 'centerTileCode', 'centerTileName', 'centerTileDesc', 'centerMarketText',
      'tickerText', 'tickerRound', 'turnCard', 'turnState', 'actionButtons', 'actionHint',
      'playerList', 'rosterNote', 'gameLog', 'logToggle', 'topbarTokens', 'soundBtn',
      'achieveBtn', 'helpBtn', 'startBtn', 'bestRecordValue', 'setupSummary', 'modeNote',
      'diffChoices', 'countChoices', 'roundChoices', 'sizeChoices', 'sizeNote', 'modalRoot', 'toastRoot',
      'endScreen', 'endTitle', 'endSub', 'endRanking', 'endStats', 'againBtn', 'lobbyBtn',
      'brandHome', 'tickerText', 'centerRound', 'centerPot', 'centerChapters', 'centerMeta', 'centerEra',
      'sideMarket', 'marketNote', 'synergyList', 'synergyNote', 'lanBtn', 'lanChip', 'debugBox'
    ].forEach((id) => { dom[id] = document.getElementById(id); });

    initDie(dom.dieA);
    initDie(dom.dieB);

    $$('#diffChoices .choice').forEach((btn) => {
      btn.addEventListener('click', () => {
        selected.diff = btn.dataset.diff;
        sound.play('click');
        updateSetupUI();
      });
    });
    $$('#countChoices .segment').forEach((btn) => {
      btn.addEventListener('click', () => {
        selected.count = Number(btn.dataset.count);
        sound.play('click');
        updateSetupUI();
      });
    });
    $$('#roundChoices .segment').forEach((btn) => {
      btn.addEventListener('click', () => {
        selected.rounds = Number(btn.dataset.rounds);
        sound.play('click');
        updateSetupUI();
      });
    });
    $$('#sizeChoices .segment').forEach((btn) => {
      btn.addEventListener('click', () => {
        selected.size = Number(btn.dataset.size);
        sound.play('click');
        updateSetupUI();
      });
    });

    dom.startBtn.addEventListener('click', () => { sound.unlock(); sound.play('deal'); startGame(); });
    dom.lanBtn.addEventListener('click', () => { sound.unlock(); sound.play('click'); openLanEntry(); });
    dom.helpBtn.addEventListener('click', openRules);
    dom.achieveBtn.addEventListener('click', openAchievements);
    dom.soundBtn.addEventListener('click', () => {
      sound.setEnabled(!sound.enabled);
      syncSoundButton();
      sound.play('click');
    });
    dom.brandHome.addEventListener('click', () => {
      if (!dom.gameScreen.hidden && Game.state && !Game.state.over) {
        confirmLeave();
      } else if (!dom.gameScreen.hidden) {
        backToLobby();
      } else {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    });
    dom.actionButtons.addEventListener('click', onActionClick);
    dom.board.addEventListener('click', (e) => {
      const tile = e.target.closest('.tile');
      if (tile) openTile(Number(tile.dataset.id));
    });
    dom.logToggle.addEventListener('click', () => {
      const expanded = dom.gameLog.classList.toggle('is-expanded');
      dom.logToggle.textContent = expanded ? '收起' : '展开';
    });
    dom.againBtn.addEventListener('click', () => {
      dom.endScreen.hidden = true;
      endShown = false;
      if (net.isLan()) {
        backToLobby();
      } else {
        startGame();
      }
    });
    dom.lobbyBtn.addEventListener('click', backToLobby);

    document.addEventListener('keydown', onKeydown);
    window.addEventListener('resize', debounce(layoutPawns, 120));

    net.onRoom = onNetRoom;
    net.onStart = onNetStart;
    net.onAction = onNetAction;
    net.onSnapshot = onNetSnapshot;
    net.onError = (msg) => toast(msg, 'bad');
    net.onClose = (reason) => {
      if (reason) toast(reason, 'bad');
      if (net.mode !== 'local') {
        net.reset();
        backToLobby();
      }
    };
    dom.modalRoot.addEventListener('click', onLanModalClick);
    dom.modalRoot.addEventListener('change', onLanConfigChange);

    syncSoundButton();
    updateSetupUI();
    updateBestRecord();
    updateAchieveBadge();

    const params = new URLSearchParams(window.location.search);
    if (params.has('debug') || params.has('autoplay')) {
      dom.debugBox.hidden = false;
    }
    window.addEventListener('error', (e) => {
      dom.debugBox.hidden = false;
      dom.debugBox.textContent = `ERROR: ${e.message}\n${e.filename}:${e.lineno}:${e.colno}`;
    });
    window.addEventListener('unhandledrejection', (e) => {
      dom.debugBox.hidden = false;
      dom.debugBox.textContent = `REJECTION: ${e.reason && e.reason.stack ? e.reason.stack : e.reason}`;
    });
    if (params.has('autoplay')) {
      autoMode = true;
      if (!params.has('autostart')) selected.rounds = 15;
    }
    if (params.has('autostart') || params.has('autoplay')) {
      if (params.get('difficulty') && D.DIFFICULTIES[params.get('difficulty')]) selected.diff = params.get('difficulty');
      if (params.get('rounds')) selected.rounds = Number(params.get('rounds'));
      if (params.get('count')) selected.count = util.clamp(Number(params.get('count')), 2, 4);
      if (params.get('size') && D.SIZE_PRESETS[params.get('size')]) selected.size = Number(params.get('size'));
      startGame();
      if (params.get('autoroll')) {
        setTimeout(() => {
          if (Game.state && !busy) humanRoll();
        }, 700);
      }
      if (autoMode) {
        setTimeout(startAutopilot, 1000);
      }
    }
  }

  function debounce(fn, wait) {
    let t = null;
    return function () {
      clearTimeout(t);
      t = setTimeout(fn, wait);
    };
  }

  function syncSoundButton() {
    const use = dom.soundBtn.querySelector('use');
    use.setAttribute('href', sound.enabled ? '#i-sound' : '#i-mute');
    dom.soundBtn.setAttribute('aria-label', sound.enabled ? '关闭音效' : '开启音效');
  }

  function updateSetupUI() {
    $$('#diffChoices .choice').forEach((b) => b.classList.toggle('is-active', b.dataset.diff === selected.diff));
    $$('#countChoices .segment').forEach((b) => b.classList.toggle('is-active', Number(b.dataset.count) === selected.count));
    $$('#roundChoices .segment').forEach((b) => b.classList.toggle('is-active', Number(b.dataset.rounds) === selected.rounds));
    $$('#sizeChoices .segment').forEach((b) => b.classList.toggle('is-active', Number(b.dataset.size) === selected.size));
    const diff = D.DIFFICULTIES[selected.diff];
    const preset = D.SIZE_PRESETS[selected.size] || D.SIZE_PRESETS[40];
    const start = util.roundTo(diff.start * preset.startMult, 500);
    dom.modeNote.textContent = `${diff.name} · 起始 ${util.fmt(start)}`;
    if (dom.sizeNote) dom.sizeNote.textContent = `${preset.name} · 初始工资 ${util.fmt(preset.salary)}`;
    dom.setupSummary.innerHTML = `<span class="pulse-dot"></span><span>${diff.name} · ${preset.name} · ${selected.rounds} 回合 · ${selected.count} 名选手 · 每人 ${util.fmt(start)} token · 三轮时局</span>`;
  }

  function updateBestRecord() {
    const best = Number(storage.get(D.STORAGE.best, 0)) || 0;
    dom.bestRecordValue.textContent = best > 0 ? util.fmt(best) : '—';
  }

  /* ============================================================
     开局 / 回大厅
     ============================================================ */
  function resetGameUI() {
    clearTimeout(aiTimer);
    clearTimeout(endingTimer);
    clearTimeout(remoteTurnTimer);
    remoteTurnTimer = null;
    stopAutopilot();
    endShown = false;
    busy = false;
    awaiting = false;
    pendingBuy = null;
    pendingUpgrade = null;
    logCursor = 0;
    autoPlayed = false;
    dom.gameLog.innerHTML = '';
    dom.gameLog.classList.remove('is-expanded');
    dom.logToggle.textContent = '展开';
    dom.endScreen.hidden = true;
  }

  function startGame() {
    resetGameUI();
    if (net.isLan()) { net.leave(true); net.reset(); }
    Game.create({
      difficulty: selected.diff, count: selected.count, rounds: selected.rounds,
      boardSize: selected.size
    });
    enterGame();
    beginTurn();
  }

  function enterGame() {
    dom.setupScreen.hidden = true;
    dom.gameScreen.hidden = false;
    if (dom.lanChip) {
      dom.lanChip.hidden = !net.isLan();
      dom.lanChip.textContent = net.isLan() ? `📶 联机 ${net.room}` : '📶 联机';
    }
    window.scrollTo({ top: 0, behavior: 'auto' });
    buildBoard();
    buildPawns();
    refresh();
    requestAnimationFrame(layoutPawns);
    updateTicker();
    if (Game.state) updateCenter(Game.current() ? Game.current().pos : 0, false);
  }

  function backToLobby() {
    clearTimeout(aiTimer);
    clearTimeout(endingTimer);
    clearTimeout(remoteTurnTimer);
    remoteTurnTimer = null;
    stopAutopilot();
    if (net.isLan()) { net.leave(true); net.reset(); }
    busy = false;
    awaiting = false;
    pendingBuy = null;
    pendingUpgrade = null;
    lanLobbyOpen = false;
    guestInit = false;
    dom.endScreen.hidden = true;
    dom.gameScreen.hidden = true;
    dom.setupScreen.hidden = false;
    if (dom.lanChip) dom.lanChip.hidden = true;
    updateBestRecord();
    updateSetupUI();
    window.scrollTo({ top: 0, behavior: 'auto' });
  }

  function confirmLeave() {
    const lan = net.isLan();
    openModal({
      title: lan ? '离开联机房间？' : '离开这局比赛？',
      icon: '🚪',
      html: lan
        ? '<p>离开后本局不会保存；如果你是房主，房间会直接关闭。</p>'
        : '<p>当前对局不会保存，离开后需要重新开始。</p>',
      actions: [
        { label: '继续比赛', value: null, className: 'btn--ghost' },
        { label: '离开对局', value: 'leave', className: 'btn--danger' }
      ],
      closable: true
    }).then((v) => {
      if (v === 'leave') backToLobby();
    });
  }

  /* ============================================================
     棋盘渲染
     ============================================================ */
  function buildBoard() {
    Object.keys(tileEls).forEach((id) => {
      if (tileEls[id] && tileEls[id].parentNode) tileEls[id].parentNode.removeChild(tileEls[id]);
    });
    tileEls = {};
    tileRefs = {};

    const board = Game.board || Game.board;
    const size = board.length;
    const side = size / 4;
    dom.board.classList.toggle('board--dense', size > 40);
    dom.board.classList.toggle('board--xl', size >= 96);
    dom.board.style.gridTemplateColumns = `1.18fr repeat(${side - 1}, 1fr) 1.18fr`;
    dom.board.style.gridTemplateRows = `1.18fr repeat(${side - 1}, 1fr) 1.18fr`;
    const center = document.getElementById('boardCenter');
    if (center) center.style.gridArea = `2 / 2 / ${side + 1} / ${side + 1}`;

    board.forEach((tile) => {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = `tile tile--${tile.side}`;
      if (tile.side === 'corner') el.classList.add('tile--corner');
      if (tile.type === 'jail' || tile.type === 'goToJail') el.classList.add('tile--jail');
      if (tile.type === 'facility') el.classList.add('tile--facility');
      el.dataset.id = String(tile.id);
      el.style.gridRow = String(tile.row);
      el.style.gridColumn = String(tile.col);
      const color = tile.color || '#8aa39c';
      el.style.setProperty('--group', color);
      el.setAttribute('aria-label', tileAria(tile));
      el.innerHTML = tileMarkup(tile);
      dom.board.appendChild(el);
      tileEls[tile.id] = el;
      tileRefs[tile.id] = {
        el,
        chips: el.querySelector('.tile__chips'),
        price: el.querySelector('.tile__price'),
        owner: el.querySelector('.tile__owner')
      };
    });

    renderLegend();
  }

  function tileAria(tile) {
    if (tile.type === 'property') return `${tile.name}，${D.GROUPS[tile.group].name}，售价 ${tile.price}`;
    if (tile.type === 'facility') return `${tile.name}，售价 ${tile.price}`;
    return tile.name;
  }

  function tileMarkup(tile) {
    let body = '';
    if (tile.type === 'property') {
      body = `
        <div class="tile__body">
          <div class="tile__name">${util.escapeHtml(tile.name)}</div>
          <div class="tile__code">${tile.code}</div>
          <div class="tile__spacer"></div>
          <div class="tile__chips"></div>
          <div class="tile__price">${util.fmt(tile.price)}</div>
        </div>`;
    } else if (tile.type === 'facility') {
      body = `
        <div class="tile__body">
          <div class="tile-facility-icon">${tile.icon}</div>
          <div class="tile__name">${util.escapeHtml(tile.name)}</div>
          <div class="tile__spacer"></div>
          <div class="tile__price">${util.fmt(tile.price)}</div>
        </div>`;
    } else if (tile.side === 'corner') {
      body = `
        <div class="tile__body">
          <div class="tile-corner-icon">${tile.icon}</div>
          <div class="tile__name">${util.escapeHtml(tile.name)}</div>
          <div class="tile__code">${tile.code}</div>
        </div>`;
    } else {
      body = `
        <div class="tile__body">
          <div class="tile-corner-icon" style="font-size:15px">${tile.icon || '✦'}</div>
          <div class="tile__name">${util.escapeHtml(tile.name)}</div>
          <div class="tile__code">${tile.code}</div>
        </div>`;
    }
    const strip = tile.side === 'corner' ? '' : '<div class="tile__strip"></div>';
    return `${strip}${body}<span class="tile__owner" hidden></span>`;
  }

  function renderLegend() {
    const html = D.GROUP_ORDER.map((id) => {
      const g = D.GROUPS[id];
      return `<span class="legend-item"><i class="legend-swatch" style="--c:${g.color}"></i>${g.name}</span>`;
    }).join('') + '<span class="legend-item"><i class="legend-swatch" style="--c:#8aa39c"></i>算力设施</span><span class="legend-note">点击地块查看详情</span>';
    const legend = document.getElementById('boardLegend');
    if (legend) legend.innerHTML = html;
  }

  function buildPawns() {
    dom.pawnLayer.innerHTML = '';
    pawnEls = {};
    Game.state.players.forEach((p) => {
      const el = document.createElement('span');
      el.className = 'pawn';
      el.style.setProperty('--pawn', p.color);
      el.textContent = p.initial;
      el.title = p.name;
      dom.pawnLayer.appendChild(el);
      pawnEls[p.id] = el;
    });
  }

  function layoutPawns() {
    if (!Game.state) return;
    const boardRect = dom.board.getBoundingClientRect();
    const byPos = {};
    Game.state.players.forEach((p) => {
      if (!p.alive) return;
      if (!byPos[p.pos]) byPos[p.pos] = [];
      byPos[p.pos].push(p);
    });

    Object.keys(byPos).forEach((posKey) => {
      const players = byPos[posKey];
      const pos = Number(posKey);
      const tile = tileEls[pos];
      const tileData = Game.board[pos];
      if (!tile || !tileData) return;
      const r = tile.getBoundingClientRect();
      let ax = 0.5;
      let ay = 0.5;
      if (tileData.side === 'corner') {
        const corner = tileData.corner || 'br';
        if (corner === 'br') { ax = 0.74; ay = 0.74; }
        else if (corner === 'bl') { ax = 0.26; ay = 0.74; }
        else if (corner === 'tl') { ax = 0.26; ay = 0.26; }
        else { ax = 0.74; ay = 0.26; }
      } else if (tileData.side === 'bottom') {
        ay = 0.76;
      } else if (tileData.side === 'top') {
        ay = 0.24;
      } else if (tileData.side === 'left') {
        ax = 0.24;
      } else {
        ax = 0.76;
      }
      const cx = r.left - boardRect.left + r.width * ax;
      const cy = r.top - boardRect.top + r.height * ay;
      players.forEach((p, index) => {
        const n = players.length;
        let dx = 0;
        let dy = 0;
        if (n > 1) {
          const offs = n === 2 ? [[-6, 0], [6, 0]] : [[-5, -5], [5, -5], [-5, 5], [5, 5]];
          dx = offs[index % offs.length][0];
          dy = offs[index % offs.length][1];
        }
        const el = pawnEls[p.id];
        if (!el) return;
        el.style.display = '';
        el.style.left = (cx + dx) + 'px';
        el.style.top = (cy + dy) + 'px';
        el.classList.toggle('is-active', Game.state.current === Game.state.players.indexOf(p) && !Game.state.over);
        el.classList.toggle('is-banned', !!p.inJail);
      });
    });

    Game.state.players.forEach((p) => {
      const el = pawnEls[p.id];
      if (!el) return;
      if (!p.alive) el.style.display = 'none';
    });

    if (dom.debugBox && !dom.debugBox.hidden) {
      const t5 = tileEls[5] ? tileEls[5].getBoundingClientRect() : null;
      const lines = [
        `view ${window.innerWidth}x${window.innerHeight} board ${Math.round(boardRect.left)},${Math.round(boardRect.top)} ${Math.round(boardRect.width)}x${Math.round(boardRect.height)}`,
        t5 ? `tile5 ${Math.round(t5.left)},${Math.round(t5.top)} ${Math.round(t5.width)}x${Math.round(t5.height)}` : 'tile5 none'
      ];
      Game.state.players.forEach((p) => {
        const el = pawnEls[p.id];
        lines.push(`${p.name} pos=${p.pos} left=${el ? el.style.left : '?'} top=${el ? el.style.top : '?'} disp=${el ? el.style.display : '?'}`);
      });
      dom.debugBox.textContent = lines.join('\n');
    }
  }

  /* ============================================================
     骰子
     ============================================================ */
  const PIPS = {
    1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8],
    5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8]
  };

  function initDie(el) {
    let html = '';
    for (let i = 0; i < 9; i++) html += '<span class="die__pip"></span>';
    el.innerHTML = html;
    setDie(el, 1);
  }

  function setDie(el, face) {
    const on = PIPS[face] || PIPS[1];
    const pips = el.children;
    for (let i = 0; i < pips.length; i++) {
      pips[i].classList.toggle('is-on', on.indexOf(i) >= 0);
    }
    el.dataset.face = String(face);
  }

  async function animateDice(a, b) {
    sound.play('dice');
    dom.dieA.classList.add('is-rolling');
    dom.dieB.classList.add('is-rolling');
    if (!util.reducedMotion()) {
      const start = Date.now();
      while (Date.now() - start < 480) {
        setDie(dom.dieA, util.randInt(1, 6));
        setDie(dom.dieB, util.randInt(1, 6));
        await util.sleep(65);
      }
    }
    setDie(dom.dieA, a);
    setDie(dom.dieB, b);
    dom.dieA.classList.remove('is-rolling');
    dom.dieB.classList.remove('is-rolling');
    const double = a === b;
    dom.diceVerdict.textContent = `${a} + ${b} = ${a + b}${double ? ' · 双数！' : ''}`;
  }

  /* ============================================================
     本地玩家 / 铭牌
     ============================================================ */
  function isGuest() {
    return net.mode === 'guest';
  }

  function me() {
    if (!Game.state) return null;
    if (isGuest()) {
      return Game.state.players.find((p) => p.slot === net.slot) || Game.state.players[0] || null;
    }
    return Game.state.players[0] || null;
  }

  function isLocalTurn() {
    const p = Game.current();
    if (!p || !Game.state || Game.state.over) return false;
    if (isGuest()) return p.slot === net.slot;
    return !p.remote;
  }

  function label(p) {
    const local = me();
    return local && p && local.id === p.id ? '你' : (p ? p.name : '选手');
  }

  function shouldEndLocal(p) {
    if (!p || net.isLan()) return false;
    const local = me();
    return !!local && local.id === p.id;
  }

  function hasMaxedBuilding(p) {
    if (!p) return false;
    return Game.ownedTiles(p.id).some((t) => Game.state.props[t.id].algos.length >= D.CONFIG.maxAlgos);
  }

  function plateFor(p) {
    if (!p) return D.NAMEPLATES[0];
    return D.nameplateFor(Game.netWorth(p), hasMaxedBuilding(p));
  }

  function plateMarkup(p, compact) {
    const plate = plateFor(p);
    const cls = 'nameplate' + (plate.id === 'prism' ? ' nameplate--prism' : '') + (compact ? ' nameplate--sm' : '');
    return `<span class="${cls}" style="--np:${plate.color};--np-bg:${plate.bg};--np-border:${plate.border}" title="洛谷难度铭牌：${plate.name}"><span class="nameplate__text">${plate.name}</span></span>`;
  }

  /* ============================================================
     渲染
     ============================================================ */
  function refresh() {
    if (!Game.state) return;
    updateTopbar();
    updateTurnCard();
    updateBoard();
    updateRoster();
    updateTicker();
    updateCenterMeta();
    updateChapters();
    updateSideMarket();
    updateSynergy();
    updateLog();
    renderActions();
    requestAnimationFrame(layoutPawns);
    setTimeout(layoutPawns, 80);
    broadcastSnapshot();
  }

  function broadcastSnapshot() {
    if (net.mode !== 'host' || !Game.state) return;
    net.hostSnapshot({
      state: Game.state,
      ui: { pendingBuy, pendingUpgrade, busy },
      slot: 0
    });
  }

  function updateCenterMeta() {
    const st = Game.state;
    if (!st || !dom.centerRound) return;
    dom.centerRound.textContent = `ROUND ${String(Math.min(st.round, st.maxRounds)).padStart(2, '0')} / ${st.maxRounds}`;
    dom.centerPot.textContent = `罚时池 ${util.fmt(st.pot)}`;
    if (dom.centerEra) {
      dom.centerEra.textContent = `${st.eraName || '第一轮'} / 3 · 时局事件 ${st.eventCount || 0}`;
    }
  }

  function updateChapters() {
    if (!Game.state || !dom.centerChapters) return;
    dom.centerChapters.innerHTML = D.GROUP_ORDER.map((id) => {
      const g = D.GROUPS[id];
      const m = Game.marketMult(id);
      const cls = m > 1.001 ? ' is-up' : (m < 0.999 ? ' is-down' : '');
      return `<span class="chapter-chip${cls}" style="--c:${g.color}" title="${g.name} 租金 ×${m.toFixed(2)}">
        <i class="chapter-chip__dot"></i>
        <span class="chapter-chip__name">${g.name}</span>
        <span class="chapter-chip__mult">×${m.toFixed(2)}</span>
      </span>`;
    }).join('');
  }

  function updateTopbar() {
    const human = me();
    dom.topbarTokens.textContent = util.fmt(human ? human.tokens : 0);
    if (human && human.loanOwed) {
      dom.topbarTokens.title = `银行贷款待还 ${util.fmt(human.loanOwed)} token`;
    } else {
      dom.topbarTokens.title = '';
    }
  }

  function updateTurnCard() {
    const p = Game.current();
    if (!p) return;
    const tile = Game.board[p.pos];
    const owned = Game.ownedTiles(p.id);
    const buildingCount = Game.buildingCount(p.id);
    const isAI = !p.isHuman;
    const badge = p.inJail ? '<span class="turn-badge is-banned">暴力禁赛中</span>'
      : isAI ? `<span class="turn-badge is-ai">${p.tag}</span>`
        : (p.remote ? '<span class="turn-badge is-lan">联机中</span>' : '<span class="turn-badge">正在行动</span>');
    const plate = plateMarkup(p);
    const loanPill = p.loanOwed > 0
      ? `<span class="stat-pill stat-pill--debt">银行欠款 <b>${util.fmt(p.loanOwed)}</b></span>`
      : (p.loanTaken ? '<span class="stat-pill">贷款已用</span>' : '');

    dom.turnCard.style.setProperty('--pc', p.color);
    dom.turnCard.innerHTML = `
      <div class="turn-card__top">
        <span class="avatar">${p.icon}</span>
        <div class="turn-card__ident">
          <div class="turn-card__name"><span class="dot"></span>${util.escapeHtml(p.name)}${plate}</div>
          <span class="turn-card__meta">${p.inJail ? 'BANNED · 暴力代码审查中' : `AT #${p.pos} · ${util.escapeHtml(tile.name)}`}</span>
        </div>
        ${badge}
      </div>
      <div class="turn-card__tokens">
        <div>
          <span>现金 · TOKEN</span>
          <strong>${util.fmt(p.tokens)}</strong>
        </div>
        <div class="turn-card__net">
          <span>总资产</span>
          <strong>${util.fmt(Game.netWorth(p))}</strong>
        </div>
      </div>
      <div class="turn-card__foot">
        <span class="stat-pill">地块 <b>${owned.length}</b></span>
        <span class="stat-pill">建筑 <b>${buildingCount}</b> 层</span>
        <span class="stat-pill stat-pill--gold">申诉信 <b>${p.getOut}</b></span>
        ${loanPill}
      </div>`;
  }

  function updateBoard() {
    const st = Game.state;
    const current = Game.current();
    Game.board.forEach((tile) => {
      const el = tileEls[tile.id];
      if (!el) return;
      const prop = st.props[tile.id];
      const refs = tileRefs[tile.id];
      const owner = prop && prop.owner ? Game.player(prop.owner) : null;

      el.classList.toggle('is-owned', !!owner);
      el.classList.toggle('is-mortgaged', !!(prop && prop.mortgaged));
      el.classList.toggle('is-current', !!current && current.pos === tile.id && !st.over);
      el.classList.toggle('has-algos', !!(prop && prop.algos.length));
      el.classList.toggle('is-maxed', !!(prop && prop.algos.length >= D.CONFIG.maxAlgos));

      if (owner) {
        el.style.setProperty('--owner-color', owner.color);
        el.style.setProperty('--owner-ring', hexA(owner.color, 0.5));
      }

      if (refs.owner) {
        refs.owner.hidden = !owner;
        if (owner) refs.owner.style.setProperty('--owner-color', owner.color);
      }

      if (refs.chips && prop) {
        refs.chips.innerHTML = prop.algos.map((a, i) => `<span class="tile__chip" title="Lv.${i + 1} ${util.escapeHtml(a.name)}">${util.escapeHtml(a.short)}</span>`).join('');
      }
      if (refs.price) {
        const level = prop ? prop.algos.length : 0;
        refs.price.textContent = level > 0 ? `Lv.${level}` : util.fmt(tile.price);
        refs.price.title = level > 0 ? `${level} 层算法建筑` : `售价 ${util.fmt(tile.price)} token`;
      }
      if (tile.type === 'property') {
        const level = prop ? prop.algos.length : 0;
        const rent = owner ? Game.rentFor(tile.id, 7) : 0;
        el.setAttribute('aria-label', `${tile.name}，${level > 0 ? `Lv.${level} 算法建筑` : '空地'}，${owner ? `租金 ${util.fmt(rent)} token` : `售价 ${util.fmt(tile.price)} token`}`);
      }
    });
  }

  function updateRoster() {
    const st = Game.state;
    dom.rosterNote.textContent = `${Game.alivePlayers().length}/${st.players.length} 名选手`;
    dom.playerList.innerHTML = st.players.map((p, i) => {
      const owned = Game.ownedTiles(p.id);
      const buildingCount = Game.buildingCount(p.id);
      const isCurrent = st.current === i && !st.over;
      const status = !p.alive ? '已退役' : p.inJail
        ? `暴力禁赛中 · ${D.CONFIG.jailTurns - p.jailTurns} 次申诉机会`
        : `地块 ${owned.length} · 建筑 ${buildingCount} 层${p.loanOwed ? ` · 欠款 ${util.fmtCompact(p.loanOwed)}` : ''}`;
      const isMe = isGuest() ? p.slot === net.slot : i === 0;
      const tagText = !p.isHuman ? (p.tag || 'AI') : (isMe ? 'YOU' : 'P' + (p.slot + 1));
      return `
        <div class="roster-row${isCurrent ? ' is-current' : ''}${p.alive ? '' : ' is-dead'}" style="--pc:${p.color}">
          <span class="roster-avatar">${p.icon}</span>
          <div class="roster-main">
            <div class="roster-name">${util.escapeHtml(p.name)}<span class="tag">${tagText}</span>${plateMarkup(p, true)}</div>
            <div class="roster-sub">${status}</div>
          </div>
          <div class="roster-money">
            <strong>${util.fmt(p.tokens)}</strong>
            <small>资产 ${util.fmtCompact(Game.netWorth(p))}</small>
          </div>
        </div>`;
    }).join('');
  }

  function updateTicker() {
    const st = Game.state;
    if (!st) return;
    dom.tickerRound.textContent = `R${st.round} · ${st.eraName || '第一轮'}`;
    let text = '行情平稳，适合抄底。';
    if (st.headline && st.headlineRound === st.round) {
      text = st.headline;
    } else if (st.lastTimedEvent && st.lastTimedEvent.round === st.round) {
      text = `${st.lastTimedEvent.icon} ${st.lastTimedEvent.title}：${st.lastTimedEvent.summary || st.lastTimedEvent.text}`;
    } else if (st.market.length) {
      text = st.market.map((m) => `${m.groupName} 租金 ×${m.mult.toFixed(2)}（至 R${m.untilRound}）`).join('　·　');
    }
    dom.tickerText.textContent = text;
    if (dom.centerMarketText) {
      dom.centerMarketText.textContent = st.market.length
        ? `${st.market[st.market.length - 1].groupName} 行情 ×${st.market[st.market.length - 1].mult.toFixed(2)}`
        : '行情平稳，适合抄底。';
    }
  }

  function updateSideMarket() {
    const st = Game.state;
    if (!st || !dom.sideMarket) return;
    dom.marketNote.textContent = `R${st.round}`;
    const rows = st.market.map((m) => {
      const pct = Math.round((m.mult - 1) * 100);
      return `<div class="market-row">
        <span class="swatch" style="--c:${m.color}"></span>
        <span class="market-row__name">${m.groupName}<small>至 R${m.untilRound}${m.source ? ' · ' + m.source : ''}</small></span>
        <span class="market-row__mult${m.mult < 1 ? ' is-down' : ''}">${pct >= 0 ? '+' : ''}${pct}%</span>
      </div>`;
    }).join('');
    const nextIn = Math.max(0, (st.nextEventRound || 0) - st.round);
    dom.sideMarket.innerHTML = (rows || '<div class="market-empty">暂无行情。租金按基础值结算。</div>')
      + `<div class="pot-line"><span>罚时池</span><strong>${util.fmt(st.pot)}</strong></div>`
      + `<div class="pot-line"><span>下次时局事件</span><strong>${nextIn <= 0 ? '本回合' : nextIn + ' 回合后'}</strong></div>`;
  }

  function updateSynergy() {
    const st = Game.state;
    if (!st || !dom.synergyList) return;
    const who = me() || st.players[0];
    if (!who) return;
    const active = Game.activeSynergies(who.id);
    const mult = Game.synergyMult(who.id);
    if (dom.synergyNote) dom.synergyNote.textContent = `联动 ×${mult.toFixed(2)}`;
    if (!active.length) {
      const pool = D.SYNERGIES.slice(0, 3).map((s) => `<span class="synergy-empty__algo">${s.algos.join(' + ')}</span>`).join('');
      dom.synergyList.innerHTML = `<div class="synergy-empty">尚未激活联动。同一选手同时拥有组合中的两种算法建筑即可加成。<div class="synergy-empty__list">${pool}</div></div>`;
      return;
    }
    dom.synergyList.innerHTML = active.map((s) => `
      <div class="synergy-row" title="${util.escapeHtml(s.desc)}">
        <span class="synergy-row__icon">🔗</span>
        <span class="synergy-row__main">
          <strong>${util.escapeHtml(s.name)} <b>×${s.mult.toFixed(2)}</b></strong>
          <small>${util.escapeHtml(s.algos.join(' + '))}</small>
        </span>
      </div>`).join('');
  }

  function updateLog(forceBottom) {
    const st = Game.state;
    if (!st) return;
    if (logCursor > st.log.length) {
      logCursor = 0;
      dom.gameLog.innerHTML = '';
    }
    const atBottom = dom.gameLog.scrollHeight - dom.gameLog.scrollTop - dom.gameLog.clientHeight < 44;
    const slice = st.log.slice(logCursor);
    if (slice.length) {
      const frag = document.createDocumentFragment();
      slice.forEach((entry) => {
        const div = document.createElement('div');
        div.className = `log-item log-item--${entry.type}`;
        div.innerHTML = `<span class="log-item__round">R${entry.round}</span><span class="log-item__text">${util.escapeHtml(entry.text)}</span>`;
        frag.appendChild(div);
      });
      dom.gameLog.appendChild(frag);
      logCursor = st.log.length;
      if (atBottom || forceBottom) dom.gameLog.scrollTop = dom.gameLog.scrollHeight;
    }
  }

  function updateCenter(tileId, flash) {
    const tile = Game.board[tileId];
    if (!tile) return;
    dom.centerTileCode.textContent = tile.code;
    dom.centerTileName.textContent = tile.name;
    let desc = tile.desc;
    if (tile.type === 'property') {
      const prop = Game.state && Game.state.props[tile.id];
      const owner = prop && prop.owner ? Game.player(prop.owner) : null;
      if (owner) desc = `${owner.name} 持有 · Lv.${prop.algos.length} 算法建筑 · 当前租金 ${util.fmt(Game.rentFor(tile.id, 7))} token。`;
    } else if (tile.type === 'facility') {
      const prop = Game.state && Game.state.props[tile.id];
      const owner = prop && prop.owner ? Game.player(prop.owner) : null;
      if (owner) desc = `${owner.name} 持有 · 算力设施 ${Game.facilitiesOwned(owner.id)} 处。`;
    }
    dom.centerTileDesc.textContent = desc;
    if (flash) {
      dom.centerTile.classList.remove('is-flash');
      void dom.centerTile.offsetWidth;
      dom.centerTile.classList.add('is-flash');
    }
  }

  function highlightTile(tileId) {
    const el = tileEls[tileId];
    if (!el) return;
    el.classList.remove('is-landing');
    void el.offsetWidth;
    el.classList.add('is-landing');
    setTimeout(() => el.classList.remove('is-landing'), 800);
  }

  function highlightBuild(tileId) {
    const el = tileEls[tileId];
    if (!el) return;
    el.classList.remove('is-upgraded');
    void el.offsetWidth;
    el.classList.add('is-upgraded');
    setTimeout(() => el.classList.remove('is-upgraded'), 900);
  }

  function flashDisaster(tileId) {
    const el = tileEls[tileId];
    if (!el) return;
    el.classList.remove('is-disaster');
    void el.offsetWidth;
    el.classList.add('is-disaster');
    setTimeout(() => el.classList.remove('is-disaster'), 1000);
  }

  function crashBoard() {
    dom.board.classList.remove('is-crashing');
    void dom.board.offsetWidth;
    dom.board.classList.add('is-crashing');
    setTimeout(() => dom.board.classList.remove('is-crashing'), 700);
    if (util.reducedMotion()) return;
    const tiles = Game.board.filter((t) => t.type === 'property').map((t) => t.id);
    util.shuffle(tiles).slice(0, 7).forEach((id, i) => {
      setTimeout(() => flashDisaster(id), i * 55);
    });
  }

  /* ============================================================
     操作面板
     ============================================================ */
  function loanButtons(p) {
    const buttons = [];
    if (!p.loanTaken) {
      const principal = Game.loanAmount();
      const owed = Math.round(principal * (1 + D.CONFIG.loanInterest));
      buttons.push(`<button class="action-btn action-btn--loan" data-act="loan" type="button">
        <span class="action-btn__main"><strong>银行贷款</strong><small>一局一次 · 立即到账 ${util.fmt(principal)}，赛程结束偿还 ${util.fmt(owed)}</small></span>
        <span class="action-btn__side">×1</span>
      </button>`);
    } else if (p.loanOwed > 0 && p.tokens >= p.loanOwed) {
      buttons.push(`<button class="action-btn action-btn--loan" data-act="repay" type="button">
        <span class="action-btn__main"><strong>提前还贷</strong><small>还清银行贷款，总资产不再被扣减</small></span>
        <span class="action-btn__side">${util.fmt(p.loanOwed)}</span>
      </button>`);
    }
    return buttons;
  }

  function renderActions() {
    const st = Game.state;
    if (!st) return;
    const p = Game.current();
    if (!p) return;

    if (st.over) {
      dom.turnState.textContent = '比赛结束';
      dom.actionButtons.innerHTML = '<div class="action-empty">比赛已经结束，等待结算。</div>';
      dom.actionHint.textContent = '';
      return;
    }

    const isAI = !p.isHuman;
    const local = isLocalTurn();
    dom.turnState.className = 'turn-state';
    if (isAI) {
      dom.turnState.classList.add('is-ai');
      dom.turnState.textContent = 'AI 行动中';
    } else if (p.inJail) {
      dom.turnState.classList.add('is-banned');
      dom.turnState.textContent = '暴力禁赛中';
    } else if (!local) {
      dom.turnState.classList.add('is-lan');
      dom.turnState.textContent = '等待 ' + p.name;
    } else if (st.phase === 'roll') {
      dom.turnState.textContent = isGuest() ? '你的回合 · 联机' : '等待掷骰';
    } else {
      dom.turnState.textContent = '行动阶段';
    }

    if (isAI) {
      dom.actionButtons.innerHTML = '<div class="action-empty">对手正在计算最优解……<br>你可以点击地块查看行情。</div>';
      dom.actionHint.textContent = p.inJail ? '对手正在为暴力代码写申诉信。' : '等待对手掷骰与建造。';
      return;
    }

    if (!local) {
      dom.actionButtons.innerHTML = `<div class="action-empty">${isGuest() ? '等待房主和队友行动……' : '等待联机选手操作……'}<br>当前由 <b>${util.escapeHtml(p.name)}</b> 行动。</div>`;
      dom.actionHint.textContent = isGuest() ? '轮到你时，操作按钮会自动出现。' : '客机操作会在房主电脑上结算。';
      return;
    }

    if (awaiting) {
      dom.actionButtons.innerHTML = '<button class="action-btn" type="button" disabled><span class="action-btn__main"><strong>等待房主结算…</strong><small>操作已发送，正在同步局面</small></span></button>';
      dom.actionHint.textContent = '联机模式下由房主掷骰与结算。';
      return;
    }

    if (busy) {
      dom.actionButtons.innerHTML = '<button class="action-btn" type="button" disabled><span class="action-btn__main"><strong>处理中…</strong><small>正在结算本次行动</small></span></button>';
      dom.actionHint.textContent = '骰子还在滚动。';
      return;
    }

    if (st.phase === 'jail' && p.inJail) {
      const fine = st.jailFine;
      const canPay = p.tokens >= fine;
      const buttons = [];
      if (p.getOut > 0) {
        buttons.push(`<button class="action-btn action-btn--gold" data-act="jail-card" type="button">
          <span class="action-btn__main"><strong>使用申诉信</strong><small>立即离开禁赛区，不花钱</small></span>
          <span class="action-btn__side">×${p.getOut}</span>
        </button>`);
      }
      buttons.push(`<button class="action-btn action-btn--primary" data-act="jail-roll" type="button">
        <span class="action-btn__main"><strong>掷骰申诉</strong><small>掷出双数即可离开，否则多停一回合</small></span>
        <span class="action-btn__key">SPACE</span>
      </button>`);
      buttons.push(`<button class="action-btn" data-act="jail-pay" type="button" ${canPay ? '' : 'disabled'}>
        <span class="action-btn__main"><strong>缴纳罚金</strong><small>${canPay ? '立刻离开禁赛区，然后正常掷骰' : 'token 不足，无法缴纳'}</small></span>
        <span class="action-btn__side">${util.fmt(fine)}</span>
      </button>`);
      buttons.push(`<button class="action-btn action-btn--danger" data-act="end" type="button">
        <span class="action-btn__main"><strong>放弃申诉</strong><small>保留在禁赛区，结束本回合</small></span>
      </button>`);
      dom.actionButtons.innerHTML = buttons.join('');
      dom.actionHint.innerHTML = `写暴力被抓。还剩 <b>${D.CONFIG.jailTurns - p.jailTurns}</b> 次申诉机会；三次失败会被强制缴纳罚金。`;
      return;
    }

    if (st.phase === 'roll') {
      const buttons = [`<button class="action-btn action-btn--primary" data-act="roll" type="button">
          <span class="action-btn__main"><strong>掷骰子</strong><small>两颗 d6，沿棋盘前进</small></span>
          <span class="action-btn__key">SPACE</span>
        </button>`];
      buttons.push(...loanButtons(p));
      dom.actionButtons.innerHTML = buttons.join('');
      dom.actionHint.innerHTML = st.doubles > 0
        ? `双数奖励：本回合已掷 <b>${st.doubles}</b> 次双数。`
        : `经过 AK 起点领取 ${util.fmt(st.salary)} token；双数可以再掷一次。`;
      return;
    }

    /* 行动阶段 */
    if (pendingBuy != null) {
      const tile = Game.board[pendingBuy];
      const afford = p.tokens >= tile.price;
      const isFacility = tile.type === 'facility';
      const buttons = [`<button class="action-btn action-btn--gold" data-act="buy" type="button" ${afford ? '' : 'disabled'}>
          <span class="action-btn__main"><strong>买下【${tile.name}】</strong><small>${afford ? (isFacility ? '算力设施的过路费随持有数量上涨' : '装入资产表，向路过的同学收租') : 'token 不足'}</small></span>
          <span class="action-btn__side">${util.fmt(tile.price)}</span>
        </button>
        <button class="action-btn" data-act="skip-buy" type="button">
          <span class="action-btn__main"><strong>放弃购买</strong><small>这块地会留在题库里</small></span>
        </button>`];
      if (!afford) buttons.push(...loanButtons(p));
      dom.actionButtons.innerHTML = buttons.join('');
      dom.actionHint.textContent = isFacility
        ? `算力设施没有建筑位；过路费 = ${st.facilityBase} × 骰子点数 × 你持有的设施数。`
        : '停在这里才能购买；大棋盘上按章节持有比例加成，集齐仍然 ×2。';
      return;
    }

    if (pendingUpgrade != null) {
      const tile = Game.board[pendingUpgrade];
      const prop = st.props[pendingUpgrade];
      const level = prop.algos.length;
      const cost = Game.upgradeCost(pendingUpgrade);
      const afford = p.tokens >= cost;
      const nextAlgo = tile.algoSet[level];
      const nextRent = Game.rentTable(pendingUpgrade)[Math.min(4, level + 1)];
      const verb = level === 0 ? '建造' : '升级';
      const buttons = [`<button class="action-btn action-btn--gold" data-act="upgrade" type="button" ${afford ? '' : 'disabled'}>
          <span class="action-btn__main"><strong>${verb} Lv.${level + 1}【${util.escapeHtml(nextAlgo ? nextAlgo.name : '算法建筑')}】</strong><small>${afford ? `租金 ${util.fmt(Game.rentFor(pendingUpgrade, 7))} → ${util.fmt(nextRent)} token` : 'token 不足，先去收租'}</small></span>
          <span class="action-btn__side">${util.fmt(cost)}</span>
        </button>
        <button class="action-btn" data-act="skip-upgrade" type="button">
          <span class="action-btn__main"><strong>暂时不动</strong><small>保留 token，建筑维持 Lv.${level}</small></span>
        </button>
        <button class="action-btn" data-act="end" type="button">
          <span class="action-btn__main"><strong>结束回合</strong><small>交给下一位选手</small></span>
          <span class="action-btn__key">↩</span>
        </button>`];
      if (!afford) buttons.splice(1, 0, ...loanButtons(p));
      dom.actionButtons.innerHTML = buttons.join('');
      dom.actionHint.innerHTML = `停在自家【${util.escapeHtml(tile.name)}】上，可以直接加盖。升级费用随层数递增，拆除只返还 <b>50%</b>。`;
      return;
    }

    const buildables = Game.ownedTiles(p.id).filter((t) => Game.canBuild(p, t.id));
    const canReroll = st.lastRoll && st.lastRoll.double && st.doubles > 0 && st.doubles < 3 && !p.inJail;
    const buttons = [];

    if (canReroll) {
      buttons.push(`<button class="action-btn action-btn--primary" data-act="roll" type="button">
        <span class="action-btn__main"><strong>再掷一次</strong><small>双数奖励，本回合还可以行动</small></span>
        <span class="action-btn__key">SPACE</span>
      </button>`);
    }

    if (buildables.length) {
      buttons.push(`<button class="action-btn action-btn--gold" data-act="build-menu" type="button">
        <span class="action-btn__main"><strong>建造 / 升级算法建筑</strong><small>${buildables.length} 块地可以加盖，租金立刻上涨</small></span>
        <span class="action-btn__side">${buildables.length}</span>
      </button>`);
    }

    buttons.push(...loanButtons(p));

    buttons.push(`<button class="action-btn ${canReroll ? '' : 'action-btn--primary'}" data-act="end" type="button">
      <span class="action-btn__main"><strong>结束回合</strong><small>${canReroll ? '放弃双数奖励，交给下一位' : '结算完成，交给下一位选手'}</small></span>
      <span class="action-btn__key">↩</span>
    </button>`);

    dom.actionButtons.innerHTML = buttons.join('');
    if (p.inJail) {
      dom.actionHint.textContent = '写暴力被禁赛，本回合只能结束。下回合可以继续申诉。';
    } else if (buildables.length) {
      dom.actionHint.innerHTML = '点击地块查看租金表；<b>走到自家建筑上</b>可以直接升级。算法联动会额外提高租金。';
    } else {
      dom.actionHint.textContent = '点击棋盘上的地块，可以查看建筑层数、租金和抵押状态。';
    }
  }

  function guestSend(payload) {
    if (awaiting) return;
    awaiting = true;
    awaitingSince = Date.now();
    awaitingTurn = Game.state ? Game.state.turnSerial : -1;
    sound.play('click');
    net.sendAction(payload).catch((err) => {
      awaiting = false;
      toast('操作发送失败：' + (err && err.message ? err.message : '网络错误'), 'bad');
      renderActions();
    });
    renderActions();
  }

  const GUEST_ACTION_MAP = {
    roll: 'roll', end: 'end', buy: 'buy', 'skip-buy': 'skipBuy',
    upgrade: 'upgrade', 'skip-upgrade': 'skipUpgrade',
    'jail-roll': 'jailRoll', 'jail-pay': 'jailPay', 'jail-card': 'jailCard',
    loan: 'loan', repay: 'repay'
  };

  function onActionClick(e) {
    const btn = e.target.closest('button[data-act]');
    if (!btn || btn.disabled) return;
    const act = btn.dataset.act;
    sound.play('click');
    if (isGuest()) {
      if (act === 'build-menu') { openBuildMenu(); return; }
      if (GUEST_ACTION_MAP[act]) guestSend({ t: GUEST_ACTION_MAP[act] });
      return;
    }
    switch (act) {
      case 'roll': humanRoll(); break;
      case 'end': humanEndTurn(); break;
      case 'buy': humanBuy(); break;
      case 'skip-buy': humanSkipBuy(); break;
      case 'upgrade': humanUpgrade(); break;
      case 'skip-upgrade': humanSkipUpgrade(); break;
      case 'build-menu': openBuildMenu(); break;
      case 'jail-roll': humanJailRoll(); break;
      case 'jail-pay': humanJailPay(); break;
      case 'jail-card': humanJailCard(); break;
      case 'loan': humanLoan(); break;
      case 'repay': humanRepay(); break;
      default: break;
    }
  }

  /* ============================================================
     提示 / 浮动数值
     ============================================================ */
  function toast(message, type) {
    const el = document.createElement('div');
    el.className = `toast toast--${type || 'info'}`;
    el.innerHTML = message;
    dom.toastRoot.appendChild(el);
    setTimeout(() => {
      el.classList.add('is-out');
      setTimeout(() => el.remove(), 320);
    }, 2800);
  }

  function floatAt(tileId, text, bad) {
    const tile = tileEls[tileId];
    if (!tile) return;
    const r = tile.getBoundingClientRect();
    const el = document.createElement('span');
    el.className = `float-token${bad ? ' is-bad' : ''}`;
    el.textContent = text;
    el.style.left = (r.left + r.width / 2) + 'px';
    el.style.top = (r.top + r.height / 2) + 'px';
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 1250);
  }

  function hexA(hex, alpha) {
    const m = /^#?([a-f0-9]{6})$/i.exec(String(hex));
    if (!m) return `rgba(79,240,192,${alpha})`;
    const n = parseInt(m[1], 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
  }

  /* ============================================================
     回合流程
     ============================================================ */
  function beginTurn() {
    clearTimeout(aiTimer);
    clearTimeout(remoteTurnTimer);
    remoteTurnTimer = null;
    const st = Game.state;
    if (!st) return;
    if (st.over) { showEnd(st.endReason); return; }

    pendingBuy = null;
    pendingUpgrade = null;
    awaiting = false;
    const p = Game.current();
    st.phase = p.inJail ? 'jail' : 'roll';
    if (p.isHuman && !p.remote) {
      busy = false;
      refresh();
      updateCenter(p.pos, false);
      dom.diceVerdict.textContent = p.inJail ? '禁赛申诉中' : '等待掷骰';
    } else if (p.isHuman && p.remote) {
      busy = false;
      refresh();
      updateCenter(p.pos, false);
      dom.diceVerdict.textContent = `等待 ${p.name}`;
      remoteTurnTimer = setTimeout(() => {
        if (!Game.state || Game.state.over) return;
        if (Game.current() && Game.current().id === p.id && p.remote) {
          Game.log(`${p.name} 长时间没有操作，自动结束回合。`, 'warn');
          toast(`${p.name} 操作超时，已自动结束回合。`, 'warn');
          finishTurn(true);
        }
      }, 90000);
    } else {
      busy = true;
      refresh();
      dom.diceVerdict.textContent = p.inJail ? '对手申诉中' : '对手掷骰中';
      aiTimer = setTimeout(aiPlay, 820);
    }
  }

  async function humanRoll() {
    const st = Game.state;
    if (!st || st.over || busy) return;
    const p = Game.current();
    const canRollAgain = st.phase === 'action' && st.lastRoll && st.lastRoll.double && st.doubles > 0 && st.doubles < 3 && !p.inJail;
    if (!p || !p.isHuman || (st.phase !== 'roll' && !canRollAgain) || p.inJail) return;

    busy = true;
    pendingBuy = null;
    pendingUpgrade = null;
    st.phase = 'roll';
    renderActions();
    try {
      const roll = Game.roll();
      Game.log(`${p.name} 掷出 ${roll.a} + ${roll.b} = ${roll.total}${roll.double ? '（双数）' : ''}。`, 'info');
      updateLog();
      await animateDice(roll.a, roll.b);

      if (st.doubles >= 3) {
        Game.sendToJail(p, '连续三次双数，被判定为随机化暴力');
        sound.play('jail');
        unlock('brute');
        toast('连续三次双数，裁判怀疑你在用随机化暴力，把你请进了禁赛区。', 'bad');
        st.phase = 'action';
        updateTopbar();
        updateBoard();
        updateRoster();
        updateTurnCard();
        layoutPawns();
        return;
      }

      await animateMove(p, roll.total);
      await resolveLanding(p);
    } catch (err) {
      console.error(err);
      toast('结算出了点问题，已跳过本次行动。', 'bad');
    } finally {
      busy = false;
      if (!Game.state.over) Game.state.phase = 'action';
      refresh();
      checkAchievements();
      if (Game.state.over) showEnd(Game.state.endReason);
    }
  }

  async function animateMove(player, steps) {
    for (let i = 0; i < steps; i++) {
      const step = Game.stepForward(player);
      layoutPawns();
      sound.play('step');
      if (step.salary) {
        Game.log(`${player.name} 经过 AK 起点，领取 ${util.fmt(step.salary)} token。`, 'good');
        floatAt(player.pos, '+' + util.fmt(step.salary), false);
        updateTopbar();
        updateTurnCard();
        updateRoster();
        updateLog();
      }
      await util.sleep(util.reducedMotion() ? 28 : 145);
    }
    updateBoard();
    updateCenter(player.pos, true);
    highlightTile(player.pos);
    await util.sleep(util.reducedMotion() ? 30 : 130);
  }

  async function resolveLanding(player, depth) {
    depth = depth || 0;
    if (depth > 4) return;
    const st = Game.state;
    const landing = Game.describeLanding(player);
    if (!landing || !landing.tile) return;
    updateCenter(player.pos, true);
    highlightTile(player.pos);

    switch (landing.kind) {
      case 'property': {
        if (landing.action === 'buy') {
          if (player.isHuman) {
            pendingBuy = landing.tile.id;
            Game.log(`停在了无主的【${landing.tile.name}】前，售价 ${util.fmt(landing.price)} token。`, 'info');
            st.phase = 'action';
          } else {
            await util.sleep(360);
            if (Game.aiShouldBuy(player, landing.tile)) {
              Game.buy(player, landing.tile.id);
              sound.play('buy');
              toast(`${player.name} 买下了【${landing.tile.name}】。`, 'info');
            } else {
              Game.log(`${player.name} 放弃了【${landing.tile.name}】。`, 'info');
            }
            sound.play('click');
          }
        } else if (landing.action === 'rent') {
          const owner = landing.owner;
          const amount = landing.amount;
          flashRent(player, landing.tile.id, amount, owner);
          const res = Game.payRent(player, landing.tile.id, st.lastRoll ? st.lastRoll.total : 7);
          sound.play('rent');
          if (res && res.bankrupt) {
            toast(`${player.name} 付不起租金，破产退役。`, 'bad');
            if (shouldEndLocal(player)) scheduleEnd('bankrupt');
          } else if (res) {
            toast(`${label(player)} 向 ${owner.name} 支付 ${util.fmt(res.paid)} token 租金。`, player.isHuman ? 'bad' : 'warn');
          }
        } else if (landing.action === 'mortgaged') {
          Game.log(`【${landing.tile.name}】已被 ${landing.owner.name} 抵押，本次免租。`, 'info');
        } else if (landing.canUpgrade) {
          if (player.isHuman) {
            pendingUpgrade = landing.tile.id;
            st.phase = 'action';
            Game.log(`停在自己的【${landing.tile.name}】上，可以升级 Lv.${landing.level + 1} 算法建筑（${util.fmt(landing.cost)} token）。`, 'info');
            toast(`走到自家【${landing.tile.name}】，可以升级建筑。`, 'info');
          } else {
            Game.log(`${player.name} 停在自己的【${landing.tile.name}】上，检查了一下 Lv.${landing.level} 建筑。`, 'info');
          }
        } else if (landing.atMax) {
          Game.log(`【${landing.tile.name}】已经盖满 4 层，满配收租。`, 'info');
        } else {
          Game.log(`${player.name} 停在自己的【${landing.tile.name}】上，token 不足以继续加盖。`, 'info');
        }
        break;
      }
      case 'card': {
        await handleCard(player, landing.deck, depth);
        break;
      }
      case 'tax': {
        const res = Game.payTax(player, landing.amount);
        sound.play('rent');
        floatAt(landing.tile.id, '-' + util.fmt(res.paid), true);
        toast(`${label(player)} 缴纳罚时费 ${util.fmt(res.paid)} token。`, 'bad');
        if (res.bankrupt && shouldEndLocal(player)) scheduleEnd('bankrupt');
        break;
      }
      case 'parking': {
        const amount = st.pot;
        if (amount > 0) {
          st.pot = 0;
          Game.gain(player, amount);
          Game.log(`${player.name} 在 AK 休息室拿走了罚时池里的 ${util.fmt(amount)} token。`, 'good');
          sound.play('good');
          floatAt(landing.tile.id, '+' + util.fmt(amount), false);
          toast(`${label(player)} 拿走了罚时池的 ${util.fmt(amount)} token！`, 'good');
        } else {
          Game.log(`${player.name} 在 AK 休息室休息了一会儿。`, 'info');
        }
        break;
      }
      case 'jail': {
        if (landing.goto) {
          Game.sendToJail(player, '被裁判查到写暴力（三重循环）');
          sound.play('jail');
          if (player.isHuman) unlock('brute');
          toast(`${label(player)} 写暴力被裁判抓包，送进禁赛区。`, 'bad');
          st.phase = 'action';
        } else {
          Game.log(`${player.name} 来禁赛区探监，顺便看望了一下老队友。`, 'info');
        }
        break;
      }
      case 'go': {
        Game.log(`${player.name} 停在 AK 起点。`, 'info');
        break;
      }
      default: break;
    }

    refresh();
    checkAchievements();

    if (!player.alive) {
      if (shouldEndLocal(player)) scheduleEnd('bankrupt');
      else if (Game.state.over) showEnd();
    } else if (Game.state.over) {
      showEnd(Game.state.endReason);
    }
  }

  function flashRent(player, tileId, amount, owner) {
    if (!player.isHuman) return;
    floatAt(tileId, '-' + util.fmt(amount), true);
    updateTurnCard();
  }

  /* ---------------- 玩家操作 ---------------- */
  function humanBuy() {
    if (busy || pendingBuy == null || !Game.state || Game.state.over) return;
    const tile = Game.board[pendingBuy];
    const p = Game.current();
    if (Game.buy(p, tile.id)) {
      sound.play('buy');
      toast(`买下【${tile.name}】，现在它属于你了。`, 'good');
      pendingBuy = null;
      checkAchievements();
      refresh();
      updateCenter(tile.id, true);
    } else {
      toast('token 不足，买不起这块地。', 'bad');
    }
  }

  function humanSkipBuy() {
    if (busy || pendingBuy == null) return;
    const tile = Game.board[pendingBuy];
    Game.log(`你放弃了【${tile.name}】。`, 'info');
    pendingBuy = null;
    refresh();
  }

  function humanUpgrade() {
    if (busy || pendingUpgrade == null || !Game.state || Game.state.over) return;
    const tile = Game.board[pendingUpgrade];
    const p = Game.current();
    if (!p || !p.isHuman) return;
    const algo = Game.build(p, tile.id);
    if (!algo) {
      toast('token 不足，先攒点钱再来加盖。', 'bad');
      pendingUpgrade = null;
      refresh();
      return;
    }
    sound.play('build');
    const level = Game.state.props[tile.id].algos.length;
    toast(`【${tile.name}】升到 Lv.${level}【${algo.name}】，现在收租 ${util.fmt(Game.rentFor(tile.id, 7))} token。`, 'good');
    highlightBuild(tile.id);
    checkAchievements();
    refresh();
    updateCenter(tile.id, true);
    if (!Game.canBuild(p, tile.id)) {
      pendingUpgrade = null;
      if (level >= D.CONFIG.maxAlgos) toast(`【${tile.name}】已经盖满 4 层，满配！`, 'achievement');
      refresh();
    }
  }

  function humanSkipUpgrade() {
    if (busy || pendingUpgrade == null) return;
    const tile = Game.board[pendingUpgrade];
    Game.log(`你没有继续升级【${tile.name}】。`, 'info');
    pendingUpgrade = null;
    refresh();
  }

  async function humanJailRoll() {
    const st = Game.state;
    if (!st || st.over || busy) return;
    const p = Game.current();
    if (!p.isHuman || st.phase !== 'jail') return;
    busy = true;
    renderActions();
    try {
      const res = Game.jailRoll(p);
      await animateDice(res.roll.a, res.roll.b);
      if (res.freed) {
        sound.play('freed');
        toast('申诉成功！掷出双数，离开禁赛区。', 'good');
        unlock('jailbreak');
        await animateMove(p, res.roll.total);
        await resolveLanding(p);
      } else if (res.forced) {
        toast('三次申诉失败，强制缴纳罚金后离开。', 'warn');
        st.phase = 'action';
        if (res.bankrupt) scheduleEnd('bankrupt');
      } else {
        st.phase = 'action';
      }
    } catch (err) {
      console.error(err);
    } finally {
      busy = false;
      refresh();
      checkAchievements();
      if (Game.state.over) showEnd(Game.state.endReason);
    }
  }

  function humanJailPay() {
    const st = Game.state;
    if (!st || st.over || busy) return;
    const p = Game.current();
    if (!p.isHuman || st.phase !== 'jail') return;
    const res = Game.payJailFine(p);
    if (res) {
      sound.play('buy');
      toast(`缴纳 ${util.fmt(res.paid)} token 罚金，恢复比赛资格。`, 'warn');
      st.phase = 'roll';
      refresh();
      updateCenter(p.pos, true);
    }
  }

  function humanJailCard() {
    const st = Game.state;
    if (!st || st.over || busy) return;
    const p = Game.current();
    if (!p.isHuman || st.phase !== 'jail') return;
    if (Game.useGetOut(p)) {
      sound.play('freed');
      toast('使用「申诉信」，你重新获得了比赛资格。', 'good');
      st.phase = 'roll';
      refresh();
    }
  }

  function humanLoan() {
    const st = Game.state;
    if (!st || st.over || busy) return;
    const p = Game.current();
    if (!p || !p.isHuman) return;
    const res = Game.takeLoan(p);
    if (!res) { toast('本次对局已经用过银行贷款了。', 'warn'); return; }
    sound.play('buy');
    toast(`🏦 获得银行贷款 ${util.fmt(res.principal)} token，赛程结束需偿还 ${util.fmt(res.owed)} token。`, 'warn');
    checkAchievements();
    refresh();
  }

  function humanRepay() {
    const st = Game.state;
    if (!st || st.over || busy) return;
    const p = Game.current();
    if (!p || !p.isHuman) return;
    const paid = Game.repayLoan(p);
    if (!paid) { toast('token 不足，暂时无法还清贷款。', 'warn'); return; }
    sound.play('good');
    toast(`🏦 已还清贷款 ${util.fmt(paid)} token，总资产不再扣减。`, 'good');
    refresh();
  }

  function humanEndTurn() {
    if (busy || !Game.state || Game.state.over) return;
    pendingBuy = null;
    pendingUpgrade = null;
    finishTurn(true);
  }

  /* ---------------- 回合推进 ---------------- */
  function finishTurn(force) {
    if (!Game.state || Game.state.over) {
      if (Game.state && Game.state.over) showEnd(Game.state.endReason);
      return;
    }
    clearTimeout(remoteTurnTimer);
    remoteTurnTimer = null;
    busy = false;
    awaiting = false;
    pendingBuy = null;
    pendingUpgrade = null;
    const res = Game.endTurn(force);

    if (res.finished) { showEnd(res.reason); return; }

    if (res.same) {
      toast('双数奖励：再掷一次。', 'good');
      beginTurn();
      return;
    }

    if (res.eraChanged) {
      toast(`🕒 进入${Game.eraLabel(Game.state.era)}，随机事件会更频繁。`, 'info');
    }
    if (res.timed) {
      announceTimedEvent(res.timed);
    }
    if (res.wrapped) {
      const news = Game.nextRoundNews();
      if (news) announceNews(news.news.text);
      Game.log(`—— 第 ${Game.state.round} 回合 ——`, 'system');
    }

    beginTurn();
  }

  function announceTimedEvent(timed) {
    const st = Game.state;
    const ev = timed.event;
    if (!st || !ev) return;
    const text = `🕒 ${ev.title}：${timed.result.summary}`;
    st.headline = text;
    st.headlineRound = st.round;
    dom.tickerText.textContent = text;
    dom.tickerText.classList.remove('is-fresh');
    void dom.tickerText.offsetWidth;
    dom.tickerText.classList.add('is-fresh');
    sound.play(timed.event.tone === 'bad' ? 'bad' : 'news');
    toast(`${ev.icon} 时局事件 · ${ev.title}<br><span style="color:#91a8a3;font-size:10px">${util.escapeHtml(timed.result.summary)}</span>`, timed.event.tone === 'bad' ? 'bad' : 'info');
  }

  function announceNews(text) {
    const st = Game.state;
    if (st) {
      st.headline = text;
      st.headlineRound = st.round;
    }
    dom.tickerText.textContent = text;
    dom.tickerText.classList.remove('is-fresh');
    void dom.tickerText.offsetWidth;
    dom.tickerText.classList.add('is-fresh');
    sound.play('news');
    toast('📡 ' + text, 'info');
  }

  /* ---------------- AI ---------------- */
  async function aiPlay() {
    const st = Game.state;
    if (!st || st.over) return;
    const p = Game.current();
    if (!p || !p.isAI) { busy = false; refresh(); return; }

    try {
      if (p.inJail) {
        await aiJailTurn(p);
      } else {
        await aiMoveTurn(p);
      }

      if (Game.state.over) { busy = false; showEnd(); return; }
      if (!p.alive) {
        if (Game.state.over) { busy = false; showEnd(); return; }
      }

      if (p.alive && !p.inJail) {
        aiManage(p);
        await util.sleep(420);
      }

      await util.sleep(480);
      if (Game.state.over) { busy = false; showEnd(); return; }
      finishTurn();
    } catch (err) {
      console.error(err);
      busy = false;
      refresh();
    }
  }

  async function aiJailTurn(p) {
    const choice = Game.aiJailChoice(p);
    if (choice === 'card' && p.getOut > 0) {
      Game.useGetOut(p);
      toast(`${p.name} 使用了一张申诉信。`, 'info');
      refresh();
      await util.sleep(520);
      await aiMoveTurn(p);
      return;
    }
    if (choice === 'pay' && p.tokens >= Game.state.jailFine) {
      Game.payJailFine(p);
      toast(`${p.name} 缴纳罚金，恢复了比赛资格。`, 'info');
      refresh();
      await util.sleep(520);
      await aiMoveTurn(p);
      return;
    }

    const res = Game.jailRoll(p);
    await animateDice(res.roll.a, res.roll.b);
    if (res.freed) {
      sound.play('freed');
      toast(`${p.name} 掷出双数，申诉成功。`, 'info');
      refresh();
      await animateMove(p, res.roll.total);
      await resolveLanding(p);
    } else if (res.forced) {
      toast(`${p.name} 三次申诉失败，被强制缴纳罚金。`, 'info');
      refresh();
    } else {
      refresh();
    }
  }

  async function aiMoveTurn(p) {
    const st = Game.state;
    const roll = Game.roll();
    Game.log(`${p.name} 掷出 ${roll.a} + ${roll.b} = ${roll.total}${roll.double ? '（双数）' : ''}。`, 'info');
    updateLog();
    await animateDice(roll.a, roll.b);

    if (st.doubles >= 3) {
      Game.sendToJail(p, '连续三次双数，被判定为随机化暴力');
      sound.play('jail');
      toast(`${p.name} 连续三次双数，被判定为随机化暴力，送进禁赛区。`, 'info');
      refresh();
      return;
    }

    await animateMove(p, roll.total);
    await resolveLanding(p);
  }

  function aiManage(p) {
    if (!p.alive) return;
    Game.aiLoan(p);
    const target = Game.aiBuildChoice(p);
    if (!target) return;
    const algo = Game.build(p, target.id);
    if (algo) {
      sound.play('build');
      const level = Game.state.props[target.id].algos.length;
      toast(`${p.name} 把【${target.name}】升到了 Lv.${level}【${algo.name}】。`, 'info');
      refresh();
    }
  }

  /* ---------------- 事件卡 ---------------- */
  async function handleCard(player, deckName, depth) {
    const card = Game.drawCard(deckName);
    if (!card) return;
    player.stats.cards += 1;
    Game.log(`${player.name} 抽到${deckName === 'chance' ? '随机事件' : 'OJ 公告'}【${card.title}】。`, 'card');
    refresh();
    sound.play('card');

    if (player.isHuman && !player.remote && !isGuest()) {
      await showCardModal(card, deckName);
    } else {
      toast(`${player.name}：${card.title}`, 'info');
      await util.sleep(620);
    }

    const result = Game.applyCard(player, card);
    refresh();
    checkAchievements();

    if (result.market) {
      announceNews(`市场行情：${result.market.groupName} 租金 ×${result.market.mult.toFixed(2)}`);
    }
    if (result.jailed) {
      sound.play('jail');
      if (player.isHuman) unlock('brute');
    }
    if (result.machineCrash) {
      crashBoard();
      sound.play('jail');
      if (player.isHuman) unlock('machine_crash');
      const lost = result.machineCrash.filter((r) => r.tile).length;
      toast(`🔌 机房惨案！全场 ${lost} 层算法建筑短路损坏。`, 'bad');
    }
    if (result.destroyed) {
      if (player.isHuman) unlock('machine_crash');
      if (result.destroyed.tile) {
        flashDisaster(result.destroyed.tile.id);
        toast(`【${result.destroyed.tile.name}】的 Lv.${result.destroyed.level} 建筑被泡坏了。`, 'bad');
      } else if (result.destroyed.paid > 0) {
        toast(`没有建筑可损坏，赔偿 ${util.fmt(result.destroyed.paid)} token。`, 'bad');
      }
    }
    if (card.effect.type === 'gainPerBuild' && result.amount > 0) {
      toast(`按建筑层数结算，收入 ${util.fmt(result.amount)} token。`, 'good');
      sound.play('good');
    }
    if (Game.state.over) { showEnd(Game.state.endReason); return; }

    if (result.moveTo != null) {
      const salary = Game.teleport(player, result.moveTo, result.salary);
      layoutPawns();
      updateCenter(player.pos, true);
      highlightTile(player.pos);
      if (salary) {
        Game.log(`${player.name} 回到 AK 起点，领取 ${util.fmt(salary)} token。`, 'good');
        floatAt(player.pos, '+' + util.fmt(salary), false);
      }
      refresh();
      await util.sleep(util.reducedMotion() ? 60 : 680);
      await resolveLanding(player, depth + 1);
    } else if (result.moveBy) {
      await animateMove(player, result.moveBy);
      await resolveLanding(player, depth + 1);
    }

    if (shouldEndLocal(player) && !player.alive) scheduleEnd('bankrupt');
    if (Game.state.over) showEnd(Game.state.endReason);
  }

  function scheduleEnd(reason) {
    if (endingTimer) return;
    endingTimer = setTimeout(() => {
      endingTimer = null;
      showEnd(reason);
    }, 900);
  }

  /* ---------------- 自动演示 / 测试 ---------------- */
  function startAutopilot() {
    if (autoTimer) return;
    autoTimer = setInterval(autopilotTick, 850);
  }

  function stopAutopilot() {
    if (autoTimer) clearInterval(autoTimer);
    autoTimer = null;
  }

  function autopilotTick() {
    const st = Game.state;
    if (!st || st.over || endShown) { stopAutopilot(); return; }
    const p = Game.current();
    if (!p || !p.isHuman || busy) return;

    if (st.phase === 'jail') {
      if (p.getOut > 0) humanJailCard();
      else if (p.tokens > Game.state.jailFine + 8000) humanJailPay();
      else humanJailRoll();
      return;
    }
    if (st.phase === 'roll') { humanRoll(); return; }
    if (pendingBuy != null) {
      const tile = Game.board[pendingBuy];
      const completes = Game.groupProgress(p.id, tile.group) >= 1;
      if (p.tokens >= tile.price && (completes || p.tokens - tile.price > 3500)) humanBuy();
      else humanSkipBuy();
      return;
    }
    if (pendingUpgrade != null) {
      const cost = Game.upgradeCost(pendingUpgrade);
      if (p.tokens >= cost && p.tokens - cost > 2500) humanUpgrade();
      else humanSkipUpgrade();
      return;
    }
    const buildables = Game.ownedTiles(p.id).filter((t) => Game.canBuild(p, t.id));
    if (buildables.length) {
      Game.build(p, buildables[0].id);
      sound.play('build');
      refresh();
      return;
    }
    humanEndTurn();
  }

  /* ---------------- 成就 ---------------- */
  function unlock(id) {
    const def = D.ACHIEVEMENTS.find((a) => a.id === id);
    if (!def) return;
    const list = storage.get(D.STORAGE.achievements, []) || [];
    if (list.indexOf(id) >= 0) return;
    list.push(id);
    storage.set(D.STORAGE.achievements, list);
    toast(`🏆 成就解锁 · ${def.name}<br><span style="color:#91a8a3;font-size:10px">${def.desc}</span>`, 'achievement');
    sound.play('achievement');
    updateAchieveBadge();
  }

  function updateAchieveBadge() {
    const list = storage.get(D.STORAGE.achievements, []) || [];
    const count = list.filter((id) => D.ACHIEVEMENTS.some((a) => a.id === id)).length;
    dom.achieveBtn.title = `成就 ${count}/${D.ACHIEVEMENTS.length}`;
    dom.achieveBtn.setAttribute('aria-label', `查看成就，已解锁 ${count} 个`);
  }

  function checkAchievements() {
    if (!Game.state) return;
    const human = me();
    if (!human) return;
    if (human.stats.buys >= 1) unlock('first_buy');
    if (human.stats.builds >= 10) unlock('builder');
    if (human.stats.cards >= 5) unlock('cards');
    if (human.tokens >= 50000) unlock('rich');
    if (human.loanTaken) unlock('loan');
    if (D.GROUP_ORDER.some((g) => Game.ownsGroup(human.id, g))) unlock('monopoly');
    const maxed = Game.ownedTiles(human.id).some((t) => Game.state.props[t.id].algos.length >= 4);
    if (maxed) unlock('full_stack');
    if (Game.activeSynergies(human.id).length) unlock('synergy');
    if (plateFor(human).id === 'prism') unlock('prism');
  }


  /* ============================================================
     弹窗系统
     ============================================================ */
  function openModal(opts) {
    const o = opts || {};
    if (modalClose) {
      const prev = modalClose;
      modalClose = null;
      prev(null);
    }
    const classes = ['modal'];
    if (o.wide) classes.push('modal--wide');
    if (o.className) classes.push(o.className);

    const actions = o.actions || [];
    const actionsHtml = actions.length
      ? `<div class="modal__actions">${actions.map((a) => {
        const dis = a.disabled ? ' disabled' : '';
        const attr = a.value == null ? 'data-close' : `data-value="${util.escapeHtml(String(a.value))}"`;
        return `<button class="btn ${a.className || 'btn--ghost'}" type="button" ${attr}${dis}>${a.label}</button>`;
      }).join('')}</div>`
      : '';
    const closeBtn = o.closable === false ? ''
      : '<button class="modal__close" type="button" data-close aria-label="关闭"><svg class="icon"><use href="#i-close"></use></svg></button>';

    dom.modalRoot.innerHTML = `<div class="${classes.join(' ')}" role="dialog" aria-modal="true">${closeBtn}${o.html || ''}${actionsHtml}</div>`;
    dom.modalRoot.hidden = false;
    document.body.classList.add('is-modal');

    return new Promise((resolve) => {
      let settled = false;
      function close(value) {
        if (settled) return;
        settled = true;
        if (modalClose === close) modalClose = null;
        dom.modalRoot.hidden = true;
        dom.modalRoot.innerHTML = '';
        document.body.classList.remove('is-modal');
        resolve(value);
      }
      modalClose = close;

      $$('[data-value]', dom.modalRoot).forEach((btn) => {
        btn.addEventListener('click', () => {
          if (btn.disabled) return;
          sound.play('click');
          close(btn.dataset.value);
        });
      });
      $$('[data-close]', dom.modalRoot).forEach((btn) => {
        btn.addEventListener('click', () => {
          sound.play('click');
          close(null);
        });
      });
      dom.modalRoot.onmousedown = (e) => {
        if (e.target === dom.modalRoot && o.closable !== false) close(null);
      };
      const focusable = dom.modalRoot.querySelector('button');
      if (focusable) setTimeout(() => { try { focusable.focus(); } catch (err) { /* ignore */ } }, 30);
    });
  }

  function closeModal() {
    if (modalClose) modalClose(null);
  }

  function onKeydown(e) {
    if (e.key === 'Escape') {
      if (modalClose) {
        e.preventDefault();
        closeModal();
      }
      return;
    }
    if (e.code !== 'Space' || modalClose) return;
    if (dom.gameScreen.hidden || !Game.state || Game.state.over || busy) return;
    const tag = (e.target && e.target.tagName ? e.target.tagName : '').toLowerCase();
    if (tag === 'button' || tag === 'input' || tag === 'textarea' || tag === 'select') return;
    const p = Game.current();
    if (!p || !p.isHuman || !isLocalTurn()) return;
    e.preventDefault();
    if (isGuest()) {
      if (Game.state.phase === 'roll') guestSend({ t: 'roll' });
      else if (Game.state.phase === 'jail') guestSend({ t: 'jailRoll' });
      return;
    }
    if (Game.state.phase === 'roll') {
      humanRoll();
    } else if (Game.state.phase === 'jail') {
      humanJailRoll();
    }
  }

  /* ---------------- 事件卡 ---------------- */
  function cardEffectText(card) {
    const e = card.effect;
    switch (e.type) {
      case 'gain': return `+${util.fmt(e.amount)} token`;
      case 'pay': return `-${util.fmt(e.amount)} token`;
      case 'payRival': return `向随机对手支付 ${util.fmt(e.amount)} token`;
      case 'collectEach': return `其他选手各支付 ${util.fmt(e.amount)} token 给你`;
      case 'jail': return `直接进入禁赛区（${e.reason || '写暴力被查重'}）`;
      case 'getOut': return '获得「申诉信」× 1';
      case 'diceGain': return `掷 2d6，点数 × ${e.mult} token`;
      case 'freeBuild': return '随机自有地块免费加盖 1 层算法建筑';
      case 'destroyBuild': return `随机 1 栋算法建筑降 1 级；无建筑则赔偿 ${util.fmt(e.fallback || 0)} token`;
      case 'machineCrash': return `所有选手随机损坏 1 层建筑；无建筑者赔偿 ${util.fmt(e.amount || 600)} token`;
      case 'gainPerBuild': return `按建筑层数 × ${util.fmt(e.amount)} token 结算`;
      case 'market': return `随机章节租金 ×${e.mult}，持续 ${e.rounds} 回合`;
      case 'moveTo': return '移动到 AK 起点，并领取 3,000 token';
      case 'moveBy': return `前进 ${e.steps} 格`;
      default: return '';
    }
  }

  function showCardModal(card, deckName) {
    const tone = card.tone || 'neutral';
    const deckLabel = deckName === 'chance' ? '随机事件 · RNG' : 'OJ 公告 · NOTICE';
    const html = `
      <div class="event-card__deck"><span class="pulse-dot"></span>${deckLabel}</div>
      <div class="event-card__icon">${card.icon}</div>
      <h3>${util.escapeHtml(card.title)}</h3>
      <p class="event-card__text">${util.escapeHtml(card.text)}</p>
      <div class="event-card__effect">${util.escapeHtml(cardEffectText(card))}</div>`;
    if (autoMode) setTimeout(() => closeModal(), 420);
    return openModal({
      className: `modal--event event-card event-card--${tone}`,
      html,
      actions: [{ label: '接受结果', value: 'ok', className: 'btn--primary' }],
      closable: true
    });
  }

  /* ---------------- 玩法 / 成就 ---------------- */
  function openRules() {
    const html = `
      <div class="modal__head">
        <div class="modal__icon">📖</div>
        <div><p class="kicker">HOW TO PLAY</p><h3>机房生存手册</h3></div>
      </div>
      <div class="rule-section"><h4><span>01</span>目标</h4><p>token 就是钱：买地、建楼、交租、缴纳罚金都用它。在限定回合内成为总资产最高的选手；让其他人全部破产也能提前结束比赛。</p></div>
      <div class="rule-section"><h4><span>02</span>回合</h4><p>掷两颗骰子沿棋盘前进，停在格子上结算。掷出双数可以再掷一次；连续三次双数会被判定为“随机化暴力”，直接送进禁赛区。</p></div>
      <div class="rule-section"><h4><span>03</span>算法建筑 · 联动</h4><p>停在无主地块时可以买下。任何自有地块都能建造算法建筑，每块地最多 4 层，每一层都是一个具体算法。同一选手同时拥有组合中的两种算法（例如“前缀和 + 差分”“Dijkstra + 优先队列”）会激活算法联动，名下全部地块租金按联动倍率相乘，侧栏会显示当前联动。集齐同一章节仍有额外加成，大棋盘按持有比例计算，集齐 ×2。</p></div>
      <div class="rule-section"><h4><span>04</span>走到自家建筑 · 升级</h4><p>停在自家算法建筑上，可以直接加盖一层。升级费用随层数递增，拆除顶层只返还 50% 的造价。在自己回合也可以点击“建造 / 升级算法建筑”批量操作。</p></div>
      <div class="rule-section"><h4><span>05</span>禁赛区</h4><p>写暴力（brute force）会被裁判查重并禁赛：踩到“暴力检查”、抽到暴力事件，或连续三次双数都会进去。每回合可以：使用申诉信、缴纳罚金，或掷骰子求双数。三次申诉失败会被强制缴纳罚金。</p></div>
      <div class="rule-section"><h4><span>06</span>三轮时局 · 随机事件</h4><p>整局比赛分为三轮时局（起步 / 加速 / 终局）。除了踩到事件格，随着回合推进还会自动触发“时局事件”：省选放榜、机房限电、大纲修订、评测机崩溃等，越到后期触发越频繁。每 4 回合仍会出现一次市场行情。</p></div>
      <div class="rule-section"><h4><span>07</span>银行贷款（一局一次）</h4><p>每位选手每局可以向银行申请一次贷款：立即获得一笔 token，赛程结束时需要偿还本金 + 25% 利息，未还清会从总资产中扣除。现金不足时系统也会自动帮你申请这一次贷款应急。</p></div>
      <div class="rule-section"><h4><span>08</span>破产</h4><p>付不起租金或赔偿时，系统会自动拆除算法建筑、抵押地块来筹钱；仍然不够就破产退役，名下地块回到题库。抵押中的地块不收租，赎回需要 55% 的原价。</p></div>
      <div class="rule-section"><h4><span>09</span>罚时池</h4><p>罚时费和罚金会进入 AK 休息室的池子。停在休息室的人可以拿走全部 token。</p></div>
      <div class="rule-section"><h4><span>10</span>洛谷难度铭牌</h4><p>每位选手的名字旁边有一枚铭牌，随总资产上升依次变为：入门（红）、普及-（橙）、普及/提高-（黄）、普及+/提高（绿）、提高+/省选-（蓝）、省选/NOI-（紫）、NOI/NOI+（黑）。当总资产达到 260,000 且至少拥有一栋 4 层满配建筑时，会解锁隐藏铭牌「五彩斑斓的黑」。</p></div>
      <div class="rule-section"><h4><span>11</span>操作 · 局域网</h4><p>空格掷骰子；点击任意地块查看建筑层数、租金与抵押状态；在自己的回合可以批量加盖。局域网联机时，房主运行 <b>start-lan.bat</b>，其他人在同一 Wi-Fi 下打开房主的局域网地址，输入房间号加入；最多 4 人，房主电脑负责全部结算。</p></div>
      <p class="setup-foot" style="margin-top:16px">所有数字与概率都只是游戏设定，不涉及任何真实支付。</p>`;
    openModal({
      wide: true,
      html,
      actions: [{ label: '开始比赛', value: 'ok', className: 'btn--primary' }]
    });
  }

  function openAchievements() {
    const unlocked = storage.get(D.STORAGE.achievements, []) || [];
    const count = D.ACHIEVEMENTS.filter((a) => unlocked.indexOf(a.id) >= 0).length;
    const grid = D.ACHIEVEMENTS.map((a) => {
      const has = unlocked.indexOf(a.id) >= 0;
      return `<div class="ach${has ? '' : ' is-locked'}">
        <span class="ach__icon">${has ? a.icon : '🔒'}</span>
        <div><strong>${has ? a.name : '???'}</strong><small>${has ? a.desc : '尚未解锁'}</small></div>
      </div>`;
    }).join('');
    openModal({
      wide: true,
      html: `
        <div class="modal__head">
          <div class="modal__icon">🏆</div>
          <div><p class="kicker">ACHIEVEMENTS</p><h3>成就墙 <span style="font-family:var(--mono);font-size:11px;color:var(--dim)">${count}/${D.ACHIEVEMENTS.length}</span></h3></div>
        </div>
        <div class="ach-grid">${grid}</div>`,
      actions: [{ label: '回去比赛', value: null, className: 'btn--ghost' }]
    });
  }

  /* ---------------- 地块详情 ---------------- */
  function openTile(tileId) {
    if (!Game.state || endShown) return;
    const tile = Game.board[tileId];
    if (!tile) return;
    const st = Game.state;
    const prop = st.props[tileId];
    const owner = prop && prop.owner ? Game.player(prop.owner) : null;
    const human = me();
    const isProperty = tile.type === 'property';
    const isFacility = tile.type === 'facility';
    const color = isProperty ? D.GROUPS[tile.group].color : (isFacility ? '#8aa39c' : '#4ff0c0');
    const icon = isProperty ? '📘' : (tile.icon || '✦');
    const price = tile.price ? util.fmt(tile.price) : '—';
    const canManage = owner && human && owner.id === human.id && isLocalTurn() && !busy && !st.over;
    const isPurchase = !!(prop && !owner && pendingBuy === tile.id && isLocalTurn());

    let meta = `${tile.code}`;
    if (isProperty) meta += ` · ${D.GROUPS[tile.group].name} · 售价 ${price}`;
    else if (isFacility) meta += ` · 算力设施 · 售价 ${price}`;
    else meta += ' · 特殊格';

    let html = `
      <div class="tile-detail__head">
        <div class="tile-detail__swatch" style="--tc:${color}">${icon}</div>
        <div class="tile-detail__title">
          <h3>${util.escapeHtml(tile.name)}</h3>
          <div class="tile-detail__meta">${meta}</div>
        </div>
      </div>
      <p class="tile-detail__desc">${util.escapeHtml(tile.desc || '')}</p>`;

    if (prop) {
      html += `<div class="tile-detail__owner">
        <span class="dot" style="--pc:${owner ? owner.color : '#3a4d49'}"></span>
        ${owner ? `${util.escapeHtml(owner.name)} 持有${prop.mortgaged ? ' · 已抵押' : ''} ${plateMarkup(owner, true)}` : '题库 · 无主地块'}
      </div>`;
    }

    if (isProperty) {
      const labels = ['空地 Lv.0', 'Lv.1', 'Lv.2', 'Lv.3', 'Lv.4'];
      const rents = Game.rentTable(tileId);
      const level = prop.algos.length;
      const rows = labels.map((label, i) => `<tr class="${i === level ? 'is-current' : ''}"><td>${label}</td><td>${util.fmt(rents[i])} token</td></tr>`).join('');
      const mult = Game.marketMult(tile.group);
      const groupTotal = Game.board.filter((t) => t.type === 'property' && t.group === tile.group).length;
      const groupMult = owner ? Game.groupRentMult(owner.id, tile.group) : 1;
      const syn = owner ? Game.synergyMult(owner.id) : 1;
      const invested = Game.investedIn(tileId);
      const nextCost = level < D.CONFIG.maxAlgos ? Game.upgradeCost(tileId) : 0;
      const progress = owner ? Game.groupProgress(owner.id, tile.group) : 0;
      html += `<div class="subhead"><span>RENT TABLE</span><strong>章节 ×${groupMult.toFixed(2)}${mult !== 1 ? ` · 行情 ×${mult.toFixed(2)}` : ''}${syn > 1 ? ` · 联动 ×${syn.toFixed(2)}` : ''}</strong></div>
        <table class="rent-table">${rows}</table>
        <div class="subhead"><span>ALGORITHM BUILDINGS</span><strong>${level} / 4 层${invested ? ` · 已投入 ${util.fmt(invested)}` : ''}</strong></div>
        <div class="algo-slots">${tile.algoSet.map((a, i) => {
          const filled = i < level;
          const cost = Game.costAtLevel(tileId, i + 1);
          return `<div class="algo-slot${filled ? ' is-filled' : ''}">${filled ? util.escapeHtml(a.name) : `Lv.${i + 1} 空地`}<small>${filled ? `Lv.${i + 1} · RUNNING` : `+${util.fmt(cost)}`}</small></div>`;
        }).join('')}</div>`;
      html += `<p class="tile-detail__note">${D.GROUPS[tile.group].name}：${owner ? `${owner.name} 已持有 ${progress}/${groupTotal} 块（章节加成 ×${groupMult.toFixed(2)}）` : '尚无持有者'}。${groupTotal > 3 ? '大棋盘按持有比例加成，集齐仍然 ×2。' : '集齐整章后租金 ×2。'}${level < 4 ? `下一层需要 ${util.fmt(nextCost)} token。` : '已经盖满 4 层。'}</p>`;
    } else if (isFacility) {
      const count = owner ? Game.facilitiesOwned(owner.id) : 0;
      const facilityTotal = Game.board.filter((t) => t.type === 'facility').length;
      html += `<div class="subhead"><span>RENT FORMULA</span><strong>${st.facilityBase} × 骰子点数 × 设施数</strong></div>
        <table class="rent-table">
          <tr><td>持有设施</td><td>${count} / ${facilityTotal}</td></tr>
          <tr><td>两颗骰子平均租金</td><td>${util.fmt(st.facilityBase * count * 7)} token</td></tr>
          <tr><td>抵押价值</td><td>${util.fmt(Math.round(tile.price * 0.5))} token</td></tr>
        </table>
        <p class="tile-detail__note">算力设施没有建筑位。${facilityTotal} 座设施全部拿下，过路费会非常可观。</p>`;
    }

    const actions = [];
    if (isPurchase) {
      const affordable = human.tokens >= tile.price;
      actions.push({
        label: `买下 · ${price}`,
        value: 'buy',
        className: 'btn--primary',
        disabled: !affordable
      });
      actions.push({ label: '暂不购买', value: null, className: 'btn--ghost' });
    } else if (canManage && (isProperty || isFacility)) {
      if (isProperty) {
        const level = prop.algos.length;
        const nextCost = Game.upgradeCost(tileId);
        if (prop.mortgaged) {
          actions.push({ label: `赎回 · ${util.fmt(Game.redeemCost(tile))}`, value: 'redeem', className: 'btn--gold', disabled: human.tokens < Game.redeemCost(tile) });
        } else {
          if (level < D.CONFIG.maxAlgos) {
            const afford = human.tokens >= nextCost;
            actions.push({
              label: `${level === 0 ? '建造' : '升级'} Lv.${level + 1} · ${util.fmt(nextCost)}`,
              value: afford ? 'build' : null,
              className: afford ? 'btn--primary' : 'btn--ghost',
              disabled: !afford
            });
          }
          if (level > 0) {
            const refund = Math.round(Game.costAtLevel(tileId, level) * D.CONFIG.sellRatio);
            actions.push({ label: `拆除顶层 · +${util.fmt(refund)}`, value: 'sell', className: 'btn--ghost' });
          }
          if (level === 0) {
            actions.push({ label: `抵押 · +${util.fmt(Math.round(tile.price * D.CONFIG.mortgageRatio))}`, value: 'mortgage', className: 'btn--ghost' });
          }
        }
      } else if (!prop.mortgaged) {
        actions.push({ label: `抵押 · +${util.fmt(Math.round(tile.price * D.CONFIG.mortgageRatio))}`, value: 'mortgage', className: 'btn--ghost' });
      } else {
        actions.push({ label: `赎回 · ${util.fmt(Game.redeemCost(tile))}`, value: 'redeem', className: 'btn--gold', disabled: human.tokens < Game.redeemCost(tile) });
      }
      actions.push({ label: '关闭', value: null, className: 'btn--ghost' });
    } else {
      if (owner && !owner.isHuman) {
        html += `<p class="tile-detail__note">这是 ${util.escapeHtml(owner.name)} 的地块，只能通过支付租金或等它破产来接手。</p>`;
      } else if (owner && owner.isHuman && !canManage) {
        html += `<p class="tile-detail__note">轮到你行动时，才能建造、抵押或赎回这块地。</p>`;
      } else if (prop && !owner) {
        html += `<p class="tile-detail__note">无主地块。只有停在上面时才能购买。</p>`;
      }
      actions.push({ label: '关闭', value: null, className: 'btn--ghost' });
    }

    openModal({
      className: 'modal--tile',
      html,
      actions,
      closable: true
    }).then((value) => {
      if (!value) return;
      if (isGuest()) {
        if (value === 'buy') pendingBuy = null;
        guestSend({ t: 'tile', id: tile.id, op: value });
        return;
      }
      const p = Game.current();
      if (!p || !p.isHuman || p.remote) return;
      let changed = false;
      if (value === 'buy') {
        if (Game.buy(p, tile.id)) {
          pendingBuy = null;
          sound.play('buy');
          toast(`买下【${tile.name}】。`, 'good');
          changed = true;
        }
      } else if (value === 'build') {
        const algo = Game.build(p, tile.id);
        if (algo) {
          const level = Game.state.props[tile.id].algos.length;
          sound.play('build');
          toast(`【${tile.name}】升到 Lv.${level}【${algo.name}】，租金上涨。`, 'good');
          highlightBuild(tile.id);
          changed = true;
        }
      } else if (value === 'sell') {
        const refund = Game.sellAlgo(p, tile.id);
        if (refund) {
          sound.play('sell');
          toast(`拆除【${tile.name}】顶层，回收 ${util.fmt(refund)} token。`, 'warn');
          changed = true;
        }
      } else if (value === 'mortgage') {
        if (Game.mortgage(p, tile.id)) {
          sound.play('sell');
          toast(`抵押【${tile.name}】成功。`, 'warn');
          changed = true;
        }
      } else if (value === 'redeem') {
        if (Game.redeem(p, tile.id)) {
          sound.play('buy');
          toast(`赎回【${tile.name}】。`, 'info');
          changed = true;
        }
      }
      if (changed) {
        checkAchievements();
        refresh();
        updateCenter(tile.id, true);
        setTimeout(() => openTile(tile.id), 160);
      }
    });
  }

  function openBuildMenu() {
    if (!Game.state || busy || !isLocalTurn()) return;
    const human = me();
    if (!human) return;
    const candidates = Game.ownedTiles(human.id).filter((t) => {
      const prop = Game.state.props[t.id];
      return t.type === 'property' && !prop.mortgaged && prop.algos.length < D.CONFIG.maxAlgos;
    });
    if (!candidates.length) {
      toast('没有可以加盖的地块。先买一块地，或者把已有建筑拆到 4 层以下。', 'warn');
      return;
    }
    const rows = candidates.map((t) => {
      const prop = Game.state.props[t.id];
      const level = prop.algos.length;
      const cost = Game.upgradeCost(t.id);
      const afford = human.tokens >= cost;
      const nextAlgo = t.algoSet[level];
      const nextRent = Game.rentTable(t.id)[Math.min(4, level + 1)];
      return `<div class="build-row">
        <span class="build-row__swatch" style="--c:${D.GROUPS[t.group].color}"></span>
        <div class="build-row__main">
          <strong>${util.escapeHtml(t.name)} <span class="build-row__level">Lv.${level} → Lv.${level + 1}</span></strong>
          <small>${nextAlgo ? util.escapeHtml(nextAlgo.name) : '算法建筑'} · 升级后租金约 ${util.fmt(nextRent)}</small>
        </div>
        <button class="btn btn--primary" type="button" data-value="build:${t.id}" ${afford ? '' : 'disabled'}>${util.fmt(cost)}</button>
      </div>`;
    }).join('');

    openModal({
      wide: true,
      html: `
        <div class="modal__head">
          <div class="modal__icon">🏗</div>
          <div><p class="kicker">BUILD / UPGRADE</p><h3>建造 / 升级算法建筑</h3></div>
        </div>
        <p>每块地最多盖 4 层，每层都是一个算法建筑。走到自家建筑上可以直接升级，不要求集齐章节。当前现金：<strong style="color:var(--gold);font-family:var(--mono)">${util.fmt(human.tokens)}</strong> token</p>
        <div class="build-list">${rows}</div>`,
      actions: [
        { label: '一键升级', value: 'all', className: 'btn--ghost' },
        { label: '关闭', value: null, className: 'btn--ghost' }
      ]
    }).then((value) => {
      if (!value) return;
      if (isGuest()) {
        if (value === 'all') guestSend({ t: 'buildAll' });
        else if (value.indexOf('build:') === 0) guestSend({ t: 'build', id: Number(value.slice(6)) });
        return;
      }
      let built = 0;
      if (value === 'all') {
        for (let i = 0; i < 20; i++) {
          const list = Game.ownedTiles(human.id).filter((t) => Game.canBuild(human, t.id));
          if (!list.length) break;
          list.sort((a, b) => Game.rentTable(b.id)[Math.min(4, Game.state.props[b.id].algos.length + 1)]
            - Game.rentTable(a.id)[Math.min(4, Game.state.props[a.id].algos.length + 1)]);
          if (Game.build(human, list[0].id)) built += 1;
          else break;
        }
      } else if (value.indexOf('build:') === 0) {
        const id = Number(value.slice(6));
        if (Game.build(human, id)) built += 1;
      }
      if (built) {
        sound.play('build');
        toast(`加盖了 ${built} 层算法建筑，租金已经上涨。`, 'good');
        checkAchievements();
        refresh();
        updateCenter(Game.current().pos, true);
      }
    });
  }

  /* ============================================================
     局域网联机
     ============================================================ */
  function lanConfigFromForm() {
    const cfg = {
      size: selected.size,
      difficulty: selected.diff,
      rounds: selected.rounds,
      count: selected.count
    };
    $$('[data-lan-config]', dom.modalRoot).forEach((el) => {
      const key = el.dataset.lanConfig;
      if (key === 'size') cfg.size = Number(el.value) || cfg.size;
      else if (key === 'difficulty') cfg.difficulty = el.value || cfg.difficulty;
      else if (key === 'rounds') cfg.rounds = Number(el.value) || cfg.rounds;
      else if (key === 'count') cfg.count = Number(el.value) || cfg.count;
    });
    return cfg;
  }

  function lanAddressText() {
    try {
      return location.origin && location.origin !== 'null' ? location.origin : '';
    } catch (e) {
      return '';
    }
  }

  function renderLanLobby(view) {
    const body = document.getElementById('lanLobbyBody');
    if (!body || !view) return;
    lastRoomView = view;
    const isHost = net.mode === 'host';
    const cfg = view.config || {};
    const address = lanAddressText();
    const players = view.players || [];
    const slots = [];
    for (let i = 0; i < (view.maxPlayers || 4); i++) {
      const p = players.find((x) => x.slot === i);
      slots.push(`<div class="lan-seat${p ? ' is-filled' : ''}${p && p.host ? ' is-host' : ''}">
        <span class="lan-seat__num">P${i + 1}</span>
        <span class="lan-seat__name">${p ? util.escapeHtml(p.name) : '等待加入…'}</span>
        <span class="lan-seat__badge">${p ? (p.host ? '房主' : (p.connected ? '在线' : '重连中')) : '空位'}</span>
      </div>`);
    }
    const sizeOpt = D.BOARD_SIZE_ORDER.map((s) => `<option value="${s}" ${Number(cfg.size) === s ? 'selected' : ''}>${D.SIZE_PRESETS[s].name}</option>`).join('');
    const diffOpt = Object.keys(D.DIFFICULTIES).map((k) => `<option value="${k}" ${cfg.difficulty === k ? 'selected' : ''}>${D.DIFFICULTIES[k].name}</option>`).join('');
    const roundOpt = [15, 25, 40].map((r) => `<option value="${r}" ${Number(cfg.rounds) === r ? 'selected' : ''}>${r} 回合</option>`).join('');
    const countOpt = [2, 3, 4].map((c) => `<option value="${c}" ${Number(cfg.count) === c ? 'selected' : ''}>${c} 名选手</option>`).join('');
    const settings = isHost ? `
      <div class="lan-settings">
        <label><span>棋盘</span><select data-lan-config="size">${sizeOpt}</select></label>
        <label><span>难度</span><select data-lan-config="difficulty">${diffOpt}</select></label>
        <label><span>赛程</span><select data-lan-config="rounds">${roundOpt}</select></label>
        <label><span>总人数</span><select data-lan-config="count">${countOpt}</select></label>
      </div>` : `
      <div class="lan-readonly">
        <span>${D.SIZE_PRESETS[cfg.size] ? D.SIZE_PRESETS[cfg.size].name : cfg.size + ' 格'}</span>
        <span>${D.DIFFICULTIES[cfg.difficulty] ? D.DIFFICULTIES[cfg.difficulty].name : '常规赛'}</span>
        <span>${cfg.rounds} 回合</span>
        <span>${cfg.count} 名选手</span>
      </div>`;
    const hostActions = isHost
      ? `<button class="btn btn--primary" type="button" data-lan-act="start">开始比赛</button>
         <button class="btn btn--ghost" type="button" data-lan-act="copy">复制房间信息</button>
         <button class="btn btn--danger" type="button" data-lan-act="leave">解散房间</button>`
      : `<div class="lan-wait"><span class="pulse-dot"></span>等待房主开始比赛…</div>
         <button class="btn btn--danger" type="button" data-lan-act="leave">离开房间</button>`;
    body.innerHTML = `
      <div class="modal__head">
        <div class="modal__icon">📶</div>
        <div><p class="kicker">LAN MULTIPLAYER</p><h3>${isHost ? '联机房间已创建' : '已加入联机房间'}</h3></div>
      </div>
      <div class="lan-code-row">
        <div class="lan-code"><span>房间号</span><strong>${view.code}</strong></div>
        <div class="lan-address"><span>其他设备访问</span><strong>${address || '请通过 start-lan.bat 打开页面'}</strong></div>
      </div>
      <div class="lan-seats">${slots.join('')}</div>
      ${settings}
      <p class="lan-hint">${isHost ? '把房间号和上面的访问地址告诉队友；他们打开地址后点「局域网联机 → 加入房间」。' : '房主开始比赛后会自动进入棋盘。'}</p>
      <div class="lan-actions">${hostActions}</div>`;
  }

  async function openLanEntry() {
    const saved = storage.get(D.STORAGE.lanName, '') || '';
    const html = `
      <div class="modal__head">
        <div class="modal__icon">📶</div>
        <div><p class="kicker">LAN MULTIPLAYER</p><h3>局域网联机</h3></div>
      </div>
      <p>同一 Wi-Fi 下最多 4 人。房主需要先运行 <b>start-lan.bat</b>，其他人用浏览器打开房主电脑的局域网地址。</p>
      <div class="lan-entry">
        <label class="lan-field"><span>你的名字</span><input id="lanNameInput" maxlength="12" value="${util.escapeHtml(saved)}" placeholder="例如：机房一哥"></label>
        <label class="lan-field"><span>房间号（加入时填写）</span><input id="lanCodeInput" maxlength="6" inputmode="numeric" placeholder="4 位数字"></label>
        <div class="lan-entry__actions">
          <button class="btn btn--primary" type="button" data-lan-act="create">创建房间</button>
          <button class="btn btn--ghost" type="button" data-lan-act="join">加入房间</button>
        </div>
        <div class="lan-status" id="lanStatus"></div>
      </div>
      <p class="setup-foot" style="text-align:left">没有启动服务器？直接双击游戏目录里的 <b>start-lan.bat</b>，它会自动打开本机页面并显示局域网地址。</p>`;
    openModal({
      wide: true,
      className: 'modal--lan',
      html,
      actions: [{ label: '关闭', value: null, className: 'btn--ghost' }]
    });
  }

  function setLanStatus(text, bad) {
    const el = document.getElementById('lanStatus');
    if (!el) return;
    el.textContent = text;
    el.classList.toggle('is-bad', !!bad);
  }

  async function createLanRoom() {
    lobbyConfig = null;
    const nameEl = document.getElementById('lanNameInput');
    const name = (nameEl && nameEl.value || '').trim() || '房主';
    storage.set(D.STORAGE.lanName, name);
    setLanStatus('正在创建房间……');
    try {
      const data = await net.createRoom(name, {
        size: selected.size, difficulty: selected.diff, rounds: selected.rounds, count: selected.count
      });
      lanLobbyOpen = true;
      closeModal();
      showLanLobby();
      renderLanLobby(data.view);
    } catch (err) {
      setLanStatus('创建失败：' + (err && err.message ? err.message : '未连接服务器') + '（请先运行 start-lan.bat）', true);
    }
  }

  async function joinLanRoom() {
    lobbyConfig = null;
    const nameEl = document.getElementById('lanNameInput');
    const codeEl = document.getElementById('lanCodeInput');
    const name = (nameEl && nameEl.value || '').trim() || '选手';
    const code = (codeEl && codeEl.value || '').trim();
    if (!/^\d{3,6}$/.test(code)) {
      setLanStatus('请输入正确的房间号。', true);
      return;
    }
    storage.set(D.STORAGE.lanName, name);
    setLanStatus('正在加入房间……');
    try {
      const data = await net.joinRoom(code, name);
      lanLobbyOpen = true;
      closeModal();
      showLanLobby();
      if (data && data.view) renderLanLobby(data.view);
    } catch (err) {
      setLanStatus('加入失败：' + (err && err.message ? err.message : '房间不存在') + '（确认已运行 start-lan.bat）', true);
    }
  }

  function showLanLobby() {
    openModal({
      wide: true,
      className: 'modal--lan',
      html: '<div id="lanLobbyBody" class="lan-body"><p class="lan-status">正在连接房间……</p></div>',
      actions: [],
      closable: true
    }).then(() => {
      if (!lanLobbyOpen) return;
      lanLobbyOpen = false;
      if (net.isLan() && !net.started && !Game.state) {
        net.leave(true);
        net.reset();
        if (dom.lanChip) dom.lanChip.hidden = true;
      }
    });
    if (lastRoomView) renderLanLobby(lastRoomView);
  }

  async function startLanHost(view) {
    const room = view || lastRoomView;
    if (!room) return;
    const cfg = Object.assign({}, room.config || {}, lanConfigFromForm(), lobbyConfig || {});
    cfg.count = Math.max(cfg.count || 3, (room.players || []).length);
    let roster = (room.players || []).map((p) => ({ slot: p.slot, name: p.name }));
    try {
      const started = await net.startGame(cfg);
      if (started && started.roster && started.roster.length) roster = started.roster;
    } catch (err) {
      toast('开始失败：' + (err && err.message ? err.message : '网络错误'), 'bad');
      return;
    }
    if (!roster.length) return;
    lanLobbyOpen = false;
    closeModal();
    selected = { diff: cfg.difficulty, count: Math.max(roster.length, cfg.count), rounds: cfg.rounds, size: cfg.size };
    resetGameUI();
    Game.create({
      difficulty: cfg.difficulty,
      count: Math.max(roster.length, cfg.count),
      rounds: cfg.rounds,
      boardSize: cfg.size,
      humans: roster,
      localSlot: net.slot,
      lan: true
    });
    enterGame();
    beginTurn();
  }

  function startLanGuest(payload) {
    const cfg = payload.config || {};
    lanLobbyOpen = false;
    closeModal();
    resetGameUI();
    guestInit = true;
    Game.boardSize = cfg.size || 40;
    Game.board = D.getBoard(Game.boardSize);
    Game.state = null;
    dom.setupScreen.hidden = true;
    dom.gameScreen.hidden = false;
    if (dom.lanChip) {
      dom.lanChip.hidden = false;
      dom.lanChip.textContent = `📶 联机 ${net.room}`;
    }
    window.scrollTo({ top: 0, behavior: 'auto' });
    tileEls = {};
    tileRefs = {};
    pawnEls = {};
    dom.pawnLayer.innerHTML = '';
    dom.gameLog.innerHTML = '';
    dom.centerTileCode.textContent = 'SYNC';
    dom.centerTileName.textContent = '等待房主同步局面';
    dom.centerTileDesc.textContent = '房主开始比赛后，棋盘状态会通过局域网同步过来。';
    dom.diceVerdict.textContent = '等待同步';
    buildBoard();
    dom.actionButtons.innerHTML = '<div class="action-empty">等待房主同步局面……</div>';
    dom.actionHint.textContent = '联机模式由房主电脑结算，客机只负责显示与操作。';
    dom.turnState.textContent = '同步中';
  }

  function onNetRoom(view) {
    lastRoomView = view;
    net.applyRoom(view);
    if (lanLobbyOpen) renderLanLobby(view);
  }

  function onNetStart(payload) {
    netDebug.start += 1;
    if (net.mode === 'guest') {
      try {
        startLanGuest(payload);
        netDebug.skip = 'guest-started';
      } catch (e) {
        netDebug.error = 'start:' + (e && e.message);
        console.error(e);
      }
    }
  }

  function onNetAction(from, payload) {
    if (net.mode !== 'host' || !Game.state || Game.state.over) return;
    const p = Game.current();
    if (!p || !p.isHuman || p.slot !== from) return;
    clearTimeout(remoteTurnTimer);
    remoteTurnTimer = null;
    handleHostAction(p, payload || {});
  }

  function onNetSnapshot(snap) {
    netDebug.snapshot += 1;
    netDebug.skip = 'snap:' + (net.mode || '?') + ':' + (snap ? Object.keys(snap).join('|') : 'null');
    if (net.mode !== 'guest' || !snap || !snap.state) return;
    const st = snap.state;
    const first = !Game.state;
    if (Game.boardSize !== st.boardSize) {
      Game.boardSize = st.boardSize;
      Game.board = D.getBoard(st.boardSize);
    }
    Game.state = st;
    if (snap.ui) {
      pendingBuy = snap.ui.pendingBuy == null ? null : snap.ui.pendingBuy;
      pendingUpgrade = snap.ui.pendingUpgrade == null ? null : snap.ui.pendingUpgrade;
    }
    const hostBusy = !!(snap.ui && snap.ui.busy);
    const sameTurn = awaitingTurn === st.turnSerial;
    const settled = !sameTurn || (Date.now() - awaitingSince > 700 && !hostBusy);
    awaiting = hostBusy || (awaiting && !settled);
    if (first) {
      dom.setupScreen.hidden = true;
      dom.gameScreen.hidden = false;
      if (dom.lanChip) {
        dom.lanChip.hidden = false;
        dom.lanChip.textContent = `📶 联机 ${net.room}`;
      }
      buildBoard();
      buildPawns();
    }
    if (st.lastRoll) {
      setDie(dom.dieA, st.lastRoll.a);
      setDie(dom.dieB, st.lastRoll.b);
      dom.diceVerdict.textContent = `${st.lastRoll.a} + ${st.lastRoll.b} = ${st.lastRoll.total}${st.lastRoll.double ? ' · 双数！' : ''}`;
    } else {
      dom.diceVerdict.textContent = st.phase === 'jail' ? '禁赛申诉中' : '等待掷骰';
    }
    refresh();
    layoutPawns();
    const cur = Game.current();
    if (cur) updateCenter(cur.pos, false);
    if (st.over) showEnd(st.endReason);
  }

  function handleHostAction(p, payload) {
    switch (payload.t) {
      case 'roll': humanRoll(); break;
      case 'end': humanEndTurn(); break;
      case 'buy': humanBuy(); break;
      case 'skipBuy': humanSkipBuy(); break;
      case 'upgrade': humanUpgrade(); break;
      case 'skipUpgrade': humanSkipUpgrade(); break;
      case 'build': {
        const algo = Game.build(p, Number(payload.id));
        if (algo) {
          sound.play('build');
          toast(`${p.name} 加盖了【${Game.board[Number(payload.id)].name}】。`, 'info');
          checkAchievements();
          refresh();
        }
        break;
      }
      case 'buildAll': {
        let built = 0;
        for (let i = 0; i < 20; i++) {
          const list = Game.ownedTiles(p.id).filter((t) => Game.canBuild(p, t.id));
          if (!list.length) break;
          list.sort((a, b) => Game.rentTable(b.id)[Math.min(4, Game.state.props[b.id].algos.length + 1)]
            - Game.rentTable(a.id)[Math.min(4, Game.state.props[a.id].algos.length + 1)]);
          if (Game.build(p, list[0].id)) built += 1;
          else break;
        }
        if (built) {
          sound.play('build');
          toast(`${p.name} 一键加盖了 ${built} 层算法建筑。`, 'info');
          checkAchievements();
          refresh();
        }
        break;
      }
      case 'tile': handleHostTileAction(p, Number(payload.id), payload.op); break;
      case 'loan': humanLoan(); break;
      case 'repay': humanRepay(); break;
      case 'jailRoll': humanJailRoll(); break;
      case 'jailPay': humanJailPay(); break;
      case 'jailCard': humanJailCard(); break;
      default: break;
    }
  }

  function handleHostTileAction(p, tileId, op) {
    const tile = Game.board[tileId];
    const prop = Game.state.props[tileId];
    if (!tile || !prop) return;
    if (op === 'buy') {
      if (pendingBuy !== tileId) return;
      if (Game.buy(p, tileId)) {
        pendingBuy = null;
        sound.play('buy');
        toast(`${p.name} 买下【${tile.name}】。`, 'info');
      }
    } else if (prop.owner !== p.id) {
      return;
    } else if (op === 'build') {
      if (Game.build(p, tileId)) {
        sound.play('build');
        toast(`${p.name} 加盖了【${tile.name}】。`, 'info');
      }
    } else if (op === 'sell') {
      if (Game.sellAlgo(p, tileId)) {
        sound.play('sell');
        toast(`${p.name} 拆除了【${tile.name}】的顶层。`, 'info');
      }
    } else if (op === 'mortgage') {
      if (Game.mortgage(p, tileId)) sound.play('sell');
    } else if (op === 'redeem') {
      if (Game.redeem(p, tileId)) sound.play('buy');
    }
    checkAchievements();
    refresh();
    updateCenter(tileId, true);
  }

  function onLanModalClick(e) {
    const btn = e.target.closest('[data-lan-act]');
    if (!btn) return;
    const act = btn.dataset.lanAct;
    if (act === 'create') createLanRoom();
    else if (act === 'join') joinLanRoom();
    else if (act === 'start') startLanHost(lastRoomView);
    else if (act === 'copy') {
      const text = `信奥大富翁联机：${lanAddressText()} 房间号 ${net.room}`;
      try {
        navigator.clipboard.writeText(text);
        toast('房间信息已复制。', 'good');
      } catch (err) {
        toast(text, 'info');
      }
    } else if (act === 'leave') {
      lanLobbyOpen = false;
      lobbyConfig = null;
      closeModal();
      net.leave(true);
      net.reset();
      if (dom.lanChip) dom.lanChip.hidden = true;
      updateSetupUI();
    }
  }

  function onLanConfigChange(e) {
    const el = e.target.closest('[data-lan-config]');
    if (!el || net.mode !== 'host' || !net.room) return;
    const cfg = lanConfigFromForm();
    lobbyConfig = cfg;
    net.setConfig(cfg).catch(() => toast('设置已记录，开始比赛时会以本地设置为准。', 'warn'));
  }

  /* ---------------- 结算 ---------------- */
  function showEnd(reason) {
    if (endShown || !Game.state) return;
    endShown = true;
    busy = false;
    stopAutopilot();
    clearTimeout(aiTimer);
    clearTimeout(endingTimer);
    if (modalClose) closeModal();

    const st = Game.state;
    if (!st.over && !isGuest()) {
      Game.finish(reason || 'manual');
    }
    const human = me() || st.players[0];
    const winner = st.winner || st.ranking[0] || human;
    const rank = st.ranking.indexOf(human) + 1;
    const humanWin = winner && human && winner.id === human.id && human.alive;
    const net = human && human.alive ? Game.netWorth(human) : 0;
    const played = reason === 'rounds' || st.endReason === 'rounds'
      ? Math.min(st.round, st.maxRounds)
      : st.round;

    if (OI.Net.isLan()) unlock('lan');
    if (humanWin) {
      unlock('winner');
      if (human.minTokens < 1000) unlock('comeback');
    }
    if (human && !human.alive) unlock('bankrupt');

    if (!isGuest()) {
      const best = Number(storage.get(D.STORAGE.best, 0)) || 0;
      if (net > best) storage.set(D.STORAGE.best, net);
      const stats = storage.get(D.STORAGE.stats, { games: 0, wins: 0 }) || { games: 0, wins: 0 };
      if (!st.resultSaved) {
        stats.games = (stats.games || 0) + 1;
        if (humanWin) stats.wins = (stats.wins || 0) + 1;
        storage.set(D.STORAGE.stats, stats);
        st.resultSaved = true;
      }
      updateBestRecord();
    }

    let title;
    let sub;
    if (humanWin) {
      title = 'AK 全场';
      sub = '你的算法建筑从机房一路盖到评测机顶端。今晚的题解，署你的名字。';
    } else if (!human.alive) {
      title = '光荣退役';
      sub = 'token 归零，算法建筑被拆除，地块回到题库。但你留下的题解，还会被下一届抄很多年。';
    } else {
      title = `第 ${rank} 名`;
      sub = `${winner.name} 以 ${util.fmt(Game.netWorth(winner))} 总资产拿下第一。再开一局，把 TA 的地买下来。`;
    }
    if (st.endReason === 'rounds') sub += ' 赛程耗尽，按总资产结算。';
    if (plate.id === 'prism' && humanWin) title = '五彩斑斓的黑';

    dom.endTitle.textContent = title;
    dom.endSub.textContent = sub;

    dom.endRanking.innerHTML = st.ranking.map((p, i) => {
      const worth = p.alive ? Game.netWorth(p) : 0;
      const isSelf = human && p.id === human.id;
      return `<div class="end-row${i === 0 ? ' is-first' : ''}" style="--pc:${p.color}">
        <div class="end-row__rank">${i + 1}</div>
        <div class="end-row__avatar" style="border-color:${hexA(p.color, 0.35)}">${p.icon}</div>
        <div class="end-row__name">${util.escapeHtml(p.name)} ${plateMarkup(p, true)}
          ${isSelf ? '<small>你</small>' : `<small>${p.isHuman ? 'P' + (p.slot + 1) : (p.tag || 'AI')}</small>`}
          ${!p.alive ? '<small style="color:#ff9b9b">已退役</small>' : ''}
        </div>
        <div class="end-row__money">${p.alive ? util.fmt(worth) : '退役'}<small>总资产</small></div>
      </div>`;
    }).join('');

    const owned = Game.ownedTiles(human.id);
    const algos = Game.buildingCount(human.id);
    const maxLevel = owned.reduce((n, t) => Math.max(n, st.props[t.id].algos.length), 0);
    const plate = plateFor(human);
    dom.endStats.innerHTML = `
      <div class="end-stat"><span>赛程</span><strong>${played}/${st.maxRounds}</strong></div>
      <div class="end-stat"><span>你的总资产</span><strong>${util.fmt(net)}</strong></div>
      <div class="end-stat"><span>地块 / 建筑</span><strong>${owned.length} / ${algos}</strong></div>
      <div class="end-stat"><span>最高建筑</span><strong>Lv.${maxLevel}</strong></div>
      <div class="end-stat"><span>难度铭牌</span><strong style="color:${plate.color}">${plate.name}</strong></div>
      <div class="end-stat"><span>抽到事件</span><strong>${human.stats.cards}</strong></div>
      <div class="end-stat"><span>银行欠款</span><strong>${human.loanOwed ? util.fmt(human.loanOwed) : '—'}</strong></div>
      <div class="end-stat"><span>算法联动</span><strong>×${Game.synergyMult(human.id).toFixed(2)}</strong></div>`;

    dom.endScreen.hidden = false;
    refresh();
    updateAchieveBadge();

    if (humanWin) {
      sound.play('win');
      spawnConfetti();
    } else {
      sound.play('lose');
    }
  }

  function spawnConfetti() {
    const colors = ['#4ff0c0', '#f0c979', '#55c8ff', '#ff8fa3', '#9b8cff'];
    const box = dom.endScreen.querySelector('.end-confetti');
    if (!box) return;
    box.innerHTML = '';
    for (let i = 0; i < 34; i++) {
      const piece = document.createElement('span');
      piece.className = 'confetti-piece';
      piece.style.left = util.randInt(0, 100) + '%';
      piece.style.background = colors[i % colors.length];
      piece.style.animationDelay = (Math.random() * 0.6) + 's';
      piece.style.animationDuration = (1.8 + Math.random() * 1.6) + 's';
      piece.style.setProperty('--drift', util.randInt(-90, 90) + 'px');
      piece.style.width = util.randInt(4, 8) + 'px';
      piece.style.height = util.randInt(7, 14) + 'px';
      box.appendChild(piece);
    }
    setTimeout(() => { box.innerHTML = ''; }, 4200);
  }


  /* __INIT__ */

  /* 对外暴露，方便调试与自动化测试 */
  window.OI_UI = {
    startGame, backToLobby, refresh, humanRoll, humanUpgrade, humanSkipUpgrade,
    humanBuy, humanSkipBuy, humanEndTurn, humanJailRoll, humanJailPay, humanJailCard,
    humanLoan, humanRepay, openTile, openBuildMenu, showCardModal, openLanEntry,
    get busy() { return busy; },
    get pendingBuy() { return pendingBuy; },
    get pendingUpgrade() { return pendingUpgrade; },
    get awaiting() { return awaiting; }
  };

  init();
})(window.OI = window.OI || {});
