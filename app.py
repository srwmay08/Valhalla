import os
import random
import math
import time
import threading
from collections import deque
from flask import Flask, jsonify, render_template, request, redirect, url_for, flash
from flask_pymongo import PyMongo
from flask_login import LoginManager, UserMixin, login_user, logout_user, current_user, login_required
from flask_bcrypt import Bcrypt
from flask_socketio import SocketIO, emit
from bson.objectid import ObjectId
from config import (
    RACES, MAX_PLAYERS, ICO_SUBDIVISIONS, STARTING_UNITS, NEUTRAL_GARRISON,
    TERRAIN_COLORS, SCALES, SURFACE_OCEANS, MIN_SURFACE_DEEP_SEA_PERCENT,
    MAX_SURFACE_DEEP_SEA_PERCENT, SPAWN_CHANCE_WASTE, SPAWN_CHANCE_FARM,
    MOUNTAIN_RANGE_MIN_LENGTH, MOUNTAIN_RANGE_MAX_LENGTH, NPC_STARTING_NODES, NPC_MOVE_INTERVAL
)

# --- Extension Initialization ---
mongo = PyMongo()
bcrypt = Bcrypt()
socketio = SocketIO()
login_manager = LoginManager()
login_manager.login_view = 'login'
login_manager.login_message_category = 'info'

# --- Global Game State ---
game_state = {
    "initialized": False,
    "vertices": [],
    "faces": [],
    "face_colors": [],
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
        if user_doc: return User(user_doc)
    except: pass
    return None

# --- Geometry & Graph Helpers ---
def create_ico_sphere(subdivisions):
    t = (1.0 + math.sqrt(5.0)) / 2.0
    vertices = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]]
    faces = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]]
    for _ in range(subdivisions):
        faces_subdiv, mid_cache = [], {}
        def get_mid(p1, p2):
            key = tuple(sorted((p1, p2)))
            if key in mid_cache: return mid_cache[key]
            v1, v2 = vertices[p1], vertices[p2]
            mid = [(v1[i] + v2[i]) / 2.0 for i in range(3)]
            length = math.sqrt(sum(c*c for c in mid))
            mid = [c / length for c in mid]
            idx, vertices[:] = len(vertices), vertices + [mid]
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
        edges = [tuple(sorted((face[0], face[1]))), tuple(sorted((face[1], face[2]))), tuple(sorted((face[2], face[0])))]
        for u, v in edges:
            adj[u].add(v); adj[v].add(u); roads.add((u, v))
    return {k: list(v) for k, v in adj.items()}, list(roads)

def find_face_neighbors(faces):
    edge_to_faces = {}
    for i, face in enumerate(faces):
        edges = [tuple(sorted((face[0], face[1]))), tuple(sorted((face[1], face[2]))), tuple(sorted((face[2], face[0])))]
        for edge in edges:
            edge_to_faces.setdefault(edge, []).append(i)
    neighbors = {i: set() for i in range(len(faces))}
    for edge, face_indices in edge_to_faces.items():
        if len(face_indices) == 2:
            neighbors[face_indices[0]].add(face_indices[1])
            neighbors[face_indices[1]].add(face_indices[0])
    return {k: list(v) for k, v in neighbors.items()}

