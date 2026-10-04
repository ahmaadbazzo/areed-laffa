/* ============================================================
   AREED LAFFA — Cinematic audio engine (100% synthesized, no files)
   • evolving generative score, one "key & mood" per scene
   • convolution reverb + ping-pong style delay + limiter
   • UI sound design: shutter, whoosh, impact, riser, chimes...
   ============================================================ */
(function () {
  'use strict';
  const A = {};
  let ctx = null, limiter, master, musicBus, musicFilter, sfxBus, revIn, revOut, dlyIn, analyser, noiseBuf;
  let airSrc = null, airFilter = null, airGain = null;
  const pads = [];
  const st = {
    vol: 0.8, music: true, fx: true, scene: 'home', step: 0, bar: 0, next: 0,
    timer: null, unlocked: false, started: false, hidden: false, level: 0,
  };
  const buf16 = new Uint8Array(256);

  try {
    const v = localStorage.getItem('al_vol'); if (v !== null) st.vol = Math.max(0, Math.min(1, +v));
    if (localStorage.getItem('al_music') === '0') st.music = false;
    if (localStorage.getItem('al_fx') === '0') st.fx = false;
  } catch (e) {}
  const save = () => { try { localStorage.setItem('al_vol', st.vol); localStorage.setItem('al_music', st.music ? 1 : 0); localStorage.setItem('al_fx', st.fx ? 1 : 0); } catch (e) {} };

  const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);
  const rnd = (seed) => () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

  /* ---------- scene "moods" ---------- */
  const DOR = [0, 2, 3, 5, 7, 9, 10], AEO = [0, 2, 3, 5, 7, 8, 10], LYD = [0, 2, 4, 6, 7, 9, 11], MAJ = [0, 2, 4, 5, 7, 9, 11], PHR = [0, 1, 3, 5, 7, 8, 10];
  const SC = {
    home:    { root: 50, mode: DOR, bpm: 78, prog: [0, 3, 6, 4], cut: 1500, air: 1100, kick: 'x.......x.......', hat: '..x...x...x...x.', arp: 'x..x..x.x..x..x.', arpOct: 2, arpKind: 'pluck', bell: .55, kv: .42, timp: 0, bassPulse: 0 },
    friend1: { root: 45, mode: AEO, bpm: 92, prog: [0, 5, 2, 6], cut: 1900, air: 900,  kick: 'x.....x...x.....', hat: 'x.x.x.x.x.x.x.x.', arp: 'x.xx.x.xx.x.xx.x', arpOct: 2, arpKind: 'pluck', bell: .25, kv: .5, timp: 0, bassPulse: 1 },
    friend2: { root: 52, mode: AEO, bpm: 100, prog: [0, 4, 5, 3], cut: 1100, air: 700, kick: 'x..x..x...x..x..', hat: '..x...x...x...xx', arp: 'x...x...x.x.x...', arpOct: 1, arpKind: 'pluck', bell: .2, kv: .62, timp: 0, bassPulse: 1 },
    friend3: { root: 53, mode: LYD, bpm: 84, prog: [0, 1, 4, 5], cut: 2400, air: 1600, kick: 'x.......x.......', hat: '', arp: 'x.x.x.x.x.x.x.x.', arpOct: 2, arpKind: 'bell', bell: .6, kv: .36, timp: 0, bassPulse: 0 },
    bazzo:   { root: 48, mode: MAJ, bpm: 96, prog: [0, 4, 5, 3], cut: 2800, air: 1400, kick: 'x.......x.......', hat: 'x.x.x.x.x.x.x.x.', arp: 'x..x..x.x..x..x.', arpOct: 2, arpKind: 'pluck', bell: .35, kv: .55, timp: 0, bassPulse: 1 },
    majd:    { root: 56, mode: PHR, bpm: 72, prog: [0, 1, 0, 6], cut: 1000, air: 800, kick: '', hat: '', arp: 'x.....x.....x...', arpOct: 2, arpKind: 'bell', bell: .7, kv: 0, timp: 0, bassPulse: 0 },
    all:     { root: 50, mode: MAJ, bpm: 90, prog: [0, 4, 5, 3], cut: 2600, air: 1500, kick: 'x.......x.......', hat: '..x...x...x...x.', arp: 'x.x.x.x.x.x.x.x.', arpOct: 2, arpKind: 'pluck', bell: .5, kv: .5, timp: 0, bassPulse: 0 },
    credits: { root: 50, mode: MAJ, bpm: 66, prog: [5, 3, 0, 4], cut: 2100, air: 1000, kick: '', hat: '', arp: 'x.....x.....x...', arpOct: 2, arpKind: 'bell', bell: .5, kv: 0, timp: 1, bassPulse: 0 },
  };
  const scOf = () => SC[st.scene] || SC.home;
  const midiOf = (sc, d) => { const o = Math.floor(d / 7), i = ((d % 7) + 7) % 7; return sc.root + sc.mode[i] + 12 * o; };

  /* ---------- graph ---------- */
  function makeIR(sec, decay) {
    const len = (ctx.sampleRate * sec) | 0, b = ctx.createBuffer(2, len, ctx.sampleRate), pre = (ctx.sampleRate * 0.018) | 0;
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c); let lp = 0;
      for (let i = 0; i < len; i++) {
        const t = i / len, n = Math.random() * 2 - 1;
        lp += (n - lp) * (0.5 - 0.42 * t);
        d[i] = i < pre ? 0 : lp * Math.pow(1 - t, decay) * 1.9;
      }
    }
    return b;
  }
  function makeNoise() {
    const len = ctx.sampleRate * 2, b = ctx.createBuffer(1, len, ctx.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }
  function build(c, dest) {
    ctx = c;
    limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -12; limiter.knee.value = 10; limiter.ratio.value = 8; limiter.attack.value = 0.004; limiter.release.value = 0.25;
    master = ctx.createGain(); master.gain.value = st.vol * st.vol;
    analyser = ctx.createAnalyser && ctx.createAnalyser(); if (analyser) analyser.fftSize = 256;
    limiter.connect(master); if (analyser) master.connect(analyser); master.connect(dest || ctx.destination);

    musicBus = ctx.createGain(); musicBus.gain.value = st.music ? 0.78 : 0;
    musicFilter = ctx.createBiquadFilter(); musicFilter.type = 'lowpass'; musicFilter.frequency.value = 16000; musicFilter.Q.value = 0.4;
    musicBus.connect(musicFilter); musicFilter.connect(limiter);

    sfxBus = ctx.createGain(); sfxBus.gain.value = st.fx ? 1.2 : 0; sfxBus.connect(limiter);

    const conv = ctx.createConvolver(); conv.buffer = makeIR(3.6, 2.4);
    revIn = ctx.createGain(); revOut = ctx.createGain(); revOut.gain.value = 0.55;
    const revHP = ctx.createBiquadFilter(); revHP.type = 'highpass'; revHP.frequency.value = 220;
    revIn.connect(revHP); revHP.connect(conv); conv.connect(revOut); revOut.connect(limiter);

    // delay (dotted-eighth feel, darkened feedback)
    dlyIn = ctx.createGain();
    const dl = ctx.createDelay(1.5), fb = ctx.createGain(), dlp = ctx.createBiquadFilter(), dOut = ctx.createGain();
    dl.delayTime.value = 0.36; fb.gain.value = 0.38; dlp.type = 'lowpass'; dlp.frequency.value = 2400; dOut.gain.value = 0.5;
    dlyIn.connect(dl); dl.connect(dlp); dlp.connect(fb); fb.connect(dl); dlp.connect(dOut); dOut.connect(limiter); dOut.connect(revIn);

    noiseBuf = makeNoise();
  }
  const send = (node, dest, amt) => { const g = ctx.createGain(); g.gain.value = amt; node.connect(g); g.connect(dest); return g; };
  const noiseSrc = (t, loop) => { const s = ctx.createBufferSource(); s.buffer = noiseBuf; s.loop = !!loop; s.playbackRate.value = 0.9 + Math.random() * 0.2; return s; };

  /* ---------- instruments ---------- */
  function pluck(t, f, v, kind) {
    const dec = kind === 'sub' ? 0.5 : 0.75;
    const o = ctx.createOscillator(), o2 = ctx.createOscillator(), lp = ctx.createBiquadFilter(), g = ctx.createGain();
    o.type = 'triangle'; o2.type = 'sine'; o.frequency.value = f; o2.frequency.value = f * 2; o.detune.value = -4; o2.detune.value = 5;
    lp.type = 'lowpass'; lp.Q.value = 3; lp.frequency.setValueAtTime(4200, t); lp.frequency.exponentialRampToValueAtTime(520, t + dec);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(v, t + 0.006); g.gain.exponentialRampToValueAtTime(0.0001, t + dec);
    const m2 = ctx.createGain(); m2.gain.value = 0.28;
    o.connect(lp); o2.connect(m2); m2.connect(lp); lp.connect(g); g.connect(musicBus);
    send(g, revIn, 0.38); send(g, dlyIn, 0.42);
    o.start(t); o2.start(t); o.stop(t + dec + 0.05); o2.stop(t + dec + 0.05);
  }
  function bell(t, f, v, dest) {
    const c = ctx.createOscillator(), m = ctx.createOscillator(), mg = ctx.createGain(), g = ctx.createGain();
    c.type = 'sine'; m.type = 'sine'; c.frequency.value = f; m.frequency.value = f * 3.5;
    mg.gain.setValueAtTime(f * 1.6, t); mg.gain.exponentialRampToValueAtTime(f * 0.02, t + 1.2);
    m.connect(mg); mg.connect(c.frequency);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(v, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t + 2.2);
    c.connect(g); g.connect(dest || musicBus); send(g, revIn, 0.7); send(g, dlyIn, 0.25);
    c.start(t); m.start(t); c.stop(t + 2.3); m.stop(t + 2.3);
  }
  function pad(t, freqs, dur, cut) {
    const pg = ctx.createGain(), lp = ctx.createBiquadFilter(), lfo = ctx.createOscillator(), lg = ctx.createGain();
    lp.type = 'lowpass'; lp.Q.value = 0.9; lp.frequency.value = cut;
    lfo.frequency.value = 0.09 + Math.random() * 0.06; lg.gain.value = cut * 0.35; lfo.connect(lg); lg.connect(lp.frequency);
    const atk = Math.min(1.7, dur * 0.42), rel = 2.4;
    pg.gain.setValueAtTime(0.0001, t); pg.gain.linearRampToValueAtTime(0.16, t + atk); pg.gain.setValueAtTime(0.16, t + dur - 0.2); pg.gain.exponentialRampToValueAtTime(0.0001, t + dur + rel);
    const oscs = [lfo];
    freqs.forEach((f, i) => {
      [['sawtooth', -8, 0.16], ['sawtooth', 7, 0.16], ['sine', 0, 0.5]].forEach(([type, det, gain]) => {
        const o = ctx.createOscillator(), og = ctx.createGain(); o.type = type; o.frequency.value = f; o.detune.value = det + (i % 2 ? 2 : -2);
        og.gain.value = gain / freqs.length * 1.6; o.connect(og); og.connect(lp); o.start(t); o.stop(t + dur + rel + 0.1); oscs.push(o);
      });
    });
    lfo.start(t); lfo.stop(t + dur + rel + 0.1);
    lp.connect(pg); pg.connect(musicBus); send(pg, revIn, 0.5);
    pads.push({ g: pg, end: t + dur + rel });
  }
  function releasePads(tc) {
    const now = ctx.currentTime;
    for (let i = pads.length - 1; i >= 0; i--) {
      const p = pads[i];
      if (p.end < now) { pads.splice(i, 1); continue; }
      p.g.gain.cancelScheduledValues(now); p.g.gain.setValueAtTime(Math.max(p.g.gain.value, 0.0001), now); p.g.gain.setTargetAtTime(0.0001, now, tc || 0.4);
    }
  }
  function sub(t, f, dur, v) {
    const o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'sine'; o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(v || 0.34, t + 0.06); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(musicBus); o.start(t); o.stop(t + dur + 0.05);
  }
  function kick(t, v) {
    const o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'sine';
    o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(44, t + 0.11);
    g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.34);
    o.connect(g); g.connect(musicBus); o.start(t); o.stop(t + 0.4);
  }
  function hat(t, v) {
    const s = noiseSrc(t), hp = ctx.createBiquadFilter(), g = ctx.createGain(); hp.type = 'highpass'; hp.frequency.value = 7800;
    g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    s.connect(hp); hp.connect(g); g.connect(musicBus); send(g, revIn, 0.2); s.start(t, Math.random()); s.stop(t + 0.07);
  }
  function timp(t, v) {
    const o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'sine'; o.frequency.setValueAtTime(98, t); o.frequency.exponentialRampToValueAtTime(58, t + 0.5);
    g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.8);
    const n = noiseSrc(t), lp = ctx.createBiquadFilter(), ng = ctx.createGain(); lp.type = 'lowpass'; lp.frequency.value = 500; ng.gain.setValueAtTime(v * 0.9, t); ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    o.connect(g); g.connect(musicBus); send(g, revIn, 0.55); n.connect(lp); lp.connect(ng); ng.connect(musicBus);
    o.start(t); o.stop(t + 1.9); n.start(t, 0); n.stop(t + 0.25);
  }
  function startAir() {
    if (airSrc) return;
    airSrc = ctx.createBufferSource(); airSrc.buffer = noiseBuf; airSrc.loop = true;
    airFilter = ctx.createBiquadFilter(); airFilter.type = 'bandpass'; airFilter.Q.value = 0.6; airFilter.frequency.value = scOf().air;
    airGain = ctx.createGain(); airGain.gain.value = 0.0001; airGain.gain.setTargetAtTime(0.055, ctx.currentTime, 2.0);
    const lfo = ctx.createOscillator(), lg = ctx.createGain(); lfo.frequency.value = 0.06; lg.gain.value = 380; lfo.connect(lg); lg.connect(airFilter.frequency); lfo.start();
    airSrc.connect(airFilter); airFilter.connect(airGain); airGain.connect(musicBus); send(airGain, revIn, 0.4); airSrc.start();
  }

  /* ---------- sequencer (lookahead) ---------- */
  function pump(until) {
    const sc = scOf(), stepDur = 60 / sc.bpm / 4;
    while (st.next < until) {
      const t = st.next, s = st.step % 16, r = rnd(st.bar * 977 + (sc.root * 31) + 7);
      if (s === 0) {
        const rootDeg = sc.prog[st.bar % sc.prog.length];
        const ch = [rootDeg, rootDeg + 2, rootDeg + 4, rootDeg + 8].map((d) => hz(midiOf(sc, d) + 12));
        pad(t, ch, stepDur * 16 + 1.0, sc.cut);
        sub(t, hz(midiOf(sc, rootDeg) - 12), stepDur * 15, 0.3);
        if (sc.timp) timp(t, 0.55);
      }
      const rootDeg = sc.prog[st.bar % sc.prog.length];
      if (sc.kick[s] === 'x' && sc.kv) kick(t, sc.kv);
      if (sc.hat[s] === 'x') hat(t, 0.05 + (s % 4 === 2 ? 0.02 : 0));
      if (sc.bassPulse && (s === 6 || s === 10) && r() > 0.25) pluck(t, hz(midiOf(sc, rootDeg) - 12 + (s === 10 ? 7 : 0)), 0.16, 'sub');
      if (sc.arp[s] === 'x') {
        const tones = [rootDeg, rootDeg + 2, rootDeg + 4, rootDeg + 6, rootDeg + 7, rootDeg + 9];
        const d = tones[Math.floor(r() * (st.bar % 2 ? 6 : 4) + (s % 3)) % tones.length];
        const m = midiOf(sc, d) + 12 * sc.arpOct;
        const v = 0.05 + r() * 0.04;
        if (sc.arpKind === 'bell') bell(t, hz(m), v * 1.1); else pluck(t, hz(m), v * 1.6);
      }
      if ((s === 0 || s === 8) && r() < sc.bell) bell(t + stepDur * 0.5, hz(midiOf(sc, rootDeg + [4, 7, 9, 11][Math.floor(r() * 4)]) + 24), 0.035);
      st.next += stepDur; st.step++; if (st.step % 16 === 0) st.bar++;
    }
  }
  function tick() { if (ctx && st.started && !st.hidden) pump(ctx.currentTime + 0.6); }

  /* ---------- sfx ---------- */
  const fxOK = () => ctx && st.fx && st.unlocked;
  const uiNote = (k) => { const sc = scOf(), pent = [0, 2, 4, 7 - 0, 9 - 0]; const idx = [0, 1, 2, 4, 5][k % 5]; return hz(midiOf(sc, idx) + 24 + 12 * Math.floor(k / 5)); };
  const SFX = {
    click() {
      if (!fxOK()) return; const t = ctx.currentTime;
      const n = noiseSrc(t), hp = ctx.createBiquadFilter(), g = ctx.createGain(); hp.type = 'highpass'; hp.frequency.value = 3200; g.gain.setValueAtTime(0.13, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.03);
      n.connect(hp); hp.connect(g); g.connect(sfxBus); n.start(t, Math.random()); n.stop(t + 0.05);
      const o = ctx.createOscillator(), og = ctx.createGain(); o.type = 'sine'; o.frequency.setValueAtTime(uiNote(Math.floor(Math.random() * 5)), t);
      og.gain.setValueAtTime(0.0001, t); og.gain.linearRampToValueAtTime(0.2, t + 0.004); og.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
      o.connect(og); og.connect(sfxBus); send(og, revIn, 0.35); o.start(t); o.stop(t + 0.2);
    },
    hover() {
      if (!fxOK()) return; const t = ctx.currentTime;
      const o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'sine'; o.frequency.value = uiNote(3 + Math.floor(Math.random() * 3)) * 2;
      g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.06, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
      o.connect(g); g.connect(sfxBus); send(g, revIn, 0.3); o.start(t); o.stop(t + 0.11);
    },
    tick() {
      if (!fxOK()) return; const t = ctx.currentTime;
      const n = noiseSrc(t), bp = ctx.createBiquadFilter(), g = ctx.createGain(); bp.type = 'bandpass'; bp.frequency.value = 2600 + Math.random() * 900; bp.Q.value = 4;
      g.gain.setValueAtTime(0.09, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.02); n.connect(bp); bp.connect(g); g.connect(sfxBus); n.start(t, Math.random()); n.stop(t + 0.03);
    },
    whoosh(dir) {
      if (!fxOK()) return; const t = ctx.currentTime, up = dir !== 'down';
      const n = noiseSrc(t, true), bp = ctx.createBiquadFilter(), g = ctx.createGain(); bp.type = 'bandpass'; bp.Q.value = 1.1;
      bp.frequency.setValueAtTime(up ? 220 : 2600, t); bp.frequency.exponentialRampToValueAtTime(up ? 3200 : 260, t + 0.42); bp.frequency.exponentialRampToValueAtTime(up ? 500 : 900, t + 0.85);
      g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.28, t + 0.3); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
      n.connect(bp); bp.connect(g); g.connect(sfxBus); send(g, revIn, 0.45); n.start(t); n.stop(t + 1);
      const o = ctx.createOscillator(), og = ctx.createGain(); o.type = 'sine'; o.frequency.setValueAtTime(90, t); o.frequency.exponentialRampToValueAtTime(48, t + 0.5);
      og.gain.setValueAtTime(0.0001, t + 0.28); og.gain.linearRampToValueAtTime(0.16, t + 0.34); og.gain.exponentialRampToValueAtTime(0.0001, t + 0.85);
      o.connect(og); og.connect(sfxBus); o.start(t); o.stop(t + 0.9);
    },
    swipe() {
      if (!fxOK()) return; const t = ctx.currentTime;
      const n = noiseSrc(t, true), bp = ctx.createBiquadFilter(), g = ctx.createGain(); bp.type = 'bandpass'; bp.Q.value = 0.9;
      bp.frequency.setValueAtTime(600, t); bp.frequency.exponentialRampToValueAtTime(2600, t + 0.16);
      g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.3, t + 0.05); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
      n.connect(bp); bp.connect(g); g.connect(sfxBus); n.start(t); n.stop(t + 0.25);
    },
    shutter() {
      if (!fxOK()) return; const t = ctx.currentTime;
      [[0, 0.42, 2600, 0.012], [0.055, 0.32, 1700, 0.02]].forEach(([dt, v, f, d]) => {
        const n = noiseSrc(t), bp = ctx.createBiquadFilter(), g = ctx.createGain(); bp.type = 'bandpass'; bp.frequency.value = f; bp.Q.value = 2.5;
        g.gain.setValueAtTime(v, t + dt); g.gain.exponentialRampToValueAtTime(0.0001, t + dt + d + 0.02); n.connect(bp); bp.connect(g); g.connect(sfxBus); send(g, revIn, 0.12);
        n.start(t + dt, Math.random()); n.stop(t + dt + 0.06);
        const o = ctx.createOscillator(), og = ctx.createGain(); o.type = 'square'; o.frequency.value = dt ? 190 : 260; og.gain.setValueAtTime(0.08, t + dt); og.gain.exponentialRampToValueAtTime(0.0001, t + dt + 0.03);
        const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900; o.connect(lp); lp.connect(og); og.connect(sfxBus); o.start(t + dt); o.stop(t + dt + 0.05);
      });
    },
    chime(seq) {
      if (!fxOK()) return; const t = ctx.currentTime; (seq || [0, 2, 4]).forEach((k, i) => bell(t + i * 0.085, uiNote(k + 5), 0.11, sfxBus));
    },
    pop() {
      if (!fxOK()) return; const t = ctx.currentTime;
      const o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'sine'; o.frequency.setValueAtTime(320, t); o.frequency.exponentialRampToValueAtTime(980, t + 0.07);
      g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.3, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
      o.connect(g); g.connect(sfxBus); send(g, revIn, 0.3); o.start(t); o.stop(t + 0.2);
      bell(t + 0.07, uiNote(7), 0.07, sfxBus);
    },
    riser(dur) {
      if (!ctx || !st.unlocked) return; const t = ctx.currentTime, d = dur || 1.0;
      const n = noiseSrc(t, true), bp = ctx.createBiquadFilter(), g = ctx.createGain(); bp.type = 'bandpass'; bp.Q.value = 2;
      bp.frequency.setValueAtTime(180, t); bp.frequency.exponentialRampToValueAtTime(7000, t + d);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.32, t + d); g.gain.linearRampToValueAtTime(0.0001, t + d + 0.03);
      n.connect(bp); bp.connect(g); g.connect(sfxBus); send(g, revIn, 0.5); n.start(t); n.stop(t + d + 0.1);
      const o = ctx.createOscillator(), o2 = ctx.createOscillator(), og = ctx.createGain(); o.type = 'sawtooth'; o2.type = 'sawtooth';
      o.frequency.setValueAtTime(110, t); o.frequency.exponentialRampToValueAtTime(880, t + d); o2.frequency.setValueAtTime(111.5, t); o2.frequency.exponentialRampToValueAtTime(884, t + d);
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(300, t); lp.frequency.exponentialRampToValueAtTime(5000, t + d);
      og.gain.setValueAtTime(0.0001, t); og.gain.exponentialRampToValueAtTime(0.11, t + d); og.gain.linearRampToValueAtTime(0.0001, t + d + 0.03);
      o.connect(lp); o2.connect(lp); lp.connect(og); og.connect(sfxBus); send(og, revIn, 0.5); o.start(t); o2.start(t); o.stop(t + d + 0.1); o2.stop(t + d + 0.1);
    },
    impact() {
      if (!ctx || !st.unlocked) return; const t = ctx.currentTime;
      const o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'sine'; o.frequency.setValueAtTime(82, t); o.frequency.exponentialRampToValueAtTime(27, t + 1.5);
      g.gain.setValueAtTime(0.9, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 2.2); o.connect(g); g.connect(sfxBus); send(g, revIn, 0.25); o.start(t); o.stop(t + 2.3);
      const n = noiseSrc(t), lp = ctx.createBiquadFilter(), ng = ctx.createGain(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(5200, t); lp.frequency.exponentialRampToValueAtTime(400, t + 1.6);
      ng.gain.setValueAtTime(0.5, t); ng.gain.exponentialRampToValueAtTime(0.0001, t + 1.8); n.connect(lp); lp.connect(ng); ng.connect(sfxBus); send(ng, revIn, 0.9); n.start(t, 0); n.stop(t + 1.9);
      const sc = SC.home; [0, 4, 7].forEach((k, i) => bell(t + 0.02 + i * 0.03, hz(sc.root + 24 + [0, 7, 12][i]), 0.09, sfxBus));
    },
    open() { SFX.shutter(); setTimeout(() => SFX.chime([0, 2, 4]), 70); },
    close() { SFX.whoosh('down'); },
    error() { if (!fxOK()) return; const t = ctx.currentTime;[220, 165].forEach((f, i) => { const o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'triangle'; o.frequency.value = f; g.gain.setValueAtTime(0.0001, t + i * 0.1); g.gain.linearRampToValueAtTime(0.12, t + i * 0.1 + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.1 + 0.25); o.connect(g); g.connect(sfxBus); o.start(t + i * 0.1); o.stop(t + i * 0.1 + 0.3); }); },
  };

  /* ---------- public ---------- */
  A.sfx = SFX;
  A.state = st;
  A.unlock = function () {
    if (st.unlocked && ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    const C = window.AudioContext || window.webkitAudioContext; if (!C) return;
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) {}
    build(new C({ latencyHint: 'interactive' }));
    st.unlocked = true; if (ctx.state === 'suspended') ctx.resume();
    const b = ctx.createBuffer(1, 1, 22050), s = ctx.createBufferSource(); s.buffer = b; s.connect(ctx.destination); s.start(0); // iOS unlock
  };
  A.start = function () {
    if (!ctx || st.started) return; st.started = true; st.next = ctx.currentTime + 0.15; st.step = 0; st.bar = 0;
    startAir(); pump(ctx.currentTime + 0.6); st.timer = setInterval(tick, 90);
    musicFilter.frequency.setValueAtTime(300, ctx.currentTime); musicFilter.frequency.exponentialRampToValueAtTime(16000, ctx.currentTime + 4);
  };
  A.setScene = function (id) {
    if (!SC[id]) id = 'home';
    if (st.scene === id) return; st.scene = id;
    if (!ctx || !st.started) return;
    const now = ctx.currentTime; releasePads(0.35);
    musicFilter.frequency.cancelScheduledValues(now); musicFilter.frequency.setValueAtTime(420, now); musicFilter.frequency.exponentialRampToValueAtTime(16000, now + 2.2);
    if (airFilter) airFilter.frequency.setTargetAtTime(SC[id].air, now, 0.8);
    st.step = 0; st.bar++; st.next = Math.max(st.next, now + 0.05);
  };
  A.setVolume = function (v) { st.vol = Math.max(0, Math.min(1, v)); if (master) master.gain.setTargetAtTime(st.vol * st.vol, ctx.currentTime, 0.05); save(); };
  A.setMusic = function (on) { st.music = !!on; if (musicBus) musicBus.gain.setTargetAtTime(on ? 0.78 : 0, ctx.currentTime, 0.15); save(); };
  A.setFx = function (on) { st.fx = !!on; if (sfxBus) sfxBus.gain.setTargetAtTime(on ? 1.2 : 0, ctx.currentTime, 0.05); save(); };
  A.level = function () {
    if (!analyser || !st.unlocked) return 0; analyser.getByteTimeDomainData(buf16);
    let s = 0; for (let i = 0; i < buf16.length; i++) { const x = (buf16[i] - 128) / 128; s += x * x; }
    const l = Math.min(1, Math.sqrt(s / buf16.length) * 5); st.level += (l - st.level) * 0.35; return st.level;
  };
  document.addEventListener('visibilitychange', () => {
    st.hidden = document.hidden; if (!ctx || !st.unlocked) return;
    if (document.hidden) { ctx.suspend(); } else { ctx.resume(); st.next = Math.max(st.next, ctx.currentTime + 0.1); }
  });
  /* test hooks (offline rendering) */
  A._testInit = function (offCtx) { build(offCtx); st.unlocked = true; st.started = true; st.next = 0.05; st.step = 0; st.bar = 0; startAir(); };
  A._testPump = function (t) { pump(t); };
  A._testSfx = SFX;
  window.AreedAudio = A;
})();;
/* ============================================================
   AREED LAFFA — visual FX: film grain, floating dust/bokeh,
   custom cursor, 3D tilt + spotlight, scroll progress/parallax,
   timecode, audio-reactive equalizer
   ============================================================ */
