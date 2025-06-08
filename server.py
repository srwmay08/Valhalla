import http.server
import socketserver
import os
import json
import time
import threading
from math import sqrt
import numpy as np
import random
import config 
from urllib.parse import urlparse, parse_qs
from collections import deque

# --- Server Configuration ---
PORT = 8000
WEB_DIR = 'static'

# --- Game Logic Classes ---

class Player:
    """Represents a player (human or AI) in the game, holding their state."""
    def __init__(self, name, is_ai=False):
        self.name = name
        self.is_ai = is_ai
        self.resources = config.STARTING_RESOURCES.copy()
        self.owned_faces = []
        self.buildings = {}
        self.bonuses = {
            "platinum_production": 0.0, "food_production": 0.0, "lumber_production": 0.0,
            "mana_production": 0.0, "ore_production": 0.0, "gem_production": 0.0,
        }

    def get_building_counts(self):
        counts = {}
        for building_name in self.buildings.values():
            counts[building_name] = counts.get(building_name, 0) + 1
        return counts

    def get_hourly_net_gains(self, hourly_rates):
        building_counts = self.get_building_counts()
        peasant_count = self.resources.get("Peasants", 0)
        gross_gains = {
            "Platinum": (building_counts.get("Alchemy", 0) * hourly_rates["Alchemy"]) + (peasant_count * hourly_rates["Peasant"]),
            "Food": (building_counts.get("Farm", 0) * hourly_rates["Farm"]) + (building_counts.get("Dock", 0) * hourly_rates["Dock"]),
            "Lumber": building_counts.get("Lumberyard", 0) * hourly_rates["Lumberyard"],
            "Mana": (building_counts.get("Tower", 0) * hourly_rates["Tower"]) + (building_counts.get("Wizard Guild", 0) * hourly_rates["Wizard Guild"]),
            "Ore": building_counts.get("Ore Mine", 0) * hourly_rates["Ore Mine"],
            "Gems": building_counts.get("Diamond Mine", 0) * hourly_rates["Diamond Mine"],
        }
        platinum_bonus = min(self.bonuses.get("platinum_production", 0.0), 0.5)
        gross_gains["Platinum"] *= (1 + platinum_bonus)
        consumption = {"Food": peasant_count * hourly_rates["FoodConsumption"]}
        net_gains = {res: gross_gains.get(res, 0) - consumption.get(res, 0) for res in gross_gains}
        return net_gains

    def update_resources(self, hourly_rates, tick_duration_hours):
        net_gains = self.get_hourly_net_gains(hourly_rates)
        for resource, net_gain in net_gains.items():
            self.resources[resource] += net_gain * tick_duration_hours
        for resource, value in self.resources.items():
            if value < 0:
                self.resources[resource] = 0

