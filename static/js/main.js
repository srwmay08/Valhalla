// --- Scene Setup ---
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
document.getElementById('container').appendChild(renderer.domElement);
const controls = new THREE.OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

// --- Lighting ---
// Ambient light provides a soft, baseline illumination for the entire scene.
const ambientLight = new THREE.AmbientLight(0x404040, 2);
scene.add(ambientLight);
// Directional light simulates a distant light source like the sun.
const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
directionalLight.position.set(5, 3, 5);
camera.add(directionalLight); // This line now adds the light as a child of the camera.

// --- State and Interaction Variables ---
let sphereMesh, wireframeMesh, worldData;
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
let lastHoveredFaceIndex = null;
const infoDiv = document.getElementById('info');
const SURFACE_HIGHLIGHT_COLOR = new THREE.Color(0xffff00);
const SUBTERRANEAN_HIGHLIGHT_COLOR = new THREE.Color(0xff4500);
let isCameraInside = false;
let lastCameraState = false;

// --- Data Fetching and Sphere Creation ---
fetch('/api/world_data')
    .then(response => response.json())
    .then(data => {
        worldData = data;
        const geometry = new THREE.BufferGeometry();
        const positions = [];
        const colors = [];
        const color = new THREE.Color();

        // --- FIX: Build all position and color data BEFORE creating the mesh ---
        // 1. Loop through all tiles to build the arrays for our geometry.
        for (const tile of data.tiles) {
            const faceVertexIndices = data.faces[tile.surface_id];
            
            // Get the vertices for this face and add them to the positions array.
            const v1 = data.vertices[faceVertexIndices[0]], v2 = data.vertices[faceVertexIndices[1]], v3 = data.vertices[faceVertexIndices[2]];
            positions.push(...v1, ...v2, ...v3);

            // Get the initial SURFACE color and add it for all 3 vertices of this face.
            color.setHex(tile.surface_color);
            colors.push(color.r, color.g, color.b,  color.r, color.g, color.b,  color.r, color.g, color.b);
        }

        // 2. Set the geometry attributes with the fully populated data.
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
        geometry.computeVertexNormals();
        
        // 3. Create the material and the final mesh object.
        const material = new THREE.MeshPhongMaterial({ side: THREE.DoubleSide, vertexColors: true, shininess: 10 });
        sphereMesh = new THREE.Mesh(geometry, material);
        
        // 4. Now that the sphere is fully created and colored, add it to the scene.
        scene.add(sphereMesh);
        
        // 5. Add the wireframe and cavern markers.
        const wireframeGeometry = new THREE.WireframeGeometry(geometry);
        const wireframeMaterial = new THREE.LineBasicMaterial({ color: 0x000000, linewidth: 1 });
        wireframeMesh = new THREE.LineSegments(wireframeGeometry, wireframeMaterial);
        scene.add(wireframeMesh);
        
        const cavernMaterial = new THREE.MeshBasicMaterial({ color: 0x000000 });
        for (const tile of data.tiles) {
            if (tile.has_cavern) {
                const faceVertexIndices = data.faces[tile.surface_id];
                const vA=new THREE.Vector3().fromArray(data.vertices[faceVertexIndices[0]]); const vB=new THREE.Vector3().fromArray(data.vertices[faceVertexIndices[1]]); const vC=new THREE.Vector3().fromArray(data.vertices[faceVertexIndices[2]]);
                const center=new THREE.Vector3().add(vA).add(vB).add(vC).divideScalar(3);
                const normal=new THREE.Vector3().crossVectors(vB.clone().sub(vA),vC.clone().sub(vA)).normalize();
                const circleGeometry=new THREE.CircleGeometry(0.015,20);
                const circle=new THREE.Mesh(circleGeometry,cavernMaterial);
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
    colorAttribute.needsUpdate = true;
}

/**
 * Helper function to change the color of a single face for highlighting.
 */
function setFaceColor(faceIndex, color) {
    if (!sphereMesh) return;
    const colorAttribute = sphereMesh.geometry.attributes.color;
    colorAttribute.setXYZ(faceIndex * 3, color.r, color.g, color.b);
    colorAttribute.setXYZ(faceIndex * 3 + 1, color.r, color.g, color.b);
    colorAttribute.setXYZ(faceIndex * 3 + 2, color.r, color.g, color.b);
    colorAttribute.needsUpdate = true;
}

// --- Event Handlers (Unchanged) ---
function onMouseMove(event) {
    if (!sphereMesh || !worldData) return;
    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObject(sphereMesh);

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

        if (isCameraInside && dotProduct > 0) {
            shouldHighlight = true;
            highlightColor = SUBTERRANEAN_HIGHLIGHT_COLOR;
            idToShow = `SUBTERRANEAN ID: ${tile.subterranean_id}`;
            terrainToShow = tile.subterranean_terrain;
        } else if (!isCameraInside && dotProduct < 0) {
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
            let infoHtml = `<strong>${idToShow}</strong><br>Terrain: ${terrainToShow}<br>`;
            if (tile.has_cavern) {
                infoHtml += `<em><span style="color: #DDA0DD;">(Linked by Cavern)</span></em><br>`;
            }
            infoHtml += `<hr>`;
            for(const[scale,value]of Object.entries(tile.scales)){infoHtml+=`${scale}: ${value>=0?'+':''}${value}<br>`;}
            infoDiv.innerHTML = infoHtml;
        }
    }
}

// --- Animation Loop and Listeners (Unchanged) ---
// In static/js/main.js
function onMouseClick(event) {
    // Check if a tile is currently being hovered over.
    if (lastHoveredFaceIndex !== null) {
        // Get the full data for the clicked tile.
        const tile = worldData.tiles[lastHoveredFaceIndex];
        
        // Log a debug message to the console instead of showing a pop-up.
        console.log(`Tile Clicked: Surface ID ${tile.surface_id} / Subterranean ID ${tile.subterranean_id}`);
    }
}
function onWindowResize() { camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix(); renderer.setSize(window.innerWidth, window.innerHeight); }
function animate() {
    requestAnimationFrame(animate);
    controls.update();
    if (sphereMesh) {
        isCameraInside = camera.position.length() < 1.0;
        if (isCameraInside !== lastCameraState) {
            updateSphereColors(isCameraInside);
        }
        lastCameraState = isCameraInside;
    }
    renderer.render(scene, camera);
}
window.addEventListener('mousemove', onMouseMove);
window.addEventListener('click', onMouseClick);
window.addEventListener('resize', onWindowResize);
animate();