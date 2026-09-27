"""The bee-colony ABM built on Mesa.

Environment:
    - a 2D toroidal grid of flowers (finite nectar that regrows)
    - a central nest + queen
    - a temperature (manual or day/night cycling) that drives metabolism,
      flower regrowth and hibernation
    - a slow nectar "season" cycle
    - wasp predators that must be fought off

The colony's collective behaviour (division of labour, rescue cascades,
defence rings, hibernation, swarming) emerges from the local rules applied
by the individual bees - see RULES in rules.py.
"""

import math
import random

import mesa

from .agents import Bee, Flower, Queen, Wasp
from .rules import RULES

DAY_STEPS = 12          # model steps per "day"
SEASON_LENGTH = 240     # model steps per full nectar season
LARVAE_DAYS = 2         # days a larva takes to become a worker
HONEY_PER_DAY = 1.2     # baseline honey burned per day to feed the colony (r10)
HONEY_PER_DEG_COLD = 0.25   # extra honey/day per degree below 10C (r10)
SWARM_THRESHOLD = 1.35  # r13: bees-per-flower ratio that triggers swarming
SWARM_FRACTION = 0.35   # share of foragers that leave when swarming
SWARM_HONEY_MIN = 3.0   # min honey needed before the colony may swarm
SWARM_HONEY_TAKE = 0.5  # honey taken per swarming bee
FEED_ENERGY_GAIN = 0.40   # rule 2: energy a bee regains when depositing nectar

# rule 5: energy burned per step, by state (before temperature stress).
METABOLISM_BASE = {
    "FORAGING": 0.004, "RETURNING": 0.004, "NURSING": 0.0025,
    "RESCUING": 0.0035, "DEFENDING": 0.004, "RESTING": 0.0015,
}


