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
    RACES, MAX_PLAYERS, ICO_SUBDIVISIONS, STARTING_UNITS, NEUTRAL_GARRISON
)

# --- Extension Initialization ---
mongo = PyMongo()
bcrypt = Bcrypt()
socketio = SocketIO()
login_manager = LoginManager()
login_manager.login_view = 'login'
login_manager.login_message_category = 'info'

# --- Global Game State ---
# This dictionary holds the live state of the match
game_state = {
    "initialized": False,
    "vertices": [],         # List of [x, y, z]
    "faces": [],            # List of [v1, v2, v3] indices
    "adj": {},              # Adjacency list: { vertex_id: [neighbor_id, ...] }
    "roads": [],            # List of edges: [(v1, v2), ...]
    "fortresses": {}        # { vertex_id: { owner, units, race, is_capital, special_active } }
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
    user_doc = mongo.db.users.find_one({"_id": ObjectId(user_id)})
    if user_doc:
        return User(user_doc)
    return None

# --- Geometry & Graph Helpers ---
def create_ico_sphere(subdivisions):
    # Golden ratio
    t = (1.0 + math.sqrt(5.0)) / 2.0
    
    # Base Icosahedron Vertices
    vertices = [
        [-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0],
        [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t],
        [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]
    ]
    
    # Base Icosahedron Faces
    faces = [
        [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
        [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
        [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
        [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]
    ]
    
    # Subdivide
    for _ in range(subdivisions):
        faces_subdiv = []
        mid_cache = {}
        
        def get_mid(p1, p2):
            key = tuple(sorted((p1, p2)))
            if key in mid_cache:
                return mid_cache[key]
            
            v1, v2 = vertices[p1], vertices[p2]
            mid = [(v1[i] + v2[i]) / 2.0 for i in range(3)]
            
            # Normalize to project onto sphere surface
            length = math.sqrt(sum(c*c for c in mid))
            mid = [c / length for c in mid]
            
            idx = len(vertices)
            vertices.append(mid)
            mid_cache[key] = idx
            return idx

        for tri in faces:
            v1, v2, v3 = tri
            a = get_mid(v1, v2)
            b = get_mid(v2, v3)
            c = get_mid(v3, v1)
            faces_subdiv.extend([[v1, a, c], [v2, b, a], [v3, c, b], [a, b, c]])
        faces = faces_subdiv
    
    # Normalize original vertices just in case
    for i in range(len(vertices)):
        length = math.sqrt(sum(c*c for c in vertices[i]))
        if length > 0:
            vertices[i] = [c / length for c in vertices[i]]
            
    return vertices, faces

def build_graph_from_mesh(vertices, faces):
    adj = {i: set() for i in range(len(vertices))}
    roads = set()
    
    for face in faces:
        # Edges of the triangle
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

def check_special_units_unlock(vertex_id, owner_name):
    # Check if this vertex completes a triangle for the owner
    adj_faces = [f for f in game_state["faces"] if vertex_id in f]
    
    for face in adj_faces:
        v1, v2, v3 = face
        f1 = game_state["fortresses"][str(v1)]
        f2 = game_state["fortresses"][str(v2)]
        f3 = game_state["fortresses"][str(v3)]
        
        if f1['owner'] == owner_name and f2['owner'] == owner_name and f3['owner'] == owner_name:
            # Activate special status for these nodes
            f1['special_active'] = True
            f2['special_active'] = True
            f3['special_active'] = True

def generate_game_world():
    vertices, faces = create_ico_sphere(ICO_SUBDIVISIONS)
    adj, roads = build_graph_from_mesh(vertices, faces)
    
    game_state["vertices"] = vertices
    game_state["faces"] = faces
    game_state["adj"] = adj
    game_state["roads"] = roads
    game_state["fortresses"] = {}
    
    # Initialize Neutral Fortresses
    for i in range(len(vertices)):
        game_state["fortresses"][str(i)] = {
            "id": i,
            "owner": None,
            "units": NEUTRAL_GARRISON,
            "race": "Neutral",
            "is_capital": False,
            "special_active": False
        }
    
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
            user_doc = mongo.db.users.find_one({"email": email})
            user = User(user_doc) if user_doc else None
            if user and user.check_password(password):
                login_user(user)
                if not user.username:
                    return redirect(url_for('create_username'))
                return redirect(url_for('index'))
            else:
                flash('Login Unsuccessful. Check email/password.', 'danger')
        return render_template('login.html', title='Login')

    @app.route('/register', methods=['GET', 'POST'])
    def register():
        if current_user.is_authenticated:
            return redirect(url_for('index'))
        if request.method == 'POST':
            email = request.form.get('email')
            password = request.form.get('password')
            if mongo.db.users.find_one({"email": email}):
                flash('Email already in use.', 'danger')
                return redirect(url_for('register'))
            mongo.db.users.insert_one({
                'email': email, 
                'password_hash': bcrypt.generate_password_hash(password).decode('utf-8'), 
                'username': None,
                'race': None
            })
            flash('Account created! Please log in.', 'success')
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
            selected_race = request.form.get('race') # Add race selection to this form in a real app
            
            if mongo.db.users.find_one({"username": new_username}):
                flash('Username taken.', 'danger')
                return redirect(url_for('create_username'))
            
            mongo.db.users.update_one({'_id': ObjectId(current_user.get_id())}, {
                '$set': {
                    'username': new_username,
                    'race': selected_race if selected_race in RACES else "Human" # Default
                }
            })
            flash('Username set!', 'success')
            return redirect(url_for('index'))
        return render_template('create_username.html', title='Create Username')

    # --- API Routes ---
    @app.route('/api/gamestate')
    def get_gamestate_api():
        if not game_state["initialized"]:
            generate_game_world()
        return jsonify({
            "vertices": game_state["vertices"],
            "faces": game_state["faces"],
            "roads": game_state["roads"],
            "fortresses": game_state["fortresses"],
            "races": RACES
        })

    # --- WebSocket Handlers ---
    @socketio.on('connect')
    def handle_connect():
        if current_user.is_authenticated:
            # If player has no bases, assign a home base (Simple implementation)
            assign_home_base(current_user)
            emit('update_map', game_state["fortresses"])

    def assign_home_base(user):
        # Check if user already owns nodes
        for f in game_state["fortresses"].values():
            if f['owner'] == user.username:
                return

        # Find a free triangle (3 connected neutral nodes)
        for face in game_state["faces"]:
            v1, v2, v3 = [str(x) for x in face]
            f1, f2, f3 = game_state["fortresses"][v1], game_state["fortresses"][v2], game_state["fortresses"][v3]
            
            if f1['owner'] is None and f2['owner'] is None and f3['owner'] is None:
                # Claim it
                user_race = mongo.db.users.find_one({"_id": ObjectId(user.get_id())}).get("race", "Human")
                
                for vid in [v1, v2, v3]:
                    game_state["fortresses"][vid].update({
                        "owner": user.username,
                        "units": STARTING_UNITS,
                        "race": user_race,
                        "is_capital": True,
                        "special_active": True # It's a full triangle
                    })
                return

    @socketio.on('submit_move')
    @login_required
    def handle_move(data):
        src_id = str(data.get('source'))
        tgt_id = str(data.get('target'))
        amount = int(data.get('amount', 0))
        
        if src_id not in game_state["fortresses"] or tgt_id not in game_state["fortresses"]:
            return
            
        src_fort = game_state["fortresses"][src_id]
        tgt_fort = game_state["fortresses"][tgt_id]
        
        # Validation
        if src_fort['owner'] != current_user.username:
            return
        if amount <= 0 or src_fort['units'] <= amount:
            return # Must leave at least 0? No, usually must leave 1, but let's allow emptying
        
        # Check Adjacency
        neighbors = game_state["adj"].get(int(src_id), [])
        if int(tgt_id) not in neighbors:
            return

        # Execute Move
        src_fort['units'] -= amount
        
        # Determine stats
        attacker_race = RACES.get(src_fort['race'], RACES["Human"])
        atk_mult = attacker_race['base_atk']
        if src_fort['special_active']:
            atk_mult *= attacker_race['special_bonus']
            
        attack_power = amount * atk_mult
        
        if tgt_fort['owner'] == current_user.username:
            # Reinforce
            tgt_fort['units'] += amount
        else:
            # Combat
            defender_race = RACES.get(tgt_fort['race'], RACES["Human"]) if tgt_fort['race'] != "Neutral" else {"base_def": 1.0}
            def_mult = defender_race.get('base_def', 1.0)
            
            # Simple Def calculation
            defense_power = tgt_fort['units'] * def_mult
            
            if attack_power > defense_power:
                # Victory
                remaining_power = attack_power - defense_power
                # Convert power back to units approx (divide by atk base to normalize?)
                # Simplification: Remaining units = remaining power
                new_units = max(1, int(remaining_power))
                
                tgt_fort['owner'] = current_user.username
                tgt_fort['race'] = src_fort['race']
                tgt_fort['units'] = new_units
                
                # Check for Triangle Completion
                check_special_units_unlock(int(tgt_id), current_user.username)
                
            else:
                # Defeat
                damage = int(attack_power / def_mult)
                tgt_fort['units'] = max(0, tgt_fort['units'] - damage)

        emit('update_map', game_state["fortresses"], broadcast=True)

    return app

if __name__ == '__main__':
    app = create_app()
    socketio.run(app, debug=True, host='0.0.0.0', port=5000)