/* game.js — Desi Dash: an original Indian-themed 3-lane endless runner.
   Three.js scene, all models/textures built in code. */
(function () {
  "use strict";
  const $ = id => document.getElementById(id);
  function fatal(msg) { $("error-text").textContent = msg; $("error-screen").classList.remove("hidden"); $("title-screen").classList.add("hidden"); }
  if (!window.THREE) { fatal("Could not load Three.js from the CDN. Check your internet connection and reload."); return; }
  const AU = window.DesiAudio;
  const params = new URLSearchParams(location.search);
  let AUTOPILOT = params.has("autopilot"); // demo/attract mode: the game plays itself

  /* ======================= RENDERER / SCENE ======================= */
  const canvas = $("scene");
  let renderer;
  const IS_MOBILE = window.matchMedia("(pointer: coarse)").matches || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  try { renderer = new THREE.WebGLRenderer({ canvas, antialias: !IS_MOBILE, powerPreference: "high-performance" }); }
  catch (e) { fatal("Your browser could not start WebGL 3D graphics."); return; }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, IS_MOBILE ? 1.5 : 2)); // no shadow maps are used (blob shadow only) to stay fast on phones
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  const FOG = 0xffd9a8;
  scene.fog = new THREE.Fog(FOG, 55, 165);
  const camera = new THREE.PerspectiveCamera(62, 1, 0.1, 400);
  scene.add(new THREE.HemisphereLight(0xfff4e0, 0x9a7a50, 1.6));
  const sun = new THREE.DirectionalLight(0xfff0d0, 2.0); sun.position.set(-12, 25, 14); scene.add(sun);

  let portrait = false;
  function resize() {
    const vv = window.visualViewport;
    const w = Math.round(vv ? vv.width : window.innerWidth), h = Math.round(vv ? vv.height : window.innerHeight);
    renderer.setSize(w, h, false); camera.aspect = w / h;
    portrait = w / h < 0.9;
    camera.fov = portrait ? 74 : 62; // portrait phones need a wider/taller view
    camera.updateProjectionMatrix();
  }
  window.addEventListener("resize", resize);
  window.addEventListener("orientationchange", () => setTimeout(resize, 150));
  if (window.visualViewport) window.visualViewport.addEventListener("resize", resize);
  resize();

  /* ======================= HELPERS ======================= */
  const rand = (a, b) => a + Math.random() * (b - a);
  const randi = (a, b) => Math.floor(rand(a, b + 1));
  const pick = arr => arr[Math.floor(Math.random() * arr.length)];
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const matCache = {}, geoCache = {};
  function mat(color, opts) {
    const key = color + JSON.stringify(opts || {});
    if (!matCache[key]) matCache[key] = new THREE.MeshLambertMaterial(Object.assign({ color, flatShading: true }, opts || {}));
    return matCache[key];
  }
  function boxGeo(w, h, d) { const k = "b" + w + "_" + h + "_" + d; return geoCache[k] || (geoCache[k] = new THREE.BoxGeometry(w, h, d)); }
  function B(parent, w, h, d, color, x, y, z, material) {
    const m = new THREE.Mesh(boxGeo(w, h, d), material || mat(color)); m.position.set(x || 0, y || 0, z || 0); parent.add(m); return m;
  }
  function cyl(parent, rt, rb, h, seg, color, x, y, z, material) {
    const k = "c" + rt + rb + h + seg; const g = geoCache[k] || (geoCache[k] = new THREE.CylinderGeometry(rt, rb, h, seg));
    const m = new THREE.Mesh(g, material || mat(color)); m.position.set(x || 0, y || 0, z || 0); parent.add(m); return m;
  }
  function sph(parent, r, color, x, y, z, seg) {
    const k = "s" + r + (seg || 8); const g = geoCache[k] || (geoCache[k] = new THREE.SphereGeometry(r, seg || 8, Math.max(4, (seg || 8) - 2)));
    const m = new THREE.Mesh(g, mat(color)); m.position.set(x || 0, y || 0, z || 0); parent.add(m); return m;
  }
  const texCache = {};
  function canvasTex(key, w, h, draw, repeat) {
    if (texCache[key]) return texCache[key];
    const c = document.createElement("canvas"); c.width = w; c.height = h;
    draw(c.getContext("2d"), w, h);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
    texCache[key] = t; return t;
  }
  const texMatCache = {};
  function texMat(tex, opts) {
    const k = tex.uuid + JSON.stringify(opts || {});
    return texMatCache[k] || (texMatCache[k] = new THREE.MeshLambertMaterial(Object.assign({ map: tex }, opts || {})));
  }
  // Merge all static single-material meshes of a model into one mesh per material (far fewer draw calls)
  function mergeStatic(group) {
    group.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(group.matrixWorld).invert();
    const buckets = new Map(), remove = [];
    group.traverse(o => {
      if (!o.isMesh || o.isInstancedMesh || Array.isArray(o.material) || !o.geometry.attributes.uv || o.userData.keep) return;
      const m = new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld);
      const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
      g.applyMatrix4(m);
      if (!buckets.has(o.material)) buckets.set(o.material, []);
      buckets.get(o.material).push(g); remove.push(o);
    });
    remove.forEach(o => o.parent.remove(o));
    buckets.forEach((geos, material) => {
      let n = 0; geos.forEach(g => n += g.attributes.position.count);
      const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2);
      let o3 = 0, o2 = 0;
      geos.forEach(g => { pos.set(g.attributes.position.array, o3); nor.set(g.attributes.normal.array, o3); uv.set(g.attributes.uv.array, o2); o3 += g.attributes.position.count * 3; o2 += g.attributes.position.count * 2; g.dispose(); });
      const mg = new THREE.BufferGeometry();
      mg.setAttribute("position", new THREE.BufferAttribute(pos, 3)); mg.setAttribute("normal", new THREE.BufferAttribute(nor, 3)); mg.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
      const mesh = new THREE.Mesh(mg, material); mesh.userData.merged = true; group.add(mesh);
    });
    return group;
  }
  function disposeModel(obj) {
    obj.traverse(o => { if (o.userData && (o.userData.merged || o.userData.ownGeo)) o.geometry.dispose(); });
    if (obj.userData.tex) obj.userData.tex.dispose();
    if (obj.userData.mat) obj.userData.mat.dispose();
  }
  const FONT = "'Baloo 2', 'Noto Sans Devanagari', 'Trebuchet MS', sans-serif";

  /* ======================= TEXTURES ======================= */
  const skyTex = canvasTex("sky", 4, 256, (x, w, h) => {
    const g = x.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, "#4fb3ff"); g.addColorStop(0.55, "#9fdcff"); g.addColorStop(0.8, "#ffe9c4"); g.addColorStop(1, "#ffd9a8");
    x.fillStyle = g; x.fillRect(0, 0, w, h);
  });
  scene.background = skyTex;

  const trackTex = canvasTex("track", 128, 128, (x, w, h) => {
    x.fillStyle = "#7d6b5a"; x.fillRect(0, 0, w, h);
    for (let i = 0; i < 900; i++) { x.fillStyle = pick(["#6a5949", "#8e7c69", "#5c4d3f", "#9a8875"]); x.fillRect(Math.random() * w, Math.random() * h, 2, 2); }
    [[8, 26], [72, 90]].forEach(([a, b]) => { x.fillStyle = "#5e3f22"; x.fillRect(6, a, w - 12, b - a); x.fillStyle = "#7a5530"; x.fillRect(6, a, w - 12, 4); });
    [[26, 36], [92, 102]].forEach(([a, b]) => { x.fillStyle = "#c9ced6"; x.fillRect(a, 0, b - a, h); x.fillStyle = "#6f747c"; x.fillRect(b - 3, 0, 3, h); x.fillStyle = "#eef2f7"; x.fillRect(a + 2, 0, 2, h); });
  }, true);
  trackTex.repeat.set(1, 320 / 6);
  const groundTex = canvasTex("ground", 128, 128, (x, w, h) => {
    x.fillStyle = "#b99a72"; x.fillRect(0, 0, w, h);
    for (let i = 0; i < 700; i++) { x.fillStyle = pick(["#a88a63", "#c7a982", "#9c7e58", "#d1b48c"]); x.fillRect(Math.random() * w, Math.random() * h, 3, 3); }
  }, true);
  groundTex.repeat.set(12, 320 / 6);
  const paveTex = canvasTex("pave", 128, 128, (x, w, h) => {
    x.fillStyle = "#c8b7a0"; x.fillRect(0, 0, w, h);
    x.strokeStyle = "#9e8c75"; x.lineWidth = 3;
    for (let i = 0; i <= 4; i++) { x.beginPath(); x.moveTo(0, i * 32); x.lineTo(w, i * 32); x.stroke(); }
    for (let r = 0; r < 4; r++) for (let i = 0; i <= 2; i++) { const xx = i * 64 + (r % 2) * 32; x.beginPath(); x.moveTo(xx, r * 32); x.lineTo(xx, r * 32 + 32); x.stroke(); }
    x.fillStyle = "#d8a11f"; x.fillRect(0, 0, 10, h); // yellow kerb edge
    x.fillStyle = "#222"; for (let y = 0; y < h; y += 32) x.fillRect(0, y, 10, 16);
  }, true);
  paveTex.repeat.set(1, 40);

  function coachTex(kind) {
    return canvasTex("coach_" + kind, 512, 128, (x, w, h) => {
      const body = kind === "blue" ? "#2457a8" : "#7c1f2c", stripe = kind === "blue" ? "#f1e3b5" : "#f2c230";
      x.fillStyle = body; x.fillRect(0, 0, w, h);
      x.fillStyle = stripe; x.fillRect(0, 22, w, 6); x.fillRect(0, 96, w, 4);
      // doors at both ends
      [[14, 46], [w - 62, w - 30]].forEach(([a, b]) => { x.fillStyle = "#1b1b22"; x.fillRect(a, 34, b - a, 80); x.fillStyle = body; x.fillRect(a + 4, 38, b - a - 8, 72); x.fillStyle = "#9cc7e6"; x.fillRect(a + 9, 44, b - a - 18, 20); });
      // barred windows
      for (let i = 0; i < 9; i++) {
        const wx = 60 + i * 44;
        x.fillStyle = "#14161e"; x.fillRect(wx, 38, 32, 28);
        x.fillStyle = "#3a4b66"; x.fillRect(wx + 2, 40, 28, 24);
        x.fillStyle = "#c9ced6"; for (let b = 0; b < 4; b++) x.fillRect(wx + 2, 43 + b * 6, 28, 1.5);
      }
      x.fillStyle = "#ffffff"; x.font = "bold 14px sans-serif"; x.fillText(kind === "blue" ? "DD 2S  04217" : "DD SL  86103", 200, 86);
      x.fillStyle = "#101014"; x.fillRect(w - 20, 0, 20, h); // gangway gap between coaches
    }, true);
  }
  const coachEndTex = canvasTex("coachEnd", 128, 128, (x, w, h) => {
    x.fillStyle = "#2457a8"; x.fillRect(0, 0, w, h);
    x.fillStyle = "#1b1b22"; x.fillRect(38, 20, 52, 96); x.fillStyle = "#2c2c36"; x.fillRect(44, 26, 40, 84);
    x.fillStyle = "#f1e3b5"; x.fillRect(0, 12, w, 5);
    x.fillStyle = "#d32f2f"; x.fillRect(10, 96, 14, 14); x.fillRect(104, 96, 14, 14);
  });
  const locoTex = canvasTex("loco", 128, 128, (x, w, h) => {
    x.fillStyle = "#c62828"; x.fillRect(0, 0, w, h);
    x.fillStyle = "#f5f0e1"; x.fillRect(0, 66, w, 18);
    x.fillStyle = "#1f2a44"; x.fillRect(12, 18, 46, 34); x.fillRect(70, 18, 46, 34);
    x.fillStyle = "#8fc4ea"; x.fillRect(15, 21, 40, 28); x.fillRect(73, 21, 40, 28);
    x.fillStyle = "#fffbe0"; x.beginPath(); x.arc(64, 10, 7, 0, 7); x.fill();
    x.beginPath(); x.arc(22, 104, 8, 0, 7); x.arc(106, 104, 8, 0, 7); x.fill();
    x.fillStyle = "#222"; x.font = "bold 13px sans-serif"; x.textAlign = "center"; x.fillText("DD-786", 64, 80);
  });
  const rampTex = canvasTex("ramp", 64, 128, (x, w, h) => {
    x.fillStyle = "#f2b705"; x.fillRect(0, 0, w, h);
    x.fillStyle = "#1a1a1a";
    for (let y = -64; y < h; y += 32) { x.beginPath(); x.moveTo(0, y + 16); x.lineTo(w / 2, y); x.lineTo(w, y + 16); x.lineTo(w, y + 28); x.lineTo(w / 2, y + 12); x.lineTo(0, y + 28); x.fill(); }
  }, true);
  const stripeTex = canvasTex("stripe", 128, 16, (x, w, h) => {
    for (let i = 0; i < 8; i++) { x.fillStyle = i % 2 ? "#ffffff" : "#d62828"; x.fillRect(i * 16, 0, 16, h); }
  });
  const hazardTex = canvasTex("hazard", 128, 16, (x, w, h) => {
    x.fillStyle = "#f2c230"; x.fillRect(0, 0, w, h); x.fillStyle = "#151515";
    for (let i = -2; i < 10; i++) { x.beginPath(); x.moveTo(i * 16, h); x.lineTo(i * 16 + 8, h); x.lineTo(i * 16 + 16, 0); x.lineTo(i * 16 + 8, 0); x.fill(); }
  });
  const coinFaceTex = canvasTex("coinFace", 128, 128, (x, w, h) => {
    const g = x.createRadialGradient(48, 44, 8, 64, 64, 64); g.addColorStop(0, "#fff3a0"); g.addColorStop(0.6, "#f9b81b"); g.addColorStop(1, "#c07c00");
    x.fillStyle = g; x.fillRect(0, 0, w, h);
    x.strokeStyle = "#a86500"; x.lineWidth = 8; x.beginPath(); x.arc(64, 64, 50, 0, 7); x.stroke();
    x.save(); x.translate(64, 64); x.rotate(-Math.PI / 2); x.fillStyle = "#9a5a00"; x.font = "bold 76px sans-serif"; x.textAlign = "center"; x.textBaseline = "middle"; x.fillText("₹", 0, 4); x.restore();
  });
  function textTex(key, text, opts) {
    const o = Object.assign({ w: 256, h: 64, bg: "#fff", fg: "#111", font: "800 40px " + FONT, border: null }, opts || {});
    return canvasTex("txt_" + key, o.w, o.h, (x, w, h) => {
      x.fillStyle = o.bg; x.fillRect(0, 0, w, h);
      if (o.border) { x.strokeStyle = o.border; x.lineWidth = 8; x.strokeRect(4, 4, w - 8, h - 8); }
      x.fillStyle = o.fg; x.font = o.font; x.textAlign = "center"; x.textBaseline = "middle";
      const lines = String(text).split("\n");
      lines.forEach((ln, i) => x.fillText(ln, w / 2, h / 2 + (i - (lines.length - 1) / 2) * (h / (lines.length + 0.3))));
    });
  }
  const BUILD_COLORS = ["#f48fb1", "#ffd54f", "#4dd0e1", "#aed581", "#ff8a65", "#ba68c8", "#fff176", "#80cbc4", "#f06292", "#ffb74d"];
  function windowTex(color) {
    return canvasTex("win_" + color, 128, 128, (x, w, h) => {
      x.fillStyle = color; x.fillRect(0, 0, w, h);
      x.fillStyle = "rgba(0,0,0,0.12)"; x.fillRect(0, 60, w, 4); x.fillRect(0, 124, w, 4);
      for (let r = 0; r < 2; r++) for (let c = 0; c < 2; c++) {
        const wx = 16 + c * 64, wy = 12 + r * 64;
        x.fillStyle = "#ffffff"; x.fillRect(wx - 3, wy - 3, 38, 44);
        x.fillStyle = Math.random() < 0.3 ? "#ff9e40" : "#2d4a6b"; x.fillRect(wx, wy, 32, 38);
        x.fillStyle = "#ffffff"; x.fillRect(wx + 15, wy, 2, 38);
        x.fillStyle = "#555"; x.fillRect(wx - 6, wy + 40, 44, 4); // sill / balcony rail
        for (let b = 0; b < 6; b++) x.fillRect(wx - 5 + b * 8, wy + 32, 2, 8);
      }
    }, true);
  }
  function rangoliTex(v) {
    return canvasTex("rangoli" + v, 256, 256, (x, w, h) => {
      x.clearRect(0, 0, w, h); x.translate(128, 128);
      const cols = [["#e91e63", "#ffeb3b", "#4caf50", "#2196f3", "#ff9800"], ["#9c27b0", "#ff5722", "#ffeb3b", "#00bcd4", "#e91e63"], ["#f44336", "#ffc107", "#3f51b5", "#8bc34a", "#ff4081"]][v];
      x.fillStyle = "#fffaf0"; x.beginPath(); x.arc(0, 0, 124, 0, 7); x.fill();
      const rings = [[110, 16, 0], [86, 12, 1], [62, 8, 2], [40, 8, 3]];
      rings.forEach(([r, n, ci]) => {
        x.fillStyle = cols[ci];
        for (let i = 0; i < n; i++) { x.save(); x.rotate(i / n * Math.PI * 2 + ci * 0.2); x.beginPath(); x.ellipse(0, -r + 14, 9 + ci, 20 - ci * 2, 0, 0, 7); x.fill(); x.restore(); }
      });
      x.fillStyle = cols[4]; x.beginPath(); x.arc(0, 0, 18, 0, 7); x.fill();
      x.fillStyle = "#fff"; x.beginPath(); x.arc(0, 0, 7, 0, 7); x.fill();
      x.strokeStyle = cols[0]; x.lineWidth = 4; x.beginPath(); x.arc(0, 0, 122, 0, 7); x.stroke();
    });
  }

  /* ======================= MODELS ======================= */
  const LANE_X = [-2.4, 0, 2.4];
  const TRAIN_H = 3.25, RAMP_LEN = 6.5;

  // --- Hero: "Munna", an original runner kid (seen from behind)
  function makeHero() {
    const root = new THREE.Group(), body = new THREE.Group(); root.add(body);
    const skin = "#c98b5a";
    const legs = [], arms = [];
    [-0.17, 0.17].forEach(x => {
      const leg = new THREE.Group(); leg.position.set(x, 0.78, 0); body.add(leg);
      B(leg, 0.24, 0.5, 0.26, "#2f4f9c", 0, -0.22, 0);       // shorts/jeans
      B(leg, 0.2, 0.32, 0.22, skin, 0, -0.58, 0);            // shin
      B(leg, 0.26, 0.14, 0.4, "#ffffff", 0, -0.74, -0.06);   // sneaker
      B(leg, 0.27, 0.05, 0.41, "#e53935", 0, -0.79, -0.06);
      legs.push(leg);
    });
    B(body, 0.66, 0.66, 0.38, "#ff8f1f", 0, 1.1, 0);          // kurta tee
    B(body, 0.67, 0.08, 0.39, "#138808", 0, 0.8, 0);          // green hem
    B(body, 0.48, 0.52, 0.2, "#2e7d32", 0, 1.14, 0.28);       // backpack (faces camera)
    B(body, 0.36, 0.18, 0.06, "#ffeb3b", 0, 1.04, 0.39);
    [-0.43, 0.43].forEach(x => {
      const arm = new THREE.Group(); arm.position.set(x, 1.38, 0); body.add(arm);
      B(arm, 0.18, 0.28, 0.2, "#ff8f1f", 0, -0.1, 0);
      B(arm, 0.15, 0.36, 0.17, skin, 0, -0.42, 0);
      arms.push(arm);
    });
    B(body, 0.2, 0.12, 0.2, skin, 0, 1.48, 0);                // neck
    const head = new THREE.Group(); head.position.set(0, 1.74, 0); body.add(head);
    B(head, 0.5, 0.48, 0.46, skin, 0, 0, 0);
    B(head, 0.52, 0.2, 0.48, "#1a1a1a", 0, 0.2, 0.02);       // hair
    B(head, 0.54, 0.12, 0.5, "#e53935", 0, 0.3, 0);          // cap
    B(head, 0.44, 0.04, 0.26, "#e53935", 0, 0.25, 0.34);     // brim worn backwards
    B(head, 0.08, 0.14, 0.1, skin, -0.29, 0, 0); B(head, 0.08, 0.14, 0.1, skin, 0.29, 0, 0); // ears
    B(head, 0.08, 0.08, 0.02, "#111", -0.12, 0.02, -0.24); B(head, 0.08, 0.08, 0.02, "#111", 0.12, 0.02, -0.24);
    // kite carried while gliding
    const kite = makeKiteMesh("#e91e63", "#ffeb3b", 1.6); kite.position.set(0, 3.2, -0.4); kite.rotation.x = -0.5; kite.visible = false; root.add(kite);
    const str = B(root, 0.02, 1.4, 0.02, "#ffffff", 0, 2.4, -0.2); str.visible = false;
    return { root, body, legs, arms, head, kite, str };
  }

  // --- TT Uncle: original grumpy ticket checker (black coat, white trousers, big moustache)
  function makeTT() {
    const root = new THREE.Group(), body = new THREE.Group(); root.add(body);
    const skin = "#b9784a", legs = [], arms = [];
    [-0.22, 0.22].forEach(x => {
      const leg = new THREE.Group(); leg.position.set(x, 0.85, 0); body.add(leg);
      B(leg, 0.3, 0.8, 0.32, "#f2f2f2", 0, -0.4, 0); B(leg, 0.32, 0.12, 0.46, "#2b1a10", 0, -0.82, -0.06);
      legs.push(leg);
    });
    B(body, 0.95, 0.85, 0.6, "#15151c", 0, 1.3, 0);                 // black coat
    const belly = sph(body, 0.42, "#15151c", 0, 1.12, -0.18, 10); belly.scale.set(1, 0.9, 0.8);
    B(body, 0.26, 0.6, 0.05, "#ffffff", 0, 1.42, -0.31);              // shirt front
    B(body, 0.09, 0.5, 0.06, "#8b1e3f", 0, 1.4, -0.34);              // tie
    B(body, 0.18, 0.08, 0.06, "#f9b81b", -0.3, 1.55, -0.31);          // badge
    [-0.58, 0.58].forEach((x, i) => {
      const arm = new THREE.Group(); arm.position.set(x, 1.62, 0); body.add(arm);
      B(arm, 0.24, 0.62, 0.26, "#15151c", 0, -0.28, 0); B(arm, 0.18, 0.16, 0.18, skin, 0, -0.66, 0);
      if (i === 1) B(arm, 0.34, 0.44, 0.04, "#d7b98a", 0, -0.75, -0.14); // ticket pad
      arms.push(arm);
    });
    const head = new THREE.Group(); head.position.set(0, 2.0, 0); body.add(head);
    B(head, 0.56, 0.56, 0.52, skin, 0, 0, 0);
    B(head, 0.6, 0.12, 0.3, "#9e9e9e", 0, 0.08, 0.16);               // grey hair at back
    B(head, 0.1, 0.22, 0.4, "#9e9e9e", -0.29, 0.02, 0.04); B(head, 0.1, 0.22, 0.4, "#9e9e9e", 0.29, 0.02, 0.04);
    B(head, 0.5, 0.1, 0.1, "#2a2a2a", 0, -0.1, -0.28);                // moustache
    B(head, 0.16, 0.1, 0.12, "#2a2a2a", -0.27, -0.14, -0.27); B(head, 0.16, 0.1, 0.12, "#2a2a2a", 0.27, -0.14, -0.27);
    const brL = B(head, 0.2, 0.05, 0.04, "#222", -0.13, 0.15, -0.27); brL.rotation.z = -0.4;  // angry brows
    const brR = B(head, 0.2, 0.05, 0.04, "#222", 0.13, 0.15, -0.27); brR.rotation.z = 0.4;
    B(head, 0.16, 0.12, 0.03, "#111", -0.13, 0.05, -0.27); B(head, 0.16, 0.12, 0.03, "#111", 0.13, 0.05, -0.27); // round specs
    B(head, 0.12, 0.08, 0.02, "#ffffff", -0.13, 0.05, -0.29); B(head, 0.12, 0.08, 0.02, "#ffffff", 0.13, 0.05, -0.29);
    B(head, 0.14, 0.04, 0.03, "#5a1010", 0, -0.2, -0.27);              // frown
    B(head, 0.1, 0.14, 0.12, skin, 0, -0.02, -0.3);                    // nose
    return { root, body, legs, arms, head };
  }

  // --- Havaldar: original police constable chaser (khaki uniform, red-banded cap, moustache, lathi)
  function makeCop() {
    const root = new THREE.Group(), body = new THREE.Group(); root.add(body);
    const skin = "#a8693f", khaki = "#c2a165", legs = [], arms = [];
    [-0.18, 0.18].forEach(x => {
      const leg = new THREE.Group(); leg.position.set(x, 0.82, 0); body.add(leg);
      B(leg, 0.27, 0.78, 0.29, khaki, 0, -0.39, 0); B(leg, 0.29, 0.12, 0.42, "#1a1a1a", 0, -0.8, -0.06);
      legs.push(leg);
    });
    B(body, 0.78, 0.8, 0.44, khaki, 0, 1.24, 0);                       // khaki shirt
    B(body, 0.8, 0.1, 0.46, "#6d4c2f", 0, 0.9, 0);                     // leather belt
    B(body, 0.16, 0.1, 0.06, "#e0c060", 0, 0.9, -0.24);                // buckle
    B(body, 0.22, 0.06, 0.48, "#c62828", -0.3, 1.6, 0); B(body, 0.22, 0.06, 0.48, "#c62828", 0.3, 1.6, 0); // red shoulder tabs
    B(body, 0.12, 0.1, 0.05, "#e0c060", 0.22, 1.42, -0.23);            // badge
    B(body, 0.03, 0.4, 0.03, "#ffffff", -0.2, 1.32, -0.23);           // whistle lanyard
    [-0.5, 0.5].forEach((x, i) => {
      const arm = new THREE.Group(); arm.position.set(x, 1.56, 0); body.add(arm);
      B(arm, 0.2, 0.36, 0.22, khaki, 0, -0.16, 0); B(arm, 0.17, 0.4, 0.19, skin, 0, -0.5, 0);
      if (i === 1) { const l = cyl(arm, 0.045, 0.05, 1.5, 6, "#8d5524", 0, -0.72, -0.55); l.rotation.x = Math.PI / 2; // lathi
        cyl(arm, 0.05, 0.05, 0.12, 6, "#f2c230", 0, -0.72, -1.25).rotation.x = Math.PI / 2; }
      arms.push(arm);
    });
    const head = new THREE.Group(); head.position.set(0, 1.92, 0); body.add(head);
    B(head, 0.48, 0.5, 0.46, skin, 0, 0, 0);
    cyl(head, 0.3, 0.27, 0.22, 12, "#9c8150", 0, 0.32, 0);            // khaki cap
    cyl(head, 0.285, 0.285, 0.08, 12, "#c62828", 0, 0.24, 0);         // red band
    B(head, 0.34, 0.04, 0.2, "#2a2a2a", 0, 0.2, -0.3);                 // peak
    B(head, 0.08, 0.06, 0.03, "#e0c060", 0, 0.32, -0.29);              // cap badge
    B(head, 0.4, 0.09, 0.08, "#1c1c1c", 0, -0.11, -0.25);              // big moustache
    B(head, 0.12, 0.1, 0.08, "#1c1c1c", -0.22, -0.07, -0.25).rotation.z = 0.5; B(head, 0.12, 0.1, 0.08, "#1c1c1c", 0.22, -0.07, -0.25).rotation.z = -0.5;
    B(head, 0.08, 0.06, 0.03, "#111", -0.11, 0.05, -0.24); B(head, 0.08, 0.06, 0.03, "#111", 0.11, 0.05, -0.24);
    const b1 = B(head, 0.16, 0.04, 0.03, "#111", -0.11, 0.12, -0.24); b1.rotation.z = -0.35;
    const b2 = B(head, 0.16, 0.04, 0.03, "#111", 0.11, 0.12, -0.24); b2.rotation.z = 0.35;
    B(head, 0.09, 0.12, 0.1, skin, 0, -0.01, -0.27);
    return { root, body, legs, arms, head };
  }
  function makeJeep() {
    const g = new THREE.Group();
    B(g, 1.5, 0.75, 2.7, "#f4f4f4", 0, 0.75, 0);                       // white body
    B(g, 1.52, 0.18, 2.72, "#1e4fa3", 0, 0.82, 0);                     // blue stripe
    B(g, 1.44, 0.48, 1.6, "#f4f4f4", 0, 1.37, 0.4);                    // cabin
    B(g, 1.3, 0.38, 0.05, "#9fd0ee", 0, 1.37, -0.42);                  // windscreen
    B(g, 0.8, 0.14, 0.3, "#222", 0, 1.68, 0.2);                        // light bar
    const red = new THREE.Mesh(boxGeo(0.34, 0.14, 0.3), new THREE.MeshBasicMaterial({ color: 0xff2222 })); red.position.set(-0.22, 1.76, 0.2); g.add(red);
    const blue = new THREE.Mesh(boxGeo(0.34, 0.14, 0.3), new THREE.MeshBasicMaterial({ color: 0x2266ff })); blue.position.set(0.22, 1.76, 0.2); g.add(blue);
    g.userData.lights = [red, blue];
    B(g, 1.3, 0.14, 0.06, "#333", 0, 0.5, -1.37);                      // bumper
    [-0.5, 0.5].forEach(x => { const hl = new THREE.Mesh(boxGeo(0.24, 0.16, 0.04), new THREE.MeshBasicMaterial({ color: 0xfff6c0 })); hl.position.set(x, 0.95, -1.36); g.add(hl); });
    B(g, 1.0, 0.24, 0.04, null, 0, 0.98, -1.37, texMat(textTex("police", "POLICE", { w: 256, h: 64, bg: "#1e4fa3", fg: "#ffffff", font: "800 44px " + FONT })));
    wheel(g, 0.34, -0.72, 0.34, -0.9); wheel(g, 0.34, 0.72, 0.34, -0.9); wheel(g, 0.34, -0.72, 0.34, 0.9); wheel(g, 0.34, 0.72, 0.34, 0.9);
    cyl(g, 0.3, 0.3, 0.2, 10, "#1b1b1b", 0, 0.95, 1.42).rotation.x = Math.PI / 2; // spare wheel
    return g;
  }

  function makeKiteMesh(c1, c2, s) {
    const g = new THREE.Group();
    const shape = new THREE.Shape(); shape.moveTo(0, 0.6); shape.lineTo(0.45, 0); shape.lineTo(0, -0.6); shape.lineTo(-0.45, 0); shape.closePath();
    const k = "kiteShape"; const geo = geoCache[k] || (geoCache[k] = new THREE.ShapeGeometry(shape));
    const m1 = new THREE.Mesh(geo, mat(c1, { side: THREE.DoubleSide })); g.add(m1);
    const half = new THREE.Shape(); half.moveTo(0, 0.6); half.lineTo(0.45, 0); half.lineTo(0, -0.6); half.closePath();
    const k2 = "kiteHalf"; const geo2 = geoCache[k2] || (geoCache[k2] = new THREE.ShapeGeometry(half));
    const m2 = new THREE.Mesh(geo2, mat(c2, { side: THREE.DoubleSide })); m2.position.z = 0.01; g.add(m2);
    const tail = B(g, 0.06, 0.5, 0.02, c2, 0, -0.85, 0); tail.rotation.z = 0.2;
    B(g, 0.2, 0.08, 0.02, c1, 0.05, -0.75, 0);
    g.scale.setScalar(s || 1); return g;
  }

  function trainGeo(L) {
    const k = "train" + L; if (geoCache[k]) return geoCache[k];
    const g = new THREE.BoxGeometry(2.05, 2.75, L);
    const uv = g.attributes.uv; const rep = L / 11;
    for (let i = 0; i < 8; i++) uv.setX(i, uv.getX(i) * rep); // +x / -x faces repeat along length
    uv.needsUpdate = true; return (geoCache[k] = g);
  }
  function makeTrain(L, kind, loco) {
    const g = new THREE.Group();
    const side = texMat(coachTex(kind)), roofM = mat("#9aa3ad"), front = texMat(loco ? locoTex : coachEndTex);
    const body = new THREE.Mesh(trainGeo(L), [side, side, roofM, roofM, front, roofM]);
    body.position.y = 0.38 + 1.375; g.add(body);
    B(g, 1.9, 0.18, L - 0.2, "#b9c0c8", 0, TRAIN_H - 0.05, 0);   // roof
    B(g, 1.5, 0.12, L - 0.6, "#d0d5db", 0, TRAIN_H + 0.05, 0);
    B(g, 1.7, 0.38, L - 1, "#222", 0, 0.2, 0);                   // undercarriage
    for (let z = -L / 2 + 2; z < L / 2 - 1; z += 5.5) { cyl(g, 0.32, 0.32, 1.9, 10, "#333", 0, 0.32, z).rotation.z = Math.PI / 2; }
    if (loco) {
      const hl = new THREE.Mesh(boxGeo(0.3, 0.2, 0.05), new THREE.MeshBasicMaterial({ color: 0xfff6b0 })); hl.position.set(0, 3.0, L / 2 + 0.03); g.add(hl);
      const pg = B(g, 0.08, 0.7, 0.08, "#333", 0, TRAIN_H + 0.4, L / 2 - 2); pg.rotation.x = 0.5; // pantograph
      B(g, 0.9, 0.06, 0.1, "#333", 0, TRAIN_H + 0.72, L / 2 - 2.2);
    }
    return mergeStatic(g);
  }
  function makeRamp() {
    const g = new THREE.Group();
    const len = Math.hypot(RAMP_LEN, TRAIN_H), ang = Math.atan2(TRAIN_H, RAMP_LEN);
    const tex = rampTex; tex.repeat.set(1, 3);
    const top = new THREE.Mesh(boxGeo(2.0, 0.2, len), texMat(tex)); top.rotation.x = ang; top.position.set(0, TRAIN_H / 2 - 0.1, 0); g.add(top);
    // side supports
    [-0.95, 0.95].forEach(x => { const s = B(g, 0.1, 0.1, len, "#444", x, TRAIN_H / 2 - 0.25, 0); s.rotation.x = ang; });
    for (let i = 1; i <= 3; i++) { const z = RAMP_LEN / 2 - i * RAMP_LEN / 4, hh = TRAIN_H * i / 4; B(g, 1.8, hh, 0.12, "#555", 0, hh / 2, z); }
    return mergeStatic(g);
  }
  function makeBarrier() {
    const g = new THREE.Group();
    [-0.9, 0.9].forEach(x => { B(g, 0.14, 1.05, 0.14, "#555", x, 0.52, 0); B(g, 0.4, 0.08, 0.4, "#333", x, 0.04, 0); });
    const sm = texMat(stripeTex);
    B(g, 1.95, 0.26, 0.12, null, 0, 0.88, 0, sm); B(g, 1.95, 0.2, 0.12, null, 0, 0.42, 0, sm);
    const sign = B(g, 0.6, 0.3, 0.04, null, 0, 0.88, -0.09, texMat(textTex("rukho", "रुको", { w: 128, h: 64, bg: "#ffffff", fg: "#d62828", font: "800 44px " + FONT })));
    sign.rotation.y = Math.PI; sign.position.z = 0.09;
    return mergeStatic(g);
  }
  function makeSignalBar() {
    const g = new THREE.Group();
    [-1.08, 1.08].forEach(x => { B(g, 0.16, 3.3, 0.16, "#3c3c3c", x, 1.65, 0); });
    B(g, 2.3, 0.42, 0.22, null, 0, 1.5, 0, texMat(hazardTex));
    B(g, 2.3, 0.18, 0.18, "#3c3c3c", 0, 3.2, 0);
    const box = B(g, 0.5, 0.8, 0.3, "#111", 0.55, 2.5, 0);
    const red = new THREE.Mesh(boxGeo(0.22, 0.22, 0.04), new THREE.MeshBasicMaterial({ color: 0xff2a2a })); red.position.set(0.55, 2.7, 0.17); g.add(red);
    const grn = new THREE.Mesh(boxGeo(0.22, 0.22, 0.04), mat("#1b4d1b")); grn.position.set(0.55, 2.35, 0.17); g.add(grn);
    void box; return g;
  }
  function wheel(g, r, x, y, z) { const w = cyl(g, r, r, 0.16, 12, "#1b1b1b", x, y, z); w.rotation.z = Math.PI / 2; cyl(g, r * 0.45, r * 0.45, 0.17, 8, "#bbbbbb", x, y, z).rotation.z = Math.PI / 2; }
  function makeAuto() {
    const g = new THREE.Group();
    B(g, 1.3, 0.75, 2.0, "#1e8c3a", 0, 0.68, 0.1);          // green body
    B(g, 1.32, 0.12, 2.02, "#f2c230", 0, 1.0, 0.1);         // yellow belt
    B(g, 0.6, 0.85, 0.5, "#1e8c3a", 0, 0.75, -1.05);        // nose
    B(g, 1.0, 0.5, 0.06, "#a7d8f0", 0, 1.3, -0.72);         // windscreen
    B(g, 1.36, 0.1, 2.1, "#f9d71c", 0, 1.72, 0.12);         // yellow canopy
    B(g, 1.3, 0.6, 1.5, "#f9d71c", 0, 1.42, 0.35);
    B(g, 1.0, 0.4, 0.05, "#222", 0, 1.3, -0.4);
    B(g, 0.06, 0.6, 0.06, "#222", -0.6, 1.3, -0.7); B(g, 0.06, 0.6, 0.06, "#222", 0.6, 1.3, -0.7);
    const hl = new THREE.Mesh(boxGeo(0.2, 0.16, 0.05), new THREE.MeshBasicMaterial({ color: 0xfff8c0 })); hl.position.set(0, 0.95, -1.32); g.add(hl);
    wheel(g, 0.28, 0, 0.28, -1.05); wheel(g, 0.28, -0.6, 0.28, 0.7); wheel(g, 0.28, 0.6, 0.28, 0.7);
    B(g, 0.5, 0.16, 0.04, null, 0, 0.5, 1.12, texMat(textTex("plate", "MH 02 DD", { w: 128, h: 40, bg: "#fff", fg: "#111", font: "800 26px sans-serif" })));
    return mergeStatic(g);
  }
  function makeChaiCart(withCanopy) {
    const g = new THREE.Group();
    B(g, 1.7, 0.75, 1.1, "#8d5524", 0, 0.75, 0);
    B(g, 1.75, 0.08, 1.15, "#5d3a1a", 0, 1.15, 0);
    wheel(g, 0.36, -0.9, 0.36, 0); wheel(g, 0.36, 0.9, 0.36, 0);
    cyl(g, 0.18, 0.22, 0.32, 10, "#c0c0c0", -0.4, 1.35, 0);          // kettle
    cyl(g, 0.05, 0.05, 0.22, 6, "#c0c0c0", -0.18, 1.38, 0).rotation.z = 1.1;
    for (let i = 0; i < 4; i++) cyl(g, 0.06, 0.05, 0.14, 6, "#fff3d6", 0.2 + i * 0.16, 1.26, -0.2); // cutting-chai glasses
    const sg = B(g, 1.2, 0.42, 0.04, null, 0, 0.78, 0.57, texMat(textTex("chai", "CHAI ₹10", { w: 256, h: 90, bg: "#ffeb3b", fg: "#b71c1c", border: "#b71c1c", font: "800 50px " + FONT })));
    const sg2 = sg.clone(); sg2.position.z = -0.57; sg2.rotation.y = Math.PI; g.add(sg2);
    if (withCanopy) {
      [-0.8, 0.8].forEach(x => B(g, 0.06, 1.2, 0.06, "#555", x, 1.75, 0.45));
      B(g, 1.9, 0.08, 1.3, null, 0, 2.38, 0.1, texMat(stripeTex));
    }
    return mergeStatic(g);
  }
  function makeCow() {
    const g = new THREE.Group(); const w = "#f5f1e8";
    B(g, 1.7, 0.75, 0.75, w, 0, 1.05, 0);                       // body (across the lane)
    B(g, 0.5, 0.4, 0.5, "#6d4c41", -0.3, 1.25, 0.2); B(g, 0.4, 0.3, 0.3, "#6d4c41", 0.45, 1.1, -0.25); // patches
    B(g, 0.35, 0.25, 0.4, w, 0.55, 1.5, 0);                     // hump
    [[-0.65, 0.25], [-0.65, -0.25], [0.65, 0.25], [0.65, -0.25]].forEach(([x, z]) => { B(g, 0.16, 0.7, 0.16, w, x, 0.35, z); B(g, 0.17, 0.1, 0.17, "#333", x, 0.03, z); });
    const head = new THREE.Group(); head.position.set(1.05, 1.35, 0); g.add(head);
    B(head, 0.45, 0.45, 0.42, w, 0, 0, 0); B(head, 0.3, 0.22, 0.36, "#e8b4a0", 0.25, -0.12, 0);
    B(head, 0.06, 0.25, 0.06, "#d7c49e", 0, 0.32, 0.15).rotation.z = -0.3; B(head, 0.06, 0.25, 0.06, "#d7c49e", 0, 0.32, -0.15).rotation.z = -0.3;
    B(head, 0.08, 0.06, 0.04, "#111", 0.15, 0.08, 0.22); B(head, 0.08, 0.06, 0.04, "#111", 0.15, 0.08, -0.22);
    B(head, 0.1, 0.25, 0.1, "#e0d0c0", -0.02, 0.05, 0.3).rotation.x = 1.2;
    for (let i = 0; i < 9; i++) { const a = i / 8 * Math.PI; sph(g, 0.07, i % 2 ? "#ffb300" : "#ff6f00", 0.78, 1.45 - Math.sin(a) * 0.35, Math.cos(a) * 0.32, 6); } // marigold garland
    const tail = B(g, 0.05, 0.6, 0.05, w, -0.88, 1.05, 0); tail.rotation.z = -0.25;
    return mergeStatic(g);
  }
  const coinFaceMat = new THREE.MeshLambertMaterial({ map: coinFaceTex });
  const coinGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.1, 18); coinGeo.rotateX(Math.PI / 2);
  function makeCoin() { return new THREE.Mesh(coinGeo, coinFaceMat); }
  function makePowerMesh(type) {
    const g = new THREE.Group();
    const halo = new THREE.Mesh(geoCache.halo || (geoCache.halo = new THREE.SphereGeometry(0.75, 16, 12)),
      new THREE.MeshBasicMaterial({ color: type === "glide" ? 0xff4fa3 : type === "magnet" ? 0x4fc3ff : 0xffd54f, transparent: true, opacity: 0.28, depthWrite: false }));
    g.add(halo);
    const inner = new THREE.Group(); g.add(inner); g.userData.inner = inner;
    if (type === "glide") { const k = makeKiteMesh("#e91e63", "#ffeb3b", 0.85); inner.add(k); }
    else if (type === "magnet") {
      const t = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.12, 8, 16, Math.PI), mat("#e53935")); t.rotation.z = Math.PI; t.position.y = 0.1; inner.add(t);
      B(inner, 0.24, 0.22, 0.24, "#e0e0e0", -0.32, 0.18, 0); B(inner, 0.24, 0.22, 0.24, "#e0e0e0", 0.32, 0.18, 0);
    } else {
      const p = new THREE.Mesh(boxGeo(0.9, 0.6, 0.1), texMat(textTex("x2", "2×", { w: 128, h: 86, bg: "#ff9933", fg: "#ffffff", font: "800 72px " + FONT, border: "#ffffff" })));
      inner.add(p);
    }
    return mergeStatic(g);
  }

  // ----- scenery
  const SHOPS = ["SHARMA SWEETS", "GUPTA MOBILES", "LAXMI TAILORS", "CHAI POINT", "KUMAR TRAVELS", "PATEL KIRANA", "SAI MEDICAL", "RAJ PHOTO STUDIO", "ANNAPURNA BHOJAN", "SINGH AUTO WORKS"];
  const SHOP_BG = ["#c62828", "#1565c0", "#2e7d32", "#6a1b9a", "#ef6c00", "#00838f"];
  function makeBuilding(sideSign, w, h, d) {
    const g = new THREE.Group();
    const color = pick(BUILD_COLORS);
    const tex = windowTex(color).clone(); tex.needsUpdate = true; tex.repeat.set(w / 4, h / 4); tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    const plain = mat(color), win = new THREE.MeshLambertMaterial({ map: tex });
    const m = new THREE.Mesh(boxGeo(d, h, w), plain); m.position.y = h / 2; g.add(m);
    const face = new THREE.Mesh(new THREE.PlaneGeometry(w, h), win); face.userData.keep = true; face.userData.ownGeo = true;
    face.rotation.y = sideSign < 0 ? Math.PI / 2 : -Math.PI / 2; face.position.set(-sideSign * (d / 2 + 0.02), h / 2, 0); g.add(face);
    // window texture repeat on the track-facing face uses w x h: rotate uvs implicitly fine (box face uses z as u)
    B(g, d + 0.3, 0.35, w + 0.3, "#efebe9", 0, h + 0.15, 0); // parapet
    if (Math.random() < 0.7) { const t = cyl(g, 0.7, 0.7, 1.2, 10, "#1b1b1b", rand(-d / 4, d / 4), h + 0.9, rand(-w / 4, w / 4)); void t; } // water tank
    if (Math.random() < 0.4) { const p = B(g, 0.05, 1.6, 0.05, "#666", 0, h + 1, w / 2 - 0.6); const f = B(g, 0.02, 0.5, 0.8, "#ff9933", 0, h + 1.5, w / 2 - 0.2); void p; void f; }
    // shop signboard
    const name = pick(SHOPS), bg = pick(SHOP_BG);
    const sign = new THREE.Mesh(boxGeo(0.12, 1.0, Math.min(w - 0.6, 5.2)), texMat(textTex("shop" + name + bg, name, { w: 512, h: 100, bg, fg: "#fff", border: "#ffd54f", font: "800 52px " + FONT })));
    sign.position.set(-sideSign * (d / 2 + 0.07), 3.0, 0); g.add(sign);
    // awning
    const aw = B(g, 1.1, 0.08, w - 0.4, null, -sideSign * (d / 2 + 0.5), 2.3, 0, texMat(stripeTex)); aw.rotation.z = sideSign * 0.25;
    mergeStatic(g); g.userData.tex = tex; g.userData.mat = win;
    return g;
  }
  function makePole(side) {
    const g = new THREE.Group();
    B(g, 0.22, 7.6, 0.22, "#8a8f96", 0, 3.8, 0);
    B(g, 3.0, 0.12, 0.12, "#8a8f96", -side * 1.5, 7.2, 0);
    B(g, 0.06, 0.5, 0.06, "#555", -side * 2.8, 6.95, 0);
    return mergeStatic(g);
  }
  function makeGarland() {
    const g = new THREE.Group();
    [-6.5, 6.5].forEach(x => { B(g, 0.18, 7.5, 0.18, "#6d4c41", x, 3.75, 0); B(g, 0.3, 0.3, 0.3, "#ffb300", x, 7.6, 0); });
    const N = 44, geo = geoCache.mari || (geoCache.mari = new THREE.IcosahedronGeometry(0.17, 0));
    const inst = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true }), N);
    const m4 = new THREE.Matrix4(), col = new THREE.Color();
    for (let i = 0; i < N; i++) {
      const t = i / (N - 1), x = -6.4 + t * 12.8, y = 7.3 - Math.sin(t * Math.PI) * 0.9;
      m4.makeTranslation(x, y, 0); inst.setMatrixAt(i, m4); inst.setColorAt(i, col.set(i % 3 === 0 ? "#ffd000" : "#ff7a00"));
    }
    g.add(inst);
    // little hanging flags
    for (let i = 1; i < 8; i++) { const x = -6.4 + i * 1.6, y = 7.3 - Math.sin(i / 8 * Math.PI) * 0.9 - 0.3; const f = B(g, 0.4, 0.45, 0.02, ["#e91e63", "#4caf50", "#ffeb3b", "#2196f3"][i % 4], x, y, 0); f.rotation.z = Math.PI / 4; }
    return mergeStatic(g);
  }
  function makeStationSign() {
    const g = new THREE.Group();
    const tex = textTex("station", "देसी नगर\nDESI NAGAR JN.", { w: 512, h: 160, bg: "#ffd600", fg: "#111", border: "#111", font: "800 56px " + FONT });
    const board = new THREE.Mesh(boxGeo(0.15, 1.9, 6), [texMat(tex), texMat(tex), mat("#111"), mat("#111"), mat("#111"), mat("#111")]);
    board.position.y = 3.2; g.add(board);
    [-2.4, 2.4].forEach(z => { B(g, 0.16, 2.4, 0.16, "#111", 0, 1.2, z); for (let y = 0.2; y < 2.3; y += 0.5) B(g, 0.17, 0.25, 0.17, "#fff", 0, y, z); });
    return mergeStatic(g);
  }
  function makeTree() {
    const g = new THREE.Group();
    cyl(g, 0.22, 0.3, 2.6, 7, "#6d4c41", 0, 1.3, 0);
    [[0, 3.2, 0, 1.5], [0.8, 2.8, 0.3, 1.0], [-0.8, 2.9, -0.2, 1.1], [0, 3.9, 0.2, 1.0]].forEach(([x, y, z, r]) => sph(g, r, "#3f8f2f", x, y, z, 7));
    return mergeStatic(g);
  }
  function makeRangoli() {
    const m = new THREE.Mesh(geoCache.rg || (geoCache.rg = new THREE.CircleGeometry(1.5, 32)), new THREE.MeshLambertMaterial({ map: rangoliTex(randi(0, 2)), transparent: true }));
    m.rotation.x = -Math.PI / 2; m.position.y = 0.03; return m;
  }

  /* ======================= WORLD STATIC PARTS ======================= */
  const SPAWN_Z = -170, DESPAWN_Z = 16;
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(90, 320), texMat(groundTex)); ground.rotation.x = -Math.PI / 2; ground.position.set(0, -0.02, -90); scene.add(ground);
  const trackMat = texMat(trackTex);
  LANE_X.forEach(x => { const t = new THREE.Mesh(new THREE.PlaneGeometry(2.1, 320), trackMat); t.rotation.x = -Math.PI / 2; t.position.set(x, 0.0, -90); scene.add(t); });
  [-1, 1].forEach(s => {
    const pv = new THREE.Mesh(new THREE.PlaneGeometry(5.5, 320), texMat(paveTex)); pv.rotation.x = -Math.PI / 2;
    if (s > 0) pv.rotation.z = Math.PI; pv.position.set(s * 6.9, 0.01, -90); scene.add(pv);
    B(scene, 0.3, 0.25, 320, "#d8a11f", s * 4.1, 0.12, -90); // kerb
  });
  // far skyline silhouettes (static, sit inside the fog)
  for (let i = 0; i < 16; i++) { const hgt = rand(10, 30); B(scene, rand(6, 14), hgt, 4, pick(["#e0b98f", "#d9a6a6", "#c9b6d9", "#e6c27a"]), rand(-80, 80), hgt / 2, -175 - rand(0, 15)); }
  // dome + minaret-style landmark far away
  const lm = new THREE.Group(); scene.add(lm); lm.position.set(28, 0, -178);
  B(lm, 16, 12, 8, "#f0d9b5", 0, 6, 0); sph(lm, 5, "#f5e6c8", 0, 13, 0, 12); cyl(lm, 0.8, 1, 22, 8, "#f0d9b5", -9, 11, 0); cyl(lm, 0.8, 1, 22, 8, "#f0d9b5", 9, 11, 0);

  // blob shadow
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.55, 20), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.28, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2; scene.add(shadow);

  const hero = makeHero(); scene.add(hero.root);
  const tt = makeTT(); scene.add(tt.root); tt.root.visible = false;
  const cop = makeCop(); scene.add(cop.root); cop.root.visible = false;

  // kites in the sky (parallax)
  const skyKites = [];
  for (let i = 0; i < 12; i++) {
    const k = makeKiteMesh(pick(["#e91e63", "#ff9800", "#4caf50", "#2196f3", "#9c27b0", "#f44336"]), pick(["#ffeb3b", "#ffffff", "#00e5ff"]), rand(1.2, 2.2));
    k.position.set(rand(-40, 40), rand(13, 28), rand(-160, -20)); k.userData.ph = rand(0, 6); scene.add(k); skyKites.push(k);
  }

  /* ======================= GAME STATE ======================= */
  let state = "title";
  let objects = [];   // obstacles: {type, mesh, x, z, hx, hz, y0, y1, vz, lane}
  let coins = [];     // {mesh, x, y, z}
  let powers = [];    // {mesh, type, x, y, z}
  let scenery = [];   // {mesh, z, f(parallax factor)}
  let speed, elapsed, dist, score, coinCount, cursor, sceneCursorL, sceneCursorR, nextPole, nextGarland, nextStation, nextPowerAt, laneClear;
  const P = { lane: 1, prevLane: 1, x: 0, y: 0, vy: 0, grounded: true, roll: 0, ground: 0, anim: 0, invuln: 0, dead: 0 };
  const PW = { glide: 0, magnet: 0, x2: 0 };
  const PW_DUR = { glide: 7, magnet: 10, x2: 12 };
  let chase = 0, ttZ = 12, ttX = 0, shake = 0, camGround = 0, dyingT = 0, best = +localStorage.getItem("dd_best") || 0;
  const START_SPEED = 15, MAX_SPEED = 38, G = 40, JUMP_V = 14.2;

  function clearWorld() {
    objects.forEach(o => { scene.remove(o.mesh); disposeModel(o.mesh); }); coins.forEach(c => scene.remove(c.mesh)); powers.forEach(p => scene.remove(p.mesh));
    objects = []; coins = []; powers = [];
  }
  function resetRun() {
    clearWorld();
    speed = START_SPEED; elapsed = 0; dist = 0; score = 0; coinCount = 0; cursor = -30;
    nextPowerAt = 190; laneClear = [0, 0, 0];
    Object.assign(P, { lane: 1, prevLane: 1, x: 0, y: 0, vy: 0, grounded: true, roll: 0, ground: 0, anim: 0, invuln: 0, dead: 0 });
    PW.glide = PW.magnet = PW.x2 = 0; chase = 0; ttZ = 12; shake = 0; dyingT = 0;
    hero.root.rotation.set(0, 0, 0); hero.body.rotation.set(0, 0, 0); hero.body.position.set(0, 0, 0);
    tt.root.visible = false; tt.root.rotation.y = 0; cop.root.visible = false; cop.root.rotation.y = 0; hero.kite.visible = hero.str.visible = false;
  }
  function initScenery() {
    scenery.forEach(s => { scene.remove(s.mesh); disposeModel(s.mesh); }); scenery = [];
    sceneCursorL = 12; sceneCursorR = 12; nextPole = 0; nextGarland = -40; nextStation = -70;
    updateSceneryCursors(0, true);
  }

  /* ======================= SPAWNING ======================= */
  function addObj(type, lane, zNear, len, extra) {
    let mesh, hz = len / 2, y0 = 0, y1 = 1, hx = 0.95;
    switch (type) {
      case "train": mesh = makeTrain(len, extra && extra.kind || pick(["blue", "blue", "maroon"]), extra && extra.loco); y1 = TRAIN_H; hx = 1.0; break;
      case "ramp": mesh = makeRamp(); y1 = TRAIN_H; break;
      case "barrier": mesh = makeBarrier(); y1 = 1.05; hz = 0.15; break;
      case "bar": mesh = makeSignalBar(); y0 = 1.15; y1 = 3.4; hz = 0.2; break;
      case "auto": mesh = makeAuto(); y1 = 1.72; hx = 0.7; hz = 1.15; break;
      case "stall": mesh = makeChaiCart(false); y1 = 1.45; hx = 0.9; hz = 0.6; break;
      case "cow": mesh = makeCow(); y1 = 1.6; hz = 0.42; break;
      case "jeep": mesh = makeJeep(); mesh.scale.set(0.95, 0.92, 0.85); y1 = 1.7; hx = 0.78; hz = 1.15; break;
    }
    const z = zNear - hz;
    const o = { type, mesh, lane, x: LANE_X[lane], z, hx, hz, y0, y1, vz: (extra && extra.vz) || 0, honked: false };
    mesh.position.set(o.x, 0, z); scene.add(mesh); objects.push(o);
    laneClear[lane] = Math.min(laneClear[lane], z - hz);
    return o;
  }
  function addCoin(lane, z, y) { const m = makeCoin(); const c = { mesh: m, x: LANE_X[lane], y, z }; m.position.set(c.x, y, z); scene.add(m); coins.push(c); }
  function coinLine(lane, zNear, n, y, gap) { for (let i = 0; i < n; i++) addCoin(lane, zNear - i * (gap || 2.4), y === undefined ? 1.0 : y); }
  function coinArc(lane, zc) { // arc over a jumpable obstacle
    const n = 7, span = speed * 0.62;
    for (let i = 0; i < n; i++) { const t = i / (n - 1); addCoin(lane, zc + span / 2 - t * span, 1.0 + Math.sin(t * Math.PI) * 2.0); }
  }
  function addPower(lane, z, type) {
    type = type || pick(["glide", "magnet", "x2"]);
    const m = makePowerMesh(type); const p = { mesh: m, type, x: LANE_X[lane], y: 1.3, z }; m.position.set(p.x, p.y, z); scene.add(m); powers.push(p);
  }
  const ROW_TYPES = ["barrier", "bar", "auto", "cow", "stall", "barrier", "jeep", "cow", "jeep"];
  function genChunk(z0) {
    const diff = clamp(elapsed / 100, 0, 1);
    const gapScale = speed / START_SPEED;
    const r = Math.random();
    if (dist < 30 && z0 > -80) return breather(z0);
    if (r < 0.42) return rowChunk(z0, diff, gapScale);
    if (r < 0.78) return trainChunk(z0, diff);
    if (r < 0.92) { const len = movingChunk(z0, diff); if (len) return len; }
    return breather(z0);
  }
  function maybePower(lane, z) {
    if (dist + (-z) > nextPowerAt) { addPower(lane, z); nextPowerAt += rand(320, 520); return true; }
    return false;
  }
  function breather(z0) {
    const lanes = [0, 1, 2]; let lane = randi(0, 2);
    for (let i = 0; i < 8; i++) { addCoin(lane, z0 - 3 - i * 2.4, 1.0); if (i % 3 === 2) lane = clamp(lane + pick([-1, 1]), 0, 2); }
    void lanes; return 24;
  }
  function rowChunk(z0, diff, gapScale) {
    const len = 16 + 8 * gapScale, zr = z0 - len / 2;
    const nObs = Math.random() < 0.25 + diff * 0.45 ? (Math.random() < diff * 0.5 ? 3 : 2) : 1;
    const lanes = [0, 1, 2].sort(() => Math.random() - 0.5);
    const used = lanes.slice(0, nObs);
    used.forEach(l => {
      const t = Math.random() < 0.2 + diff * 0.15 ? "bar" : pick(ROW_TYPES);
      const o = addObj(t, l, zr + 1, 1);
      if (t !== "bar" && Math.random() < 0.5) coinArc(l, o.z);
    });
    const free = lanes.slice(nObs);
    free.forEach((l, i) => { if (i === 0 && !maybePower(l, zr)) coinLine(l, zr + 6, 5); });
    if (!free.length) maybePower(used[0], zr - 8);
    return len;
  }
  function trainChunk(z0, diff) {
    const L = pick(diff > 0.4 ? [22, 33, 44] : [22, 33]);
    const nT = Math.random() < 0.35 + diff * 0.4 ? 2 : 1;
    const lanes = [0, 1, 2].sort(() => Math.random() - 0.5);
    const tl = lanes.slice(0, nT), free = lanes[nT];
    tl.forEach((l, i) => {
      const off = rand(0, 4);
      if (i === 0 && Math.random() < 0.65) {
        addObj("ramp", l, z0 - off, RAMP_LEN);
        addObj("train", l, z0 - off - RAMP_LEN, L);
        coinLine(l, z0 - off - RAMP_LEN - 2, Math.floor(L / 2.4) - 1, TRAIN_H + 1.0);
      } else addObj("train", l, z0 - off - rand(0, 6), L);
    });
    if (nT === 1) {
      const other = lanes[2];
      if (Math.random() < 0.5) { const o = addObj(Math.random() < 0.5 ? "barrier" : "bar", other, z0 - L / 2, 1); void o; }
      else coinLine(other, z0 - 4, 6);
    }
    if (Math.random() < 0.6 + diff * 0.3) addObj(pick(["barrier", "bar", "cow"]), free, z0 - L * 0.5, 1);
    else coinLine(free, z0 - 4, 7);
    return L + 14;
  }
  function movingChunk(z0, diff) {
    const vz = 9 + diff * 7, L = pick([22, 33]);
    const need = vz * (-z0) / (speed + vz) + 12;
    const cands = [0, 1, 2].filter(l => laneClear[l] - z0 > need);
    if (!cands.length) return 0;
    const l = pick(cands);
    addObj("train", l, z0 - 4, L, { vz, loco: true, kind: pick(["blue", "maroon"]) });
    [0, 1, 2].filter(x => x !== l).forEach(x => { if (Math.random() < 0.5) coinLine(x, z0 - 6, 6); });
    [0, 1, 2].forEach(x => { laneClear[x] = Math.min(laneClear[x], z0 - 4 - L); });
    return L + 12;
  }

  function addScenery(mesh, z, f) { mesh.position.z = z; scene.add(mesh); scenery.push({ mesh, z, f: f || 1 }); }
  function updateSceneryCursors(dz, init) {
    sceneCursorL += dz; sceneCursorR += dz; nextPole += dz; nextGarland += dz; nextStation += dz;
    [-1, 1].forEach(side => {
      while ((side < 0 ? sceneCursorL : sceneCursorR) > SPAWN_Z) {
        const c = side < 0 ? sceneCursorL : sceneCursorR;
        const r = Math.random(); let used;
        if (r < 0.8) {
          const w = rand(5, 8), h = rand(5, 15), d = rand(5, 8);
          const b = makeBuilding(side, w, h, d); b.position.x = side * (10.2 + d / 2); addScenery(b, c - w / 2); used = w + rand(0.2, 1.2);
        } else if (r < 0.9) { const t = makeTree(); t.position.x = side * rand(10.5, 12); addScenery(t, c - 2); used = 4; }
        else { const ch = makeChaiCart(true); ch.position.x = side * 8.3; ch.rotation.y = side * Math.PI / 2; addScenery(ch, c - 2); used = 3.5; }
        if (Math.random() < 0.35) { const rg = makeRangoli(); rg.position.x = side * rand(6.4, 8.2); addScenery(rg, c - rand(0, used)); }
        if (side < 0) sceneCursorL -= used; else sceneCursorR -= used;
      }
    });
    while (nextPole > SPAWN_Z) { [-1, 1].forEach(s => { const p = makePole(s); p.position.x = s * 4.6; addScenery(p, nextPole); }); nextPole -= 30; }
    while (nextGarland > SPAWN_Z) { addScenery(makeGarland(), nextGarland); nextGarland -= rand(60, 110); }
    while (nextStation > SPAWN_Z) { const st = makeStationSign(); st.position.x = 5.6; addScenery(st, nextStation); nextStation -= rand(300, 420); }
    void init;
  }

  /* ======================= INPUT ======================= */
  function act(a) {
    AU.init();
    if (state !== "play") return;
    if (a === "left" || a === "right") {
      const nl = clamp(P.lane + (a === "left" ? -1 : 1), 0, 2);
      if (nl !== P.lane) { P.prevLane = P.lane; P.lane = nl; }
    } else if (a === "up") {
      if (PW.glide > 0) return;
      if (P.grounded || P.y - P.ground < 0.15) { P.vy = JUMP_V; P.grounded = false; P.roll = 0; AU.jump(); }
    } else if (a === "down") {
      if (PW.glide > 0) return;
      if (!P.grounded) P.vy = -28;
      if (P.roll <= 0) AU.roll();
      P.roll = 0.62;
    }
  }
  const KEYS = { ArrowLeft: "left", KeyA: "left", ArrowRight: "right", KeyD: "right", ArrowUp: "up", KeyW: "up", Space: "up", ArrowDown: "down", KeyS: "down" };
  window.addEventListener("keydown", e => {
    AU.init();
    if (e.code === "KeyM") { toggleMute(); return; }
    if (e.code === "KeyP" || e.code === "Escape") { if (state === "play") pause(); else if (state === "paused") resume(); return; }
    if ((e.code === "Enter" || e.code === "Space") && (state === "title" || state === "over")) { e.preventDefault(); startRun(); return; }
    if (e.code === "Enter" && state === "paused") { resume(); return; }
    const a = KEYS[e.code]; if (a) { e.preventDefault(); if (!e.repeat) act(a); }
  });
  // swipe (touch) + mouse-drag swipe; taps start/restart from the title and game-over screens
  const root = $("game-root");
  let sw = null;
  const swipeTh = () => Math.max(22, Math.min(48, Math.min(window.innerWidth, window.innerHeight) * 0.06));
  function swStart(x, y, target) { AU.init(); sw = { x, y, t: performance.now(), done: false, onBtn: !!(target && target.closest && target.closest("button, a")) }; }
  function swMove(x, y) {
    if (!sw || sw.done) return;
    const dx = x - sw.x, dy = y - sw.y, th = swipeTh();
    if (Math.abs(dx) > th || Math.abs(dy) > th) { sw.done = true; act(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : (dy > 0 ? "down" : "up")); }
  }
  function swEnd() {
    if (sw && !sw.done && !sw.onBtn && performance.now() - sw.t < 400 && (state === "title" || state === "over")) startRun();
    sw = null;
  }
  root.addEventListener("touchstart", e => {
    const t = e.changedTouches[0]; swStart(t.clientX, t.clientY, e.target);
    if (!sw.onBtn) e.preventDefault(); // stop double-tap zoom / long-press menus / ghost clicks
  }, { passive: false });
  root.addEventListener("touchmove", e => { e.preventDefault(); const t = e.changedTouches[0]; swMove(t.clientX, t.clientY); }, { passive: false });
  root.addEventListener("touchend", e => { if (sw && !sw.onBtn) e.preventDefault(); swEnd(); }, { passive: false });
  root.addEventListener("touchcancel", () => { sw = null; });
  root.addEventListener("pointerdown", e => { if (e.pointerType === "touch") return; swStart(e.clientX, e.clientY, e.target); });
  root.addEventListener("pointermove", e => { if (e.pointerType === "touch") return; swMove(e.clientX, e.clientY); });
  root.addEventListener("pointerup", e => { if (e.pointerType === "touch") return; sw = null; });
  document.addEventListener("contextmenu", e => e.preventDefault());
  document.addEventListener("gesturestart", e => e.preventDefault()); // iOS pinch-zoom
  document.addEventListener("dblclick", e => e.preventDefault());
  document.addEventListener("visibilitychange", () => { if (document.hidden && state === "play") pause(); });

  /* ======================= UI ======================= */
  function toggleMute() { AU.init(); const m = AU.toggleMute(); $("btn-mute").textContent = m ? "🔇" : "🔊"; }
  $("btn-mute").textContent = AU.isMuted() ? "🔇" : "🔊";
  $("btn-mute").addEventListener("click", e => { toggleMute(); e.currentTarget.blur(); });
  $("btn-pause").addEventListener("click", e => { AU.init(); if (state === "play") pause(); else if (state === "paused") resume(); e.currentTarget.blur(); });
  $("btn-play").addEventListener("click", startRun);
  $("btn-again").addEventListener("click", startRun);
  $("btn-resume").addEventListener("click", resume);
  ["btn-quit", "btn-menu"].forEach(id => $(id).addEventListener("click", toMenu));
  $("title-best").textContent = best;
  let toastT = 0, clock = 0;
  function toast(msg) { const t = $("toast"); t.textContent = msg; t.classList.remove("hidden"); t.style.animation = "none"; void t.offsetWidth; t.style.animation = ""; toastT = clock + 1.3; }

  function startRun() {
    AU.init(); AU.click();
    resetRun();
    state = "play";
    ["title-screen", "over-screen", "pause-screen"].forEach(id => $(id).classList.add("hidden"));
    $("hud").classList.remove("hidden");
    AU.startMusic();
    toast("RUN, MUNNA, RUN!");
  }
  function pause() { state = "paused"; $("pause-screen").classList.remove("hidden"); $("btn-pause").textContent = "▶"; AU.stopMusic(); }
  function resume() { state = "play"; $("pause-screen").classList.add("hidden"); $("btn-pause").textContent = "❚❚"; AU.startMusic(); last = performance.now(); }
  function toMenu() {
    state = "title"; resetRun(); AU.stopMusic();
    ["over-screen", "pause-screen", "hud", "chase-warn"].forEach(id => $(id).classList.add("hidden"));
    $("btn-pause").textContent = "❚❚";
    $("title-best").textContent = best; $("title-screen").classList.remove("hidden");
  }
  function gameOver(caught) {
    state = "over";
    const s = Math.floor(score), nb = s > best;
    if (nb) { best = s; localStorage.setItem("dd_best", String(best)); }
    $("over-title").textContent = caught ? "CAUGHT!" : "OUCH!";
    $("over-sub").textContent = caught ? "TT Uncle: \"Ticket dikhao!\"  Havaldar: \"Ruko!\"" : "The TT Uncle and the Havaldar caught up while you were seeing stars.";
    $("over-score").textContent = s; $("over-coins").textContent = coinCount; $("over-best").textContent = best;
    $("new-best").classList.toggle("hidden", !nb);
    $("over-screen").classList.remove("hidden"); $("chase-warn").classList.add("hidden");
  }

  let hudCache = "";
  function updateHUD() {
    const mult = PW.x2 > 0 ? 2 : 1;
    const pu = ["glide", "magnet", "x2"].filter(k => PW[k] > 0).map(k => `<div class="pu">${{ glide: "🪁", magnet: "🧲", x2: "✖2" }[k]}<div class="bar"><i style="width:${Math.round(PW[k] / PW_DUR[k] * 100)}%"></i></div></div>`).join("");
    const key = Math.floor(score) + "|" + coinCount + "|" + mult + "|" + pu;
    if (key === hudCache) return; hudCache = key;
    $("hud-score").textContent = Math.floor(score).toLocaleString("en-IN");
    $("hud-coins").textContent = coinCount;
    const m = $("hud-mult"); m.textContent = "x" + mult; m.classList.toggle("hot", mult > 1);
    $("powerups").innerHTML = pu;
  }

  /* ======================= UPDATE ======================= */
  function groundAt(x, y) {
    let g = 0;
    for (const o of objects) {
      if (o.type !== "train" && o.type !== "ramp") continue;
      if (Math.abs(o.x - x) > 1.1 || Math.abs(o.z) > o.hz + 0.3) continue;
      if (o.type === "train") { if (y >= o.y1 - 0.7) g = Math.max(g, o.y1); }
      else { const t = clamp((o.z + o.hz) / (2 * o.hz), 0, 1), s = t * TRAIN_H; if (y >= s - 0.9) g = Math.max(g, s); }
    }
    return g;
  }
  function stumble() {
    AU.stumble(); shake = 0.35;
    if (chase > 0) { crash(true); return; }
    chase = 5; ttZ = 9; AU.whistle(); setTimeout(() => AU.policeWhistle(), 350); P.invuln = 0.6;
    $("chase-warn").classList.remove("hidden");
  }
  function crash(caught) {
    if (state !== "play") return;
    state = "dying"; dyingT = 0; P.dead = 1; AU.crash(); AU.stopMusic(); shake = 0.5;
    setTimeout(() => AU.policeWhistle(), 300); setTimeout(() => AU.whistle(), 800);
    tt.root.visible = true; cop.root.visible = true; ttX = P.x; if (ttZ > 6) ttZ = 6;
    $("chase-warn").classList.add("hidden");
    P.caught = caught;
  }
  function activatePower(type) {
    PW[type] = PW_DUR[type]; AU.powerup();
    toast({ glide: "KITE GLIDE!", magnet: "COIN MAGNET!", x2: "2× MULTIPLIER!" }[type]);
    if (type === "glide") {
      // a sky trail of coins
      let lane = P.lane;
      for (let i = 0; i < 26; i++) { addCoin(lane, -14 - i * 3.2, 6.2); if (i % 6 === 5) lane = clamp(lane + pick([-1, 1]), 0, 2); }
    }
  }

  function update(dt) {
    clock += dt; const t = clock;
    if (toastT && clock > toastT) { toastT = 0; $("toast").classList.add("hidden"); }
    if (state === "title") { titleUpdate(dt, t); return; }
    if (state === "paused" || state === "over") { if (state === "over") idleTT(dt, t); return; }
    if (state === "dying") { dyingUpdate(dt, t); return; }

    elapsed += dt;
    speed = Math.min(MAX_SPEED, START_SPEED + elapsed * 0.2);
    const dz = speed * dt;
    dist += dz;
    const mult = PW.x2 > 0 ? 2 : 1;
    score += dz * 0.5 * mult;

    // world motion
    cursor += dz; for (let l = 0; l < 3; l++) laneClear[l] += dz;
    while (cursor > SPAWN_Z) cursor -= genChunk(cursor);
    moveWorld(dz, dt);
    updateSceneryCursors(dz);
    scrollTextures(dz);

    for (const k in PW) if (PW[k] > 0) { PW[k] -= dt; if (PW[k] <= 0) { PW[k] = 0; if (k === "glide") { P.invuln = 1.2; P.vy = 0; } AU.powerdown(); } }
    if (P.invuln > 0) P.invuln -= dt;
    if (AUTOPILOT) autopilot();

    // player horizontal
    const tx = LANE_X[P.lane]; P.x += (tx - P.x) * Math.min(1, dt * 15);
    // vertical
    P.ground = groundAt(P.x, P.y);
    if (PW.glide > 0) { P.y += (6.2 - P.y) * Math.min(1, dt * 3); P.vy = 0; P.grounded = false; }
    else {
      const holdG = P.vy > 0 ? G : G * 1.25;
      P.vy -= holdG * dt; P.y += P.vy * dt;
      if (P.invuln > 0 && P.vy < -6 && P.y > P.ground + 1) P.vy = Math.max(P.vy, -6); // floaty landing after glide
      if (P.y <= P.ground) { if (!P.grounded && P.vy < -8) AU.land(); P.y = P.ground; P.vy = 0; P.grounded = true; }
      else P.grounded = P.y - P.ground < 0.02;
    }
    if (P.roll > 0) P.roll -= dt;

    collide();
    if (state !== "play") return;
    collectStuff(dt);

    if (chase > 0) { chase -= dt; ttZ += (3.8 - ttZ) * Math.min(1, dt * 3); if (chase <= 0) $("chase-warn").classList.add("hidden"); }
    else ttZ = Math.min(14, ttZ + dt * 6);
    tt.root.visible = cop.root.visible = ttZ < 13;
    ttX += (P.x - ttX) * Math.min(1, dt * 5);
    animateChars(dt, t);
    updateHUD();
  }
  function moveWorld(dz, dt) {
    for (let i = objects.length - 1; i >= 0; i--) {
      const o = objects[i]; o.z += dz + o.vz * dt; o.mesh.position.z = o.z;
      if (o.vz && !o.honked && o.z + o.hz > -70) { o.honked = true; AU.horn(); }
      if (o.mesh.userData.lights) { const on = Math.floor(clock * 6) % 2; o.mesh.userData.lights[0].visible = !!on; o.mesh.userData.lights[1].visible = !on; }
      if (o.z - o.hz > DESPAWN_Z) { scene.remove(o.mesh); disposeModel(o.mesh); objects.splice(i, 1); }
    }
    for (let i = coins.length - 1; i >= 0; i--) {
      const c = coins[i]; c.z += dz; c.mesh.position.z = c.z; c.mesh.rotation.y += dt * 4;
      if (c.z > DESPAWN_Z) { scene.remove(c.mesh); coins.splice(i, 1); }
    }
    for (let i = powers.length - 1; i >= 0; i--) {
      const p = powers[i]; p.z += dz; p.mesh.position.z = p.z; p.mesh.userData.inner.rotation.y += dt * 2.5; p.mesh.position.y = p.y + Math.sin(clock * 3.3) * 0.15;
      if (p.z > DESPAWN_Z) { scene.remove(p.mesh); powers.splice(i, 1); }
    }
    moveScenery(dz, dt);
  }
  function moveScenery(dz, dt) {
    for (let i = scenery.length - 1; i >= 0; i--) {
      const s = scenery[i]; s.z += dz * s.f; s.mesh.position.z = s.z;
      if (s.z > DESPAWN_Z + 34) { scene.remove(s.mesh); disposeModel(s.mesh); scenery.splice(i, 1); }
    }
    const t = clock;
    skyKites.forEach(k => {
      k.position.z += dz * 0.25; k.position.x += Math.sin(t * 0.5 + k.userData.ph) * dt * 0.8;
      k.rotation.z = Math.sin(t * 1.3 + k.userData.ph) * 0.3;
      if (k.position.z > 10) { k.position.z = -160; k.position.x = rand(-40, 40); }
    });
    void dt;
  }
  function scrollTextures(dz) { trackTex.offset.y += dz / 6; groundTex.offset.y += dz / 6; paveTex.offset.y += dz / 8; }

  function collide() {
    const ph = P.roll > 0 ? 0.8 : 1.75, py = P.y;
    for (const o of objects) {
      if (o.type === "ramp") continue;
      const dx = Math.abs(o.x - P.x), dzz = Math.abs(o.z);
      const zHit = dzz < o.hz + 0.26, xHit = dx < o.hx + 0.3;
      const prevZHit = o.prevZ !== undefined && Math.abs(o.prevZ) < o.hz + 0.26;
      o.prevZ = o.z;
      if (!zHit || !xHit) continue;
      if (py + ph <= o.y0 + 0.05 || py >= o.y1 - (o.type === "train" ? 0.75 : 0.02)) continue; // under or over it
      if (PW.glide > 0) continue;
      const midLaneChange = Math.abs(LANE_X[P.lane] - P.x) > 0.12;
      if (prevZHit && midLaneChange) {
        if (P.invuln > 0) continue;
        P.lane = P.prevLane; stumble(); return;    // brushed the side: bounce back
      }
      if (P.invuln > 0 && o.type !== "train") continue;
      crash(chase > 0); return;
    }
  }
  function collectStuff(dt) {
    const cy = P.y + 0.9;
    for (let i = coins.length - 1; i >= 0; i--) {
      const c = coins[i];
      if (PW.magnet > 0 && c.z > -22 && c.z < 2) {
        const k = Math.min(1, dt * 9); c.x += (P.x - c.x) * k; c.y += (cy - c.y) * k; c.z += (0 - c.z) * k * 0.6;
        c.mesh.position.set(c.x, c.y, c.z);
      }
      if (Math.abs(c.x - P.x) < 0.75 && Math.abs(c.z) < 0.9 && Math.abs(c.y - cy) < 1.2) {
        scene.remove(c.mesh); coins.splice(i, 1); coinCount++; score += 10 * (PW.x2 > 0 ? 2 : 1); AU.coin();
      }
    }
    for (let i = powers.length - 1; i >= 0; i--) {
      const p = powers[i];
      if (Math.abs(p.x - P.x) < 0.9 && Math.abs(p.z) < 1.0 && Math.abs(p.y - cy) < 1.5) { scene.remove(p.mesh); powers.splice(i, 1); activatePower(p.type); }
    }
  }

  function animateChars(dt, t) {
    const running = P.grounded && P.roll <= 0;
    if (running) P.anim += dt * speed * 0.62;
    const s = Math.sin(P.anim);
    hero.root.position.set(P.x, P.y, 0);
    hero.root.rotation.z = (LANE_X[P.lane] - P.x) * -0.12;
    if (P.roll > 0) {
      const k = 1 - P.roll / 0.62;
      hero.body.rotation.x = -k * Math.PI * 2; hero.body.position.y = 0.55 - Math.abs(Math.sin(k * Math.PI)) * 0.1; hero.body.scale.set(1, 0.55, 1);
      hero.body.position.y = 0.2;
      hero.legs.forEach(l => l.rotation.x = -1.2); hero.arms.forEach(a => a.rotation.x = -1.4);
    } else {
      hero.body.rotation.x = 0; hero.body.scale.set(1, 1, 1);
      if (PW.glide > 0) {
        hero.body.position.y = Math.sin(t * 3) * 0.1;
        hero.legs[0].rotation.x = 0.3; hero.legs[1].rotation.x = -0.2; hero.arms.forEach(a => a.rotation.x = -2.8);
      } else if (!P.grounded) {
        hero.body.position.y = 0; hero.legs[0].rotation.x = -0.9; hero.legs[1].rotation.x = 0.5; hero.arms[0].rotation.x = -2.2; hero.arms[1].rotation.x = -2.0;
      } else {
        hero.body.position.y = Math.abs(s) * 0.12;
        hero.legs[0].rotation.x = s * 0.95; hero.legs[1].rotation.x = -s * 0.95;
        hero.arms[0].rotation.x = -s * 0.9; hero.arms[1].rotation.x = s * 0.9;
      }
    }
    hero.kite.visible = hero.str.visible = PW.glide > 0;
    if (PW.glide > 0) hero.kite.rotation.z = Math.sin(t * 2) * 0.15;
    shadow.position.set(P.x, P.ground + 0.03, 0);
    const sh = clamp(1 - (P.y - P.ground) / 6, 0.3, 1); shadow.scale.setScalar(sh);
    // TT uncle
    tt.root.position.set(ttX, groundAt(ttX, 0) > 0 ? 0 : 0, ttZ);
    const ts = Math.sin(t * 13);
    tt.legs[0].rotation.x = ts * 0.8; tt.legs[1].rotation.x = -ts * 0.8;
    tt.arms[0].rotation.x = -ts * 0.7 - 0.3; tt.arms[1].rotation.x = -2.4 + Math.sin(t * 9) * 0.4; // waving the ticket pad
    tt.body.position.y = Math.abs(ts) * 0.08;
    // Havaldar runs alongside the TT uncle, lathi raised
    const side = P.lane === 2 ? -1 : 1;
    cop.root.position.set(ttX + side * 1.25, 0, ttZ + 0.7);
    const cs = Math.sin(t * 13 + 1.2);
    cop.legs[0].rotation.x = cs * 0.85; cop.legs[1].rotation.x = -cs * 0.85;
    cop.arms[0].rotation.x = -cs * 0.8; cop.arms[1].rotation.x = -1.9 + Math.sin(t * 7) * 0.5;
    cop.body.position.y = Math.abs(cs) * 0.08;
  }
  function idleTT(dt, t) {
    tt.arms[1].rotation.x = -2.4 + Math.sin(t * 9) * 0.5;
    tt.legs.forEach(l => l.rotation.x = 0);
    swingLathi(t);
  }
  function swingLathi(t) { // big overhead lathi swings on game over
    const ph = (t * 2.2) % 1, k = ph < 0.6 ? ph / 0.6 : 1 - (ph - 0.6) / 0.4;
    cop.arms[1].rotation.x = -2.9 + k * 2.1; cop.arms[0].rotation.x = -0.4;
    cop.legs.forEach(l => l.rotation.x = 0); cop.body.rotation.x = -0.05 + k * 0.12;
  }
  function titleUpdate(dt, t) {
    const dz = 9 * dt;
    moveScenery(dz, dt); updateSceneryCursors(dz); scrollTextures(dz);
    P.anim += dt * 6; P.x = 0; P.y = 0; P.grounded = true; P.roll = 0; P.ground = 0;
    animateChars(dt, t);
    tt.root.visible = false;
  }
  function dyingUpdate(dt, t) {
    dyingT += dt;
    const k = Math.min(1, dyingT / 0.5);
    hero.body.rotation.x = k * 1.35; // falls back
    hero.body.position.y = 0.15 * k;
    hero.root.position.set(P.x, Math.max(P.ground, P.y - dyingT * 6), 0.4 * k);
    P.y = hero.root.position.y;
    shadow.position.set(P.x, P.ground + 0.03, 0);
    ttZ += (1.3 - ttZ) * Math.min(1, dt * 3); ttX += (P.x + 0.75 - ttX) * Math.min(1, dt * 3);
    tt.root.position.set(ttX, P.ground, ttZ); tt.root.rotation.y = 0.6 * Math.min(1, dyingT); // turns toward the camera
    const ts = Math.sin(t * 13) * Math.max(0, 1 - dyingT);
    tt.legs[0].rotation.x = ts * 0.8; tt.legs[1].rotation.x = -ts * 0.8;
    tt.arms[1].rotation.x = -2.4 + Math.sin(t * 9) * 0.5;
    const cx = P.x - 0.45; // stands right behind the fallen runner (that lane is always clear)
    cop.root.position.x += (cx - cop.root.position.x) * Math.min(1, dt * 3);
    cop.root.position.z += (2.3 - cop.root.position.z) * Math.min(1, dt * 3);
    cop.root.position.y = P.ground; cop.root.rotation.y = 0.5 * Math.min(1, dyingT);
    if (dyingT < 0.7) { const cs = Math.sin(t * 13); cop.legs[0].rotation.x = cs * 0.8; cop.legs[1].rotation.x = -cs * 0.8; cop.arms[1].rotation.x = -1.9; }
    else swingLathi(t);
    if (dyingT > 1.8) gameOver(P.caught || true);
  }

  /* ======================= AUTOPILOT (demo mode) ======================= */
  function laneDanger(l) {
    // distance to the nearest thing in lane l that can't be jumped/rolled
    let d = 999;
    for (const o of objects) {
      if (o.lane !== l) continue;
      const front = -(o.z + o.hz);
      if (o.z - o.hz > 0.5) continue; // behind us
      if (o.type === "train") {
        const rampAhead = objects.some(r => r.type === "ramp" && r.lane === l && Math.abs((r.z - r.hz) - (o.z + o.hz)) < 0.5);
        const onTop = P.y >= TRAIN_H - 0.6 && P.lane === l;
        if (!rampAhead && !onTop || o.vz) d = Math.min(d, Math.max(front, 0));
      }
    }
    return d;
  }
  let apCool = 0;
  function autopilot() {
    apCool -= 1 / 60;
    const dangers = [0, 1, 2].map(laneDanger);
    const cur = P.lane, need = speed * 1.1 + 6;
    if (apCool <= 0 && Math.abs(LANE_X[cur] - P.x) < 0.1) {
      // power-ups / coins attraction
      let want = cur;
      if (dangers[cur] < need) {
        const opts = [cur - 1, cur + 1].filter(l => l >= 0 && l <= 2 && sideFree(l)).sort((a, b) => dangers[b] - dangers[a]);
        if (opts.length && dangers[opts[0]] > dangers[cur]) want = opts[0];
      } else {
        const pw = powers.find(p => p.z < -6 && p.z > -40);
        if (pw) { const pl = LANE_X.indexOf(pw.x); if (pl !== cur && dangers[cur + Math.sign(pl - cur)] > need && sideFree(cur + Math.sign(pl - cur))) want = cur + Math.sign(pl - cur); }
      }
      if (want !== cur) { act(want < cur ? "left" : "right"); apCool = 0.25; }
    }
    // jump / roll for row obstacles
    for (const o of objects) {
      if (o.lane !== P.lane || o.type === "train" || o.type === "ramp") continue;
      const front = -(o.z + o.hz);
      if (front < 0 || front > speed * 0.24 + 1.0) continue;
      if (o.type === "bar") { if (P.roll <= 0.15) act("down"); }
      else if (P.grounded && front > speed * 0.08) act("up");
    }
  }
  function sideFree(l) {
    return !objects.some(o => o.lane === l && o.type !== "ramp" && Math.abs(o.z) < o.hz + 2.5 && !(P.y >= o.y1 - 0.5));
  }

  /* ======================= CAMERA / LOOP ======================= */
  const camPos = new THREE.Vector3(0, 4, 7), camLook = new THREE.Vector3(0, 1.5, -8);
  function updateCamera(dt) {
    const gTarget = state === "play" ? Math.max(P.ground, PW.glide > 0 ? P.y * 0.6 : 0) : P.ground;
    camGround += (gTarget - camGround) * Math.min(1, dt * 4);
    let tp, tl;
    if (state === "dying" || state === "over") {
      tp = new THREE.Vector3(P.x - 2.6, P.ground + 6.2, -3.6); tl = new THREE.Vector3(P.x + 0.3, P.ground + 0.6, 1.2); // high front view (clears train roofs)
    } else {
      const pz = portrait ? 2.8 : 0, py = portrait ? 1.1 : 0;
      tp = new THREE.Vector3(P.x * (portrait ? 0.45 : 0.7), 4.1 + py + camGround * 0.85, 7.2 + pz); tl = new THREE.Vector3(P.x * (portrait ? 0.4 : 0.6), 1.3 + camGround * 0.85, -9);
    }
    const k = Math.min(1, dt * (state === "dying" ? 2.5 : 8));
    camPos.lerp(tp, k); camLook.lerp(tl, k);
    camera.position.copy(camPos);
    if (shake > 0) { shake -= dt; camera.position.x += (Math.random() - 0.5) * shake; camera.position.y += (Math.random() - 0.5) * shake; }
    camera.lookAt(camLook);
  }
  let last = performance.now();
  const CAPTURE = params.has("capture"); // fixed-timestep mode used to record videos frame by frame
  function frameStep(dt) { update(dt); updateCamera(dt); renderer.render(scene, camera); }
  function loop(now) {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (!CAPTURE) frameStep(dt);
    requestAnimationFrame(loop);
  }

  resetRun(); initScenery();
  window.__game = { set autopilot(v) { AUTOPILOT = v; }, get objects() { return objects; }, get state() { return state; }, get score() { return score; }, get coins() { return coinCount; }, get speed() { return speed; }, P, PW, act, startRun,
    power(t) { activatePower(t); }, spawn(type, lane, z, len) { return !!addObj(type, lane, z, len || (type === 'train' ? 22 : 1)); }, stumble() { stumble(); }, get mobile() { return IS_MOBILE; }, get portrait() { return portrait; }, step(n, dt) { for (let i = 0; i < n; i++) frameStep(dt || 1 / 30); }, get info() { return renderer.info.render; } };
  if (params.has("play") || (AUTOPILOT && !CAPTURE)) startRun();
  requestAnimationFrame(loop);
})();
