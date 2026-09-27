"""Agent definitions for the bee-colony ABM.

Bee states:
    FORAGING     - seeking / travelling to flowers          (rule 3)
    RETURNING    - carrying nectar back to the nest         (rule 2 on arrival)
    NURSING      - older bees tending the brood at the nest (rule 11)
    RESCUING     - helping an injured bee                   (rules 1 + 8)
    DEFENDING    - attacking / herding wasps                (rule 7)
    HIBERNATING  - clustered at the nest, low metabolism    (rule 6)
    RESTING      - idle at the nest
"""

import math
from mesa import Agent

# ---------------------------------------------------------------------------
# Tunables (also surfaced / used by the model)
# ---------------------------------------------------------------------------
INJURED_BELOW = 0.90        # health strictly below this counts as "injured"
RESCUE_DONE = 0.92          # victim considered recovered at/above this
HEAL_RATE = 0.06            # health restored per step while being helped
RESCUE_ENERGY = 0.10        # energy restored to the victim per step
MAX_RESCUES_PER_BEE = 2     # rule 8: a bee only helps this many bees
NECTAR_TAKE = 0.5           # max nectar a bee can carry from one flower
HONEY_CONVERSION = 0.90     # rule 2: share of nectar converted to honey
FEED_ENERGY_GAIN = 0.35     # energy gained when nectar is deposited
OLD_FRACTION = 0.70         # rule 11: becomes a nurse after 70% of lifespan
EXHAUSTION_INJURY_CHANCE = 0.03  # rule 5: tired bees sometimes collapse
COLD_THRESHOLD = 10.0       # rule 6: below this the colony hibernates
HOT_THRESHOLD = 34.0        # rule 6: above this foraging is hampered
WASP_ATTACK_DAMAGE = 0.45   # rule 7: defender damage to wasp per step
WASP_STING_CHANCE = 0.25    # rule 7: chance a defender gets stung while close
WASP_STING_DAMAGE = 0.25
WASP_KILL_CHANCE = 0.35     # rule 7: chance a wasp's hit kills vs. only injures
NATURAL_HEAL = 0.005        # slow self-repair when not under attack
QUEEN_LAY_CAP = 20          # rule 9: max eggs/day (tracks the n_bees setpoint)
QUEEN_LAY_DIVISOR = 3       # rule 9: eggs/day ~= deficit // this
EGG_HONEY_COST = 0.6        # rule 9/10: honey spent per egg laid


