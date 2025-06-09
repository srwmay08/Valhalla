from flask import Flask, jsonify, render_template
import math
import random
import os
from collections import deque
from config import TERRAIN_COLORS, SCALES, MIN_DEEP_SEA_PERCENT, MAX_DEEP_SEA_PERCENT, SPAWN_CHANCE_WASTE, SPAWN_CHANCE_FARM, SPAWN_CHANCE_CAVERN

# --- Flask Application Setup ---
# Standard setup to define the locations for HTML templates and static files (like JS, CSS)
APP_ROOT = os.path.dirname(os.path.abspath(__file__))
template_folder = os.path.join(APP_ROOT, 'templates')
static_folder = os.path.join(APP_ROOT, 'static')
app = Flask(__name__, template_folder=template_folder, static_folder=static_folder)

# --- Global World State ---
# This dictionary will store the generated world data in memory so we don't have to
# regenerate it on every API call. It's populated only on the first request.
world_data = {"tiles": [], "vertices": [], "faces": [], "neighbors": {}}

# --- Core Icosahedron and Neighbor Logic ---

def create_ico_sphere(subdivisions):
    """
    Creates the base 3D model of a sphere by starting with an icosahedron (a 20-sided polyhedron)
    and subdividing its faces repeatedly to make it smoother and more sphere-like.
    """
    # Start with the 12 vertices and 20 faces of a base icosahedron.
    t = (1.0 + math.sqrt(5.0)) / 2.0
    vertices = [[-1,t,0],[1,t,0],[-1,-t,0],[1,-t,0],[0,-1,t],[0,1,t],[0,-1,-t],[0,1,-t],[t,0,-1],[t,0,1],[-t,0,-1],[-t,0,1]]
    faces = [[0,11,5],[0,5,1],[0,1,7],[0,7,10],[0,10,11],[1,5,9],[5,11,4],[11,10,2],[10,7,6],[7,1,8],[3,9,4],[3,4,2],[3,2,6],[3,6,8],[3,8,9],[4,9,5],[2,4,11],[6,2,10],[8,6,7],[9,8,1]]
    
    # The subdivision loop: for each level of subdivision, every triangle is split into 4 smaller triangles.
    for _ in range(subdivisions):
        faces_subdiv, mid_cache = [], {}
        for tri in faces:
            v1, v2, v3 = tri
            # Helper to calculate the midpoint between two vertices and cache the result to avoid duplicate vertices.
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
            faces_subdiv.extend([[v1,a,c],[v2,b,a],[v3,c,b],[a,b,c]])
        faces = faces_subdiv

    # Normalize all vertices to project them onto a perfect sphere of radius 1.
    for i in range(len(vertices)):
        length = math.sqrt(sum(c*c for c in vertices[i]))
        vertices[i] = [c/length for c in vertices[i]]
        
    return vertices, faces

def find_all_neighbors(faces):
    """
    Calculates which tiles (faces) are adjacent to each other. This is much faster
    than the original O(n^2) approach. It works by mapping every edge to the one or
    two faces that share it. Edges shared by two faces connect neighbors.
    """
    edge_to_faces = {}
    for i, face in enumerate(faces):
        # Create sorted tuples for edges to ensure (v1, v2) is the same as (v2, v1).
        edges = [tuple(sorted((face[0], face[1]))), tuple(sorted((face[1], face[2]))), tuple(sorted((face[2], face[0])))]
        for edge in edges:
            if edge not in edge_to_faces: edge_to_faces[edge] = []
            edge_to_faces[edge].append(i)
            
    neighbors = {i: set() for i in range(len(faces))}
    for edge, face_indices in edge_to_faces.items():
        if len(face_indices) == 2:  # If an edge is shared by two faces, they are neighbors.
            face1, face2 = face_indices
            neighbors[face1].add(face2)
            neighbors[face2].add(face1)
            
    return {k: list(v) for k, v in neighbors.items()}

# --- Main World Generation Function ---

