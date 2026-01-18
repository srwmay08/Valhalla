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
    RACES, MAX_PLAYERS, ICO_SUBDIVISIONS, NEUTRAL_GARRISON,
    TERRAIN_COLORS, SCALES, SURFACE_OCEANS, MIN_SURFACE_DEEP_SEA_PERCENT,
    MAX_SURFACE_DEEP_SEA_PERCENT, SPAWN_CHANCE_WASTE, SPAWN_CHANCE_FARM,
    MOUNTAIN_RANGE_MIN_LENGTH, MOUNTAIN_RANGE_MAX_LENGTH
)

# --- Overrides & Constants ---
# Force Human to Red as requested
RACES["Human"]["color"] = 0xff0000
RACES["Orc"]["color"] = 0x00ff00    # Ensure AI (Orc) is Green/distinct

# Game Mechanics
TIER_2_THRESHOLD = 50
TIER_3_THRESHOLD = 120
PASSIVE_GROWTH = 1.0     # Units gained per tick if idle
FLOW_RATE = 0.5          # Units delivered per tick per path (0.5/sec = 10s for 5 units)
TICK_RATE = 1.0          # 1 Second per tick for precise timing

# Starting Conditions (Overrides Config)
PLAYER_STARTING_UNITS = 15
PLAYER_STARTING_TIER = 1

# --- AI Configuration ---
AI_BOTS = [
    {"name": "Gorgon", "race": "Orc", "color": 0xff3333},
    {"name": "Hydra", "race": "Troll", "color": 0x00cc66},
    {"name": "Chimera", "race": "Dark Elf", "color": 0x9933ff}
]

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
    "fortresses": {}
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

def check_special_units_unlock(vertex_id, owner_name):
    adj_faces = [f for f in game_state["faces"] if vertex_id in f]
    for face in adj_faces:
        v1, v2, v3 = face
        f1, f2, f3 = game_state["fortresses"][str(v1)], game_state["fortresses"][str(v2)], game_state["fortresses"][str(v3)]
        if f1['owner'] == owner_name and f2['owner'] == owner_name and f3['owner'] == owner_name:
            f1['special_active'] = True; f2['special_active'] = True; f3['special_active'] = True

def generate_game_world():
    vertices, faces = create_ico_sphere(ICO_SUBDIVISIONS)
    adj, roads = build_graph_from_mesh(vertices, faces)

    num_faces = len(faces)
    face_neighbors = find_face_neighbors(faces)
    face_terrain = ["Plain"] * num_faces
    available = set(range(num_faces))
    ocean_tiles = set()

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

    face_colors = [TERRAIN_COLORS.get(t, 0xff00ff) for t in face_terrain]

    game_state["vertices"] = vertices
    game_state["faces"] = faces
    game_state["face_colors"] = face_colors
    game_state["face_terrain"] = face_terrain
    game_state["adj"] = adj
    game_state["roads"] = roads
    game_state["fortresses"] = {}

    for i in range(len(vertices)):
        # Neutrals random between 5 and 100
        rand_units = random.randint(5, 100)
        game_state["fortresses"][str(i)] = {
            "id": i, "owner": None, "units": rand_units,
            "race": "Neutral", "is_capital": False, "special_active": False,
            "tier": 1, "paths": []
        }
    game_state["initialized"] = True

