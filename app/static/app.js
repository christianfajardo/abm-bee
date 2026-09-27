/* Bee Colony ABM — client
 * Polls the FastAPI backend, renders the colony with PixiJS sprites
 * (real bee/wasp/flower/nest art), draws Plotly charts, and drives
 * the parameter controls. Falls back to a 2D canvas renderer if
 * WebGL/PIXI is unavailable.
 */
"use strict";

const COLORS = {
  FORAGING: 0xffcf4d,
  RETURNING: 0xffb057,
  NURSING: 0x5ad18a,
  RESCUING: 0x7aa2ff,
  DEFENDING: 0xc084fc,
  HIBERNATING: 0x94a3b8,
  RESTING: 0xd9b46a,
};
const INJURED_TINT = 0xff5a5a;

const canvas = document.getElementById("sim");
let cell = 20;            // px per grid cell
let running = true;
let speed = 2;
let rulesById = {};
let first = true;

/* ------------------------------------------------------------------ utils */
const $ = (id) => document.getElementById(id);
async function api(path, opts) {
  const r = await fetch(path, opts);
  if (!r.ok) throw new Error(path + " -> " + r.status);
  return r.json();
}
const post = (path, body) =>
  api(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

/* ============================================================== renderer == */
/* Two modes: PIXI (WebGL sprites) or a plain 2D canvas fallback.
   The canvas element (id=sim) is shared: PIXI takes it if WebGL works. */

let app = null;          // PIXI.Application
let world = null;        // root container
let mode2d = true;       // true until PIXI init succeeds
let _ctx2d = null;       // lazy 2d context (only valid if PIXI did NOT take the canvas)

/* sprite pools */
const beePool = [], waspPool = [], flowerPool = [];
const activeBees = [], activeWasps = [], activeFlowers = [];
let nestSprite = null, queenSprite = null;
let TX = null;           // textures

const BEE_S = 0.42, WASP_S = 0.5, QUEEN_S = 0.5, NEST_S = 0.67;

function makeTex(w, h, draw) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const g = c.getContext("2d");
  draw(g, w, h);
  return PIXI.Texture.from(c);
}

/* ---------- art ----------------------------------------------------------- */
function drawBeeBody(g, wasp) {
  // faces right; art box 64x64, body centred ~(30,32)
  // stinger
  g.beginPath();
  g.moveTo(17, 32); g.lineTo(5, 30.5); g.lineTo(17, 35.5);
  g.closePath();
  g.fillStyle = wasp ? "#5a2d16" : "#4a3113";
  g.fill();
  // body
  const bodyFill = wasp ? "#3a2a20" : "#ffc84a";
  g.beginPath();
  g.ellipse(30, 32, 15, 9.5, 0, 0, Math.PI * 2);
  g.fillStyle = bodyFill;
  g.fill();
  g.lineWidth = 2;
  g.strokeStyle = wasp ? "#1f150f" : "#4a3113";
  g.stroke();
  // stripes / bands (clipped to body)
  g.save();
  g.beginPath();
  g.ellipse(30, 32, 15, 9.5, 0, 0, Math.PI * 2);
  g.clip();
  if (wasp) {
    // wasp: two cream bands + reddish-brown base
    g.fillStyle = "#f2e8cf";
    g.fillRect(21, 20, 5, 24);
    g.fillRect(33, 20, 5, 24);
    g.fillStyle = "#b5502a";
    g.fillRect(14, 20, 7, 24);
  } else {
    g.fillStyle = "#241a08";
    g.fillRect(21, 20, 4.5, 24);
    g.fillRect(28.5, 20, 4.5, 24);
    g.fillRect(36, 20, 4.5, 24);
  }
  g.restore();
  // head
  g.beginPath();
  g.arc(46, 30, 6.5, 0, Math.PI * 2);
  g.fillStyle = wasp ? "#f2b13d" : "#4a3113";
  g.fill();
  // eye
  g.beginPath();
  g.arc(47.5, 28, 1.7, 0, Math.PI * 2);
  g.fillStyle = "#fff";
  g.fill();
  // antennae
  g.strokeStyle = wasp ? "#3a2a20" : "#4a3113";
  g.lineWidth = 1.5;
  g.beginPath();
  g.moveTo(48, 24); g.lineTo(54, 17);
  g.moveTo(45, 23.5); g.lineTo(48, 16);
  g.stroke();
  // legs
  g.beginPath();
  g.moveTo(24, 40); g.lineTo(21, 46);
  g.moveTo(30, 41); g.lineTo(29, 47);
  g.moveTo(36, 40); g.lineTo(38, 46);
  g.stroke();
}

