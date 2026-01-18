import os
import random
import math
import time
from threading import Lock
from collections import deque
from flask import Flask, jsonify, render_template, request, redirect, url_for, flash
from flask_pymongo import PyMongo
from flask_login import LoginManager, UserMixin, login_user, logout_user, current_user, login_required
from flask_bcrypt import Bcrypt
from flask_socketio import SocketIO, emit
from bson.objectid import ObjectId
from config import (
    RACES, MAX_PLAYERS, ICO_SUBDIVISIONS, STARTING_UNITS_POOL, NEUTRAL_GARRISON_MIN, NEUTRAL_GARRISON_MAX,
    TERRAIN_COLORS, SCALES, SURFACE_OCEANS, MIN_SURFACE_DEEP_SEA_PERCENT,
    MAX_SURFACE_DEEP_SEA_PERCENT, SPAWN_CHANCE_WASTE, SPAWN_CHANCE_FARM,
    MOUNTAIN_RANGE_MIN_LENGTH, MOUNTAIN_RANGE_MAX_LENGTH, FORTRESS_TYPES,
    UPGRADE_COST_TIER_2, UPGRADE_COST_TIER_3, AI_DIFFICULTY, AI_PROFILES,
    TICK_RATE, FLOW_RATE
)

# --- Overrides & Constants ---
# Force Human to Red as requested
RACES["Human"]["color"] = 0xff0000  
RACES["Orc"]["color"] = 0x00ff00    # Ensure AI (Orc) is Green/distinct

AI_NAME = "Gorgon"

# --- Extension Initialization ---
mongo = PyMongo()
bcrypt = Bcrypt()
socketio = SocketIO(async_mode='threading')
login_manager = LoginManager()
login_manager.login_view = 'login'
login_manager.login_message_category = 'info'

thread = None
thread_lock = Lock()

# --- Global Game State ---
game_state = {
    "initialized": False,
    "vertices": [],
    "faces": [],
    "face_colors": [],
    "face_terrain": [],
    "adj": {},
    "roads": [],
    "fortresses": {},
    "sector_owners": {} # Track who owns which face (Sector Dominance)
}

# --- User Class for Flask-Login ---
class User(UserMixin):
    def __init__(self, user_doc):
        self.user_doc = user_doc
    
    def get_id(self):
        return str(self.user_doc["_id"])
    
    @property
    def username(self):
        return self.user_doc.get("username")
    
    @property
    def password_hash(self):
        return self.user_doc.get("password_hash")
    
    def check_password(self, password):
        return bcrypt.check_password_hash(self.password_hash, password)

@login_manager.user_loader
def load_user(user_id):
    try:
        user_doc = mongo.db.users.find_one({"_id": ObjectId(user_id)})
        if user_doc:
            return User(user_doc)
    except Exception as e:
        print(f"DEBUG: Error loading user: {e}")
    return None

