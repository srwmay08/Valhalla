import random
from config import (
    AI_DIFFICULTY, AI_PROFILES, 
    UPGRADE_COST_TIER_2, UPGRADE_COST_TIER_3, 
    FORTRESS_TYPES, TERRAIN_BUILD_OPTIONS
)

def process_ai_turn(game_state):
    profile = AI_PROFILES.get(AI_DIFFICULTY, AI_PROFILES["Normal"])
    expand_bias = profile["expand_bias"]
    ai_forts = [f for f in game_state["fortresses"].values() if f['owner'] == "Gorgon"]
    
    for fort in ai_forts:
        if fort.get('disabled', False):
            continue

        # --- A. SPECIALIZATION ---
        if fort['type'] == "Keep" and fort['units'] > 10:
            terrain = fort.get('land_type', 'Plain')
            allowed_types = TERRAIN_BUILD_OPTIONS.get(terrain, TERRAIN_BUILD_OPTIONS["Default"])
            special_options = [t for t in allowed_types if t != "Keep"]
            if special_options:
                fort['type'] = random.choice(special_options)
                continue

        # --- B. UPGRADES ---
        current_tier = fort['tier']
        if current_tier < 3:
            cost = UPGRADE_COST_TIER_2 if current_tier == 1 else UPGRADE_COST_TIER_3
            if fort['units'] > cost + 20:
                if random.random() < 0.10:
                    fort['units'] -= cost
                    fort['tier'] += 1
                    continue

        # --- C. ATTACK / DECOMMISSION ---
        neighbors = game_state["adj"].get(int(fort['id']), [])
        
        # Decommission logic: If a path target is now owned by Gorgon, remove it
        active_paths = list(fort['paths'])
        for p_id in active_paths:
            target = game_state["fortresses"].get(p_id)
            if target and target['owner'] == "Gorgon":
                fort['paths'].remove(p_id)

        if fort['units'] > 15:
            weakest_target = None
            lowest_defense = 9999
            for n_id in neighbors:
                target = game_state["fortresses"].get(str(n_id))
                if not target: continue
                def_val = target['units']
                if target['owner'] == "Gorgon":
                    if target['units'] < 10: def_val = -50
                    else: continue
                if def_val < lowest_defense:
                    lowest_defense, weakest_target = def_val, target

            if weakest_target:
                aggression_threshold = lowest_defense * (1.5 - expand_bias)
                if fort['units'] > aggression_threshold:
                    target_id = str(weakest_target['id'])
                    if target_id not in fort['paths'] and len(fort['paths']) < fort['tier']:
                        fort['paths'].append(target_id)