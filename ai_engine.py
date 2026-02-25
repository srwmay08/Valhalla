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
        if fort['type'] == "Keep" and fort['units'] > 15:
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
            if fort['units'] > cost + 25:
                if random.random() < 0.15:
                    fort['units'] -= cost
                    fort['tier'] += 1
                    continue

        # --- C. PATH DECOMMISSIONING ---
        # If target is now owned by Gorgon, remove it from paths
        paths_to_keep = []
        for target_id in fort['paths']:
            target = game_state["fortresses"].get(str(target_id))
            if target and target['owner'] != "Gorgon":
                paths_to_keep.append(target_id)
        fort['paths'] = paths_to_keep

        # --- D. ATTACK / EXPANSION ---
        if fort['units'] > 20:
            neighbors = game_state["adj"].get(int(fort['id']), [])
            weakest_target = None
            lowest_defense = 999
            
            for n_id in neighbors:
                target = game_state["fortresses"].get(str(n_id))
                if not target or target['owner'] == "Gorgon":
                    continue
                
                if target['units'] < lowest_defense:
                    lowest_defense = target['units']
                    weakest_target = target

            if weakest_target:
                aggression_threshold = lowest_defense * (1.6 - expand_bias)
                if fort['units'] > aggression_threshold:
                    tid = str(weakest_target['id'])
                    if tid not in fort['paths'] and len(fort['paths']) < fort['tier']:
                        fort['paths'].append(tid)