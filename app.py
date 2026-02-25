import os
import random
import time
from threading import Lock
from flask import Flask, jsonify, render_template, request, redirect, url_for, flash
from flask_pymongo import PyMongo
from flask_login import LoginManager, UserMixin, login_user, logout_user, current_user, login_required
from flask_bcrypt import Bcrypt
from flask_socketio import SocketIO, emit
from bson.objectid import ObjectId

# --- Import New Engines ---
import world_engine
import fortress_engine
import combat_engine
from ai_engine import process_ai_turn

from config import (
    RACES, MAX_PLAYERS, STARTING_UNITS_POOL, TICK_RATE, 
    TERRAIN_BUILD_OPTIONS, FORTRESS_TYPES
)

# --- Configuration Overrides ---
RACES["Human"]["color"] = 0xff0000
RACES["Orc"]["color"] = 0x00ff00

AI_NAME = "Gorgon"

# --- Setup ---
mongo = PyMongo()
bcrypt = Bcrypt()

# FIX: Added CORS and explicit async_mode for stable local development
socketio = SocketIO(
    async_mode='threading', 
    cors_allowed_origins="*",
    logger=True, 
    engineio_logger=True
)

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
    "sector_owners": {},
    "dominance_cache": {}
}

# --- User Class ---
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

# --- Background Task (The Game Loop) ---
def background_thread():
    print("[SERVER] Background Thread Initialized.")
    while True:
        # IMPORTANT: release the CPU so the server can handle client requests
        socketio.sleep(TICK_RATE)
        
        with thread_lock:
            if not game_state["initialized"]:
                continue
                
            map_changed = False
            color_changed = False

            if combat_engine.process_sector_dominance(game_state):
                color_changed = True

            process_ai_turn(game_state)
            
            if fortress_engine.process_fortress_production(game_state):
                map_changed = True
                
            if fortress_engine.process_fortress_upgrades(game_state):
                map_changed = True
                
            if combat_engine.process_combat_flows(game_state):
                map_changed = True

        if color_changed:
            socketio.emit('update_face_colors', game_state["face_colors"])
        
        if map_changed:
            socketio.emit('update_map', game_state["fortresses"])