class Bee(Agent):
    """A worker bee of the colony."""

    def __init__(self, model, pos, state="FORAGING"):
        super().__init__(model.next_id(), model)
        self.state = state
        self.energy = 1.0
        self.health = 1.0
        self.nectar = 0.0
        self.age = 0
        self.max_age = model.max_age
        self.rescue_count = 0
        self.timer = 0
        self.target = None           # flower currently heading to
        self.rescue_victim = None
        self.model.grid.place_agent(self, pos)

    # ------------------------------------------------------------------ utils
    @property
    def injured(self):
        return self.health < INJURED_BELOW

    @property
    def is_nurse(self):
        return self.age >= self.max_age * OLD_FRACTION

    def dist(self, pos):
        g = self.model.grid
        dx = abs(self.pos[0] - pos[0])
        dy = abs(self.pos[1] - pos[1])
        if self.model.torus:
            dx = min(dx, g.width - dx)
            dy = min(dy, g.height - dy)
        return math.hypot(dx, dy)

    def at_nest(self):
        return self.dist(self.model.nest_pos) <= 1.5

    def _resume_state(self):
        return "NURSING" if self.is_nurse else "FORAGING"

    def _move_one_toward(self, pos, skip_chance=0.0):
        """Move one grid cell towards `pos` (torus-aware). May skip (injured)."""
        if self.model.random.random() < skip_chance:
            return
        x, y = self.pos
        tx, ty = pos
        dx = tx - x
        dy = ty - y
        g = self.model.grid
        if self.model.torus:
            if dx > g.width // 2:
                dx -= g.width
            elif dx < -g.width // 2:
                dx += g.width
            if dy > g.height // 2:
                dy -= g.height
            elif dy < -g.height // 2:
                dy += g.height
        sx = (dx > 0) - (dx < 0)
        sy = (dy > 0) - (dy < 0)
        nx, ny = x + sx, y + sy
        self.model.grid.move_agent(self, (nx, ny))

    # -------------------------------------------------------------------- step
    def step(self):
        m = self.model
        self.age += 1

        # -- rule 11: senescence ------------------------------------------
        if self.age >= self.max_age:
            m.kill_bee(self, "old_age")
            return
        if self.state != "NURSING" and self.is_nurse:
            self.state = "NURSING"
            m.rule_step["r11"] += 1

        # slow self-repair when out of the fight (rescue stays much faster)
        if self.state != "DEFENDING" and self.health < 1.0:
            self.health = min(1.0, self.health + NATURAL_HEAL)

        # -- rule 7: wasp defence ------------------------------------------
        wasp = m.nearest_wasp(self.pos, radius=self.model.sense_radius)
        if wasp is not None and self.state != "RESCUING":
            self.state = "DEFENDING"
            self._defend_step(wasp)
            return
        if self.state == "DEFENDING":
            self.state = self._resume_state()

        # -- rule 6: thermoregulation --------------------------------------
        temp = m.current_temp
        if temp < COLD_THRESHOLD:
            self.state = "HIBERNATING"
        elif self.state == "HIBERNATING":
            self.state = self._resume_state()
        if self.state == "HIBERNATING":
            self.energy -= 0.0015  # clustered hibernation is metabolically cheap
            if self.energy <= 0:
                m.kill_bee(self, "starvation")
                return
            self._move_one_toward(m.nest_pos)
            m.rule_step["r06"] += 1
            return

        # -- rule 1: rescue an injured neighbour -----------------------------
        if self.state in ("FORAGING", "RESTING"):
            if self.rescue_count < MAX_RESCUES_PER_BEE:
                victim = m.nearest_injured_bee(self)
                if victim is not None:
                    self.state = "RESCUING"
                    self.rescue_victim = victim
        if self.state == "RESCUING":
            self._rescue_step()
            return

        # -- rule 5: metabolism ----------------------------------------------
        self.energy -= m.metabolism_cost(self.state, temp)
        if self.state == "NURSING":
            m.rule_step["r11"] += 1
            self._move_one_toward(m.nest_pos)
            if self.at_nest():
                m.nurse_tending += 1
            return
        if self.energy <= 0:
            m.kill_bee(self, "starvation")
            return
        if self.energy < 0.18:
            # starving: head home to feed
            self.state = "RESTING"
            self.timer = 3
        if self.energy < 0.12 and m.random.random() < EXHAUSTION_INJURY_CHANCE:
            self.health = 0.6  # collapsed from exhaustion -> now "injured"

        # -- resting / hot-weather slowdown -----------------------------------
        if self.state == "RESTING":
            self.timer -= 1
            self._move_one_toward(m.nest_pos)
            if self.timer <= 0:
                self.state = "FORAGING"
            return
        if temp > HOT_THRESHOLD and m.random.random() < 0.5:
            self.state = "RESTING"
            self.timer = 2
            m.rule_step["r06"] += 1
            return

        # -- rule 3 / 4: forage & harvest (only while actually foraging) -------
        if self.state == "FORAGING":
            flower = self._pick_flower()
            if flower is None:
                self.state = "RESTING"
                self.timer = m.random.randint(4, 12)
                return
            slow = 0.4 if self.injured else 0.0  # injured bees struggle
            self._move_one_toward(flower.pos, skip_chance=slow)
            if self.dist(flower.pos) <= 1.0:
                take = min(flower.nectar, NECTAR_TAKE)
                flower.nectar -= take
                self.nectar = min(1.0, self.nectar + take)
                if take > 0.05:
                    m.rule_step["r03"] += 1  # a harvest actually happened
                if self.nectar >= NECTAR_TAKE * 0.8:
                    self.state = "RETURNING"

        # -- rule 2: fly home & deposit honey (only while returning) -----------
        if self.state == "RETURNING":
            self._move_one_toward(m.nest_pos)
            if self.at_nest() and self.nectar > 0:
                m.deposit_honey(self)
                self.state = self._resume_state()

    # ------------------------------------------------------------------ rescue
    def _rescue_step(self):
        m = self.model
        v = self.rescue_victim
        if v is None or v.health <= 0 or v not in m.bees:
            self.rescue_victim = None
            self.state = self._resume_state()
            return
        self.energy -= 0.003
        if self.energy <= 0:
            m.kill_bee(self, "starvation")
            return
        if self.dist(v.pos) > 1.0:
            self._move_one_toward(v.pos)
        else:
            # actively helping: heal the victim (rule 1)
            v.health = min(1.0, v.health + HEAL_RATE)
            v.energy = min(1.0, v.energy + RESCUE_ENERGY)
            m.rule_step["r01"] += 1
            if v.health >= RESCUE_DONE:
                self.rescue_count += 1
                m.rescues_total += 1
                if self.rescue_count >= MAX_RESCUES_PER_BEE:
                    m.rule_step["r08"] += 1  # rule 8: rescue quota reached
                self.rescue_victim = None
                self.state = self._resume_state()

    # ---------------------------------------------------------------- defence
    def _defend_step(self, wasp):
        m = self.model
        if wasp is None or wasp.hp <= 0 or wasp not in m.wasps:
            self.state = self._resume_state()
            return
        self.energy -= 0.005
        if self.energy <= 0:
            m.kill_bee(self, "starvation")
            return
        if self.dist(wasp.pos) > 1.0:
            self._move_one_toward(wasp.pos)
        else:
            wasp.hp -= WASP_ATTACK_DAMAGE
            m.rule_step["r07"] += 1
            if m.random.random() < WASP_STING_CHANCE:
                self.health -= WASP_STING_DAMAGE
                if self.health <= 0:
                    m.kill_bee(self, "wasp")
                    return
            if wasp.hp <= 0:
                m.remove_wasp(wasp, by_bees=True)

    # ---------------------------------------------------------------- foraging
    def _pick_flower(self):
        m = self.model
        # keep current target while it is still worthwhile
        if self.target is not None and self.target in m.flowers and self.target.nectar > 0.15:
            return self.target
        self.target = None
        sense = m.sense_radius
        best, best_d = None, None
        for f in m.flowers:
            if f.nectar <= 0.1:
                continue
            d = self.dist(f.pos)
            if d <= sense * 1.5 and (best is None or d < best_d):
                best, best_d = f, d
        if best is None and m.random.random() < 0.3:
            # occasionally commit to a far flower
            far = [f for f in m.flowers if f.nectar > 0.2]
            if far:
                best = m.random.choice(far)
        return best


