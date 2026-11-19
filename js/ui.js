/* ============================================================
   信奥大富翁 · 界面层
   棋盘渲染 / 交互流程 / 动画 / 弹窗 / 结算
   ============================================================ */
(function (OI) {
  'use strict';

  const D = OI.DATA;
  const Game = OI.Game;
  const util = OI.util;
  const sound = OI.sound;
  const storage = OI.storage;

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel, root) => Array.prototype.slice.call((root || document).querySelectorAll(sel));

  /* DOM */
  const dom = {};
  let selected = { diff: 'normal', count: 3, rounds: 25 };
  let busy = false;
  let pendingBuy = null;
  let aiTimer = null;
  let modalClose = null;
  let endShown = false;
  let endingTimer = null;
  let tileEls = {};
  let tileRefs = {};
  let pawnEls = {};
  let logCursor = 0;
  let autoPlayed = false;
  let autoMode = false;
  let autoTimer = null;

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
      'diffChoices', 'countChoices', 'roundChoices', 'modalRoot', 'toastRoot',
      'endScreen', 'endTitle', 'endSub', 'endRanking', 'endStats', 'againBtn', 'lobbyBtn',
      'brandHome', 'tickerText', 'centerRound', 'centerPot', 'centerChapters', 'centerMeta',
      'sideMarket', 'marketNote', 'debugBox'
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

    dom.startBtn.addEventListener('click', () => { sound.unlock(); sound.play('deal'); startGame(); });
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
      startGame();
    });
    dom.lobbyBtn.addEventListener('click', backToLobby);

    document.addEventListener('keydown', onKeydown);
    window.addEventListener('resize', debounce(layoutPawns, 120));

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
    const diff = D.DIFFICULTIES[selected.diff];
    dom.modeNote.textContent = `${diff.name} · 起始 ${util.fmt(diff.start)}`;
    dom.setupSummary.innerHTML = `<span class="pulse-dot"></span><span>${diff.name} · ${selected.rounds} 回合 · ${selected.count} 名选手 · 每人 ${util.fmt(diff.start)} token</span>`;
  }

  function updateBestRecord() {
    const best = Number(storage.get(D.STORAGE.best, 0)) || 0;
    dom.bestRecordValue.textContent = best > 0 ? util.fmt(best) : '—';
  }

  /* ============================================================
     开局 / 回大厅
     ============================================================ */
  function startGame() {
    clearTimeout(aiTimer);
    clearTimeout(endingTimer);
    stopAutopilot();
    endShown = false;
    busy = false;
    pendingBuy = null;
    logCursor = 0;
    autoPlayed = false;
    dom.gameLog.innerHTML = '';
    dom.gameLog.classList.remove('is-expanded');
    dom.logToggle.textContent = '展开';
    dom.endScreen.hidden = true;

    Game.create({ difficulty: selected.diff, count: selected.count, rounds: selected.rounds });

    dom.setupScreen.hidden = true;
    dom.gameScreen.hidden = false;
    window.scrollTo({ top: 0, behavior: 'auto' });

    buildBoard();
    buildPawns();
    refresh();
    requestAnimationFrame(layoutPawns);
    updateTicker();
    updateCenter(0, false);
    beginTurn();
  }

  function backToLobby() {
    clearTimeout(aiTimer);
    clearTimeout(endingTimer);
    stopAutopilot();
    busy = false;
    pendingBuy = null;
    dom.endScreen.hidden = true;
    dom.gameScreen.hidden = true;
    dom.setupScreen.hidden = false;
    updateBestRecord();
    updateSetupUI();
    window.scrollTo({ top: 0, behavior: 'auto' });
  }

  function confirmLeave() {
    openModal({
      title: '离开这局比赛？',
      icon: '🚪',
      html: '<p>当前对局不会保存，离开后需要重新开始。</p>',
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

    D.BOARD.forEach((tile) => {
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
      const tileData = D.BOARD[pos];
      if (!tile) return;
      const r = tile.getBoundingClientRect();
      let ax = 0.5;
      let ay = 0.5;
      if (tileData.side === 'corner') {
        if (pos === 0) { ax = 0.74; ay = 0.74; }
        else if (pos === 10) { ax = 0.26; ay = 0.74; }
        else if (pos === 20) { ax = 0.26; ay = 0.26; }
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
    updateLog();
    renderActions();
    requestAnimationFrame(layoutPawns);
    setTimeout(layoutPawns, 80);
  }

  function updateCenterMeta() {
    const st = Game.state;
    if (!st || !dom.centerRound) return;
    dom.centerRound.textContent = `ROUND ${String(Math.min(st.round, st.maxRounds)).padStart(2, '0')} / ${st.maxRounds}`;
    dom.centerPot.textContent = `罚时池 ${util.fmt(st.pot)}`;
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
    const human = Game.state.players[0];
    dom.topbarTokens.textContent = util.fmt(human ? human.tokens : 0);
  }

  function updateTurnCard() {
    const p = Game.current();
    if (!p) return;
    const tile = D.BOARD[p.pos];
    const owned = Game.ownedTiles(p.id);
    const algoCount = owned.reduce((n, t) => n + Game.state.props[t.id].algos.length, 0);
    const isAI = !p.isHuman;
    const badge = p.inJail ? '<span class="turn-badge is-banned">禁赛中</span>'
      : isAI ? `<span class="turn-badge is-ai">${p.tag}</span>` : '<span class="turn-badge">正在行动</span>';

    dom.turnCard.style.setProperty('--pc', p.color);
    dom.turnCard.innerHTML = `
      <div class="turn-card__top">
        <span class="avatar">${p.icon}</span>
        <div class="turn-card__ident">
          <div class="turn-card__name"><span class="dot"></span>${util.escapeHtml(p.name)}</div>
          <span class="turn-card__meta">${p.inJail ? 'BANNED · ' : ''}AT #${p.pos} · ${util.escapeHtml(tile.name)}</span>
        </div>
        ${badge}
      </div>
      <div class="turn-card__tokens">
        <div>
          <span>TOKEN</span>
          <strong>${util.fmt(p.tokens)}</strong>
        </div>
        <div class="turn-card__net">
          <span>总资产</span>
          <strong>${util.fmt(Game.netWorth(p))}</strong>
        </div>
      </div>
      <div class="turn-card__foot">
        <span class="stat-pill">地块 <b>${owned.length}</b></span>
        <span class="stat-pill">算法 <b>${algoCount}</b></span>
        <span class="stat-pill stat-pill--gold">申诉信 <b>${p.getOut}</b></span>
      </div>`;
  }

  function updateBoard() {
    const st = Game.state;
    const current = Game.current();
    D.BOARD.forEach((tile) => {
      const el = tileEls[tile.id];
      if (!el) return;
      const prop = st.props[tile.id];
      const refs = tileRefs[tile.id];
      const owner = prop && prop.owner ? Game.player(prop.owner) : null;

      el.classList.toggle('is-owned', !!owner);
      el.classList.toggle('is-mortgaged', !!(prop && prop.mortgaged));
      el.classList.toggle('is-current', !!current && current.pos === tile.id && !st.over);
      el.classList.toggle('has-algos', !!(prop && prop.algos.length));

      if (owner) {
        el.style.setProperty('--owner-color', owner.color);
        el.style.setProperty('--owner-ring', hexA(owner.color, 0.5));
      }

      if (refs.owner) {
        refs.owner.hidden = !owner;
        if (owner) refs.owner.style.setProperty('--owner-color', owner.color);
      }

      if (refs.chips && prop) {
        refs.chips.innerHTML = prop.algos.map((a) => `<span class="tile__chip">${util.escapeHtml(a.short)}</span>`).join('');
      }
      if (refs.price) {
        refs.price.textContent = util.fmt(tile.price);
      }
    });
  }

  function updateRoster() {
    const st = Game.state;
    dom.rosterNote.textContent = `${Game.alivePlayers().length}/${st.players.length} 名选手`;
    dom.playerList.innerHTML = st.players.map((p, i) => {
      const owned = Game.ownedTiles(p.id);
      const algoCount = owned.reduce((n, t) => n + st.props[t.id].algos.length, 0);
      const isCurrent = st.current === i && !st.over;
      const status = !p.alive ? '已退役' : p.inJail ? `禁赛中 · ${D.CONFIG.jailTurns - p.jailTurns} 次申诉机会` : `地块 ${owned.length} · 算法 ${algoCount}`;
      return `
        <div class="roster-row${isCurrent ? ' is-current' : ''}${p.alive ? '' : ' is-dead'}" style="--pc:${p.color}">
          <span class="roster-avatar">${p.icon}</span>
          <div class="roster-main">
            <div class="roster-name">${util.escapeHtml(p.name)}${p.isHuman ? '<span class="tag">YOU</span>' : `<span class="tag">${p.tag || 'AI'}</span>`}</div>
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
    dom.tickerRound.textContent = `R${st.round}`;
    let text = '行情平稳，适合抄底。';
    if (st.headline && st.headlineRound === st.round) {
      text = st.headline;
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
    dom.sideMarket.innerHTML = (rows || '<div class="market-empty">暂无行情。租金按基础值结算。</div>')
      + `<div class="pot-line"><span>罚时池</span><strong>${util.fmt(st.pot)}</strong></div>`;
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
    const tile = D.BOARD[tileId];
    if (!tile) return;
    dom.centerTileCode.textContent = tile.code;
    dom.centerTileName.textContent = tile.name;
    let desc = tile.desc;
    if (tile.type === 'property') {
      const prop = Game.state && Game.state.props[tile.id];
      const owner = prop && prop.owner ? Game.player(prop.owner) : null;
      if (owner) desc = `${owner.name} 持有 · 当前租金 ${util.fmt(Game.rentFor(tile.id, 7))} token。`;
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

  /* ============================================================
     操作面板
     ============================================================ */
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

    const isHuman = p.isHuman;
    dom.turnState.className = 'turn-state';
    if (!isHuman) {
      dom.turnState.classList.add('is-ai');
      dom.turnState.textContent = 'AI 行动中';
    } else if (p.inJail) {
      dom.turnState.classList.add('is-banned');
      dom.turnState.textContent = '禁赛中';
    } else if (st.phase === 'roll') {
      dom.turnState.textContent = '等待掷骰';
    } else {
      dom.turnState.textContent = '行动阶段';
    }

    if (!isHuman) {
      dom.actionButtons.innerHTML = '<div class="action-empty">对手正在计算最优解……<br>你可以点击地块查看行情。</div>';
      dom.actionHint.textContent = p.inJail ? '对手正在禁赛区申诉。' : '等待对手掷骰与结算。';
      return;
    }

    if (busy) {
      dom.actionButtons.innerHTML = '<button class="action-btn" type="button" disabled><span class="action-btn__main"><strong>处理中…</strong><small>正在结算本次行动</small></span></button>';
      dom.actionHint.textContent = '骰子还在滚动。';
      return;
    }

    if (st.phase === 'jail' && p.inJail) {
      const canPay = p.tokens >= D.CONFIG.jailFine;
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
        <span class="action-btn__main"><strong>缴纳保释金</strong><small>${canPay ? '立刻离开禁赛区，然后正常掷骰' : 'token 不足，无法保释'}</small></span>
        <span class="action-btn__side">${util.fmt(D.CONFIG.jailFine)}</span>
      </button>`);
      buttons.push(`<button class="action-btn action-btn--danger" data-act="end" type="button">
        <span class="action-btn__main"><strong>放弃申诉</strong><small>保留在禁赛区，结束本回合</small></span>
      </button>`);
      dom.actionButtons.innerHTML = buttons.join('');
      dom.actionHint.innerHTML = `还剩 <b>${D.CONFIG.jailTurns - p.jailTurns}</b> 次申诉机会；三次失败会被强制保释。`;
      return;
    }

    if (st.phase === 'roll') {
      dom.actionButtons.innerHTML = `
        <button class="action-btn action-btn--primary" data-act="roll" type="button">
          <span class="action-btn__main"><strong>掷骰子</strong><small>两颗 d6，沿棋盘前进</small></span>
          <span class="action-btn__key">SPACE</span>
        </button>`;
      dom.actionHint.innerHTML = st.doubles > 0
        ? `双数奖励：本回合已掷 <b>${st.doubles}</b> 次双数。`
        : '经过 AK 起点领取 3,000 token；双数可以再掷一次。';
      return;
    }

    /* 行动阶段 */
    if (pendingBuy != null) {
      const tile = D.BOARD[pendingBuy];
      const afford = p.tokens >= tile.price;
      const isFacility = tile.type === 'facility';
      dom.actionButtons.innerHTML = `
        <button class="action-btn action-btn--gold" data-act="buy" type="button" ${afford ? '' : 'disabled'}>
          <span class="action-btn__main"><strong>买下【${tile.name}】</strong><small>${afford ? (isFacility ? '算力设施的过路费随持有数量上涨' : '装入资产表，向路过的同学收租') : 'token 不足'}</small></span>
          <span class="action-btn__side">${util.fmt(tile.price)}</span>
        </button>
        <button class="action-btn" data-act="skip-buy" type="button">
          <span class="action-btn__main"><strong>放弃购买</strong><small>这块地会留在题库里</small></span>
        </button>`;
      dom.actionHint.textContent = isFacility
        ? '算力设施没有算法槽；过路费 = 120 × 骰子点数 × 你持有的设施数。'
        : '停在这里才能购买；集齐同章节三块地后租金翻倍。';
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
        <span class="action-btn__main"><strong>安装算法</strong><small>${buildables.length} 块地可以升级，租金立刻上涨</small></span>
        <span class="action-btn__side">${buildables.length}</span>
      </button>`);
    }

    buttons.push(`<button class="action-btn ${canReroll ? '' : 'action-btn--primary'}" data-act="end" type="button">
      <span class="action-btn__main"><strong>结束回合</strong><small>${canReroll ? '放弃双数奖励，交给下一位' : '结算完成，交给下一位选手'}</small></span>
      <span class="action-btn__key">↩</span>
    </button>`);

    dom.actionButtons.innerHTML = buttons.join('');
    if (p.inJail) {
      dom.actionHint.textContent = '你被禁赛了，本回合只能结束。下回合可以继续申诉。';
    } else if (buildables.length) {
      dom.actionHint.innerHTML = '点击地块可以查看租金表；<b>集齐同章节</b>才能安装算法。';
    } else {
      dom.actionHint.textContent = '点击棋盘上的地块，可以查看租金、算法和抵押状态。';
    }
  }

  function onActionClick(e) {
    const btn = e.target.closest('button[data-act]');
    if (!btn || btn.disabled) return;
    const act = btn.dataset.act;
    sound.play('click');
    switch (act) {
      case 'roll': humanRoll(); break;
      case 'end': humanEndTurn(); break;
      case 'buy': humanBuy(); break;
      case 'skip-buy': humanSkipBuy(); break;
      case 'build-menu': openBuildMenu(); break;
      case 'jail-roll': humanJailRoll(); break;
      case 'jail-pay': humanJailPay(); break;
      case 'jail-card': humanJailCard(); break;
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
    const st = Game.state;
    if (!st) return;
    if (st.over) { showEnd(st.endReason); return; }

    pendingBuy = null;
    const p = Game.current();
    st.phase = p.inJail ? 'jail' : 'roll';
    if (p.isHuman) {
      busy = false;
      refresh();
      updateCenter(p.pos, false);
      dom.diceVerdict.textContent = p.inJail ? '禁赛申诉中' : '等待掷骰';
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
    st.phase = 'roll';
    renderActions();
    try {
      const roll = Game.roll();
      Game.log(`${p.name} 掷出 ${roll.a} + ${roll.b} = ${roll.total}${roll.double ? '（双数）' : ''}。`, 'info');
      updateLog();
      await animateDice(roll.a, roll.b);

      if (st.doubles >= 3) {
        Game.sendToJail(p, '连续三次双数');
        sound.play('jail');
        toast('连续三次双数，裁判把你请进了禁赛区。', 'bad');
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
            if (player.isHuman) scheduleEnd('bankrupt');
          } else if (res) {
            toast(`${player.isHuman ? '你' : player.name} 向 ${owner.name} 支付 ${util.fmt(res.paid)} token 租金。`, player.isHuman ? 'bad' : 'warn');
          }
        } else if (landing.action === 'mortgaged') {
          Game.log(`【${landing.tile.name}】已被 ${landing.owner.name} 抵押，本次免租。`, 'info');
        } else {
          Game.log(`${player.name} 停在自己的【${landing.tile.name}】上。`, 'info');
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
        toast(`${player.isHuman ? '你' : player.name} 缴纳罚时费 ${util.fmt(res.paid)} token。`, 'bad');
        if (res.bankrupt && player.isHuman) scheduleEnd('bankrupt');
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
          toast(`${player.isHuman ? '你' : player.name} 拿走了罚时池的 ${util.fmt(amount)} token！`, 'good');
        } else {
          Game.log(`${player.name} 在 AK 休息室休息了一会儿。`, 'info');
        }
        break;
      }
      case 'jail': {
        if (landing.goto) {
          Game.sendToJail(player, '踩到进入禁赛格');
          sound.play('jail');
          toast(`${player.isHuman ? '你' : player.name} 被送进禁赛区。`, 'bad');
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
      if (player.isHuman) scheduleEnd('bankrupt');
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
    const tile = D.BOARD[pendingBuy];
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
    const tile = D.BOARD[pendingBuy];
    Game.log(`你放弃了【${tile.name}】。`, 'info');
    pendingBuy = null;
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
        toast('三次申诉失败，强制缴纳保释金后离开。', 'warn');
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
      toast(`缴纳 ${util.fmt(res.paid)} token 保释金，恢复比赛资格。`, 'warn');
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

  function humanEndTurn() {
    if (busy || !Game.state || Game.state.over) return;
    pendingBuy = null;
    finishTurn(true);
  }

  /* ---------------- 回合推进 ---------------- */
  function finishTurn(force) {
    if (!Game.state || Game.state.over) {
      if (Game.state && Game.state.over) showEnd(Game.state.endReason);
      return;
    }
    busy = false;
    pendingBuy = null;
    const res = Game.endTurn(force);

    if (res.finished) { showEnd(res.reason); return; }

    if (res.same) {
      toast('双数奖励：再掷一次。', 'good');
      beginTurn();
      return;
    }

    if (res.wrapped) {
      const news = Game.nextRoundNews();
      if (news) announceNews(news.news.text);
      Game.log(`—— 第 ${Game.state.round} 回合 ——`, 'system');
    }

    beginTurn();
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
    if (choice === 'pay' && p.tokens >= D.CONFIG.jailFine) {
      Game.payJailFine(p);
      toast(`${p.name} 缴纳保释金，恢复了比赛资格。`, 'info');
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
      toast(`${p.name} 三次申诉失败，被强制保释。`, 'info');
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
      Game.sendToJail(p, '连续三次双数');
      sound.play('jail');
      toast(`${p.name} 连续三次双数，被送进禁赛区。`, 'info');
      refresh();
      return;
    }

    await animateMove(p, roll.total);
    await resolveLanding(p);
  }

  function aiManage(p) {
    if (!p.alive) return;
    const target = Game.aiBuildChoice(p);
    if (!target) return;
    const algo = Game.build(p, target.id);
    if (algo) {
      sound.play('build');
      toast(`${p.name} 在【${target.name}】安装了算法【${algo.name}】。`, 'info');
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

    if (player.isHuman) {
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
    if (result.jailed) sound.play('jail');
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

    if (player.isHuman && !player.alive) scheduleEnd('bankrupt');
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
      else if (p.tokens > D.CONFIG.jailFine + 8000) humanJailPay();
      else humanJailRoll();
      return;
    }
    if (st.phase === 'roll') { humanRoll(); return; }
    if (pendingBuy != null) {
      const tile = D.BOARD[pendingBuy];
      const completes = Game.groupProgress(p.id, tile.group) >= 1;
      if (p.tokens >= tile.price && (completes || p.tokens - tile.price > 3500)) humanBuy();
      else humanSkipBuy();
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
    const human = Game.state.players[0];
    if (!human) return;
    if (human.stats.buys >= 1) unlock('first_buy');
    if (human.stats.builds >= 10) unlock('builder');
    if (human.stats.cards >= 5) unlock('cards');
    if (human.tokens >= 50000) unlock('rich');
    if (D.GROUP_ORDER.some((g) => Game.ownsGroup(human.id, g))) unlock('monopoly');
    const maxed = Game.ownedTiles(human.id).some((t) => Game.state.props[t.id].algos.length >= 4);
    if (maxed) unlock('full_stack');
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
    if (!p || !p.isHuman) return;
    if (Game.state.phase === 'roll') {
      e.preventDefault();
      humanRoll();
    } else if (Game.state.phase === 'jail') {
      e.preventDefault();
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
      case 'jail': return '直接进入禁赛区';
      case 'getOut': return '获得「申诉信」× 1';
      case 'diceGain': return `掷 2d6，点数 × ${e.mult} token`;
      case 'freeBuild': return '随机自有地块免费安装 1 个算法';
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
      <div class="rule-section"><h4><span>01</span>目标</h4><p>在限定回合内成为总资产最高的选手。买下算法地块、安装算法、收取租金；让其他人全部破产也能提前结束比赛。</p></div>
      <div class="rule-section"><h4><span>02</span>回合</h4><p>掷两颗骰子沿棋盘前进，停在格子上结算。掷出双数可以再掷一次；连续三次双数会被直接送进禁赛区。</p></div>
      <div class="rule-section"><h4><span>03</span>算法地产</h4><p>停在无主地块时可以买下。集齐同一章节的三块地后，基础租金翻倍，并解锁“安装算法”。每次安装都会给地块加一个具体算法，最多 4 个，租金逐级上涨。</p></div>
      <div class="rule-section"><h4><span>04</span>token 与破产</h4><p>token 既是现金也是分数。付不起租金时会自动变卖算法、抵押地块；仍然不够就破产退役，名下地块回到题库。抵押中的地块不收租，赎回需要 55% 的原价。</p></div>
      <div class="rule-section"><h4><span>05</span>禁赛区</h4><p>停在“进入禁赛”或被事件卡命中会进入禁赛。每回合可以：使用申诉信、缴纳 4,000 token 保释金，或掷骰子求双数。三次申诉失败会被强制保释。</p></div>
      <div class="rule-section"><h4><span>06</span>随机事件与行情</h4><p>“随机事件”和“OJ 公告”会改变 token、位置、禁赛状态与租金。每 4 回合还会出现一次市场行情，某个章节的租金会在一段时间内上涨或下跌。</p></div>
      <div class="rule-section"><h4><span>07</span>罚时池</h4><p>罚时费和保释金会进入 AK 休息室的池子。停在休息室的人可以拿走全部 token。</p></div>
      <div class="rule-section"><h4><span>08</span>操作</h4><p>空格掷骰子；点击任意地块查看租金、算法与抵押状态；在自己的回合点击“安装算法”可以批量升级。</p></div>
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
    const tile = D.BOARD[tileId];
    if (!tile) return;
    const st = Game.state;
    const prop = st.props[tileId];
    const owner = prop && prop.owner ? Game.player(prop.owner) : null;
    const human = st.players[0];
    const current = Game.current();
    const isProperty = tile.type === 'property';
    const isFacility = tile.type === 'facility';
    const color = isProperty ? D.GROUPS[tile.group].color : (isFacility ? '#8aa39c' : '#4ff0c0');
    const icon = isProperty ? '📘' : (tile.icon || '✦');
    const price = tile.price ? util.fmt(tile.price) : '—';
    const canManage = owner && owner.isHuman && current && current.isHuman && !busy && !st.over;
    const isPurchase = prop && !owner && pendingBuy === tile.id;

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
        ${owner ? `${util.escapeHtml(owner.name)} 持有${prop.mortgaged ? ' · 已抵押' : ''}` : '题库 · 无主地块'}
      </div>`;
    }

    if (isProperty) {
      const levels = ['无算法', '1 个算法', '2 个算法', '3 个算法', '4 个算法'];
      const rents = Game.rentTable(tileId);
      const level = prop.algos.length;
      const rows = levels.map((label, i) => `<tr class="${i === level ? 'is-current' : ''}"><td>${label}</td><td>${util.fmt(rents[i])} token</td></tr>`).join('');
      const mult = Game.marketMult(tile.group);
      const bonus = owner && Game.ownsGroup(owner.id, tile.group);
      html += `<div class="subhead"><span>RENT TABLE</span><strong>${bonus ? '章节垄断 · 租金 ×2' : '未集齐章节'}${mult !== 1 ? ` · 行情 ×${mult.toFixed(2)}` : ''}</strong></div>
        <table class="rent-table">${rows}</table>
        <div class="subhead"><span>ALGORITHMS</span><strong>${level} / 4</strong></div>
        <div class="algo-slots">${tile.algoSet.map((a, i) => {
          const filled = i < level;
          return `<div class="algo-slot${filled ? ' is-filled' : ''}">${filled ? util.escapeHtml(a.name) : '空位'}<small>${filled ? 'RUNNING' : `+${util.fmt(tile.buildCost)}`}</small></div>`;
        }).join('')}</div>`;
      const progress = owner ? Game.groupProgress(owner.id, tile.group) : 0;
      html += `<p class="tile-detail__note">${D.GROUPS[tile.group].name}：${owner ? `${owner.name} 已持有 ${progress}/3 块` : '尚无持有者'}。安装算法需要集齐整个章节，单次 ${util.fmt(tile.buildCost)} token。</p>`;
    } else if (isFacility) {
      const count = owner ? Game.facilitiesOwned(owner.id) : 0;
      html += `<div class="subhead"><span>RENT FORMULA</span><strong>${D.CONFIG.facilityRentBase} × 骰子点数 × 设施数</strong></div>
        <table class="rent-table">
          <tr><td>持有设施</td><td>${count} / 4</td></tr>
          <tr><td>两颗骰子平均租金</td><td>${util.fmt(D.CONFIG.facilityRentBase * count * 7)} token</td></tr>
          <tr><td>抵押价值</td><td>${util.fmt(Math.round(tile.price * 0.5))} token</td></tr>
        </table>
        <p class="tile-detail__note">算力设施没有算法槽。四座设施全部拿下，过路费会非常可观。</p>`;
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
        if (Game.canBuild(human, tile.id)) {
          actions.push({ label: `安装算法 · ${util.fmt(tile.buildCost)}`, value: 'build', className: 'btn--primary' });
        } else if (prop.mortgaged) {
          actions.push({ label: `赎回 · ${util.fmt(Game.redeemCost(tile))}`, value: 'redeem', className: 'btn--gold', disabled: human.tokens < Game.redeemCost(tile) });
        } else if (prop.algos.length > 0) {
          actions.push({ label: `卖出算法 · +${util.fmt(Math.round(tile.buildCost * 0.5))}`, value: 'sell', className: 'btn--ghost' });
        } else if (!Game.ownsGroup(human.id, tile.group)) {
          actions.push({ label: '安装算法（需集齐章节）', value: null, className: 'btn--ghost', disabled: true });
        } else if (human.tokens < tile.buildCost) {
          actions.push({ label: `安装算法 · ${util.fmt(tile.buildCost)}`, value: null, className: 'btn--ghost', disabled: true });
        }
      }
      if (isProperty && prop.mortgaged) {
        /* 赎回按钮已在上方处理 */
      } else if (!prop.mortgaged) {
        const mortgageAmount = Math.round(tile.price * 0.5);
        const canMortgage = isFacility || prop.algos.length === 0;
        actions.push({
          label: `抵押 · +${util.fmt(mortgageAmount)}`,
          value: 'mortgage',
          className: 'btn--ghost',
          disabled: !canMortgage
        });
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
      const p = Game.current();
      if (!p || !p.isHuman) return;
      let changed = false;
      if (value === 'buy') {
        if (Game.buy(p, tile.id)) {
          pendingBuy = null;
          sound.play('buy');
          toast(`买下【${tile.name}】。`, 'good');
          changed = true;
        }
      } else if (value === 'build') {
        if (Game.build(p, tile.id)) {
          sound.play('build');
          toast(`算法已安装到【${tile.name}】。`, 'good');
          changed = true;
        }
      } else if (value === 'sell') {
        if (Game.sellAlgo(p, tile.id)) {
          sound.play('sell');
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
    if (!Game.state || busy) return;
    const human = Game.state.players[0];
    const current = Game.current();
    if (!current || !current.isHuman) return;
    const candidates = Game.ownedTiles(human.id).filter((t) => Game.canBuild(human, t.id));
    if (!candidates.length) {
      toast('还没有可以安装算法的地块。先集齐一个章节的三块地。', 'warn');
      return;
    }
    const rows = candidates.map((t) => {
      const prop = Game.state.props[t.id];
      const nextRent = Game.rentTable(t.id)[Math.min(4, prop.algos.length + 1)];
      return `<div class="build-row">
        <span class="build-row__swatch" style="--c:${D.GROUPS[t.group].color}"></span>
        <div class="build-row__main">
          <strong>${util.escapeHtml(t.name)}</strong>
          <small>${prop.algos.length}/4 个算法 · 安装后租金约 ${util.fmt(nextRent)}</small>
        </div>
        <button class="btn btn--primary" type="button" data-value="build:${t.id}" ${human.tokens < t.buildCost ? 'disabled' : ''}>${util.fmt(t.buildCost)}</button>
      </div>`;
    }).join('');

    openModal({
      wide: true,
      html: `
        <div class="modal__head">
          <div class="modal__icon">🧱</div>
          <div><p class="kicker">INSTALL ALGORITHMS</p><h3>安装算法</h3></div>
        </div>
        <p>每次安装会把一个新的算法写进地块，最多 4 个。安装需要集齐整个章节。当前 token：<strong style="color:var(--gold);font-family:var(--mono)">${util.fmt(human.tokens)}</strong></p>
        <div class="build-list">${rows}</div>`,
      actions: [
        { label: '全部安装', value: 'all', className: 'btn--ghost' },
        { label: '关闭', value: null, className: 'btn--ghost' }
      ]
    }).then((value) => {
      if (!value) return;
      let built = 0;
      if (value === 'all') {
        for (let i = 0; i < 20; i++) {
          const list = Game.ownedTiles(human.id).filter((t) => Game.canBuild(human, t.id));
          if (!list.length) break;
          if (Game.build(human, list[0].id)) built += 1;
          else break;
        }
      } else if (value.indexOf('build:') === 0) {
        const id = Number(value.slice(6));
        if (Game.build(human, id)) built += 1;
      }
      if (built) {
        sound.play('build');
        toast(`安装了 ${built} 个算法，租金已经上涨。`, 'good');
        checkAchievements();
        refresh();
        updateCenter(Game.current().pos, true);
      }
    });
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
    if (!st.over) {
      Game.finish(reason || 'manual');
    }
    const human = st.players[0];
    const winner = st.winner || st.ranking[0] || human;
    const rank = st.ranking.indexOf(human) + 1;
    const humanWin = winner && winner.isHuman && human.alive;
    const net = human.alive ? Game.netWorth(human) : 0;
    const played = reason === 'rounds' || st.endReason === 'rounds'
      ? Math.min(st.round, st.maxRounds)
      : st.round;

    if (humanWin) {
      unlock('winner');
      if (human.minTokens < 1000) unlock('comeback');
    }
    if (!human.alive) unlock('bankrupt');

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

    let title;
    let sub;
    if (humanWin) {
      title = 'AK 全场';
      sub = '你把整间机房写进了自己的资产表。今晚的题解，署你的名字。';
    } else if (!human.alive) {
      title = '光荣退役';
      sub = 'token 归零，地块回到题库。但你留下的题解，还会被下一届抄很多年。';
    } else {
      title = `第 ${rank} 名`;
      sub = `${winner.name} 以 ${util.fmt(Game.netWorth(winner))} 总资产拿下第一。再开一局，把 TA 的地买下来。`;
    }
    if (st.endReason === 'rounds') sub += ' 赛程耗尽，按总资产结算。';

    dom.endTitle.textContent = title;
    dom.endSub.textContent = sub;

    dom.endRanking.innerHTML = st.ranking.map((p, i) => {
      const worth = p.alive ? Game.netWorth(p) : 0;
      return `<div class="end-row${i === 0 ? ' is-first' : ''}" style="--pc:${p.color}">
        <div class="end-row__rank">${i + 1}</div>
        <div class="end-row__avatar" style="border-color:${hexA(p.color, 0.35)}">${p.icon}</div>
        <div class="end-row__name">${util.escapeHtml(p.name)}
          ${p.isHuman ? '<small>你</small>' : `<small>${p.tag || 'AI'}</small>`}
          ${!p.alive ? '<small style="color:#ff9b9b">已退役</small>' : ''}
        </div>
        <div class="end-row__money">${p.alive ? util.fmt(worth) : '退役'}<small>总资产</small></div>
      </div>`;
    }).join('');

    const owned = Game.ownedTiles(human.id);
    const algos = owned.reduce((n, t) => n + st.props[t.id].algos.length, 0);
    dom.endStats.innerHTML = `
      <div class="end-stat"><span>赛程</span><strong>${played}/${st.maxRounds}</strong></div>
      <div class="end-stat"><span>你的总资产</span><strong>${util.fmt(net)}</strong></div>
      <div class="end-stat"><span>地块 / 算法</span><strong>${owned.length} / ${algos}</strong></div>
      <div class="end-stat"><span>抽到事件</span><strong>${human.stats.cards}</strong></div>`;

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
    startGame, backToLobby, refresh, humanRoll, openTile, get busy() { return busy; }
  };

  init();
})(window.OI = window.OI || {});
