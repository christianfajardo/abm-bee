/* Procedural sprite textures for the 3D colony scene.
 * Art is drawn on offscreen 2D canvases and wrapped in PIXI textures, so
 * it needs no image files (works fully offline).
 */
import * as PIXI from "pixi.js";

function makeTex(w, h, draw) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const g = c.getContext("2d");
  draw(g, w, h);
  return PIXI.Texture.from(c);
}

function drawBeeBody(g, wasp) {
  // faces +x; art box 64x64, body centred ~(30,32)
  g.beginPath();
  g.moveTo(17, 32); g.lineTo(5, 30.5); g.lineTo(17, 35.5);
  g.closePath();
  g.fillStyle = wasp ? "#5a2d16" : "#4a3113";
  g.fill();
  const bodyFill = wasp ? "#3a2a20" : "#ffc84a";
  g.beginPath();
  g.ellipse(30, 32, 15, 9.5, 0, 0, Math.PI * 2);
  g.fillStyle = bodyFill;
  g.fill();
  g.lineWidth = 2;
  g.strokeStyle = wasp ? "#1f150f" : "#4a3113";
  g.stroke();
  g.save();
  g.beginPath();
  g.ellipse(30, 32, 15, 9.5, 0, 0, Math.PI * 2);
  g.clip();
  if (wasp) {
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
  g.beginPath();
  g.arc(46, 30, 6.5, 0, Math.PI * 2);
  g.fillStyle = wasp ? "#f2b13d" : "#4a3113";
  g.fill();
  g.beginPath();
  g.arc(47.5, 28, 1.7, 0, Math.PI * 2);
  g.fillStyle = "#fff";
  g.fill();
  g.strokeStyle = wasp ? "#3a2a20" : "#4a3113";
  g.lineWidth = 1.5;
  g.beginPath();
  g.moveTo(48, 24); g.lineTo(54, 17);
  g.moveTo(45, 23.5); g.lineTo(48, 16);
  g.stroke();
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

function makeQueenBody(g) {
  drawBeeBody(g, false);
  g.save();
  g.globalCompositeOperation = "source-atop";
  g.globalAlpha = 0.55;
  g.fillStyle = "#ffd75e";
  g.fillRect(0, 0, 64, 64);
  g.restore();
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
}

function makeFlowerBody(g) {
  for (let a = 0; a < 6; a++) {
    const ang = (a * Math.PI) / 3 + 0.3;
    const px = 32 + 17 * Math.cos(ang);
    const py = 32 + 17 * Math.sin(ang);
    g.save();
    g.translate(px, py);
    g.rotate(ang);
    g.beginPath();
    g.ellipse(0, 0, 14, 8.5, 0, 0, Math.PI * 2);
    g.fillStyle = "#2dd4bf";
    g.fill();
    g.lineWidth = 1.5;
    g.strokeStyle = "#0e7a6f";
    g.stroke();
    g.restore();
  }
  g.beginPath();
  g.arc(32, 32, 9.5, 0, Math.PI * 2);
  g.fillStyle = "#ffd166";
  g.fill();
  g.lineWidth = 1.5;
  g.strokeStyle = "#b7791f";
  g.stroke();
}

function makeNestBody(g) {
  g.save();
  g.beginPath();
  g.arc(64, 64, 58, 0, Math.PI * 2);
  g.clip();
  g.fillStyle = "#7a5420";
  g.fillRect(0, 0, 128, 128);
  const s = 12;
  const hw = Math.sqrt(3) * s;
  const vh = 1.5 * s;
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
  g.beginPath();
  g.arc(64, 64, 58, 0, Math.PI * 2);
  g.lineWidth = 6;
  g.strokeStyle = "#5a3d15";
  g.stroke();
}

function makeGroundBody(g, w, h) {
  g.fillStyle = "#101828";
  g.fillRect(0, 0, w, h);
  // subtle grid
  g.strokeStyle = "rgba(120,140,180,0.10)";
  g.lineWidth = 1;
  const step = w / 20;
  for (let i = 0; i <= 20; i++) {
    g.beginPath(); g.moveTo(i * step, 0); g.lineTo(i * step, h); g.stroke();
    g.beginPath(); g.moveTo(0, i * step); g.lineTo(w, i * step); g.stroke();
  }
}

function makeShadowBody(g) {
  const r = g.createRadialGradient(24, 24, 2, 24, 24, 22);
  r.addColorStop(0, "rgba(0,0,0,0.45)");
  r.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = r;
  g.beginPath();
  g.arc(24, 24, 22, 0, Math.PI * 2);
  g.fill();
}

function makeFloorBody(g, w, h) {
  // Soft "distance floor": solid checkerbase colour at the centre, fading
  // to transparent at the edge. Drawn in screen space under the grid so
  // the void beyond the world fades out instead of showing a hard
  // black horizon.
  const c = w / 2;
  const r = g.createRadialGradient(c, c, c * 0.05, c, c, c);
  r.addColorStop(0, "rgba(16,24,40,1)");     // 0x101828 = checker even-cell
  r.addColorStop(0.55, "rgba(16,24,40,0.9)");
  r.addColorStop(1, "rgba(16,24,40,0)");
  g.fillStyle = r;
  g.fillRect(0, 0, w, h);
}

function makeGlowBody(g, w, h) {
  // warm "stage light" radial glow, centred; additive-blended onto the ground
  // so the colony sits in a pool of light and its far side stays legible.
  const c = w / 2;
  const r = g.createRadialGradient(c, c, 4, c, c, c);
  r.addColorStop(0, "rgba(255,196,110,0.55)");
  r.addColorStop(0.35, "rgba(255,170,80,0.28)");
  r.addColorStop(0.7, "rgba(120,140,200,0.10)");
  r.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = r;
  g.fillRect(0, 0, w, h);
}

export function buildTextures() {
  return {
    bee: makeTex(64, 64, (g) => drawBeeBody(g, false)),
    wasp: makeTex(64, 64, (g) => drawBeeBody(g, true)),
    queen: makeTex(64, 64, makeQueenBody),
    wing: makeTex(48, 36, drawWings),
    flower: makeTex(256, 256, (g) => {
      // draw the 64px art box at 4x so the texture has real resolution
      // when zoomed in (a 64px tex upscaled to ~100-200px on screen looked
      // blocky; 256px stays crisp at any zoom)
      g.scale(4, 4);
      makeFlowerBody(g);
    }),
    nest: makeTex(128, 128, makeNestBody),
    ground: makeTex(512, 512, makeGroundBody),
    glow: makeTex(256, 256, makeGlowBody),
    shadow: makeTex(48, 48, makeShadowBody),
  };
}