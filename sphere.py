import pygame
import numpy as np
import random
from math import sqrt

# --- Constants and Configuration ---
SCREEN_WIDTH, SCREEN_HEIGHT = 800, 600
BACKGROUND_COLOR = (0, 0, 0)
SCALE = 200
ROTATION_SPEED = 0.005
SUBDIVISIONS = 3  # Scalability: Increase for a smoother sphere

# Biome definitions and colors
BIOMES = {
    "Plain": (124, 252, 0),
    "Mountain": (139, 137, 137),
    "Hill": (189, 183, 107),
    "Cavern": (72, 61, 139),
    "Water": (65, 105, 225),
    "Forest": (34, 139, 34),
    "Swamp": (47, 79, 79),
    "Coast": (238, 213, 183),
    "Ocean": (0, 0, 139)
}

class IcosahedronSphere:
    """
    A class to create, subdivide, and manage an icosahedron-based sphere.
    """
    def __init__(self, subdivisions):
        self.subdivisions = subdivisions
        self.vertices, self.faces = self._create_icosahedron()
        self._subdivide()
        self.face_biomes = [None] * len(self.faces)
        self.face_neighbors = self._find_neighbors()
        self._assign_biomes()

    def _create_icosahedron(self):
        """Creates the 12 vertices and 20 faces of a base icosahedron."""
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
        """Normalizes a vector to unit length."""
        norm = np.linalg.norm(v)
        if norm == 0:
            return v
        return v / norm

    def _get_middle_point(self, p1_idx, p2_idx, vertices, middle_point_cache):
        """
        Finds the midpoint between two vertices and normalizes it to lie on the sphere.
        Uses a cache to avoid duplicate calculations.
        Returns the index of the middle point and the (potentially updated) vertices array.
        """
        smaller_idx, larger_idx = sorted((p1_idx, p2_idx))
        key = (smaller_idx, larger_idx)

        if key in middle_point_cache:
            # On cache hit, return the stored index and the UNCHANGED vertices array to maintain a consistent return type.
            return middle_point_cache[key], vertices

        p1 = vertices[p1_idx]
        p2 = vertices[p2_idx]
        middle = (p1 + p2) / 2.0
        middle = self._normalize(middle)
        
        # On cache miss, add the new vertex and return its index and the NEW vertices array.
        vertices = np.vstack([vertices, middle])
        middle_idx = len(vertices) - 1
        middle_point_cache[key] = middle_idx
        return middle_idx, vertices

    def _subdivide(self):
        """Subdivides each triangular face into four smaller triangles."""
        middle_point_cache = {}

        for _ in range(self.subdivisions):
            new_faces = []
            temp_vertices = np.copy(self.vertices)
            
            for face in self.faces:
                v1_idx, v2_idx, v3_idx = face

                # Get midpoints, creating new vertices if necessary
                a_idx, temp_vertices = self._get_middle_point(v1_idx, v2_idx, temp_vertices, middle_point_cache)
                b_idx, temp_vertices = self._get_middle_point(v2_idx, v3_idx, temp_vertices, middle_point_cache)
                c_idx, temp_vertices = self._get_middle_point(v3_idx, v1_idx, temp_vertices, middle_point_cache)

                new_faces.extend([
                    (v1_idx, a_idx, c_idx),
                    (v2_idx, b_idx, a_idx),
                    (v3_idx, c_idx, b_idx),
                    (a_idx, b_idx, c_idx)
                ])
            
            self.faces = new_faces
            self.vertices = temp_vertices
            middle_point_cache.clear()

    def _find_neighbors(self):
        """Finds the neighboring faces for each face."""
        neighbors = {i: set() for i in range(len(self.faces))}
        edge_to_faces = {}

        for i, face in enumerate(self.faces):
            for j in range(3):
                p1_idx = face[j]
                p2_idx = face[(j + 1) % 3]
                edge = tuple(sorted((p1_idx, p2_idx)))
                
                if edge in edge_to_faces:
                    edge_to_faces[edge].add(i)
                else:
                    edge_to_faces[edge] = {i}

        for edge, faces_set in edge_to_faces.items():
            if len(faces_set) == 2:
                face1, face2 = tuple(faces_set)
                neighbors[face1].add(face2)
                neighbors[face2].add(face1)
        
        return {i: list(n) for i, n in neighbors.items()}

    def _assign_biomes(self):
        """Assigns biomes to faces with specific logic for Coasts and Oceans."""
        non_coast_biomes = [b for b in BIOMES if b not in ["Coast", "Ocean"]]
        
        # 1. First Pass: Assign Ocean or other non-Coast biomes randomly
        ocean_chance = 1.0 / (len(non_coast_biomes) + 1)
        for i in range(len(self.faces)):
            if random.random() < ocean_chance:
                self.face_biomes[i] = "Ocean"
            else:
                self.face_biomes[i] = random.choice(non_coast_biomes)
        
        # 2. Second Pass: Change tiles bordering Oceans to Coast
        for i in range(len(self.faces)):
            if self.face_biomes[i] != "Ocean":
                is_coast = False
                for neighbor_idx in self.face_neighbors[i]:
                    if self.face_biomes[neighbor_idx] == "Ocean":
                        is_coast = True
                        break
                if is_coast:
                    self.face_biomes[i] = "Coast"

