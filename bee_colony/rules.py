"""The 13 behavioural rules of the bee colony.

These are the declarative, human-readable rules that the agents in
agents.py implement. They are surfaced verbatim in the web UI (Rules panel)
along with a live counter of how many times each rule fired in the most
recent step.

Rule keys are "r01".."r13" and match the counters the model keeps in
model.rule_step.
"""

RULES = [
    ("r01",
     "Help the injured",
     "When a bee sees an injured bee within its sensing radius, it stops "
     "what it is doing, moves next to the casualty and stays until it is "
     "recovered, healing its health and restoring some energy."),
    ("r02",
     "Make honey",
     "When a bee comes back from a nectar harvest, it deposits the nectar "
     "at the nest and converts 90% of it into honey for the colony."),
    ("r03",
     "Forage",
     "An idle worker heads to the nearest flower that still has nectar. "
     "It harvests up to half the flower's nectar and carries it home. "
     "Injured bees move slowly and may skip steps."),
    ("r04",
     "Nectar economy",
     "Harvesting drains a flower. Flowers regrow nectar over time, faster "
     "in the warm mid-temperature band and slower during the nectar-lean "
     "part of the season."),
    ("r05",
     "Metabolism & fatigue",
     "Every step a bee burns energy; the burn is higher when it is very "
     "cold or very hot. A tired bee returns to the nest to feed, and a "
     "collapsed bee (energy 0, or an exhaustion collapse) dies or is left "
     "injured for a neighbour to rescue (rule 1)."),
    ("r06",
     "Thermoregulation",
     "Below ~10C bees cluster at the nest and hibernate (cheap metabolism, "
     "no foraging). Above ~34C they shade the nest and slow down instead "
     "of foraging."),
    ("r07",
     "Defence",
     "A bee that spots a wasp in its radius raises the alarm and forms a "
     "defence ring: nearby bees close in and sting the wasp. Sting "
     "exchanges go both ways - defenders can be stung and killed."),
    ("r08",
     "Rescue quota",
     "A bee can rescue at most 2 bees before it must return to its normal "
     "work, so a colony does not collapse into total nursing and starve "
     "of honey."),
    ("r09",
     "Queen & eggs",
     "The queen lays eggs into the honey pot when honey supply and "
     "temperature allow; larvae mature into workers after a few days."),
    ("r10",
     "Honey draft",
     "The nest continuously burns honey to feed larvae and queen and to "
     "keep the brood warm on cold days. If honey hits zero, brood "
     "production stops and the colony is under stress."),
    ("r11",
     "Aging & senescence",
     "Bees have a limited lifespan. Past 70% of it they stop foraging and "
     "become nurses that tend the brood at the nest, then quietly die of "
     "old age."),
    ("r12",
     "Nectar season",
     "A slow seasonal cycle periodically lowers nectar availability. The "
     "stored honey is what carries the colony through the lull - watch "
     "population and forager counts dip when the season turns."),
    ("r13",
     "Swarming",
     "When the nest gets crowded relative to available flowers (and honey "
     "stores are healthy), a share of foragers departs with a portion of "
     "the honey to found a new colony, leaving a swarm marker on the map."),
]


def rules_as_dicts():
    """Return the rules in a UI-friendly shape."""
    return [{"id": rid, "title": title, "text": text} for rid, title, text in RULES]


RULE_TITLES = {rid: title for rid, title, _ in RULES}