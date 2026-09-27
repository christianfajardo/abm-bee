/* Colony3D: renders the bee-colony world as a 3D scene in PixiJS 2D.
 *
 * Technique: every entity lives in world space (grid x/y, height z). Each
 * frame we (1) advance a soft physics step (spring toward the target the
 * server gave us + pairwise separation + flight bobbing), (2) project to
 * screen with the perspective Camera3D, and (3) depth-sort (painter's
 * algorithm, via zIndex + sortChildren) so nearer sprites overdraw farther
 * ones. Shadows are drawn on the ground plane. The ground is a tessellated
 * perspective grid.
 */
import * as PIXI from "pixi.js";
import { Camera3D } from "./camera3d.js";
import { buildTextures } from "./art.js";

/* world-space sizes (in grid cells); wasps render 2x the bee */
const SIZE = { bee: 1.15, wasp: 2.3, queen: 1.3, flower: 2.4, nest: 3.6 };
/* base flight height per state (z in cells) */
const BASE_Z = {
  FORAGING: 2.2, RETURNING: 1.8, NURSING: 0.5, RESCUING: 0.9,
  DEFENDING: 1.4, HIBERNATING: 0.45, RESTING: 1.1,
};
const WEEP_Z = 2.6;          // wasps circle higher
const INJURED_TINT = 0xff5a5a;
const STATE_TINT = {
  FORAGING: 0xffcf4d, RETURNING: 0xffb057, NURSING: 0x5ad18a,
  RESCUING: 0x7aa2ff, DEFENDING: 0xc084fc, HIBERNATING: 0x94a3b8,
  RESTING: 0xd9b46a,
};

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
// ground-contact shadows are OFF by default: at the default camera angle the
// black blobs under the bees read as a dark patch over the far/"back" side of
// the colony. Set true to bring them back.
const SHOW_SHADOWS = false;

class Entity {
  constructor(type, x, y, z) {
    this.type = type;
    this.pos = { x, y, z };
    this.vel = { x: 0, y: 0, z: 0 };
    this.target = { x, y, z };
    this.phase = Math.random() * Math.PI * 2;
    this.bobAmp = 0.15 + Math.random() * 0.2;
    this.bobFreq = 2.5 + Math.random() * 2.5;
    this.t = 0;
    this.data = null;
    this.alive = true;
    this.fade = 1;
  }
}

export class Colony3D {
  constructor(canvas) {
    this.canvas = canvas;
    this.camera = new Camera3D(800, 800);
    this.app = new PIXI.Application({
      view: canvas, width: 800, height: 800,
      backgroundAlpha: 0, antialias: true, resolution: 1,
      preference: "standard",
    });
    this.stage = this.app.stage;
    this.stage.backgroundColor = 0x0b0f18;
    this.TX = buildTextures();
    this.ground = new PIXI.Graphics();
    this.stage.addChild(this.ground);
    // warm stage-light glow over the colony (additive = pure light), keeps
    // the whole arena — including the far/"back" side — bright and readable
    this.glow = new PIXI.Sprite(this.TX.glow);
    this.glow.anchor.set(0.5);
    this.glow.blendMode = PIXI.BLEND_MODES.ADD;
    this.glow.alpha = 0.9;
    this.stage.addChild(this.glow);
    this.world = new PIXI.Container();
    this.stage.addChild(this.world);
    this.labels = new PIXI.Container();
    this.stage.addChild(this.labels);

    // world state (set by setSnapshot; safe defaults so the very first
    // frames before the first snapshot never crash)
    this.grid = null;
    this.nest = [20, 20];
    this.swarmEvents = [];
    this.beeGoal = null;

    this.entities = new Map();      // id -> Entity
    this.nextId = 1;
    this.swarmTexts = new Map();
    this.swarmGfx = new PIXI.Graphics();
    this.stage.addChild(this.swarmGfx);
    // hover tooltip: HTML overlay inside the canvas's parent (#simwrap is
    // position:relative). Repositioned every frame so it follows the bee.
    const wrap = canvas.parentElement;
    this._tooltip = document.createElement("div");
    this._tooltip.className = "bee-tip";
    this._tooltip.style.display = "none";
    if (wrap) wrap.appendChild(this._tooltip);
    this._mouse = null;      // canvas-local pointer position (null when off)
    this._hovered = null;    // entity currently under the cursor

    // persistent billboards (created once — no per-frame allocation)
    this.nestSprite = new PIXI.Sprite(this.TX.nest);
    this.nestSprite.anchor.set(0.5);
    this.world.addChild(this.nestSprite);
    this.queenSprite = new PIXI.Sprite(this.TX.queen);
    this.queenSprite.anchor.set(0.5);
    this.nestSprite.addChild(this.queenSprite);

    this.fps = 60;
    this._frameCount = 0;
    this._lastNow = performance.now();
    this.app.ticker.add(() => this._tick());
    this._bindInput();
    this.onStateChange = null;      // optional callback for HUD
  }