function drawWings(g) {
  g.save();
  g.globalAlpha = 0.55;
  g.fillStyle = "#eaf6ff";
  g.strokeStyle = "rgba(255,255,255,0.7)";
  g.lineWidth = 1;
  g.beginPath();
  g.ellipse(18, 13, 13, 7.5, -0.5, 0, Math.PI * 2);
  g.fill(); g.stroke();
  g.globalAlpha = 0.4;
  g.beginPath();
  g.ellipse(30, 21, 11, 6.5, 0.35, 0, Math.PI * 2);
  g.fill(); g.stroke();
  g.restore();
}

function makeBeeTexture(wasp) {
  return makeTex(64, 64, (g) => drawBeeBody(g, wasp));
}
function makeWingTexture() {
  return makeTex(48, 36, (g) => drawWings(g));
}
function makeQueenTexture() {
  return makeTex(64, 64, (g) => {
    g.fillStyle = "#ffd75e";
    drawBeeBody(g, false);
    // re-tint body to gold
    g.save();
    g.globalCompositeOperation = "source-atop";
    g.globalAlpha = 0.55;
    g.fillStyle = "#ffd75e";
    g.fillRect(0, 0, 64, 64);
    g.restore();
    // crown
    g.beginPath();
    g.moveTo(40, 21);
    g.lineTo(42, 11); g.lineTo(45.5, 18);
    g.lineTo(48, 9);  g.lineTo(51, 18);
    g.lineTo(54, 11); g.lineTo(55.5, 21);
    g.closePath();
    g.fillStyle = "#ffe066";
    g.strokeStyle = "#b7791f";
    g.lineWidth = 1.5;
    g.fill(); g.stroke();
  });
}
function makeFlowerTexture() {
  return makeTex(64, 64, (g) => {
    for (let a = 0; a < 6; a++) {
      const ang = (a * Math.PI) / 3 + 0.3;
      const px = 32 + 13 * Math.cos(ang);
      const py = 32 + 13 * Math.sin(ang);
      g.save();
      g.translate(px, py);
      g.rotate(ang);
      g.beginPath();
      g.ellipse(0, 0, 10.5, 6, 0, 0, Math.PI * 2);
      g.fillStyle = "#2dd4bf";
      g.fill();
      g.lineWidth = 1.5;
      g.strokeStyle = "#0e7a6f";
      g.stroke();
      g.restore();
    }
    g.beginPath();
    g.arc(32, 32, 7, 0, Math.PI * 2);
    g.fillStyle = "#ffd166";
    g.fill();
    g.lineWidth = 1.5;
    g.strokeStyle = "#b7791f";
    g.stroke();
  });
}
function makeNestTexture() {
  return makeTex(128, 128, (g) => {
    g.save();
    g.beginPath();
    g.arc(64, 64, 58, 0, Math.PI * 2);
    g.clip();
    g.fillStyle = "#7a5420";
    g.fillRect(0, 0, 128, 128);
    // hex comb
    const s = 12;
    const hw = Math.sqrt(3) * s;          // hex width
    const vh = 1.5 * s;                   // vertical step
    let row = 0;
    for (let y = 8; y < 128; y += vh, row++) {
      const xoff = row % 2 ? hw / 2 : 0;
      for (let x = 8 - hw / 2; x < 128; x += hw) {
        g.beginPath();
        for (let i = 0; i < 6; i++) {
          const a = (Math.PI / 3) * i + Math.PI / 6;
          const px = x + s * Math.cos(a);
          const py = y + s * Math.sin(a);
          i ? g.lineTo(px, py) : g.moveTo(px, py);
        }
        g.closePath();
        g.fillStyle = (row * 7 + Math.floor(x / hw)) % 5 === 0 ? "#e7b855" : "#d9a441";
        g.fill();
        g.lineWidth = 2;
        g.strokeStyle = "#8a5a1f";
        g.stroke();
      }
    }
    g.restore();
    // rim
    g.beginPath();
    g.arc(64, 64, 58, 0, Math.PI * 2);
    g.lineWidth = 6;
    g.strokeStyle = "#5a3d15";
    g.stroke();
  });
}
function makeHaloTexture() {
  return makeTex(48, 48, (g) => {
    g.beginPath();
    g.arc(24, 24, 15, 0, Math.PI * 2);
    g.lineWidth = 5;
    g.strokeStyle = "#ffffff";
    g.stroke();
  });
}

