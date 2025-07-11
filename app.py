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
from config import (TERRAIN_COLORS, SCALES, MIN_SURFACE_DEEP_SEA_PERCENT,
                    MAX_SURFACE_DEEP_SEA_PERCENT, MIN_SUBTERRANEAN_SEA_PERCENT,
                    MAX_SUBTERRANEAN_SEA_PERCENT, SPAWN_CHANCE_WASTE,
                    SPAWN_CHANCE_FARM, SPAWN_CHANCE_CAVERN, SURFACE_OCEANS,
                    SUBTERRANEAN_SEAS, LAVA_RIVERS, NUM_LAVA_RIVERS,
                    LAVA_RIVERS_MIN_LENGTH, LAVA_RIVERS_MAX_LENGTH,
                    MOUNTAIN_RANGE_MIN_LENGTH, MOUNTAIN_RANGE_MAX_LENGTH)

# --- Extension Initialization ---
mongo = PyMongo()
bcrypt = Bcrypt()
socketio = SocketIO()
login_manager = LoginManager()
login_manager.login_view = 'login'
login_manager.login_message_category = 'info'

# --- Global World State ---
world_data = {"tiles": [], "vertices": [], "faces": [], "neighbors": {}}


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
    user_doc = mongo.db.users.find_one({"_id": ObjectId(user_id)})
    if user_doc:
        return User(user_doc)
    return None

# --- Helper function to get ownership data ---
def get_ownership_data():
    ownership = {}
    query = {"selected_tile_id": {"$ne": None}, "username": {"$ne": None}}
    for user in mongo.db.users.find(query):
        ownership[user["username"]] = user["selected_tile_id"]
    return ownership

# --- World Generation and other Helper Functions ---
def create_ico_sphere(subdivisions):
    t = (1.0 + math.sqrt(5.0)) / 2.0
    vertices = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]]
    faces = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]]
    for _ in range(subdivisions):
        faces_subdiv, mid_cache = [], {}
        for tri in faces:
            v1, v2, v3 = tri
            def get_mid(p1, p2):
                key = tuple(sorted((p1, p2)))
                if key in mid_cache: return mid_cache[key]
                v_p1, v_p2 = vertices[p1], vertices[p2]
                mid_v = [(v_p1[i] + v_p2[i]) / 2.0 for i in range(3)]
                mid_idx = len(vertices)
                vertices.append(mid_v)
                mid_cache[key] = mid_idx
                return mid_idx
            a, b, c = get_mid(v1, v2), get_mid(v2, v3), get_mid(v3, v1)
            faces_subdiv.extend([[v1, a, c], [v2, b, a], [v3, c, b], [a, b, c]])
        faces = faces_subdiv
    for i in range(len(vertices)):
        length = math.sqrt(sum(c * c for c in vertices[i]))
        if length > 0:
            vertices[i] = [c / length for c in vertices[i]]
    return vertices, faces

def find_all_neighbors(faces):
    edge_to_faces = {}
    for i, face in enumerate(faces):
        edges = [tuple(sorted((face[0], face[1]))), tuple(sorted((face[1], face[2]))), tuple(sorted((face[2], face[0])))]
        for edge in edges:
            if edge not in edge_to_faces:
                edge_to_faces[edge] = []
            edge_to_faces[edge].append(i)
    neighbors = {i: set() for i in range(len(faces))}
    for edge, face_indices in edge_to_faces.items():
        if len(face_indices) == 2:
            face1, face2 = face_indices
            neighbors[face1].add(face2)
            neighbors[face2].add(face1)
    return {k: list(v) for k, v in neighbors.items()}

def grow_body(start_node, target_size, occupied_tiles, neighbors_map):
    body_tiles = {start_node}
    frontier = [n for n in neighbors_map[start_node] if n not in occupied_tiles]
    while len(body_tiles) < target_size and frontier:
        current_node = frontier.pop(random.randint(0, len(frontier) - 1))
        if current_node in occupied_tiles:
            continue
        body_tiles.add(current_node)
        for neighbor in neighbors_map[current_node]:
            if neighbor not in body_tiles and neighbor not in occupied_tiles and neighbor not in frontier:
                frontier.append(neighbor)
    return body_tiles

def generate_lava_river(start_node, length, occupied_tiles, neighbors_map):
    river_tiles = {start_node}
    curr, prev = start_node, -1
    for _ in range(length - 1):
        options = [n for n in neighbors_map[curr] if n not in occupied_tiles]
        if not options:
            break
        forward_options = [n for n in options if n != prev]
        if len(forward_options) > 0 and random.random() < 0.7:
            next_node = random.choice(forward_options)
        else:
            next_node = random.choice(options)
        river_tiles.add(next_node)
        occupied_tiles.add(next_node)
        prev, curr = curr, next_node
    return river_tiles

