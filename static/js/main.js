// static/js/main.js

// --- Configuration ---
const COLORS = {
    neutral: 0x555555,
    highlight: 0xffff00,
    connection: 0x444444,
    validTarget: 0x00ff00,
    invalidTarget: 0xff0000
};

// --- Global State ---
let scene, camera, renderer, controls;
let gameState = null;
let fortressMeshes = {}; // Map id -> Mesh
let connectionLines = [];
let selectedSourceId = null;
let hoverId = null;

const playerUsername = document.getElementById('username').textContent;
const socket = io();

// UI Elements
const uiDiv = document.getElementById('game-ui');
const uiTitle = document.getElementById('ui-title');
const uiOwner = document.getElementById('ui-owner');
const uiUnits = document.getElementById('ui-units');
const uiSpecial = document.getElementById('ui-special');
const uiActionArea = document.getElementById('action-area');
const uiSlider = document.getElementById('unit-slider');
const uiSendVal = document.getElementById('ui-send-val');
const btnAction = document.getElementById('btn-action');
const statusMsg = document.getElementById('status-msg');

// --- Initialization ---

function init() {
    // 1. Scene Setup
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x050510);
    
    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.z = 4;

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    document.getElementById('canvas-container').appendChild(renderer.domElement);

    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;

    // Lights
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight.position.set(5, 10, 7);
    scene.add(dirLight);

    // 2. Fetch Game Data
    fetch('/api/gamestate')
        .then(res => res.json())
        .then(data => {
            gameState = data;
            buildWorld(data);
            startAnimation();
        });

    // 3. Events
    window.addEventListener('resize', onWindowResize);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('click', onMouseClick);
    
    // UI Events
    uiSlider.addEventListener('input', (e) => {
        uiSendVal.textContent = e.target.value;
    });
}

function buildWorld(data) {
    // 1. Create Fortresses (Vertices)
    const geometry = new THREE.SphereGeometry(0.1, 16, 16);
    
    data.vertices.forEach((v, index) => {
        const material = new THREE.MeshPhongMaterial({ color: COLORS.neutral });
        const mesh = new THREE.Mesh(geometry, material);
        
        mesh.position.set(v[0], v[1], v[2]);
        mesh.userData = { id: index.toString(), type: 'fortress' };
        
        scene.add(mesh);
        fortressMeshes[index.toString()] = mesh;
    });

    // 2. Create Roads (Edges)
    const lineMaterial = new THREE.LineBasicMaterial({ color: COLORS.connection, transparent: true, opacity: 0.4 });
    
    data.roads.forEach(road => {
        const v1 = new THREE.Vector3(...data.vertices[road[0]]);
        const v2 = new THREE.Vector3(...data.vertices[road[1]]);
        const points = [v1, v2];
        const lineGeo = new THREE.BufferGeometry().setFromPoints(points);
        const line = new THREE.Line(lineGeo, lineMaterial);
        scene.add(line);
        connectionLines.push(line);
    });
    
    // 3. Initial Visual Update
    updateVisuals(data.fortresses);
}

// --- Game Logic & Visuals ---

socket.on('update_map', (fortresses) => {
    if (!gameState) return;
    gameState.fortresses = fortresses;
    updateVisuals(fortresses);
    
    // Refresh UI if selection is active
    if (selectedSourceId) {
        showUI(selectedSourceId);
    }
});

function updateVisuals(fortresses) {
    for (const [id, data] of Object.entries(fortresses)) {
        const mesh = fortressMeshes[id];
        if (!mesh) continue;
        
        // Color
        if (data.owner) {
            // Find race color
            const raceInfo = gameState.races[data.race];
            mesh.material.color.setHex(raceInfo ? raceInfo.color : COLORS.neutral);
        } else {
            mesh.material.color.setHex(COLORS.neutral);
        }
        
        // Scale (Visual indicator of garrison size)
        // Base scale 1.0, max scale 2.5 for 100 units
        const scale = 1.0 + Math.min(data.units, 100) / 70.0;
        mesh.scale.set(scale, scale, scale);
        
        // Special Effect (Emission if special active)
        if (data.special_active) {
            mesh.material.emissive.setHex(0x333333);
        } else {
            mesh.material.emissive.setHex(0x000000);
        }
    }
}