(function () {
  'use strict';
  const FX = {};
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => [...(r || document).querySelectorAll(s)];
  const root = document.documentElement;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let device = root.dataset.device || 'desktop';
  const fine = matchMedia('(hover: hover) and (pointer: fine)');
  const pointer = { x: innerWidth / 2, y: innerHeight / 2, nx: 0, ny: 0 };
  let paused = false;

  /* ---------- film grain ---------- */
  const grain = $('#grain'), gctx = grain.getContext('2d');
  let gImg, gLast = 0;
  function sizeGrain() {
    const s = device === 'mobile' ? 3 : 2;
    grain.width = Math.max(64, Math.ceil(innerWidth / s)); grain.height = Math.max(64, Math.ceil(innerHeight / s));
    gImg = gctx.createImageData(grain.width, grain.height);
  }
  function drawGrain(t) {
    if (t - gLast < (device === 'mobile' ? 150 : 90)) return; gLast = t;
    const d = new Uint32Array(gImg.data.buffer);
    for (let i = 0; i < d.length; i++) { const v = (Math.random() * 255) | 0; d[i] = 0xff000000 | (v << 16) | (v << 8) | v; }
    gctx.putImageData(gImg, 0, 0);
  }

  /* ---------- dust / bokeh ---------- */
  const dust = $('#dust'), dctx = dust.getContext('2d');
  let P = [], W = 0, H = 0, dpr = 1, accent = [77, 243, 255], accent2 = [255, 107, 74];
  function hex2rgb(h) { h = h.trim(); if (h[0] === '#') { if (h.length === 4) h = '#' + [...h.slice(1)].map((c) => c + c).join(''); return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]; } const m = h.match(/\d+/g); return m ? m.slice(0, 3).map(Number) : [77, 243, 255]; }
  function readAccent() {
    const cs = getComputedStyle(document.body); const a = cs.getPropertyValue('--a'), b = cs.getPropertyValue('--b');
    if (a) accent = hex2rgb(a); if (b) accent2 = hex2rgb(b);
  }
  function sizeDust() {
    dpr = Math.min(devicePixelRatio || 1, device === 'mobile' ? 1.25 : 1.5); W = innerWidth; H = innerHeight;
    dust.width = W * dpr; dust.height = H * dpr;
    const n = device === 'mobile' ? 34 : 78; P = [];
    for (let i = 0; i < n; i++) P.push(mk(true));
  }
  function mk(init) {
    const z = Math.random();
    return { x: Math.random() * W, y: init ? Math.random() * H : H + 20, z, r: 0.8 + z * 3.6 + (Math.random() < 0.08 ? 6 : 0), vy: -(6 + z * 18) / 60, vx: (Math.random() - 0.5) * 0.14, a: 0.12 + z * 0.4, ph: Math.random() * 6.28, c: Math.random() < 0.28 ? 1 : 0 };
  }
  function drawDust(t) {
    dctx.setTransform(dpr, 0, 0, dpr, 0, 0); dctx.clearRect(0, 0, W, H); dctx.globalCompositeOperation = 'lighter';
    const lvl = window.AreedAudio ? AreedAudio.state.level : 0;
    const px = device === 'desktop' ? pointer.nx : 0, py = device === 'desktop' ? pointer.ny : 0;
    for (const p of P) {
      p.y += p.vy * (1 + lvl * 2); p.x += p.vx + Math.sin(t / 2400 + p.ph) * 0.12;
      if (p.y < -20) Object.assign(p, mk(false), { x: Math.random() * W });
      const ox = p.x - px * p.z * 26, oy = p.y - py * p.z * 18, c = p.c ? accent2 : accent;
      const tw = 0.6 + 0.4 * Math.sin(t / 900 + p.ph), r = p.r * (1 + lvl * 0.6);
      const g = dctx.createRadialGradient(ox, oy, 0, ox, oy, r * 3);
      g.addColorStop(0, `rgba(${c[0]},${c[1]},${c[2]},${(p.a * tw).toFixed(3)})`); g.addColorStop(1, `rgba(${c[0]},${c[1]},${c[2]},0)`);
      dctx.fillStyle = g; dctx.beginPath(); dctx.arc(ox, oy, r * 3, 0, 6.283); dctx.fill();
    }
  }

  /* ---------- cursor ---------- */
  const cur = $('#cursor'), dot = $('.c-dot', cur), ring = $('.c-ring', cur), lab = $('.c-label', cur);
  let rx = pointer.x, ry = pointer.y, cursorOn = false;
  function enableCursor() {
    const on = device === 'desktop' && fine.matches && !reduce;
    if (on === cursorOn) return; cursorOn = on; root.classList.toggle('has-cursor', on);
  }
  const LINK = 'a,button,[data-go],.fcard,.pin,.cl,.sw,input[type=range],textarea,.lb-th,.nv';
  const VIEW = '.ph-b,.rl,.momcard,.lb-stage img';
  function cursorState(e) {
    const t = e.target.closest ? e.target : null; if (!t) return;
    const v = t.closest(VIEW), l = t.closest(LINK);
    cur.classList.toggle('is-view', !!v);
    cur.classList.toggle('is-link', !v && !!l);
    if (v) lab.textContent = (root.lang === 'ar' ? 'افتح' : (v.matches('.momcard,.rl') ? 'OPEN' : 'VIEW'));
  }

  /* ---------- tilt + spotlight ---------- */
  let tiltEl = null;
  function tilt(e) {
    if (device !== 'desktop') return;
    const el = e.target.closest ? e.target.closest('.fcard,.pcover') : null;
    if (tiltEl && tiltEl !== el) { tiltEl.style.setProperty('--rx', '0deg'); tiltEl.style.setProperty('--ry', '0deg'); }
    tiltEl = el; if (!el) return;
    const r = el.getBoundingClientRect(), x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
    const k = el.classList.contains('pcover') ? 5 : 9;
    el.style.setProperty('--mx', (x * 100).toFixed(1) + '%'); el.style.setProperty('--my', (y * 100).toFixed(1) + '%');
    el.style.setProperty('--ry', ((x - 0.5) * k * (root.dir === 'rtl' ? -1 : 1) * -1).toFixed(2) + 'deg');
    el.style.setProperty('--rx', ((0.5 - y) * k).toFixed(2) + 'deg');
  }

  /* ---------- scroll: progress + hero parallax ---------- */
  const prog = $('#progress'); let sTick = false;
  function onScroll() {
    if (sTick) return; sTick = true;
    requestAnimationFrame(() => {
      sTick = false; const y = scrollY, max = Math.max(1, document.documentElement.scrollHeight - innerHeight);
      prog.style.setProperty('--p', Math.min(1, y / max).toFixed(4));
      const hb = $('.hero-bg'), hi = $('.hero-inner');
      if (hb && y < innerHeight * 1.4 && device === 'desktop') { hb.style.transform = `translate3d(0,${(y * 0.22).toFixed(1)}px,0)`; if (hi) { hi.style.transform = `translate3d(0,${(y * -0.08).toFixed(1)}px,0)`; hi.style.opacity = Math.max(0, 1 - y / (innerHeight * 0.8)).toFixed(3); } }
      else if (hb && y < innerHeight * 1.4) { hb.style.transform = `translate3d(0,${(y * 0.12).toFixed(1)}px,0)`; }
    });
  }

  /* ---------- timecode + equalizer ---------- */
  const t0 = performance.now(); let tcLast = 0;
  const eqI = [];
  function tickUI(t) {
    if (t - tcLast > 80) {
      tcLast = t; const s = (t - t0) / 1000 + 12 * 60, f = Math.floor((s % 1) * 24), ss = Math.floor(s) % 60, mm = Math.floor(s / 60) % 60, hh = Math.floor(s / 3600);
      const str = [hh, mm, ss, f].map((n) => String(n).padStart(2, '0')).join(':');
      $$('[data-tc]').forEach((el) => { el.textContent = 'TC ' + str; });
      const w = $('#introTc'); if (w) w.textContent = str;
    }
    const A = window.AreedAudio, st = A && A.state;
    if (!eqI.length) eqI.push(...$$('.eq i'));
    if (st && st.unlocked && st.started && (st.music || st.fx)) {
      const l = A.level();
      eqI.forEach((el, i) => el.style.setProperty('--h', (0.18 + Math.min(1, l * (0.9 + i * 0.22)) * (0.5 + 0.5 * Math.abs(Math.sin(t / (180 + i * 70) + i)))).toFixed(3)));
      $('#aurora').style.setProperty('--lvl', l.toFixed(3));
    } else if (!st || !st.unlocked) {
      eqI.forEach((el, i) => el.style.setProperty('--h', (0.25 + 0.18 * Math.sin(t / 500 + i)).toFixed(3)));
    }
  }

  /* ---------- main loop ---------- */
  function loop(t) {
    if (!paused) {
      if (!reduce) { drawGrain(t); drawDust(t); }
      if (cursorOn) {
        rx += (pointer.x - rx) * 0.18; ry += (pointer.y - ry) * 0.18;
        dot.style.transform = `translate3d(${pointer.x}px,${pointer.y}px,0)`; ring.style.transform = `translate3d(${rx}px,${ry}px,0)`;
      }
      tickUI(t);
    }
    requestAnimationFrame(loop);
  }

  FX.init = function () {
    sizeGrain(); sizeDust(); readAccent(); enableCursor();
    addEventListener('pointermove', (e) => {
      if (e.pointerType === 'touch') return;
      if (!cur.classList.contains('live')) { rx = e.clientX; ry = e.clientY; cur.classList.add('live'); }
      pointer.x = e.clientX; pointer.y = e.clientY; pointer.nx = (e.clientX / innerWidth - 0.5) * 2; pointer.ny = (e.clientY / innerHeight - 0.5) * 2;
      if (cursorOn) { cursorState(e); tilt(e); }
    }, { passive: true });
    addEventListener('pointerdown', () => cur.classList.add('down'), { passive: true });
    addEventListener('pointerup', () => cur.classList.remove('down'), { passive: true });
    addEventListener('scroll', onScroll, { passive: true });
    let rz; addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => { sizeGrain(); sizeDust(); enableCursor(); onScroll(); }, 160); });
    document.addEventListener('visibilitychange', () => { paused = document.hidden; });
    setInterval(readAccent, 1200);
    requestAnimationFrame(loop); onScroll();
  };
  FX.setDevice = function (d) { device = d; sizeGrain(); sizeDust(); enableCursor(); };
  FX.pause = (v) => { paused = !!v; };
  FX.refreshAccent = readAccent;
  window.AreedFX = FX;
})();;
/* ============================================================
   AREED LAFFA ARCHIVE — application
   ============================================================ */
