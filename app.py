from flask import Flask, jsonify, render_template
import math

# --- Icosphere Generation ---

def create_ico_sphere(subdivisions):
    """Creates an icosphere with a specified number of subdivisions."""
    # Start with the 12 vertices of a regular icosahedron
    t = (1.0 + math.sqrt(5.0)) / 2.0
    vertices = [
        [-1,  t,  0], [ 1,  t,  0], [-1, -t,  0], [ 1, -t,  0],
        [ 0, -1,  t], [ 0,  1,  t], [ 0, -1, -t], [ 0,  1, -t],
        [ t,  0, -1], [ t,  0,  1], [-t,  0, -1], [-t,  0,  1]
    ]

    # And the 20 faces
    faces = [
        [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
        [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
        [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
        [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]
    ]

    # --- Subdivide faces ---
    for _ in range(subdivisions):
        faces_subdiv = []
        for tri in faces:
            # Get the vertices for this triangle
            v1 = vertices[tri[0]]
            v2 = vertices[tri[1]]
            v3 = vertices[tri[2]]

            # Calculate the midpoints
            v12 = [(v1[0] + v2[0]) / 2.0, (v1[1] + v2[1]) / 2.0, (v1[2] + v2[2]) / 2.0]
            v23 = [(v2[0] + v3[0]) / 2.0, (v2[1] + v3[1]) / 2.0, (v2[2] + v3[2]) / 2.0]
            v31 = [(v3[0] + v1[0]) / 2.0, (v3[1] + v1[1]) / 2.0, (v3[2] + v1[2]) / 2.0]

            # Add the new vertices to our list
            i12 = len(vertices)
            vertices.append(v12)
            i23 = len(vertices)
            vertices.append(v23)
            i31 = len(vertices)
            vertices.append(v31)

            # Create the 4 new faces
            faces_subdiv.extend([
                [tri[0], i12, i31],
                [tri[1], i23, i12],
                [tri[2], i31, i23],
                [i12, i23, i31]
            ])
        faces = faces_subdiv

    # --- Normalize vertices to form a sphere ---
    for i in range(len(vertices)):
        length = math.sqrt(vertices[i][0]**2 + vertices[i][1]**2 + vertices[i][2]**2)
        vertices[i] = [vertices[i][0] / length, vertices[i][1] / length, vertices[i][2] / length]

    return vertices, faces

# --- Flask App ---

app = Flask(__name__)

@app.route('/')
def index():
    """Serves the main HTML page."""
    return render_template('index.html')

@app.route('/get_sphere_data')
def get_sphere_data():
    """Provides the sphere geometry as JSON."""
    # 5 subdivisions will give you 20,480 triangles.
    # Be cautious with more subdivisions as it can slow down the browser.
    vertices, faces = create_ico_sphere(subdivisions=5)
    return jsonify({'vertices': vertices, 'faces': faces})

if __name__ == '__main__':
    app.run(debug=True)