  /* ------------------------------------------------------------- data */
  setSnapshot(snap) {
    this.grid = snap.grid;
    this.nest = snap.nest;
    if (snap.grid && snap.grid.length === 2) {
      // the camera target is clamped to the world (plus a little padding),
      // so panning can never fly the view off into the void
      const pad = 5;
      this.camera.bounds = {
        minX: -pad, maxX: snap.grid[0] + pad,
        minY: -pad, maxY: snap.grid[1] + pad,
      };
    }
    this.swarmEvents = snap.swarm_events || [];
    this.beeGoal = snap.params ? snap.params.n_bees : null;
    // flowers are static-ish: keyed by index position string
    const flowerKeys = new Set();
    for (const f of snap.flowers) {
      const k = "f" + f.x + "," + f.y;
      flowerKeys.add(k);
      let e = this.entities.get(k);
      if (!e) {
        e = new Entity("flower", f.x, f.y, 0.6);
        this.entities.set(k, e);
      }
      e.alive = true;   // revive (same zombie bug as bees)
      e.fade = 1;
      e.data = { nectar: f.n };
      e.target = { x: f.x, y: f.y, z: 0.6 };
    }
    for (const [k, e] of this.entities) if (e.type === "flower" && !flowerKeys.has(k)) e.alive = false;

    // bees: match snapshot entries to existing entities by proximity.
    // A match REVIVES the entity: it may be one mid-fade-out (a bee that
    // just died server-side and was re-egged), and without the revive the
    // matched entity stays dead (frozen, uncounted) while the snap bee it
    // represents is silently dropped — the scene then shows fewer bees than
    // the model and never recovers (zombies also block new-entity creation
    // because they count as "an entity within 6 cells").
    const beeList = [];
    for (const [k, e] of this.entities) if (e.type === "bee" || e.type === "wasp") beeList.push(e);
    const used = new Set();
    const bees = snap.bees || [];
    for (const b of bees) {
      let best = null, bestD = 6; // match within 6 cells
      for (const e of beeList) {
        if (used.has(e) || e.type !== "bee") continue;
        const dx = e.pos.x - b.x, dy = e.pos.y - b.y;
        const d = Math.hypot(dx, dy);
        if (d < bestD) { bestD = d; best = e; }
      }
      if (!best) {
        best = new Entity("bee", b.x, b.y, BASE_Z[b.st] || 1);
        const id = "b" + this.nextId++;
        this.entities.set(id, best);
        beeList.push(best);
      }
      used.add(best);
      best.alive = true;   // revive: track this bee from now on
      best.fade = 1;
      best.data = { st: b.st, h: b.h, e: b.e };
      best.target = { x: b.x, y: b.y, z: BASE_Z[b.st] || 1 };
    }
    for (const e of beeList) {
      if (e.type === "bee" && !used.has(e)) e.alive = false; // no match -> fade out
    }

    // wasps: exact count management
    const wasps = snap.wasps || [];
    const waspList = [...this.entities.values()].filter((e) => e.type === "wasp");
    waspList.forEach((e, i) => {
      if (i < wasps.length) {
        e.alive = true;   // revive (same zombie bug as bees)
        e.fade = 1;
        e.data = null;
        e.target = { x: wasps[i].x, y: wasps[i].y, z: WEEP_Z };
      } else e.alive = false;
    });
    for (let i = waspList.length; i < wasps.length; i++) {
      const e = new Entity("wasp", wasps[i].x, wasps[i].y, WEEP_Z);
      this.entities.set("w" + this.nextId++, e);
    }
  }

