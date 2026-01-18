// static/js/main.js

// --- Configuration ---
const COLORS = {
    background: 0x050510,
    globeBase: 0x151525,     
    globeEmissive: 0x000000,
    neutral: 0x555555,
    highlight: 0xffff00,
    connection: 0x444444,
    validTarget: 0x00ff00,
    invalidTarget: 0xff0000,
    pathFlow: 0xffaa00     // Gold/Orange for flow particles
};

// --- Global State ---
let scene, camera, renderer, controls;
let gameState = null;
let fortressMeshes = {}; 
let connectionLines = [];
let globeMesh = null;    
let selectedSourceId = null;
let selectedTargetId = null;

// Particle System State
let flowParticles = []; // Array of { mesh, curve, progress, speed }

const playerUsername = document.getElementById('username').textContent;
const socket = io();

// UI Elements
const uiDiv = document.getElementById('game-ui');
const uiTitle = document.getElementById('ui-title');
const uiOwner = document.getElementById('ui-owner');
const uiUnits = document.getElementById('ui-units');
const uiSpecial = document.getElementById('ui-special');
const uiActionArea = document.getElementById('action-area');
const btnAction = document.getElementById('btn-action');
const statusMsg = document.getElementById('status-msg');

// --- Initialization ---

function init() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(COLORS.background);
    
    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.z = 3.5;

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    document.getElementById('canvas-container').appendChild(renderer.domElement);

    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.minDistance = 2;
    controls.maxDistance = 10;

    scene.add(new THREE.AmbientLight(0xffffff, 0.4));
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight.position.set(10, 10, 10);
    scene.add(dirLight);
    const backLight = new THREE.DirectionalLight(0x4444ff, 0.3);
    backLight.position.set(-10, -5, -10);
    scene.add(backLight);

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
}

function createFortressMesh(colorHex, tier) {
    const group = new THREE.Group();
    const material = new THREE.MeshPhongMaterial({ color: colorHex });
    const baseHeight = 0.15 + (tier - 1) * 0.10; 
    
    // Tower
    const tower = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, baseHeight, 8), material);
    tower.position.y = baseHeight / 2; 
    group.add(tower);

    // Top
    const top = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.04, 0.05, 8), material);
    top.position.y = baseHeight; 
    group.add(top);

    // Roof
    const roof = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.05, 8), material);
    roof.position.y = baseHeight + 0.025;
    group.add(roof);

    // Rings
    if (tier >= 2) {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.01, 8, 16), new THREE.MeshBasicMaterial({ color: 0xffffff }));
        ring.rotateX(Math.PI / 2);
        ring.position.y = baseHeight * 0.3;
        group.add(ring);
    }
    if (tier >= 3) {
        const ring2 = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.01, 8, 16), new THREE.MeshBasicMaterial({ color: 0xffffff }));
        ring2.rotateX(Math.PI / 2);
        ring2.position.y = baseHeight * 0.6;
        group.add(ring2);
    }
    return { group, material };
}

function buildWorld(data) {
    // 1. Globe
    const positions = []; const colors = []; const colorHelper = new THREE.Color();
    data.faces.forEach((face, faceIndex) => {
        const v1 = data.vertices[face[0]]; const v2 = data.vertices[face[1]]; const v3 = data.vertices[face[2]];
        positions.push(...v1, ...v2, ...v3);
        const hexColor = data.face_colors[faceIndex] !== undefined ? data.face_colors[faceIndex] : COLORS.globeBase;
        colorHelper.setHex(hexColor);
        colors.push(colorHelper.r, colorHelper.g, colorHelper.b);
        colors.push(colorHelper.r, colorHelper.g, colorHelper.b);
        colors.push(colorHelper.r, colorHelper.g, colorHelper.b);
    });

    const globeGeo = new THREE.BufferGeometry();
    globeGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    globeGeo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    globeGeo.computeVertexNormals();
    const globeMat = new THREE.MeshPhongMaterial({
        vertexColors: true, shininess: 15, flatShading: true, 
        side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1
    });
    globeMesh = new THREE.Mesh(globeGeo, globeMat);
    scene.add(globeMesh);

    // 2. Fortresses
    data.vertices.forEach((v, index) => {
        const fortressData = data.fortresses[index.toString()];
        const currentTier = fortressData.tier || 1;
        const { group, material } = createFortressMesh(COLORS.neutral, currentTier);
        group.position.set(v[0], v[1], v[2]);
        group.lookAt(0, 0, 0);
        group.rotateX(Math.PI / 2);
        group.userData = { id: index.toString(), type: 'fortress' };
        group.children.forEach(c => c.userData = { id: index.toString(), type: 'fortress' });
        scene.add(group);
        fortressMeshes[index.toString()] = { mesh: group, material: material, tier: currentTier };
    });

    // 3. Roads
    const lineMaterial = new THREE.LineBasicMaterial({ color: COLORS.connection, transparent: true, opacity: 0.2 });
    data.roads.forEach(road => {
        const v1 = new THREE.Vector3(...data.vertices[road[0]]);
        const v2 = new THREE.Vector3(...data.vertices[road[1]]);
        const points = [v1, v2];
        const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), lineMaterial);
        scene.add(line);
        connectionLines.push(line);
    });
    
    updateVisuals(data.fortresses);
}

