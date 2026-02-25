import random
from config import (
    FORTRESS_TYPES, RACES, FLOW_RATE, TERRAIN_BONUSES, 
    SPECIAL_UNITS, CLASS_MULTIPLIERS
)
from world_engine import darken_color

PACKET_SPEED = 0.05 
COLLISION_THRESHOLD = 0.05

def get_fortress_dynamic_stats(fort):
    f_type = FORTRESS_TYPES.get(fort['type'], FORTRESS_TYPES["Keep"])
    stats = {
        "atk_mod": f_type["atk_mod"],
        "def_mod": f_type["def_mod"],
        "cap": f_type["cap"],
        "gen_mult": f_type["gen_mult"],
        "unit_class": f_type.get("unit_class", "Soldier"),
        "range": 0 
    }
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
    changes_made = False
    face_ownership = {}
    current_sanctuaries = game_state.get("sanctuaries", {})
    dominance_cache = {} # Map fortress ID to dominant owner
    
    for idx, face in enumerate(game_state["faces"]):
        face_id = str(idx)
        v1, v2, v3 = [str(x) for x in face]
        f1 = game_state["fortresses"].get(v1)
        f2 = game_state["fortresses"].get(v2)
        f3 = game_state["fortresses"].get(v3)
        
        o1 = f1.get('owner') if f1 else None
        o2 = f2.get('owner') if f2 else None
        o3 = f3.get('owner') if f3 else None
        
        if o1 and o1 == o2 and o2 == o3:
            owner = o1
            face_ownership[face_id] = owner
            # Cache dominance for the production loop
            dominance_cache[v1] = owner
            dominance_cache[v2] = owner
            dominance_cache[v3] = owner
            
            avg_tier = (f1['tier'] + f2['tier'] + f3['tier']) / 3.0
            if face_id not in current_sanctuaries:
                current_sanctuaries[face_id] = {"owner": owner, "avg_tier": avg_tier, "cooldown": 10, "race": f1['race']}
                changes_made = True
            else:
                if current_sanctuaries[face_id]["avg_tier"] != avg_tier:
                    current_sanctuaries[face_id]["avg_tier"] = avg_tier
                    changes_made = True
        else:
            face_ownership[face_id] = None
            if face_id in current_sanctuaries:
                del current_sanctuaries[face_id]
                changes_made = True
    
    game_state["dominance_cache"] = dominance_cache

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

def process_special_spawns(game_state):
    changes_made = False
    edges = game_state.get("edges", {})
    for face_id, sanct in game_state.get("sanctuaries", {}).items():
        if sanct["cooldown"] > 0:
            sanct["cooldown"] -= 1
            continue
        avg_tier = sanct["avg_tier"]
        unit_type = "Titan" if avg_tier >= 2.5 else "Hero"
        spec_stats = SPECIAL_UNITS[unit_type]
        sanct["cooldown"] = spec_stats["cooldown"]
        face_vertices = game_state["faces"][int(face_id)]
        v_a = random.choice(face_vertices)
        v_b = random.choice([v for v in face_vertices if v != v_a])
        edge_key = str(tuple(sorted((v_a, v_b))))
        if edge_key in edges:
            edge = edges[edge_key]
            direction = 1
            new_packet = {
                "owner": sanct["owner"], "race": sanct["race"], "amount": spec_stats["size"],
                "pos": 0.5, "direction": direction, "type": unit_type, "unit_class": unit_type,
                "atk_bonus": spec_stats["atk"], "is_special": True, "patrol_face": int(face_id) if unit_type == "Hero" else None 
            }
            edge["packets"].append(new_packet)
            changes_made = True
    return changes_made