def grow_body(start_node, target_size, occupied_tiles, neighbors_map):
    body = {start_node}
    frontier = [n for n in neighbors_map[start_node] if n not in occupied_tiles]
    while len(body) < target_size and frontier:
        curr = frontier.pop(random.randint(0, len(frontier) - 1))
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
    
    # Terrain Logic
    num_faces = len(faces)
    face_neighbors = find_face_neighbors(faces)
    face_terrain = ["Plain"] * num_faces 
    available = set(range(num_faces))
    ocean_tiles = set()
    
    if SURFACE_OCEANS > 0:
        percent = random.uniform(MIN_SURFACE_DEEP_SEA_PERCENT, MAX_SURFACE_DEEP_SEA_PERCENT)
        ocean_size = int((percent / SURFACE_OCEANS) * num_faces)
        for _ in range(SURFACE_OCEANS):
            if not available: break
            seed = random.choice(list(available))
            new_ocean = grow_body(seed, ocean_size, ocean_tiles, face_neighbors)
            ocean_tiles.update(new_ocean); available -= new_ocean
    for i in ocean_tiles: face_terrain[i] = "Deep Sea"
    
    sea_tiles = set()
    for i in ocean_tiles:
        for n in face_neighbors[i]:
            if n not in ocean_tiles: sea_tiles.add(n)
    for i in sea_tiles:
        if i in available: face_terrain[i] = "Sea"; available.remove(i)
            
    land_indices = list(available)
    for i in land_indices:
        r = random.random()
        if r < 0.25: face_terrain[i] = "Hill"
        elif r < 0.40: face_terrain[i] = "Swamp"

    for _ in range(int(len(land_indices) * 0.05)):
        seed = random.choice(land_indices)
        cluster = grow_body(seed, random.randint(3, 8), ocean_tiles.union(sea_tiles), face_neighbors)
        for idx in cluster: 
            if idx in land_indices: face_terrain[idx] = "Forest"

    for _ in range(int(len(land_indices) * 0.02)):
        length = random.randint(MOUNTAIN_RANGE_MIN_LENGTH, MOUNTAIN_RANGE_MAX_LENGTH)
        curr = random.choice(land_indices)
        for _ in range(length):
            face_terrain[curr] = "Mountain"
            valid_next = [n for n in face_neighbors[curr] if n in land_indices]
            if not valid_next: break
            curr = random.choice(valid_next)

    for i in land_indices:
        if face_terrain[i] != "Mountain":
            if random.random() < SPAWN_CHANCE_WASTE: face_terrain[i] = "Waste"
            if any(face_terrain[n] == "Plain" for n in face_neighbors[i]) and random.random() < SPAWN_CHANCE_FARM: face_terrain[i] = "Farm"

    face_colors = [TERRAIN_COLORS.get(t, 0xff00ff) for t in face_terrain]

    game_state.update({
        "vertices": vertices, "faces": faces, "face_colors": face_colors,
        "adj": adj, "roads": roads, "fortresses": {}, "initialized": True
    })
    
    for i in range(len(vertices)):
        game_state["fortresses"][str(i)] = {"id": i, "owner": None, "units": NEUTRAL_GARRISON, "race": "Neutral", "is_capital": False, "special_active": False}

    # SPAWN NPC OPPONENT ("Orc Horde")
    available_bases = [k for k,v in game_state["fortresses"].items() if v["owner"] is None]
    for _ in range(NPC_STARTING_NODES):
        if available_bases:
            nid = random.choice(available_bases)
            available_bases.remove(nid)
            game_state["fortresses"][nid].update({"owner": "Orc Horde", "units": STARTING_UNITS, "race": "Orc", "is_capital": True})

# --- NPC Logic ---
def npc_game_loop(app):
    with app.app_context():
        while True:
            time.sleep(NPC_MOVE_INTERVAL)
            if not game_state.get("initialized"): continue
            
            # Simple AI: Find all Orc bases, check neighbors, attack if stronger
            orc_bases = [f for f in game_state["fortresses"].values() if f["owner"] == "Orc Horde"]
            moves_made = False
            
            for base in orc_bases:
                if base["units"] < 10: continue # Too weak to attack
                
                neighbors_idx = game_state["adj"].get(base["id"], [])
                targets = []
                for n_idx in neighbors_idx:
                    neighbor = game_state["fortresses"][str(n_idx)]
                    # Attack enemies or neutrals, reinforce own if very weak
                    if neighbor["owner"] != "Orc Horde":
                        targets.append(neighbor)
                
                if targets:
                    # Pick weakest target
                    target = min(targets, key=lambda x: x["units"])
                    
                    # Attack logic
                    amount = int(base["units"] * 0.5) # Send 50%
                    if amount > target["units"]: # Only attack if likely to win or damage
                         process_attack(str(base["id"]), str(target["id"]), amount, "Orc Horde")
                         moves_made = True

            if moves_made:
                socketio.emit('update_map', game_state["fortresses"])

