// --- Scene Setup ---
// These are the fundamental components of a Three.js application.
const scene = new THREE.Scene(); // The container for all 3D objects.
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000); // The viewpoint.
const renderer = new THREE.WebGLRenderer({ antialias: true }); // The engine that draws the scene onto the screen.
renderer.setSize(window.innerWidth, window.innerHeight);
document.getElementById('container').appendChild(renderer.domElement);

// --- Controls ---
// OrbitControls allow the user to rotate (orbit), pan, and zoom the camera with the mouse.
const controls = new THREE.OrbitControls(camera, renderer.domElement);
controls.enableDamping = true; // Creates a smoother, decelerating motion.

// --- Lighting ---
// Ambient light provides a soft, baseline illumination for the entire scene.
const ambientLight = new THREE.AmbientLight(0x404040, 2);
scene.add(ambientLight);
// Directional light simulates a distant light source like the sun.
const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
directionalLight.position.set(5, 3, 5);
scene.add(directionalLight);
camera.position.z = 3; // Initial camera position.

// --- State and Interaction Variables ---
let sphereMesh, wireframeMesh, worldData; // To hold our main 3D objects and fetched data.
const raycaster = new THREE.Raycaster(); // Used to detect mouse intersections with objects.
const mouse = new THREE.Vector2(); // Stores the mouse's 2D coordinates.
let lastHoveredFaceIndex = null; // To track the previously hovered tile.
const infoDiv = document.getElementById('info'); // The HTML element for the info panel.
const SURFACE_HIGHLIGHT_COLOR = new THREE.Color(0xffff00); // Yellow
const SUBTERRANEAN_HIGHLIGHT_COLOR = new THREE.Color(0xff4500); // OrangeRed

// State variables to track the camera's position relative to the sphere.
let isCameraInside = false;
let lastCameraState = false;

// --- Data Fetching and Sphere Creation ---
// Fetch the procedurally generated world data from our Flask backend.
fetch('/api/world_data')
    .then(response => response.json())
    .then(data => {
        worldData = data;
        const geometry = new THREE.BufferGeometry();
        const positions = [];
        const colors = new Float32Array(data.tiles.length * 3 * 3);

        for (const tile of data.tiles) {
            const faceVertexIndices = data.faces[tile.surface_id];
            const v1 = data.vertices[faceVertexIndices[0]], v2 = data.vertices[faceVertexIndices[1]], v3 = data.vertices[faceVertexIndices[2]];
            positions.push(...v1, ...v2, ...v3);
        }
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
        geometry.computeVertexNormals();
        
        const material = new THREE.MeshPhongMaterial({ side: THREE.DoubleSide, vertexColors: true, shininess: 10 });

        // --- FIX: Create the sphereMesh object BEFORE trying to color it. ---
        sphereMesh = new THREE.Mesh(geometry, material);
        
        // Now that sphereMesh exists, we can safely call updateSphereColors to apply the initial surface colors.
        updateSphereColors(false); 

        // Add the fully colored sphere to the scene.
        scene.add(sphereMesh);
        
        // Add the black wireframe borders.
        const wireframeGeometry = new THREE.WireframeGeometry(geometry);
        const wireframeMaterial = new THREE.LineBasicMaterial({ color: 0x000000, linewidth: 1 });
        wireframeMesh = new THREE.LineSegments(wireframeGeometry, wireframeMaterial);
        scene.add(wireframeMesh);
        
        // Add visual markers for Caverns.
        const cavernMaterial = new THREE.MeshBasicMaterial({ color: 0x000000 });
        for (const tile of data.tiles) {
            if (tile.surface_terrain === 'Cavern') {
                const faceVertexIndices = data.faces[tile.surface_id];
                const vA=new THREE.Vector3().fromArray(data.vertices[faceVertexIndices[0]]); const vB=new THREE.Vector3().fromArray(data.vertices[faceVertexIndices[1]]); const vC=new THREE.Vector3().fromArray(data.vertices[faceVertexIndices[2]]);
                const center=new THREE.Vector3().add(vA).add(vB).add(vC).divideScalar(3);
                const normal=new THREE.Vector3().crossVectors(vB.clone().sub(vA),vC.clone().sub(vA)).normalize();
                const circleGeometry=new THREE.CircleGeometry(0.015,20); const circle=new THREE.Mesh(circleGeometry,cavernMaterial);
                circle.position.copy(center).add(normal.clone().multiplyScalar(0.001));
                circle.lookAt(center.clone().add(normal));
                scene.add(circle);
            }
        }
    });

// --- Core Functions ---

/**
 * Rewrites the entire color buffer of the sphere based on camera position.
 * @param {boolean} isInside - True if the camera is inside the sphere, false otherwise.
 */
