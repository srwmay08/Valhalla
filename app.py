import os
import random
import math
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
    MOUNTAIN_RANGE_MIN_LENGTH, MOUNTAIN_RANGE_MAX_LENGTH
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
    "face_colors": [],      # NEW: Stores the hex color for each face
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
    vertices = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]]
    faces = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]]
    
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
        edges = [tuple(sorted((face[0], face[1]))), tuple(sorted((face[1], face[2]))), tuple(sorted((face[2], face[0])))]
        for u, v in edges:
            adj[u].add(v)
            adj[v].add(u)
            roads.add((u, v))
    return {k: list(v) for k, v in adj.items()}, list(roads)

# --- Terrain Generation Helpers ---
def find_face_neighbors(faces):
    # Map edges to faces to find which faces share an edge
    edge_to_faces = {}
    for i, face in enumerate(faces):
        edges = [tuple(sorted((face[0], face[1]))), tuple(sorted((face[1], face[2]))), tuple(sorted((face[2], face[0])))]
        for edge in edges:
            if edge not in edge_to_faces: edge_to_faces[edge] = []
            edge_to_faces[edge].append(i)
    
    neighbors = {i: set() for i in range(len(faces))}
    for edge, face_indices in edge_to_faces.items():
        if len(face_indices) == 2:
            f1, f2 = face_indices
            neighbors[f1].add(f2)
            neighbors[f2].add(f1)
    return {k: list(v) for k, v in neighbors.items()}

def grow_body(start_node, target_size, occupied_tiles, neighbors_map):
    body = {start_node}
    frontier = [n for n in neighbors_map[start_node] if n not in occupied_tiles]
    while len(body) < target_size and frontier:
        curr = frontier.pop(random.randint(0, len(frontier) - 1))
        if curr in occupied_tiles: continue
        body.add(curr)
        for n in neighbors_map[curr]:
            if n not in body and n not in occupied_tiles and n not in frontier:
                frontier.append(n)
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
    
    # --- Terrain Generation ---
    num_faces = len(faces)
    face_neighbors = find_face_neighbors(faces)
    face_terrain = ["Plain"] * num_faces # Default
    available = set(range(num_faces))
    ocean_tiles = set()
    
    # 1. Oceans
    if SURFACE_OCEANS > 0:
        percent = random.uniform(MIN_SURFACE_DEEP_SEA_PERCENT, MAX_SURFACE_DEEP_SEA_PERCENT)
        ocean_size = int((percent / SURFACE_OCEANS) * num_faces)
        for _ in range(SURFACE_OCEANS):
            if not available: break
            seed = random.choice(list(available))
            new_ocean = grow_body(seed, ocean_size, ocean_tiles, face_neighbors)
            ocean_tiles.update(new_ocean)
            available -= new_ocean
            
    for i in ocean_tiles: face_terrain[i] = "Deep Sea"
    
    # 2. Shallow Seas (Borders of Deep Sea)
    sea_tiles = set()
    for i in ocean_tiles:
        for n in face_neighbors[i]:
            if n not in ocean_tiles: sea_tiles.add(n)
    for i in sea_tiles:
        if i in available:
            face_terrain[i] = "Sea"
            available.remove(i)
            
    land_indices = list(available)
    
    # 3. Random Hills/Swamps/Forests
    for i in land_indices:
        r = random.random()
        if r < 0.25: face_terrain[i] = "Hill"
        elif r < 0.40: face_terrain[i] = "Swamp"
        
    # 4. Forest Clusters
    for _ in range(int(len(land_indices) * 0.05)):
        seed = random.choice(land_indices)
        cluster = grow_body(seed, random.randint(3, 8), ocean_tiles.union(sea_tiles), face_neighbors)
        for idx in cluster:
            if idx in land_indices: face_terrain[idx] = "Forest"

    # 5. Mountain Ranges
    for _ in range(int(len(land_indices) * 0.02)):
        length = random.randint(MOUNTAIN_RANGE_MIN_LENGTH, MOUNTAIN_RANGE_MAX_LENGTH)
        curr = random.choice(land_indices)
        for _ in range(length):
            face_terrain[curr] = "Mountain"
            valid_next = [n for n in face_neighbors[curr] if n in land_indices]
            if not valid_next: break
            curr = random.choice(valid_next)

    # 6. Waste & Farms
    for i in land_indices:
        if face_terrain[i] != "Mountain":
            if random.random() < SPAWN_CHANCE_WASTE: face_terrain[i] = "Waste"
            # Farm check: needs a neighbor plain
            is_near_plain = any(face_terrain[n] == "Plain" for n in face_neighbors[i])
            if is_near_plain and random.random() < SPAWN_CHANCE_FARM: face_terrain[i] = "Farm"

    # Map terrain to colors
    face_colors = [TERRAIN_COLORS.get(t, 0xff00ff) for t in face_terrain]

    # --- Game Logic Setup ---
    game_state["vertices"] = vertices
    game_state["faces"] = faces
    game_state["face_colors"] = face_colors
    game_state["adj"] = adj
    game_state["roads"] = roads
    game_state["fortresses"] = {}
    for i in range(len(vertices)):
        game_state["fortresses"][str(i)] = {"id": i, "owner": None, "units": NEUTRAL_GARRISON, "race": "Neutral", "is_capital": False, "special_active": False}
    game_state["initialized"] = True

