// --- Setup Scene, Camera, and Renderer ---
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
document.getElementById('container').appendChild(renderer.domElement);

const controls = new THREE.OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
const ambientLight = new THREE.AmbientLight(0x404040, 2);
scene.add(ambientLight);
const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
directionalLight.position.set(5, 3, 5);
scene.add(directionalLight);
camera.position.z = 3;

// --- Variables for interactivity ---
let sphereMesh;
let wireframeMesh;
let worldData;
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
let lastHoveredFaceIndex = null;
const infoDiv = document.getElementById('info');

// --- NEW: Define a highlight color for easy access ---
const HIGHLIGHT_COLOR = new THREE.Color(0xffff00); // Bright yellow

// --- Fetch and Create the Sphere ---
fetch('/api/world_data')
    .then(response => response.json())
    .then(data => {
        worldData = data;
        const geometry = new THREE.BufferGeometry();

        const vertices = new Float32Array(data.vertices.flat());
        const indices = new Uint32Array(data.faces.flat());

        geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
        geometry.setIndex(new THREE.BufferAttribute(indices, 1));
        
        // --- Set initial vertex colors based on terrain ---
        const vertexColors = new Float32Array(data.vertices.length * 3);
        const color = new THREE.Color();
        data.tiles.forEach(tile => {
            color.setHex(tile.color);
            const faceVertexIndices = data.faces[tile.id];
            faceVertexIndices.forEach(vertexIndex => {
                vertexColors[vertexIndex * 3]     = color.r;
                vertexColors[vertexIndex * 3 + 1] = color.g;
                vertexColors[vertexIndex * 3 + 2] = color.b;
            });
        });
        geometry.setAttribute('color', new THREE.BufferAttribute(vertexColors, 3));
        
        geometry.computeVertexNormals();

        const material = new THREE.MeshPhongMaterial({
            side: THREE.DoubleSide,
            vertexColors: true,
            shininess: 10
        });

        sphereMesh = new THREE.Mesh(geometry, material);
        scene.add(sphereMesh);

        const wireframeGeometry = new THREE.WireframeGeometry(geometry);
        const wireframeMaterial = new THREE.LineBasicMaterial({ color: 0x000000, linewidth: 1 });
        wireframeMesh = new THREE.LineSegments(wireframeGeometry, wireframeMaterial);
        scene.add(wireframeMesh);
    });

// --- NEW: Helper function to change the color of a face ---
function setFaceColor(faceIndex, color) {
    if (!sphereMesh || !worldData) return;

    const geometry = sphereMesh.geometry;
    const colorAttribute = geometry.attributes.color;
    
    // Get the three vertex indices for the given face
    const vertexIndexA = geometry.index.getX(faceIndex * 3);
    const vertexIndexB = geometry.index.getY(faceIndex * 3);
    const vertexIndexC = geometry.index.getZ(faceIndex * 3);

    // Apply the new color to each vertex of the face
    colorAttribute.setXYZ(vertexIndexA, color.r, color.g, color.b);
    colorAttribute.setXYZ(vertexIndexB, color.r, color.g, color.b);
    colorAttribute.setXYZ(vertexIndexC, color.r, color.g, color.b);

    // Tell Three.js that the color attribute needs to be updated
    colorAttribute.needsUpdate = true;
}


// --- Event Listeners ---
window.addEventListener('mousemove', onMouseMove);
window.addEventListener('click', onMouseClick);
window.addEventListener('resize', onWindowResize);


function onMouseMove(event) {
    if (!sphereMesh || !worldData) return;

    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObject(sphereMesh);

    if (intersects.length > 0) {
        const faceIndex = intersects[0].faceIndex;

        // --- UPDATED: Hover logic ---
        if (faceIndex !== lastHoveredFaceIndex) {
            // If we were hovering over a different tile before, revert its color
            if (lastHoveredFaceIndex !== null) {
                const originalColor = new THREE.Color(worldData.tiles[lastHoveredFaceIndex].color);
                setFaceColor(lastHoveredFaceIndex, originalColor);
            }

            // Highlight the new tile
            setFaceColor(faceIndex, HIGHLIGHT_COLOR);

            // Update state and info panel
            lastHoveredFaceIndex = faceIndex;
            const tile = worldData.tiles[faceIndex];
            
            if (tile) {
                infoDiv.style.display = 'block';
                infoDiv.style.left = `${event.clientX + 10}px`;
                infoDiv.style.top = `${event.clientY + 10}px`;
                
                let infoHtml = `<strong>TILE ID: ${tile.id}</strong><br>`;
                infoHtml += `Terrain: ${tile.terrain}<br><hr>`;
                for (const [scale, value] of Object.entries(tile.scales)) {
                    infoHtml += `${scale}: ${value >= 0 ? '+' : ''}${value}<br>`;
                }
                infoDiv.innerHTML = infoHtml;
            }
        }
    } else {
        // --- UPDATED: Mouse out logic ---
        // If we moved the mouse off the sphere, revert the last highlighted tile
        if (lastHoveredFaceIndex !== null) {
            const originalColor = new THREE.Color(worldData.tiles[lastHoveredFaceIndex].color);
            setFaceColor(lastHoveredFaceIndex, originalColor);
        }

        infoDiv.style.display = 'none';
        lastHoveredFaceIndex = null;
    }
}

function onMouseClick(event) {
    if (lastHoveredFaceIndex === null) return;
    
    const tile = worldData.tiles[lastHoveredFaceIndex];
    if (tile) {
        alert(`You clicked on TILE ID: ${tile.id} (${tile.terrain})`);
    }
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

function animate() {
    requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
}

animate();