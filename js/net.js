/* ============================================================
   信奥大富翁 · 局域网联机客户端
   房主权威（host-authoritative）：房主浏览器跑规则引擎，
   其他浏览器通过 HTTP 轮询接收快照、发送操作。
   ============================================================ */
(function (OI) {
  'use strict';

  const net = {
    mode: 'local',          // local | host | guest
    room: null,             // 房间号
    token: null,            // 本机令牌
    slot: 0,                // 本机座位号
    name: '',
    started: false,
    players: [],
    config: null,
    lastIndex: 0,
    polling: false,
    closed: false,
    pollTimer: null,
    snapshotTimer: null,
    pendingSnapshot: null,
    snapshotBusy: false,
    lastSnapshotJson: '',
    errorCount: 0,

    onRoom: null,
    onStart: null,
    onAction: null,
    onSnapshot: null,
    onError: null,
    onClose: null,

    isLan() { return this.mode === 'host' || this.mode === 'guest'; },

    async post(path, body) {
      const res = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body || {}),
        cache: 'no-store'
      });
      let data = {};
      try { data = await res.json(); } catch (e) { data = {}; }
      if (!res.ok || !data.ok) throw new Error(data.error || ('HTTP ' + res.status));
      return data;
    },

    async health() {
      try {
        const res = await fetch('/api/health', { cache: 'no-store' });
        if (!res.ok) return null;
        return await res.json();
      } catch (e) {
        return null;
      }
    },

    reset() {
      this.mode = 'local';
      this.room = null;
      this.token = null;
      this.slot = 0;
      this.started = false;
      this.players = [];
      this.config = null;
      this.lastIndex = 0;
      this.polling = false;
      this.closed = false;
      this.errorCount = 0;
      clearTimeout(this.pollTimer);
      clearTimeout(this.snapshotTimer);
      this.pollTimer = null;
      this.snapshotTimer = null;
      this.pendingSnapshot = null;
      this.snapshotBusy = false;
      this.lastSnapshotJson = '';
    },

    async createRoom(name, config) {
      const data = await this.post('/api/create', { name, config });
      this.mode = 'host';
      this.room = data.room;
      this.token = data.token;
      this.slot = data.slot;
      this.started = false;
      this.lastIndex = 0;
      this.applyRoom(data.view);
      this.startPolling();
      return data;
    },

    async joinRoom(code, name) {
      const data = await this.post('/api/join', { room: String(code || '').trim(), name });
      this.mode = 'guest';
      this.room = data.room;
      this.token = data.token;
      this.slot = data.slot;
      this.started = false;
      this.lastIndex = 0;
      this.applyRoom(data.view);
      this.startPolling();
      return data;
    },

    applyRoom(view) {
      if (!view) return;
      this.room = view.code || this.room;
      this.players = view.players || [];
      this.config = view.config || this.config;
      this.started = !!view.started;
    },

    startPolling() {
      if (this.polling) return;
      this.polling = true;
      this.closed = false;
      this.poll();
    },

    stopPolling() {
      this.polling = false;
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    },

    async poll() {
      if (!this.polling || !this.room || !this.token) return;
      try {
        const url = '/api/state?room=' + encodeURIComponent(this.room) +
          '&token=' + encodeURIComponent(this.token) + '&since=' + this.lastIndex;
        const res = await fetch(url, { cache: 'no-store' });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const data = await res.json();
        if (!data.ok) throw new Error(data.error || '房间状态异常');
        this.errorCount = 0;
        if (data.oldest != null && this.lastIndex < data.oldest - 1) {
          this.lastIndex = Math.max(0, data.oldest - 1);
        }
        const messages = data.messages || [];
        messages.forEach((msg) => this.handleMessage(msg));
        if (data.cursor != null) this.lastIndex = Math.max(this.lastIndex, data.cursor);
      } catch (e) {
        try {
          window.__NET_ERRORS = window.__NET_ERRORS || [];
          window.__NET_ERRORS.push(String(e && e.stack ? e.stack : e));
          if (window.__NET_ERRORS.length > 10) window.__NET_ERRORS.shift();
        } catch (x) { /* ignore */ }
        this.errorCount += 1;
        if (this.errorCount === 3 && this.onError) {
          this.onError('与服务器的连接不太稳定，正在重试……');
        }
        if (this.errorCount >= 12) {
          this.stopPolling();
          if (this.onClose) this.onClose('与服务器断开连接');
          return;
        }
      }
      if (this.polling) {
        this.pollTimer = setTimeout(() => this.poll(), this.mode === 'guest' ? 380 : 460);
      }
    },

    handleMessage(msg) {
      try {
        window.__NET_MSGS = window.__NET_MSGS || [];
        window.__NET_MSGS.push({
          type: msg && msg.type, i: msg && msg.i, mode: this.mode,
          hasStart: typeof this.onStart, hasSnap: typeof this.onSnapshot,
          hasPayload: !!(msg && msg.payload)
        });
        if (window.__NET_MSGS.length > 60) window.__NET_MSGS.shift();
      } catch (e) { /* ignore */ }
      if (!msg || !msg.type) return;
      if (msg.type === 'room') {
        this.applyRoom(msg.payload);
        if (this.onRoom) this.onRoom(msg.payload);
      } else if (msg.type === 'start') {
        this.started = true;
        this.config = msg.payload.config || this.config;
        if (this.mode === 'guest' && this.onStart) this.onStart(msg.payload);
      } else if (msg.type === 'snapshot') {
        if (this.mode === 'guest' && this.onSnapshot) this.onSnapshot(msg.payload);
      } else if (msg.type === 'action') {
        if (this.mode === 'host' && this.onAction) this.onAction(msg.from, msg.payload);
      } else if (msg.type === 'closed') {
        this.stopPolling();
        if (this.onClose) this.onClose(msg.payload && msg.payload.reason || '房间已关闭');
      }
    },

    async send(type, payload, toSlot) {
      if (!this.room || !this.token) throw new Error('尚未加入房间');
      return this.post('/api/send', {
        room: this.room,
        token: this.token,
        type,
        payload,
        toSlot: toSlot == null ? null : toSlot
      });
    },

    sendAction(payload) {
      return this.send('action', payload, 0);
    },

    setConfig(config) {
      return this.send('config', config);
    },

    startGame(config) {
      return this.post('/api/start', { room: this.room, token: this.token, config });
    },

    /* 房主把权威状态推给所有客机。合并 120ms 内的多次请求。 */
    hostSnapshot(snapshot) {
      if (this.mode !== 'host' || !this.room) return;
      this.pendingSnapshot = snapshot;
      if (this.snapshotTimer || this.snapshotBusy) return;
      this.snapshotTimer = setTimeout(() => {
        this.snapshotTimer = null;
        this.flushSnapshot();
      }, 120);
    },

    async flushSnapshot() {
      if (this.mode !== 'host' || !this.pendingSnapshot) return;
      if (this.snapshotBusy) return;
      const snap = this.pendingSnapshot;
      this.pendingSnapshot = null;
      let json = '';
      try { json = JSON.stringify(snap.state); } catch (e) { return; }
      if (json === this.lastSnapshotJson) return;
      this.lastSnapshotJson = json;
      this.snapshotBusy = true;
      try {
        await this.send('snapshot', snap);
      } catch (e) {
        /* 忽略单次快照失败，下一次 refresh 会补上 */
      }
      this.snapshotBusy = false;
      if (this.pendingSnapshot) {
        this.snapshotTimer = setTimeout(() => {
          this.snapshotTimer = null;
          this.flushSnapshot();
        }, 100);
      }
    },

    leave(silent) {
      const room = this.room;
      const token = this.token;
      if (room && token) {
        try {
          fetch('/api/leave', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ room, token }),
            keepalive: true
          });
        } catch (e) { /* ignore */ }
      }
      this.stopPolling();
      this.reset();
      if (!silent && this.onClose) this.onClose('');
    }
  };

  OI.Net = net;
})(window.OI = window.OI || {});