def generate_world_data():
    base_vertices, base_faces = create_ico_sphere(subdivisions=5)
    neighbors_map = find_all_neighbors(base_faces)
    world_data.update({"vertices": base_vertices, "faces": base_faces, "neighbors": neighbors_map})
    num_tiles = len(base_faces)
    world_data["tiles"] = [{"surface_id": i,"subterranean_id": i + num_tiles,"surface_terrain": None,"subterranean_terrain": None, "has_cavern": False,"scales": {s: 0 for s in SCALES}} for i in range(num_tiles)]
    available_surface_tiles = set(range(num_tiles)); surface_ocean_tiles = set(); deep_sea_percentage = random.uniform(MIN_SURFACE_DEEP_SEA_PERCENT, MAX_SURFACE_DEEP_SEA_PERCENT)
    if SURFACE_OCEANS > 0:
        ocean_size = int((deep_sea_percentage / SURFACE_OCEANS) * num_tiles)
        for _ in range(SURFACE_OCEANS):
            if not available_surface_tiles: break
            seed = random.choice(list(available_surface_tiles)); new_ocean = grow_body(seed, ocean_size, surface_ocean_tiles, neighbors_map); surface_ocean_tiles.update(new_ocean); available_surface_tiles -= new_ocean
    for i in surface_ocean_tiles: world_data["tiles"][i]["surface_terrain"] = "Deep Sea"
    sea_indices = set()
    for i in surface_ocean_tiles:
        for neighbor_id in neighbors_map[i]:
            if neighbor_id not in surface_ocean_tiles: sea_indices.add(neighbor_id)
    for i in sea_indices:
        if i in available_surface_tiles: world_data["tiles"][i]["surface_terrain"] = "Sea"; available_surface_tiles.remove(i)
    land_indices = list(available_surface_tiles)
    for i in land_indices: world_data["tiles"][i]["surface_terrain"]="Plain"
    for i in land_indices:
        if random.random()<0.25: world_data["tiles"][i]["surface_terrain"]="Hill"
        elif random.random()<0.15: world_data["tiles"][i]["surface_terrain"]="Swamp"
    for _ in range(int(len(land_indices) * 0.01)):
        seed, cluster_size = random.choice(land_indices), random.randint(5, 20); q, visited = deque([seed]), {seed};
        for _ in range(cluster_size):
            if not q: break
            curr = q.popleft(); world_data["tiles"][curr]["surface_terrain"] = "Forest"
            for n in neighbors_map[curr]:
                if n in land_indices and n not in visited: q.append(n); visited.add(n)
    for _ in range(int(len(land_indices) * 0.005)):
        range_len = random.randint(MOUNTAIN_RANGE_MIN_LENGTH, MOUNTAIN_RANGE_MAX_LENGTH); seed = random.choice(land_indices);
        for _ in range(range_len):
            if seed not in land_indices: break
            world_data["tiles"][seed]["surface_terrain"] = "Mountain"; valid = [n for n in neighbors_map[seed] if n in land_indices]; seed = random.choice(valid) if valid else -1
    for i in land_indices:
        if world_data["tiles"][i]["surface_terrain"] != "Mountain" and random.random() < SPAWN_CHANCE_WASTE: world_data["tiles"][i]["surface_terrain"] = "Waste"
        is_near_plain = any(world_data["tiles"][n]["surface_terrain"] == "Plain" for n in neighbors_map[i]);
        if is_near_plain and random.random() < SPAWN_CHANCE_FARM: world_data["tiles"][i]["surface_terrain"] = "Farm"
    available_sub_tiles = set(range(num_tiles)); sub_sea_percentage = random.uniform(MIN_SUBTERRANEAN_SEA_PERCENT, MAX_SUBTERRANEAN_SEA_PERCENT)
    if SUBTERRANEAN_SEAS > 0:
        sub_sea_size = int((sub_sea_percentage * num_tiles) / SUBTERRANEAN_SEAS)
        for _ in range(SUBTERRANEAN_SEAS):
            if not available_sub_tiles: break
            seed = random.choice(list(available_sub_tiles)); new_sea = grow_body(seed, sub_sea_size, set(range(num_tiles)) - available_sub_tiles, neighbors_map)
            for i in new_sea:
                if i in available_sub_tiles: world_data["tiles"][i]["subterranean_terrain"] = "Sea"; available_sub_tiles.remove(i)
    occupied_sub_tiles = set(range(num_tiles)) - available_sub_tiles
    if LAVA_RIVERS:
        for _ in range(NUM_LAVA_RIVERS):
            if not available_sub_tiles: break
            seed = random.choice(list(available_sub_tiles)); river_length = random.randint(LAVA_RIVERS_MIN_LENGTH, LAVA_RIVERS_MAX_LENGTH); river = generate_lava_river(seed, river_length, occupied_sub_tiles, neighbors_map)
            for i in river:
                if i in available_sub_tiles: world_data["tiles"][i]["subterranean_terrain"] = "Lava"; available_sub_tiles.remove(i)
    else:
        if available_sub_tiles:
            lava_sea_size = int(num_tiles * 0.15 / 5)
            for _ in range(5):
                if not available_sub_tiles: break
                seed = random.choice(list(available_sub_tiles)); new_lava_sea = grow_body(seed, lava_sea_size, set(range(num_tiles)) - available_sub_tiles, neighbors_map)
                for i in new_lava_sea:
                    if i in available_sub_tiles: world_data["tiles"][i]["subterranean_terrain"] = "Lava"; available_sub_tiles.remove(i)
    sub_terrain_choices = ["Mountain"]*40 + ["Hill"]*40 + ["Waste"]*20
    for i in list(available_sub_tiles): world_data["tiles"][i]["subterranean_terrain"] = random.choice(sub_terrain_choices)
    ineligible_for_caverns = set()
    potential_cavern_indices = list(range(num_tiles)); random.shuffle(potential_cavern_indices)
    for i in potential_cavern_indices:
        if i in ineligible_for_caverns: continue
        if random.random() < SPAWN_CHANCE_CAVERN:
            world_data["tiles"][i]["has_cavern"] = True
            exclusion_zone = {i}; queue = deque([(i, 0)]); visited = {i}
            while queue:
                current_tile, distance = queue.popleft()
                if distance < 5:
                    for neighbor in neighbors_map[current_tile]:
                        if neighbor not in visited:
                            visited.add(neighbor); exclusion_zone.add(neighbor); queue.append((neighbor, distance + 1))
            ineligible_for_caverns.update(exclusion_zone)


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
        return render_template('index.html', user=current_user)

    @app.route('/login', methods=['GET', 'POST'])
    def login():
        if current_user.is_authenticated:
            return redirect(url_for('index'))
        if request.method == 'POST':
            email = request.form.get('email')
            password = request.form.get('password')
            user_doc = mongo.db.users.find_one({"email": email})
            user = User(user_doc) if user_doc else None
            if user and user.check_password(password):
                login_user(user)
                if not user.username:
                    return redirect(url_for('create_username'))
                return redirect(url_for('index'))
            else:
                flash('Login Unsuccessful. Please check email and password', 'danger')
        return render_template('login.html', title='Login')

    @app.route('/register', methods=['GET', 'POST'])
    def register():
        if current_user.is_authenticated:
            return redirect(url_for('index'))
        if request.method == 'POST':
            email, password = request.form.get('email'), request.form.get('password')
            if mongo.db.users.find_one({"email": email}):
                flash('That email is already in use.', 'danger')
                return redirect(url_for('register'))
            mongo.db.users.insert_one({'email': email, 'password_hash': bcrypt.generate_password_hash(password).decode('utf-8'), 'username': None, 'selected_tile_id': None})
            flash('Your account has been created! You can now log in.', 'success')
            return redirect(url_for('login'))
        return render_template('registration.html', title='Register')

    @app.route('/logout')
    def logout():
        logout_user()
        return redirect(url_for('login'))
        
    @app.route('/create_username', methods=['GET', 'POST'])
    @login_required
    def create_username():
        if current_user.username:
            return redirect(url_for('index'))
        if request.method == 'POST':
            new_username = request.form.get('username')
            if mongo.db.users.find_one({"username": new_username}):
                flash('That username is already taken. Please choose another.', 'danger')
                return redirect(url_for('create_username'))
            mongo.db.users.update_one({'_id': ObjectId(current_user.get_id())},{'$set': {'username': new_username}})
            flash('Username set successfully!', 'success')
            return redirect(url_for('index'))
        return render_template('create_username.html', title='Create Username')

    @app.route('/api/world_data')
    def get_world_data():
        if not world_data["tiles"] or not any(t["surface_terrain"] for t in world_data["tiles"]):
            generate_world_data()
        ownership_data = get_ownership_data()
        client_safe_data=[{"surface_id":t["surface_id"],"subterranean_id":t["subterranean_id"],"surface_terrain":t["surface_terrain"],"subterranean_terrain":t["subterranean_terrain"],"has_cavern":t["has_cavern"],"surface_color":TERRAIN_COLORS.get(t["surface_terrain"],0xffffff),"subterranean_color":TERRAIN_COLORS.get(t["subterranean_terrain"],0xffffff),"scales":t["scales"]} for t in world_data["tiles"]]
        return jsonify({"tiles":client_safe_data,"vertices":world_data["vertices"],"faces":world_data["faces"],"ownership":ownership_data})

    # --- WebSocket Handlers ---
    @socketio.on('connect')
    def handle_connect():
        if current_user.is_authenticated:
            emit('world_update', get_ownership_data())

    @socketio.on('select_tile')
    def handle_tile_selection(data):
        if not current_user.is_authenticated: return
        tile_id = data.get('tile_id')
        if tile_id is None: return
        mongo.db.users.update_one({'_id': ObjectId(current_user.get_id())},{'$set': {'selected_tile_id': tile_id}})
        emit('world_update', get_ownership_data(), broadcast=True)

    return app

# --- Main execution point ---
if __name__ == '__main__':
    app = create_app()
    socketio.run(app, debug=True)