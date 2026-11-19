/* ============================================================
   信奥大富翁 · 通用工具 / 存档 / 合成音效
   ============================================================ */
(function (OI) {
  'use strict';

  let uidSeed = 0;

  const util = {
    randInt(min, max) {
      return Math.floor(min + Math.random() * (max - min + 1));
    },
    pick(arr) {
      return arr[Math.floor(Math.random() * arr.length)];
    },
    shuffle(arr) {
      const out = arr.slice();
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const t = out[i];
        out[i] = out[j];
        out[j] = t;
      }
      return out;
    },
    clamp(v, min, max) {
      return Math.max(min, Math.min(max, v));
    },
    uid(prefix) {
      uidSeed += 1;
      return (prefix || 'id') + uidSeed;
    },
    escapeHtml(str) {
      return String(str).replace(/[&<>"']/g, (ch) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
      }[ch]));
    },
    sleep(ms) {
      return new Promise((resolve) => setTimeout(resolve, ms));
    },
    roundTo(n, step) {
      if (!step) return Math.round(n);
      return Math.round(n / step) * step;
    },
    fmt(n) {
      const v = Math.round(Number(n) || 0);
      return v.toLocaleString('en-US');
    },
    fmtSigned(n) {
      const v = Math.round(Number(n) || 0);
      if (v > 0) return '+' + v.toLocaleString('en-US');
      if (v < 0) return '-' + Math.abs(v).toLocaleString('en-US');
      return '0';
    },
    fmtCompact(n) {
      const v = Math.round(Number(n) || 0);
      const abs = Math.abs(v);
      const sign = v < 0 ? '-' : '';
      if (abs >= 1000000) return sign + (abs / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
      if (abs >= 10000) return sign + (abs / 10000).toFixed(1).replace(/\.0$/, '') + 'w';
      return sign + abs.toLocaleString('en-US');
    },
    plural(n, one, many) {
      return n + ' ' + (n === 1 ? one : many);
    },
    reducedMotion() {
      try {
        return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      } catch (e) {
        return false;
      }
    }
  };

  const storage = {
    get(key, fallback) {
      try {
        const raw = window.localStorage.getItem(key);
        if (raw == null) return fallback;
        return JSON.parse(raw);
      } catch (e) {
        return fallback;
      }
    },
    set(key, value) {
      try {
        window.localStorage.setItem(key, JSON.stringify(value));
        return true;
      } catch (e) {
        return false;
      }
    }
  };

  /* ---------- 合成音效（无外部素材） ---------- */
  const sound = (function () {
    const NOTE = {
      A3: 220.0, C4: 261.63, D4: 293.66, E4: 329.63, F4: 349.23,
      G4: 392.0, A4: 440.0, B4: 493.88, C5: 523.25, D5: 587.33,
      E5: 659.25, G5: 783.99, A5: 880.0, C6: 1046.5, E6: 1318.5
    };
    let ctx = null;
    let master = null;
    let enabled = storage.get(OI.DATA.STORAGE.sound, true) !== false;

    function ensure() {
      if (!enabled) return null;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      if (!ctx) {
        try {
          ctx = new AC();
          master = ctx.createGain();
          master.gain.value = 0.5;
          master.connect(ctx.destination);
        } catch (e) {
          ctx = null;
          return null;
        }
      }
      if (ctx.state === 'suspended') {
        try { ctx.resume(); } catch (e) { /* ignore */ }
      }
      return ctx;
    }

    function tone(freq, dur, type, gain, when, slideTo) {
      const ac = ensure();
      if (!ac) return;
      const t0 = ac.currentTime + (when || 0);
      const osc = ac.createOscillator();
      const g = ac.createGain();
      osc.type = type || 'sine';
      osc.frequency.setValueAtTime(Math.max(30, freq), t0);
      if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(30, slideTo), t0 + dur);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain || 0.05), t0 + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(g);
      g.connect(master);
      osc.start(t0);
      osc.stop(t0 + dur + 0.03);
    }

    function noise(dur, gain, when, filterFreq) {
      const ac = ensure();
      if (!ac) return;
      try {
        const len = Math.floor(ac.sampleRate * dur);
        const buffer = ac.createBuffer(1, len, ac.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
        const src = ac.createBufferSource();
        src.buffer = buffer;
        const filter = ac.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.value = filterFreq || 1200;
        filter.Q.value = 0.8;
        const g = ac.createGain();
        g.gain.value = gain || 0.05;
        src.connect(filter);
        filter.connect(g);
        g.connect(master);
        src.start(ac.currentTime + (when || 0));
      } catch (e) { /* ignore */ }
    }

    function play(name) {
      if (!enabled) return;
      switch (name) {
        case 'click':
          tone(620, 0.05, 'triangle', 0.035);
          break;
        case 'dice':
          noise(0.16, 0.05, 0, 2200);
          tone(240, 0.08, 'square', 0.025, 0.02, 160);
          break;
        case 'step':
          tone(360, 0.045, 'triangle', 0.024);
          break;
        case 'buy':
          tone(NOTE.E5, 0.1, 'triangle', 0.05);
          tone(NOTE.A5, 0.16, 'triangle', 0.045, 0.08);
          break;
        case 'build':
          tone(NOTE.C5, 0.08, 'square', 0.03);
          tone(NOTE.G5, 0.14, 'triangle', 0.04, 0.07);
          noise(0.08, 0.03, 0.02, 1800);
          break;
        case 'sell':
          tone(300, 0.14, 'sawtooth', 0.025, 0, 220);
          break;
        case 'rent':
          tone(180, 0.18, 'sawtooth', 0.03, 0, 140);
          tone(140, 0.24, 'triangle', 0.035, 0.1);
          break;
        case 'card':
          noise(0.06, 0.03, 0, 3000);
          tone(520, 0.12, 'sine', 0.03, 0.04, 780);
          break;
        case 'good':
          [NOTE.C5, NOTE.E5, NOTE.G5].forEach((f, i) => tone(f, 0.18, 'triangle', 0.045, i * 0.07));
          break;
        case 'bad':
          [NOTE.G4, NOTE.E4, NOTE.C4].forEach((f, i) => tone(f, 0.2, 'sine', 0.04, i * 0.08));
          break;
        case 'jail':
          tone(110, 0.45, 'sawtooth', 0.04, 0, 70);
          noise(0.22, 0.045, 0.05, 600);
          break;
        case 'freed':
          [NOTE.E4, NOTE.G4, NOTE.C5, NOTE.E5].forEach((f, i) => tone(f, 0.22, 'triangle', 0.045, i * 0.08));
          break;
        case 'turn':
          tone(440, 0.09, 'triangle', 0.03);
          tone(660, 0.12, 'triangle', 0.028, 0.06);
          break;
        case 'win':
          [NOTE.C5, NOTE.E5, NOTE.G5, NOTE.C6, NOTE.E6].forEach((f, i) => tone(f, 0.36, 'triangle', 0.055, i * 0.1));
          break;
        case 'lose':
          [NOTE.G4, NOTE.E4, NOTE.C4, NOTE.A3].forEach((f, i) => tone(f, 0.3, 'sine', 0.05, i * 0.12));
          break;
        case 'achievement':
          [NOTE.E5, NOTE.A5, NOTE.C6, NOTE.E6].forEach((f, i) => tone(f, 0.28, 'sine', 0.05, i * 0.09));
          break;
        case 'news':
          tone(880, 0.08, 'sine', 0.03);
          tone(660, 0.12, 'sine', 0.025, 0.08);
          break;
        default:
          break;
      }
    }

    return {
      play,
      get enabled() { return enabled; },
      setEnabled(v) {
        enabled = !!v;
        storage.set(OI.DATA.STORAGE.sound, enabled);
        if (enabled) play('click');
      },
      toggle() {
        this.setEnabled(!enabled);
        return enabled;
      },
      unlock() { ensure(); }
    };
  })();

  OI.util = util;
  OI.storage = storage;
  OI.sound = sound;
})(window.OI = window.OI || {});