/* ---------- sprite factories --------------------------------------------- */
function makeBeeSprite() {
  const g = new PIXI.Container();
  const halo = new PIXI.Sprite(TX.halo);
  halo.anchor.set(0.5); halo.scale.set(0.42); halo.tint = COLORS.FORAGING;
  const wing = new PIXI.Sprite(TX.wing);
  wing.anchor.set(0.5); wing.position.set(22, 14);
  const body = new PIXI.Sprite(TX.bee);
  body.anchor.set(0.5); body.scale.set(BEE_S);
  body.position.set(32, 32);
  g.addChild(halo, wing, body);
  g.phase = Math.random() * 6.28;
  g.injured = false;
  g.visible = false;
  return g;
}
function makeWaspSprite() {
  const g = new PIXI.Container();
  const halo = new PIXI.Sprite(TX.halo);
  halo.anchor.set(0.5); halo.scale.set(0.5); halo.tint = 0xef4444;
  const wing = new PIXI.Sprite(TX.wing);
  wing.anchor.set(0.5); wing.position.set(24, 16);
  const body = new PIXI.Sprite(TX.wasp);
  body.anchor.set(0.5); body.scale.set(WASP_S);
  body.position.set(32, 32);
  g.addChild(halo, wing, body);
  g.phase = Math.random() * 6.28;
  g.visible = false;
  return g;
}
function makeFlowerSprite() {
  const s = new PIXI.Sprite(TX.flower);
  s.anchor.set(0.5);
  s.visible = false;
  return s;
}
function poolGet(pool, factory) {
  const o = pool.length ? pool.pop() : factory();
  o.visible = true;
  if (!o.parent) world.addChild(o);   // keep pooled sprites attached to the display tree
  return o;
}
function poolRet(pool, o) { o.visible = false; pool.push(o); }

/* ---------- init ------------------------------------------------------------ */
const swarmLabelCache = {};
function swarmLabel(n) {
  if (!swarmLabelCache[n]) {
    swarmLabelCache[n] = new PIXI.Text("swarm " + n, {
      fill: 0xffffff, fontFamily: "sans-serif", fontSize: 11,
    });
  }
  return swarmLabelCache[n];
}

