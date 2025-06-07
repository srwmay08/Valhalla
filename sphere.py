import pygame
import numpy as np
import random
import time
from math import sqrt
import config  # Import the new configuration file

# --- Constants and Configuration ---
SCREEN_WIDTH, SCREEN_HEIGHT = 800, 600
BACKGROUND_COLOR = (0, 0, 0)
SCALE = 200
ROTATION_SPEED = 0.005
SUBDIVISIONS = 3  # Increase for a smoother sphere

# Biome definitions and colors
BIOMES = {
    "Plain": (124, 252, 0), "Mountain": (139, 137, 137), "Hill": (189, 183, 107),
    "Cavern": (72, 61, 139), "Water": (65, 105, 225), "Forest": (34, 139, 34),
    "Swamp": (47, 79, 79), "Coast": (238, 213, 183), "Ocean": (0, 0, 139)
}

class Player:
    """Represents a player (human or AI) in the game."""
    def __init__(self, name, is_ai=False):
        self.name = name
        self.is_ai = is_ai
        self.resources = config.STARTING_RESOURCES.copy()
        self.owned_faces = []  # List of face indices owned by the player
        self.buildings = {}    # Key: face_index, Value: building_name

    def get_building_counts(self):
        """Counts the number of each type of building the player owns."""
        counts = {}
        for building_name in self.buildings.values():
            counts[building_name] = counts.get(building_name, 0) + 1
        return counts

    def update_resources(self, hourly_rates, tick_duration_hours):
        """
        Updates player's resources based on their buildings and population.
        This is the core economic calculation per tick.
        """
        building_counts = self.get_building_counts()

        # --- Resource Generation (based on OpenDominion spec) ---
        # Platinum
        peasant_count = self.resources.get("Peasants", 0)
        self.resources["Platinum"] += (building_counts.get("Alchemy", 0) * hourly_rates["Alchemy"] * tick_duration_hours)
        self.resources["Platinum"] += (peasant_count * hourly_rates["Peasant"] * tick_duration_hours)
        
        # Food Production
        self.resources["Food"] += (building_counts.get("Farm", 0) * hourly_rates["Farm"] * tick_duration_hours)
        self.resources["Food"] += (building_counts.get("Dock", 0) * hourly_rates["Dock"] * tick_duration_hours)

        # Other Production Buildings
        self.resources["Lumber"] += (building_counts.get("Lumberyard", 0) * hourly_rates["Lumberyard"] * tick_duration_hours)
        self.resources["Mana"] += (building_counts.get("Tower", 0) * hourly_rates["Tower"] * tick_duration_hours)
        self.resources["Mana"] += (building_counts.get("Wizard Guild", 0) * hourly_rates["Wizard Guild"] * tick_duration_hours)
        self.resources["Ore"] += (building_counts.get("Ore Mine", 0) * hourly_rates["Ore Mine"] * tick_duration_hours)
        self.resources["Gems"] += (building_counts.get("Diamond Mine", 0) * hourly_rates["Diamond Mine"] * tick_duration_hours)

        # --- Resource Consumption ---
        food_consumption = (peasant_count) * hourly_rates["FoodConsumption"]
        self.resources["Food"] -= (food_consumption * tick_duration_hours)

        # Ensure resources don't go negative
        for resource, value in self.resources.items():
            if value < 0:
                self.resources[resource] = 0