function updateSphereColors(isInside) {
    if (!sphereMesh || !worldData) return;
    const color = new THREE.Color();
    const colorAttribute = sphereMesh.geometry.attributes.color;

    worldData.tiles.forEach((tile, index) => {
        const colorHex = isInside ? tile.subterranean_color : tile.surface_color;
        color.setHex(colorHex);
        colorAttribute.setXYZ(index * 3, color.r, color.g, color.b);
        colorAttribute.setXYZ(index * 3 + 1, color.r, color.g, color.b);
        colorAttribute.setXYZ(index * 3 + 2, color.r, color.g, color.b);
    });
    colorAttribute.needsUpdate = true; // Crucial: tells Three.js to apply the changes.
}

/**
 * Helper function to change the color of a single face for highlighting.
 * @param {number} faceIndex - The index of the face to color.
 * @param {THREE.Color} color - The color to apply to the face.
 */
function setFaceColor(faceIndex, color) {
    if (!sphereMesh) return;
    const colorAttribute = sphereMesh.geometry.attributes.color;
    colorAttribute.setXYZ(faceIndex * 3, color.r, color.g, color.b);
    colorAttribute.setXYZ(faceIndex * 3 + 1, color.r, color.g, color.b);
    colorAttribute.setXYZ(faceIndex * 3 + 2, color.r, color.g, color.b);
    colorAttribute.needsUpdate = true;
}

// --- Event Handlers ---

function onMouseMove(event) {
    if (!sphereMesh || !worldData) return;
    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObject(sphereMesh);

    // Revert the previously hovered tile before doing anything else.
    if (lastHoveredFaceIndex !== null) {
        const tile = worldData.tiles[lastHoveredFaceIndex];
        const originalColorHex = isCameraInside ? tile.subterranean_color : tile.surface_color;
        setFaceColor(lastHoveredFaceIndex, new THREE.Color(originalColorHex));
        lastHoveredFaceIndex = null;
        infoDiv.style.display = 'none';
    }

    if (intersects.length > 0) {
        const intersection = intersects[0];
        const faceIndex = Math.floor(intersection.face.a / 3);
        const tile = worldData.tiles[faceIndex];
        const normal = intersection.face.normal;
        const viewDirection = raycaster.ray.direction;
        const dotProduct = viewDirection.dot(normal);

        let shouldHighlight = false;
        let highlightColor, idToShow, terrainToShow;

        if (isCameraInside && dotProduct > 0) { // Inside view, hit an inner face
            shouldHighlight = true;
            highlightColor = SUBTERRANEAN_HIGHLIGHT_COLOR;
            idToShow = `SUBTERRANEAN ID: ${tile.subterranean_id}`;
            terrainToShow = tile.subterranean_terrain;
        } else if (!isCameraInside && dotProduct < 0) { // Outside view, hit an outer face
            shouldHighlight = true;
            highlightColor = SURFACE_HIGHLIGHT_COLOR;
            idToShow = `SURFACE ID: ${tile.surface_id}`;
            terrainToShow = tile.surface_terrain;
        }

        if (shouldHighlight) {
            setFaceColor(faceIndex, highlightColor);
            lastHoveredFaceIndex = faceIndex;
            infoDiv.style.display = 'block';
            infoDiv.style.left = `${event.clientX + 10}px`;
            infoDiv.style.top = `${event.clientY + 10}px`;
            let infoHtml = `<strong>${idToShow}</strong><br>Terrain: ${terrainToShow}<hr>`;
            for (const [scale, value] of Object.entries(tile.scales)) {
                infoHtml += `${scale}: ${value >= 0 ? '+' : ''}${value}<br>`;
            }
            infoDiv.innerHTML = infoHtml;
        }
    }
}

function onMouseClick(event) {
    if (lastHoveredFaceIndex !== null) {
        alert(`Clicked Surface ID: ${worldData.tiles[lastHoveredFaceIndex].surface_id}`);
    }
}
function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

// --- Animation Loop ---
function animate() {
    requestAnimationFrame(animate);
    controls.update();

    // Check if the camera has crossed the sphere boundary on each frame.
    if (sphereMesh) {
        isCameraInside = camera.position.length() < 1.0;
        if (isCameraInside !== lastCameraState) {
            // If the state changed, trigger the full color swap.
            updateSphereColors(isCameraInside);
        }
        lastCameraState = isCameraInside; // Update the state for the next frame.
    }

    renderer.render(scene, camera);
}

// Start the animation loop and add event listeners.
window.addEventListener('mousemove', onMouseMove);
window.addEventListener('click', onMouseClick);
window.addEventListener('resize', onWindowResize);
animate();