import random
from config import (
    FORTRESS_TYPES, NEUTRAL_GARRISON_MIN, NEUTRAL_GARRISON_MAX,
    UPGRADE_COST_TIER_2, UPGRADE_COST_TIER_3
)

def initialize_fortresses(num_vertices):
    """Creates the initial state for all fortresses."""
    fortresses = {}
    types_keys = list(FORTRESS_TYPES.keys())
    types_probs = [FORTRESS_TYPES[k]["prob"] for k in types_keys]
    
    for i in range(num_vertices):
        ftype = random.choices(types_keys, types_probs)[0]
        
        fortresses[str(i)] = {
            "id": i, 
            "owner": None, 
            "units": random.randint(NEUTRAL_GARRISON_MIN, NEUTRAL_GARRISON_MAX),
            "race": "Neutral", 
            "is_capital": False, 
            "special_active": False,
            "tier": 1, 
            "paths": [],
            "type": ftype
        }
    return fortresses

def process_fortress_production(game_state):
    """Handles unit generation for all fortresses."""
    changes_made = False
    
    for fid, fort in game_state["fortresses"].items():
        if not fort['owner']: continue
        
        f_type_stats = FORTRESS_TYPES[fort['type']]
        cap = f_type_stats['cap']
        
        # Check Dominance Bonus
        has_dominance_bonus = False
        for f_idx, face in enumerate(game_state["faces"]):
            if int(fid) in face:
                if game_state["sector_owners"].get(str(f_idx)) == fort['owner']:
                    has_dominance_bonus = True
                    break
                    
        if fort['units'] < cap:
            growth = 1.0 * f_type_stats['gen_mult']
            if has_dominance_bonus: growth *= 1.5
            
            fort['units'] = min(cap, fort['units'] + growth)
            changes_made = True
            
    return changes_made

def process_fortress_upgrades(game_state):
    """Handles automatic upgrading logic (if enabled) or pre-checks."""
    # Currently, app.py logic had automatic upgrades for AI in ai_engine,
    # and automatic upgrades for players in the loop if resources allowed.
    # Refactoring the Player auto-upgrade logic here.
    
    changes_made = False
    for fid, fort in game_state["fortresses"].items():
        if not fort['owner']: continue
        
        current_tier = fort['tier']
        if current_tier < 3:
            cost = UPGRADE_COST_TIER_2 if current_tier == 1 else UPGRADE_COST_TIER_3
            # Simple logic: If significantly over cap, upgrade. 
            # Note: The user might want manual upgrades later, but preserving existing behavior.
            if fort['units'] >= cost + 10:
                fort['units'] -= cost
                fort['tier'] += 1
                changes_made = True

        # Enforce Path Limit
        if len(fort['paths']) > fort['tier']:
            fort['paths'] = fort['paths'][:fort['tier']]
            changes_made = True
            
    return changes_made