class IcosahedronSphere:
    """
    A class to create, subdivide, and manage an icosahedron-based sphere.
    Unchanged from the original implementation.
    """
    def __init__(self, subdivisions):
        self.subdivisions = subdivisions
        self.vertices, self.faces = self._create_icosahedron()
        self._subdivide()
        self.face_biomes = [None] * len(self.faces)
        self.face_neighbors = self._find_neighbors()
        self._assign_biomes()
    
    def _create_icosahedron(self):
        t = (1.0 + sqrt(5.0)) / 2.0
        vertices = [
            (-1, t, 0), (1, t, 0), (-1, -t, 0), (1, -t, 0),
            (0, -1, t), (0, 1, t), (0, -1, -t), (0, 1, -t),
            (t, 0, -1), (t, 0, 1), (-t, 0, -1), (-t, 0, 1)
        ]
        vertices = np.array([self._normalize(v) for v in vertices])
        faces = [
            (0, 11, 5), (0, 5, 1), (0, 1, 7), (0, 7, 10), (0, 10, 11),
            (1, 5, 9), (5, 11, 4), (11, 10, 2), (10, 7, 6), (7, 1, 8),
            (3, 9, 4), (3, 4, 2), (3, 2, 6), (3, 6, 8), (3, 8, 9),
            (4, 9, 5), (2, 4, 11), (6, 2, 10), (8, 6, 7), (9, 8, 1)
        ]
        return vertices, faces

    def _normalize(self, v):
        norm = np.linalg.norm(v)
        return v if norm == 0 else v / norm

    def _get_middle_point(self, p1_idx, p2_idx, vertices, middle_point_cache):
        key = tuple(sorted((p1_idx, p2_idx)))
        if key in middle_point_cache:
            return middle_point_cache[key], vertices
        p1 = vertices[p1_idx]
        p2 = vertices[p2_idx]
        middle = self._normalize((p1 + p2) / 2.0)
        vertices = np.vstack([vertices, middle])
        middle_idx = len(vertices) - 1
        middle_point_cache[key] = middle_idx
        return middle_idx, vertices

    def _subdivide(self):
        middle_point_cache = {}
        for _ in range(self.subdivisions):
            new_faces = []
            temp_vertices = np.copy(self.vertices)
            for face in self.faces:
                v1_idx, v2_idx, v3_idx = face
                a_idx, temp_vertices = self._get_middle_point(v1_idx, v2_idx, temp_vertices, middle_point_cache)
                b_idx, temp_vertices = self._get_middle_point(v2_idx, v3_idx, temp_vertices, middle_point_cache)
                c_idx, temp_vertices = self._get_middle_point(v3_idx, v1_idx, temp_vertices, middle_point_cache)
                new_faces.extend([(v1_idx, a_idx, c_idx), (v2_idx, b_idx, a_idx), (v3_idx, c_idx, b_idx), (a_idx, b_idx, c_idx)])
            self.faces = new_faces
            self.vertices = temp_vertices
            middle_point_cache.clear()

    def _find_neighbors(self):
        neighbors = {i: set() for i in range(len(self.faces))}
        edge_to_faces = {}
        for i, face in enumerate(self.faces):
            for j in range(3):
                edge = tuple(sorted((face[j], face[(j + 1) % 3])))
                if edge not in edge_to_faces:
                    edge_to_faces[edge] = set()
                edge_to_faces[edge].add(i)
        for faces_set in edge_to_faces.values():
            if len(faces_set) == 2:
                face1, face2 = tuple(faces_set)
                neighbors[face1].add(face2)
                neighbors[face2].add(face1)
        return {i: list(n) for i, n in neighbors.items()}

    def _assign_biomes(self):
        non_coast_biomes = [b for b in BIOMES if b not in ["Coast", "Ocean"]]
        ocean_chance = 1.0 / (len(non_coast_biomes) + 1)
        for i in range(len(self.faces)):
            self.face_biomes[i] = "Ocean" if random.random() < ocean_chance else random.choice(non_coast_biomes)
        for i in range(len(self.faces)):
            if self.face_biomes[i] != "Ocean":
                if any(self.face_biomes[n] == "Ocean" for n in self.face_neighbors[i]):
                    self.face_biomes[i] = "Coast"

