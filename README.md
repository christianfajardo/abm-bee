# 🐝 Bee Colony: An ABM Classic Use Case

A simple but expressive agent-based model (ABM) of a bee colony, built on the
[Mesa](https://mesa.readthedocs.io) package, with an interactive web UI.

The colony's collective behavior — division of labor, rescue cascades,
defense rings, hibernation, and even swarming — **emerges** from the local
rules each individual bee follows. No agent knows the "colony"; the colony
is what you see when you zoom out.

The web UI renders the colony with **PixiJS** (WebGL) — real bee, wasp,
queen, flower and nest sprites (striped bodies, flapping wings, a honeycomb
nest) — with an automatic 2D-canvas fallback if WebGL is unavailable.

> **Scope / intent.** This is a deliberately **simple HTML/JS proof-of-concept**
> (a single FastAPI process + one static page + vendored libraries). The point
> is to make agent-based modeling *concrete and tinkerable*, **not** to be a
> production or "best-practice" codebase. Readability and easy knobs beat
> architectural polish here.

## Background: the classic ABM thought experiments

Agent-based modeling studies how **emergent** large-scale patterns arise
from simple local rules followed by many small
[agents](https://en.wikipedia.org/wiki/Agent-based_model) — no one designs the
pattern, it shows up when you zoom out (see
[emergence](https://en.wikipedia.org/wiki/Emergence)). The discipline grew out
of the [Santa Fe Institute](https://en.wikipedia.org/wiki/Santa_Fe_Institute)'s
[artificial life](https://en.wikipedia.org/wiki/Artificial_life) work and the
broader study of [self-organization](https://en.wikipedia.org/wiki/Self-organization)
in [complex systems](https://en.wikipedia.org/wiki/Complex_system). A few
canonical toy models make the idea click, and each is one of the "classic use
cases" the bee colony belongs to:

- **Graph paper — cellular automata.** The oldest ABM is a grid of cells drawn
  on [graph paper](https://en.wikipedia.org/wiki/Cellular_automaton) that update
  by a rule depending only on their neighbours ([von
  Neumann](https://en.wikipedia.org/wiki/Von_Neumann_neighborhood) or [Moore
  neighborhood](https://en.wikipedia.org/wiki/Moore_neighborhood)). Conway's
  Game of Life shows gliders, glider guns and computation emerging from a
  single rule. The bee colony is the same idea, but the cells are *agents that
  move and act* rather than flip.
- **Tossing a coin — randomness as the engine.** Many ABMs run on a coin flip:
  [coin flipping](https://en.wikipedia.org/wiki/Coin_flipping) drives a
  [random walk](https://en.wikipedia.org/wiki/Random_walk), and the
  [Galton board](https://en.wikipedia.org/wiki/Galton_board) shows a
  deterministic bell curve *emerging* from pure chance. Our bees pick flowers
  and collapse with a probability each step — the same mechanism.
- **The nickel/dime "neighborhood" experiment.** A hands-on classroom version of
  [Schelling's model of segregation](https://en.wikipedia.org/wiki/Schelling%27s_model_of_segregation):
  lay two kinds of coins (nickels and dimes) on a checkerboard, let each "agent"
  move only if its local [neighborhood](https://en.wikipedia.org/wiki/Moore_neighborhood)
  is "comfortable," and mild individual preferences self-organize into fully
  segregated blocks (see [residential segregation](https://en.wikipedia.org/wiki/Residential_segregation)
  and [Thomas Schelling](https://en.wikipedia.org/wiki/Thomas_Schelling)). It's
  the canonical demo that *local* tolerance produces *global* order.
- **And the rest of the family.** Foraging/transport, epidemic spread, market
  traders, and traffic are all built the same way: many small agents + local
  rules + a bit of noise, then watch the [swarm](https://en.wikipedia.org/wiki/Swarm_intelligence)
  level.

### What this project adds: the **bee colony** use case

This demo is the **bee-colony** member of that classic family — the
[colony-optimization](https://en.wikipedia.org/wiki/Bees_algorithm) archetype.
The natural behavior it's modeling was worked out largely by **Karl von
Frisch** (Nobel Prize in Medicine, 1973), who decoded the
[waggle dance](https://en.wikipedia.org/wiki/Waggle_dance) and the division of
labor in the [honey bee](https://en.wikipedia.org/wiki/Honey_bee) colony, and
who founded the field of [swarm
intelligence](https://en.wikipedia.org/wiki/Swarm_intelligence). The model
mirrors his findings: foragers vs. nurses, alarm/defense responses, honey as a
shared resource, and [swarming](https://en.wikipedia.org/wiki/Swarm_intelligence)
to found new colonies. (See also
[K. von Frisch's biography](https://en.wikipedia.org/wiki/Karl_von_Frisch).)

## Run it

**Prerequisites:** [Docker](https://docs.docker.com/get-docker/) and a web
browser. That's it — Python, the model, and the web UI all live inside the
image; you don't install anything else.

```bash
cd abm-bee
docker build -t bee-colony .          # 1. build the image (first time only)
docker run --rm -p 8550:8550 bee-colony   # 2. start it
```

> The trailing `.` on the `docker build` line is **required**, not a typo —
> it's the build context, i.e. "build from this folder." Omit it and you'll
> get `requires 1 argument`.

Open **http://localhost:8550** in your browser. That's the whole setup — the
colony is already running and animating.

**What you'll see:** a live **3D colony** — bees, wasps and the honeycomb
nest rendered as real sprites in an orbiting 3D view (PixiJS with a
hand-rolled perspective camera + spring physics for smooth flight) — plus
charts, the 13 rules with per-step fire counters, and controls for bee
count, temperature, wasps, nectar regrowth, sensing radius, colony size,
larvae maturation, speed, and pause/step/reset.

**Camera (3D view):** drag to **rotate** (orbit) · scroll wheel to
**zoom** · right-drag or shift-drag (or two-finger drag) to **pan** ·
`R` resets the camera. A HUD shows fps + camera angles.

Things to try: dragging **Number of bees** (the queen maintains the
setpoint), dropping **Temperature** below 10 °C (hibernation), hitting
**Release wasp** (defense ring), and **Injure a bee** (rescue cascade).

**Notes**

- The web UI is a **Vite + React SPA** (in `frontend/`), rendered with
  PixiJS. It's built at dev time (`cd frontend && npm run build`) and the
  `dist/` output is baked into the Docker image — so `docker build` needs
  no Node.js. Plotly.js and PixiJS ship inside the bundle; the page works
  offline.
- Stop it with `Ctrl+C` (the `--rm` flag removes the container on exit).
- Prefer running without Docker? `pip install -r requirements.txt`, then
  `cd frontend && npm install && npm run build`, then `python -m app.main` —
  same URL.

## What to control (all live, from the UI)

| Control | Effect |
| --- | --- |
| Number of bees | spawn/remove workers (10–200) |
| Temperature | drives metabolism, flower regrowth, hibernation/hot slowdown |
| Day/night cycle | auto-swing the temperature over the day |
| Wasp threats | number of predator wasps; "Release wasp" adds one |
| Nectar regrowth | how fast flowers recover |
| Sensing radius | how far a bee can "see" neighbours / flowers |
| Colony max size | upper bound the queen will fill the colony to |
| Larvae maturation | days from egg to worker |
| Speed / Step / Reset | drive the clock |
| Injure a bee | manually knock a bee below the injury threshold (watch rule 1) |

## The 13 rules (shown live in the UI)

1. **Help the injured** – a bee that sees an injured neighbour stops and
   helps it until it recovers.
2. **Make honey** – a bee returning from a nectar harvest converts its
   nectar into honey at the nest.
3. **Forage** – idle workers head to the nearest flower with nectar.
4. **Nectar economy** – harvesting drains flowers; they regrow over time.
5. **Metabolism & fatigue** – energy burns each step (more when very cold/hot);
   exhausted bees die or collapse.
6. **Thermoregulation** – cold → hibernate at the nest; hot → slow down.
7. **Defence** – bees that spot a wasp raise the alarm and form a defense ring.
8. **Rescue quota** – a bee rescues at most 2 bees, then returns to work.
9. **Queen & eggs** – the queen lays eggs when honey and temperature allow.
10. **Honey draft** – the nest burns honey to feed and warm the brood.
11. **Aging & senescence** – old bees become nurses, then die of old age.
12. **Nectar season** – a slow seasonal cycle periodically lowers nectar.
13. **Swarming** – a crowded, well-provisioned colony sends a share of
    foragers off with honey to found a new colony.

## What to look for (emergence cues)

- **Division of labor:** watch the forager / nurse / hibernating lines on the
  left chart. As bees age (rule 11) the nurse line rises while foragers fall.
- **Rescue cascades:** hit **Injure a bee** with a few foragers around and
  watch the "rescues" counter and the red ringed bee being tended (rule 1).
- **Defense rings:** raise **Wasp threats** — bees turn purple (defending),
  the alarm bar spikes, and wasp kills tick up (rule 7).
- **Hibernation:** drag **Temperature** below ~10 °C and the colony clusters
  at the nest; the "hibernating" line rises (rule 6).
- **Honey seasonality:** the honey line dips through the low-nectar part of
  the season and the queen stops laying during the lull (rules 10, 12).
- **Swarming:** with many bees and few flowers, a dashed circle appears where
    a swarm departed (rule 13).

## Project layout

```
abm-bee/
├── requirements.txt
├── Dockerfile           # self-contained image (deps + model + web UI)
├── .dockerignore
├── README.md
├── bee_colony/
│   ├── __init__.py
│   ├── agents.py        # Bee, Queen, Flower, Wasp (each with its rules)
│   ├── model.py         # BeeColonyModel: grid, environment, orchestration
│   └── rules.py         # the 13 human-readable rules (shown in the UI)
└── app/
    ├── main.py          # FastAPI: state/step/params/reset + serves the built SPA
    └── static/          # (legacy vanilla UI, kept for reference)
├── frontend/            # Vite + React app (the current UI)
│   ├── package.json
│   ├── vite.config.js   # base:'./' so FastAPI can serve dist/ at /
│   ├── index.html
│   └── src/
│       ├── main.jsx / App.jsx / api.js / styles.css
│       ├── components/   # StatsBar, Controls, RulesPanel, Charts
│       └── renderer/     # camera3d.js (perspective orbit camera),
│                         # art.js (procedural sprite textures),
│                         # colony3d.js (3D scene, spring physics, depth sort)
└── tests/               # headless E2E tests (puppeteer + SwiftShader WebGL)
```

## Notes & knobs

- Rendering: the 3D colony view is PixiJS (WebGL) with a hand-rolled
  perspective orbit camera — real 3D positions projected to the 2D canvas,
  depth-sorted (painter's algorithm), with spring-damped movement and soft
  separation physics so bees glide instead of teleporting. No 3D scene
  library is used; the technique is "2.5D billboards" (the standard way to do
  3D in Pixi).
- The model runs on a toroidal (wrap-around) `MultiGrid` so edges are not
  boundaries.
- The simulation is a single long-running process; the browser drives the
  clock by polling `/api/state?step=true&speed=N` while "running".
- All rule constants live in `bee_colony/agents.py` (top of file) and
  `bee_colony/model.py` — tweak them to explore different colony personalities.

## Testing

Headless E2E tests (real Chromium + SwiftShader software WebGL, load the
live page, assert real behavior):

```bash
cd abm-bee/tests
npm install --no-audit --no-fund   # puppeteer-core + @napi-rs/canvas
node pixi3d_e2e.mjs                # 3D UI: React mount, camera orbit/zoom/pan,
                                   # physics motion, depth sort, no JS errors
node slider_e2e.mjs                # controls: slider drag applies to the server
node pixi_e2e.mjs                  # (legacy) flat canvas UI pixel checks
```

`pixi3d_e2e.mjs` verifies: React mounted, the 3D renderer populated from the
live API, canvas sized, camera rotate/zoom/pan (lerp converges), a real
pointer-drag on the canvas orbits the camera, physics moves bees over
simulated time, the rAF ticker runs, sprites are depth-sorted (distinct
zIndex), and there are no page JS errors or unexpected 404s.