def process_combat_flows(game_state):
    changes_made = False
    edges = game_state.get("edges", {})
    if process_special_spawns(game_state):
        changes_made = True
    for fid, fort in game_state["fortresses"].items():
        if not fort['paths'] or not fort['owner']: continue
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
                    stats = get_fortress_dynamic_stats(fort)
                    new_packet = {
                        "owner": fort['owner'], "race": fort['race'], "amount": spawn_amount,
                        "pos": start_pos, "direction": direction, "type": fort['type'],
                        "unit_class": stats["unit_class"], "atk_bonus": stats["atk_mod"], "is_special": False
                    }
                    edges[edge_key]["packets"].append(new_packet)
                    changes_made = True
    for key, edge in edges.items():
        if not edge["packets"]: continue
        has_mage_fwd = any(p["unit_class"] == "Mage" and p["direction"] == 1 for p in edge["packets"])
        has_mage_rev = any(p["unit_class"] == "Mage" and p["direction"] == -1 for p in edge["packets"])
        edge["packets"].sort(key=lambda p: p["pos"])
        active_packets = []
        for p in edge["packets"]:
            mage_mult = 1.25 if ((p["direction"] == 1 and has_mage_fwd) or (p["direction"] == -1 and has_mage_rev)) else 1.0
            p["current_buff"] = mage_mult
            speed = PACKET_SPEED
            if p.get("is_special"):
                s_type = p["type"]
                if s_type in SPECIAL_UNITS:
                    speed *= SPECIAL_UNITS[s_type]["speed"]
            p["pos"] += p["direction"] * speed
            p["pos"] = max(0.0, min(1.0, p["pos"]))
            active_packets.append(p)
        forward_flow = [p for p in active_packets if p["direction"] == 1] 
        reverse_flow = [p for p in active_packets if p["direction"] == -1] 
        if forward_flow and reverse_flow:
            lead_fwd, lead_rev = forward_flow[-1], reverse_flow[0]
            if lead_fwd["pos"] >= lead_rev["pos"]:
                clash_pos = (lead_fwd["pos"] + lead_rev["pos"]) / 2.0
                edge["battle_point"] = clash_pos 
                dmg_fwd = calculate_packet_damage(lead_fwd, lead_rev, game_state, True)
                dmg_rev = calculate_packet_damage(lead_rev, lead_fwd, game_state, True)
                lead_fwd["amount"] -= dmg_rev
                lead_rev["amount"] -= dmg_fwd
                lead_fwd["pos"], lead_rev["pos"] = clash_pos, clash_pos
                changes_made = True
        edge["packets"] = [p for p in active_packets if p["amount"] > 0]
    for key, edge in edges.items():
        surviving_packets = []
        for p in edge["packets"]:
            arrived, target_id = False, None
            if p["direction"] == 1 and p["pos"] >= 1.0:
                target_id, arrived = str(edge["v"]), True
            elif p["direction"] == -1 and p["pos"] <= 0.0:
                target_id, arrived = str(edge["u"]), True
            if arrived and target_id:
                if p.get("unit_class") == "Hero" and p.get("patrol_face") is not None:
                    redirect_hero(p, target_id, game_state)
                    changes_made = True
                else:
                    target = game_state["fortresses"].get(target_id)
                    if target:
                        apply_packet_arrival(target, p, game_state)
                        changes_made = True
            else:
                surviving_packets.append(p)
        edge["packets"] = surviving_packets
    return changes_made

def redirect_hero(packet, current_node_id, game_state):
    face_id = packet["patrol_face"]
    face = game_state["faces"][face_id]
    curr = int(current_node_id)
    if curr not in face:
        packet["amount"] = 0
        return
    idx = face.index(curr)
    next_v = face[(idx + 1) % 3] 
    next_edge_key = str(tuple(sorted((curr, next_v))))
    edges = game_state["edges"]
    if next_edge_key in edges:
        direction = 1 if curr < next_v else -1
        packet["pos"] = 0.0 if direction == 1 else 1.0
        packet["direction"] = direction
        edges[next_edge_key]["packets"].append(packet)
    else:
        packet["amount"] = 0

def calculate_packet_damage(attacker, defender, game_state, is_clash=False):
    atk_race = RACES.get(attacker['race'], RACES["Human"])
    base_pwr = atk_race.get('base_atk', 1.0)
    fort_bonus = attacker.get("atk_bonus", 1.0)
    mage_buff = attacker.get("current_buff", 1.0)
    class_mult, atk_class = 1.0, attacker.get("unit_class", "Soldier")
    def_type = "Unit"
    if not is_clash and isinstance(defender, dict) and "units" in defender:
        def_type = "Fortress" 
    if atk_class in CLASS_MULTIPLIERS:
        class_mult = CLASS_MULTIPLIERS[atk_class].get(def_type, 1.0)
    return attacker['amount'] * base_pwr * fort_bonus * mage_buff * class_mult

def apply_packet_arrival(target, packet, game_state):
    if target['owner'] == packet['owner']:
        target['units'] += packet['amount']
    else:
        def_stats = get_fortress_dynamic_stats(target)
        def_race = RACES.get(target['race'], RACES["Neutral"])
        def_mult = def_race.get('base_def', 1.0) * def_stats['def_mod']
        damage = calculate_packet_damage(packet, target, game_state, is_clash=False)
        defense_val = target['units'] * def_mult
        if damage > defense_val:
            target['owner'] = packet['owner']
            target['race'] = packet['race']
            target['units'], target['paths'], target['tier'], target['type'] = 1.0, [], 1, 'Keep'
        else:
            target['units'] = max(0, (defense_val - damage) / def_mult)