class BeeColonyModel(mesa.Model):
    """A single, long-running colony the web app can step and inspect."""

    def __init__(self, width=40, height=40, nectar_patches=25,
                 max_bees=300, torus=True, seed=None, **params):
        super().__init__(seed=seed)
        self.grid = mesa.space.MultiGrid(width, height, torus)
        self.running = True
        self.torus = torus
        self.width = width
        self.height = height
        self.nectar_patches = nectar_patches
        self.max_bees_cap = max_bees
        self.torus = torus

        # ---- tunable parameters (settable from the UI at runtime) --------
        self.p = {
            "n_bees": 50,
            "temperature": 24.0,
            "day_night": False,
            "wasp_count": 0,
            "nectar_regrowth": 0.04,
            "sense_radius": 6,
            "max_bees": 150,
            "larvae_days": LARVAE_DAYS,
        }
        self.p.update({k: v for k, v in params.items() if k in self.p})

        # ---- constants used by agents --------------------------------------
        self.max_age = 200            # model steps a bee lives (~16 days)
        self.DAY_STEPS = DAY_STEPS

        # ---- environment state -------------------------------------------
        self.day_step = 0
        self.season_phase = 0.0          # radians around the season circle
        self.base_temp = self.p["temperature"]
        self.current_temp = self.base_temp

        # ---- colony state --------------------------------------------------
        self.nest_pos = (width // 2, height // 2)
        self.honey = 10.0
        self.larvae = []                 # [{"t": steps_left_as_larva}]
        self.swarm_events = []           # markers left by departing swarms
        self.alarm = 0.0                 # decaying alarm level (wasps present)
        self.rescues_total = 0
        self.nurse_tending = 0
        self.rule_step = {f"r{i+1:02d}": 0 for i in range(len(RULES))}

        # ---- history for the charts ----------------------------------------
        self.history = {
            "t": [], "honey": [], "population": [], "foragers": [],
            "nurses": [], "hibernating": [], "defending": [],
            "rescues": [], "rescues_total": [], "wasp_kills": 0,
        }

        self._setup()

    # ------------------------------------------------------------------ setup
    def _clear_agents(self):
        """Remove every agent from the grid and the model agent set."""
        for a in list(self.agents):
            try:
                self.grid.remove_agent(a)
            except Exception:
                pass
        self.agents.clear()

    def _setup(self):
        self._clear_agents()
        self.queen = None
        self.bees = []
        self.flowers = []
        self.wasps = []
        self.rule_step = {f"r{i+1:02d}": 0 for i in range(len(RULES))}
        self.swarm_events = []

        # nest
        self.queen = Queen(self, self.nest_pos)

        # bees around the nest (desynchronised ages -> gradual mortality)
        for _ in range(self.p["n_bees"]):
            age = int(self.random.random() * self.max_age * 0.6)
            self._spawn_bee(age)

        # flowers scattered (not on the nest)
        for _ in range(self.nectar_patches):
            x = self.random.randrange(self.width)
            y = self.random.randrange(self.height)
            if abs(x - self.nest_pos[0]) < 3 and abs(y - self.nest_pos[1]) < 3:
                continue
            f = Flower(self, (x, y), nectar=0.4 + 0.6 * self.random.random())
            self.flowers.append(f)

    def _spawn_bee(self, age=0):
        """Create a bee in the nest area, register it, and track it."""
        x = min(self.width - 1, max(0, self.nest_pos[0] + self.random.randint(-2, 2)))
        y = min(self.height - 1, max(0, self.nest_pos[1] + self.random.randint(-2, 2)))
        b = Bee(self, (x, y))
        b.age = age            # desynchronise lifespans
        self.bees.append(b)
        return b

    # -------------------------------------------------------------- lifecycle
    def kill_bee(self, bee, cause):
        """Remove a bee from the world and book its death."""
        if bee not in self.bees:
            return
        self.bees.remove(bee)
        try:
            self.grid.remove_agent(bee)
            self.agents.discard(bee)
        except (KeyError, ValueError):
            pass
        if cause == "wasp":
            self.history["wasp_kills"] += 1
        # a rescued bee that dies mid-rescue is simply gone; rescuers notice.

    def remove_wasp(self, wasp, by_bees=False):
        if wasp in self.wasps:
            self.wasps.remove(wasp)
        try:
            self.grid.remove_agent(wasp)
            self.agents.discard(wasp)
        except (KeyError, ValueError):
            pass
        if by_bees:
            self.rule_step["r07"] += 1

    # --------------------------------------------------------------- stepping
    def step(self):
        """Advance the simulation one model step."""
        self.rule_step = {k: 0 for k in self.rule_step}
        self.day_step += 1
        self.nurse_tending = 0
        self.alarm = max(0.0, self.alarm - 0.05)
        self.season_phase = (self.season_phase + 2 * math.pi / SEASON_LENGTH)

        # temperature (rule 6 reads current_temp)
        if self.p["day_night"]:
            # smooth day/night swing around base_temp, 8C amplitude
            self.current_temp = self.base_temp + 8.0 * math.sin(2 * math.pi * self.day_step / (2 * DAY_STEPS))
        else:
            self.current_temp = self.base_temp

        # rule 10: honey draft (feeding + heating)
        self._honey_draft()

        # rule 9: larvae -> workers (once per day)
        if self.day_step % DAY_STEPS == 0:
            self._age_larvae()

        # rule 13: swarming check (once per day)
        if self.day_step % DAY_STEPS == 0:
            self._maybe_swarm()

        # wasp population management (keep UI-requested count)
        self._manage_wasps()

        # the queen lays brood (rule 9) and the bees / wasps / flowers act
        self.queen.step()
        for b in list(self.bees):
            b.step()
        for w in list(self.wasps):
            w.step()
        for f in list(self.flowers):
            f.step()

        self._record()

    # ----------------------------------------------------------- environment
    def flower_temp_factor(self):
        """Flowers regrow best in the mid temperature band (rule 4 helper)."""
        t = self.current_temp
        if t < 5 or t > 40:
            return 0.0
        # peak around 26C
        return max(0.0, 1.0 - abs(t - 26.0) / 20.0)

    def season_factor(self):
        """Slow nectar season: ~1.0 in bloom, drops to ~0.15 in the lull."""
        return 0.55 + 0.45 * math.sin(self.season_phase)

    def metabolism_cost(self, state, temp):
        """Energy burned per step by temperature & activity (rule 5)."""
        c = METABOLISM_BASE.get(state, 0.004)
        # too cold or too hot burns more energy
        stress = 0.0
        if temp < 10.0:
            stress = (10.0 - temp) * 0.0004
        elif temp > 34.0:
            stress = (temp - 34.0) * 0.0004
        return c + stress

    # ------------------------------------------------------------ honey & brood
    def deposit_honey(self, bee):
        """Rule 2: a returning forager turns nectar into honey in the nest."""
        n = bee.nectar
        bee.nectar = 0.0
        self.honey += n * 0.90
        bee.energy = min(1.0, bee.energy + FEED_ENERGY_GAIN)
        self.rule_step["r02"] += 1

    def _honey_draft(self):
        """Rule 10: the nest consumes honey to feed and warm the colony."""
        draft = HONEY_PER_DAY / DAY_STEPS
        if self.current_temp < 10.0:
            draft += (10.0 - self.current_temp) * HONEY_PER_DEG_COLD / DAY_STEPS
        self.honey = max(0.0, self.honey - draft)
        self.rule_step["r10"] += 1

    def _age_larvae(self):
        """Rule 9 (continued): larvae mature into workers after LARVAE_DAYS."""
        for l in self.larvae:
            l["t"] -= 1
        matured = [l for l in self.larvae if l["t"] <= 0]
        self.larvae = [l for l in self.larvae if l["t"] > 0]
        cap = min(self.p["max_bees"], self.max_bees_cap)
        for _ in matured:
            if len(self.bees) < cap:
                self._spawn_bee()
                self.rule_step["r09"] += 1

    def _maybe_swarm(self):
        """Rule 13: a crowded, well-provisioned colony swarms a share of foragers."""
        if len(self.bees) < 20 or len(self.flowers) == 0:
            return
        if self.honey < SWARM_HONEY_MIN:
            return
        ratio = len(self.bees) / max(1, len(self.flowers))
        if ratio < SWARM_THRESHOLD:
            return
        foragers = [b for b in self.bees if b.state in ("FORAGING", "RETURNING", "RESTING")
                    and not b.injured and not b.is_nurse]
        if not foragers:
            return
        n = max(2, int(len(foragers) * SWARM_FRACTION))
        chosen = self.random.sample(foragers, n)
        # move the swarm to the nearest empty edge cell (they "fly out")
        ex, ey = self.nest_pos
        dx = 1 if self.random.random() < 0.5 else -1
        dy = 1 if self.random.random() < 0.5 else -1
        ex = (ex + dx * (self.width // 2)) % self.width
        ey = (ey + dy * (self.height // 2)) % self.height
        for b in chosen:
            try:
                self.grid.remove_agent(b)
            except Exception:
                pass
            self.bees.remove(b)
            self.agents.discard(b)
            self.honey = max(0.0, self.honey - SWARM_HONEY_TAKE)
        self.swarm_events.append({"pos": (ex, ey), "n": n, "step": self.day_step})
        self.rule_step["r13"] += 1

    # ------------------------------------------------------------------- wasps
    def _manage_wasps(self):
        """Keep the wasp population at the UI-requested count."""
        want = int(self.p["wasp_count"])
        while len(self.wasps) < want:
            self._spawn_wasp()
        while len(self.wasps) > want:
            self.remove_wasp(self.wasps[-1])
        # wasps that are defeated (hp<=0) are also removed in agents.step.

    def _spawn_wasp(self):
        x = self.random.randrange(self.width)
        y = self.random.randrange(self.height)
        w = Wasp(self, (x, y))
        self.wasps.append(w)
        self.alarm = 1.0

    # -------------------------------------------------------------- queries
    def population(self):
        return len(self.bees)

    def nearest_wasp(self, pos, radius=None):
        best, best_d = None, None
        for w in self.wasps:
            d = _dist(self, pos, w.pos)
            if radius is not None and d > radius:
                continue
            if best_d is None or d < best_d:
                best, best_d = w, d
        return best

    def nearest_injured_bee(self, bee):
        best, best_d = None, None
        for o in self.bees:
            if o is bee or o.health >= 0.90 or o.health <= 0:
                continue
            d = _dist(self, bee.pos, o.pos)
            if d > bee.model.sense_radius:
                continue
            if best_d is None or d < best_d:
                best, best_d = o, d
        return best

    def nearest_bee(self, pos):
        best, best_d = None, None
        for b in self.bees:
            d = _dist(self, pos, b.pos)
            if best_d is None or d < best_d:
                best, best_d = b, d
        return best

    # ------------------------------------------------------------- parameters
    @property
    def sense_radius(self):
        """Live sensing radius (driven by the UI)."""
        return self.p["sense_radius"]

    @property
    def nectar_regrowth(self):
        """Live nectar regrowth rate (driven by the UI)."""
        return self.p["nectar_regrowth"]

    @property
    def params(self):
        """Convenience alias for the live parameter dict (used by agents)."""
        return self.p

    def set_params(self, updates: dict):
        """Apply UI parameter changes safely (bee count, temperature, etc.)."""
        p = self.p
        if "n_bees" in updates:
            target = int(updates["n_bees"])
            target = max(5, min(target, self.max_bees_cap))
            while len(self.bees) < target:
                self._spawn_bee()
            while len(self.bees) > target:
                b = self.bees.pop()
                try:
                    self.grid.remove_agent(b)
                    self.agents.discard(b)
                except (KeyError, ValueError):
                    pass
            p["n_bees"] = target
        if "temperature" in updates:
            p["temperature"] = float(updates["temperature"])
            self.base_temp = p["temperature"]
        if "day_night" in updates:
            p["day_night"] = bool(updates["day_night"])
        if "wasp_count" in updates:
            p["wasp_count"] = max(0, min(12, int(updates["wasp_count"])))
        if "nectar_regrowth" in updates:
            p["nectar_regrowth"] = max(0.0, min(0.5, float(updates["nectar_regrowth"])))
        if "sense_radius" in updates:
            p["sense_radius"] = max(2, min(15, int(updates["sense_radius"])))
        if "max_bees" in updates:
            p["max_bees"] = max(10, min(int(updates["max_bees"]), self.max_bees_cap))
        if "larvae_days" in updates:
            p["larvae_days"] = max(1, min(7, int(updates["larvae_days"])))
        return self.get_params()

    def reset(self):
        """Rebuild the colony from scratch, keeping current UI parameters."""
        # reseed randomness so a reset is a fresh run
        self._setup()
        self.honey = 10.0
        self.larvae = []
        self.rescues_total = 0
        self.day_step = 0
        self.alarm = 0.0
        self.season_phase = 0.0
        self.rule_step = {f"r{i+1:02d}": 0 for i in range(len(RULES))}
        # fresh chart data
        self.history = {
            "t": [], "honey": [], "population": [], "foragers": [],
            "nurses": [], "hibernating": [], "defending": [],
            "rescues": [], "rescues_total": [], "wasp_kills": 0,
        }

    def get_params(self):
        return dict(self.p)

    # ------------------------------------------------------------------ data
    def state_counts(self):
        c = {}
        for b in self.bees:
            c[b.state] = c.get(b.state, 0) + 1
        return c

    def _record(self):
        sc = self.state_counts()
        h = self.history
        h["t"].append(self.day_step)
        h["honey"].append(round(self.honey, 2))
        h["population"].append(len(self.bees))
        h["foragers"].append(sc.get("FORAGING", 0) + sc.get("RETURNING", 0))
        h["nurses"].append(sc.get("NURSING", 0))
        h["hibernating"].append(sc.get("HIBERNATING", 0))
        h["defending"].append(sc.get("DEFENDING", 0))
        h["rescues"].append(self.rule_step["r01"])
        h["rescues_total"].append(self.rescues_total)
        # keep at most ~3000 points so the chart stays light
        # (only list series - "wasp_kills" is a running int counter)
        if len(h["t"]) > 3000:
            for k, v in list(h.items()):
                if isinstance(v, list):
                    h[k] = v[-3000:]

    def snapshot(self, with_positions=True):
        """JSON-serialisable view of the model for the web UI."""
        sc = self.state_counts()
        out = {
            "step": self.day_step,
            "temp": round(self.current_temp, 2),
            "honey": round(self.honey, 2),
            "population": len(self.bees),
            "state_counts": sc,
            "larvae": len(self.larvae),
            "rescues_total": self.rescues_total,
            "wasp_kills": self.history["wasp_kills"],
            "alarm": round(self.alarm, 3),
            "season": round(self.season_factor(), 3),
            "rule_step": dict(self.rule_step),
            "swarm_events": [
                {"pos": list(s["pos"]), "n": s["n"], "step": s["step"]}
                for s in self.swarm_events[-10:]
            ],
            "params": self.get_params(),
            "nest": list(self.nest_pos),
            "grid": [self.width, self.height],
        }
        if with_positions:
            bees = [{"x": b.pos[0], "y": b.pos[1], "st": b.state,
                     "h": round(b.health, 2), "e": round(b.energy, 2)}
                    for b in self.bees]
            out["bees"] = bees
            out["flowers"] = [{"x": f.pos[0], "y": f.pos[1],
                               "n": round(f.nectar, 2)} for f in self.flowers]
            out["wasps"] = [{"x": w.pos[0], "y": w.pos[1]} for w in self.wasps]
        # trim history to the last 500 points for the wire
        h = self.history
        out["history"] = {
            "t": h["t"][-500:], "honey": h["honey"][-500:],
            "population": h["population"][-500:],
            "foragers": h["foragers"][-500:],
            "nurses": h["nurses"][-500:],
            "hibernating": h["hibernating"][-500:],
            "defending": h["defending"][-500:],
            "rescues_total": h["rescues_total"][-500:],
        }
        return out


def _dist(model, a, b):
    dx = abs(a[0] - b[0])
    dy = abs(a[1] - b[1])
    if model.torus:
        dx = min(dx, model.grid.width - dx)
        dy = min(dy, model.grid.height - dy)
    return math.hypot(dx, dy)