from config import FORTRESS_TYPES, RACES, FLOW_RATE, TERRAIN_BONUSES
from world_engine import darken_color

# --- CONSTANTS ---
PACKET_SPEED = 0.05 
COLLISION_THRESHOLD = 0.05

def get_fortress_dynamic_stats(fort):
    """
    Calculates the actual stats of a fortress based on:
    1. Base Type (Tower, Farm, etc.)
    2. Neighboring Terrains (Land Touch Bonuses)
    3. Race Modifiers (if owned)
    """
    f_type = FORTRESS_TYPES.get(fort['type'], FORTRESS_TYPES["Keep"])
    
    stats = {
        "atk_mod": f_type["atk_mod"],
        "def_mod": f_type["def_mod"],
        "cap": f_type["cap"],
        "gen_mult": f_type["gen_mult"],
        "range": 0 # Base range bonus
    }
    
    # Apply Land Touch Bonuses
    for t in fort.get("neighbor_terrains", []):
        if t in TERRAIN_BONUSES:
            b = TERRAIN_BONUSES[t]
            stats["atk_mod"] += b.get("atk_mod", 0.0)
            stats["def_mod"] += b.get("def_mod", 0.0)
            stats["cap"] += b.get("cap", 0)
            stats["gen_mult"] += b.get("gen_mult", 0.0)
            stats["range"] += b.get("range", 0)
            
    return stats

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
    
    if face_ownership != game_state.get("sector_owners", {}):
        game_state["sector_owners"] = face_ownership
        
        for f_idx, owner in face_ownership.items():
            idx = int(f_idx)
            if owner:
                v_ex = game_state["faces"][idx][0]
                race_name = game_state["fortresses"][str(v_ex)]['race']
                if race_name in RACES:
                    base_c = RACES[race_name]['color']
                    game_state["face_colors"][idx] = darken_color(base_c, 0.3)
            else:
                from config import TERRAIN_COLORS
                t_type = game_state["face_terrain"][idx]
                game_state["face_colors"][idx] = TERRAIN_COLORS.get(t_type, 0xff00ff)
        
        changes_made = True

    return changes_made

def process_combat_flows(game_state):
    """
    Phase 1 & 2 Update: Streams + Dynamic Stats
    """
    changes_made = False
    edges = game_state.get("edges", {})

    # --- STEP 1: SPAWN PACKETS ---
    for fid, fort in game_state["fortresses"].items():
        if not fort['paths'] or not fort['owner']: continue
        
        # Use Dynamic Stats for Gen/Flow? 
        # Flow is usually standard constant to represent "pipes", 
        # but we could modify it by gen_mult? Let's keep flow standard for now.
        spawn_amount = FLOW_RATE 
        
        if fort['units'] >= spawn_amount:
            for target_id in fort['paths']:
                if fort['units'] < spawn_amount: break 
                
                u, v = int(fid), int(target_id)
                edge_key = str(tuple(sorted((u, v))))
                
                if edge_key in edges:
                    fort['units'] -= spawn_amount
                    
                    direction = 1 if u < v else -1
                    start_pos = 0.0 if direction == 1 else 1.0
                    
                    # Store dynamic stats in packet snapshot
                    stats = get_fortress_dynamic_stats(fort)
                    
                    new_packet = {
                        "owner": fort['owner'],
                        "race": fort['race'],
                        "amount": spawn_amount,
                        "pos": start_pos,
                        "direction": direction,
                        "type": fort['type'],
                        "atk_bonus": stats["atk_mod"] # Pass Atk Mod to packet
                    }
                    edges[edge_key]["packets"].append(new_packet)
                    changes_made = True

    # --- STEP 2 & 3: MOVE & CLASH ---
    for key, edge in edges.items():
        if not edge["packets"]: continue
        
        edge["packets"].sort(key=lambda p: p["pos"])
        
        active_packets = []
        for p in edge["packets"]:
            p["pos"] += p["direction"] * PACKET_SPEED
            p["pos"] = max(0.0, min(1.0, p["pos"]))
            active_packets.append(p)
            
        forward_flow = [p for p in active_packets if p["direction"] == 1] 
        reverse_flow = [p for p in active_packets if p["direction"] == -1] 
        
        if forward_flow and reverse_flow:
            lead_fwd = forward_flow[-1] 
            lead_rev = reverse_flow[0]
            
            if lead_fwd["pos"] >= lead_rev["pos"]:
                clash_pos = (lead_fwd["pos"] + lead_rev["pos"]) / 2.0
                edge["battle_point"] = clash_pos 
                
                dmg_fwd = calculate_packet_damage(lead_fwd, lead_rev, game_state, True)
                dmg_rev = calculate_packet_damage(lead_rev, lead_fwd, game_state, True)
                
                lead_fwd["amount"] -= dmg_rev
                lead_rev["amount"] -= dmg_fwd
                
                lead_fwd["pos"] = clash_pos
                lead_rev["pos"] = clash_pos
                
                changes_made = True

        edge["packets"] = [p for p in active_packets if p["amount"] > 0]

    # --- STEP 4: ARRIVALS ---
    for key, edge in edges.items():
        surviving_packets = []
        for p in edge["packets"]:
            arrived = False
            target_id = None
            
            if p["direction"] == 1 and p["pos"] >= 1.0:
                target_id = str(edge["v"])
                arrived = True
            elif p["direction"] == -1 and p["pos"] <= 0.0:
                target_id = str(edge["u"])
                arrived = True
                
            if arrived and target_id:
                target = game_state["fortresses"].get(target_id)
                if target:
                    apply_packet_arrival(target, p, game_state)
                    changes_made = True
            else:
                surviving_packets.append(p)
                
        edge["packets"] = surviving_packets
        
    return changes_made

def calculate_packet_damage(attacker, defender, game_state, is_clash=False):
    """
    Calculates damage.
    Phase 2: Uses the 'atk_bonus' snapshot carried by the packet.
    """
    atk_race = RACES.get(attacker['race'], RACES["Human"])
    
    # Base Power
    base_pwr = atk_race.get('base_atk', 1.0)
    
    # Fortress/Terrain Bonus (Carried in packet)
    fort_bonus = attacker.get("atk_bonus", 1.0)
    
    total_mult = base_pwr * fort_bonus
    
    return attacker['amount'] * total_mult

def apply_packet_arrival(target, packet, game_state):
    """
    Handles logic when a packet hits a fortress.
    Phase 2: Uses Dynamic Defense Stats.
    """
    
    # --- Reinforcement ---
    if target['owner'] == packet['owner']:
        stats = get_fortress_dynamic_stats(target)
        if target['units'] < stats['cap'] * 2:
            target['units'] += packet['amount']
            
    # --- Siege / Attack ---
    else:
        # Get Dynamic Defense
        def_stats = get_fortress_dynamic_stats(target)
        def_race = RACES.get(target['race'], RACES["Neutral"])
        
        def_mult = def_race.get('base_def', 1.0) * def_stats['def_mod']
        
        damage = calculate_packet_damage(packet, target, game_state, is_clash=False)
        defense_val = target['units'] * def_mult
        
        if damage > defense_val:
            # Capture
            target['owner'] = packet['owner']
            target['race'] = packet['race']
            target['units'] = 1.0
            target['paths'] = []
            target['tier'] = 1
            target['type'] = 'Keep' 
        else:
            new_def_power = defense_val - damage
            target['units'] = max(0, new_def_power / def_mult)