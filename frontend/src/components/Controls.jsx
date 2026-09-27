import React, { useEffect, useRef, useState } from "react";
import { post } from "../api.js";

function Slider({ id, label, min, max, step = 1, value, fmt = String, onCommit }) {
  const [local, setLocal] = useState(value);
  const draggingRef = useRef(false);
  const timerRef = useRef(null);      // trailing-throttle for live commits
  const pendingRef = useRef(null);    // latest value waiting to be sent

  // sync from server unless the user is holding this slider
  useEffect(() => {
    if (!draggingRef.current) setLocal(value);
  }, [value]);

  // clear a pending live-commit on unmount
  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  // commit at most once every `ms` while dragging (trailing call sends the
  // latest value), so the sim reacts live instead of waiting for release
  const schedule = (v) => {
    pendingRef.current = v;
    if (timerRef.current) return;
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      const toSend = pendingRef.current;
      pendingRef.current = null;
      onCommit(toSend);
    }, 100);
  };
  // immediate commit (used on release / blur): flush any pending trailing call
  const flush = (v) => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    pendingRef.current = null;
    onCommit(v);
  };

  return (
    <div className="ctrl">
      <label htmlFor={id}>{label}</label>
      <span className="val" id={`${id}-val`}>{fmt(local)}</span>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={local}
        onInput={(e) => {
          const v = +e.target.value;
          setLocal(v);
          schedule(v); // responsive: apply live as the thumb moves
        }}
        onPointerDown={() => (draggingRef.current = true)}
        onPointerUp={(e) => {
          draggingRef.current = false;
          flush(+e.target.value);
        }}
        onBlur={(e) => {
          if (draggingRef.current) {
            draggingRef.current = false;
            flush(+e.target.value);
          }
        }}
      />
    </div>
  );
}

export default function Controls({ snap, running, speed, setRunning, setSpeed, send }) {
  const p = snap?.params || {};
  return (
    <div className="card">
      <h2>Controls</h2>
      <div className="btnrow">
        <button
          className={running ? "primary" : ""}
          onClick={() => setRunning(!running)}
        >
          {running ? "⏸ Pause" : "▶ Run"}
        </button>
        <button onClick={() => post("/api/step", { n: 1 }).catch(() => {})}>Step +1</button>
        <button onClick={() => post("/api/reset").catch(() => {})}>Reset</button>
        <button
          className="danger"
          onClick={() => {
            post("/api/spawn_wasp").catch(() => {});
            send({ wasp_count: Math.min(12, (p.wasp_count || 0) + 1) });
          }}
        >
          Release wasp
        </button>
        <button className="danger" onClick={() => post("/api/injure").catch(() => {})}>
          Injure a bee
        </button>
      </div>

      <Slider id="c-speed" label="Simulation speed" min={1} max={8} value={speed}
        fmt={(v) => v + "×"} onCommit={setSpeed} />
      <Slider id="c-nbees" label="Number of bees" min={10} max={200} step={5}
        value={p.n_bees ?? 50} fmt={(v) => v} onCommit={(v) => send({ n_bees: v })} />
      <Slider id="c-temp" label="Environment temperature (°C)" min={-10} max={45}
        value={p.temperature ?? 24} fmt={(v) => v} onCommit={(v) => send({ temperature: v })} />
      <Slider id="c-wasp" label="Wasp threats" min={0} max={12}
        value={p.wasp_count ?? 0} fmt={(v) => v} onCommit={(v) => send({ wasp_count: v })} />
      <Slider id="c-nreg" label="Nectar regrowth rate" min={0} max={0.2} step={0.01}
        value={p.nectar_regrowth ?? 0.04} fmt={(v) => (+v).toFixed(2)} onCommit={(v) => send({ nectar_regrowth: v })} />
      <Slider id="c-sense" label="Bee sensing radius" min={2} max={15}
        value={p.sense_radius ?? 6} fmt={(v) => v} onCommit={(v) => send({ sense_radius: v })} />
      <Slider id="c-maxbees" label="Colony max size" min={20} max={300} step={10}
        value={p.max_bees ?? 150} fmt={(v) => v} onCommit={(v) => send({ max_bees: v })} />
      <Slider id="c-larvae" label="Larvae maturation (days)" min={1} max={7}
        value={p.larvae_days ?? 2} fmt={(v) => v} onCommit={(v) => send({ larvae_days: v })} />

      <label className="chk">
        <input
          type="checkbox"
          checked={!!p.day_night}
          onChange={(e) => send({ day_night: e.target.checked })}
        />
        Auto day/night temperature cycle
      </label>
    </div>
  );
}