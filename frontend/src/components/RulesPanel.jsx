import React, { useMemo, useState } from "react";

export default function RulesPanel({ rules, snap }) {
  const [open, setOpen] = useState(true);
  const ruleStep = snap?.rule_step || {};
  const rows = useMemo(
    () => rules.map((r) => ({ ...r, n: ruleStep[r.id] || 0 })),
    [rules, ruleStep]
  );
  return (
    <div className="card rulescard">
      <h2 style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span>
          Bee rules{" "}
          <span style={{ textTransform: "none", color: "var(--muted)", fontWeight: 400 }}>
            (live fire counter)
          </span>
        </span>
        <button style={{ padding: "2px 10px" }} onClick={() => setOpen(!open)}>
          {open ? "hide" : "show"}
        </button>
      </h2>
      {open && (
        <div id="rules">
          {rows.map((r) => {
            const num = parseInt(r.id.slice(1), 10);
            return (
              <div key={r.id} className={"rule" + (r.n > 0 ? " hot" : "")}>
                <div className="rt">
                  <span>
                    <span className="rn">#{num}</span> {r.title}
                  </span>
                  <span className="cnt">{r.n}{r.n > 0 ? " /step" : ""}</span>
                </div>
                <div className="ct">{r.text}</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}