  /* ----------------------------------------------------------- physics */
  _physics(dt) {
    const stiff = 14, damp = Math.exp(-dt * 6.5);
    const sepR = 0.85, sepForce = 30;
    const list = [...this.entities.values()];
    // spatial hash for separation (only flying agents)
    const hash = new Map();
    for (const e of list) {
      if (!e.alive || e.type === "flower") continue;
      const key = (e.pos.x | 0) + "," + (e.pos.y | 0);
      (hash.get(key) || hash.set(key, []).get(key)).push(e);
    }
    for (const e of list) {
      if (!e.alive) {
        // fading out: shrink over ~0.5s; the reap pass below removes the
        // entity (and its sprite) once fade hits 0. (Before this fix the
        // fade only ran inside the alive branch, which is unreachable for
        // dead entities — removed bees stayed at full alpha forever and
        // the scene showed more bees than the model.)
        e.fade = Math.max(0, e.fade - dt * 2);
        continue;
      }
      if (e.type === "flower") {
        e.pos = { ...e.target };
        continue;
      }
      // spring toward target
      e.vel.x += (e.target.x - e.pos.x) * stiff * dt;
      e.vel.y += (e.target.y - e.pos.y) * stiff * dt;
      e.vel.z += (e.target.z - e.pos.z) * stiff * 0.6 * dt;
      // separation from neighbours
      const cx = e.pos.x | 0, cy = e.pos.y | 0;
      for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) {
        const cell = hash.get((cx + ox) + "," + (cy + oy));
        if (!cell) continue;
        for (const o of cell) {
          if (o === e) continue;
          const dx = e.pos.x - o.pos.x, dy = e.pos.y - o.pos.y, dz = e.pos.z - o.pos.z;
          const d2 = dx * dx + dy * dy + dz * dz;
          if (d2 < sepR * sepR && d2 > 1e-6) {
            const d = Math.sqrt(d2);
            const push = (sepR - d) / sepR * sepForce * dt;
            e.vel.x += (dx / d) * push;
            e.vel.y += (dy / d) * push;
            e.vel.z += (dz / d) * push * 0.5;
          }
        }
      }
      e.vel.x *= damp; e.vel.y *= damp; e.vel.z *= damp;
      e.pos.x += e.vel.x * dt;
      e.pos.y += e.vel.y * dt;
      e.pos.z += e.vel.z * dt;
      e.t += dt;
      if (!e.alive) e.fade = Math.max(0, e.fade - dt * 2);
    }
    // reap fully-faded entities (detach their sprites/shadows from the scene)
    for (const [k, e] of this.entities) {
      if (!e.alive && e.fade <= 0) {
        if (e._sprite && e._sprite.parent) e._sprite.parent.removeChild(e._sprite);
        const sh = this._shadowPool.get(e);
        if (sh && sh.parent) sh.parent.removeChild(sh);
        this._shadowPool.delete(e);
        this.entities.delete(k);
      }
    }
  }

  /* ------------------------------------------------------------- render */
  _tick() {
    const now = performance.now();
    let dt = (now - this._lastNow) / 1000;
    this._lastNow = now;
    dt = clamp(dt, 0.001, 0.05);
    this.fps = this.fps * 0.95 + (1 / dt) * 0.05;
    // A transient error must never kill the render loop forever.
    try {
      this.camera.frame(dt);
      this._physics(dt);
      this._drawGround();
      this._drawEntities(dt);
      this._drawSwarms();
      this._hoverUpdate();
      this._frameCount++;
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("Colony3D frame error:", e);
    }
  }

  _drawGround() {
    const g = this.ground;
    const cam = this.camera;
    const gw = this.grid ? this.grid[0] : 40;
    const gh = this.grid ? this.grid[1] : 40;
    g.clear();

    // One uniform tessellation of the whole region: the central grid plus a
    // margin ("ground extension") around it. Each quad is shaded by its
    // distance from the camera (atmospheric haze: farther = lighter & bluer),
    // so the far edge — the "back" of the colony — stays legible against the
    // sky instead of sinking into the void when the camera rotates.
    const ext = 25, step = 5;
    const x0w = -ext, y0w = -ext, x1w = gw + ext, y1w = gh + ext;
    const cols = Math.round((x1w - x0w) / step);
    const rows = Math.round((y1w - y0w) / step);
    const HAZE = 0x3a5480;                 // far-ground haze (light blue)
    const hzR = (HAZE >> 16) & 255, hzG = (HAZE >> 8) & 255, hzB = HAZE & 255;
    const hazeFor = (d) => clamp((d - 18) / 70, 0, 1) * 0.72;
    const shade = (base, t) => {
      const r = Math.round(((base >> 16) & 255) + (hzR - ((base >> 16) & 255)) * t);
      const gg = Math.round(((base >> 8) & 255) + (hzG - ((base >> 8) & 255)) * t);
      const b = Math.round((base & 255) + (hzB - (base & 255)) * t);
      return (r << 16) | (gg << 8) | b;
    };
    for (let i = 0; i < cols; i++) {
      for (let j = 0; j < rows; j++) {
        const xa = x0w + i * step, xb = xa + step, ya = y0w + j * step, yb = ya + step;
        const p00 = cam.project({ x: xa, y: ya, z: 0 });
        const p10 = cam.project({ x: xb, y: ya, z: 0 });
        const p11 = cam.project({ x: xb, y: yb, z: 0 });
        const p01 = cam.project({ x: xa, y: yb, z: 0 });
        if (!p00 || !p10 || !p11 || !p01) continue;
        const inside = xa >= 0 && xb <= gw && ya >= 0 && yb <= gh;
        const checker = inside && (i + j) % 2 === 0;
        const base = checker ? 0x2b4066 : inside ? 0x20304a : 0x1a2846;
        const depth = (p00.depth + p10.depth + p11.depth + p01.depth) * 0.25;
        g.lineStyle(1, 0x3f6090, 0.6);
        g.beginFill(shade(base, hazeFor(depth)), 0.97);
        g.moveTo(p00.x, p00.y);
        g.lineTo(p10.x, p10.y);
        g.lineTo(p11.x, p11.y);
        g.lineTo(p01.x, p01.y);
        g.closePath();
        g.endFill();
      }
    }
    // crisp edge around the 40x40 play field so the world boundary reads
    // clearly (helps see exactly where the "back" edge is)
    const c00 = cam.project({ x: 0, y: 0, z: 0 });
    const c10 = cam.project({ x: gw, y: 0, z: 0 });
    const c11 = cam.project({ x: gw, y: gh, z: 0 });
    const c01 = cam.project({ x: 0, y: gh, z: 0 });
    if (c00 && c10 && c11 && c01) {
      // crisp edge around the 40x40 play field: 4 thin filled quads in world
      // space (Pixi v7 has no stroke() on Graphics, so outline via fills)
      const t = 0.35;
      const q = (ax, ay, bx, by, cx, cy, dx, dy) => {
        const a = cam.project({ x: ax, y: ay, z: 0 });
        const bb = cam.project({ x: bx, y: by, z: 0 });
        const c = cam.project({ x: cx, y: cy, z: 0 });
        const d = cam.project({ x: dx, y: dy, z: 0 });
        if (!a || !bb || !c || !d) return;
        g.beginFill(0x5f7db0, 0.85);
        g.moveTo(a.x, a.y); g.lineTo(bb.x, bb.y); g.lineTo(c.x, c.y); g.lineTo(d.x, d.y);
        g.closePath(); g.endFill();
      };
      q(0, 0, gw, 0, gw, t, 0, t);          // top
      q(0, gh - t, gw, gh - t, gw, gh, 0, gh); // bottom
      q(0, 0, t, 0, t, gh, 0, gh);          // left
      q(gw - t, 0, gw, 0, gw, gh, gw - t, gh); // right
    }
    // stage-light glow: flat pool of light centred on the colony, scaled to
    // the arena so it lights the whole field (and its far side) equally
    const gc = cam.project({ x: gw / 2, y: gh / 2, z: 0 });
    if (gc) {
      const dia = gw + 14;                    // glow diameter in world cells
      const gs = (dia * gc.scale) / this.TX.glow.width;
      this.glow.position.set(gc.x, gc.y);
      this.glow.scale.set(gs, gs);
      this.glow.visible = true;
    } else this.glow.visible = false;
  }

  _drawEntities(dt) {
    const cam = this.camera;
    const t = performance.now() * 0.001;
    // shadows: pooled per entity (allocated once, hidden when unused)
    if (!this._shadowPool) this._shadowPool = new Map();

    // nest + queen (persistent billboards)
    const nest = this.nest || [20, 20];
    const np = cam.project({ x: nest[0], y: nest[1], z: 1.4 });
    if (np) {
      // billboards: on-screen size (px) = SIZE * np.scale, then divided by
      // the texture's pixel size. Bees: (1.15 * 18.56) / 64 = 0.33.
      // Nest texture is 128px: (3.6 * 18.56) / 128 = 0.52 -> a ~67px nest
      // at default zoom (bees are ~21px).
      const ns = (np.scale * SIZE.nest) / this.TX.nest.width;
      this.nestSprite.position.set(np.x, np.y);
      this.nestSprite.scale.set(ns, ns);
      this.nestSprite.alpha = 1;
      this.nestSprite.zIndex = -Math.round(np.depth * 10);
      this.queenSprite.scale.set(0.55, 0.55);
      // -12 is in the nest's texture-local space (128px tex), so the
      // on-screen offset scales with zoom along with the nest
      this.queenSprite.position.set(0, -12);
    } else {
      this.nestSprite.visible = false;
    }

    for (const e of this.entities.values()) {
      if (!e.alive && e.fade <= 0) continue;
      const bob = e.type === "flower" ? 0 : Math.sin(t * e.bobFreq + e.phase) * e.bobAmp;
      const p = cam.project({ x: e.pos.x, y: e.pos.y, z: e.pos.z + bob });
      if (!p) {
        if (e._sprite) e._sprite.visible = false;
        continue;
      }

      // shadow on the ground (disabled: user asked to remove the black shadow)
      if (SHOW_SHADOWS && e.type !== "flower") {
        const sp = cam.project({ x: e.pos.x, y: e.pos.y, z: 0.02 });
        let shadow = this._shadowPool.get(e);
        if (sp) {
          if (!shadow) {
            shadow = new PIXI.Sprite(this.TX.shadow);
            shadow.anchor.set(0.5);
            this.world.addChild(shadow);
            this._shadowPool.set(e, shadow);
          }
          const h = e.pos.z + bob;
          // on-screen size (px) = SIZE * sp.scale; divide by the 48px
          // shadow texture so the sprite scale stays a normal ~0.3-0.5
          // (before: scale of ~21 on a 48px tex = ~1000px black blobs)
          const sSize = (SIZE[e.type] * sp.scale * (1 - Math.min(0.6, h * 0.12))) / this.TX.shadow.width;
          shadow.position.set(sp.x, sp.y);
          shadow.scale.set(sSize, sSize);
          shadow.alpha = e.fade * Math.max(0.06, 0.4 - h * 0.035);
          shadow.zIndex = -Math.round(sp.depth * 10) - 5;
          shadow.visible = true;
        } else if (shadow) shadow.visible = false;
      }

      const isBee = e.type === "bee" || e.type === "wasp";
      let size = SIZE[e.type] * p.scale;
      if (e.type === "flower") size *= 0.5 + 1.1 * (e.data ? e.data.nectar : 0.5);
      const sprite = this._getSprite(e, p, size, isBee, dt);
      sprite.visible = true;
      sprite.alpha = e.fade * (e.type === "flower" ? 0.4 + 0.6 * (e.data ? e.data.nectar : 0.5) : 1);
      // orient flying agents along their horizontal velocity
      if (isBee && (Math.abs(e.vel.x) > 0.02 || Math.abs(e.vel.y) > 0.02)) {
        const ang = Math.atan2(e.vel.y, e.vel.x);
        const diff = Math.atan2(Math.sin(ang - sprite.angle), Math.cos(ang - sprite.angle));
        sprite.angle += diff * Math.min(1, dt * 8);
      }
      // wing flap
      if (sprite.__wing) {
        const flap = 0.45 + 0.75 * Math.abs(Math.sin(t * 14 + e.phase));
        sprite.__wing.scale.set(e.fade, e.fade * flap);
      }
      // injured pulse ring
      if (sprite.__halo && e.type === "bee" && e.data && e.data.h < 0.9) {
        const k = 1 + 0.25 * Math.sin(t * 9);
        sprite.__halo.scale.set((size / 64) * 1.9 * k, (size / 64) * 1.9 * k);
        sprite.__halo.alpha = 0.5 + 0.35 * Math.sin(t * 9);
      }
      sprite.zIndex = -Math.round(p.depth * 10);
    }
    this.world.sortChildren();
  }

  _billboard(tex, size, p, layer, alpha, key) {
    const s = new PIXI.Sprite(tex);
    s.anchor.set(0.5);
    s.position.set(p.x, p.y);
    s.scale.set(size, size);
    s.alpha = alpha;
    s.zIndex = -Math.round(p.depth * 10) + (layer || 0);
    this.world.addChild(s);
    return s;
  }

  _getSprite(e, p, size, isBee, t) {
    // reuse a per-entity sprite if we have one (avoids GC churn)
    let s = e._sprite;
    if (!s) {
      s = new PIXI.Container();
      const main = new PIXI.Sprite(e.type === "wasp" ? this.TX.wasp : e.type === "flower" ? this.TX.flower : this.TX.bee);
      main.anchor.set(0.5);
      s.addChild(main);
      s.__main = main;
      if (isBee) {
        const wing = new PIXI.Sprite(this.TX.wing);
        wing.anchor.set(0.5);
        wing.position.set(0, -9);
        s.addChild(wing);
        s.__wing = wing;
        const halo = new PIXI.Sprite(this.TX.shadow);
        halo.anchor.set(0.5);
        halo.tint = INJURED_TINT;
        halo.scale.set(1.9, 1.9);
        halo.alpha = 0;
        s.addChild(halo);
        s.__halo = halo;
      }
      this.world.addChild(s);   // attach to the display tree (created detached otherwise)
      e._sprite = s;
    }
    if (e.type === "bee") s.__main.tint = (e.data && e.data.h < 0.9) ? INJURED_TINT : (e === this._hovered ? 0x66e0ff : (STATE_TINT[e.data ? e.data.st : "FORAGING"] || 0xffffff));
    s.position.set(p.x, p.y);
    const artPx = e.type === "flower" ? this.TX.flower.width : 64;
    s.scale.set(size / artPx, size / artPx); // art box is 64px (flower tex is 256px = 4x supersampled)
    if (s.__wing) s.__wing.position.set(0, -9);
    if (s.__halo) {
      const visible = e.type === "bee" && e.data && e.data.h < 0.9;
      s.__halo.scale.set(size / 64 * 1.9, size / 64 * 1.9);
      if (!visible) s.__halo.alpha = 0;
    }
    return s;
  }

  _drawSwarms() {
    const g = this.swarmGfx;
    g.clear();
    const cam = this.camera;
    const events = Array.isArray(this.swarmEvents) ? this.swarmEvents : [];
    for (const s of events) {
      const p = cam.project({ x: s.pos[0], y: s.pos[1], z: 0.1 });
      if (!p) continue;
      const r = cellToPx(cam, p, 1.6);
      g.lineStyle(2, 0xffffff, 0.5);
      g.beginFill(0xffffff, 0.08);
      g.drawCircle(p.x, p.y, r);
      g.endFill();
      // label (cached per count)
      let label = this.swarmTexts.get(s.n);
      if (!label) {
        label = new PIXI.Text("swarm " + s.n, {
          fill: 0xffffff, fontFamily: "sans-serif", fontSize: 12,
        });
        this.swarmTexts.set(s.n, label);
        this.labels.addChild(label);
      }
      label.position.set(p.x + r + 6, p.y - 8);
      label.alpha = 1;
    }
  }

  /* ----------------------------------------------- hover: bee tooltip */
  /* Runs every frame: if the pointer is over the canvas and not dragging,
     find the alive bee whose projected screen position is closest to the
     pointer (within a hit radius scaled by zoom). The tooltip is anchored
     to THAT bee's screen position each frame, so it follows the bee while
     it flies. Returns the hovered bee (null otherwise). */
  _hoverUpdate() {
    const tip = this._tooltip;
    if (!tip) return null;
    const dragging = this._pointers && this._pointers.size > 0;
    if (!this._mouse || dragging) {
      if (this._hovered) {
        this._hovered = null; tip.style.display = "none";
        this.canvas.style.cursor = "grab";
      }
      return null;
    }
    const cam = this.camera;
    const mw = this._mouse.x, mh = this._mouse.y;
    let best = null, bestD = 14; // hit radius in screen px (bees are ~18-21px)
    for (const e of this.entities.values()) {
      if (!e.alive || e.type !== "bee") continue;
      const p = cam.project({ x: e.pos.x, y: e.pos.y, z: e.pos.z });
      if (!p) continue;
      const d = Math.hypot(p.x - mw, p.y - mh);
      if (d < bestD) { bestD = d; best = e; }
    }
    if (best !== this._hovered) this._hovered = best;
    if (!best) {
      tip.style.display = "none";
      this.canvas.style.cursor = "grab";
      return null;
    }
    // anchor the tooltip to the bee's CURRENT projected position (follows it)
    const p = cam.project({ x: best.pos.x, y: best.pos.y, z: best.pos.z });
    if (!p) { tip.style.display = "none"; return null; }
    const d = best.data || {};
    const st = d.st || "FORAGING";
    const rows = [
      `<b>${st}</b>`,
      `energy ${(Math.round((d.e ?? 0) * 100))}% · health ${(Math.round((d.h ?? 0) * 100))}%`,
      `pos ${best.pos.x.toFixed(1)}, ${best.pos.y.toFixed(1)}`,
    ];
    if (tip._html !== rows.join("§")) {
      tip.innerHTML = rows.map((r, i) => `<div class="t${i === 0 ? " st" : ""}">${r}</div>`).join("");
      tip._html = rows.join("§");
    }
    tip.style.display = "block";
    // place above-right of the bee; flip to left if the bee is near the right edge
    const wrapW = this.canvas.clientWidth || 800;
    const tipW = tip.offsetWidth || 120, tipH = tip.offsetHeight || 40;
    let tx = p.x + 14, ty = p.y - tipH - 12;
    if (tx + tipW > wrapW - 4) tx = p.x - tipW - 14;
    if (ty < 4) ty = p.y + 14;
    tip.style.left = tx + "px";
    tip.style.top = ty + "px";
    this.canvas.style.cursor = "pointer";
    return best;
  }
  _setMouse(x, y) {
    this._mouse = { x, y };
  }
  _clearMouse() {
    this._mouse = null;
  }

  /* ------------------------------------------------------------ input */
  _bindInput() {
    const el = this.canvas;
    el.style.touchAction = "none";
    this._pointers = new Map();
    el.addEventListener("pointerdown", (ev) => {
      el.setPointerCapture(ev.pointerId);
      this._pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY, button: ev.button, shift: ev.shiftKey });
      this._pinchBase = null;
    });
    el.addEventListener("pointermove", (ev) => {
      const prev = this._pointers.get(ev.pointerId);
      if (!prev) return;
      const dx = ev.clientX - prev.x, dy = ev.clientY - prev.y;
      prev.x = ev.clientX; prev.y = ev.clientY;
      if (this._pointers.size >= 2) {
        // pinch: zoom by distance change, pan by midpoint movement
        const pts = [...this._pointers.values()];
        const a = pts[0], b = pts[1];
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        if (this._pinchBase) {
          const scale = this._pinchBase.dist / Math.max(1, dist);
          this.camera.zoom(Math.log(scale) * 400);
          const midNow = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
          const midBase = this._pinchBase.mid;
          this.camera.pan(midNow.x - midBase.x, midNow.y - midBase.y);
        }
        this._pinchBase = { dist, mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
        return;
      }
      const panning = prev.button === 2 || prev.shift || ev.shiftKey;
      if (panning) this.camera.pan(dx, dy);
      else this.camera.rotate(dx * 0.005, -dy * 0.005);
    });
    const up = (ev) => { this._pointers.delete(ev.pointerId); if (this._pointers.size < 2) this._pinchBase = null; };
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    // hover tracking: canvas-local pointer position (used by _hoverUpdate)
    el.addEventListener("pointermove", (ev) => {
      if (this._pointers.has(ev.pointerId)) return; // dragging: no hover
      const r = el.getBoundingClientRect();
      this._setMouse(ev.clientX - r.left, ev.clientY - r.top);
    });
    el.addEventListener("pointerleave", () => this._clearMouse());
    el.addEventListener("wheel", (ev) => {
      ev.preventDefault();
      this.camera.zoom(ev.deltaY);
    }, { passive: false });
    el.addEventListener("contextmenu", (ev) => ev.preventDefault());
    window.addEventListener("keydown", (ev) => {
      const k = ev.key;
      if (k === "ArrowLeft") this.camera.nudgeTarget(-1.5, 0);
      else if (k === "ArrowRight") this.camera.nudgeTarget(1.5, 0);
      else if (k === "ArrowUp") this.camera.nudgeTarget(0, -1.5);
      else if (k === "ArrowDown") this.camera.nudgeTarget(0, 1.5);
      else if (k === "+" || k === "=") this.camera.zoom(-120);
      else if (k === "-" || k === "_") this.camera.zoom(120);
      else if (k === "r" || k === "R") this.camera.reset();
    });
  }

  resize(w, h) {
    this.app.renderer.resize(w, h);
    this.camera.resize(w, h);
  }

  stats() {
    let bees = 0, wasps = 0, flowers = 0;
    for (const e of this.entities.values()) {
      if (!e.alive) continue;
      if (e.type === "bee") bees++;
      else if (e.type === "wasp") wasps++;
      else if (e.type === "flower") flowers++;
    }
    return {
      bees, wasps, flowers, fps: Math.round(this.fps),
      frames: this._frameCount,
      camera: {
        yaw: Math.round(this.camera.goal.yaw * 180 / Math.PI),
        pitch: Math.round(this.camera.goal.pitch * 180 / Math.PI),
        radius: Math.round(this.camera.goal.radius * 10) / 10,
      },
    };
  }

  destroy() {
    if (this._tooltip && this._tooltip.parentElement) {
      this._tooltip.parentElement.removeChild(this._tooltip);
    }
    this.app.destroy(true);
  }
}

function cellToPx(cam, p, cells) {
  return cam.project ? (p.scale * cells) : cells * 10;
}