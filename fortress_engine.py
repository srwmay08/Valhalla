"""
Valhalla Fortress Engine: Resource Generation and Construction Logic.
Handles the state of Vertices as strategic fortification points.
"""
import random
from config import (
    FORTRESS_TYPES, NEUTRAL_GARRISON_MIN, NEUTRAL_GARRISON_MAX,
    UPGRADE_COST_TIER_2, UPGRADE_COST_TIER_3, TERRAIN_BUILD_OPTIONS
)

def initialize_fortresses(game_state):
    """Sets initial structures and neutral garrisons based on vertex biome touch."""
    num_vertices = len(game_state["vertices"])
    faces = game_state["faces"]
    face_terrain = game_state["face_terrain"]
    
    vertex_neighbors = {i: set() for i in range(num_vertices)}
    for f_idx, face in enumerate(faces):
        for v in face: vertex_neighbors[v].add(face_terrain[f_idx])
            
    fortresses = {}
    for i in range(num_vertices):
        neighbors = list(vertex_neighbors[i])
        
        # Structure Pool: The UNION of what can be built on all surrounding terrain types
        valid_pool = set()
        for t in neighbors:
            valid_pool.update(TERRAIN_BUILD_OPTIONS.get(t, TERRAIN_BUILD_OPTIONS["Default"]))
        
        valid_list = list(valid_pool) if valid_pool else ["Keep"]
        
        # Select structure using probability weights from config
        weighted = {ft: FORTRESS_TYPES[ft]["prob"] for ft in valid_list if ft in FORTRESS_TYPES}
        choice = random.choices(list(weighted.keys()), weights=list(weighted.values()))[0] if weighted else "Keep"

        fortresses[str(i)] = {
            "id": i, "owner": None, "units": random.randint(NEUTRAL_GARRISON_MIN, NEUTRAL_GARRISON_MAX),
            "race": "Neutral", "is_capital": False, "tier": 1, "paths": [], "type": choice,
            "neighbor_terrains": neighbors
        }
    return fortresses

def process_fortress_production(game_state):
    """Calculates tick-based unit generation with terrain and dominance bonuses."""
    changes = False
    from config import FORTRESS_TYPES, TERRAIN_BONUSES
    
    for fid, fort in game_state["fortresses"].items():
        if not fort['owner']: continue
        
        stats = FORTRESS_TYPES[fort['type']]
        final_cap, final_gen = stats['cap'], stats['gen_mult']
        
        # Apply terrain-touch bonuses
        for t in fort['neighbor_terrains']:
            if t in TERRAIN_BONUSES:
                final_cap += TERRAIN_BONUSES[t].get("cap", 0)
                final_gen += TERRAIN_BONUSES[t].get("gen_mult", 0.0)
        
        # Sector Dominance: 50% generation boost if any touching face is fully owned
        for face in game_state["faces"]:
            if int(fid) in face and game_state["sector_owners"].get(str(game_state["faces"].index(face))) == fort['owner']:
                final_gen *= 1.5; break
            
        if fort['units'] < final_cap:
            fort['units'] = min(final_cap, fort['units'] + final_gen); changes = True
    return changes

def process_fortress_upgrades(game_state):
    """Automatic logic for spending units to advance fortress tier."""
    changes = False
    for fid, fort in game_state["fortresses"].items():
        if not fort['owner']: continue
        if fort['tier'] < 3:
            cost = UPGRADE_COST_TIER_2 if fort['tier'] == 1 else UPGRADE_COST_TIER_3
            if fort['units'] >= cost + 10: # Keep 10 units for defense
                fort['units'] -= cost; fort['tier'] += 1; changes = True
    return changes