// --- Interaction ---

const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

function onMouseMove(event) {
    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
    
    // Highlight logic could go here
}

function onMouseClick(event) {
    if (event.target.closest('#game-ui') || event.target.closest('.navbar')) return;

    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObjects(Object.values(fortressMeshes));

    if (intersects.length > 0) {
        const targetMesh = intersects[0].object;
        const targetId = targetMesh.userData.id;
        
        handleNodeSelection(targetId);
    } else {
        // Deselect
        selectedSourceId = null;
        uiDiv.style.display = 'none';
        resetHighlights();
    }
}

function handleNodeSelection(id) {
    const fortress = gameState.fortresses[id];
    
    // Case 1: Selecting a source
    if (selectedSourceId === null) {
        if (fortress.owner === playerUsername) {
            selectedSourceId = id;
            showUI(id);
            highlightNode(id, COLORS.highlight);
            statusMsg.textContent = "Select a connected fortress to attack/move.";
        } else {
            // Viewing enemy info
            showUI(id);
            statusMsg.textContent = "Enemy/Neutral Fortress";
        }
    } 
    // Case 2: Acting on a target
    else {
        // If clicked same node, deselect
        if (id === selectedSourceId) {
            selectedSourceId = null;
            uiDiv.style.display = 'none';
            statusMsg.textContent = "";
            resetHighlights();
            return;
        }
        
        // Check if connected
        const sourceIdInt = parseInt(selectedSourceId);
        const targetIdInt = parseInt(id);
        
        // Check adjacency in our cached local map?
        // Actually, we can check basic distance or existing adjacency list from server
        // Using server list:
        const neighbors = gameState.adj[selectedSourceId]; // Array of numbers
        
        if (neighbors && neighbors.includes(targetIdInt)) {
            // Execute Move
            const amount = parseInt(uiSlider.value);
            socket.emit('submit_move', {
                source: selectedSourceId,
                target: id,
                amount: amount
            });
            
            // Reset
            selectedSourceId = null;
            uiDiv.style.display = 'none';
            statusMsg.textContent = "Troops sent!";
            resetHighlights();
        } else {
            statusMsg.textContent = "Not connected directly!";
        }
    }
}

function showUI(id) {
    const f = gameState.fortresses[id];
    uiDiv.style.display = 'block';
    
    uiTitle.textContent = f.is_capital ? `Capital (${id})` : `Fortress ${id}`;
    uiOwner.textContent = f.owner || "Neutral";
    uiOwner.style.color = f.owner ? '#fff' : '#aaa';
    uiUnits.textContent = Math.floor(f.units);
    
    if (f.owner && gameState.races[f.race]) {
        uiSpecial.textContent = f.special_active ? 
            `${gameState.races[f.race].special_unit} Active` : "Locked";
        uiSpecial.style.color = f.special_active ? "#0f0" : "#aaa";
    } else {
        uiSpecial.textContent = "None";
    }

    // Slider logic
    if (f.owner === playerUsername) {
        uiActionArea.style.display = 'block';
        uiSlider.max = Math.floor(f.units);
        uiSlider.value = Math.floor(f.units / 2);
        uiSendVal.textContent = uiSlider.value;
        
        if (selectedSourceId === id) {
            btnAction.textContent = "Select Destination on Map";
            btnAction.disabled = true;
        } else {
            // Viewing self but not selected as source
            btnAction.textContent = "Select as Source";
            btnAction.disabled = false;
            btnAction.onclick = () => handleNodeSelection(id);
        }
    } else {
        uiActionArea.style.display = 'none';
    }
}

function highlightNode(id, colorHex) {
    if (fortressMeshes[id]) {
        fortressMeshes[id].material.emissive.setHex(colorHex);
    }
}

function resetHighlights() {
    // Re-apply game state emission
    for (const [id, data] of Object.entries(gameState.fortresses)) {
        const mesh = fortressMeshes[id];
        if (data.special_active) {
            mesh.material.emissive.setHex(0x333333);
        } else {
            mesh.material.emissive.setHex(0x000000);
        }
    }
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

function startAnimation() {
    function animate() {
        requestAnimationFrame(animate);
        controls.update();
        renderer.render(scene, camera);
    }
    animate();
}

init();