import random
from config import (
    FORTRESS_TYPES, NEUTRAL_GARRISON_MIN, NEUTRAL_GARRISON_MAX,
    UPGRADE_COST_TIER_2, UPGRADE_COST_TIER_3, TERRAIN_BUILD_OPTIONS
)

def initialize_fortresses(game_state):
    num_vertices = len(game_state["vertices"])
    faces = game_state["faces"]
    face_terrain = game_state["face_terrain"]
    
    vertex_neighbors = {i: set() for i in range(num_vertices)}
    for f_idx, face in enumerate(faces):
        t = face_terrain[f_idx]
        for v in face:
            vertex_neighbors[v].add(t)
            
    fortresses = {}
    for i in range(num_vertices):
        neighbors = list(vertex_neighbors[i])
        valid_pool = set()
        for t in neighbors:
            options = TERRAIN_BUILD_OPTIONS.get(t, TERRAIN_BUILD_OPTIONS["Default"])
            valid_pool.update(options)
            
        valid_pool_list = list(valid_pool) if valid_pool else ["Keep"]
        weighted_options = {}
        total_prob = 0.0
        
        for ftype in valid_pool_list:
            if ftype in FORTRESS_TYPES:
                prob = FORTRESS_TYPES[ftype]["prob"]
                weighted_options[ftype] = prob
                total_prob += prob
                
        choice = random.choices(list(weighted_options.keys()), weights=list(weighted_options.values()))[0] if total_prob > 0 else "Keep"

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
            "neighbor_terrains": neighbors,
            "land_type": neighbors[0] if neighbors else "Plain"
        }
    return fortresses

def process_fortress_production(game_state):
    changes_made = False
    from config import FORTRESS_TYPES, TERRAIN_BONUSES
    
    # Use the O(1) dominance cache populated by combat_engine
    dominance = game_state.get("dominance_cache", {})
    
    for fid, fort in game_state["fortresses"].items():
        if not fort['owner']: continue
        
        stats = FORTRESS_TYPES[fort['type']]
        final_cap = stats['cap']
        final_gen = stats['gen_mult']
        
        for t in fort['neighbor_terrains']:
            if t in TERRAIN_BONUSES:
                final_cap += TERRAIN_BONUSES[t].get("cap", 0)
                final_gen += TERRAIN_BONUSES[t].get("gen_mult", 0.0)
        
        # O(1) Lookup
        if dominance.get(fid) == fort['owner']:
            final_gen *= 1.5
            
        if fort['units'] < final_cap:
            fort['units'] = min(final_cap, fort['units'] + final_gen)
            changes_made = True
            
    return changes_made

def process_fortress_upgrades(game_state):
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