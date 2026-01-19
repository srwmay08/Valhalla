import random
from config import (
    TIER_2_THRESHOLD, TIER_3_THRESHOLD,
    UPGRADE_COST_TIER_2, UPGRADE_COST_TIER_3,
    FORTRESS_TYPES
)

AI_NAME = "Gorgon"

def process_ai_turn(game_state):
    """
    Decisions for the AI (Gorgon).
    1. Upgrade fortresses if flush with units.
    2. Expand to weak neighbors.
    3. Reinforce threatened nodes.
    """
    
    # Identify AI Fortresses
    ai_forts = [
        f for f in game_state["fortresses"].values() 
        if f['owner'] == AI_NAME
    ]
    
    if not ai_forts:
        return

    for fort in ai_forts:
        fid = str(fort['id'])
        
        # --- 1. Upgrade Logic ---
        # (Note: fortress_engine handles the actual upgrade math, 
        # but AI must 'request' it or we simulate resource management here)
        # Since fortress_engine.py in the previous step handled auto-upgrades for EVERYONE based on config,
        # we can skip manual upgrade logic here to avoid double dipping, 
        # OR we can manage paths/aggression here.
        
        # --- 2. Path Management (Attack/Reinforce) ---
        # Get neighbors from adjacency list
        neighbors = game_state["adj"].get(int(fid), [])
        
        # Decide where to send paths
        current_paths = fort['paths']
        possible_targets = []
        
        for n_idx in neighbors:
            n_id = str(n_idx)
            neighbor = game_state["fortresses"].get(n_id)
            if not neighbor: continue
            
            # Score this neighbor
            score = 0
            
            if neighbor['owner'] != AI_NAME:
                # Attack Logic
                # Prefer weak targets
                if neighbor['units'] < fort['units'] * 0.8:
                    score += 50
                # Prefer capturing empty/neutral
                if neighbor['owner'] is None:
                    score += 20
            else:
                # Reinforce Logic
                # If neighbor is critical or under attack (conceptually)
                if neighbor['units'] < 20:
                    score += 10
            
            possible_targets.append((n_id, score))
        
        # Sort by score
        possible_targets.sort(key=lambda x: x[1], reverse=True)
        
        # Update paths based on Tier Limit
        # AI creates paths to the highest scoring neighbors
        max_paths = fort['tier'] # e.g. Tier 1 = 1 path
        
        new_paths = []
        for target_id, score in possible_targets:
            if len(new_paths) < max_paths and score > 0:
                new_paths.append(target_id)
        
        # Apply changes
        fort['paths'] = new_paths