function initRenderer() {
  if (!window.PIXI) return false;
  try {
    app = new PIXI.Application({
      view: canvas, width: 800, height: 800,
      backgroundAlpha: 0, antialias: true, resolution: 1,
      preserveDrawingBuffer: true,
      preference: "standard",   // render on the main thread (deterministic frames)
    });
    world = new PIXI.Container();
    app.stage.addChild(world);
    TX = {
      bee: makeBeeTexture(false),
      wasp: makeBeeTexture(true),
      queen: makeQueenTexture(),
      wing: makeWingTexture(),
      flower: makeFlowerTexture(),
      nest: makeNestTexture(),
      halo: makeHaloTexture(),
    };
    nestSprite = new PIXI.Sprite(TX.nest);
    nestSprite.anchor.set(0.5); nestSprite.scale.set(NEST_S);
    queenSprite = new PIXI.Sprite(TX.queen);
    queenSprite.anchor.set(0.5); queenSprite.scale.set(QUEEN_S);
    queenSprite.position.set(0, -10);
    nestSprite.addChild(queenSprite);
    world.addChild(nestSprite);
    app.ticker.add(tickerTick);
    mode2d = false;
    window.__RENDER_MODE__ = "pixi";      // test hook
    return true;
  } catch (e) {
    console.error("Pixi init failed, falling back to 2D canvas", e);
    app = null; world = null;
    return false;
  }
}

/* wing-flap + injury-pulse animation at ~60fps, independent of the 8Hz poll */
function tickerTick() {
  if (mode2d) return;
  const now = performance.now();
  for (let i = 0; i < activeBees.length; i++) {
    const g = activeBees[i];
    const flap = 0.45 + 0.75 * Math.abs(Math.sin(now * 0.02 + g.phase));
    g.children[1].scale.set(BEE_S, BEE_S * flap);
    if (g.injured) {
      g.children[0].scale.set(0.42 + 0.14 * Math.sin(now * 0.015));
    }
  }
  for (let i = 0; i < activeWasps.length; i++) {
    const g = activeWasps[i];
    g.children[1].scale.set(WASP_S, WASP_S * (0.45 + 0.75 * Math.abs(Math.sin(now * 0.025 + g.phase))));
  }
}

/* ---------- per-snapshot render (Pixi mode) --------------------------------- */
function renderPixi(snap) {
  const gw = snap.grid[0];
  cell = app.renderer.width / gw;
  // retire actives back to pools
  for (const g of activeBees) poolRet(beePool, g);   activeBees.length = 0;
  for (const g of activeWasps) poolRet(waspPool, g); activeWasps.length = 0;
  for (const s of activeFlowers) poolRet(flowerPool, s); activeFlowers.length = 0;

  // flowers
  for (const f of snap.flowers) {
    const s = poolGet(flowerPool, makeFlowerSprite);
    s.position.set((f.x + 0.5) * cell, (f.y + 0.5) * cell);
    s.scale.set(0.45 + 0.85 * f.n);
    s.alpha = 0.35 + 0.6 * f.n;
    activeFlowers.push(s);
  }
  // nest + queen
  nestSprite.position.set((snap.nest[0] + 0.5) * cell, (snap.nest[1] + 0.5) * cell);

  // bees
  for (const b of snap.bees) {
    const g = poolGet(beePool, makeBeeSprite);
    g.position.set((b.x + 0.5) * cell, (b.y + 0.5) * cell);
    g.injured = b.h < 0.9;
    g.children[0].tint = g.injured ? INJURED_TINT : (COLORS[b.st] || 0xffffff);
    if (!g.injured) g.children[0].scale.set(0.42);
    activeBees.push(g);
  }
  // wasps
  for (const w of snap.wasps) {
    const g = poolGet(waspPool, makeWaspSprite);
    g.position.set((w.x + 0.5) * cell, (w.y + 0.5) * cell);
    activeWasps.push(g);
  }
  // swarm markers
  const mark = new PIXI.Graphics();
  for (const s of snap.swarm_events) {
    const px = (s.pos[0] + 0.5) * cell, py = (s.pos[1] + 0.5) * cell;
    mark.lineStyle(2, 0xffffff, 0.5);
    mark.beginFill(0xffffff, 0.08);
    mark.drawCircle(px, py, cell * 1.4);
    mark.endFill();
    const t = swarmLabel(s.n);
    t.position.set(px + 10, py - 7);
    world.addChild(mark, t);
  }
  window.__PIXI_STATS__ = {               // test hook
    bees: activeBees.length, wasps: activeWasps.length,
    flowers: activeFlowers.length,
  };
}

