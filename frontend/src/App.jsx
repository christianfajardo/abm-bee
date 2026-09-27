import React, { useEffect, useRef, useState } from "react";
import { getState, getRules, post } from "./api.js";
import { Colony3D } from "./renderer/colony3d.js";
import Controls from "./components/Controls.jsx";
import StatsBar from "./components/StatsBar.jsx";
import RulesPanel from "./components/RulesPanel.jsx";
import Charts from "./components/Charts.jsx";
import { BUILD_STAMP } from "./buildStamp.js";

const DEFAULTS = {
  n_bees: 50, temperature: 24, day_night: false, wasp_count: 0,
  nectar_regrowth: 0.04, sense_radius: 6, max_bees: 150, larvae_days: 2,
};

export default function App() {
  const canvasRef = useRef(null);
  const rendererRef = useRef(null);
  const inflightRef = useRef(false);
  const runningRef = useRef(true);
  const speedRef = useRef(2);

  const [snap, setSnap] = useState(null);
  const [rules, setRules] = useState([]);
  const [running, setRunning] = useState(true);
  const [speed, setSpeed] = useState(2);
  const [hud, setHud] = useState(null);
  const [error, setError] = useState("");

  runningRef.current = running;
  speedRef.current = speed;

  /* Right column (Controls + Bee rules) pinned to the Colony card's height
     so BEE RULES stretches to fill the open space and its bottom edge aligns
     with the Colony frame's bottom edge. The Colony card's height is driven
     by the 3D canvas, which reflows on resize — so track it, not the window. */
  const leftColRef = useRef(null);
  const rightColRef = useRef(null);
  useEffect(() => {
    const pin = () => {
      const l = leftColRef.current, r = rightColRef.current;
      if (!l || !r) return;
      // single-column (mobile) layout: rules get their natural height
      if (window.matchMedia("(max-width: 1100px)").matches) {
        if (r.style.height) r.style.height = "";
        return;
      }
      const card = l.querySelector(".card");       // the Colony card itself
      const h = card ? card.getBoundingClientRect().height : 0;
      if (h > 0 && Math.abs((r.style.height ? parseFloat(r.style.height) : 0) - h) > 1) {
        r.style.height = h + "px";
      }
    };
    pin();
    const ro = new ResizeObserver(pin);
    if (leftColRef.current) ro.observe(leftColRef.current);
    if (rightColRef.current) ro.observe(rightColRef.current);
    const mq = window.matchMedia("(max-width: 1100px)");
    mq.addEventListener?.("change", pin);   // re-pin / un-pin on breakpoint
    return () => { ro.disconnect(); mq.removeEventListener?.("change", pin); };
  }, []);

  /* ------------------------------------------------- 3D renderer setup */
  useEffect(() => {
    const renderer = new Colony3D(canvasRef.current);
    rendererRef.current = renderer;
    window.__COLONY3D__ = renderer;   // test hook (E2E assertions)
    const wrap = canvasRef.current.parentElement;
    const doResize = () => {
      const w = wrap.clientWidth || 800;
      renderer.resize(w, w); // square stage
    };
    doResize();
    const ro = new ResizeObserver(doResize);
    ro.observe(wrap);
    const hudTimer = setInterval(() => setHud(renderer.stats()), 500);
    return () => {
      ro.disconnect();
      clearInterval(hudTimer);
      renderer.destroy();
    };
  }, []);

  /* -------------------------------------------------------- data loop */
  useEffect(() => {
    getRules().then(setRules).catch(() => {});
    let stopped = false;
    const tick = async () => {
      if (inflightRef.current) return;
      inflightRef.current = true;
      try {
        const s = await getState(runningRef.current, speedRef.current);
        if (stopped) return;
        rendererRef.current?.setSnapshot(s);
        setSnap(s);
        setError("");
      } catch (e) {
        if (!stopped) setError("backend error: " + e.message);
      } finally {
        inflightRef.current = false;
      }
      setTimeout(tick, 120);
    };
    tick();
    return () => { stopped = true; };
  }, []);

  const send = (body) => post("/api/set_params", body).catch(() => {});

  return (
    <>
      <StatsBar snap={snap} error={error} />
      <div id="alarmbar"><i style={{ width: `${Math.min(100, (snap?.alarm || 0) * 100)}%` }} /></div>
      <main>
        <div ref={leftColRef}>
          <div className="card">
            <h2>Colony (3D) — drag to rotate · wheel to zoom · shift/right-drag or pinch to pan · R resets the camera</h2>
            <div id="simwrap">
              <canvas ref={canvasRef} width={800} height={800} />
              {hud && (
                <div className="hud">
                  <div>bees {hud.bees} · wasps {hud.wasps} · flowers {hud.flowers} · {hud.fps} fps</div>
                  <div>camera yaw {hud.camera.yaw}° · pitch {hud.camera.pitch}° · dist {hud.camera.radius}</div>
                </div>
              )}
            </div>
            <div className="legend">
              <span><i style={{ background: "#ffcf4d" }} />forager</span>
              <span><i style={{ background: "#ffb057" }} />returning</span>
              <span><i style={{ background: "#ff8787" }} />injured</span>
              <span><i style={{ background: "#5ad18a" }} />nurse</span>
              <span><i style={{ background: "#7aa2ff" }} />rescuing</span>
              <span><i style={{ background: "#c084fc" }} />defending</span>
              <span><i style={{ background: "#94a3b8" }} />hibernating</span>
              <span><i style={{ background: "#2dd4bf" }} />flower</span>
              <span><i style={{ background: "#d9a441" }} />nest</span>
              <span><i style={{ background: "#ef4444" }} />wasp</span>
            </div>
          </div>
        </div>
        <div className="rightcol" ref={rightColRef}>
          <Controls
            snap={snap}
            running={running}
            speed={speed}
            setRunning={(v) => { setRunning(v); post("/api/running", { running: v }); }}
            setSpeed={setSpeed}
            send={send}
          />
          <RulesPanel rules={rules} snap={snap} />
        </div>
      </main>
      <section className="chartrow">
        <div className="card">
          <h2>Charts</h2>
          <Charts snap={snap} />
        </div>
      </section>
      <footer>
        {snap
          ? `day ${snap.step} · season nectar ${(snap.season * 100).toFixed(0)}% · state mix: ` +
            Object.entries(snap.state_counts).sort((a, b) => b[1] - a[1])
              .map(([k, v]) => `${k.toLowerCase()} ${v}`).join(" · ")
          : (error || "connecting…")}
        <span style={{ float: "right", opacity: 0.55 }} title="Frontend build timestamp — if it looks old, hard-refresh (Ctrl+Shift+R)">build {BUILD_STAMP}</span>
      </footer>
    </>
  );
}

export { DEFAULTS };