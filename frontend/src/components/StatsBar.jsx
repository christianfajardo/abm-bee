import React from "react";

function Stat({ v, label, fmt = (x) => x }) {
  return (
    <div className="s">
      <b>{v == null ? "–" : fmt(v)}</b>
      <span>{label}</span>
    </div>
  );
}

export default function StatsBar({ snap, error }) {
  return (
    <header>
      <h1>🐝 Bee Colony: An ABM Classic Use Case</h1>
      <div className="sub">agent-based model · mesa · emergent colony behavior · 3D</div>
      <div className="stat">
        <Stat v={snap?.step} label="day" />
        <Stat v={snap?.temp} label="temp °C" fmt={(x) => x.toFixed(1)} />
        <Stat v={snap?.honey} label="honey" fmt={(x) => x.toFixed(1)} />
        <Stat v={snap?.population} label="bees" />
        <Stat v={snap?.larvae} label="larvae" />
        <Stat v={snap?.rescues_total} label="rescues" />
        <Stat v={snap?.wasp_kills} label="wasp kills" />
      </div>
    </header>
  );
}