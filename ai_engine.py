import random
from config import (
    AI_DIFFICULTY, AI_PROFILES, 
    UPGRADE_COST_TIER_2, UPGRADE_COST_TIER_3, 
    FORTRESS_TYPES, TERRAIN_BUILD_OPTIONS
)

def process_ai_turn(game_state):
    """
    Executes the AI's logic for the current turn.
    1. Specialization: Converts basic Keeps into specialized structures.
    2. Upgrades: Spends resources to upgrade fortress tiers.
    3. Expansion/Attack: Sends units to conquer neighbors.
    """
    
    # 1. Get AI Settings
    profile = AI_PROFILES.get(AI_DIFFICULTY, AI_PROFILES["Normal"])
    reaction_delay = profile["reaction_delay"]
    expand_bias = profile["expand_bias"]
    
    # Iterate through all fortresses to find AI-owned ones
    ai_forts = [f for f in game_state["fortresses"].values() if f['owner'] == "Gorgon"]
    
    for fort in ai_forts:
        # Skip if disabled (stunned/cooldown)
        if fort.get('disabled', False):
            continue

        # --- A. SPECIALIZATION LOGIC ---
        # If we own a "Keep" (basic type), try to specialize it.
        if fort['type'] == "Keep" and fort['units'] > 10:
            # 1. Determine valid options for this terrain
            terrain = fort.get('land_type', 'Plain')
            allowed_types = TERRAIN_BUILD_OPTIONS.get(terrain, TERRAIN_BUILD_OPTIONS["Default"])
            
            # 2. Filter out "Keep" so we pick something interesting
            special_options = [t for t in allowed_types if t != "Keep"]
            
            if special_options:
                # 3. Choose based on strategy (Random for now, but could be smarter)
                new_type = random.choice(special_options)
                fort['type'] = new_type
                # Small cost to build? For now, free, just consumes the turn action effectively
                continue # Skip other actions this turn

        # --- B. UPGRADE LOGIC ---
        # AI attempts to upgrade if it has significant excess units
        current_tier = fort['tier']
        if current_tier < 3:
            cost = UPGRADE_COST_TIER_2 if current_tier == 1 else UPGRADE_COST_TIER_3
            # buffer: Don't spend all units, leave some for defense
            buffer = 20 
            
            if fort['units'] > cost + buffer:
                # 10% chance to upgrade per tick if affordable (prevents instant mass upgrades)
                if random.random() < 0.10:
                    fort['units'] -= cost
                    fort['tier'] += 1
                    continue # Action taken

        # --- C. ATTACK / EXPANSION LOGIC ---
        # Only attack if we have enough units to be effective
        if fort['units'] > 15:
            # Get neighbors from adjacency list
            neighbors = game_state["adj"].get(int(fort['id']), [])
            
            # Identify targets
            weakest_target = None
            lowest_defense = 9999
            
            for n_id in neighbors:
                target = game_state["fortresses"].get(str(n_id))
                if not target: continue
                
                # Calculate effective defense
                # (Simple AI view: just look at unit count)
                def_val = target['units']
                
                # Bias: Prefer attacking non-AI (Player) or Neutral
                if target['owner'] == "Gorgon":
                    # Reinforce own nodes if they are weak
                    if target['units'] < 10:
                        def_val = -50 # High priority to reinforce
                    else:
                        continue # Don't attack self usually
                
                if def_val < lowest_defense:
                    lowest_defense = def_val
                    weakest_target = target

            # Decide to attack
            if weakest_target:
                # Threshold to attack: Do I have more than them?
                # Multiplier lowers the threshold based on 'expand_bias' (higher bias = more aggressive)
                aggression_threshold = lowest_defense * (1.5 - expand_bias)
                
                if fort['units'] > aggression_threshold:
                    target_id = str(weakest_target['id'])
                    
                    # Add path if not already attacking
                    if target_id not in fort['paths']:
                        # Check path limit (Tier limit)
                        if len(fort['paths']) < fort['tier']:
                            fort['paths'].append(target_id)