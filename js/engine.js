/* ============================================================
   信奥大富翁 · 规则引擎
   回合、移动、租金、算法建筑、禁赛、机惨事件、破产与 AI 决策
   ============================================================ */
(function (OI) {
  'use strict';

  const D = OI.DATA;
  const CONFIG = D.CONFIG;
  const BOARD = D.BOARD;
  const util = OI.util;

  const Game = {
    state: null,
    board: BOARD,

    /* ---------------- 初始化 ---------------- */
    create(options) {
      const opts = options || {};
      const diff = D.DIFFICULTIES[opts.difficulty] || D.DIFFICULTIES.normal;
      const count = util.clamp(Number(opts.count) || 3, 2, 4);
      const rounds = Number(opts.rounds) || CONFIG.maxRounds;

      const players = [{
        id: 'p0', name: '你', icon: '🧑‍💻', initial: '你', color: D.HUMAN_COLOR,
        tag: '选手', isHuman: true, isAI: false,
        tokens: diff.start, pos: 0, inJail: false, jailTurns: 0, alive: true, getOut: 0,
        minTokens: diff.start,
        stats: { rentPaid: 0, rentEarned: 0, builds: 0, upgrades: 0, cards: 0, buys: 0 }
      }];

      const aiCount = count - 1;
      for (let i = 0; i < aiCount; i++) {
        const template = D.AI_PLAYERS[i % D.AI_PLAYERS.length];
        players.push({
          id: template.id, name: template.name, icon: template.icon, initial: template.initial,
          color: template.color, tag: template.tag, style: template.style,
          isHuman: false, isAI: true, ai: Object.assign({}, template.ai),
          tokens: diff.start, pos: 0, inJail: false, jailTurns: 0, alive: true, getOut: 0,
          minTokens: diff.start,
          stats: { rentPaid: 0, rentEarned: 0, builds: 0, upgrades: 0, cards: 0, buys: 0 }
        });
      }

      const props = {};
      BOARD.forEach((tile) => {
        if (tile.type === 'property' || tile.type === 'facility') {
          props[tile.id] = { owner: null, algos: [], mortgaged: false };
        }
      });

      this.state = {
        difficulty: diff.id,
        difficultyName: diff.name,
        aiFactor: diff.aiFactor,
        startTokens: diff.start,
        maxRounds: rounds,
        players,
        props,
        current: 0,
        round: 1,
        phase: 'roll',
        lastRoll: null,
        doubles: 0,
        pot: 0,
        market: [],
        log: [],
        cardsDrawn: 0,
        lastCard: {},
        over: false,
        winner: null,
        ranking: [],
        startedAt: Date.now(),
        turnSerial: 0
      };

      this.log(`比赛开始：${diff.name} · ${rounds} 回合 · ${players.length} 名选手`, 'system');
      this.log(`每人 ${util.fmt(diff.start)} token。token 就是钱：买地、建楼、交租都靠它。`, 'info');
      this.log('走到自家算法建筑上可以直接升级；写暴力会被禁赛。', 'info');
      return this.state;
    },

    /* ---------------- 查询 ---------------- */
    current() {
      return this.state.players[this.state.current];
    },
    player(id) {
      return this.state.players.find((p) => p.id === id) || null;
    },
    alivePlayers() {
      return this.state.players.filter((p) => p.alive);
    },
    tile(id) {
      return BOARD[id];
    },
    ownedTiles(playerId) {
      return BOARD.filter((t) => {
        const p = this.state.props[t.id];
        return p && p.owner === playerId;
      });
    },
    ownsGroup(playerId, groupId) {
      const tiles = BOARD.filter((t) => t.type === 'property' && t.group === groupId);
      return tiles.length > 0 && tiles.every((t) => this.state.props[t.id].owner === playerId);
    },
    groupProgress(playerId, groupId) {
      const tiles = BOARD.filter((t) => t.type === 'property' && t.group === groupId);
      return tiles.filter((t) => this.state.props[t.id].owner === playerId).length;
    },
    facilitiesOwned(playerId) {
      return BOARD.filter((t) => t.type === 'facility' && this.state.props[t.id].owner === playerId).length;
    },
    netWorth(player) {
      let total = player.tokens;
      this.ownedTiles(player.id).forEach((tile) => {
        const prop = this.state.props[tile.id];
        if (tile.type === 'facility') {
          total += prop.mortgaged ? Math.round(tile.price * CONFIG.mortgageRatio) : tile.price;
        } else {
          total += prop.mortgaged ? Math.round(tile.price * CONFIG.mortgageRatio)
            : tile.price + this.investedIn(tile.id);
        }
      });
      return Math.round(total);
    },
    /* 算法建筑：升级费用随层数递增，拆除返还顶层造价的一半 */
    upgradeCost(tileId) {
      const tile = BOARD[tileId];
      const prop = this.state.props[tileId];
      if (!tile || !prop) return 0;
      const level = prop.algos.length;
      if (level >= CONFIG.maxAlgos) return 0;
      const costs = tile.buildCosts || [tile.buildCost];
      return costs[Math.min(level, costs.length - 1)] || tile.buildCost || 0;
    },
    investedIn(tileId) {
      const tile = BOARD[tileId];
      const prop = this.state.props[tileId];
      if (!tile || !prop) return 0;
      const costs = tile.buildCosts || [tile.buildCost];
      let total = 0;
      for (let i = 0; i < prop.algos.length; i++) {
        total += costs[i] || tile.buildCost || 0;
      }
      return total;
    },
    lastBuildCost(tileId) {
      const tile = BOARD[tileId];
      const prop = this.state.props[tileId];
      if (!tile || !prop || !prop.algos.length) return 0;
      const costs = tile.buildCosts || [tile.buildCost];
      return costs[Math.min(prop.algos.length - 1, costs.length - 1)] || tile.buildCost || 0;
    },
    costAtLevel(tileId, level) {
      const tile = BOARD[tileId];
      if (!tile) return 0;
      const costs = tile.buildCosts || [tile.buildCost];
      return costs[Math.min(Math.max(level - 1, 0), costs.length - 1)] || tile.buildCost || 0;
    },
    buildingCount(playerId) {
      return this.ownedTiles(playerId).reduce((n, tile) => n + this.state.props[tile.id].algos.length, 0);
    },
    marketMult(groupId) {
      const value = this.state.market
        .filter((m) => m.group === groupId)
        .reduce((acc, m) => acc * m.mult, 1);
      return util.clamp(value, 0.4, 2.5);
    },
    rentFor(tileId, diceTotal) {
      const tile = BOARD[tileId];
      const prop = this.state.props[tileId];
      if (!tile || !prop || !prop.owner || prop.mortgaged) return 0;
      if (tile.type === 'facility') {
        const count = this.facilitiesOwned(prop.owner);
        return util.roundTo(CONFIG.facilityRentBase * count * (diceTotal || 7), 10);
      }
      let rent = tile.rent[prop.algos.length] || 0;
      if (this.ownsGroup(prop.owner, tile.group)) rent *= 2;
      const mult = this.marketMult(tile.group);
      rent *= mult;
      return Math.max(0, util.roundTo(rent, 10));
    },
    rentTable(tileId) {
      const tile = BOARD[tileId];
      const prop = this.state.props[tileId];
      if (!tile || tile.type !== 'property') return [];
      const groupBonus = prop.owner && this.ownsGroup(prop.owner, tile.group) ? 2 : 1;
      const mult = this.marketMult(tile.group);
      return tile.rent.map((r) => Math.round(r * groupBonus * mult));
    },

    /* ---------------- 日志 ---------------- */
    log(text, type) {
      this.state.log.push({
        text,
        type: type || 'info',
        round: this.state.round,
        id: util.uid('log')
      });
      if (this.state.log.length > 160) this.state.log.shift();
    },

    /* ---------------- 移动 ---------------- */
    roll() {
      const a = util.randInt(1, 6);
      const b = util.randInt(1, 6);
      const roll = { a, b, total: a + b, double: a === b };
      this.state.lastRoll = roll;
      if (roll.double) this.state.doubles += 1;
      return roll;
    },
    stepForward(player) {
      const from = player.pos;
      player.pos = (player.pos + 1) % 40;
      let salary = 0;
      if (player.pos === 0) {
        player.tokens += CONFIG.salary;
        salary = CONFIG.salary;
      }
      player.minTokens = Math.min(player.minTokens, player.tokens);
      return { from, to: player.pos, salary };
    },
    teleport(player, index, salary) {
      const from = player.pos;
      const wrapped = index <= from;
      player.pos = index;
      if (salary && (wrapped || index === 0)) {
        player.tokens += CONFIG.salary;
        return CONFIG.salary;
      }
      return 0;
    },

    /* ---------------- 落地判定（不改状态） ---------------- */
    describeLanding(player) {
      const tile = BOARD[player.pos];
      const prop = this.state.props[tile.id];

      if (tile.type === 'property' || tile.type === 'facility') {
        if (!prop.owner) {
          return { kind: 'property', action: 'buy', tile, price: tile.price, prop };
        }
        if (prop.owner === player.id) {
          return {
            kind: 'property', action: 'self', tile, prop,
            canUpgrade: this.canBuild(player, tile.id),
            cost: this.upgradeCost(tile.id),
            atMax: prop.algos.length >= CONFIG.maxAlgos,
            level: prop.algos.length
          };
        }
        if (prop.mortgaged) {
          return { kind: 'property', action: 'mortgaged', tile, prop, owner: this.player(prop.owner) };
        }
        return {
          kind: 'property', action: 'rent', tile, prop,
          owner: this.player(prop.owner),
          amount: this.rentFor(tile.id, this.state.lastRoll ? this.state.lastRoll.total : 7)
        };
      }
      if (tile.type === 'chance') return { kind: 'card', deck: 'chance', tile };
      if (tile.type === 'chest') return { kind: 'card', deck: 'chest', tile };
      if (tile.type === 'tax') return { kind: 'tax', tile, amount: tile.amount };
      if (tile.type === 'go') return { kind: 'go', tile, salary: 0 };
      if (tile.type === 'jail') return { kind: 'jail', tile, visiting: true };
      if (tile.type === 'parking') return { kind: 'parking', tile, amount: this.state.pot };
      if (tile.type === 'goToJail') return { kind: 'jail', tile, goto: true };
      return { kind: 'none', tile };
    },

    /* ---------------- 交易 ---------------- */
    buy(player, tileId) {
      const tile = BOARD[tileId];
      const prop = this.state.props[tileId];
      if (!tile || !prop || prop.owner || player.tokens < tile.price || !player.alive) return false;
      player.tokens -= tile.price;
      prop.owner = player.id;
      player.stats.buys += 1;
      player.minTokens = Math.min(player.minTokens, player.tokens);
      this.log(`${player.name} 买下【${tile.name}】，支付 ${util.fmt(tile.price)} token。`, 'good');
      return true;
    },
    canBuild(player, tileId, free) {
      const tile = BOARD[tileId];
      const prop = this.state.props[tileId];
      if (!tile || !prop || tile.type !== 'property') return false;
      if (prop.owner !== player.id || prop.mortgaged) return false;
      if (prop.algos.length >= CONFIG.maxAlgos) return false;
      if (!free && player.tokens < this.upgradeCost(tileId)) return false;
      return true;
    },
    build(player, tileId, free) {
      if (!this.canBuild(player, tileId, free)) return null;
      const tile = BOARD[tileId];
      const prop = this.state.props[tileId];
      const cost = free ? 0 : this.upgradeCost(tileId);
      const level = prop.algos.length + 1;
      if (!free) player.tokens -= cost;
      const algo = tile.algoSet[prop.algos.length];
      prop.algos.push(algo);
      player.stats.builds += 1;
      if (level > 1) player.stats.upgrades += 1;
      player.minTokens = Math.min(player.minTokens, player.tokens);
      this.log(
        `${player.name} 在【${tile.name}】${level === 1 ? '建造' : '升级'}了 Lv.${level} 算法建筑【${algo.name}】${free ? '（免费）' : `，支付 ${util.fmt(cost)} token`}。`,
        'good'
      );
      return algo;
    },
    sellAlgo(player, tileId) {
      const tile = BOARD[tileId];
      const prop = this.state.props[tileId];
      if (!tile || !prop || prop.owner !== player.id || !prop.algos.length || prop.mortgaged) return 0;
      const refund = Math.round(this.costAtLevel(tileId, prop.algos.length) * CONFIG.sellRatio);
      const algo = prop.algos.pop();
      player.tokens += refund;
      this.log(`${player.name} 拆除了【${tile.name}】的 Lv.${prop.algos.length + 1} 算法建筑【${algo.name}】，回收 ${util.fmt(refund)} token。`, 'warn');
      return refund;
    },
    mortgage(player, tileId) {
      const tile = BOARD[tileId];
      const prop = this.state.props[tileId];
      if (!tile || !prop || prop.owner !== player.id || prop.mortgaged) return 0;
      if (prop.algos && prop.algos.length) return 0;
      const amount = Math.round(tile.price * CONFIG.mortgageRatio);
      prop.mortgaged = true;
      player.tokens += amount;
      this.log(`${player.name} 抵押【${tile.name}】，获得 ${util.fmt(amount)} token。`, 'warn');
      return amount;
    },
    redeem(player, tileId) {
      const tile = BOARD[tileId];
      const prop = this.state.props[tileId];
      if (!tile || !prop || prop.owner !== player.id || !prop.mortgaged) return false;
      const cost = Math.round(tile.price * CONFIG.redeemRatio);
      if (player.tokens < cost) return false;
      player.tokens -= cost;
      prop.mortgaged = false;
      this.log(`${player.name} 赎回【${tile.name}】，支付 ${util.fmt(cost)} token。`, 'info');
      return true;
    },
    redeemCost(tile) {
      return Math.round(tile.price * CONFIG.redeemRatio);
    },

    /* ---------------- 支付与破产 ---------------- */
    liquidate(player, needed) {
      let raised = 0;
      const actions = [];
      const props = this.ownedTiles(player.id).sort((a, b) => this.investedIn(b.id) - this.investedIn(a.id));

      props.forEach((tile) => {
        const prop = this.state.props[tile.id];
        while (raised < needed && prop.algos.length && prop.owner === player.id) {
          const refund = Math.round(this.costAtLevel(tile.id, prop.algos.length) * CONFIG.sellRatio);
          const algo = prop.algos.pop();
          player.tokens += refund;
          raised += refund;
          actions.push({ text: `拆除【${tile.name}】的算法建筑【${algo.name}】，回收 ${util.fmt(refund)}`, type: 'warn' });
        }
      });

      props.forEach((tile) => {
        const prop = this.state.props[tile.id];
        if (raised >= needed) return;
        if (prop.owner !== player.id || prop.mortgaged || (prop.algos && prop.algos.length)) return;
        const amount = Math.round(tile.price * CONFIG.mortgageRatio);
        prop.mortgaged = true;
        player.tokens += amount;
        raised += amount;
        actions.push({ text: `抵押【${tile.name}】，获得 ${util.fmt(amount)}`, type: 'warn' });
      });

      actions.forEach((a) => this.log(`${player.name} ${a.text}。`, a.type));
      return { raised, actions };
    },
    charge(player, amount, creditor) {
      if (!player || !player.alive) return { ok: false, paid: 0, bankrupt: false, liquidated: 0 };
      let liquidated = 0;
      if (player.tokens < amount) {
        const res = this.liquidate(player, amount - player.tokens);
        liquidated = res.raised;
      }
      if (player.tokens >= amount) {
        player.tokens -= amount;
        if (creditor && creditor.alive) creditor.tokens += amount;
        player.minTokens = Math.min(player.minTokens, player.tokens);
        return { ok: true, paid: amount, bankrupt: false, liquidated };
      }

      const paid = Math.max(0, player.tokens);
      player.tokens = 0;
      if (creditor && creditor.alive) creditor.tokens += paid;
      this.eliminate(player);
      return { ok: false, paid, bankrupt: true, liquidated };
    },
    eliminate(player) {
      if (!player.alive) return;
      player.alive = false;
      player.tokens = 0;
      this.ownedTiles(player.id).forEach((tile) => {
        const prop = this.state.props[tile.id];
        prop.owner = null;
        prop.algos = [];
        prop.mortgaged = false;
      });
      this.log(`${player.name} 资金链断裂，破产退役。名下地块回到题库。`, 'bad');
      this.checkLastStanding();
    },
    gain(player, amount) {
      if (!player || !player.alive) return 0;
      player.tokens += amount;
      return amount;
    },
    payTax(player, amount) {
      const res = this.charge(player, amount, null);
      if (res.paid > 0) this.state.pot += res.paid;
      this.log(`${player.name} 缴纳罚时费 ${util.fmt(res.paid)} token，进入 AK 休息室。`, 'bad');
      return res;
    },
    payRent(player, tileId, diceTotal) {
      const tile = BOARD[tileId];
      const prop = this.state.props[tileId];
      if (!prop || !prop.owner) return null;
      if (prop.owner === player.id) return null;
      const owner = this.player(prop.owner);
      const amount = this.rentFor(tileId, diceTotal);
      if (amount <= 0) {
        this.log(`【${tile.name}】处于抵押状态，本次免租。`, 'info');
        return { amount: 0, owner, paid: 0, bankrupt: false };
      }
      const res = this.charge(player, amount, owner);
      player.stats.rentPaid += res.paid;
      if (owner) owner.stats.rentEarned += res.paid;
      if (res.bankrupt) {
        this.log(`${player.name} 付不起【${tile.name}】的租金，支付了全部 ${util.fmt(res.paid)} token。`, 'bad');
      } else {
        this.log(`${player.name} 向 ${owner.name} 支付【${tile.name}】租金 ${util.fmt(res.paid)} token。`, 'bad');
      }
      return { amount, paid: res.paid, owner, bankrupt: res.bankrupt, liquidated: res.liquidated };
    },
    collectFromEach(player, amount) {
      let total = 0;
      this.state.players.forEach((other) => {
        if (other.id === player.id || !other.alive) return;
        const res = this.charge(other, amount, player);
        total += res.paid;
        if (res.bankrupt) this.log(`${other.name} 因此破产。`, 'bad');
      });
      this.log(`${player.name} 从其他选手处共收取 ${util.fmt(total)} token。`, 'good');
      return total;
    },
    payRival(player, amount) {
      const rivals = this.alivePlayers().filter((p) => p.id !== player.id);
      if (!rivals.length) return null;
      const rival = util.pick(rivals);
      const res = this.charge(player, amount, rival);
      this.log(`${player.name} 向 ${rival.name} 支付 ${util.fmt(res.paid)} token。`, 'bad');
      return { rival, paid: res.paid, bankrupt: res.bankrupt };
    },
    gainPerBuild(player, amount) {
      const count = this.buildingCount(player.id);
      const total = count * amount;
      if (total > 0) this.gain(player, total);
      this.log(`${player.name} 的 ${count} 层算法建筑带来 ${util.fmt(total)} token 收益。`, total > 0 ? 'good' : 'info');
      return total;
    },
    /* 机惨：随机损坏玩家 1 层算法建筑；没有建筑的玩家赔钱 */
    destroyBuild(player, fallback) {
      if (!player || !player.alive) {
        return { player, tile: null, algo: null, level: 0, paid: 0, bankrupt: false };
      }
      const built = this.ownedTiles(player.id).filter((tile) => this.state.props[tile.id].algos.length > 0);
      if (!built.length) {
        const amount = Math.max(0, Number(fallback) || 0);
        let paid = 0;
        let bankrupt = false;
        if (amount > 0) {
          const res = this.charge(player, amount, null);
          paid = res.paid;
          bankrupt = res.bankrupt;
          this.log(`${player.name} 没有算法建筑可损坏，机惨赔偿 ${util.fmt(paid)} token。`, 'bad');
        } else {
          this.log(`${player.name} 没有算法建筑，成功躲过机惨。`, 'info');
        }
        return { player, tile: null, algo: null, level: 0, paid, bankrupt };
      }
      const tile = util.pick(built);
      const prop = this.state.props[tile.id];
      const level = prop.algos.length;
      const algo = prop.algos.pop();
      this.log(`💥 机惨：${player.name} 的【${tile.name}】Lv.${level} 建筑【${algo.name}】损坏，降为 Lv.${prop.algos.length}。`, 'bad');
      return { player, tile, algo, level, paid: 0, bankrupt: false };
    },
    machineCrash(fallback) {
      this.log('🔌 机房惨案：整层楼突然断电，所有选手的算法建筑随机损坏。', 'system');
      const results = [];
      this.state.players.filter((p) => p.alive).forEach((p) => {
        results.push(this.destroyBuild(p, fallback));
      });
      return results;
    },

    /* ---------------- 禁赛 ---------------- */
    sendToJail(player, reason) {
      player.pos = 10;
      player.inJail = true;
      player.jailTurns = 0;
      this.state.doubles = 0;
      this.log(`${player.name} 被送进禁赛区：${reason || '写暴力被裁判查重'}。`, 'bad');
    },
    jailRoll(player) {
      const roll = this.roll();
      if (roll.double) {
        player.inJail = false;
        player.jailTurns = 0;
        this.state.doubles = 0;
        this.log(`${player.name} 掷出双 ${roll.a}，申诉成功，离开禁赛区！`, 'good');
        return { roll, freed: true, forced: false };
      }
      player.jailTurns += 1;
      if (player.jailTurns >= CONFIG.jailTurns) {
        const res = this.charge(player, CONFIG.jailFine, null);
        if (res.paid > 0) this.state.pot += res.paid;
        player.inJail = false;
        player.jailTurns = 0;
        this.log(`${player.name} 三次申诉失败，强制缴纳罚金 ${util.fmt(res.paid)} token 后离开。`, 'warn');
        return { roll, freed: !res.bankrupt, forced: true, bankrupt: res.bankrupt, paid: res.paid };
      }
      this.log(`${player.name} 申诉失败（${roll.a}+${roll.b}），还要再等 ${CONFIG.jailTurns - player.jailTurns} 回合。`, 'warn');
      return { roll, freed: false, forced: false };
    },
    payJailFine(player) {
      if (!player.inJail || player.tokens < CONFIG.jailFine) return null;
      const res = this.charge(player, CONFIG.jailFine, null);
      player.inJail = false;
      player.jailTurns = 0;
      if (res.paid > 0) this.state.pot += res.paid;
      this.log(`${player.name} 缴纳罚金 ${util.fmt(res.paid)} token，离开禁赛区。`, 'warn');
      return res;
    },
    useGetOut(player) {
      if (!player.inJail || player.getOut <= 0) return false;
      player.getOut -= 1;
      player.inJail = false;
      player.jailTurns = 0;
      this.log(`${player.name} 使用「申诉信」，离开了禁赛区。`, 'good');
      return true;
    },

    /* ---------------- 事件卡 ---------------- */
    drawCard(deckName) {
      const deck = D.DECK[deckName];
      if (!deck || !deck.length) return null;
      let idx = util.randInt(0, deck.length - 1);
      const last = this.state.lastCard[deckName];
      if (deck.length > 1 && idx === last) idx = (idx + 1) % deck.length;
      this.state.lastCard[deckName] = idx;
      this.state.cardsDrawn += 1;
      return deck[idx];
    },
    applyMarket(groupId, mult, rounds, source) {
      const group = D.GROUPS[groupId];
      if (!group) return null;
      const entry = {
        group: groupId,
        groupName: group.name,
        color: group.color,
        mult,
        source: source || '',
        untilRound: this.state.round + (rounds || 8)
      };
      this.state.market = this.state.market.filter((m) => !(m.group === groupId && m.source === entry.source));
      this.state.market.push(entry);
      if (this.state.market.length > 4) this.state.market.shift();
      const pct = Math.round((mult - 1) * 100);
      this.log(`市场行情：${group.name}区租金 ${pct >= 0 ? '+' : ''}${pct}%（至第 ${entry.untilRound} 回合）。`, mult >= 1 ? 'good' : 'bad');
      return entry;
    },
    randomMarket(mult, rounds) {
      const groupId = util.pick(D.GROUP_ORDER);
      return this.applyMarket(groupId, mult, rounds, '卡牌');
    },
    freeBuildRandom(player) {
      const candidates = this.ownedTiles(player.id).filter((t) => {
        const prop = this.state.props[t.id];
        return t.type === 'property' && !prop.mortgaged && prop.algos.length < CONFIG.maxAlgos;
      });
      if (!candidates.length) {
        this.gain(player, 600);
        this.log(`${player.name} 没有可施工的地块，改领 600 token 补偿。`, 'warn');
        return null;
      }
      const tile = util.pick(candidates);
      return this.build(player, tile.id, true);
    },
    applyCard(player, card) {
      const effect = card.effect;
      switch (effect.type) {
        case 'gain': {
          this.gain(player, effect.amount);
          this.log(`${player.name} 获得 ${util.fmt(effect.amount)} token。`, 'good');
          return { done: true };
        }
        case 'pay': {
          const res = this.charge(player, effect.amount, null);
          this.log(`${player.name} 支付 ${util.fmt(res.paid)} token。`, 'bad');
          return { done: true, bankrupt: res.bankrupt };
        }
        case 'payRival': {
          const res = this.payRival(player, effect.amount);
          return { done: true, bankrupt: res && res.bankrupt };
        }
        case 'collectEach': {
          this.collectFromEach(player, effect.amount);
          return { done: true };
        }
        case 'jail': {
          this.sendToJail(player, effect.reason || '写暴力被裁判查重');
          return { done: true, jailed: true };
        }
        case 'getOut': {
          player.getOut += 1;
          this.log(`${player.name} 获得一张「申诉信」。`, 'good');
          return { done: true };
        }
        case 'diceGain': {
          const a = util.randInt(1, 6);
          const b = util.randInt(1, 6);
          const amount = (a + b) * effect.mult;
          this.gain(player, amount);
          this.log(`${player.name} 掷出 ${a}+${b}，玄学 AC 获得 ${util.fmt(amount)} token。`, 'good');
          return { done: true, dice: { a, b, total: a + b }, amount };
        }
        case 'freeBuild': {
          const algo = this.freeBuildRandom(player);
          return { done: true, algo };
        }
        case 'destroyBuild': {
          const destroyed = this.destroyBuild(player, effect.fallback || CONFIG.machineCrashPay);
          return { done: true, destroyed, bankrupt: destroyed.bankrupt };
        }
        case 'machineCrash': {
          const crashed = this.machineCrash(effect.amount || CONFIG.machineCrashPay);
          const bankrupt = crashed.some((r) => r.bankrupt);
          return { done: true, machineCrash: crashed, bankrupt };
        }
        case 'gainPerBuild': {
          const amount = this.gainPerBuild(player, effect.amount);
          return { done: true, amount };
        }
        case 'market': {
          const entry = this.randomMarket(effect.mult, effect.rounds);
          return { done: true, market: entry };
        }
        case 'moveTo': {
          return { done: false, moveTo: effect.index, salary: effect.salary };
        }
        case 'moveBy': {
          return { done: false, moveBy: effect.steps };
        }
        default:
          return { done: true };
      }
    },

    /* ---------------- 回合 ---------------- */
    endTurn() {
      const st = this.state;
      if (st.over) return { finished: true };
      const cur = this.current();
      const canDouble = st.lastRoll && st.lastRoll.double && st.doubles > 0 && st.doubles < 3 && !cur.inJail;
      if (canDouble) {
        st.phase = 'roll';
        st.turnSerial += 1;
        return { same: true, player: cur };
      }

      st.doubles = 0;
      st.lastRoll = null;

      const alive = st.players;
      let next = st.current;
      let wrapped = false;
      for (let i = 1; i <= alive.length; i++) {
        const idx = (st.current + i) % alive.length;
        if (alive[idx].alive) {
          next = idx;
          if (idx <= st.current) wrapped = true;
          break;
        }
      }

      if (!alive[next].alive) {
        return this.finish('last');
      }

      if (wrapped) {
        st.round += 1;
        this.expireMarket();
        if (st.round > st.maxRounds) {
          return this.finish('rounds');
        }
      }

      st.current = next;
      st.phase = alive[next].inJail ? 'jail' : 'roll';
      st.turnSerial += 1;
      return {
        same: false,
        player: alive[next],
        wrapped,
        round: st.round,
        finished: false
      };
    },
    expireMarket() {
      const before = this.state.market.length;
      this.state.market = this.state.market.filter((m) => m.untilRound > this.state.round);
      if (this.state.market.length < before) {
        this.log('部分市场行情已经过期。', 'info');
      }
    },
    nextRoundNews() {
      const st = this.state;
      if (st.round % 4 !== 0) return null;
      const candidates = D.NEWS.filter((n) => n.group !== (st.market[0] && st.market[0].group));
      const news = util.pick(candidates.length ? candidates : D.NEWS);
      const entry = this.applyMarket(news.group, news.mult, 6, '行情');
      this.log(`📡 ${news.text}`, 'system');
      return { news, entry };
    },
    checkLastStanding() {
      if (this.state.over) return false;
      if (this.alivePlayers().length <= 1) {
        this.finish('last');
        return true;
      }
      return false;
    },
    finish(reason) {
      const st = this.state;
      if (st.over) return { finished: true, ranking: st.ranking, winner: st.winner };
      st.over = true;
      st.phase = 'over';
      const sorted = st.players.slice().sort((a, b) => {
        const aw = a.alive ? this.netWorth(a) : -1;
        const bw = b.alive ? this.netWorth(b) : -1;
        if (bw !== aw) return bw - aw;
        return b.tokens - a.tokens;
      });
      st.ranking = sorted;
      st.winner = sorted[0];
      st.endReason = reason;
      this.log(
        reason === 'rounds'
          ? `比赛结束：${st.round - 1} 回合赛程耗尽，按总资产结算。`
          : `比赛结束：${sorted[0].name} 成为最后的赢家。`,
        'system'
      );
      return { finished: true, ranking: sorted, winner: sorted[0], reason };
    },

    /* ---------------- AI ---------------- */
    aiShouldBuy(player, tile) {
      const ai = player.ai || {};
      const prop = this.state.props[tile.id];
      if (!prop || prop.owner) return false;
      if (player.tokens < tile.price) return false;
      const reserve = Math.max(1800, player.tokens * (ai.reserve || 0.15));
      if (player.tokens - tile.price < reserve && !this.ownsGroup(player.id, tile.group)) return false;
      let chance = (ai.buy || 0.7) * (this.state.aiFactor || 1);
      const owned = this.groupProgress(player.id, tile.group);
      if (owned === 2) chance += 0.25;
      if (owned === 1) chance += 0.08;
      if (tile.price > player.tokens * 0.55) chance -= 0.15;
      if (this.state.difficulty === 'hard') chance += 0.06;
      chance = util.clamp(chance, 0.08, 0.97);
      return Math.random() < chance;
    },
    aiBuildChoice(player) {
      const ai = player.ai || {};
      const targets = this.ownedTiles(player.id).filter((t) => this.canBuild(player, t.id));
      if (!targets.length) return null;
      const reserve = Math.max(3000, player.tokens * (ai.reserve || 0.15));
      if (player.tokens - this.upgradeCost(targets[0].id) < reserve) return null;
      let chance = (ai.build || 0.6) * (this.state.aiFactor || 1);
      if (player.tokens > 30000) chance += 0.15;
      if (Math.random() > util.clamp(chance, 0.1, 0.95)) return null;
      targets.sort((a, b) => b.rent[Math.min(4, this.state.props[b.id].algos.length + 1)]
        - a.rent[Math.min(4, this.state.props[a.id].algos.length + 1)]);
      return targets[0];
    },
    aiJailChoice(player) {
      if (player.getOut > 0) return 'card';
      const ai = player.ai || {};
      if (player.tokens > CONFIG.jailFine + 8000 && Math.random() < (ai.jailPay || 0.4)) return 'pay';
      return 'roll';
    },
    aiShouldUpgrade(player, tileId) {
      if (!this.canBuild(player, tileId)) return false;
      const ai = player.ai || {};
      const cost = this.upgradeCost(tileId);
      const reserve = Math.max(2200, player.tokens * (ai.reserve || 0.15));
      if (player.tokens - cost < reserve) return false;
      return Math.random() < util.clamp((ai.build || 0.6) * 1.05, 0.15, 0.95);
    }
  };

  OI.Game = Game;
})(window.OI = window.OI || {});
