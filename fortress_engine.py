import random
from config import (
    FORTRESS_TYPES, NEUTRAL_GARRISON_MIN, NEUTRAL_GARRISON_MAX,
    UPGRADE_COST_TIER_2, UPGRADE_COST_TIER_3, TERRAIN_BUILD_OPTIONS
)

def initialize_fortresses(game_state):
    """
    Creates the initial state for all fortresses.
    Determines fortress terrain based on surrounding faces to enforce construction rules.
    """
    num_vertices = len(game_state["vertices"])
    faces = game_state["faces"]
    face_terrain = game_state["face_terrain"]
    
    # 1. Determine Terrain for each Vertex (Fortress)
    # A vertex is a shared point. We prioritize restrictive terrain.
    # Priority: Mountain > Waste > Lava > Swamp > Forest > Hill > Farm > Plain
    terrain_priority = {
        "Mountain": 10, "Lava": 9, "Waste": 8, "Swamp": 7, 
        "Forest": 6, "Hill": 5, "Farm": 4, "Plain": 1, 
        "Deep Sea": 0, "Sea": 0, "None": 0
    }
    
    vertex_terrain = {}
    
    # Initialize with default
    for i in range(num_vertices):
        vertex_terrain[i] = "Plain"

    # Iterate faces to project terrain onto vertices
    for f_idx, face in enumerate(faces):
        t = face_terrain[f_idx]
        p = terrain_priority.get(t, 0)
        for v in face:
            curr_t = vertex_terrain.get(v, "Plain")
            curr_p = terrain_priority.get(curr_t, 0)
            if p > curr_p:
                vertex_terrain[v] = t

    fortresses = {}
    
    for i in range(num_vertices):
        v_terrain = vertex_terrain[i]
        
        # Get valid types for this terrain
        allowed_types = TERRAIN_BUILD_OPTIONS.get(v_terrain, TERRAIN_BUILD_OPTIONS["Default"])
        
        # Filter global FORTRESS_TYPES to find valid ones
        valid_keys = [k for k in FORTRESS_TYPES.keys() if k in allowed_types]
        if not valid_keys: 
            valid_keys = ["Keep"] # Fallback

        # Select type based on probabilities of valid types
        # Normalize probabilities
        total_prob = sum(FORTRESS_TYPES[k]["prob"] for k in valid_keys)
        if total_prob > 0:
            weights = [FORTRESS_TYPES[k]["prob"] / total_prob for k in valid_keys]
            ftype = random.choices(valid_keys, weights=weights, k=1)[0]
        else:
            ftype = "Keep"

        fortresses[str(i)] = {
            "id": i, 
            "owner": None, 
            "units": random.randint(NEUTRAL_GARRISON_MIN, NEUTRAL_GARRISON_MAX),
            "race": "Neutral", 
            "is_capital": False, 
            "special_active": False,
            "tier": 1, 
            "paths": [],
            "type": ftype,
            "land_type": v_terrain # Store for UI/Validation
        }
    return fortresses

def process_fortress_production(game_state):
    """
    Handles unit generation for all fortresses.
    Constraint: Only generates units if NOT attacking (paths is empty).
    """
    changes_made = False
    
    for fid, fort in game_state["fortresses"].items():
        if not fort['owner']: continue
        
        # PRODUCTION CONSTRAINT: Only if not attacking
        if fort['paths']:
            continue
        
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
    changes_made = False
    for fid, fort in game_state["fortresses"].items():
        if not fort['owner']: continue
        
        current_tier = fort['tier']
        if current_tier < 3:
            cost = UPGRADE_COST_TIER_2 if current_tier == 1 else UPGRADE_COST_TIER_3
            
            # Simple auto-upgrade logic for AI or lazy players (can be refined)
            if fort['units'] >= cost + 10:
                fort['units'] -= cost
                fort['tier'] += 1
                changes_made = True

        # Enforce Path Limit
        if len(fort['paths']) > fort['tier']:
            fort['paths'] = fort['paths'][:fort['tier']]
            changes_made = True
            
    return changes_made