def main():
    """Main function to run the Pygame application."""
    pygame.init()
    screen = pygame.display.set_mode((SCREEN_WIDTH, SCREEN_HEIGHT))
    pygame.display.set_caption("Rotating Biome Sphere")
    clock = pygame.time.Clock()

    sphere = IcosahedronSphere(subdivisions=SUBDIVISIONS)

    angle_x, angle_y, angle_z = 0, 0, 0

    running = True
    while running:
        for event in pygame.event.get():
            if event.type == pygame.QUIT:
                running = False

        # Update angles for rotation
        angle_x += ROTATION_SPEED
        angle_y += ROTATION_SPEED
        angle_z += ROTATION_SPEED

        # Create rotation matrices
        rot_x = np.array([[1, 0, 0], [0, np.cos(angle_x), -np.sin(angle_x)], [0, np.sin(angle_x), np.cos(angle_x)]])
        rot_y = np.array([[np.cos(angle_y), 0, np.sin(angle_y)], [0, 1, 0], [-np.sin(angle_y), 0, np.cos(angle_y)]])
        rot_z = np.array([[np.cos(angle_z), -np.sin(angle_z), 0], [np.sin(angle_z), np.cos(angle_z), 0], [0, 0, 1]])
        
        # Combine rotations and apply to vertices
        rotation_matrix = rot_z @ rot_y @ rot_x
        rotated_vertices = sphere.vertices @ rotation_matrix.T

        screen.fill(BACKGROUND_COLOR)

        # Painter's algorithm: Sort faces by depth before drawing
        sorted_faces = sorted(
            range(len(sphere.faces)),
            key=lambda i: sum(rotated_vertices[v][2] for v in sphere.faces[i]),
            reverse=True
        )

        for i in sorted_faces:
            face = sphere.faces[i]
            
            # Check if face is visible (simple back-face culling)
            v0, v1, v2 = [rotated_vertices[idx] for idx in face]
            normal = np.cross(v1 - v0, v2 - v0)
            if normal[2] > 0: # If the z-component of the normal is positive, it's facing away
                continue

            points = []
            for vertex_idx in face:
                v = rotated_vertices[vertex_idx]
                x = int(v[0] * SCALE + SCREEN_WIDTH / 2)
                y = int(v[1] * SCALE + SCREEN_HEIGHT / 2)
                points.append((x, y))

            biome_name = sphere.face_biomes[i]
            color = BIOMES.get(biome_name, (255, 255, 255))
            pygame.draw.polygon(screen, color, points)
            # Optional: Draw black outlines for clarity
            # pygame.draw.polygon(screen, (0, 0, 0), points, 1)

        pygame.display.flip()
        clock.tick(60)

    pygame.quit()

if __name__ == "__main__":
    main()
