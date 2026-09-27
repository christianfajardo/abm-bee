/* Minimal perspective camera for rendering a 3D world in PixiJS 2D.
 *
 * World space: grid cells in x/y, height in z. The camera is an orbit
 * rig: yaw/pitch around the world origin at a given radius, with a pan
 * offset (world-space point the camera looks at) and fov for zoom.
 *
 * We don't build a full 3D engine — we project each 3D point to screen
 * coordinates and draw sprites at those positions, depth-sorted. That's
 * the standard "2.5D" technique for Pixi scenes and is fast for a few
 * hundred sprites.
 */
const RAD2DEG = 180 / Math.PI;
const DEG2RAD = Math.PI / 180;

export class Camera3D {
  constructor(viewW, viewH) {
    this.viewW = viewW;
    this.viewH = viewH;
    // orbit params
    this.yaw = 45 * DEG2RAD;      // horizontal angle around the world
    this.pitch = 55 * DEG2RAD;    // vertical angle (0=top-down, 90=horizon)
    this.radius = 55;             // distance from target (world units)
    this.target = { x: 20, y: 20, z: 0 }; // world point the camera looks at
    this.fov = 45 * DEG2RAD;
    this.near = 0.5;
    this.far = 500;
    // world bounds for the camera target (panning never leaves the colony
    // area - clamped in pan()/nudgeTarget()/frame()). Updated by the
    // renderer from the snapshot (grid [w, h]); defaults match the grid.
    this.bounds = { minX: 0, maxX: 40, minY: 0, maxY: 40 };

    // smooth (displayed) vs. goal values — the renderer lerps toward goals
    // each frame for buttery orbit/zoom/pan, even though input arrives in
    // discrete events.
    this.cur = this._snapshot();
    this.goal = this._snapshot();
  }

  _snapshot() {
    return {
      yaw: this.yaw, pitch: this.pitch, radius: this.radius,
      fov: this.fov, tx: this.target.x, ty: this.target.y, tz: this.target.z,
    };
  }

  resize(w, h) {
    this.viewW = w; this.viewH = h;
  }

  /* Keep the look-at point inside the world so panning can never fly the
   * camera off into the void (black background). */
  clampTarget() {
    const b = this.bounds;
    this.goal.tx = Math.min(b.maxX, Math.max(b.minX, this.goal.tx));
    this.goal.ty = Math.min(b.maxY, Math.max(b.minY, this.goal.ty));
  }

  /* ---- input: mutate the GOAL state; render() chases it ----------------- */
  rotate(dYaw, dPitch) {
    this.goal.yaw += dYaw;
    this.goal.pitch = Math.min(89 * DEG2RAD, Math.max(12 * DEG2RAD, this.goal.pitch + dPitch));
  }
  zoom(delta) { // wheel: + = zoom out
    this.goal.radius = Math.min(160, Math.max(10, this.goal.radius * Math.exp(delta * 0.001)));
  }
  pan(screenDX, screenDY) {
    // move the look-at point so the world follows the cursor. Convert
    // screen pixels to world units via the camera's right & up vectors.
    const r = this._rays();
    const worldPerPixel = this.goal.radius / (this.viewH * 0.5 / Math.tan(this.goal.fov * 0.5));
    this.goal.tx += (r.rightX * -screenDX + r.upX * screenDY) * worldPerPixel;
    this.goal.ty += (r.rightY * -screenDX + r.upY * screenDY) * worldPerPixel;
    // keep target on the ground and inside the world
    this.goal.tz = 0;
    this.clampTarget();
  }
  nudgeTarget(dx, dy) { // keyboard nudge (world units)
    this.goal.tx += dx; this.goal.ty += dy;
    this.clampTarget();
  }
  reset() {
    this.goal.yaw = 45 * DEG2RAD;
    this.goal.pitch = 55 * DEG2RAD;
    this.goal.radius = 55;
    this.goal.tx = 20; this.goal.ty = 20; this.goal.tz = 0;
  }
  frame(dt) {
    // exponential smoothing toward goal (framerate-independent)
    const k = 1 - Math.exp(-dt * 10);
    const c = this.cur, g = this.goal;
    c.yaw += (g.yaw - c.yaw) * k;
    c.pitch += (g.pitch - c.pitch) * k;
    c.radius += (g.radius - c.radius) * k;
    c.fov += (g.fov - c.fov) * k;
    c.tx += (g.tx - c.tx) * k;
    c.ty += (g.ty - c.ty) * k;
    c.tz += (g.tz - c.tz) * k;
    // clamp the *displayed* target too: the goal is always inside bounds,
    // but the lerp path can pass outside while recovering (e.g. after a
    // reset from a stale far-off position).
    const b = this.bounds;
    c.tx = Math.min(b.maxX, Math.max(b.minX, c.tx));
    c.ty = Math.min(b.maxY, Math.max(b.minY, c.ty));
  }

  _rays() {
    const c = this.cur;
    const cp = Math.cos(c.pitch), sp = Math.sin(c.pitch);
    const cy = Math.cos(c.yaw), sy = Math.sin(c.yaw);
    // camera position
    const camX = c.tx + c.radius * cp * sy;
    const camY = c.ty + c.radius * cp * cy;
    const camZ = c.tz + c.radius * sp;
    // forward = target - cam (normalized)
    let fx = c.tx - camX, fy = c.ty - camY, fz = c.tz - camZ;
    const fl = Math.hypot(fx, fy, fz); fx /= fl; fy /= fl; fz /= fl;
    // up-ish
    const upX = 0, upY = 0, upZ = 1;
    // right = f x up
    let rx = fy * upZ - fz * upY, ry = fz * upX - fx * upZ, rz = fx * upY - fy * upX;
    const rl = Math.hypot(rx, ry, rz); rx /= rl; ry /= rl; rz /= rl;
    // true up = right x f
    const ux = ry * fz - rz * fy, uy = rz * fx - rx * fz, uz = rx * fy - ry * fx;
    return {
      cam: { x: camX, y: camY, z: camZ },
      fwd: { x: fx, y: fy, z: fz },
      right: { x: rx, y: ry, z: rz },
      up: { x: ux, y: uy, z: uz },
      rightX: rx, rightY: ry, upX: ux, upY: uy,
    };
  }

  /* Project a world point (x,y,z) to screen {x, y, depth, scale}. */
  project(p) {
    const c = this.cur;
    const r = this._rays();
    const dx = p.x - r.cam.x, dy = p.y - r.cam.y, dz = p.z - r.cam.z;
    const zc = dx * r.fwd.x + dy * r.fwd.y + dz * r.fwd.z; // depth along forward
    if (zc < this.near) return null; // behind camera
    const xc = dx * r.right.x + dy * r.right.y + dz * r.right.z;
    const yc = dx * r.up.x + dy * r.up.y + dz * r.up.z;
    const f = this.viewH * 0.5 / Math.tan(c.fov * 0.5);
    const sx = this.viewW * 0.5 + (xc / zc) * f;
    const sy = this.viewH * 0.5 - (yc / zc) * f;
    // scale for sprite size: world units -> screen px
    const scale = f / zc;
    return { x: sx, y: sy, depth: zc, scale };
  }
}

export { RAD2DEG, DEG2RAD };