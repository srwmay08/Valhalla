// --- Setup Scene, Camera, and Renderer (same as before) ---
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer();
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
let worldData; // To store our world data locally
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
let lastHoveredFaceIndex = null;
const infoDiv = document.getElementById('info');


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
        
        const colors = [];
        const color = new THREE.Color();
        data.tiles.forEach(tile => {
            color.setHex(tile.color);
            const face = data.faces[tile.id];
            // Since we are setting vertex colors, and a face has 3 vertices,
            // we need to set the color for each vertex of the face.
            // This approach is simple but less efficient than per-face coloring in shaders.
            // For now, we set the same color for all 3 vertices of a face.
        });

        // We need a color attribute for each vertex, not each face.
        const vertexColors = new Float32Array(data.vertices.length * 3);
        data.tiles.forEach(tile => {
            color.setHex(tile.color);
            const faceVertices = data.faces[tile.id];
            faceVertices.forEach(vertexIndex => {
                vertexColors[vertexIndex * 3] = color.r;
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
    });

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
        // --- THIS IS THE FIX ---
        // Use `faceIndex` directly from the intersection object.
        const faceIndex = intersects[0].faceIndex; 

        if (faceIndex !== lastHoveredFaceIndex) {
            lastHoveredFaceIndex = faceIndex;
            const tile = worldData.tiles[faceIndex]; // This will now be correct
            
            if (tile) { // Add a check to be safe
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
        infoDiv.style.display = 'none';
        lastHoveredFaceIndex = null;
    }
}

function onMouseClick(event) {
    // The `lastHoveredFaceIndex` is already correctly set by onMouseMove, so this function works with the fix.
    if (!sphereMesh || lastHoveredFaceIndex === null) return;
    
    const tile = worldData.tiles[lastHoveredFaceIndex];
    if (tile) { // Add a check to be safe
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