# --- Geometry & Graph Helpers ---
def create_ico_sphere(subdivisions):
    t = (1.0 + math.sqrt(5.0)) / 2.0
    vertices = [
        [-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0],
        [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t],
        [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]
    ]
    faces = [
        [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
        [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
        [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
        [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]
    ]
    
    for _ in range(subdivisions):
        faces_subdiv = []
        mid_cache = {}
        def get_mid(p1, p2):
            key = tuple(sorted((p1, p2)))
            if key in mid_cache: return mid_cache[key]
            v1, v2 = vertices[p1], vertices[p2]
            mid = [(v1[i] + v2[i]) / 2.0 for i in range(3)]
            length = math.sqrt(sum(c*c for c in mid))
            mid = [c / length for c in mid]
            idx = len(vertices)
            vertices.append(mid)
            mid_cache[key] = idx
            return idx
        for tri in faces:
            v1, v2, v3 = tri
            a, b, c = get_mid(v1, v2), get_mid(v2, v3), get_mid(v3, v1)
            faces_subdiv.extend([[v1, a, c], [v2, b, a], [v3, c, b], [a, b, c]])
        faces = faces_subdiv
    for i in range(len(vertices)):
        length = math.sqrt(sum(c*c for c in vertices[i]))
        if length > 0: vertices[i] = [c / length for c in vertices[i]]
    return vertices, faces

def build_graph_from_mesh(vertices, faces):
    adj = {i: set() for i in range(len(vertices))}
    roads = set()
    for face in faces:
        edges = [
            tuple(sorted((face[0], face[1]))),
            tuple(sorted((face[1], face[2]))),
            tuple(sorted((face[2], face[0])))
        ]
        for u, v in edges:
            adj[u].add(v)
            adj[v].add(u)
            roads.add((u, v))
    return {k: list(v) for k, v in adj.items()}, list(roads)

def darken_color(hex_color, factor=0.4):
    r = (hex_color >> 16) & 0xFF
    g = (hex_color >> 8) & 0xFF
    b = hex_color & 0xFF
    r = int(r * factor); g = int(g * factor); b = int(b * factor)
    return (r << 16) | (g << 8) | b

# --- Terrain Generation Helpers ---
def find_face_neighbors(faces):
    edge_to_faces = {}
    for i, face in enumerate(faces):
        edges = [
            tuple(sorted((face[0], face[1]))),
            tuple(sorted((face[1], face[2]))),
            tuple(sorted((face[2], face[0])))
        ]
        for edge in edges:
            if edge not in edge_to_faces: edge_to_faces[edge] = []
            edge_to_faces[edge].append(i)
    neighbors = {i: set() for i in range(len(faces))}
    for edge, face_indices in edge_to_faces.items():
        if len(face_indices) == 2:
            f1, f2 = face_indices
            neighbors[f1].add(f2); neighbors[f2].add(f1)
    return {k: list(v) for k, v in neighbors.items()}

def grow_body(start_node, target_size, occupied_tiles, neighbors_map):
    body = {start_node}
    frontier = [n for n in neighbors_map[start_node] if n not in occupied_tiles]
    while len(body) < target_size and frontier:
        idx = random.randint(0, len(frontier) - 1)
        curr = frontier.pop(idx)
        if curr in occupied_tiles: continue
        body.add(curr)
        for n in neighbors_map[curr]:
            if n not in body and n not in occupied_tiles and n not in frontier: frontier.append(n)
    return body

# --- World Generation ---
def generate_game_world():
    vertices, faces = create_ico_sphere(ICO_SUBDIVISIONS)
    # Initial graph build
    adj, roads_list = build_graph_from_mesh(vertices, faces)
    roads = set(roads_list)
    
    num_faces = len(faces)
    face_neighbors = find_face_neighbors(faces)
    face_terrain = ["Plain"] * num_faces
    available = set(range(num_faces))
    ocean_tiles = set()
    
    # --- Terrain Generation ---
    if SURFACE_OCEANS > 0:
        total_ocean_percent = random.uniform(MIN_SURFACE_DEEP_SEA_PERCENT, MAX_SURFACE_DEEP_SEA_PERCENT)
        total_ocean_target = int(total_ocean_percent * num_faces)
        avg_lake_size = max(5, total_ocean_target // SURFACE_OCEANS)
        for _ in range(SURFACE_OCEANS):
            if not available: break
            seed = random.choice(list(available))
            lake_size = int(avg_lake_size * random.uniform(0.8, 1.2))
            new_ocean = grow_body(seed, lake_size, ocean_tiles, face_neighbors)
            ocean_tiles.update(new_ocean)
            available -= new_ocean
            
    for i in ocean_tiles: face_terrain[i] = "Deep Sea"
    
    # Cleanup Ocean Islands
    land_indices = [i for i, t in enumerate(face_terrain) if t != "Deep Sea"]
    land_set = set(land_indices)
    
    if land_indices:
        visited = set()
        components = []
        for idx in land_indices:
            if idx not in visited:
                component = set()
                queue = deque([idx])
                visited.add(idx)
                component.add(idx)
                while queue:
                    curr = queue.popleft()
                    for n in face_neighbors[curr]:
                        if n in land_set and n not in visited:
                            visited.add(n); component.add(n); queue.append(n)
                components.append(component)
        if components:
            components.sort(key=len, reverse=True)
            for small_comp in components[1:]:
                for idx in small_comp: face_terrain[idx] = "Deep Sea"; ocean_tiles.add(idx)
    
    final_ocean_tiles = {i for i, t in enumerate(face_terrain) if t == "Deep Sea"}
    sea_tiles = set()
    for i in final_ocean_tiles:
        for n in face_neighbors[i]:
            if face_terrain[n] != "Deep Sea": sea_tiles.add(n)
    for i in sea_tiles: face_terrain[i] = "Sea"
        
    available_land = [i for i, t in enumerate(face_terrain) if t == "Plain"]
    for i in available_land:
        r = random.random()
        if r < 0.25: face_terrain[i] = "Hill"
        elif r < 0.40: face_terrain[i] = "Swamp"
            
    current_land_types = {i: t for i, t in enumerate(face_terrain)}
    forest_seeds = [i for i in available_land if current_land_types[i] == "Plain"]
    if forest_seeds:
        num_forests = int(len(available_land) * 0.05)
        for _ in range(num_forests):
            if not forest_seeds: break
            seed = random.choice(forest_seeds)
            cluster = grow_body(seed, random.randint(3, 8), final_ocean_tiles.union(sea_tiles), face_neighbors)
            for idx in cluster:
                if face_terrain[idx] not in ["Deep Sea", "Sea"]: face_terrain[idx] = "Forest"

    mountain_seeds = [i for i, t in enumerate(face_terrain) if t not in ["Deep Sea", "Sea"]]
    if mountain_seeds:
        num_ranges = int(len(available_land) * 0.02)
        for _ in range(num_ranges):
            length = random.randint(MOUNTAIN_RANGE_MIN_LENGTH, MOUNTAIN_RANGE_MAX_LENGTH)
            if not mountain_seeds: break
            curr = random.choice(mountain_seeds)
            for _ in range(length):
                face_terrain[curr] = "Mountain"
                valid_next = [n for n in face_neighbors[curr] if face_terrain[n] not in ["Deep Sea", "Sea"]]
                if not valid_next: break
                curr = random.choice(valid_next)

    final_land_indices = [i for i, t in enumerate(face_terrain) if t not in ["Deep Sea", "Sea", "Mountain"]]
    for i in final_land_indices:
        if random.random() < SPAWN_CHANCE_WASTE: face_terrain[i] = "Waste"
        is_near_plain = any(face_terrain[n] == "Plain" for n in face_neighbors[i])
        if is_near_plain and random.random() < SPAWN_CHANCE_FARM: face_terrain[i] = "Farm"

    # --- Enforce Movement Rules (Remove roads touching Sea/Deep Sea) ---
    invalid_edges = set()
    for face_idx, terrain in enumerate(face_terrain):
        if terrain in ["Sea", "Deep Sea"]:
            # Identify edges of this face
            f = faces[face_idx]
            edges = [
                tuple(sorted((f[0], f[1]))),
                tuple(sorted((f[1], f[2]))),
                tuple(sorted((f[2], f[0])))
            ]
            for e in edges:
                invalid_edges.add(e)
    
    valid_roads = roads - invalid_edges
    
    # Rebuild Adjacency from valid roads
    new_adj = {i: set() for i in range(len(vertices))}
    for u, v in valid_roads:
        new_adj[u].add(v)
        new_adj[v].add(u)
    
    face_colors = [TERRAIN_COLORS.get(t, 0xff00ff) for t in face_terrain]

    game_state["vertices"] = vertices
    game_state["faces"] = faces
    game_state["face_colors"] = face_colors
    game_state["face_terrain"] = face_terrain
    game_state["adj"] = {k: list(v) for k, v in new_adj.items()}
    game_state["roads"] = list(valid_roads)
    game_state["fortresses"] = {}
    
    # --- Generate Fortresses with Fixed Types ---
    types_keys = list(FORTRESS_TYPES.keys())
    types_probs = [FORTRESS_TYPES[k]["prob"] for k in types_keys]
    
    for i in range(len(vertices)):
        # Randomly assign a type based on probabilities
        ftype = random.choices(types_keys, types_probs)[0]
        
        game_state["fortresses"][str(i)] = {
            "id": i, 
            "owner": None, 
            "units": random.randint(NEUTRAL_GARRISON_MIN, NEUTRAL_GARRISON_MAX),
            "race": "Neutral", 
            "is_capital": False, 
            "special_active": False,
            "tier": 1, 
            "paths": [],
            "type": ftype # Permanent type
        }
    game_state["initialized"] = True

# --- AI Logic ---
def process_ai_turn():
    """AI Logic scaled by Difficulty."""
    ai_profile = AI_PROFILES.get(AI_DIFFICULTY, AI_PROFILES["Normal"])
    
    # Simulate reaction delay (simple skip turn chance)
    if random.randint(0, 10) < ai_profile["reaction_delay"]:
        return

    ai_forts = [f for f in game_state["fortresses"].values() if f['owner'] == AI_NAME]
    
    for fort in ai_forts:
        # Upgrade Logic (Cost vs Value)
        cost_next = UPGRADE_COST_TIER_2 if fort['tier'] == 1 else UPGRADE_COST_TIER_3 if fort['tier'] == 2 else 9999
        if fort['units'] > cost_next * 1.5 and fort['tier'] < 3:
             # Upgrade
             fort['units'] -= cost_next
             fort['tier'] += 1
        
        # Expansion Logic
        max_paths = fort['tier']
        if len(fort['paths']) < max_paths and fort['units'] > 15:
             neighbors = game_state["adj"].get(int(fort['id']), [])
             best_target = None
             score_best = -9999
             
             for n_id in neighbors:
                 if str(n_id) in fort['paths']: continue
                 target = game_state["fortresses"][str(n_id)]
                 
                 # AI Evaluation Score
                 score = 0
                 # Prefer weak targets
                 score -= target['units']
                 # Prefer capturing Neutral/Enemy over reinforcing (based on aggression)
                 if target['owner'] != AI_NAME:
                     score += 50 * ai_profile["expand_bias"]
                 else:
                     score -= 20 # Only reinforce if desperate
                 
                 # Type preference? Capture Farms!
                 if target['type'] == 'Farm': score += 20
                 
                 if score > score_best:
                     score_best = score
                     best_target = str(n_id)
            
             if best_target:
                 fort['paths'].append(best_target)

# --- Background Task (The Game Loop) ---
def background_thread():
    while True:
        socketio.sleep(TICK_RATE)
        if not game_state["initialized"]: continue
            
        changes_made = False
        
        # 0. Check Sector Dominance (High Ground)
        # Reset current ownership map
        face_ownership = {}
        for idx, face in enumerate(game_state["faces"]):
            v1, v2, v3 = [str(x) for x in face]
            o1 = game_state["fortresses"][v1]['owner']
            o2 = game_state["fortresses"][v2]['owner']
            o3 = game_state["fortresses"][v3]['owner']
            
            if o1 and o1 == o2 and o2 == o3:
                face_ownership[str(idx)] = o1
                # Visual: This will be sent to client to light up face
            else:
                face_ownership[str(idx)] = None
        
        if face_ownership != game_state.get("sector_owners", {}):
            game_state["sector_owners"] = face_ownership
            # We could emit a special event here if needed
            # For now, client just sees face colors update (not implemented in JS yet)
        
        # Run AI
        process_ai_turn()
        
        for fid, fort in game_state["fortresses"].items():
            f_type_stats = FORTRESS_TYPES[fort['type']]
            
            # 1. Passive Growth
            # Rules: Only if units < Capacity.
            # Bonus: If Sector Dominance active for any adjacent face?
            
            # Check Sector Dominance for this vertex
            has_dominance_bonus = False
            vertex_faces = [i for i, f in enumerate(game_state["faces"]) if int(fid) in f]
            for face_idx in vertex_faces:
                if game_state["sector_owners"].get(str(face_idx)) == fort['owner']:
                    has_dominance_bonus = True
                    break
            
            cap = f_type_stats['cap']
            if fort['owner'] and fort['units'] < cap:
                growth = 1.0 * f_type_stats['gen_mult']
                if has_dominance_bonus: growth *= 1.5 # High Ground Bonus
                
                fort['units'] = min(cap, fort['units'] + growth)
                changes_made = True
            
            # 2. Process Outgoing Paths
            if fort['paths']:
                for target_id in fort['paths']:
                    target = game_state["fortresses"].get(target_id)
                    if not target: continue
                    
                    amount = FLOW_RATE
                    
                    if target['owner'] == fort['owner']:
                        # Reinforce (Check cap at destination? Usually reinforcements can overflow slightly or soft cap)
                        # Let's allow overflow for reinforcements up to 2x cap
                        t_type = FORTRESS_TYPES[target['type']]
                        if target['units'] < t_type['cap'] * 2:
                            target['units'] += amount
                    else:
                        # Attack
                        # Defender Stats
                        def_type = FORTRESS_TYPES[target['type']]
                        def_race = RACES.get(target['race'], RACES["Neutral"])
                        def_mult = def_race.get('base_def', 1.0) * def_type['def_mod']
                        
                        # Attacker Stats
                        atk_type = FORTRESS_TYPES[fort['type']] # Units carry source stats
                        atk_race = RACES.get(fort['race'], RACES["Human"])
                        
                        # Sector Dominance Attack Bonus
                        bonus = 1.0
                        if has_dominance_bonus: bonus = 1.5
                        if fort['special_active']: bonus *= atk_race.get('special_bonus', 1.0)
                        
                        atk_power = atk_type['atk_mod'] * atk_race.get('base_atk', 1.0) * bonus
                        
                        damage = amount * atk_power
                        defense_val = target['units'] * def_mult
                        
                        if damage > defense_val:
                            # Conquered
                            target['owner'] = fort['owner']
                            target['race'] = fort['race']
                            target['units'] = 1.0
                            target['paths'] = []
                            target['tier'] = 1 # Reset tier on capture
                            # Type remains the same (Permanent Map Feature)
                        else:
                            # Defended
                            new_def_power = defense_val - damage
                            target['units'] = max(0, new_def_power / def_mult)
                    
                    changes_made = True
            
            # 3. Handle Auto-Upgrade (Optional, since we added cost)
            # If we want manual upgrade, we need UI events. 
            # For now, let's keep it automatic BUT consume resources as per rule.
            # "Upgrading costs X units"
            
            current_tier = fort['tier']
            if current_tier < 3:
                cost = UPGRADE_COST_TIER_2 if current_tier == 1 else UPGRADE_COST_TIER_3
                # Only auto-upgrade if we have significant overhead (e.g. 10 units buffer)
                if fort['units'] >= cost + 10:
                    fort['units'] -= cost
                    fort['tier'] += 1
                    changes_made = True

            # Prune paths if tier dropped (shouldn't happen unless logic changes, but safe to keep)
            if len(fort['paths']) > fort['tier']:
                fort['paths'] = fort['paths'][:fort['tier']]

        if changes_made:
            socketio.emit('update_map', game_state["fortresses"])

# --- Application Factory ---
def create_app():
    app = Flask(__name__)
    app.config.from_object('config')
    mongo.init_app(app); bcrypt.init_app(app); socketio.init_app(app); login_manager.init_app(app)

    @app.route('/')
    @login_required
    def index():
        if not current_user.username: return redirect(url_for('create_username'))
        return render_template('index.html', user=current_user)

    @app.route('/login', methods=['GET', 'POST'])
    def login():
        if current_user.is_authenticated: return redirect(url_for('index'))
        if request.method == 'POST':
            email = request.form.get('email'); password = request.form.get('password')
            try:
                user_doc = mongo.db.users.find_one({"email": email})
                if user_doc and User(user_doc).check_password(password):
                    login_user(User(user_doc))
                    return redirect(url_for('create_username')) if not User(user_doc).username else redirect(url_for('index'))
            except Exception as e: print(f"DEBUG: Login error: {e}")
            flash('Login Unsuccessful.', 'danger')
        return render_template('login.html', title='Login')

    @app.route('/register', methods=['GET', 'POST'])
    def register():
        if current_user.is_authenticated: return redirect(url_for('index'))
        if request.method == 'POST':
            email = request.form.get('email'); password = request.form.get('password')
            try:
                if mongo.db.users.find_one({"email": email}): flash('Email in use.', 'danger'); return redirect(url_for('register'))
                hashed_pw = bcrypt.generate_password_hash(password).decode('utf-8')
                mongo.db.users.insert_one({'email': email, 'password_hash': hashed_pw, 'username': None, 'race': None})
                flash('Account created!', 'success'); return redirect(url_for('login'))
            except Exception as e: print(f"DEBUG: Register error: {e}"); flash('Error.', 'danger')
        return render_template('registration.html', title='Register')

    @app.route('/logout')
    def logout(): logout_user(); return redirect(url_for('login'))
        
    @app.route('/create_username', methods=['GET', 'POST'])
    @login_required
    def create_username():
        if current_user.username: return redirect(url_for('index'))
        if request.method == 'POST':
            new_username = request.form.get('username')
            if mongo.db.users.find_one({"username": new_username}): flash('Taken.', 'danger'); return redirect(url_for('create_username'))
            mongo.db.users.update_one({'_id': ObjectId(current_user.get_id())}, {'$set': {'username': new_username, 'race': 'Human'}})
            return redirect(url_for('index'))
        return render_template('create_username.html', title='Create Username')

    @app.route('/api/gamestate')
    def get_gamestate_api():
        if not game_state["initialized"]: generate_game_world()
        return jsonify({
            "vertices": game_state["vertices"], "faces": game_state["faces"],
            "face_colors": game_state["face_colors"], "roads": game_state["roads"],
            "fortresses": game_state["fortresses"], "adj": game_state["adj"], "races": RACES
        })

    @socketio.on('connect')
    def handle_connect():
        global thread
        with thread_lock:
            if thread is None: thread = socketio.start_background_task(background_thread)
        if current_user.is_authenticated:
            assign_home_sector(current_user)
            emit('update_map', game_state["fortresses"])
            emit('update_face_colors', game_state["face_colors"])

    def assign_home_sector(user):
        """Assigns a full triangular sector (3 vertices) to the player."""
        for f in game_state["fortresses"].values():
            if f['owner'] == user.username: return # Already spawned
        
        # 1. Spawn AI if not present
        spawn_ai_sector()
        
        # 2. Spawn Player
        # Find a valid face (not Sea/Deep Sea/Mountain)
        available_faces = list(enumerate(game_state["faces"]))
        random.shuffle(available_faces)

        for i, face in available_faces:
            terrain = game_state.get("face_terrain", [])[i]
            if terrain in ["Deep Sea", "Sea", "Mountain"]: continue
            
            v1, v2, v3 = [str(x) for x in face]
            f1, f2, f3 = game_state["fortresses"][v1], game_state["fortresses"][v2], game_state["fortresses"][v3]
            
            # Ensure nobody owns any of these yet
            if f1['owner'] or f2['owner'] or f3['owner']: continue

            # Setup Home Sector
            race_color = RACES["Human"]["color"]
            game_state["face_colors"][i] = darken_color(race_color, factor=0.4)
            
            # Distribute Starting Pool
            units_per_base = STARTING_UNITS_POOL // 3
            
            for vid in [v1, v2, v3]:
                game_state["fortresses"][vid].update({
                    "owner": user.username, 
                    "units": units_per_base, 
                    "race": "Human",
                    "is_capital": True, 
                    "special_active": True, # Home sector active by default
                    "tier": 1, 
                    "paths": []
                })
            
            # Mark sector ownership
            game_state["sector_owners"][str(i)] = user.username
            
            emit('update_face_colors', game_state["face_colors"], broadcast=True)
            return

    def spawn_ai_sector():
        for f in game_state["fortresses"].values():
            if f['owner'] == AI_NAME: return
        
        available_faces = list(enumerate(game_state["faces"]))
        random.shuffle(available_faces)
        
        for i, face in available_faces:
            terrain = game_state.get("face_terrain", [])[i]
            if terrain in ["Deep Sea", "Sea", "Mountain"]: continue
            
            v1, v2, v3 = [str(x) for x in face]
            f1, f2, f3 = game_state["fortresses"][v1], game_state["fortresses"][v2], game_state["fortresses"][v3]
            
            if not f1['owner'] and not f2['owner'] and not f3['owner']:
                ai_color = RACES["Orc"]["color"]
                game_state["face_colors"][i] = darken_color(ai_color, factor=0.4)
                
                units_per_base = STARTING_UNITS_POOL // 3
                for vid in [v1, v2, v3]:
                    game_state["fortresses"][vid].update({
                        "owner": AI_NAME, "units": units_per_base, "race": "Orc",
                        "is_capital": True, "special_active": True, "tier": 1, "paths": []
                    })
                game_state["sector_owners"][str(i)] = AI_NAME
                return

    @socketio.on('submit_move')
    @login_required
    def handle_move(data):
        src_id = str(data.get('source')); tgt_id = str(data.get('target'))
        if src_id not in game_state["fortresses"] or tgt_id not in game_state["fortresses"]: return
        src_fort = game_state["fortresses"][src_id]
        if src_fort['owner'] != current_user.username: return
        
        # Check valid road (already filtered in game_state["adj"])
        if int(tgt_id) not in game_state["adj"].get(int(src_id), []): return

        if tgt_id in src_fort['paths']: src_fort['paths'].remove(tgt_id)
        else:
            if len(src_fort['paths']) < src_fort['tier']: src_fort['paths'].append(tgt_id)
        
        emit('update_map', game_state["fortresses"], broadcast=True)

    return app

if __name__ == '__main__':
    app = create_app()
    socketio.run(app, debug=True, host='127.0.0.1', port=5000)