socket.on('update_map', (fortresses) => {
    if (!gameState) return;
    gameState.fortresses = fortresses;
    updateVisuals(fortresses);
    if (selectedSourceId) {
        const idToShow = selectedTargetId ? selectedTargetId : selectedSourceId;
        showUI(idToShow);
    }
});

socket.on('update_face_colors', (faceColors) => {
    if (!globeMesh || !gameState) return;
    gameState.face_colors = faceColors;
    const colors = globeMesh.geometry.attributes.color.array;
    const colorHelper = new THREE.Color();
    for (let i = 0; i < faceColors.length; i++) {
        const hex = faceColors[i];
        colorHelper.setHex(hex);
        const startIdx = i * 9;
        for (let j = 0; j < 9; j += 3) {
            colors[startIdx + j] = colorHelper.r;
            colors[startIdx + j + 1] = colorHelper.g;
            colors[startIdx + j + 2] = colorHelper.b;
        }
    }
    globeMesh.geometry.attributes.color.needsUpdate = true;
});

function updateVisuals(fortresses) {
    // 1. Update Fortresses
    for (const [id, data] of Object.entries(fortresses)) {
        let obj = fortressMeshes[id];
        if (!obj) continue;
        
        if (data.tier !== obj.tier) {
            scene.remove(obj.mesh);
            const { group, material } = createFortressMesh(COLORS.neutral, data.tier);
            const v = gameState.vertices[parseInt(id)];
            group.position.set(v[0], v[1], v[2]);
            group.lookAt(0, 0, 0);
            group.rotateX(Math.PI / 2);
            group.userData = { id: id, type: 'fortress' };
            group.children.forEach(c => c.userData = { id: id, type: 'fortress' });
            scene.add(group);
            fortressMeshes[id] = { mesh: group, material: material, tier: data.tier };
            obj = fortressMeshes[id];
        }
        
        const { mesh, material } = obj;
        if (data.owner) {
            const raceInfo = gameState.races[data.race];
            material.color.setHex(raceInfo ? raceInfo.color : COLORS.neutral);
        } else {
            material.color.setHex(COLORS.neutral);
        }
        if (data.special_active) material.emissive.setHex(0x333333);
        else material.emissive.setHex(0x000000);
    }

    // 2. Rebuild Particle Flow System
    // Clear old particles (simple brute force reset for now, optimizations possible)
    flowParticles.forEach(p => scene.remove(p.mesh));
    flowParticles = [];

    // Create new particles for active paths
    // To avoid creating thousands of objects every frame, we normally would use a point cloud.
    // For now, we will just create a few "dots" per active path and reuse them or simple recreation.
    // Actually, let's just maintain a list of active curves and spawn particles in the animate loop.
    
    // Instead of rebuilding curves every update, let's identify active paths
    for (const [id, data] of Object.entries(fortresses)) {
        if (data.paths && data.paths.length > 0) {
            const v1 = new THREE.Vector3(...gameState.vertices[parseInt(id)]);
            
            data.paths.forEach(targetId => {
                const v2 = new THREE.Vector3(...gameState.vertices[parseInt(targetId)]);
                
                // Create Curve
                const mid = new THREE.Vector3().addVectors(v1, v2).multiplyScalar(0.5).multiplyScalar(1.05);
                const curve = new THREE.QuadraticBezierCurve3(v1, mid, v2);
                
                // Spawn a few particles on this curve
                const particleCount = 5; 
                for(let i=0; i<particleCount; i++) {
                    const geo = new THREE.SphereGeometry(0.015, 4, 4);
                    const mat = new THREE.MeshBasicMaterial({ color: COLORS.pathFlow });
                    const mesh = new THREE.Mesh(geo, mat);
                    
                    // Stagger start positions
                    const startProgress = (i / particleCount);
                    
                    scene.add(mesh);
                    flowParticles.push({
                        mesh: mesh,
                        curve: curve,
                        progress: startProgress,
                        speed: 0.5 // Speed matches flow rate roughly
                    });
                }
            });
        }
    }
}

const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

