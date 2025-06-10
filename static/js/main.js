// In static/js/main.js

// --- Scene Setup ---
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
// IMPORTANT: Append the renderer to the container inside our new app-container
document.getElementById('app-container').appendChild(renderer.domElement); 
const controls = new THREE.OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
const ambientLight = new THREE.AmbientLight(0x404040, 2);
scene.add(ambientLight);
const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
directionalLight.position.set(5, 3, 5);
camera.add(directionalLight);
camera.position.z = 3;

// --- State and Interaction Variables ---
let sphereMesh, wireframeMesh, worldData;
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
let lastHoveredFaceIndex = null;
const infoDiv = document.getElementById('info');
const viewToggleButton = document.getElementById('view-toggle');
const playerUsername = document.getElementById('username').textContent;
const socket = io();

const SURFACE_HIGHLIGHT_COLOR = new THREE.Color(0xffff00);
const SUBTERRANEAN_HIGHLIGHT_COLOR = new THREE.Color(0xff4500);
const MY_TILE_COLOR = new THREE.Color(0x00FFFF);
const OTHER_PLAYER_TILE_COLOR = new THREE.Color(0xFF0000);

let isSubterraneanView = false;
let tileOwnership = {}; // This will store which player owns which tile

// --- WebSocket Listeners ---
socket.on('world_update', (ownershipData) => {
    if (!worldData) return;
    tileOwnership = ownershipData;
    updateAllTileColors();
});

// --- Core Functions ---

function updateAllTileColors() {
    if (!sphereMesh || !worldData) return;
    const baseColors = worldData.tiles.map(tile => isSubterraneanView ? tile.subterranean_color : tile.surface_color);

    for (const username in tileOwnership) {
        const tileId = tileOwnership[username];
        if (tileId !== null && tileId < baseColors.length) {
            const ownershipColor = (username === playerUsername) ? MY_TILE_COLOR.getHex() : OTHER_PLAYER_TILE_COLOR.getHex();
            baseColors[tileId] = ownershipColor;
        }
    }

    const color = new THREE.Color();
    const colorAttribute = sphereMesh.geometry.attributes.color;
    baseColors.forEach((colorHex, index) => {
        color.setHex(colorHex);
        colorAttribute.setXYZ(index * 3, color.r, color.g, color.b);
        colorAttribute.setXYZ(index * 3 + 1, color.r, color.g, color.b);
        colorAttribute.setXYZ(index * 3 + 2, color.r, color.g, color.b);
    });
    colorAttribute.needsUpdate = true;
}

function updateSphereColors(isSubView) {
    isSubterraneanView = isSubView;
    updateAllTileColors();
}

function setFaceColor(faceIndex, color) {
    if (!sphereMesh) return;
    const colorAttribute = sphereMesh.geometry.attributes.color;
    colorAttribute.setXYZ(faceIndex * 3, color.r, color.g, color.b);
    colorAttribute.setXYZ(faceIndex * 3 + 1, color.r, color.g, color.b);
    colorAttribute.setXYZ(faceIndex * 3 + 2, color.r, color.g, color.b);
    colorAttribute.needsUpdate = true;
}

// --- Data Fetching and Sphere Creation ---
fetch('/api/world_data')
    .then(response => response.json())
    .then(data => {
        worldData = data;
        const geometry = new THREE.BufferGeometry();
        const positions = [], colors = [];
        const color = new THREE.Color();

        for (const tile of data.tiles) {
            const faceVertexIndices = data.faces[tile.surface_id];
            const v1 = data.vertices[faceVertexIndices[0]], v2 = data.vertices[faceVertexIndices[1]], v3 = data.vertices[faceVertexIndices[2]];
            positions.push(...v1, ...v2, ...v3);
            color.setHex(tile.surface_color);
            colors.push(color.r, color.g, color.b, color.r, color.g, color.b, color.r, color.g, color.b);
        }

        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
        geometry.computeVertexNormals();
        
        const material = new THREE.MeshPhongMaterial({ side: THREE.DoubleSide, vertexColors: true, shininess: 10 });
        sphereMesh = new THREE.Mesh(geometry, material);
        scene.add(sphereMesh);
        
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

// --- Event Handlers ---
function onMouseMove(event) {
    if (!sphereMesh || !worldData) return;
    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObject(sphereMesh);

    if (lastHoveredFaceIndex !== null) {
        const isOwned = Object.values(tileOwnership).includes(lastHoveredFaceIndex);
        if (!isOwned) {
            const tile = worldData.tiles[lastHoveredFaceIndex];
            const originalColorHex = isSubterraneanView ? tile.subterranean_color : tile.surface_color;
            setFaceColor(lastHoveredFaceIndex, new THREE.Color(originalColorHex));
        }
        lastHoveredFaceIndex = null;
        infoDiv.style.display = 'none';
    }

    if (intersects.length > 0) {
        const intersection = intersects[0];
        const faceIndex = Math.floor(intersection.face.a / 3);
        const tile = worldData.tiles[faceIndex];
        
        const isOwned = Object.values(tileOwnership).includes(faceIndex);
        if (!isOwned) {
            const highlightColor = isSubterraneanView ? SUBTERRANEAN_HIGHLIGHT_COLOR : SURFACE_HIGHLIGHT_COLOR;
            setFaceColor(faceIndex, highlightColor);
        }
        
        lastHoveredFaceIndex = faceIndex;
        
        infoDiv.style.display = 'block';
        infoDiv.style.left = `${event.clientX + 10}px`;
        infoDiv.style.top = `${event.clientY + 10}px`;
        
        const idToShow = isSubterraneanView ? `SUBTERRANEAN ID: ${tile.subterranean_id}` : `SURFACE ID: ${tile.surface_id}`;
        const terrainToShow = isSubterraneanView ? tile.subterranean_terrain : tile.surface_terrain;
        
        let infoHtml = `<strong>${idToShow}</strong><br>Terrain: ${terrainToShow}<br>`;
        if (tile.has_cavern) {
            infoHtml += `<em><span style="color: #DDA0DD;">(Linked by Cavern)</span></em><br>`;
        }
        infoHtml += `<hr>`;
        for (const [scale, value] of Object.entries(tile.scales)) {
            infoHtml += `${scale}: ${value >= 0 ? '+' : ''}${value}<br>`;
        }
        infoDiv.innerHTML = infoHtml;
    }
}

function onMouseClick(event) {
    if (lastHoveredFaceIndex !== null) {
        const tile = worldData.tiles[lastHoveredFaceIndex];
        console.log(`Sending tile selection to server: ${tile.surface_id}`);
        socket.emit('select_tile', { tile_id: tile.surface_id });
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

// Event Listeners
window.addEventListener('mousemove', onMouseMove);
window.addEventListener('click', onMouseClick);
window.addEventListener('resize', onWindowResize);

viewToggleButton.addEventListener('click', () => {
    isSubterraneanView = !isSubterraneanView;
    viewToggleButton.innerText = isSubterraneanView ? 'View Surface' : 'View Subterranean';
    updateAllTileColors();
});

animate();