/* ---------- per-snapshot render (2D fallback, the original canvas code) ----- */
const FLOWER_COLOR = "#2dd4bf", NEST_COLOR = "#a3e635", WASP_COLOR = "#ef4444", INJURED_COLOR = "#ff8787";
function render2D(snap) {
  if (!_ctx2d) _ctx2d = canvas.getContext("2d");
  if (!_ctx2d) return; // PIXI took the canvas -> cannot 2d-render
  const ctx = _ctx2d;
  const gw = snap.grid[0];
  cell = canvas.width / gw;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#0b0f18";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  for (const s of snap.swarm_events) {
    ctx.save();
    ctx.strokeStyle = "rgba(255,255,255,0.5)";
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.arc(s.pos[0] * cell + cell / 2, s.pos[1] * cell + cell / 2, cell * 1.4, 0, 7);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "rgba(255,255,255,0.7)";
    ctx.font = "11px sans-serif";
    ctx.fillText("swarm " + s.n, s.pos[0] * cell + cell / 2 + 8, s.pos[1] * cell + cell / 2);
    ctx.restore();
  }
  for (const f of snap.flowers) {
    ctx.fillStyle = FLOWER_COLOR;
    ctx.globalAlpha = 0.35 + 0.6 * f.n;
    ctx.beginPath();
    ctx.arc(f.x * cell + cell / 2, f.y * cell + cell / 2, 3 + 5 * f.n, 0, 7);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  const nx = snap.nest[0] * cell, ny = snap.nest[1] * cell;
  ctx.fillStyle = NEST_COLOR;
  ctx.globalAlpha = 0.25;
  ctx.fillRect(nx - cell * 1.2, ny - cell * 1.2, cell * 3.4, cell * 3.4);
  ctx.globalAlpha = 1;
  ctx.beginPath();
  ctx.arc(nx + cell * 0.5, ny + cell * 0.5, 6, 0, 7);
  ctx.fill();
  const STATE_HEX = { FORAGING: "#ffcf4d", RETURNING: "#ffb057", NURSING: "#5ad18a",
    RESCUING: "#7aa2ff", DEFENDING: "#c084fc", HIBERNATING: "#94a3b8", RESTING: "#d9b46a" };
  for (const b of snap.bees) {
    const px = b.x * cell + cell / 2, py = b.y * cell + cell / 2;
    const injured = b.h < 0.9;
    ctx.fillStyle = injured ? INJURED_COLOR : (STATE_HEX[b.st] || "#fff");
    ctx.beginPath();
    ctx.arc(px, py, 3.4, 0, 7);
    ctx.fill();
    if (injured) {
      ctx.strokeStyle = "rgba(255,135,135,0.9)";
      ctx.beginPath();
      ctx.arc(px, py, 6.2, 0, 7);
      ctx.stroke();
    }
  }
  for (const w of snap.wasps) {
    const px = w.x * cell + cell / 2, py = w.y * cell + cell / 2;
    ctx.fillStyle = WASP_COLOR;
    ctx.beginPath();
    ctx.moveTo(px, py - 6);
    ctx.lineTo(px + 5.5, py + 5);
    ctx.lineTo(px - 5.5, py + 5);
    ctx.closePath();
    ctx.fill();
  }
}

function render(snap) {
  if (mode2d) render2D(snap); else renderPixi(snap);
}

