import random
from config import (
    FORTRESS_TYPES, NEUTRAL_GARRISON_MIN, NEUTRAL_GARRISON_MAX,
    UPGRADE_COST_TIER_2, UPGRADE_COST_TIER_3, TERRAIN_BUILD_OPTIONS
)

def initialize_fortresses(game_state):
    """
    Creates the initial state for all fortresses (Vertices).
    Phase 2 Logic: 
    - Vertices are now defined by the 3 faces they touch (Intersection Nodes).
    - Structure options are a union of options from all neighbors.
    """
    num_vertices = len(game_state["vertices"])
    faces = game_state["faces"]
    face_terrain = game_state["face_terrain"]
    
    # 1. Map Vertices to Neighboring Terrains
    # Each vertex touches 3 faces in a dual-mesh, though 
    # implementation might vary slightly with subdivisions.
    # We iterate faces and assign them to their vertices.
    vertex_neighbors = {i: set() for i in range(num_vertices)}
    
    for f_idx, face in enumerate(faces):
        t = face_terrain[f_idx]
        for v in face:
            vertex_neighbors[v].add(t)
            
    fortresses = {}
    
    for i in range(num_vertices):
        neighbors = list(vertex_neighbors[i])
        
        # 2. Build Structure Pool (Intersection Logic)
        # Valid structures are the UNION of valid structures for all neighbors.
        # e.g., Mountain + Farm = can build Mine OR Barn.
        valid_pool = set()
        for t in neighbors:
            options = TERRAIN_BUILD_OPTIONS.get(t, TERRAIN_BUILD_OPTIONS["Default"])
            valid_pool.update(options)
            
        # Convert back to list for selection
        valid_pool_list = list(valid_pool)
        
        # Fallback
        if not valid_pool_list:
            valid_pool_list = ["Keep"]

        # 3. Select Type (Weighted Probability)
        # We must filter the global probabilities by our valid pool
        weighted_options = {}
        total_prob = 0.0
        
        for ftype in valid_pool_list:
            # Check if type exists in config
            if ftype in FORTRESS_TYPES:
                prob = FORTRESS_TYPES[ftype]["prob"]
                weighted_options[ftype] = prob
                total_prob += prob
                
        if total_prob > 0:
            choice = random.choices(
                list(weighted_options.keys()), 
                weights=list(weighted_options.values()), 
                k=1
            )[0]
        else:
            choice = "Keep"

        fortresses[str(i)] = {
            "id": i, 
            "owner": None, 
            "units": random.randint(NEUTRAL_GARRISON_MIN, NEUTRAL_GARRISON_MAX),
            "race": "Neutral", 
            "is_capital": False, 
            "special_active": False,
            "tier": 1, 
            "paths": [],
            "type": choice,
            "neighbor_terrains": neighbors, # Store for "Land Touch" bonuses
            "base_stats": {}, # Placeholder for dynamic calc
            "current_stats": {} # Placeholder for dynamic calc
        }
        
    return fortresses

def process_fortress_production(game_state):
    """
    Handles unit generation for all fortresses.
    Phase 1 "Firehose" + Phase 2 Dynamic Stats.
    """
    changes_made = False
    
    # We need to import the calculator from combat_engine 
    # OR replicate the logic. Ideally, stats are calculated once/cached,
    # but for safety let's assume we pull from a helper or recalc.
    # To avoid circular imports, we'll do a simple lookup here or
    # rely on combat_engine to update stats? 
    # For now, let's just use the raw config + neighbors here for Gen Rate.
    
    from config import FORTRESS_TYPES, TERRAIN_BONUSES
    
    for fid, fort in game_state["fortresses"].items():
        if not fort['owner']: continue
        
        # Base Stats
        f_type_stats = FORTRESS_TYPES[fort['type']]
        base_cap = f_type_stats['cap']
        base_gen = f_type_stats['gen_mult']
        
        # Apply Land Touch Bonuses (Gen & Cap)
        bonus_cap = 0
        bonus_gen = 0.0
        
        for t in fort['neighbor_terrains']:
            if t in TERRAIN_BONUSES:
                bonus_cap += TERRAIN_BONUSES[t].get("cap", 0)
                bonus_gen += TERRAIN_BONUSES[t].get("gen_mult", 0.0)
                
        final_cap = base_cap + bonus_cap
        final_gen = base_gen + bonus_gen
        
        # Dominance Bonus (Face control)
        # Check if this fortress touches a face that is fully owned
        has_dominance_bonus = False
        # (This check requires iterating faces, which is expensive. 
        # Optimized approach: `process_sector_dominance` should flag fortresses)
        # For now, sticking to the Phase 1 logic:
        for f_idx, face in enumerate(game_state["faces"]):
            if int(fid) in face:
                if game_state["sector_owners"].get(str(f_idx)) == fort['owner']:
                    has_dominance_bonus = True
                    break
        
        if has_dominance_bonus:
            final_gen *= 1.5
            
        if fort['units'] < final_cap:
            fort['units'] = min(final_cap, fort['units'] + final_gen)
            changes_made = True
            
    return changes_made

def process_fortress_upgrades(game_state):
    """Handles automatic upgrading logic."""
    changes_made = False
    for fid, fort in game_state["fortresses"].items():
        if not fort['owner']: continue
        
        current_tier = fort['tier']
        if current_tier < 3:
            cost = UPGRADE_COST_TIER_2 if current_tier == 1 else UPGRADE_COST_TIER_3
            
            if fort['units'] >= cost + 10:
                fort['units'] -= cost
                fort['tier'] += 1
                changes_made = True

        if len(fort['paths']) > fort['tier']:
            fort['paths'] = fort['paths'][:fort['tier']]
            changes_made = True
            
    return changes_made