# --- App Factory ---
def create_app():
    app = Flask(__name__)
    app.config.from_object('config')
    mongo.init_app(app)
    bcrypt.init_app(app)
    socketio.init_app(app)
    login_manager.init_app(app)

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
                if user_doc and User(user_doc).check_password(password):
                    login_user(User(user_doc))
                    return redirect(url_for('index'))
            except Exception as e:
                print(f"DEBUG: Login error: {e}")
            flash('Login Unsuccessful.', 'danger')
        return render_template('login.html', title='Login')

    @app.route('/register', methods=['GET', 'POST'])
    def register():
        if current_user.is_authenticated:
            return redirect(url_for('index'))
        if request.method == 'POST':
            email = request.form.get('email')
            password = request.form.get('password')
            try:
                hashed_pw = bcrypt.generate_password_hash(password).decode('utf-8')
                mongo.db.users.insert_one({'email': email, 'password_hash': hashed_pw, 'username': None, 'race': None})
                return redirect(url_for('login'))
            except Exception as e:
                print(f"DEBUG: Register error: {e}")
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
            mongo.db.users.update_one({'_id': ObjectId(current_user.get_id())}, {'$set': {'username': new_username, 'race': 'Human'}})
            return redirect(url_for('index'))
        return render_template('create_username.html', title='Create Username')

    @app.route('/api/gamestate')
    def get_gamestate_api():
        with thread_lock:
            if not game_state["initialized"]: 
                world_data = world_engine.generate_game_world()
                game_state.update(world_data)
                game_state["fortresses"] = fortress_engine.initialize_fortresses(game_state)
                game_state["initialized"] = True
            
            return jsonify({
                "vertices": game_state["vertices"],
                "faces": game_state["faces"],
                "face_colors": game_state["face_colors"],
                "roads": game_state["roads"],
                "fortresses": game_state["fortresses"],
                "adj": game_state["adj"],
                "races": RACES,
                "fortress_types": FORTRESS_TYPES,
                "terrain_build_options": TERRAIN_BUILD_OPTIONS
            })

    @socketio.on('connect')
    def handle_connect():
        global thread
        with thread_lock:
            if thread is None:
                thread = socketio.start_background_task(background_thread)
            if current_user.is_authenticated:
                emit('update_face_colors', game_state["face_colors"])
                emit('update_map', game_state["fortresses"])
                assign_home_sector(current_user)

    @socketio.on('restart_game')
    @login_required
    def handle_restart():
        with thread_lock:
            world_data = world_engine.generate_game_world()
            game_state.update(world_data)
            game_state["fortresses"] = fortress_engine.initialize_fortresses(game_state)
            game_state["sector_owners"] = {}
            game_state["dominance_cache"] = {}
            assign_home_sector(current_user)
            emit('update_map', game_state["fortresses"], broadcast=True)
            emit('update_face_colors', game_state["face_colors"], broadcast=True)

    def assign_home_sector(user):
        spawn_ai_sector()
        existing_forts = [f for f in game_state["fortresses"].values() if f['owner'] == user.username]
        if existing_forts:
            vid = int(existing_forts[0]['id'])
            v_pos = game_state["vertices"][vid]
            emit('focus_camera', {'position': v_pos})
            return 
        available_faces = list(enumerate(game_state["faces"]))
        random.shuffle(available_faces)
        for i, face in available_faces:
            terrain = game_state.get("face_terrain", [])[i]
            if terrain in ["Deep Sea", "Sea"]: continue
            v1, v2, v3 = [str(x) for x in face]
            if any(game_state["fortresses"][v]['owner'] for v in [v1, v2, v3]): continue
            game_state["face_colors"][i] = world_engine.darken_color(RACES["Human"]["color"], factor=0.4)
            units = STARTING_UNITS_POOL // 3
            for vid in [v1, v2, v3]:
                game_state["fortresses"][vid].update({
                    "owner": user.username, "units": units, "race": "Human", "is_capital": True,
                    "special_active": True, "tier": 1, "paths": [], "type": "Keep" 
                })
            game_state["sector_owners"][str(i)] = user.username
            coords = [game_state["vertices"][int(v)] for v in [v1, v2, v3]]
            avg_coords = [sum(c[i] for c in coords)/3 for i in range(3)]
            emit('focus_camera', {'position': avg_coords})
            break
        emit('update_face_colors', game_state["face_colors"], broadcast=True)
        emit('update_map', game_state["fortresses"], broadcast=True)

    def spawn_ai_sector():
        if any(f['owner'] == AI_NAME for f in game_state["fortresses"].values()): return
        available_faces = list(enumerate(game_state["faces"]))
        random.shuffle(available_faces)
        for i, face in available_faces:
            if game_state.get("face_terrain", [])[i] in ["Deep Sea", "Sea", "Mountain"]: continue
            v1, v2, v3 = [str(x) for x in face]
            if not any(game_state["fortresses"][v]['owner'] for v in [v1, v2, v3]):
                game_state["face_colors"][i] = world_engine.darken_color(RACES["Orc"]["color"], factor=0.4)
                units = STARTING_UNITS_POOL // 3
                for vid in [v1, v2, v3]:
                    game_state["fortresses"][vid].update({
                        "owner": AI_NAME, "units": units, "race": "Orc", "is_capital": True,
                        "special_active": True, "tier": 1, "paths": [], "type": "Keep"
                    })
                game_state["sector_owners"][str(i)] = AI_NAME
                break

    @socketio.on('submit_move')
    @login_required
    def handle_move(data):
        with thread_lock:
            src_id, tgt_id = str(data.get('source')), str(data.get('target'))
            if src_id not in game_state["fortresses"] or tgt_id not in game_state["fortresses"]: return
            src_fort = game_state["fortresses"][src_id]
            if src_fort['owner'] != current_user.username: return
            if int(tgt_id) not in game_state["adj"].get(int(src_id), []): return
            if tgt_id in src_fort['paths']: src_fort['paths'].remove(tgt_id)
            elif len(src_fort['paths']) < src_fort['tier']: src_fort['paths'].append(tgt_id)
            emit('update_map', game_state["fortresses"], broadcast=True)

    @socketio.on('specialize_fortress')
    @login_required
    def handle_specialize(data):
        with thread_lock:
            fid, new_type = str(data.get('id')), data.get('type')
            if fid not in game_state["fortresses"]: return
            fort = game_state["fortresses"][fid]
            if fort['owner'] != current_user.username: return
            if new_type in TERRAIN_BUILD_OPTIONS.get(fort.get('land_type', 'Plain'), ["Keep"]):
                fort['type'] = new_type
                emit('update_map', game_state["fortresses"], broadcast=True)
    return app

if __name__ == '__main__':
    app = create_app()
    socketio.run(app, debug=True, host='127.0.0.1', port=5000)