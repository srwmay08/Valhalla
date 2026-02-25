import math
import random
from collections import deque
from config import (
    ICO_SUBDIVISIONS, SURFACE_OCEANS, MIN_SURFACE_DEEP_SEA_PERCENT,
    MAX_SURFACE_DEEP_SEA_PERCENT, SPAWN_CHANCE_WASTE, SPAWN_CHANCE_FARM,
    MOUNTAIN_RANGE_MIN_LENGTH, MOUNTAIN_RANGE_MAX_LENGTH, TERRAIN_COLORS
)

def darken_color(hex_color, factor=0.4):
    """Helper to dim colors for owned sectors."""
    r = (hex_color >> 16) & 0xFF
    g = (hex_color >> 8) & 0xFF
    b = hex_color & 0xFF
    r = int(r * factor)
    g = int(g * factor)
    b = int(b * factor)
    return (r << 16) | (g << 8) | b

def create_ico_sphere(subdivisions):
    t = (1.0 + math.sqrt(5.0)) / 2.0
    vertices = [
        [-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0],
        [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t],
        [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]
    ]
    faces = [
        [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
        [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
        [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
        [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]
    ]
    
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

def find_face_neighbors(faces):
    edge_to_faces = {}
    for i, face in enumerate(faces):
        edges = [
            tuple(sorted((face[0], face[1]))),
            tuple(sorted((face[1], face[2]))),
            tuple(sorted((face[2], face[0])))
        ]
        for edge in edges:
            if edge not in edge_to_faces: edge_to_faces[edge] = []
            edge_to_faces[edge].append(i)
    neighbors = {i: set() for i in range(len(faces))}
    for edge, face_indices in edge_to_faces.items():
        if len(face_indices) == 2:
            f1, f2 = face_indices
            neighbors[f1].add(f2); neighbors[f2].add(f1)
    return {k: list(v) for k, v in neighbors.items()}

def grow_body(start_node, target_size, occupied_tiles, neighbors_map):
    body = {start_node}
    frontier = [n for n in neighbors_map[start_node] if n not in occupied_tiles]
    while len(body) < target_size and frontier:
        idx = random.randint(0, len(frontier) - 1)
        curr = frontier.pop(idx)
        if curr in occupied_tiles: continue
        body.add(curr)
        for n in neighbors_map[curr]:
            if n not in body and n not in occupied_tiles and n not in frontier: frontier.append(n)
    return body

def generate_game_world():
    """Generates the geometry, terrain, and graph connection data."""
    vertices, faces = create_ico_sphere(ICO_SUBDIVISIONS)
    adj_raw, roads_list = build_graph_from_mesh(vertices, faces)
    roads = set(roads_list)
    
    num_faces = len(faces)
    face_neighbors = find_face_neighbors(faces)
    face_terrain = ["Plain"] * num_faces
    available = set(range(num_faces))
    ocean_tiles = set()
    
    # 1. Generate Oceans
    if SURFACE_OCEANS > 0:
        total_ocean_percent = random.uniform(MIN_SURFACE_DEEP_SEA_PERCENT, MAX_SURFACE_DEEP_SEA_PERCENT)
        total_ocean_target = int(total_ocean_percent * num_faces)
        avg_lake_size = max(5, total_ocean_target // SURFACE_OCEANS)
        for _ in range(SURFACE_OCEANS):
            if not available: break
            seed = random.choice(list(available))
            lake_size = int(avg_lake_size * random.uniform(0.8, 1.2))
            new_ocean = grow_body(seed, lake_size, ocean_tiles, face_neighbors)
            ocean_tiles.update(new_ocean)
            available -= new_ocean
            
    for i in ocean_tiles: face_terrain[i] = "Deep Sea"
    
    # 2. Cleanup Islands
    land_indices = [i for i, t in enumerate(face_terrain) if t != "Deep Sea"]
    land_set = set(land_indices)
    
    if land_indices:
        visited = set()
        components = []
        for idx in land_indices:
            if idx not in visited:
                component = set()
                queue = deque([idx])
                visited.add(idx)
                component.add(idx)
                while queue:
                    curr = queue.popleft()
                    for n in face_neighbors[curr]:
                        if n in land_set and n not in visited:
                            visited.add(n); component.add(n); queue.append(n)
                components.append(component)
        if components:
            components.sort(key=len, reverse=True)
            for small_comp in components[1:]:
                for idx in small_comp: face_terrain[idx] = "Deep Sea"; ocean_tiles.add(idx)
    
    # 3. Coastlines (Sea)
    final_ocean_tiles = {i for i, t in enumerate(face_terrain) if t == "Deep Sea"}
    sea_tiles = set()
    for i in final_ocean_tiles:
        for n in face_neighbors[i]:
            if face_terrain[n] != "Deep Sea": sea_tiles.add(n)
    for i in sea_tiles: face_terrain[i] = "Sea"
    
    # 4. Biomes
    available_land = [i for i, t in enumerate(face_terrain) if t == "Plain"]
    for i in available_land:
        r = random.random()
        if r < 0.25: face_terrain[i] = "Hill"
        elif r < 0.40: face_terrain[i] = "Swamp"
            
    current_land_types = {i: t for i, t in enumerate(face_terrain)}
    forest_seeds = [i for i in available_land if current_land_types[i] == "Plain"]
    if forest_seeds:
        num_forests = int(len(available_land) * 0.05)
        for _ in range(num_forests):
            if not forest_seeds: break
            seed = random.choice(forest_seeds)
            cluster = grow_body(seed, random.randint(3, 8), final_ocean_tiles.union(sea_tiles), face_neighbors)
            for idx in cluster:
                if face_terrain[idx] not in ["Deep Sea", "Sea"]: face_terrain[idx] = "Forest"

    mountain_seeds = [i for i, t in enumerate(face_terrain) if t not in ["Deep Sea", "Sea"]]
    if mountain_seeds:
        num_ranges = int(len(available_land) * 0.02)
        for _ in range(num_ranges):
            length = random.randint(MOUNTAIN_RANGE_MIN_LENGTH, MOUNTAIN_RANGE_MAX_LENGTH)
            if not mountain_seeds: break
            curr = random.choice(mountain_seeds)
            for _ in range(length):
                face_terrain[curr] = "Mountain"
                valid_next = [n for n in face_neighbors[curr] if face_terrain[n] not in ["Deep Sea", "Sea"]]
                if not valid_next: break
                curr = random.choice(valid_next)

    final_land_indices = [i for i, t in enumerate(face_terrain) if t not in ["Deep Sea", "Sea", "Mountain"]]
    for i in final_land_indices:
        if random.random() < SPAWN_CHANCE_WASTE: face_terrain[i] = "Waste"
        is_near_plain = any(face_terrain[n] == "Plain" for n in face_neighbors[i])
        if is_near_plain and random.random() < SPAWN_CHANCE_FARM: face_terrain[i] = "Farm"

    # 5. Filter Roads based on Water and Identify Hazards (Lava)
    edge_to_faces = {}
    for face_idx, face in enumerate(faces):
        f_edges = [
            tuple(sorted((face[0], face[1]))),
            tuple(sorted((face[1], face[2]))),
            tuple(sorted((face[2], face[0])))
        ]
        for e in f_edges:
            if e not in edge_to_faces:
                edge_to_faces[e] = []
            edge_to_faces[e].append(face_idx)

    invalid_edges = set()
    lava_edges = set()
    
    # Track which vertices are touching water
    water_vertices = set()
    for face_idx, terrain in enumerate(face_terrain):
        if terrain in ["Deep Sea", "Sea"]:
            for v_idx in faces[face_idx]:
                water_vertices.add(v_idx)

    for e, f_indices in edge_to_faces.items():
        is_water = False
        for f_idx in f_indices:
            t = face_terrain[f_idx]
            if t == "Deep Sea": 
                is_water = True
                break
            if t == "Sea":
                is_water = True
                break
        
        if is_water:
            invalid_edges.add(e)
            continue 

        if len(f_indices) == 2:
            t1 = face_terrain[f_indices[0]]
            t2 = face_terrain[f_indices[1]]
            if t1 == "Lava" and t2 == "Lava":
                lava_edges.add(e)
    
    valid_roads = roads - invalid_edges
    
    new_adj = {i: set() for i in range(len(vertices))}
    for u, v in valid_roads:
        new_adj[u].add(v)
        new_adj[v].add(u)
    
    face_colors = [TERRAIN_COLORS.get(t, 0xff00ff) for t in face_terrain]

    edges_data = {}
    for u, v in valid_roads:
        key_tuple = tuple(sorted((u, v)))
        key_str = str(key_tuple)
        
        is_hazard = key_tuple in lava_edges

        edges_data[key_str] = {
            "u": u,
            "v": v,
            "packets": [],      
            "battle_point": 0.5, 
            "contested": False,
            "hazard": is_hazard 
        }

    sanctuaries = {}

    return {
        "vertices": vertices,
        "faces": faces,
        "face_colors": face_colors,
        "face_terrain": face_terrain,
        "water_vertices": list(water_vertices),
        "adj": {k: list(v) for k, v in new_adj.items()},
        "roads": list(valid_roads),
        "edges": edges_data,
        "sanctuaries": sanctuaries
    }