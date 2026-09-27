/* Thin API client — same-origin (FastAPI serves the SPA and /api together). */
const j = (r) => {
  if (!r.ok) throw new Error(`${r.url} -> ${r.status}`);
  return r.json();
};

export const getState = (step, speed = 1) =>
  fetch(`/api/state?step=${step ? "true" : "false"}&speed=${speed}`).then(j);

export const getRules = () => fetch("/api/rules").then(j);

export const post = (path, body) =>
  fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  }).then(j);