def generate_world_data():
    """
    The main orchestrator for procedurally generating the entire world,
    following the multi-step logic provided in the design document.
    """
    # Create the base sphere geometry and calculate the neighbor map once.
    base_vertices, base_faces = create_ico_sphere(subdivisions=5)
    world_data.update({"vertices": base_vertices, "faces": base_faces, "neighbors": find_all_neighbors(base_faces)})
    
    num_tiles = len(base_faces)
    
    # Initialize the tile data structure for every tile. Now includes separate surface and subterranean properties.
    world_data["tiles"] = [{
        "surface_id": i,
        "subterranean_id": i + num_tiles,
        "surface_terrain": None,
        "subterranean_terrain": None,
        "scales": {s: 0 for s in SCALES}
    } for i in range(num_tiles)]

    # --- Step 1: Surface Generation ---
    
    # 1a. Generate contiguous, amoeba-like oceans.
    all_tile_indices = list(range(num_tiles))
    deep_sea_percentage = random.uniform(MIN_DEEP_SEA_PERCENT, MAX_DEEP_SEA_PERCENT)
    ocean1_split = random.uniform(0.3, 0.7)
    ocean1_target_size = int(deep_sea_percentage * ocean1_split * num_tiles)
    ocean2_target_size = int(deep_sea_percentage * (1 - ocean1_split) * num_tiles)

    def grow_ocean_organically(start_node, target_size, existing_ocean_tiles):
        """Grows an ocean from a seed using randomized frontier selection to create organic shapes."""
        ocean_tiles = {start_node}
        frontier = [n for n in world_data["neighbors"][start_node] if n not in existing_ocean_tiles]
        while len(ocean_tiles) < target_size and frontier:
            choice_index = random.randint(0, len(frontier) - 1)
            current_node = frontier.pop(choice_index)
            ocean_tiles.add(current_node)
            for neighbor in world_data["neighbors"][current_node]:
                if neighbor not in ocean_tiles and neighbor not in existing_ocean_tiles and neighbor not in frontier:
                    frontier.append(neighbor)
        return ocean_tiles

    seed1 = random.choice(all_tile_indices)
    seed2 = all_tile_indices[-1 - all_tile_indices.index(seed1)] # Pick a distant tile for the second ocean.
    ocean1_tiles = grow_ocean_organically(seed1, ocean1_target_size, set())
    ocean2_tiles = grow_ocean_organically(seed2, ocean2_target_size, ocean1_tiles)
    deep_sea_indices = ocean1_tiles | ocean2_tiles

    for i in deep_sea_indices:
        world_data["tiles"][i]["surface_terrain"] = "Deep Sea"
        
    # 1b. Create the mandatory Sea Ring buffer around all Deep Sea tiles.
    sea_indices = set()
    for i in deep_sea_indices:
        for neighbor_id in world_data["neighbors"][i]:
            if neighbor_id not in deep_sea_indices:
                sea_indices.add(neighbor_id)
    
    for i in sea_indices:
        world_data["tiles"][i]["surface_terrain"] = "Sea"

    # 1c. Populate the remaining landmass with various terrains.
    land_indices = [i for i in range(num_tiles) if i not in deep_sea_indices and i not in sea_indices]
    for i in land_indices: world_data["tiles"][i]["surface_terrain"] = "Plain" # Base layer
    for i in land_indices:
        if random.random() < 0.25: world_data["tiles"][i]["surface_terrain"] = "Hill"
        elif random.random() < 0.15: world_data["tiles"][i]["surface_terrain"] = "Swamp"
    
    # Forest Clusters
    for _ in range(int(len(land_indices) * 0.01)):
        seed_index, cluster_size = random.choice(land_indices), random.randint(5, 20)
        q, visited = deque([seed_index]), {seed_index}
        for _ in range(cluster_size):
            if not q: break
            curr = q.popleft()
            world_data["tiles"][curr]["surface_terrain"] = "Forest"
            for neighbor in world_data["neighbors"][curr]:
                if neighbor in land_indices and neighbor not in visited:
                    q.append(neighbor); visited.add(neighbor)

    # Mountain Ranges
    for _ in range(int(len(land_indices) * 0.005)):
        seed_index, range_length = random.choice(land_indices), random.randint(4, 12)
        for _ in range(range_length):
            if seed_index not in land_indices: break
            world_data["tiles"][seed_index]["surface_terrain"] = "Mountain"
            valid_next = [n for n in world_data["neighbors"][seed_index] if n in land_indices]
            seed_index = random.choice(valid_next) if valid_next else -1
            
    # Rare Tiles
    for i in land_indices:
        if world_data["tiles"][i]["surface_terrain"] != "Mountain" and random.random() < SPAWN_CHANCE_WASTE:
            world_data["tiles"][i]["surface_terrain"] = "Waste"
        is_near_plain = any(world_data["tiles"][n]["surface_terrain"] == "Plain" for n in world_data["neighbors"][i])
        if is_near_plain and random.random() < SPAWN_CHANCE_FARM:
            world_data["tiles"][i]["surface_terrain"] = "Farm"

    # --- Step 2: Subterranean Generation ---
    # A separate, simpler generation pass for the world below.
    sub_terrain_choices = ["Mountain"]*30 + ["Hill"]*30 + ["Waste"]*15 + ["Sea"]*15 + ["Lava"]*10
    for i in range(num_tiles):
        world_data["tiles"][i]["subterranean_terrain"] = random.choice(sub_terrain_choices)

    # --- Step 3: Cavern Generation Pass ---
    # This final pass links the two layers. If a cavern spawns, it overrides both surface and subterranean terrains.
    for i in range(num_tiles):
        if random.random() < SPAWN_CHANCE_CAVERN:
            world_data["tiles"][i]["surface_terrain"] = "Cavern"
            world_data["tiles"][i]["subterranean_terrain"] = "Cavern"

# --- API Routes ---

@app.route('/')
def index():
    """Serves the main HTML page."""
    return render_template('index.html')

@app.route('/api/world_data')
def get_world_data():
    """
    API endpoint that provides the generated world data to the frontend.
    It triggers the generation only on the first call.
    """
    if not world_data["tiles"] or not any(t["surface_terrain"] for t in world_data["tiles"]):
        generate_world_data()
    
    # Prepare a "client safe" version of the data, including pre-calculated colors for both layers.
    client_safe_data = [{
        "surface_id": t["surface_id"],
        "subterranean_id": t["subterranean_id"],
        "surface_terrain": t["surface_terrain"],
        "subterranean_terrain": t["subterranean_terrain"],
        "surface_color": TERRAIN_COLORS.get(t["surface_terrain"], 0xffffff),
        "subterranean_color": TERRAIN_COLORS.get(t["subterranean_terrain"], 0xffffff),
        "scales": t["scales"]
    } for t in world_data["tiles"]]
    
    return jsonify({
        "tiles": client_safe_data,
        "vertices": world_data["vertices"],
        "faces": world_data["faces"]
    })

# --- Main execution point ---
if __name__ == '__main__':
    app.run(debug=True)