class GameEngine:
    """Manages the overall game state, players, and the main game loop."""
    def __init__(self, screen):
        self.screen = screen
        self.clock = pygame.time.Clock()
        self.sphere = IcosahedronSphere(subdivisions=SUBDIVISIONS)
        self.players = []
        self.player_colors = {}
        self.last_tick_time = time.time()
        self.hourly_production_rates = {
            "Alchemy": 45, "Peasant": 2.7, "Farm": 80, "Dock": 35,
            "Lumberyard": 50, "Tower": 25, "Wizard Guild": 5, "Ore Mine": 60,
            "Diamond Mine": 15, "FoodConsumption": 0.25
        }
        self.angle_x, self.angle_y, self.angle_z = 0, 0, 0

    def add_player(self, name):
        """Adds a human player, removing an AI if the game is full."""
        if len(self.players) >= config.MAX_PLAYERS:
            ai_players = [p for p in self.players if p.is_ai]
            if not ai_players:
                print("Cannot add more players. Game is full of human players.")
                return None
            removed_ai = ai_players[0]
            self.players.remove(removed_ai)
            print(f"Removed AI player {removed_ai.name} to make room for {name}.")
        
        player = Player(name, is_ai=False)
        self.players.append(player)
        self.player_colors[player.name] = config.PLAYER_COLORS[len(self.players) - 1]
        self._assign_start_location(player)
        print(f"Added player: {name}")
        return player

    def _assign_start_location(self, player):
        """Finds an unowned face and assigns it to the player."""
        all_owned_faces = {face for p in self.players for face in p.owned_faces}
        # Place players far from each other
        for i in random.sample(range(len(self.sphere.faces)), len(self.sphere.faces)):
            if i not in all_owned_faces:
                # Check neighbors to ensure not starting right next to someone
                neighbors = self.sphere.face_neighbors[i]
                if not any(n in all_owned_faces for n in neighbors):
                    player.owned_faces.append(i)
                    player.buildings[i] = "Farm"  # Give a starting building
                    print(f"Assigned face {i} to player {player.name}")
                    return
        print(f"Warning: Could not find isolated start location for {player.name}.")

    def setup_game(self, num_human_players=1, num_ai_enemies=3):
        """Initializes the game with a set number of human and AI players."""
        for i in range(num_human_players):
            self.add_player(f"Player {i+1}")
        
        num_ai_to_add = min(num_ai_enemies, config.MAX_PLAYERS - len(self.players))
        for i in range(num_ai_to_add):
            ai_player = Player(f"AI Enemy {i+1}", is_ai=True)
            self.players.append(ai_player)
            self.player_colors[ai_player.name] = config.PLAYER_COLORS[len(self.players) - 1]
            self._assign_start_location(ai_player)
            print(f"Added AI Enemy: {ai_player.name}")

    def _handle_tick(self):
        """Processes one game tick, updating resources for all players."""
        tick_duration_hours = config.TICK_INTERVAL_SECONDS / 3600.0
        print(f"\n--- Game Tick ({time.ctime()}) ---")
        for player in self.players:
            # Store resources before update for comparison
            resources_before = {k: int(v) for k,v in player.resources.items()}
            player.update_resources(self.hourly_production_rates, tick_duration_hours)
            resources_after = {k: int(v) for k,v in player.resources.items()}
            print(f"Player {player.name}: {resources_before} -> {resources_after}")
        print("-" * 20)

    def _update_display(self):
        """Draws the current game state to the screen."""
        self.angle_x += ROTATION_SPEED
        self.angle_y += ROTATION_SPEED
        
        rot_x = np.array([[1, 0, 0], [0, np.cos(self.angle_x), -np.sin(self.angle_x)], [0, np.sin(self.angle_x), np.cos(self.angle_x)]])
        rot_y = np.array([[np.cos(self.angle_y), 0, np.sin(self.angle_y)], [0, 1, 0], [-np.sin(self.angle_y), 0, np.cos(self.angle_y)]])
        rotated_vertices = self.sphere.vertices @ (rot_y @ rot_x).T

        self.screen.fill(BACKGROUND_COLOR)
        
        sorted_faces = sorted(range(len(self.sphere.faces)), key=lambda i: sum(rotated_vertices[v][2] for v in self.sphere.faces[i]), reverse=True)

        for i in sorted_faces:
            face = self.sphere.faces[i]
            v0, v1, v2 = [rotated_vertices[idx] for idx in face]
            if np.cross(v1 - v0, v2 - v0)[2] > 0: continue

            points = [(int(v[0] * SCALE + SCREEN_WIDTH / 2), int(v[1] * SCALE + SCREEN_HEIGHT / 2)) for v in [v0, v1, v2]]
            
            face_owner = next((p for p in self.players if i in p.owned_faces), None)
            color = self.player_colors.get(face_owner.name) if face_owner else BIOMES.get(self.sphere.face_biomes[i], (255, 255, 255))
            
            pygame.draw.polygon(self.screen, color, points)
            pygame.draw.polygon(self.screen, (50, 50, 50), points, 1) # Outline

        pygame.display.flip()

    def run(self):
        """The main loop of the game engine."""
        running = True
        while running:
            for event in pygame.event.get():
                if event.type == pygame.QUIT: running = False

            current_time = time.time()
            if current_time - self.last_tick_time >= config.TICK_INTERVAL_SECONDS:
                self._handle_tick()
                self.last_tick_time = current_time

            self._update_display()
            self.clock.tick(60)
        pygame.quit()

def main():
    """Initializes and runs the game engine."""
    pygame.init()
    screen = pygame.display.set_mode((SCREEN_WIDTH, SCREEN_HEIGHT))
    pygame.display.set_caption("Valhalla Game Engine")
    
    engine = GameEngine(screen)
    engine.setup_game(num_human_players=1, num_ai_enemies=3) # Setup a default game
    engine.run()

if __name__ == "__main__":
    main()