def process_attack(src_id, tgt_id, amount, player_name):
    src_fort = game_state["fortresses"][src_id]
    tgt_fort = game_state["fortresses"][tgt_id]
    
    src_fort['units'] -= amount
    
    attacker_race_data = RACES.get(src_fort['race'], RACES["Neutral"])
    atk_mult = attacker_race_data['base_atk']
    if src_fort['special_active']: atk_mult *= attacker_race_data['special_bonus']
    
    attack_power = amount * atk_mult
    
    # Emit Animation Event
    socketio.emit('troop_movement', {
        "source": src_id,
        "target": tgt_id,
        "race": src_fort['race'],
        "count": amount
    })
    
    if tgt_fort['owner'] == player_name:
        tgt_fort['units'] += amount
    else:
        defender_race = RACES.get(tgt_fort['race'], RACES["Neutral"])
        def_mult = defender_race['base_def']
        defense_power = tgt_fort['units'] * def_mult
        
        if attack_power > defense_power:
            tgt_fort['owner'] = player_name
            tgt_fort['race'] = src_fort['race']
            tgt_fort['units'] = max(1, int((attack_power - defense_power) / atk_mult)) # Rough conversion back
            check_special_units_unlock(int(tgt_id), player_name)
        else:
            damage = int(attack_power / def_mult)
            tgt_fort['units'] = max(0, tgt_fort['units'] - damage)

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
            email, password = request.form.get('email'), request.form.get('password')
            try:
                user_doc = mongo.db.users.find_one({"email": email})
                if user_doc and User(user_doc).check_password(password):
                    user = User(user_doc)
                    login_user(user)
                    return redirect(url_for('create_username') if not user.username else 'index')
            except: pass
            flash('Login Failed', 'danger')
        return render_template('login.html', title='Login')

    @app.route('/register', methods=['GET', 'POST'])
    def register():
        if current_user.is_authenticated: return redirect(url_for('index'))
        if request.method == 'POST':
            email, password = request.form.get('email'), request.form.get('password')
            if mongo.db.users.find_one({"email": email}):
                flash('Email exists.', 'danger'); return redirect(url_for('register'))
            mongo.db.users.insert_one({'email': email, 'password_hash': bcrypt.generate_password_hash(password).decode('utf-8'), 'username': None, 'race': None})
            return redirect(url_for('login'))
        return render_template('registration.html', title='Register')

    @app.route('/logout')
    def logout(): logout_user(); return redirect(url_for('login'))
        
    @app.route('/create_username', methods=['GET', 'POST'])
    @login_required
    def create_username():
        if current_user.username: return redirect(url_for('index'))
        if request.method == 'POST':
            new_username = request.form.get('username')
            selected_race = request.form.get('race', 'Human')
            mongo.db.users.update_one({'_id': ObjectId(current_user.get_id())}, {'$set': {'username': new_username, 'race': selected_race}})
            return redirect(url_for('index'))
        return render_template('create_username.html', title='Create Username')

    @app.route('/api/gamestate')
    def get_gamestate_api():
        if not game_state["initialized"]: generate_game_world()
        return jsonify({k:v for k,v in game_state.items() if k != "adj" and k != "initialized" } | {"roads": game_state["roads"], "races": RACES})

    @socketio.on('connect')
    def handle_connect():
        if current_user.is_authenticated:
            assign_home_base(current_user)
            emit('update_map', game_state["fortresses"])

    def assign_home_base(user):
        for f in game_state["fortresses"].values():
            if f['owner'] == user.username: return
        for face in game_state["faces"]:
            v1, v2, v3 = [str(x) for x in face]
            f1, f2, f3 = game_state["fortresses"][v1], game_state["fortresses"][v2], game_state["fortresses"][v3]
            if f1['owner'] is None and f2['owner'] is None and f3['owner'] is None:
                user_race = mongo.db.users.find_one({"_id": ObjectId(user.get_id())}).get("race", "Human")
                for vid in [v1, v2, v3]:
                    game_state["fortresses"][vid].update({"owner": user.username, "units": STARTING_UNITS, "race": user_race, "is_capital": True, "special_active": True})
                return

    @socketio.on('submit_move')
    @login_required
    def handle_move(data):
        src_id, tgt_id = str(data.get('source')), str(data.get('target'))
        amount = int(data.get('amount', 0))
        
        # Validations
        if src_id not in game_state["fortresses"] or tgt_id not in game_state["fortresses"]: return
        if game_state["fortresses"][src_id]['owner'] != current_user.username: return
        if int(tgt_id) not in game_state["adj"].get(int(src_id), []): return
        
        process_attack(src_id, tgt_id, amount, current_user.username)
        emit('update_map', game_state["fortresses"], broadcast=True)

    # Start NPC Thread
    if not os.environ.get("WERKZEUG_RUN_MAIN") == "true": # Prevent double run in debug mode
        thread = threading.Thread(target=npc_game_loop, args=(app,))
        thread.daemon = True
        thread.start()

    return app

if __name__ == '__main__':
    app = create_app()
    socketio.run(app, debug=True, host='127.0.0.1', port=5000)