(function () {
  'use strict';
  const { M, PEOPLE, SCENES, PINS, JOKES, T, SUGGESTION_EMAIL } = window.ARCHIVE;
  const AU = window.AreedAudio, FX = window.AreedFX, SFX = AU.sfx;
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => [...(r || document).querySelectorAll(s)];
  const root = document.documentElement;
  const stage = $('#stage');
  const P = Object.fromEntries(PEOPLE.map((p) => [p.id, p]));
  const ORDER = ['friend1', 'friend2', 'friend3', 'bazzo', 'majd', 'all'];
  const GAL = { friend1: 'bonni', friend2: 'jundi', friend3: 'hakko', bazzo: 'bazzo', majd: 'majd', all: 'crew' };
  const LATIN = { home: 'Home', friend1: 'Bonni', friend2: 'Jundi', friend3: 'Hakko', bazzo: 'Bazzo', majd: 'Majd', all: 'The Crew', credits: 'Credits' };
  const ACC = { home: '#4df3ff', all: '#4df3ff', credits: '#ffd98a' };
  const accOf = (id) => (P[id] ? P[id].a : ACC[id] || '#4df3ff');
  const st = { lang: 'ar', scene: null, entered: false, busy: false, pending: null, mom: null };
  try { const l = localStorage.getItem('al_lang'); if (l === 'en' || l === 'ar') st.lang = l; } catch (e) {}
  const t = (k) => T[st.lang][k];
  const isMobile = () => root.dataset.device === 'mobile';
  const vibe = (ms) => { try { if (isMobile() && navigator.vibrate) navigator.vibrate(ms); } catch (e) {} };
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const pad2 = (n) => String(n).padStart(2, '0');
  const rand = (n) => Math.floor(Math.random() * n);
  const abs = (u) => new URL(u, document.baseURI).href;
  const gallery = (id) => M[GAL[id]] || [];

  /* ---------------- templates ---------------- */
  const imgTag = (it, alt, eager) => `<img src="${it.t}" width="${it.w}" height="${it.h}" alt="${alt}" ${eager ? 'fetchpriority="high"' : 'loading="lazy"'} decoding="async">`;

  function reelItems() {
    const out = [];
    for (let i = 0; i < 6; i++) ORDER.slice(0, 5).forEach((id) => { const g = gallery(id); if (g[i * 3 % g.length]) out.push({ id, idx: (i * 3) % g.length, it: g[(i * 3) % g.length] }); });
    for (let i = out.length - 1; i > 0; i--) { const j = (i * 7 + 3) % (i + 1); [out[i], out[j]] = [out[j], out[i]]; }
    return out.slice(0, 22);
  }

  function homeHTML() {
    const hero = M.crew[0];
    const reel = reelItems().map((r) => `<button class="rl" type="button" data-go="${r.id}" aria-label="${LATIN[r.id]}">${imgTag(r.it, '')}<b>${LATIN[r.id].toUpperCase()} · ${pad2(r.idx + 1)}</b></button>`).join('');
    const crewOrder = ['friend3', 'majd', 'friend2', 'bazzo', 'friend1'];
    const pins = PINS.map((p) => `<button class="pin" type="button" data-go="${p.id}" data-id="${p.id}" style="left:${p.x}%;top:${p.y}%;--pa:${P[p.id].a}"><span class="pin-dot"></span><span class="pin-lab"><small>${p.n}</small><span data-i="nav_${p.id}"></span></span></button>`).join('');
    const list = crewOrder.map((id) => `<button class="cl" type="button" data-go="${id}" data-id="${id}" style="--pa:${P[id].a}"><em>${P[id].num}</em><div><b>${P[id].name}</b><span data-i="sub_${id}"></span></div><i>→</i></button>`).join('');
    const cards = ORDER.slice(0, 5).map((id) => `<button class="fcard rv" type="button" data-go="${id}" style="--pa:${P[id].a}">${imgTag(gallery(id)[0], '')}<i class="fnum">${P[id].num}</i><div class="fbody"><div class="fname">${P[id].name}</div><span class="fsub" data-i="sub_${id}"></span><span class="fgo"><span data-i="open_file"></span><i>→</i></span></div></button>`).join('');
    return `
<section class="scene" id="scene-home" data-scene="home" hidden>
  <div class="hero">
    <div class="hero-bg"><img class="hero-img" src="${hero.f}" width="${hero.w}" height="${hero.h}" alt="" fetchpriority="high"></div>
    <div class="hero-grade"></div><div class="hero-shade"></div><div class="hero-streak"></div>
    <div class="hero-hud" aria-hidden="true"><i class="c tl"></i><i class="c tr"></i><i class="c bl"></i><i class="c br"></i><span class="tc" data-tc></span><span class="tc l">AREED LAFFA · SCENE 01</span></div>
    <div class="hero-stamp anim-in" style="--d:6"><span data-i="hero_stamp"></span></div>
    <div class="hero-inner">
      <p class="eyebrow anim-in"><i class="rec"></i><span data-i="hero_eyebrow"></span></p>
      <h1 class="hero-h1 split" data-i="hero_h1" data-split></h1>
      <div class="hero-cta anim-in" style="--d:5"><button class="btn btn-primary" type="button" data-jump="#crew"><span data-i="hero_cta"></span> <i class="arr">→</i></button><button class="btn btn-ghost" type="button" data-random><span data-i="hero_cta2"></span></button></div>
    </div>
    <div class="scroll-cue" aria-hidden="true"><i></i><span data-i="scroll"></span></div>
  </div>
  <div class="reel" aria-label="memory reel"><span class="reel-label" data-i="strip_label"></span><div class="reel-track">${reel}${reel}</div></div>

  <section class="sec" id="crew"><div class="wrap">
    <div class="sec-head rv"><div><p class="eyebrow" data-i="crew_eyebrow"></p><h2 data-i="crew_h2"></h2></div><p class="sec-note" data-i="crew_note"></p></div>
    <div class="crew-grid">
      <div class="crewmap rv"><img src="${M.crewshot.f}" width="${M.crewshot.w}" height="${M.crewshot.h}" alt="" loading="lazy" decoding="async">${pins}<div class="crew-hint" data-i="crew_hint"></div></div>
      <div class="crewlist rv">${list}</div>
    </div>
  </div></section>

  <section class="sec" id="mom"><div class="wrap">
    <div class="sec-head mom-head rv"><div><p class="eyebrow" data-i="mom_eyebrow"></p><h2 data-i="mom_h2"></h2></div><button class="btn btn-ghost" type="button" id="momAgain" data-i="mom_again"></button></div>
    <button class="momcard rv" type="button" id="momCard"><div class="mom-img"><img id="momImg" alt=""></div><div class="mom-body"><span class="mom-tag" id="momTag">—</span><strong class="mom-cap" data-i="mom_cap"></strong><span class="mom-open" data-i="mom_open"></span></div><span class="mom-num" id="momNum">01</span></button>
  </div></section>

  <section class="sec idea"><div class="wrap"><div class="idea-in rv"><span class="qm" aria-hidden="true">“</span><p class="eyebrow" data-i="idea_eyebrow"></p><h2 data-i="idea_h2"></h2><p data-i="idea_p"></p><div class="line"></div></div></div></section>

  <section class="sec" id="files"><div class="wrap">
    <div class="sec-head rv"><div><p class="eyebrow" data-i="files_eyebrow"></p><h2 data-i="files_h2"></h2></div><p class="sec-note" data-i="files_note"></p></div>
    <div class="files-grid">${cards}</div>
  </div></section>

  <section class="sec" id="suggest"><div class="wrap">
    <div class="sug glass rv">
      <div class="sug-head"><div><p class="eyebrow" data-i="sug_eyebrow"></p><h2 data-i="sug_h2"></h2></div><span class="mail-chip">${SUGGESTION_EMAIL}</span></div>
      <p class="lead" data-i="sug_p"></p>
      <textarea id="sugText" data-i-ph="sug_ph" aria-label="suggestion"></textarea>
      <div class="sug-act"><button class="btn btn-primary" type="button" id="sugSend" data-i="sug_btn"></button><small id="sugStatus" data-i="sug_small"></small></div>
    </div>
  </div></section>
  <div class="wrap"><footer class="foot"><span><b>●</b> <span data-i="foot_a"></span></span><span data-i="foot_b"></span></footer></div>
</section>`;
  }

  function nextOf(id) { const i = ORDER.indexOf(id); return i < ORDER.length - 1 ? ORDER[i + 1] : 'credits'; }

  function profileHTML(id) {
    const p = P[id], isAll = id === 'all', g = gallery(id), cover = g[0];
    const key = isAll ? 'all' : id;
    const jokes = JOKES[id] || [];
    const accent = isAll ? '#4df3ff' : p.a, accent2 = isAll ? '#ffc23d' : p.b;
    const name = isAll ? null : p.name;
    const num = isAll ? 'ALL' : p.num;
    const story = ORDER.slice(0, 5).map((s, i) => `<i class="${s === id ? 'cur' : (ORDER.indexOf(s) < ORDER.indexOf(id) ? 'done' : '')}"></i>`).join('');
    const galH2 = ['bazzo', 'majd', 'all'].includes(id) ? `gal_h2_${id}` : 'gal_h2_def', galNote = ['bazzo', 'majd', 'all'].includes(id) ? `gal_note_${id}` : 'gal_note_def';
    const nx = nextOf(id), nxName = LATIN[nx], nxAcc = accOf(nx);
    const nxTag = nx === 'credits' ? 'nav_credits' : `tag_${nx}`;
    const items = g.map((it, i) => `<div class="ph rv" data-r="${(it.h / it.w).toFixed(3)}"><button class="ph-b" type="button" data-open="${id}" data-idx="${i}" style="--c:${it.c}" aria-label="${LATIN[id]} ${i + 1}">${imgTag(it, `${LATIN[id]} ${i + 1}`)}<i class="ph-n">${pad2(i + 1)}</i></button></div>`).join('');
    const banner = isAll ? `<div class="banner rv"><span data-i="banner_a"></span><strong data-i="banner_b"></strong><p data-i="banner_c"></p></div>` : '';
    const stats = `<div class="pstat glass"><b>${num}</b><span>CREW ID</span></div><div class="pstat glass"><b data-count="${g.length}">0</b><span data-i="${isAll ? 'stat_group' : 'stat_photos'}"></span></div>${isAll ? `<div class="pstat glass"><b>∞</b><span data-i="stat_mem"></span></div>` : `<div class="pstat glass"><b data-count="${jokes.length}">0</b><span data-i="stat_jokes"></span></div>`}`;
    const jokeBtn = jokes.length ? `<button class="btn btn-primary" type="button" data-joke="${id}" data-i="joke_btn"></button>` : '';
    const jokeBox = jokes.length ? `<div class="pjoke"><span id="joke-${id}">—</span></div>` : '';
    return `
<section class="scene profile" id="scene-${id}" data-scene="${id}" style="--pa:${accent};--pb:${accent2}" hidden>
  <div class="phero"><div class="wrap phero-grid">
    <div class="pcover" style="--fp:${isAll ? '50% 55%' : p.fp}">
      <img class="pcover-img" src="${cover.f}" width="${cover.w}" height="${cover.h}" alt="${LATIN[id]}" fetchpriority="high">
      <i class="fr tl"></i><i class="fr tr"></i><i class="fr bl"></i><i class="fr br"></i><i class="pscan"></i>
      <span class="pnum">${num}</span><div class="pstory" aria-hidden="true">${isAll ? '' : story}</div>
    </div>
    <div class="pinfo">
      <p class="eyebrow anim-in" data-i="eyebrow_${id}"></p>
      ${isAll ? `<h1 class="pname"><span class="pname-l ltr" data-i="all_h1"></span></h1>` : `<h1 class="pname anim-in" style="--d:1"><span class="pname-l">${name}</span><span class="pname-o" aria-hidden="true">${name}</span></h1>`}
      <p class="ptag anim-in" style="--d:2" data-i="tag_${id}"></p>
      <p class="pcopy anim-in" style="--d:3" data-i="copy_${id}"></p>
      <div class="pstats anim-in" style="--d:4">${stats}</div>
      <div class="pact anim-in" style="--d:5">${jokeBtn}<button class="btn btn-ghost" type="button" data-share="${id}" data-i="share_btn"></button></div>
      ${jokeBox}
    </div>
  </div></div>
  <section class="sec" style="padding-top:clamp(40px,6vh,80px)"><div class="wrap">
    ${banner}
    <div class="gal-head rv"><div><p class="eyebrow">${LATIN[id].toUpperCase()} · ARCHIVE</p><h2 data-i="${galH2}"></h2><p class="sec-note" style="margin-top:12px" data-i="${galNote}"></p></div><span class="cnt" data-cnt="${g.length}"></span></div>
    <div class="masonry" data-key="${id}">${items}</div>
  </div></section>
  <div class="wrap"><button class="pnext" type="button" data-go="${nx}" style="--na:${nxAcc}"><div><small data-i="next"></small><b>${nxName}</b><span class="ar" data-i="${nxTag}"></span></div><i>→</i></button><footer class="foot"><span><b>●</b> <span data-i="foot_a"></span></span><span data-i="foot_b"></span></footer></div>
</section>`;
  }

  function creditsHTML() {
    const copy = (aria) => `<div class="cr-copy" ${aria ? 'aria-hidden="true"' : ''}>
      <div class="cr-kick" data-i="credits_kicker"></div><h2 data-i="credits_h"></h2><p class="cr-lead" data-i="credits_lead"></p>
      <div class="cr-gap"></div><h3>BAZZO</h3><p data-i="credits_bazzo"></p>
      <div class="cr-gap"></div><h3>MAJD</h3><p data-i="credits_majd"></p>
      <div class="cr-gap"></div><h3>HAKKO</h3><p>الأساس ومقر الشلة · Hakko</p>
      <div class="cr-gap"></div><h3>JUNDI</h3><p>الـ Black Hero يلي بيكره الصور · Jundi</p>
      <div class="cr-gap"></div><h3>BONNI</h3><p>أبو يعقوب · Bonni</p>
      <div class="cr-gap"></div><div class="cr-line"></div><div class="cr-gap s"></div>
      <h2 class="ar">"أريد لفة"</h2><p data-i="credits_l1"></p><p data-i="credits_l2"></p>
      <div class="cr-gap"></div><h3>THE ARCHIVE</h3><p>BAZZO</p>
      <div class="cr-gap"></div><h3>ROLL CREDITS</h3><p data-i="credits_roll"></p><div class="cr-end">THE ARCHIVE CONTINUES</div></div>`;
    return `<section class="scene" id="scene-credits" data-scene="credits" hidden>
      <div class="cr-bg"></div><div class="cr-photos"><img alt=""><img alt=""></div><div class="cr-stars"></div><div class="cr-mask"></div>
      <div class="cr-track">${copy(false)}${copy(true)}</div>
      <div class="cr-ctl"><button class="btn btn-ghost" type="button" id="crPause"><span data-i="credits_pause"></span></button><button class="btn btn-primary" type="button" data-go="home" data-i="credits_skip"></button></div>
    </section>`;
  }

  /* ---------------- nav + dock ---------------- */
  function buildNav() {
    const nav = $('#nav'), dock = $('#dockTrack');
    SCENES.forEach((id, i) => {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'nv'; b.dataset.go = id; b.dataset.scene = id;
      b.innerHTML = `<em>${pad2(i + 1)}</em><span data-i="nav_${id}"></span>`; nav.appendChild(b);
      const d = document.createElement('button'); d.type = 'button'; d.className = 'dk'; d.dataset.go = id; d.dataset.scene = id; d.style.setProperty('--pa', accOf(id));
      let av; if (P[id]) av = `<img src="${gallery(id)[0].t}" alt="" width="60" height="60">`; else av = `<b>${id === 'home' ? 'AL' : id === 'all' ? 'ALL' : '▶'}</b>`;
      d.innerHTML = `<span class="av">${av}</span><span data-i="nav_${id}"></span>`; dock.appendChild(d);
    });
  }
  function moveIndicator() {
    const ind = $('#navInd'), on = $('#nav .nv.on'); if (!ind || !on || isMobile()) return;
    ind.style.left = on.offsetLeft + 'px'; ind.style.width = on.offsetWidth + 'px';
  }

  /* ---------------- i18n ---------------- */
  function split(el) {
    const words = el.textContent.trim().split(/\s+/);
    el.innerHTML = words.map((w, i) => `<span class="w"><span style="--i:${i}">${w}</span></span>`).join(' ');
    el.setAttribute('aria-label', words.join(' '));
  }
  function applyI18n(scope) {
    const s = scope || document;
    $$('[data-i]', s).forEach((el) => { const v = t(el.dataset.i); if (typeof v === 'string') { el.textContent = v; if (el.hasAttribute('data-split')) split(el); } });
    $$('[data-i-ph]', s).forEach((el) => { el.placeholder = t(el.dataset.iPh); });
    $$('[data-cnt]', s).forEach((el) => { el.textContent = t('photos_n')(el.dataset.cnt); });
  }
  function setLang(l, silent) {
    st.lang = l; root.lang = l; root.dir = l === 'ar' ? 'rtl' : 'ltr'; $('#langBtn').textContent = l === 'ar' ? 'EN' : 'AR';
    try { localStorage.setItem('al_lang', l); } catch (e) {}
    applyI18n(); updateTitle(); if (st.mom) renderMom(true);
    if (!silent) { requestAnimationFrame(() => { moveIndicator(); layoutMasonry(); scrollActiveDock(); }); }
  }
  function updateTitle() { const n = st.scene ? T[st.lang].names[st.scene] || T[st.lang].names.home : ''; document.title = (st.scene && st.scene !== 'home' ? n + ' · ' : '') + (st.lang === 'ar' ? 'أرشيف أريد لفة' : 'Areed Laffa Archive'); }

  /* ---------------- masonry ---------------- */
  function layoutMasonry() {
    $$('.masonry').forEach((m) => {
      if (!m.offsetParent) return;
      const cs = getComputedStyle(m), cols = parseInt(cs.getPropertyValue('--cols')) || 4, gap = parseFloat(cs.getPropertyValue('--gap')) || 14;
      const colW = (m.clientWidth - gap * (cols - 1)) / cols;
      [...m.children].forEach((ph) => { const r = Math.min(1.55, Math.max(0.74, +ph.dataset.r || 1)); ph.style.gridRowEnd = 'span ' + Math.ceil((colW * r + gap) / 6); });
    });
  }

  /* ---------------- reveal / counters ---------------- */
  let io;
  function setupReveal() {
    io = new IntersectionObserver((es) => {
      let n = 0; es.forEach((e) => { if (e.isIntersecting) { e.target.style.setProperty('--d', Math.min(n++, 9)); e.target.classList.add('in'); io.unobserve(e.target); } });
    }, { threshold: 0.08, rootMargin: '0px 0px -6% 0px' });
    $$('.rv').forEach((el) => io.observe(el));
    if (reduce) $$('.rv').forEach((el) => el.classList.add('in'));
  }
  function countUp(el) {
    const n = +el.dataset.count; if (reduce || n === 0) { el.textContent = n; return; }
    const t0 = performance.now(), dur = 1100; el.textContent = '0';
    (function f(now) { const k = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - k, 4); el.textContent = Math.round(n * e); if (k < 1) requestAnimationFrame(f); })(t0);
  }
  document.addEventListener('load', (e) => { if (e.target.tagName === 'IMG') e.target.classList.add('ld'); }, true);
  function markLoaded(scope) { $$('img', scope || document).forEach((im) => { if (im.complete && im.naturalWidth) im.classList.add('ld'); }); }

  /* ---------------- routing + transition ---------------- */
  const curtain = $('#curtain');
  function go(id) {
    if (!SCENES.includes(id)) id = 'home';
    if (id === st.scene) { window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
    if (!st.entered) { st.scene = id; return; }
    if (st.busy) { st.pending = id; return; }
    st.busy = true; vibe(12);
    $('.ct small', curtain).textContent = t('scene_word') === 'مشهد' ? 'SCENE ' + pad2(SCENES.indexOf(id) + 1) : 'SCENE ' + pad2(SCENES.indexOf(id) + 1);
    $('.ct b', curtain).textContent = LATIN[id];
    curtain.style.setProperty('--a', accOf(id));
    curtain.classList.remove('run'); void curtain.offsetWidth; curtain.classList.add('run');
    SFX.whoosh(SCENES.indexOf(id) >= SCENES.indexOf(st.scene) ? 'up' : 'down');
    setTimeout(() => apply(id, true), 470);
    setTimeout(() => { curtain.classList.remove('run'); st.busy = false; if (st.pending) { const p = st.pending; st.pending = null; go(p); } }, 1080);
  }
  function apply(id, push) {
    st.scene = id; document.body.dataset.scene = id;
    $$('.scene').forEach((s) => { const on = s.dataset.scene === id; s.hidden = !on; if (!on) s.classList.remove('play'); });
    const sc = $('#scene-' + id); sc.classList.remove('play'); void sc.offsetWidth; sc.classList.add('play');
    $$('#nav .nv, #dockTrack .dk').forEach((b) => b.classList.toggle('on', b.dataset.scene === id));
    moveIndicator(); scrollActiveDock();
    if (push) { try { history.pushState({ s: id }, '', '#' + id); } catch (e) {} }
    window.scrollTo(0, 0);
    layoutMasonry(); requestAnimationFrame(layoutMasonry);
    $$('[data-count]', sc).forEach(countUp); markLoaded(sc);
    AU.setScene(id); FX.refreshAccent(); updateTitle();
    $('#progress').style.setProperty('--p', 0);
    if (id === 'credits') startCredits(); else stopCredits();
  }
  function scrollActiveDock() { const d = $('#dockTrack .dk.on'); if (d && isMobile()) { try { d.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' }); } catch (e) {} } }

  /* ---------------- credits ---------------- */
  let crTimer = null, crI = 0;
  function startCredits() {
    const track = $('#scene-credits .cr-track'); track.style.animation = 'none'; void track.offsetWidth; track.style.animation = '';
    const pool = []; ORDER.forEach((id) => gallery(id).forEach((it) => pool.push(it.f))); for (let i = pool.length - 1; i > 0; i--) { const j = rand(i + 1); [pool[i], pool[j]] = [pool[j], pool[i]]; }
    const imgs = $$('#scene-credits .cr-photos img'); crI = 0;
    const show = () => { const im = imgs[crI % 2], other = imgs[(crI + 1) % 2]; other.classList.remove('on'); im.classList.remove('on'); void im.offsetWidth; im.src = pool[crI % pool.length]; im.classList.add('on'); crI++; };
    show(); crTimer = setInterval(show, 7000);
  }
  function stopCredits() { clearInterval(crTimer); crTimer = null; }

  /* ---------------- memory of the day ---------------- */
  function pickMom() {
    const ids = ORDER.filter((i) => gallery(i).length); let id, idx, guard = 0;
    do { id = ids[rand(ids.length)]; idx = rand(gallery(id).length); guard++; } while (st.mom && st.mom.id === id && st.mom.idx === idx && guard < 8);
    st.mom = { id, idx }; renderMom(false);
  }
  function renderMom(noAnim) {
    if (!st.mom) return; const { id, idx } = st.mom, it = gallery(id)[idx], im = $('#momImg'); if (!im) return;
    const apply2 = () => { im.src = it.t; $('#momCard').style.setProperty('--bg', `url(${abs(it.t)})`); im.classList.remove('swap'); };
    if (noAnim || reduce) apply2(); else { im.classList.add('swap'); setTimeout(apply2, 260); }
    $('#momTag').textContent = (T[st.lang].names[id] || id) + ' · ' + pad2(idx + 1); $('#momNum').textContent = pad2(idx + 1);
  }

  /* ---------------- lightbox ---------------- */
  const lb = { el: $('#lightbox'), img: $('#lbImg'), id: null, list: [], i: 0, tok: 0, zoom: false };
  function whoName(id) { return id === 'all' ? t('who_all') : (T[st.lang].names[id] || LATIN[id]); }
  function openLB(id, idx) {
    lb.id = id; lb.list = gallery(id); lb.i = idx; lb.el.hidden = false; document.body.classList.add('locked'); lb.el.classList.remove('ui-off');
    $('#lbStrip').innerHTML = lb.list.map((it, k) => `<button class="lb-th" type="button" data-k="${k}"><img src="${it.t}" alt="" width="64" height="46"></button>`).join('');
    const dots = $('#lbDots'); dots.innerHTML = lb.list.length <= 14 ? lb.list.map(() => '<i></i>').join('') : '';
    if (isMobile() && !$('.lb-hint', lb.el)) { const h = document.createElement('div'); h.className = 'lb-hint'; h.textContent = st.lang === 'ar' ? 'اسحب يمين/يسار للتنقل · لتحت للإغلاق' : 'Swipe to browse · down to close'; lb.el.appendChild(h); }
    root.style.setProperty('--a', accOf(id)); lb.el.style.setProperty('--a', accOf(id));
    showLB(0); SFX.open(); vibe(10);
  }
  function showLB(dir) {
    const it = lb.list[lb.i]; if (!it) return; const tok = ++lb.tok; lb.zoom = false; lb.img.classList.remove('zoom'); lb.img.style.transform = '';
    lb.img.src = it.t; lb.img.alt = `${LATIN[lb.id]} ${lb.i + 1}`;
    if (dir && !reduce) lb.img.animate([{ opacity: 0, transform: `translateX(${dir * 50}px) scale(.97)` }, { opacity: 1, transform: 'none' }], { duration: 420, easing: 'cubic-bezier(.16,1,.3,1)' });
    const full = new Image(); full.src = it.f; full.onload = () => { if (tok === lb.tok) lb.img.src = it.f; };
    [1, -1].forEach((d) => { const n = lb.list[(lb.i + d + lb.list.length) % lb.list.length]; if (n) new Image().src = n.f; });
    $('#lbBg').style.setProperty('--bg', `url(${abs(it.t)})`);
    $('#lbCount').textContent = `${pad2(lb.i + 1)} / ${pad2(lb.list.length)}`; $('#lbWho').textContent = t('lb_from')(whoName(lb.id));
    $$('#lbStrip .lb-th').forEach((b, k) => b.classList.toggle('on', k === lb.i)); const on = $('#lbStrip .lb-th.on'); if (on && !isMobile()) on.scrollIntoView({ inline: 'center', block: 'nearest', behavior: dir ? 'smooth' : 'auto' });
    $$('#lbDots i').forEach((d, k) => d.classList.toggle('on', k === lb.i));
  }
  function stepLB(d) { if (!lb.list.length) return; lb.i = (lb.i + d + lb.list.length) % lb.list.length; showLB(d); SFX.swipe(); vibe(6); }
  function closeLB() { if (lb.el.hidden) return; lb.el.hidden = true; document.body.classList.remove('locked'); lb.img.src = ''; SFX.close(); }
  function initLB() {
    $('#lbClose').onclick = closeLB; $('#lbPrev').onclick = () => stepLB(root.dir === 'rtl' ? 1 : -1); $('#lbNext').onclick = () => stepLB(root.dir === 'rtl' ? -1 : 1);
    $('#lbStrip').addEventListener('click', (e) => { const b = e.target.closest('.lb-th'); if (b) { const k = +b.dataset.k; const d = k > lb.i ? 1 : -1; lb.i = k; showLB(d); SFX.swipe(); } });
    document.addEventListener('keydown', (e) => {
      if (lb.el.hidden) return;
      if (e.key === 'Escape') closeLB();
      else if (e.key === 'ArrowLeft') stepLB(root.dir === 'rtl' ? 1 : -1);
      else if (e.key === 'ArrowRight') stepLB(root.dir === 'rtl' ? -1 : 1);
    });
    const stg = $('#lbStage'); let g = null;
    stg.addEventListener('pointerdown', (e) => { if (e.target !== lb.img && e.pointerType === 'mouse') return; g = { x: e.clientX, y: e.clientY, t: performance.now(), dx: 0, dy: 0, moved: false }; try { stg.setPointerCapture(e.pointerId); } catch (er) {} });
    stg.addEventListener('pointermove', (e) => {
      if (!g || lb.zoom) return; g.dx = e.clientX - g.x; g.dy = e.clientY - g.y; if (Math.abs(g.dx) > 6 || Math.abs(g.dy) > 6) g.moved = true;
      if (e.pointerType === 'mouse') return;
      const ax = Math.abs(g.dx) > Math.abs(g.dy); lb.img.style.transition = 'none';
      lb.img.style.transform = ax ? `translateX(${g.dx * 0.8}px)` : `translateY(${Math.max(0, g.dy)}px) scale(${1 - Math.min(0.25, Math.max(0, g.dy) / 900)})`;
    });
    const end = (e) => {
      if (!g) return; const d = g; g = null; lb.img.style.transition = ''; const v = Math.abs(d.dx) / Math.max(1, performance.now() - d.t);
      if (!d.moved) { // tap
        if (e.target === lb.img) {
          if (isMobile()) { const now = performance.now(); if (now - (lb._tap || 0) < 300) { toggleZoom(e); lb._tap = 0; } else { lb._tap = now; setTimeout(() => { if (lb._tap && performance.now() - lb._tap >= 290) { lb.el.classList.toggle('ui-off'); lb._tap = 0; } }, 310); } }
          else toggleZoom(e);
        } else if (!isMobile()) closeLB();
        return;
      }
      if (e.pointerType === 'mouse' && !lb.zoom) { if (Math.abs(d.dx) > 90) stepLB((d.dx > 0) === (root.dir === 'rtl') ? 1 : -1); lb.img.style.transform = ''; return; }
      const ax = Math.abs(d.dx) > Math.abs(d.dy);
      if (ax && (Math.abs(d.dx) > 70 || v > 0.5)) { lb.img.style.transform = ''; stepLB((d.dx > 0) === (root.dir === 'rtl') ? 1 : -1); }
      else if (!ax && (d.dy > 110)) { closeLB(); } else lb.img.style.transform = '';
    };
    stg.addEventListener('pointerup', end); stg.addEventListener('pointercancel', () => { g = null; lb.img.style.transform = ''; });
  }
  function toggleZoom(e) {
    lb.zoom = !lb.zoom; const r = lb.img.getBoundingClientRect();
    lb.img.style.transformOrigin = `${((e.clientX - r.left) / r.width * 100).toFixed(1)}% ${((e.clientY - r.top) / r.height * 100).toFixed(1)}%`;
    lb.img.classList.toggle('zoom', lb.zoom); lb.img.style.transform = ''; SFX.pop();
  }

  /* ---------------- interactions ---------------- */
  const lastJoke = {};
  function typeJoke(id) {
    const el = $('#joke-' + id); if (!el) return; const arr = JOKES[id]; if (!arr.length) return;
    let j; do { j = rand(arr.length); } while (arr.length > 1 && j === lastJoke[id]); lastJoke[id] = j;
    const txt = arr[j]; el.textContent = ''; el.classList.add('caret'); SFX.pop(); vibe(10);
    if (reduce) { el.textContent = txt; el.classList.remove('caret'); return; }
    let i = 0; clearInterval(el._t);
    el._t = setInterval(() => { el.textContent = txt.slice(0, ++i); if (i % 2 === 0) SFX.tick(); if (i >= txt.length) { clearInterval(el._t); setTimeout(() => el.classList.remove('caret'), 1400); } }, 42);
  }
  async function share(btn, id) {
    const url = location.origin + location.pathname + '#' + id, old = btn.textContent;
    try { await navigator.clipboard.writeText(url); btn.textContent = t('copied'); SFX.chime([0, 2, 4, 6]); }
    catch (e) { btn.textContent = t('copy_fail'); SFX.error(); }
    setTimeout(() => { btn.textContent = old; }, 1700);
  }
  function sendSuggestion() {
    const ta = $('#sugText'), text = ta.value.trim();
    if (!text) { ta.focus(); SFX.error(); ta.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-8px)' }, { transform: 'translateX(8px)' }, { transform: 'translateX(0)' }], { duration: 300 }); $('#sugStatus').textContent = t('sug_empty'); return; }
    const subject = encodeURIComponent('اقتراح لأرشيف أريد لفة'), body = encodeURIComponent(text + '\n\n— من أرشيف أريد لفة');
    SFX.chime([0, 2, 4, 7]); window.location.href = 'mailto:' + SUGGESTION_EMAIL + '?subject=' + subject + '&body=' + body; $('#sugStatus').textContent = t('sug_sent');
  }
  function initSoundUI() {
    const btn = $('#sndBtn'), pop = $('#sndPop'), vol = $('#sndVol'), music = $('#sndMusic'), fx = $('#sndFx'), val = $('#sndVal');
    const sync = () => { const s = AU.state; vol.value = Math.round(s.vol * 100); vol.style.setProperty('--v', vol.value + '%'); val.textContent = vol.value + '%'; music.checked = s.music; fx.checked = s.fx; btn.classList.toggle('muted', (!s.music && !s.fx) || s.vol === 0); };
    sync();
    btn.onclick = (e) => { e.stopPropagation(); AU.unlock(); pop.hidden = !pop.hidden; btn.setAttribute('aria-expanded', String(!pop.hidden)); sync(); };
    vol.oninput = () => { AU.unlock(); AU.setVolume(vol.value / 100); sync(); };
    music.onchange = () => { AU.setMusic(music.checked); sync(); };
    fx.onchange = () => { AU.setFx(fx.checked); sync(); if (fx.checked) SFX.pop(); };
    document.addEventListener('click', (e) => { if (!pop.hidden && !pop.contains(e.target) && !btn.contains(e.target)) { pop.hidden = true; btn.setAttribute('aria-expanded', 'false'); } });
  }

  /* profile swipe (mobile story navigation) */
  function initProfileSwipe() {
    let g = null;
    stage.addEventListener('pointerdown', (e) => { if (!isMobile() || e.pointerType !== 'touch') return; const c = e.target.closest('.pcover'); if (!c) return; g = { x: e.clientX, y: e.clientY }; });
    stage.addEventListener('pointerup', (e) => {
      if (!g) return; const dx = e.clientX - g.x, dy = e.clientY - g.y; g = null;
      if (Math.abs(dx) < 80 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
      const i = ORDER.indexOf(st.scene); if (i < 0) return; const next = (dx > 0) === (root.dir === 'rtl');
      const tgt = next ? ORDER[i + 1] : ORDER[i - 1]; if (tgt) go(tgt); else if (!next) go('home');
    });
    stage.addEventListener('pointercancel', () => { g = null; });
  }

  /* ---------------- global delegates ---------------- */
  function initDelegates() {
    document.addEventListener('click', (e) => {
      const tgt = e.target;
      const goEl = tgt.closest('[data-go]'); if (goEl) { e.preventDefault(); go(goEl.dataset.go); return; }
      const ph = tgt.closest('.ph-b'); if (ph) { openLB(ph.dataset.open, +ph.dataset.idx); return; }
      const jump = tgt.closest('[data-jump]'); if (jump) { const el = $(jump.dataset.jump); if (el) el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth' }); return; }
      if (tgt.closest('[data-random]')) { pickMom(); const el = $('#mom'); if (el) el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth' }); return; }
      if (tgt.closest('#momAgain')) { pickMom(); return; }
      if (tgt.closest('#momCard')) { if (st.mom) go(st.mom.id); return; }
      const jk = tgt.closest('[data-joke]'); if (jk) { typeJoke(jk.dataset.joke); return; }
      const sh = tgt.closest('[data-share]'); if (sh) { share(sh, sh.dataset.share); return; }
      if (tgt.closest('#sugSend')) { sendSuggestion(); return; }
      if (tgt.closest('#crPause')) { const sc = $('#scene-credits'); const p = sc.classList.toggle('paused'); $('#crPause span').textContent = t(p ? 'credits_play' : 'credits_pause'); return; }
    });
    // click sfx
    document.addEventListener('pointerdown', (e) => {
      AU.unlock();
      if (e.target.closest && e.target.closest('button,a,[data-go],.nv,.dk,.ph-b') && !e.target.closest('#lbStage,.lb-nav,.lb-x,[data-joke],[data-share],#sugSend,.snd-pop,#enterBtn')) { SFX.click(); vibe(6); }
    }, { passive: true });
    // hover sfx (desktop / fine pointer)
    let hl = 0;
    document.addEventListener('pointerover', (e) => {
      if (isMobile() || e.pointerType === 'touch') return; const el = e.target.closest && e.target.closest('.nv,.pin,.cl,.fcard,.rl,.ph-b,.btn,.lb-th'); if (!el || (e.relatedTarget && el.contains(e.relatedTarget))) return;
      const n = performance.now(); if (n - hl < 70) return; hl = n; SFX.hover();
      if (el.dataset.id) $$(`[data-id="${el.dataset.id}"]`).forEach((x) => x.classList.add('hl'));
    }, { passive: true });
    document.addEventListener('pointerout', (e) => { const el = e.target.closest && e.target.closest('[data-id]'); if (el) $$(`[data-id="${el.dataset.id}"]`).forEach((x) => x.classList.remove('hl')); }, { passive: true });
    $('#langBtn').onclick = () => { SFX.pop(); setLang(st.lang === 'ar' ? 'en' : 'ar'); };
    addEventListener('popstate', () => { const h = (location.hash || '#home').slice(1); if (SCENES.includes(h) && h !== st.scene) go(h); });
    let rz; addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => { layoutMasonry(); moveIndicator(); }, 120); });
  }

  /* ---------------- device switching ---------------- */
  function initDevice() {
    const mq = matchMedia('(max-width: 860px), (hover: none) and (pointer: coarse) and (max-width: 1100px)');
    const set = () => { root.dataset.device = mq.matches ? 'mobile' : 'desktop'; FX.setDevice(root.dataset.device); requestAnimationFrame(() => { layoutMasonry(); moveIndicator(); scrollActiveDock(); }); };
    mq.addEventListener ? mq.addEventListener('change', set) : mq.addListener(set); FX.setDevice(root.dataset.device);
  }

  /* ---------------- intro ---------------- */
  function buildIntro() {
    const lines = ['Welcome To The', '"Areed Laffa"', 'Archive']; const h = $('#introTitle'); let n = 0;
    h.innerHTML = lines.map((ln, li) => `<span class="in-line${li === 1 ? ' big' : ''}">${[...ln].map((c) => { const d = (0.25 + n++ * 0.045).toFixed(3); return c === ' ' ? `<span class="in-ch sp" style="animation-delay:${d}s">&nbsp;</span>` : `<span class="in-ch" style="animation-delay:${d}s">${c}</span>`; }).join('')}</span>`).join('');
    $('#enterBtn').addEventListener('click', enter);
  }
  function enter() {
    if (st.entered || st.entering) return; st.entering = true; const intro = $('#intro');
    AU.unlock(); AU.start(); SFX.riser(1.0); vibe([20, 40, 60]); intro.classList.add('charging');
    setTimeout(() => {
      SFX.impact(); vibe(80); intro.classList.add('flash'); st.entered = true; $('#app').hidden = false; document.body.classList.remove('locked');
      const h = (location.hash || '').slice(1); const target = SCENES.includes(h) ? h : 'home';
      apply(target, false); try { history.replaceState({ s: target }, '', '#' + target); } catch (e) {}
      intro.classList.add('leave'); setTimeout(() => intro.remove(), 1200);
    }, 1000);
  }

  /* ---------------- boot ---------------- */
  function boot() {
    stage.innerHTML = homeHTML() + ORDER.map(profileHTML).join('') + creditsHTML();
    buildNav(); buildIntro(); initSoundUI(); initLB(); initDelegates(); initProfileSwipe(); initDevice();
    root.lang = st.lang; root.dir = st.lang === 'ar' ? 'rtl' : 'ltr'; $('#langBtn').textContent = st.lang === 'ar' ? 'EN' : 'AR';
    applyI18n(); pickMom(); setupReveal(); markLoaded(); FX.init();
    const h = (location.hash || '').slice(1); st.scene = SCENES.includes(h) ? h : null; st.scene = null; document.body.classList.add('locked');
    window.__al = { go, st, layoutMasonry, openLB };
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { moveIndicator(); layoutMasonry(); });
  }
  boot();
})();
