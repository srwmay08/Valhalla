import math
import random
from collections import deque
from config import (
    ICO_SUBDIVISIONS, SURFACE_OCEANS, MIN_SURFACE_DEEP_SEA_PERCENT,
    MAX_SURFACE_DEEP_SEA_PERCENT, SPAWN_CHANCE_WASTE, SPAWN_CHANCE_FARM,
    MOUNTAIN_RANGE_MIN_LENGTH, MOUNTAIN_RANGE_MAX_LENGTH, TERRAIN_COLORS
)

def darken_color(hex_color, factor=0.4):
    r = (hex_color >> 16) & 0xFF
    g = (hex_color >> 8) & 0xFF
    b = hex_color & 0xFF
    return (int(r * factor) << 16) | (int(g * factor) << 8) | int(b * factor)

def create_ico_sphere(subdivisions):
    t = (1.0 + math.sqrt(5.0)) / 2.0
    vertices = [[-1,t,0],[1,t,0],[-1,-t,0],[1,-t,0],[0,-1,t],[0,1,t],[0,-1,-t],[0,1,-t],[t,0,-1],[t,0,1],[-t,0,-1],[-t,0,1]]
    faces = [[0,11,5],[0,5,1],[0,1,7],[0,7,10],[0,10,11],[1,5,9],[5,11,4],[11,10,2],[10,7,6],[7,1,8],[3,9,4],[3,4,2],[3,2,6],[3,6,8],[3,8,9],[4,9,5],[2,4,11],[6,2,10],[8,6,7],[9,8,1]]
    for _ in range(subdivisions):
        faces_subdiv = []; mid_cache = {}
        def get_mid(p1, p2):
            key = tuple(sorted((p1, p2)))
            if key in mid_cache: return mid_cache[key]
            v1,v2 = vertices[p1], vertices[p2]
            mid = [(v1[i]+v2[i])/2.0 for i in range(3)]
            l = math.sqrt(sum(c*c for c in mid)); mid = [c/l for c in mid]
            idx = len(vertices); vertices.append(mid); mid_cache[key] = idx
            return idx
        for tri in faces:
            a,b,c = get_mid(tri[0],tri[1]), get_mid(tri[1],tri[2]), get_mid(tri[2],tri[0])
            faces_subdiv.extend([[tri[0],a,c],[tri[1],b,a],[tri[2],c,b],[a,b,c]])
        faces = faces_subdiv
    for i in range(len(vertices)):
        l = math.sqrt(sum(c*c for c in vertices[i]))
        if l>0: vertices[i] = [c/l for c in vertices[i]]
    return vertices, faces

def generate_game_world():
    vertices, faces = create_ico_sphere(ICO_SUBDIVISIONS)
    adj = {i: set() for i in range(len(vertices))}
    roads = set()
    edge_to_faces = {}
    
    for idx, face in enumerate(faces):
        for e in [tuple(sorted((face[0],face[1]))), tuple(sorted((face[1],face[2]))), tuple(sorted((face[2],face[0])))]:
            if e not in edge_to_faces: edge_to_faces[e] = []
            edge_to_faces[e].append(idx)
            
    num_faces = len(faces)
    face_terrain = ["Plain"] * num_faces
    # Simplistic biome gen for demo purposes
    for i in range(num_faces):
        if random.random() < 0.2: face_terrain[i] = "Deep Sea"
        elif random.random() < 0.1: face_terrain[i] = "Mountain"

    valid_roads = set()
    for e, f_idxs in edge_to_faces.items():
        # A road is valid if at least ONE touching face is NOT deep sea
        if any(face_terrain[fi] != "Deep Sea" for fi in f_idxs):
            valid_roads.add(e)
            adj[e[0]].add(e[1]); adj[e[1]].add(e[0])
            
    edges_data = {str(e): {"u": e[0], "v": e[1], "packets": []} for e in valid_roads}
    
    return {
        "vertices": vertices, "faces": faces, 
        "face_colors": [TERRAIN_COLORS.get(t, 0x00ff00) for t in face_terrain],
        "face_terrain": face_terrain,
        "adj": {k: list(v) for k, v in adj.items()},
        "roads": [list(e) for e in valid_roads],
        "edges": edges_data
    }