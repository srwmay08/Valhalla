// static/js/main.js

// --- Configuration ---
const COLORS = {
    background: 0x050510,
    globeEmissive: 0x000000,
    neutral: 0x888888,
    highlight: 0xffff00,
    connection: 0x444444,
    validTarget: 0x00ff00,
    invalidTarget: 0xff0000
};

// --- Global State ---
let scene, camera, renderer, controls;
let gameState = null;
let fortressMeshes = {}; 
let connectionLines = [];
let selectedSourceId = null;
let fortressTexture = null;
let troopSprites = []; // Track active animations

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

function init() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(COLORS.background);
    
    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.z = 3.5;

    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    document.getElementById('canvas-container').appendChild(renderer.domElement);

    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.minDistance = 2;
    controls.maxDistance = 10;

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.8);
    scene.add(ambientLight);
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.5);
    dirLight.position.set(10, 10, 10);
    scene.add(dirLight);
    
    // Load Texture
    const loader = new THREE.TextureLoader();
    fortressTexture = loader.load('/static/fortress.svg'); // Ensure this file exists in static/

    fetch('/api/gamestate')
        .then(res => res.json())
        .then(data => {
            gameState = data;
            buildWorld(data);
            startAnimation();
        });

    window.addEventListener('resize', onWindowResize);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('click', onMouseClick);
    
    uiSlider.addEventListener('input', (e) => { uiSendVal.textContent = e.target.value; });
}

function buildWorld(data) {
    // Globe
    const globeGeo = new THREE.BufferGeometry();
    const verticesFlat = data.vertices.flat();
    globeGeo.setAttribute('position', new THREE.Float32BufferAttribute(verticesFlat, 3));
    globeGeo.setIndex(data.faces.flat());
    
    const nonIndexedGeo = globeGeo.toNonIndexed(); 
    const posAttribute = nonIndexedGeo.attributes.position;
    const colorAttribute = new THREE.BufferAttribute(new Float32Array(posAttribute.count * 3), 3);
    const tempColor = new THREE.Color();
    
    for (let i = 0; i < data.face_colors.length; i++) {
        tempColor.setHex(data.face_colors[i]);
        for (let v = 0; v < 3; v++) {
            const idx = (i * 3) + v;
            colorAttribute.setXYZ(idx, tempColor.r, tempColor.g, tempColor.b);
        }
    }
    nonIndexedGeo.setAttribute('color', colorAttribute);
    nonIndexedGeo.computeVertexNormals();

    const globeMat = new THREE.MeshPhongMaterial({
        vertexColors: true, shininess: 5, flatShading: true, side: THREE.DoubleSide,
        polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 1
    });
    scene.add(new THREE.Mesh(nonIndexedGeo, globeMat));

    // Fortresses
    data.vertices.forEach((v, index) => {
        const material = new THREE.SpriteMaterial({ map: fortressTexture, color: COLORS.neutral });
        const sprite = new THREE.Sprite(material);
        sprite.position.set(v[0], v[1], v[2]);
        sprite.center.set(0.5, 0.0); 
        sprite.scale.set(0.25, 0.25, 1);
        sprite.userData = { id: index.toString(), type: 'fortress' };
        scene.add(sprite);
        fortressMeshes[index.toString()] = sprite;
    });

    // Roads
    const lineMaterial = new THREE.LineBasicMaterial({ color: COLORS.connection, transparent: true, opacity: 0.3, depthTest: false });
    data.roads.forEach(road => {
        const v1 = new THREE.Vector3(...data.vertices[road[0]]);
        const v2 = new THREE.Vector3(...data.vertices[road[1]]);
        const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([v1, v2]), lineMaterial);
        scene.add(line);
        connectionLines.push(line);
    });
    
    updateVisuals(data.fortresses);
}

// --- Visual Updates ---

socket.on('update_map', (fortresses) => {
    if (!gameState) return;
    gameState.fortresses = fortresses;
    updateVisuals(fortresses);
    if (selectedSourceId) showUI(selectedSourceId);
});

socket.on('troop_movement', (data) => {
    // data = { source, target, race, count }
    animateTroop(data.source, data.target, data.race);
});

