from config import FORTRESS_TYPES, RACES, FLOW_RATE
from world_engine import darken_color

def process_sector_dominance(game_state):
    """Checks which player owns complete sectors (faces) and updates visual colors."""
    changes_made = False
    face_ownership = {}
    
    for idx, face in enumerate(game_state["faces"]):
        v1, v2, v3 = [str(x) for x in face]
        f1 = game_state["fortresses"].get(v1)
        f2 = game_state["fortresses"].get(v2)
        f3 = game_state["fortresses"].get(v3)
        
        o1 = f1.get('owner') if f1 else None
        o2 = f2.get('owner') if f2 else None
        o3 = f3.get('owner') if f3 else None
        
        if o1 and o1 == o2 and o2 == o3:
            face_ownership[str(idx)] = o1
        else:
            face_ownership[str(idx)] = None
    
    # Check for changes
    if face_ownership != game_state.get("sector_owners", {}):
        game_state["sector_owners"] = face_ownership
        
        for f_idx, owner in face_ownership.items():
            idx = int(f_idx)
            if owner:
                # Darken the color based on the owner's race color
                # We need to find a fortress on this face to determine race
                v_ex = game_state["faces"][idx][0]
                race_name = game_state["fortresses"][str(v_ex)]['race']
                if race_name in RACES:
                    base_c = RACES[race_name]['color']
                    game_state["face_colors"][idx] = darken_color(base_c, 0.3)
            else:
                # Reset to terrain color
                # We need TERRAIN_COLORS map here, or rely on stored terrain type
                from config import TERRAIN_COLORS # Local import to avoid circular issues if any
                t_type = game_state["face_terrain"][idx]
                game_state["face_colors"][idx] = TERRAIN_COLORS.get(t_type, 0xff00ff)
        
        changes_made = True

    return changes_made

def process_combat_flows(game_state):
    """Iterates through all attack paths and executes movement/combat."""
    changes_made = False
    
    for fid, fort in game_state["fortresses"].items():
        if not fort['paths'] or not fort['owner']: continue
        
        # Check Dominance for Bonus
        has_dominance_bonus = False
        for f_idx, face in enumerate(game_state["faces"]):
            if int(fid) in face:
                if game_state["sector_owners"].get(str(f_idx)) == fort['owner']:
                    has_dominance_bonus = True
                    break

        for target_id in fort['paths']:
            target = game_state["fortresses"].get(target_id)
            if not target: continue
            
            amount = FLOW_RATE
            
            # --- Reinforcement (Same Owner) ---
            if target['owner'] == fort['owner']:
                t_type = FORTRESS_TYPES[target['type']]
                if target['units'] < t_type['cap'] * 2:
                    target['units'] += amount
                    changes_made = True
            
            # --- Attack (Different Owner) ---
            else:
                def_type = FORTRESS_TYPES[target['type']]
                def_race = RACES.get(target['race'], RACES["Neutral"])
                def_mult = def_race.get('base_def', 1.0) * def_type['def_mod']
                
                atk_type = FORTRESS_TYPES[fort['type']] 
                atk_race = RACES.get(fort['race'], RACES["Human"])
                
                bonus = 1.0
                if has_dominance_bonus: bonus = 1.5
                if fort['special_active']: bonus *= atk_race.get('special_bonus', 1.0)
                
                atk_power = atk_type['atk_mod'] * atk_race.get('base_atk', 1.0) * bonus
                
                damage = amount * atk_power
                defense_val = target['units'] * def_mult
                
                if damage > defense_val:
                    # Capture Logic
                    target['owner'] = fort['owner']
                    target['race'] = fort['race']
                    target['units'] = 1.0
                    target['paths'] = [] # Reset paths on capture
                    target['tier'] = 1 
                else:
                    # Damage Logic
                    new_def_power = defense_val - damage
                    target['units'] = max(0, new_def_power / def_mult)
            
                changes_made = True
                
    return changes_made