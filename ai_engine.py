import random
from config import RACES
from config import TIER_2_THRESHOLD
from config import AI_NAME

def process_ai_turn(game_state):
    """
    Executes the AI logic for the 'Gorgon' faction.
    Analyzes the game state and modifies it in place.
    """
    # Filter fortresses owned by the AI
    ai_forts = []
    for fort in game_state["fortresses"].values():
        if fort['owner'] == AI_NAME:
            ai_forts.append(fort)
    
    # Iterate through each AI fortress to determine actions
    for fort in ai_forts:
        # 1. Growth Strategy
        current_units = fort['units']
        current_tier = fort['tier']
        
        # Check if we need to prioritize growth
        is_low_units = current_units < TIER_2_THRESHOLD
        is_low_tier = current_tier < 2
        
        if is_low_units and is_low_tier:
            if fort['paths']:
                # Cut all paths to grow
                fort['paths'] = []
        
        # 2. Expansion Strategy
        # If strong enough, find a target
        elif current_units >= 25:
            max_paths = fort['tier']
            current_path_count = len(fort['paths'])
            
            if current_path_count < max_paths:
                # Find valid neighbors
                fort_id_int = int(fort['id'])
                neighbors = game_state["adj"].get(fort_id_int, [])
                best_target = None
                lowest_def = 9999
                
                for n_id in neighbors:
                    target_key = str(n_id)
                    target = game_state["fortresses"][target_key]
                    
                    # Don't attack self
                    if target['owner'] == AI_NAME:
                        continue
                        
                    # Attack weakest neighbor
                    if target['units'] < lowest_def:
                        lowest_def = target['units']
                        best_target = target_key
                
                if best_target:
                    if best_target not in fort['paths']:
                        fort['paths'].append(best_target)