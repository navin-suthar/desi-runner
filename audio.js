/* audio.js — Desi Dash: all sound synthesized live with the Web Audio API.
   No audio files. Audio starts only after the first user input. */
(function () {
  const A = {};
  let ctx = null, master, musicBus, sfxBus, noiseBuf, verb;
  let muted = localStorage.getItem("dd_muted") === "1";
  let musicOn = false, timer = null, nextT = 0, step = 0;
  const MASTER_VOL = 0.6;
  const hz = m => 440 * Math.pow(2, (m - 69) / 12);

  A.init = function () {
    if (ctx) { if (ctx.state === "suspended") ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    ctx = new AC();
    master = ctx.createGain(); master.gain.value = muted ? 0 : MASTER_VOL;
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 4;
    master.connect(comp); comp.connect(ctx.destination);
    musicBus = ctx.createGain(); musicBus.gain.value = 0.42; musicBus.connect(master);
    sfxBus = ctx.createGain(); sfxBus.gain.value = 0.8; sfxBus.connect(master);
    // simple feedback-delay "room" for the lead
    verb = ctx.createDelay(); verb.delayTime.value = 0.23;
    const fb = ctx.createGain(); fb.gain.value = 0.28; const vg = ctx.createGain(); vg.gain.value = 0.35;
    verb.connect(fb); fb.connect(verb); verb.connect(vg); vg.connect(musicBus);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  };
  A.isMuted = () => muted;
  A.setMuted = m => { muted = m; localStorage.setItem("dd_muted", m ? "1" : "0"); if (master) master.gain.setTargetAtTime(m ? 0 : MASTER_VOL, ctx.currentTime, 0.03); };
  A.toggleMute = () => { A.setMuted(!muted); return muted; };
  const ok = () => ctx && ctx.state === "running";

  function osc(type, f0, f1, t, dur, vol, dest, attack) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, t);
    if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + (attack || 0.005));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(dest || sfxBus); o.start(t); o.stop(t + dur + 0.05);
    return o;
  }
  function noise(t, dur, vol, type, freq, q, dest, f1) {
    const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = noiseBuf; f.type = type || "bandpass"; f.frequency.setValueAtTime(freq || 1000, t); f.Q.value = q || 1;
    if (f1) f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(dest || sfxBus); s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.05);
  }

  /* ---------- SFX ---------- */
  A.coin = () => { if (!ok()) return; const t = ctx.currentTime;
    osc("sine", 1568, 0, t, 0.09, 0.22); osc("sine", 2093, 0, t + 0.05, 0.22, 0.2); osc("triangle", 4186, 0, t + 0.05, 0.12, 0.05); };
  A.jump = () => { if (!ok()) return; const t = ctx.currentTime; osc("square", 300, 820, t, 0.18, 0.1); noise(t, 0.12, 0.08, "highpass", 3000); };
  A.roll = () => { if (!ok()) return; const t = ctx.currentTime; noise(t, 0.35, 0.35, "lowpass", 2400, 1, null, 300); osc("triangle", 180, 90, t, 0.25, 0.12); };
  A.land = () => { if (!ok()) return; const t = ctx.currentTime; osc("sine", 140, 60, t, 0.1, 0.25); };
  A.crash = () => { if (!ok()) return; const t = ctx.currentTime;
    noise(t, 0.6, 0.7, "lowpass", 3000, 0.7, null, 150); osc("sine", 160, 35, t, 0.5, 0.7); osc("square", 220, 55, t, 0.35, 0.12); };
  A.stumble = () => { if (!ok()) return; const t = ctx.currentTime; osc("sine", 200, 70, t, 0.18, 0.5); noise(t, 0.15, 0.3, "lowpass", 900); };
  A.whistle = () => { if (!ok()) return; const t = ctx.currentTime; // TT uncle's whistle (trilled)
    const o = osc("sine", 2600, 0, t, 0.7, 0.12, null, 0.02);
    const lfo = ctx.createOscillator(), lg = ctx.createGain(); lfo.frequency.value = 28; lg.gain.value = 180;
    lfo.connect(lg); lg.connect(o.frequency); lfo.start(t); lfo.stop(t + 0.75); noise(t, 0.6, 0.05, "bandpass", 2600, 8); };
  A.policeWhistle = () => { if (!ok()) return; const t = ctx.currentTime; // shrill pea-whistle: short-long blasts
    [[0, 0.16], [0.24, 0.55]].forEach(([d, len]) => {
      const o = osc("square", 3150, 0, t + d, len, 0.06, null, 0.01); const o2 = osc("sine", 3150, 0, t + d, len, 0.1, null, 0.01);
      const lfo = ctx.createOscillator(), lg = ctx.createGain(); lfo.type = "square"; lfo.frequency.value = 42; lg.gain.value = 260;
      lfo.connect(lg); lg.connect(o.frequency); lg.connect(o2.frequency); lfo.start(t + d); lfo.stop(t + d + len + 0.05);
      noise(t + d, len, 0.04, "bandpass", 3200, 6);
    }); };
  A.powerup = () => { if (!ok()) return; const t = ctx.currentTime;
    [60, 62, 64, 67, 69, 72, 74, 76, 79, 84].forEach((n, i) => osc("square", hz(n + 7), 0, t + i * 0.04, 0.1, 0.07)); osc("sine", hz(91), 0, t + 0.4, 0.4, 0.1); };
  A.powerdown = () => { if (!ok()) return; const t = ctx.currentTime; [79, 74, 70, 67].forEach((n, i) => osc("triangle", hz(n), 0, t + i * 0.06, 0.1, 0.12)); };
  A.horn = () => { if (!ok()) return; const t = ctx.currentTime; // two-tone train horn
    [[311, 0], [370, 0]].forEach(([f]) => { const o = osc("sawtooth", f, 0, t, 0.9, 0.06, null, 0.04); o.frequency.setValueAtTime(f, t + 0.45); o.frequency.linearRampToValueAtTime(f * 0.94, t + 0.9); }); };
  A.click = () => { if (!ok()) return; osc("square", 880, 0, ctx.currentTime, 0.05, 0.06); };

  /* ---------- Music: dhol groove + tanpura drone + shehnai-ish lead ---------- */
  const BPM = 124, S16 = 60 / BPM / 4;
  // Khamaj-flavoured melody (Sa = C4 = 60). 0 = rest, -1 = hold. 64 steps (4 bars of 16ths)
  const LEAD = [
    67, -1, 69, 70, 69, -1, 67, -1, 65, 67, 64, -1, 62, -1, 60, -1,
    62, 64, 65, -1, 67, -1, 69, -1, 70, -1, 69, 67, 69, -1, -1, -1,
    72, -1, 70, 69, 70, -1, 69, 67, 65, -1, 67, 69, 67, -1, 65, 64,
    65, -1, 64, 62, 64, -1, 62, 60, 62, -1, 64, -1, 60, -1, -1, 0
  ];
  // dhol "chaal"-style pattern: D = low dagga, T = high tilli, d = soft low
  const DHOL = "D..T..D.d.T.D.T.D..T..D.d.TTD.T.";
  function dholLow(t, v) { osc("sine", 130, 48, t, 0.28, 0.9 * v, musicBus); noise(t, 0.06, 0.25 * v, "lowpass", 600, 1, musicBus); }
  function dholHigh(t, v) { noise(t, 0.07, 0.35 * v, "bandpass", 2200, 3, musicBus); osc("triangle", 520, 380, t, 0.06, 0.15 * v, musicBus); }
  function leadNote(n, t, dur) {
    const o = ctx.createOscillator(), o2 = ctx.createOscillator(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    o.type = "sawtooth"; o2.type = "square"; o2.detune.value = 7;
    const f0 = hz(n);
    o.frequency.setValueAtTime(f0 * 0.97, t); o.frequency.exponentialRampToValueAtTime(f0, t + 0.06); // little meend
    o2.frequency.setValueAtTime(f0 * 0.97, t); o2.frequency.exponentialRampToValueAtTime(f0, t + 0.06);
    const lfo = ctx.createOscillator(), lg = ctx.createGain(); lfo.frequency.value = 5.5; lg.gain.value = f0 * 0.012;
    lfo.connect(lg); lg.connect(o.frequency); lg.connect(o2.frequency);
    f.type = "bandpass"; f.frequency.value = 1400; f.Q.value = 1.4;
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.16, t + 0.03);
    g.gain.setValueAtTime(0.14, t + dur * 0.8); g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.05);
    o.connect(f); o2.connect(f); f.connect(g); g.connect(musicBus); g.connect(verb);
    [o, o2, lfo].forEach(x => { x.start(t); x.stop(t + dur + 0.1); });
  }
  function drone(t, dur) { // tanpura-ish Pa-Sa
    [43, 48, 55].forEach((n, i) => osc("triangle", hz(n), 0, t + i * 0.12, dur, 0.05, musicBus, 0.08));
  }
  function schedule(i, t) {
    const s = i % 64, ch = DHOL[i % 32];
    if (ch === "D") dholLow(t, 1); else if (ch === "d") dholLow(t, 0.5); else if (ch === "T") dholHigh(t, 1);
    if (i % 8 === 4) noise(t, 0.03, 0.06, "highpass", 7000, 1, musicBus); // chimta-like tick
    const n = LEAD[s];
    if (n > 0) { let len = 1; while (LEAD[(s + len) % 64] === -1 && len < 8) len++; leadNote(n, t, len * S16); }
    if (s % 16 === 0) drone(t, S16 * 16);
  }
  function tick() { while (nextT < ctx.currentTime + 0.15) { schedule(step, nextT); nextT += S16; step++; } }
  A.startMusic = function () { if (!ctx || musicOn) return; musicOn = true; step = 0; nextT = ctx.currentTime + 0.08; timer = setInterval(tick, 30); };
  A.stopMusic = function () { musicOn = false; if (timer) clearInterval(timer); timer = null; };
  A.isMusicOn = () => musicOn;
  window.DesiAudio = A;
})();