/* -------------------------------------------------------------- stats/ui */
function updateStats(s) {
  $("st-step").textContent = s.step;
  $("st-temp").textContent = s.temp.toFixed(1);
  $("st-honey").textContent = s.honey.toFixed(1);
  $("st-pop").textContent = s.population;
  $("st-larvae").textContent = s.larvae;
  $("st-rescues").textContent = s.rescues_total;
  $("st-waspkills").textContent = s.wasp_kills;
  $("alarmfill").style.width = Math.min(100, s.alarm * 100) + "%";
  const season = s.season;
  $("footer").textContent =
    `day ${s.step} · season nectar ${(season * 100).toFixed(0)}% · ` +
    `state mix: ` +
    Object.entries(s.state_counts)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${k.toLowerCase()} ${v}`)
      .join(" · ");
}

/* --------------------------------------------------------------- rules */
function buildRules() {
  api("/api/rules").then((rules) => {
    for (const r of rules) rulesById[r.id] = r;
    const el = $("rules");
    el.innerHTML = "";
    for (const r of rules) {
      const num = parseInt(r.id.slice(1), 10);
      const div = document.createElement("div");
      div.className = "rule";
      div.id = "rule-" + r.id;
      div.innerHTML =
        `<div class="rt"><span><span class="rn">#${num}</span> ${r.title}</span>` +
        `<span class="cnt" id="cnt-${r.id}">0</span></div>` +
        `<div class="ct">${r.text}</div>`;
      el.appendChild(div);
    }
  });
}
function updateRules(snap) {
  for (const [id, n] of Object.entries(snap.rule_step)) {
    const c = document.getElementById("cnt-" + id);
    if (c) c.textContent = n + (n > 0 ? " /step" : "");
    const d = document.getElementById("rule-" + id);
    if (d) d.classList.toggle("hot", n > 0);
  }
}

/* --------------------------------------------------------------- charts */
const plotLayout = {
  paper_bgcolor: "rgba(0,0,0,0)",
  plot_bgcolor: "rgba(13,19,31,0.9)",
  font: { color: "#c9d4ea", size: 11 },
  margin: { l: 40, r: 10, t: 30, b: 28 },
  xaxis: { gridcolor: "#22304a", zeroline: false },
  yaxis: { gridcolor: "#22304a", zeroline: false },
  showlegend: false,
  height: 280,
};
function updateCharts(s) {
  const h = s.history;
  if (!h || !h.t || h.t.length < 2) return;
  if (first) first = false;

  Plotly.react("chart-pop", [
    { x: h.t, y: h.population, name: "bees", type: "scatter",
      mode: "lines", line: { color: "#ffcf4d", width: 2 } },
    { x: h.t, y: h.foragers, name: "foragers", type: "scatter",
      mode: "lines", line: { color: "#ffb057", width: 1 } },
    { x: h.t, y: h.nurses, name: "nurses", type: "scatter",
      mode: "lines", line: { color: "#5ad18a", width: 1 } },
    { x: h.t, y: h.hibernating, name: "hibernating", type: "scatter",
      mode: "lines", line: { color: "#94a3b8", width: 1 } },
    { x: h.t, y: h.defending, name: "defending", type: "scatter",
      mode: "lines", line: { color: "#c084fc", width: 1 } },
  ], { ...plotLayout, title: "Colony composition (rule 11/6/7 visible here)",
       showlegend: true, legend: { orientation: "h", y: 1.12 } });

  Plotly.react("chart-honey", [
    { x: h.t, y: h.honey, name: "honey", type: "scatter",
      mode: "lines", line: { color: "#ffa94d", width: 2 },
      fill: "tozeroy", fillcolor: "rgba(255,169,77,0.12)" },
    { x: h.t, y: h.rescues_total, name: "cumulative rescues", type: "scatter",
      mode: "lines", line: { color: "#7aa2ff", width: 1, dash: "dot" } },
  ], { ...plotLayout, title: "Honey store (rules 2/10/12) & rescues (rule 1)" });
}

