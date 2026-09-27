import React, { useEffect, useRef } from "react";
import Plotly from "plotly.js-dist-min";

const LAYOUT = {
  paper_bgcolor: "rgba(0,0,0,0)",
  plot_bgcolor: "rgba(13,19,31,0.9)",
  font: { color: "#c9d4ea", size: 11 },
  margin: { l: 40, r: 10, t: 34, b: 28 },
  xaxis: { gridcolor: "#22304a", zeroline: false },
  yaxis: { gridcolor: "#22304a", zeroline: false },
  // no fixed layout height: the container div (CSS clamp) is the source of
  // truth so the charts stay responsive to window/panel resizes.
  showlegend: true,
  // fully responsive header/footer: title at the top of the paper; the
  // horizontal legend sits BELOW the plot and automargin grows the bottom
  // margin to fit it — no fixed, overlap-prone top margin.
  title: { font: { size: 13 }, x: 0, xanchor: "left" },
  legend: { orientation: "h", x: 0.5, xanchor: "center", y: 0, yanchor: "bottom", automargin: true },
};

export default function Charts({ snap }) {
  const popRef = useRef(null);
  const honeyRef = useRef(null);
  const ready = useRef(false);

  useEffect(() => {
    if (ready.current || !snap || !snap.history) return;
    const h = snap.history;
    if (!h.t || h.t.length < 2) return;
    ready.current = true;
    if (popRef.current) {
      Plotly.newPlot(
        popRef.current,
        [
          { x: h.t, y: h.population, name: "bees", type: "scatter", mode: "lines", line: { color: "#ffcf4d", width: 2 } },
          { x: h.t, y: h.foragers, name: "foragers", type: "scatter", mode: "lines", line: { color: "#ffb057", width: 1 } },
          { x: h.t, y: h.nurses, name: "nurses", type: "scatter", mode: "lines", line: { color: "#5ad18a", width: 1 } },
          { x: h.t, y: h.hibernating, name: "hibernating", type: "scatter", mode: "lines", line: { color: "#94a3b8", width: 1 } },
          { x: h.t, y: h.defending, name: "defending", type: "scatter", mode: "lines", line: { color: "#c084fc", width: 1 } },
        ],
        { ...LAYOUT, title: { ...LAYOUT.title, text: "Colony composition (rules 11/6/7)" } },
        { displayModeBar: false, responsive: true }
      );
    }
    if (honeyRef.current) {
      Plotly.newPlot(
        honeyRef.current,
        [
          { x: h.t, y: h.honey, name: "honey", type: "scatter", mode: "lines", line: { color: "#ffa94d", width: 2 }, fill: "tozeroy", fillcolor: "rgba(255,169,77,0.12)" },
          { x: h.t, y: h.rescues_total, name: "cumulative rescues", type: "scatter", mode: "lines", line: { color: "#7aa2ff", width: 1, dash: "dot" } },
        ],
        { ...LAYOUT, title: { ...LAYOUT.title, text: "Honey store (rules 2/10/12) & rescues (rule 1)" } },
        { displayModeBar: false, responsive: true }
      );
    }
  }, [snap]);

  useEffect(() => {
    if (!ready.current || !snap || !snap.history) return;
    const h = snap.history;
    if (!h.t || h.t.length < 2) return;
    if (popRef.current && popRef.current.data) {
      Plotly.react(
        popRef.current,
        popRef.current.data.map((d, i) => ({ ...d, x: h.t, y: [h.population, h.foragers, h.nurses, h.hibernating, h.defending][i] })),
        popRef.current.layout,
        { displayModeBar: false }
      );
    }
    if (honeyRef.current && honeyRef.current.data) {
      Plotly.react(
        honeyRef.current,
        honeyRef.current.data.map((d, i) => ({ ...d, x: h.t, y: [h.honey, h.rescues_total][i] })),
        honeyRef.current.layout,
        { displayModeBar: false }
      );
    }
  }, [snap]);

  // Responsive: Plotly's built-in `responsive` only tracks WINDOW resizes,
  // and it measures the container once at init — so CSS reflows (charts
  // 2-up -> 1-up at narrow widths, the row-height clamp, panel-width
  // changes) leave the SVG at its old size. Watch the containers and
  // re-fit Plotly whenever their box changes.
  useEffect(() => {
    const els = [popRef.current, honeyRef.current].filter(Boolean);
    if (!els.length) return;
    const ro = new ResizeObserver(() => {
      for (const el of els) {
        if (el && el._fullLayout) {
          Plotly.Plots.resize(el, el.clientWidth, el.clientHeight);
        }
      }
    });
    els.forEach((el) => ro.observe(el));
    return () => ro.disconnect();
  }, []);

  return (
    <div className="charts">
      <div className="chart" ref={popRef} />
      <div className="chart" ref={honeyRef} />
    </div>
  );
}