class IcosahedronSphere:
    """Implements the procedural world generation with an optimized subdivision algorithm."""
    def __init__(self, subdivisions):
        print(f"Initializing sphere with subdivision level {subdivisions}...")
        self.subdivisions = subdivisions
        self.vertices, self.faces = self._create_icosahedron()
        self._subdivide()
        self.face_neighbors = self._find_neighbors()
        self.tiles = []
        self._generate_world()

    def _get_or_create_middle_point_idx(self, p1_idx, p2_idx, vertices_list, cache):
        """
        Finds or creates a midpoint. It now correctly handles type conversion 
        from list to numpy array for vector math, fixing the TypeError.
        """
        key = tuple(sorted((p1_idx, p2_idx)))
        if key in cache:
            return cache[key]

        # Convert individual points from list to numpy array for calculation
        p1 = np.array(vertices_list[p1_idx])
        p2 = np.array(vertices_list[p2_idx])

        # This vector math now works correctly
        middle = self._normalize((p1 + p2) / 2.0)
        
        # Append the new vertex back as a list to maintain type consistency
        vertices_list.append(middle.tolist())
        middle_idx = len(vertices_list) - 1
        cache[key] = middle_idx
        return middle_idx

    def _subdivide(self):
        """A highly optimized subdivision method."""
        vertices_list = self.vertices.tolist()

        for i in range(self.subdivisions):
            print(f"Calculating subdivision level {i + 1}/{self.subdivisions}...")
            new_faces = []
            middle_point_cache = {}
            for face in self.faces:
                v1, v2, v3 = face
                
                a = self._get_or_create_middle_point_idx(v1, v2, vertices_list, middle_point_cache)
                b = self._get_or_create_middle_point_idx(v2, v3, vertices_list, middle_point_cache)
                c = self._get_or_create_middle_point_idx(v3, v1, vertices_list, middle_point_cache)

                new_faces.extend([(v1, a, c), (v2, b, a), (v3, c, b), (a, b, c)])
            self.faces = new_faces
        
        self.vertices = np.array(vertices_list)
        print("Subdivision complete.")

    def _create_icosahedron(self):
        t = (1.0 + sqrt(5.0)) / 2.0; v = [(-1, t, 0), (1, t, 0), (-1, -t, 0), (1, -t, 0), (0, -1, t), (0, 1, t), (0, -1, -t), (0, 1, -t), (t, 0, -1), (t, 0, 1), (-t, 0, -1), (-t, 0, 1)]; v = np.array([self._normalize(p) for p in v]); f = [(0, 11, 5), (0, 5, 1), (0, 1, 7), (0, 7, 10), (0, 10, 11), (1, 5, 9), (5, 11, 4), (11, 10, 2), (10, 7, 6), (7, 1, 8), (3, 9, 4), (3, 4, 2), (3, 2, 6), (3, 6, 8), (3, 8, 9), (4, 9, 5), (2, 4, 11), (6, 2, 10), (8, 6, 7), (9, 8, 1)]; return v, f
    def _normalize(self, v): norm = np.linalg.norm(v); return v if norm == 0 else v / norm
    def _find_neighbors(self):
        neighbors, edge_map = {i: set() for i in range(len(self.faces))}, {};
        for i, face in enumerate(self.faces):
            for j in range(3):
                edge = tuple(sorted((face[j], face[(j + 1) % 3])));
                if edge not in edge_map: edge_map[edge] = set()
                edge_map[edge].add(i)
        for edge, faces_set in edge_map.items():
            if len(faces_set) == 2: f1, f2 = tuple(faces_set); neighbors[f1].add(f2); neighbors[f2].add(f1)
        return {i: list(n_set) for i, n_set in neighbors.items()}
    def _generate_world(self):
        num_faces = len(self.faces); self.tiles = [{"type": None, "scales": {"life_death": 0, "heat_cold": 0, "exertion_torpor": 0, "magic_drain": 0, "order_chaos": 0, "luck_woe": 0}, "latitude": np.mean([self.vertices[v_idx][1] for v_idx in self.faces[i]])} for i in range(num_faces)]; self._generate_oceans(num_faces); self._populate_landmass(num_faces)
        tile_counts = {};
        for tile in self.tiles:
            tile_type = tile["type"]; tile_counts[tile_type] = tile_counts.get(tile_type, 0) + 1
        print("World generation complete. Tile counts:", tile_counts)
    def _populate_landmass(self, num_faces):
        land_indices = [i for i, tile in enumerate(self.tiles) if tile["type"] is None]
        for i in land_indices:
            tile_type = random.choices(["Plain", "Hill", "Forest", "Mountain", "Swamp", "Waste", "Farm"], weights=[40, 20, 20, 15, 10, 2, 1])[0]; self.tiles[i]["type"] = tile_type
    def _generate_oceans(self, num_faces):
        deep_sea_percent = random.uniform(0.20, 0.40); total_deep_sea_tiles = int(num_faces * deep_sea_percent); ocean1_size = int(total_deep_sea_tiles * random.uniform(0.3, 0.7)); ocean2_size = total_deep_sea_tiles - ocean1_size; occupied_nodes = set()
        seed1 = random.randint(0, num_faces - 1); self._grow_cluster(seed1, ocean1_size, "Deep Sea", occupied_nodes)
        available_nodes = [i for i in range(num_faces) if i not in occupied_nodes]
        if not available_nodes: print("Warning: No available nodes for the second ocean."); return
        seed2 = random.choice(available_nodes); self._grow_cluster(seed2, ocean2_size, "Deep Sea", occupied_nodes)
        sea_ring_candidates = [];
        for i in range(num_faces):
            if self.tiles[i]["type"] == "Deep Sea":
                for neighbor_idx in self.face_neighbors.get(i, []):
                    if self.tiles[neighbor_idx]["type"] is None: sea_ring_candidates.append(neighbor_idx)
        for idx in set(sea_ring_candidates): self.tiles[idx]["type"] = "Sea"
    def _grow_cluster(self, start_node, size, tile_type, occupied_nodes):
        if start_node in occupied_nodes: return
        q = deque([start_node]); visited = {start_node}; count = 0
        while q and count < size:
            curr_node = q.popleft()
            if self.tiles[curr_node]["type"] is None:
                self.tiles[curr_node]["type"] = tile_type; occupied_nodes.add(curr_node); count += 1
                for neighbor in self.face_neighbors.get(curr_node, []):
                    if neighbor not in visited: visited.add(neighbor); q.append(neighbor)