# --- AI Logic ---
def process_ai_turn():
    """Simple AI that expands when tier/units are sufficient for all active bots."""
    active_ai_names = [bot["name"] for bot in AI_BOTS]
    ai_forts = [f for f in game_state["fortresses"].values() if f['owner'] in active_ai_names]

    for fort in ai_forts:
        # 1. Growth Strategy
        # If below Tier 2 threshold, prioritize growth -> Unlink paths
        if fort['units'] < TIER_2_THRESHOLD and fort['tier'] < 2:
            if fort['paths']:
                fort['paths'] = [] # Cut all paths to grow

        # 2. Expansion Strategy
        # If strong enough, find a target
        elif fort['units'] >= 25: # Aggressive early expansion
            max_paths = fort['tier']
            if len(fort['paths']) < max_paths:
                # Find valid neighbors
                neighbors = game_state["adj"].get(int(fort['id']), [])
                best_target = None
                lowest_def = 9999

                for n_id in neighbors:
                    target = game_state["fortresses"][str(n_id)]
                    # Don't attack self (unless reinforcing, but let's stick to conquest for AI)
                    if target['owner'] == fort['owner']:
                        continue

                    # Attack weakest neighbor
                    if target['units'] < lowest_def:
                        lowest_def = target['units']
                        best_target = str(n_id)

                if best_target and best_target not in fort['paths']:
                    fort['paths'].append(best_target)

def resolve_combat(attacker_fort, target_fort, amount):
    """Calculates damage and updates target units/owner."""
    defender_race = RACES.get(target_fort['race'], {"base_def": 1.0})
    if target_fort['race'] == "Neutral": defender_race = {"base_def": 1.0}
    def_mult = defender_race.get('base_def', 1.0)

    attacker_race_stats = RACES.get(attacker_fort['race'], RACES["Human"])
    atk_mult = attacker_race_stats['base_atk'] * (attacker_race_stats['special_bonus'] if attacker_fort['special_active'] else 1.0)

    damage = amount * atk_mult
    defense_val = target_fort['units'] * def_mult

    if damage > defense_val:
        # Conquered
        target_fort['owner'] = attacker_fort['owner']
        target_fort['race'] = attacker_fort['race']
        target_fort['units'] = 1.0
        target_fort['paths'] = []
        target_fort['tier'] = 1
        check_special_units_unlock(int(target_fort['id']), attacker_fort['owner'])
    else:
        # Defended
        new_def_power = defense_val - damage
        target_fort['units'] = max(0, new_def_power / def_mult)

def apply_flow(source, target, amount):
    """
    Helper to apply unit flow from source to target.
    Handles reinforcement, attacking, and Tier 3 Overflow.
    """
    # 1. Overflow Logic (The "Beneficial Interlink")
    # If target is friendly, Tier 3, and has outgoing paths, pass the units along.
    if target['owner'] == source['owner'] and target['tier'] >= 3 and target['paths']:
        # Split the amount among the target's own paths
        split_amount = amount / len(target['paths'])
        for next_target_id in target['paths']:
            next_target = game_state["fortresses"].get(next_target_id)
            if next_target:
                # Recursively apply flow (1 level deep to prevent infinite loops)
                # If friendly, just add; if enemy, resolve combat
                if next_target['owner'] == source['owner']:
                    next_target['units'] += split_amount
                else:
                    resolve_combat(source, next_target, split_amount)
        return # Units were passed through, so do not add to current target

    # 2. Standard Resolution (Reinforce or Attack)
    if target['owner'] == source['owner']:
        target['units'] += amount
    else:
        resolve_combat(source, target, amount)