# --- Application Factory ---
def create_app():
    app = Flask(__name__)
    app.config.from_object('config')

    mongo.init_app(app)
    bcrypt.init_app(app)
    socketio.init_app(app)
    login_manager.init_app(app)

    # --- Routes ---
    @app.route('/')
    @login_required
    def index():
        if not current_user.username:
            return redirect(url_for('create_username'))
        return render_template('index.html', user=current_user)

    @app.route('/login', methods=['GET', 'POST'])
    def login():
        if current_user.is_authenticated:
            return redirect(url_for('index'))
        if request.method == 'POST':
            email = request.form.get('email')
            password = request.form.get('password')
            try:
                user_doc = mongo.db.users.find_one({"email": email})
                if user_doc:
                    user = User(user_doc)
                    if user.check_password(password):
                        login_user(user)
                        if not user.username: return redirect(url_for('create_username'))
                        return redirect(url_for('index'))
            except Exception as e:
                print(f"DEBUG: Login error: {e}")
            flash('Login Unsuccessful. Check email/password or MongoDB connection.', 'danger')
        return render_template('login.html', title='Login')

    @app.route('/register', methods=['GET', 'POST'])
    def register():
        if current_user.is_authenticated: return redirect(url_for('index'))
        if request.method == 'POST':
            email = request.form.get('email')
            password = request.form.get('password')
            try:
                if mongo.db.users.find_one({"email": email}):
                    flash('Email in use.', 'danger')
                    return redirect(url_for('register'))
                hashed_pw = bcrypt.generate_password_hash(password).decode('utf-8')
                mongo.db.users.insert_one({'email': email, 'password_hash': hashed_pw, 'username': None, 'race': None})
                flash('Account created! Please log in.', 'success')
                return redirect(url_for('login'))
            except Exception as e:
                print(f"DEBUG: Register error: {e}")
                flash('Error creating account.', 'danger')
        return render_template('registration.html', title='Register')

    @app.route('/logout')
    def logout():
        logout_user()
        return redirect(url_for('login'))
        
    @app.route('/create_username', methods=['GET', 'POST'])
    @login_required
    def create_username():
        if current_user.username: return redirect(url_for('index'))
        if request.method == 'POST':
            new_username = request.form.get('username')
            selected_race = request.form.get('race', 'Human')
            if mongo.db.users.find_one({"username": new_username}):
                flash('Username taken.', 'danger')
                return redirect(url_for('create_username'))
            mongo.db.users.update_one({'_id': ObjectId(current_user.get_id())}, {'$set': {'username': new_username, 'race': selected_race}})
            return redirect(url_for('index'))
        return render_template('create_username.html', title='Create Username')

    @app.route('/api/gamestate')
    def get_gamestate_api():
        if not game_state["initialized"]:
            generate_game_world()
        return jsonify({
            "vertices": game_state["vertices"],
            "faces": game_state["faces"],
            "face_colors": game_state["face_colors"], # Sending terrain colors
            "roads": game_state["roads"],
            "fortresses": game_state["fortresses"],
            "races": RACES
        })

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
        src_id, tgt_id, amount = str(data.get('source')), str(data.get('target')), int(data.get('amount', 0))
        if src_id not in game_state["fortresses"] or tgt_id not in game_state["fortresses"]: return
        src_fort, tgt_fort = game_state["fortresses"][src_id], game_state["fortresses"][tgt_id]
        
        if src_fort['owner'] != current_user.username or amount <= 0 or src_fort['units'] <= amount: return
        if int(tgt_id) not in game_state["adj"].get(int(src_id), []): return

        src_fort['units'] -= amount
        attacker_race = RACES.get(src_fort['race'], RACES["Human"])
        atk_mult = attacker_race['base_atk'] * (attacker_race['special_bonus'] if src_fort['special_active'] else 1.0)
        attack_power = amount * atk_mult
        
        if tgt_fort['owner'] == current_user.username:
            tgt_fort['units'] += amount
        else:
            defender_race = RACES.get(tgt_fort['race'], RACES["Human"]) if tgt_fort['race'] != "Neutral" else {"base_def": 1.0}
            def_mult = defender_race.get('base_def', 1.0)
            defense_power = tgt_fort['units'] * def_mult
            
            if attack_power > defense_power:
                tgt_fort['owner'] = current_user.username; tgt_fort['race'] = src_fort['race']; tgt_fort['units'] = max(1, int(attack_power - defense_power))
                check_special_units_unlock(int(tgt_id), current_user.username)
            else:
                tgt_fort['units'] = max(0, tgt_fort['units'] - int(attack_power / def_mult))
        emit('update_map', game_state["fortresses"], broadcast=True)

    return app

if __name__ == '__main__':
    app = create_app()
    socketio.run(app, debug=True, host='127.0.0.1', port=5000)