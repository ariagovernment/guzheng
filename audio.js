'use strict';
// 撥弦音色合成（Karplus-Strong），不需要音檔
const Sound = (() => {
  let ctx = null;
  const cache = new Map();

  function ensure() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      // iOS 17+：設成 playback 讓靜音鍵開啟時仍可出聲
      try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) {}
      ctx = new AC();
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  // iOS 需要在使用者觸控事件中先播放一次聲音才能解鎖
  function unlock() {
    const c = ensure();
    if (!c) return;
    const src = c.createBufferSource();
    src.buffer = c.createBuffer(1, 1, c.sampleRate);
    src.connect(c.destination);
    src.start(0);
  }

  function pluckBuffer(midi) {
    if (cache.has(midi)) return cache.get(midi);
    const sr = ctx.sampleRate;
    const freq = 440 * Math.pow(2, (midi - 69) / 12);
    const len = Math.floor(sr * 2.4);
    const buf = ctx.createBuffer(1, len, sr);
    const out = buf.getChannelData(0);
    const period = Math.max(2, Math.round(sr / freq));
    const ring = new Float32Array(period);

    // 初始雜訊稍微低通，低音較柔和、高音較亮
    const soft = midi < 55 ? 0.6 : midi < 70 ? 0.4 : 0.2;
    let prev = 0;
    for (let i = 0; i < period; i++) {
      prev = prev * soft + (Math.random() * 2 - 1) * (1 - soft);
      ring[i] = prev;
    }

    const decay = Math.pow(0.001, 1 / (sr * 3));
    let p = 0, peak = 0;
    for (let i = 0; i < len; i++) {
      const cur = ring[p];
      const next = ring[(p + 1) % period];
      ring[p] = (cur + next) * 0.5 * decay;
      out[i] = cur;
      peak = Math.max(peak, Math.abs(cur));
      p = (p + 1) % period;
    }
    // 正規化並在尾端淡出
    const fade = Math.floor(sr * 0.3);
    const gain = peak > 0 ? 0.9 / peak : 1;
    for (let i = 0; i < len; i++) {
      out[i] *= gain * (i > len - fade ? (len - i) / fade : 1);
    }
    cache.set(midi, buf);
    return buf;
  }

  function play(midi) {
    const c = ensure();
    if (!c) return;
    const src = c.createBufferSource();
    src.buffer = pluckBuffer(midi);
    const g = c.createGain();
    g.gain.value = 0.55;
    src.connect(g);
    g.connect(c.destination);
    src.start();
  }

  return { unlock, play };
})();