/* ------------------------------------------------------------- controls */
const dragged = new Set(); // slider ids the user is adjusting right now
const pending = {};        // slider id -> {v, until} awaiting server round-trip
function bindSlider(id, param, labelId, fmt) {
  const el = $(id), lab = $(labelId);
  // Label updates live while dragging; the value is SENT once on release
  // (a drag fires dozens of 'input' events; one request per release).
  // While adjusting, the polling loop must not overwrite this slider
  // (syncParamLabels checks `dragged`/`pending`).
  el.addEventListener("input", () => {
    lab.textContent = fmt(el.value);
    if (param) dragged.add(id);
  });
  el.addEventListener("change", () => {
    if (!param) return;
    dragged.delete(id);
    pending[id] = { v: +el.value, until: Date.now() + 15000 };
    post("/api/set_params", { [param]: +el.value });
  });
  el.addEventListener("blur", () => { if (param) dragged.delete(id); });
}
bindSlider("c-speed", null, "v-speed", (v) => v + "×");
bindSlider("c-nbees", "n_bees", "v-nbees", (v) => v);
bindSlider("c-temp", "temperature", "v-temp", (v) => v);
bindSlider("c-wasp", "wasp_count", "v-wasp", (v) => v);
bindSlider("c-nreg", "nectar_regrowth", "v-nreg", (v) => (+v).toFixed(2));
bindSlider("c-sense", "sense_radius", "v-sense", (v) => v);
bindSlider("c-maxbees", "max_bees", "v-maxbees", (v) => v);
bindSlider("c-larvae", "larvae_days", "v-larvae", (v) => v);

$("c-daynight").addEventListener("change", (e) =>
  post("/api/set_params", { day_night: e.target.checked }));

$("btn-run").addEventListener("click", async () => {
  running = !running;
  $("btn-run").textContent = running ? "⏸ Pause" : "▶ Run";
  $("btn-run").classList.toggle("primary", running);
  await post("/api/running", { running });
});
$("btn-step").addEventListener("click", () => post("/api/step", { n: 1 }));
$("btn-reset").addEventListener("click", async () => {
  await post("/api/reset");
});
$("btn-wasp").addEventListener("click", async () => {
  await post("/api/spawn_wasp");
  $("c-wasp").value = Math.min(12, +$("c-wasp").value + 1);
  $("v-wasp").textContent = $("c-wasp").value;
});
$("btn-injure").addEventListener("click", () => post("/api/injure"));

function syncParamLabels(s) {
  // Keep the UI in sync with the server, but never fight the user:
  // skip sliders that are being dragged or whose round-trip hasn't
  // been confirmed yet (server value must match what we sent).
  const p = s.params;
  const sync = (id, lab, v, fmt) => {
    if (dragged.has(id)) return;
    const pd = pending[id];
    if (pd !== undefined) {
      if (v === pd.v) delete pending[id];            // confirmed -> resume sync
      else if (Date.now() > pd.until) delete pending[id]; // safety: unstick
      else return;                                   // still in flight
    }
    $(id).value = v;
    $(lab).textContent = fmt(v);
  };
  sync("c-nbees", "v-nbees", p.n_bees, String);
  sync("c-temp", "v-temp", Math.round(p.temperature), String);
  sync("c-wasp", "v-wasp", p.wasp_count, String);
  sync("c-nreg", "v-nreg", p.nectar_regrowth, (v) => (+v).toFixed(2));
  sync("c-sense", "v-sense", p.sense_radius, String);
  sync("c-maxbees", "v-maxbees", p.max_bees, String);
  sync("c-larvae", "v-larvae", p.larvae_days, String);
  $("c-daynight").checked = !!p.day_night;
}

/* --------------------------------------------------------------- main loop */
let inflight = false;   // never stack requests on a slow link (SSH tunnel)
async function tick() {
  if (inflight) return;            // previous poll still travelling
  inflight = true;
  try {
    const snap = running
      ? await api(`/api/state?step=true&speed=${speed}`)
      : await api("/api/state?step=false");
    render(snap);
    updateStats(snap);
    updateRules(snap);
    updateCharts(snap);
    syncParamLabels(snap);
  } catch (e) {
    $("footer").textContent = "backend error: " + e.message;
  } finally {
    inflight = false;
  }
}

/* ---------------------------------------------------------------- start */
if (!initRenderer()) {
  $("footer").textContent = "PixiJS/WebGL unavailable — using 2D canvas fallback";
  window.__RENDER_MODE__ = "2d";
}
buildRules();
tick();
setInterval(tick, 120);