class GameEngine:
    def __init__(self):
        self.lock = threading.RLock()
        self.state_changed_cv = threading.Condition(self.lock)
        self.state_version = 0
        self.sphere = IcosahedronSphere(subdivisions=8) # Increased from 5
        self.num_faces = len(self.sphere.tiles)
        self.players, self.player_colors, self.event_log = [], {}, []
        self.game_state, self.countdown_end_time = 'SETUP', None
        self.last_tick_time = time.time()
        self.hourly_production_rates = {"Alchemy": 45, "Peasant": 2.7, "Farm": 80, "Dock": 35, "Lumberyard": 50, "Tower": 25, "Wizard Guild": 5, "Ore Mine": 60, "Diamond Mine": 15, "FoodConsumption": 0.25}
        self.world_tick, self.seasons = 0, ["Early Winter", "Winter", "Late Winter", "Early Spring", "Spring", "Late Spring", "Early Summer", "Summer", "Late Summer", "Early Autumn", "Autumn", "Late Autumn"]
        
    def add_event(self, message):
        timestamp = time.strftime("%H:%M:%S"); self.event_log.insert(0, f"[{timestamp}] {message}"); self.event_log = self.event_log[:10]
    def _notify_state_change(self):
        with self.state_changed_cv: self.state_version += 1; self.state_changed_cv.notify_all()
    def setup_game(self, num_human_players=1, num_ai_enemies=3):
        with self.lock:
            self.players, self.player_colors, self.event_log = [], {}, []
            for i in range(num_human_players): self.players.append(Player(f"Player {i+1}"))
            num_ai_to_add = min(num_ai_enemies, config.MAX_PLAYERS - len(self.players))
            for i in range(num_ai_to_add): self.players.append(Player(f"AI Enemy {i+1}", is_ai=True))
            for i, p in enumerate(self.players): self.player_colors[p.name] = config.PLAYER_COLORS[i]
            self.add_event("New game created. Select a starting location.")
            self._notify_state_change()
    def start_player_game(self, player_name, face_index):
        with self.lock:
            player = next((p for p in self.players if p.name == player_name), None)
            if not player or self.game_state not in ['SETUP', 'COUNTDOWN']: return False
            player.owned_faces, player.buildings = [], {}
            self.add_event(f"{player_name} selected territory {face_index}."); player.owned_faces.extend([face_index, face_index + self.num_faces]); player.buildings[face_index] = "Farm"
            for p in self.players:
                if p.is_ai: p.owned_faces, p.buildings = [], {}
            forbidden_faces = {face_index, *self.sphere.face_neighbors.get(face_index, [])}
            for p in self.players:
                if p.is_ai:
                    available = list(set(range(self.num_faces)) - forbidden_faces)
                    if available:
                        idx = random.choice(available); p.owned_faces.extend([idx, idx + self.num_faces]); p.buildings[idx] = "Farm"
                        forbidden_faces.add(idx); forbidden_faces.update(self.sphere.face_neighbors.get(idx,[]))
            self.game_state = 'COUNTDOWN'; self.countdown_end_time = time.time() + config.GAME_SETUP_COUNTDOWN
            self.add_event(f"Game starting in {config.GAME_SETUP_COUNTDOWN}s... Click again to reset.")
        self._notify_state_change(); return True
    def resolve_attack(self, player_name, target_face_index):
        with self.lock:
            player = next((p for p in self.players if p.name == player_name), None)
            if not player or self.game_state != 'RUNNING': return "invalid"
            player_outer_faces = {f % self.num_faces for f in player.owned_faces}
            if not any(target_face_index in self.sphere.face_neighbors.get(f, []) for f in player_outer_faces): return "not_adjacent"
            all_owned_faces = {f % self.num_faces for p in self.players for f in p.owned_faces}
            if target_face_index in all_owned_faces: return "already_owned"
            if random.random() < 0.6: self.add_event(f"{player_name} captured tile {target_face_index}!"); player.owned_faces.extend([target_face_index, target_face_index + self.num_faces]); self._notify_state_change(); return "won"
            else: self.add_event(f"{player_name}'s attack on tile {target_face_index} failed."); self._notify_state_change(); return "lost"
        return "invalid"
    def get_state_json(self):
        with self.lock:
            tick_interval = getattr(config, 'SECONDS_BETWEEN_TICKS', 3600)
            state = {'version':self.state_version,'state':self.game_state,'countdown_end_time':self.countdown_end_time,'last_tick_time':self.last_tick_time,'tick_interval':tick_interval,'world_tick':self.world_tick,'season':self.seasons[(self.world_tick//10)%12],'tiles':[{"type":t["type"],"scales":t["scales"]} for t in self.sphere.tiles],'num_faces':self.num_faces,'neighbors':{k:list(v) for k,v in self.sphere.face_neighbors.items()},'event_log':self.event_log,'players':{}}
            for p in self.players: state['players'][p.name] = {'is_ai':p.is_ai,'owned_faces':p.owned_faces,'resources':{k:int(v) for k,v in p.resources.items()},'hourly_gains':{k:round(v,1) for k,v in p.get_hourly_net_gains(self.hourly_production_rates).items()}}
            return json.dumps(state)
    def _update_seasonal_effects(self):
        season_index = (self.world_tick // 10) % 12
        for tile in self.sphere.tiles:
            lat, heat_mod = tile["latitude"], 0
            if "Summer" in self.seasons[season_index]: heat_mod = 2.0 * (1 - abs(lat))
            elif "Winter" in self.seasons[season_index]: heat_mod = -2.0 * abs(lat)
            tile["scales"]["heat_cold"] = round(heat_mod, 2)
    def run_tick_loop(self):
        while True:
            state_did_change = False
            with self.lock:
                if self.game_state == 'COUNTDOWN' and self.countdown_end_time and time.time() >= self.countdown_end_time:
                    self.game_state, self.last_tick_time = 'RUNNING', time.time(); self.add_event("The game has begun!"); state_did_change = True
                tick_interval = getattr(config, 'SECONDS_BETWEEN_TICKS', 3600)
                if self.game_state == 'RUNNING' and (time.time() - self.last_tick_time >= tick_interval):
                    self.world_tick += 1; self._update_seasonal_effects(); self.add_event(f"An hour passes (Tick {self.world_tick}).")
                    for p in self.players: p.update_resources(self.hourly_production_rates, 1.0)
                    self.last_tick_time, state_did_change = time.time(), True
            if state_did_change: self._notify_state_change()
            time.sleep(1)

game_engine = GameEngine()
class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs): super().__init__(*args, directory=WEB_DIR, **kwargs)
    def do_GET(self):
        if self.path.startswith('/api/gamestate'):
            qc=parse_qs(urlparse(self.path).query);cv=int(qc.get('version',[0])[0])
            with game_engine.state_changed_cv:
                if game_engine.state_version == cv: game_engine.state_changed_cv.wait(timeout=25.0)
            try: self.send_response(200);self.send_header('Content-type','application/json');self.end_headers();self.wfile.write(game_engine.get_state_json().encode('utf-8'))
            except ConnectionAbortedError: print("Client disconnected during long poll.")
        else: super().do_GET()
    def do_POST(self):
        try:
            cl=int(self.headers['Content-Length']);pd=json.loads(self.rfile.read(cl))
            if self.path=='/api/startgame': s=game_engine.start_player_game("Player 1",pd['faceIndex']);self.send_response(200 if s else 400);self.end_headers();self.wfile.write(json.dumps({'success':s}).encode('utf-8'))
            elif self.path=='/api/attack': r=game_engine.resolve_attack("Player 1",pd['faceIndex']);self.send_response(200);self.end_headers();self.wfile.write(json.dumps({'result':r}).encode('utf-8'))
            else: self.send_response(404);self.end_headers()
        except Exception as e: print(f"Error handling POST: {e}");self.send_response(500);self.end_headers()

if __name__ == "__main__":
    os.chdir(os.path.dirname(os.path.abspath(__file__)));game_engine.setup_game()
    engine_thread=threading.Thread(target=game_engine.run_tick_loop,daemon=True);engine_thread.start()
    with socketserver.TCPServer(("", PORT), Handler) as httpd:
        print(f"Server starting at http://localhost:{PORT}");httpd.serve_forever()