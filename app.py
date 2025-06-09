from flask import Flask, jsonify, render_template
import math
import random
import os
from config import TERRAIN_COLORS, SCALES, MIN_DEEP_SEA_PERCENT, MAX_DEEP_SEA_PERCENT # Import new config

# --- App Setup (Improved from last time) ---
APP_ROOT = os.path.dirname(os.path.abspath(__file__))
template_folder = os.path.join(APP_ROOT, 'templates')
static_folder = os.path.join(APP_ROOT, 'static')
app = Flask(__name__, template_folder=template_folder, static_folder=static_folder)

# --- Data Structure for our World ---
# We will store the world state in a global dictionary
world_data = {
    "tiles": [],
    "vertices": [],
    "tick": 0
}

# --- 1. Base Sphere Generation ---
def create_ico_sphere(subdivisions):
    # (This function is the same as before, no changes needed)
    # ... returns vertices, faces
    t = (1.0 + math.sqrt(5.0)) / 2.0
    vertices = [[-1,t,0],[1,t,0],[-1,-t,0],[1,-t,0],[0,-1,t],[0,1,t],[0,-1,-t],[0,1,-t],[t,0,-1],[t,0,1],[-t,0,-1],[-t,0,1]]
    faces = [[0,11,5],[0,5,1],[0,1,7],[0,7,10],[0,10,11],[1,5,9],[5,11,4],[11,10,2],[10,7,6],[7,1,8],[3,9,4],[3,4,2],[3,2,6],[3,6,8],[3,8,9],[4,9,5],[2,4,11],[6,2,10],[8,6,7],[9,8,1]]
    for _ in range(subdivisions):
        faces_subdiv = []
        for tri in faces:
            v1,v2,v3 = vertices[tri[0]],vertices[tri[1]],vertices[tri[2]]
            v12 = [(v1[0]+v2[0])/2.0,(v1[1]+v2[1])/2.0,(v1[2]+v2[2])/2.0]
            v23 = [(v2[0]+v3[0])/2.0,(v2[1]+v3[1])/2.0,(v2[2]+v3[2])/2.0]
            v31 = [(v3[0]+v1[0])/2.0,(v3[1]+v1[1])/2.0,(v3[2]+v1[2])/2.0]
            i12,i23,i31 = len(vertices),len(vertices)+1,len(vertices)+2
            vertices.extend([v12,v23,v31])
            faces_subdiv.extend([[tri[0],i12,i31],[tri[1],i23,i12],[tri[2],i31,i23],[i12,i23,i31]])
        faces = faces_subdiv
    for i in range(len(vertices)):
        length = math.sqrt(sum(c*c for c in vertices[i]))
        vertices[i] = [c/length for c in vertices[i]]
    return vertices, faces

# --- 2. Advanced World Generation ---
def generate_world_data():
    """
    Main function to generate the entire world based on the new rules.
    """
    base_vertices, base_faces = create_ico_sphere(subdivisions=5)
    world_data["vertices"] = base_vertices
    
    num_tiles = len(base_faces)
    tile_indices = list(range(num_tiles))
    random.shuffle(tile_indices) # For random tile selection

    # Initialize each tile with default data
    for i in range(num_tiles):
        world_data["tiles"].append({
            "id": i,
            "terrain": "Plain", # Default terrain
            "scales": {scale: 0 for scale in SCALES},
            "face": base_faces[i]
        })

    # --- Step 1: Foundational Ocean Generation ---
    deep_sea_total = random.uniform(MIN_DEEP_SEA_PERCENT, MAX_DEEP_SEA_PERCENT)
    ocean1_pct = random.uniform(0.01, 0.99)
    ocean2_pct = 1.0 - ocean1_pct
    
    ocean1_size = int(deep_sea_total * ocean1_pct * num_tiles)
    ocean2_size = int(deep_sea_total * ocean2_pct * num_tiles)
    
    # Place two distinct oceans
    place_ocean(tile_indices[:ocean1_size])
    place_ocean(tile_indices[ocean1_size : ocean1_size + ocean2_size])

    # --- Step 2: Landmass & Terrain Population ---
    # (This is a simplified version. A full implementation would be more complex)
    # Here you would implement logic for clustering forests, mountain ranges, etc.
    for tile in world_data["tiles"]:
        if tile["terrain"] == "Plain": # Only affect non-ocean tiles
            if random.random() < 0.2:
                tile["terrain"] = "Hill"
            if random.random() < 0.1:
                tile["terrain"] = "Forest"

def place_ocean(tile_indices_for_ocean):
    """Helper function to create an ocean and its surrounding sea."""
    # Find neighbors for all tiles once to avoid re-calculating
    if "neighbors" not in world_data:
        world_data["neighbors"] = find_all_neighbors()

    for tile_id in tile_indices_for_ocean:
        world_data["tiles"][tile_id]["terrain"] = "Deep Sea"
    
    # Create the Sea Ring
    for tile_id in tile_indices_for_ocean:
        for neighbor_id in world_data["neighbors"][tile_id]:
            if world_data["tiles"][neighbor_id]["terrain"] != "Deep Sea":
                world_data["tiles"][neighbor_id]["terrain"] = "Sea"

def find_all_neighbors():
    """Calculates which tiles are adjacent to each other."""
    neighbors = {i: set() for i in range(len(world_data["tiles"]))}
    for i, tile_i in enumerate(world_data["tiles"]):
        for j, tile_j in enumerate(world_data["tiles"]):
            if i == j: continue
            shared_vertices = len(set(tile_i["face"]) & set(tile_j["face"]))
            if shared_vertices == 2: # Tiles sharing 2 vertices are neighbors
                neighbors[i].add(j)
    return {k: list(v) for k, v in neighbors.items()}


# --- API Routes ---
@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/world_data')
def get_world_data():
    """Provides the entire generated world state as JSON."""
    # This check ensures world generation only runs once
    if not world_data["tiles"]:
        generate_world_data()

    # Prepare data for frontend (without sending huge face/vertex data every time)
    client_safe_data = []
    for tile in world_data["tiles"]:
        client_safe_data.append({
            "id": tile["id"],
            "terrain": tile["terrain"],
            "scales": tile["scales"],
            "color": TERRAIN_COLORS.get(tile["terrain"], 0xffffff) # Get color from config
        })

    return jsonify({
        "tiles": client_safe_data,
        "vertices": world_data["vertices"],
        "faces": [tile["face"] for tile in world_data["tiles"]]
    })

if __name__ == '__main__':
    app.run(debug=True)