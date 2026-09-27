"""Bee-colony agent-based model (Mesa) with a web UI."""
from .model import BeeColonyModel
from .rules import RULES, rules_as_dicts

__all__ = ["BeeColonyModel", "RULES", "rules_as_dicts"]
__version__ = "1.0.0"