# ===========================================================================
class Queen(Agent):
    """Lays eggs when honey and temperature allow (rule 9)."""

    def __init__(self, model, pos):
        super().__init__(model.next_id(), model)
        self.model.grid.place_agent(self, pos)

    def step(self):
        m = self.model
        m.queen_pos = self.pos
        # rule 9: the queen maintains the colony at the "number of bees"
        # setpoint (UI slider) when honey and temperature allow, topping up
        # against natural attrition (max 8 eggs/day so it tracks gradually).
        if m.day_step % m.DAY_STEPS == 0:
            temp = m.current_temp
            target = min(m.params["n_bees"], m.params["max_bees"])
            if m.honey > 3 and 12 <= temp <= 32 and m.population() < target:
                deficit = target - m.population()
                n = min(QUEEN_LAY_CAP, max(1, deficit // QUEEN_LAY_DIVISOR),
                        int(m.honey // EGG_HONEY_COST))
                if n > 0:
                    for _ in range(n):
                        m.larvae.append({"t": int(m.params["larvae_days"])})
                    m.honey -= n * EGG_HONEY_COST
                    m.rule_step["r09"] += n


# ===========================================================================
class Flower(Agent):
    """A nectar source with finite nectar that regrows (rule 4)."""

    def __init__(self, model, pos, nectar=0.5):
        super().__init__(model.next_id(), model)
        self.nectar = nectar
        self.model.grid.place_agent(self, pos)

    def step(self):
        m = self.model
        gain = m.nectar_regrowth * m.flower_temp_factor() * m.season_factor()
        if gain > 0 and self.nectar < 1.0:
            self.nectar = min(1.0, self.nectar + gain)
            m.rule_step["r04"] += 1


# ===========================================================================
class Wasp(Agent):
    """A predator that hunts bees; the colony must defend against it (rule 7)."""

    def __init__(self, model, pos):
        super().__init__(model.next_id(), model)
        self.hp = 1.0
        self.model.grid.place_agent(self, pos)

    def dist(self, pos):
        g = self.model.grid
        dx = abs(self.pos[0] - pos[0])
        dy = abs(self.pos[1] - pos[1])
        if self.model.torus:
            dx = min(dx, g.width - dx)
            dy = min(dy, g.height - dy)
        return math.hypot(dx, dy)

    def step(self):
        m = self.model
        if self.hp <= 0:
            m.remove_wasp(self)
            return
        bee = m.nearest_bee(self.pos)
        if bee is None:
            m.grid.move_agent(self, (m.random.randint(0, m.grid.width - 1),
                                     m.random.randint(0, m.grid.height - 1)))
            return
        if self.dist(bee.pos) <= 1.0:
            if m.random.random() < WASP_KILL_CHANCE:
                m.kill_bee(bee, "wasp")
            else:
                bee.health -= WASP_STING_DAMAGE
                if bee.health <= 0:
                    m.kill_bee(bee, "wasp")
            m.alarm = 1.0  # attack visible to the UI and the colony
        else:
            # chase (one cell per step, torus-aware)
            x, y = self.pos
            tx, ty = bee.pos
            dx, dy = tx - x, ty - y
            g = m.grid
            if m.torus:
                if dx > g.width // 2:
                    dx -= g.width
                elif dx < -g.width // 2:
                    dx += g.width
                if dy > g.height // 2:
                    dy -= g.height
                elif dy < -g.height // 2:
                    dy += g.height
            sx = (dx > 0) - (dx < 0)
            sy = (dy > 0) - (dy < 0)
            m.grid.move_agent(self, (x + sx, y + sy))