# --- Background Task (The Game Loop) ---
def background_thread():
    while True:
        socketio.sleep(TICK_RATE)
        if not game_state["initialized"]: continue

        changes_made = False

        # Run AI Logic
        process_ai_turn()

        for fid, fort in game_state["fortresses"].items():
            # 1. Passive Growth (Only if no outgoing paths)
            if fort['owner'] and not fort['paths']:
                fort['units'] += PASSIVE_GROWTH
                changes_made = True

            # 2. Process Outgoing Paths (Infinite Stream)
            if fort['paths']:
                for target_id in fort['paths']:
                    target = game_state["fortresses"].get(target_id)
                    if not target: continue

                    # Logic: Units are created by the connection, not drained from source
                    apply_flow(fort, target, FLOW_RATE)
                    changes_made = True

            # 3. Update Tier
            current_units = fort['units']
            old_tier = fort['tier']
            new_tier = 1
            if current_units >= TIER_3_THRESHOLD: new_tier = 3
            elif current_units >= TIER_2_THRESHOLD: new_tier = 2

            if new_tier != old_tier:
                fort['tier'] = new_tier
                changes_made = True
                # CRITICAL FIX: Only cut paths if we can't support them anymore
                if len(fort['paths']) > new_tier:
                    fort['paths'] = fort['paths'][:new_tier]

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
            assign_home_base(current_user)
            emit('update_map', game_state["fortresses"])
            emit('update_face_colors', game_state["face_colors"])

    def assign_home_base(user):
        # Ensure NPCs are present
        spawn_ai()

        for f in game_state["fortresses"].values():
            if f['owner'] == user.username: return

        # Spawn Player
        available_faces = list(enumerate(game_state["faces"]))
        random.shuffle(available_faces)

        for i, face in available_faces:
            terrain = game_state.get("face_terrain", [])[i]
            if terrain in ["Deep Sea", "Sea", "Mountain"]: continue

            # Don't spawn on top of anyone
            v1, v2, v3 = [str(x) for x in face]
            if game_state["fortresses"][v1]['owner'] or game_state["fortresses"][v2]['owner']: continue

            # Setup Home - FIXED: Start at 15 units, Tier 1
            race_color = RACES["Human"]["color"]
            game_state["face_colors"][i] = darken_color(race_color, factor=0.4)
            for vid in [v1, v2, v3]:
                game_state["fortresses"][vid].update({
                    "owner": user.username, "units": PLAYER_STARTING_UNITS, "race": "Human",
                    "is_capital": True, "special_active": True, "tier": PLAYER_STARTING_TIER, "paths": []
                })
                # Set neighbors to 5 (random small amount for farming)
                for n_id in game_state["adj"].get(int(vid), []):
                    if game_state["fortresses"][str(n_id)]['owner'] is None:
                        game_state["fortresses"][str(n_id)]['units'] = 5

            emit('update_face_colors', game_state["face_colors"], broadcast=True)
            return

    def spawn_ai():
        # Spawn all bots if not present
        available_faces = list(enumerate(game_state["faces"]))
        random.shuffle(available_faces)

        for bot in AI_BOTS:
            if any(f['owner'] == bot['name'] for f in game_state["fortresses"].values()):
                continue

            for i, face in available_faces:
                terrain = game_state.get("face_terrain", [])[i]
                if terrain in ["Deep Sea", "Sea", "Mountain"]: continue

                v1, v2, v3 = [str(x) for x in face]
                f1, f2, f3 = game_state["fortresses"][v1], game_state["fortresses"][v2], game_state["fortresses"][v3]
                if not f1['owner'] and not f2['owner'] and not f3['owner']:
                    # Spawn AI - FIXED: Start at 15 units, Tier 1
                    ai_color = bot['color']
                    game_state["face_colors"][i] = darken_color(ai_color, factor=0.4)
                    for vid in [v1, v2, v3]:
                        game_state["fortresses"][vid].update({
                            "owner": bot['name'], "units": PLAYER_STARTING_UNITS, "race": bot['race'],
                            "is_capital": True, "special_active": True, "tier": PLAYER_STARTING_TIER, "paths": []
                        })
                    available_faces.remove((i, face)) # Taken
                    break

    @socketio.on('submit_move')
    @login_required
    def handle_move(data):
        src_id = str(data.get('source')); tgt_id = str(data.get('target'))
        if src_id not in game_state["fortresses"] or tgt_id not in game_state["fortresses"]: return
        src_fort = game_state["fortresses"][src_id]
        if src_fort['owner'] != current_user.username: return
        if int(tgt_id) not in game_state["adj"].get(int(src_id), []): return

        if tgt_id in src_fort['paths']: src_fort['paths'].remove(tgt_id)
        else:
            if len(src_fort['paths']) < src_fort['tier']: src_fort['paths'].append(tgt_id)

        emit('update_map', game_state["fortresses"], broadcast=True)

    return app

if __name__ == '__main__':
    app = create_app()
    socketio.run(app, debug=True, host='127.0.0.1', port=5000)