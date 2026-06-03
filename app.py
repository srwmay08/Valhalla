import os
import random
import time
import json
from threading import RLock
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
socketio = SocketIO(async_mode='threading', cors_allowed_origins="*")
login_manager = LoginManager()
login_manager.login_view = 'login'
login_manager.login_message_category = 'info'

thread = None
thread_lock = RLock()

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
    while True:
        socketio.sleep(TICK_RATE)
        
        # Use thread lock for all state modifications
        with thread_lock:
            if not game_state["initialized"]:
                continue
                
            map_changed = False
            color_changed = False

            # 1. Sector Dominance
            if combat_engine.process_sector_dominance(game_state):
                color_changed = True

            # 2. AI Logic
            process_ai_turn(game_state)
            
            # 3. Fortress Production
            if fortress_engine.process_fortress_production(game_state):
                map_changed = True
                
            # 4. Fortress Upgrades
            if fortress_engine.process_fortress_upgrades(game_state):
                map_changed = True
                
            # 5. Combat / Attack Paths
            if combat_engine.process_combat_flows(game_state):
                map_changed = True

        # Broadcast Updates outside of lock to prevent blocking
        if color_changed:
            socketio.emit('update_face_colors', {
                "colors": game_state["face_colors"],
                "owners": game_state["sector_owners"]
            })
        
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

    # Pre-initialize world state before handling any traffic
    with thread_lock:
        if not game_state["initialized"]: 
            print("[SERVER] Initializing world...")
            world_data = world_engine.generate_game_world()
            game_state.update(world_data)
            game_state["fortresses"] = fortress_engine.initialize_fortresses(game_state)
            game_state["initialized"] = True
            print("[SERVER] World successfully generated and ready.")

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
                    if not User(user_doc).username:
                        return redirect(url_for('create_username'))
                    else:
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
                if mongo.db.users.find_one({"email": email}):
                    flash('Email in use.', 'danger')
                    return redirect(url_for('register'))
                hashed_pw = bcrypt.generate_password_hash(password).decode('utf-8')
                mongo.db.users.insert_one({'email': email, 'password_hash': hashed_pw, 'username': None, 'race': None})
                flash('Account created!', 'success')
                return redirect(url_for('login'))
            except Exception as e:
                print(f"DEBUG: Register error: {e}")
                flash('Error.', 'danger')
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
                flash('Taken.', 'danger')
                return redirect(url_for('create_username'))
            mongo.db.users.update_one({'_id': ObjectId(current_user.get_id())}, {'$set': {'username': new_username, 'race': 'Human'}})
            return redirect(url_for('index'))
        return render_template('create_username.html', title='Create Username')

    @app.route('/api/gamestate')
    def get_gamestate_api():
        try:
            with thread_lock:
                from config import FORTRESS_TYPES, RACES, TERRAIN_BUILD_OPTIONS
                
                # Deep sanitizer to catch both Numpy KEYS and VALUES for the API response
                def sanitize(obj):
                    if isinstance(obj, dict):
                        # JSON strictly requires strings for keys.
                        return {str(k): sanitize(v) for k, v in obj.items()}
                    elif isinstance(obj, list) or isinstance(obj, tuple):
                        return [sanitize(x) for x in obj]
                    elif type(obj).__module__ == 'numpy':
                        if hasattr(obj, 'item'):
                            return obj.item()
                        elif hasattr(obj, 'tolist'):
                            return obj.tolist()
                    return obj

                payload = {
                    "vertices": game_state["vertices"],
                    "faces": game_state["faces"],
                    "face_colors": game_state["face_colors"],
                    "sector_owners": game_state.get("sector_owners", {}),
                    "roads": game_state["roads"],
                    "fortresses": game_state["fortresses"],
                    "adj": game_state["adj"],
                    "races": RACES,
                    "fortress_types": FORTRESS_TYPES,
                    "terrain_build_options": TERRAIN_BUILD_OPTIONS
                }
                
                safe_payload = sanitize(payload)
                return jsonify(safe_payload)
        except Exception as e:
            import traceback
            print(f"[API ERROR] Failed to serialize gamestate: {e}")
            traceback.print_exc()
            return jsonify({"error": str(e)}), 500

    @socketio.on('connect')
    def handle_connect():
        global thread
        with thread_lock:
            if thread is None:
                thread = socketio.start_background_task(background_thread)
            
            if current_user.is_authenticated:
                emit('update_face_colors', {
                    "colors": game_state["face_colors"],
                    "owners": game_state["sector_owners"]
                })
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
            emit('update_face_colors', {
                "colors": game_state["face_colors"],
                "owners": game_state["sector_owners"]
            }, broadcast=True)

    def assign_home_sector(user):
        with thread_lock:
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
                if terrain in ["Deep Sea", "Sea"]:
                    continue
                
                v1, v2, v3 = [str(x) for x in face]
                if any(game_state["fortresses"][v]['owner'] for v in [v1, v2, v3]):
                    continue

                game_state["face_colors"][i] = int(world_engine.darken_color(RACES["Human"]["color"], factor=0.4))
                units = int(STARTING_UNITS_POOL // 3)
                
                for vid in [v1, v2, v3]:
                    game_state["fortresses"][vid].update({
                        "owner": user.username,
                        "units": units,
                        "race": "Human",
                        "is_capital": True,
                        "special_active": True,
                        "tier": 1,
                        "paths": [],
                        "type": "Keep" 
                    })
                game_state["sector_owners"][str(i)] = user.username
                
                coords = [game_state["vertices"][int(v)] for v in [v1, v2, v3]]
                cx = float(sum(c[0] for c in coords) / 3)
                cy = float(sum(c[1] for c in coords) / 3)
                cz = float(sum(c[2] for c in coords) / 3)
                
                emit('focus_camera', {'position': [cx, cy, cz]})
                break

            emit('update_face_colors', {
                "colors": game_state["face_colors"],
                "owners": game_state["sector_owners"]
            }, broadcast=True)
            emit('update_map', game_state["fortresses"], broadcast=True)

    def spawn_ai_sector():
        if any(f['owner'] == AI_NAME for f in game_state["fortresses"].values()):
            return
        
        available_faces = list(enumerate(game_state["faces"]))
        random.shuffle(available_faces)
        
        for i, face in available_faces:
            if game_state.get("face_terrain", [])[i] in ["Deep Sea", "Sea", "Mountain"]:
                continue
            
            v1, v2, v3 = [str(x) for x in face]
            if not any(game_state["fortresses"][v]['owner'] for v in [v1, v2, v3]):
                ai_color = RACES["Orc"]["color"]
                game_state["face_colors"][i] = int(world_engine.darken_color(ai_color, factor=0.4))
                
                units = int(STARTING_UNITS_POOL // 3)
                for vid in [v1, v2, v3]:
                    game_state["fortresses"][vid].update({
                        "owner": AI_NAME,
                        "units": units,
                        "race": "Orc",
                        "is_capital": True,
                        "special_active": True,
                        "tier": 1,
                        "paths": [],
                        "type": "Keep"
                    })
                game_state["sector_owners"][str(i)] = AI_NAME
                return

    @socketio.on('submit_move')
    @login_required
    def handle_move(data):
        with thread_lock:
            src_id = str(data.get('source'))
            tgt_id = str(data.get('target'))
            if src_id not in game_state["fortresses"] or tgt_id not in game_state["fortresses"]:
                return
            src_fort = game_state["fortresses"][src_id]
            if src_fort['owner'] != current_user.username:
                return
            
            if int(tgt_id) not in game_state["adj"].get(int(src_id), []):
                return

            if tgt_id in src_fort['paths']:
                src_fort['paths'].remove(tgt_id)
            else:
                if len(src_fort['paths']) < src_fort['tier']:
                    src_fort['paths'].append(tgt_id)
            
            emit('update_map', game_state["fortresses"], broadcast=True)

    @socketio.on('specialize_fortress')
    @login_required
    def handle_specialize(data):
        with thread_lock:
            fid = str(data.get('id'))
            new_type = data.get('type')
            if fid not in game_state["fortresses"]:
                return
            fort = game_state["fortresses"][fid]
            if fort['owner'] != current_user.username:
                return
            
            allowed = TERRAIN_BUILD_OPTIONS.get(fort.get('land_type', 'Plain'), ["Keep"])
            if new_type in allowed:
                fort['type'] = new_type
                emit('update_map', game_state["fortresses"], broadcast=True)

    return app

if __name__ == '__main__':
    app = create_app()
    socketio.run(app, debug=True, host='127.0.0.1', port=5000)