function onMouseMove(event) {
    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
}

function onMouseClick(event) {
    if (event.target.closest('#game-ui') || event.target.closest('.navbar')) return;

    raycaster.setFromCamera(mouse, camera);
    const allMeshes = [];
    Object.values(fortressMeshes).forEach(o => allMeshes.push(o.mesh));
    const intersects = raycaster.intersectObjects(allMeshes, true);

    if (intersects.length > 0) {
        let target = intersects[0].object;
        while (!target.userData.id && target.parent) target = target.parent;
        const targetId = target.userData.id;
        if (targetId) handleNodeSelection(targetId);
    } else {
        selectedSourceId = null;
        selectedTargetId = null;
        uiDiv.style.display = 'none';
        resetHighlights();
        statusMsg.textContent = "";
    }
}

function handleNodeSelection(id) {
    const fortress = gameState.fortresses[id];
    
    if (selectedSourceId === null || (fortress.owner === playerUsername && id !== selectedSourceId && selectedTargetId === null)) {
        if (fortress.owner === playerUsername) {
            selectedSourceId = id;
            selectedTargetId = null;
            showUI(id);
            resetHighlights();
            highlightNode(id, COLORS.highlight);
            statusMsg.textContent = "Source Selected.";
        } else {
            selectedSourceId = null;
            selectedTargetId = null;
            showUI(id);
            statusMsg.textContent = "Enemy/Neutral Fortress";
        }
    } 
    else if (selectedSourceId !== null) {
        if (id === selectedSourceId) {
            selectedSourceId = null;
            selectedTargetId = null;
            uiDiv.style.display = 'none';
            statusMsg.textContent = "";
            resetHighlights();
            return;
        }
        
        const neighbors = gameState.adj[selectedSourceId]; 
        const targetIdInt = parseInt(id);
        
        if (neighbors && neighbors.includes(targetIdInt)) {
            selectedTargetId = id;
            resetHighlights();
            highlightNode(selectedSourceId, COLORS.highlight);
            highlightNode(id, COLORS.validTarget);
            showUI(id);
            statusMsg.textContent = "Target Selected.";
        } else {
            statusMsg.textContent = "Not connected directly!";
        }
    }
}

function showUI(id) {
    const f = gameState.fortresses[id];
    uiDiv.style.display = 'block';
    
    let titleText = f.is_capital ? `Capital (${id})` : `Fortress ${id}`;
    titleText += ` [Tier ${f.tier || 1}]`;
    uiTitle.textContent = titleText;
    
    if (selectedSourceId && selectedTargetId && id === selectedTargetId) {
        uiTitle.textContent = `Target: Fortress ${id}`;
    }

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

    if (selectedSourceId && selectedTargetId && id === selectedTargetId) {
        document.getElementById('slider-container').style.display = 'none';
        uiActionArea.style.display = 'block';
        
        const sourceFort = gameState.fortresses[selectedSourceId];
        const isLinked = sourceFort.paths && sourceFort.paths.includes(selectedTargetId);
        
        btnAction.style.display = 'block';
        btnAction.disabled = false;
        
        if (isLinked) {
            btnAction.textContent = "STOP ATTACK/FLOW";
            btnAction.style.backgroundColor = "#ff9900";
        } else {
            const currentPaths = sourceFort.paths ? sourceFort.paths.length : 0;
            const maxPaths = sourceFort.tier || 1;
            
            if (currentPaths >= maxPaths) {
                btnAction.textContent = `MAX PATHS (${currentPaths}/${maxPaths})`;
                btnAction.disabled = true;
                btnAction.style.backgroundColor = "#555";
            } else {
                btnAction.textContent = "BEGIN ATTACK (Link)";
                btnAction.style.backgroundColor = "#cc0000";
            }
        }
        
        btnAction.onclick = () => {
            socket.emit('submit_move', {
                source: selectedSourceId,
                target: selectedTargetId
            });
        };
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
    for (const [id, data] of Object.entries(gameState.fortresses)) {
        const obj = fortressMeshes[id];
        if (!obj) continue;
        if (data.special_active) obj.material.emissive.setHex(0x333333);
        else obj.material.emissive.setHex(0x000000);
    }
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

function startAnimation() {
    const clock = new THREE.Clock();
    
    function animate() {
        requestAnimationFrame(animate);
        const dt = clock.getDelta();
        
        controls.update();
        
        // Update Particles
        flowParticles.forEach(p => {
            p.progress += p.speed * dt;
            if (p.progress > 1) p.progress -= 1; // Loop
            
            const pos = p.curve.getPoint(p.progress);
            p.mesh.position.copy(pos);
        });
        
        renderer.render(scene, camera);
    }
    animate();
}

init();