function updateVisuals(fortresses) {
    for (const [id, data] of Object.entries(fortresses)) {
        const sprite = fortressMeshes[id];
        if (!sprite) continue;
        
        if (data.owner) {
            const raceInfo = gameState.races[data.race];
            sprite.material.color.setHex(raceInfo ? raceInfo.color : COLORS.neutral);
        } else {
            sprite.material.color.setHex(COLORS.neutral);
        }
        
        const baseSize = 0.25;
        const growth = Math.min(data.units, 100) / 400.0;
        sprite.scale.set(baseSize + growth, baseSize + growth, 1);
        
        if (data.special_active) {
             sprite.material.color.lerp(new THREE.Color(0xffffff), 0.3);
        }
    }
}

// --- Animation Logic ---

function animateTroop(srcId, tgtId, race) {
    const startMesh = fortressMeshes[srcId];
    const endMesh = fortressMeshes[tgtId];
    if(!startMesh || !endMesh) return;

    // Create a small sprite for the creature
    // Ideally use a race-specific texture here
    const mat = new THREE.SpriteMaterial({ 
        map: fortressTexture, // Reusing fortress icon as placeholder
        color: gameState.races[race] ? gameState.races[race].color : 0xffffff
    });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(0.1, 0.1, 1);
    sprite.position.copy(startMesh.position);
    scene.add(sprite);

    // Animation Data
    const duration = 1000; // ms
    const startTime = Date.now();
    
    troopSprites.push({
        sprite: sprite,
        startPos: startMesh.position.clone(),
        endPos: endMesh.position.clone(),
        startTime: startTime,
        duration: duration
    });
}

function updateAnimations() {
    const now = Date.now();
    for (let i = troopSprites.length - 1; i >= 0; i--) {
        const anim = troopSprites[i];
        const elapsed = now - anim.startTime;
        const progress = Math.min(elapsed / anim.duration, 1.0);

        // Linear interpolation
        anim.sprite.position.lerpVectors(anim.startPos, anim.endPos, progress);

        if (progress >= 1.0) {
            // Remove
            scene.remove(anim.sprite);
            troopSprites.splice(i, 1);
        }
    }
}

// --- Interaction ---

const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

function onMouseMove(event) {
    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
}

function onMouseClick(event) {
    if (event.target.closest('#game-ui') || event.target.closest('.navbar')) return;
    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObjects(Object.values(fortressMeshes));

    if (intersects.length > 0) {
        handleNodeSelection(intersects[0].object.userData.id);
    } else {
        selectedSourceId = null;
        uiDiv.style.display = 'none';
        resetHighlights();
    }
}

function handleNodeSelection(id) {
    const fortress = gameState.fortresses[id];
    
    // Select Source
    if (selectedSourceId === null) {
        if (fortress.owner === playerUsername) {
            selectedSourceId = id;
            showUI(id);
            if (fortressMeshes[id]) fortressMeshes[id].material.color.setHex(COLORS.highlight);
            statusMsg.textContent = "Select a connected fortress to attack.";
        } else {
            showUI(id);
            statusMsg.textContent = "Enemy/Neutral Fortress";
        }
    } 
    // Select Target
    else {
        if (id === selectedSourceId) { // Cancel
            selectedSourceId = null; uiDiv.style.display = 'none'; resetHighlights(); return;
        }
        
        socket.emit('submit_move', { source: selectedSourceId, target: id, amount: parseInt(uiSlider.value) });
        selectedSourceId = null;
        uiDiv.style.display = 'none';
        statusMsg.textContent = "Troops sent!";
        resetHighlights();
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
        uiSpecial.textContent = f.special_active ? `${gameState.races[f.race].special_unit} Active` : "Locked";
        uiSpecial.style.color = f.special_active ? "#0f0" : "#aaa";
    } else { uiSpecial.textContent = "None"; }

    if (f.owner === playerUsername) {
        uiActionArea.style.display = 'block';
        uiSlider.max = Math.floor(f.units);
        uiSlider.value = Math.floor(f.units / 2);
        uiSendVal.textContent = uiSlider.value;
        btnAction.textContent = (selectedSourceId === id) ? "Select Destination" : "Select as Source";
        btnAction.disabled = (selectedSourceId === id);
        btnAction.onclick = () => handleNodeSelection(id);
    } else { uiActionArea.style.display = 'none'; }
}

function resetHighlights() {
    if (gameState && gameState.fortresses) updateVisuals(gameState.fortresses);
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

function startAnimation() {
    function animate() {
        requestAnimationFrame(animate);
        updateAnimations(); // New logic for creature movement
        controls.update();
        renderer.render(scene, camera);
    }
    animate();
}

init();