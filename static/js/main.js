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
    pathFlow: 0xffaa00,     // Gold/Orange for flow particles
    dragArrow: 0xffff00     // Color of the arrow while dragging
};

// --- Global State ---
let scene, camera, renderer, controls;
let gameState = null;
let fortressMeshes = {}; 
let connectionLines = [];
let globeMesh = null;    

// Drag & Interaction State
let dragSourceId = null;
let dragArrowMesh = null;
let isDragging = false;
let mouseDownPos = new THREE.Vector2();

// Particle System State
let flowParticles = []; 

const playerUsername = document.getElementById('username').textContent;
const socket = io();

// UI Elements
const uiDiv = document.getElementById('game-ui');
const uiTitle = document.getElementById('ui-title');
const uiOwner = document.getElementById('ui-owner');
const uiUnits = document.getElementById('ui-units');
const uiSpecial = document.getElementById('ui-special');
const uiActionArea = document.getElementById('action-area');
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
    controls.enablePan = false; // Disable panning to keep globe centered

    scene.add(new THREE.AmbientLight(0xffffff, 0.4));
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight.position.set(10, 10, 10);
    scene.add(dirLight);
    const backLight = new THREE.DirectionalLight(0x4444ff, 0.3);
    backLight.position.set(-10, -5, -10);
    scene.add(backLight);
    
    // Create Drag Arrow (Hidden initially)
    const arrowGeo = new THREE.ConeGeometry(0.05, 0.2, 8);
    arrowGeo.rotateX(Math.PI / 2); 
    const arrowMat = new THREE.MeshBasicMaterial({ color: COLORS.dragArrow });
    dragArrowMesh = new THREE.Mesh(arrowGeo, arrowMat);
    dragArrowMesh.visible = false;
    scene.add(dragArrowMesh);

    fetch('/api/gamestate')
        .then(res => res.json())
        .then(data => {
            gameState = data;
            buildWorld(data);
            focusHome(); // SNAP CAMERA TO HOME
            startAnimation();
        });

    window.addEventListener('resize', onWindowResize);
    
    // Use Pointer Events for better priority handling
    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
}

function focusHome() {
    if (!gameState || !playerUsername) return;
    
    // Find player's capital
    const myCapitalId = Object.keys(gameState.fortresses).find(k => 
        gameState.fortresses[k].owner === playerUsername && gameState.fortresses[k].is_capital
    );

    if (myCapitalId) {
        const v = gameState.vertices[parseInt(myCapitalId)];
        if (v) {
            // Position camera directly in front of the capital
            const camDist = 3.5;
            camera.position.set(v[0] * camDist, v[1] * camDist, v[2] * camDist);
            camera.lookAt(0, 0, 0);
            controls.update();
            statusMsg.textContent = "Welcome back, Commander.";
        }
    }
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

    // Hitbox (Invisible, larger sphere for easier clicking)
    const hitboxGeo = new THREE.SphereGeometry(0.18, 8, 8); // Slightly larger for easier grab
    const hitboxMat = new THREE.MeshBasicMaterial({ visible: false });
    const hitbox = new THREE.Mesh(hitboxGeo, hitboxMat);
    hitbox.position.y = baseHeight / 2;
    group.add(hitbox);

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
        group.traverse((obj) => {
            obj.userData = { id: index.toString(), type: 'fortress' };
        });
        scene.add(group);
        fortressMeshes[index.toString()] = { mesh: group, material: material, tier: currentTier };
    });

    // 3. Roads
    const lineMaterial = new THREE.LineBasicMaterial({ 
        color: COLORS.connection, 
        transparent: true, 
        opacity: 0.5 
    });
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
    
    // If stats UI is open, update numbers
    if (uiDiv.style.display !== 'none') {
        const currentTitle = uiTitle.textContent;
        // Parse ID from "Fortress 5 [Tier 1]" or "Capital (0) [Tier 1]"
        const match = currentTitle.match(/\((\d+)\)|Fortress (\d+)/);
        const id = match ? (match[1] || match[2]) : null;
        
        if (id && gameState.fortresses[id]) {
            const f = gameState.fortresses[id];
            uiUnits.textContent = Math.floor(f.units);
            uiOwner.textContent = f.owner || "Neutral";
            uiOwner.style.color = f.owner ? '#fff' : '#aaa';
        }
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
            group.traverse((o) => { o.userData = { id: id, type: 'fortress' }; });
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
    flowParticles.forEach(p => scene.remove(p.mesh));
    flowParticles = [];

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
                    const startProgress = (i / particleCount);
                    
                    scene.add(mesh);
                    flowParticles.push({
                        mesh: mesh,
                        curve: curve,
                        progress: startProgress,
                        speed: 0.5 
                    });
                }
            });
        }
    }
}

// --- Interaction Logic (Drag & Drop) ---
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

function getIntersects(clientX, clientY, objectList) {
    mouse.x = (clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(clientY / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);
    return raycaster.intersectObjects(objectList, true);
}

function onPointerDown(event) {
    if (event.target.closest('#game-ui') || event.target.closest('.navbar')) return;

    const allMeshes = [];
    Object.values(fortressMeshes).forEach(o => allMeshes.push(o.mesh));
    const intersects = getIntersects(event.clientX, event.clientY, allMeshes);

    if (intersects.length > 0) {
        let target = intersects[0].object;
        while (!target.userData.id && target.parent) target = target.parent;
        const id = target.userData.id;
        
        if (id) {
            // CRITICAL: Disable rotation IMMEDIATELY if we hit a fortress
            controls.enableRotate = false;
            
            // Start Drag Logic
            mouseDownPos.set(event.clientX, event.clientY);
            isDragging = true;
            dragSourceId = id;
            
            // Show stats
            showUI(id);
            resetHighlights();
            highlightNode(id, COLORS.highlight);
            
            dragArrowMesh.visible = false; 
        }
    } else {
        // If we clicked background, ensure rotation is enabled
        controls.enableRotate = true;
    }
}

function onPointerMove(event) {
    if (!isDragging || !dragSourceId) return;

    // Show arrow if we've moved a bit
    const dist = Math.hypot(event.clientX - mouseDownPos.x, event.clientY - mouseDownPos.y);
    if (dist > 5) {
        dragArrowMesh.visible = true;
        
        // Raycast to find "ground" point on globe or another fortress
        const allForts = [];
        Object.values(fortressMeshes).forEach(o => allForts.push(o.mesh));
        const intersects = getIntersects(event.clientX, event.clientY, [globeMesh, ...allForts]);

        if (intersects.length > 0) {
            const point = intersects[0].point;
            const srcV = new THREE.Vector3(...gameState.vertices[parseInt(dragSourceId)]);
            
            // Position Arrow at cursor
            dragArrowMesh.position.copy(point);
            // Point Arrow away from Source (tail at source, tip at cursor logic approx)
            // Actually, let's look at the source so the cone base points to cursor? 
            // Cone points UP (Y). rotateX(PI/2) makes it point Z.
            // lookAt points Z axis at target.
            // So lookAt(srcV) makes the tip point TO the source.
            // We want tip at cursor. So we need to invert lookAt.
            // Simplified: Just look at source.
            dragArrowMesh.lookAt(srcV); 
            
            // Color Logic
            let hoverTargetId = null;
            let targetObj = intersects[0].object;
            while (targetObj && !targetObj.userData.id && targetObj.parent) targetObj = targetObj.parent;
            if (targetObj && targetObj.userData.id) hoverTargetId = targetObj.userData.id;

            if (hoverTargetId && hoverTargetId !== dragSourceId) {
                const neighbors = gameState.adj[dragSourceId];
                if (neighbors.includes(parseInt(hoverTargetId))) {
                    dragArrowMesh.material.color.setHex(COLORS.validTarget);
                } else {
                    dragArrowMesh.material.color.setHex(COLORS.invalidTarget);
                }
            } else {
                dragArrowMesh.material.color.setHex(COLORS.dragArrow);
            }
        }
    }
}

function onPointerUp(event) {
    // ALWAYS re-enable rotation on mouse up
    controls.enableRotate = true;

    if (!isDragging) return;
    
    // Unlock everything
    isDragging = false;
    dragArrowMesh.visible = false;
    
    // Check for drop target
    const allMeshes = [];
    Object.values(fortressMeshes).forEach(o => allMeshes.push(o.mesh));
    const intersects = getIntersects(event.clientX, event.clientY, allMeshes);
    
    if (intersects.length > 0) {
        let target = intersects[0].object;
        while (!target.userData.id && target.parent) target = target.parent;
        const targetId = target.userData.id;
        
        if (targetId && targetId !== dragSourceId) {
            const sourceFort = gameState.fortresses[dragSourceId];
            
            if (sourceFort.owner !== playerUsername) {
                statusMsg.textContent = "Not your fortress!";
                dragSourceId = null;
                return;
            }
            
            const neighbors = gameState.adj[dragSourceId];
            if (neighbors.includes(parseInt(targetId))) {
                socket.emit('submit_move', {
                    source: dragSourceId,
                    target: targetId
                });
                statusMsg.textContent = "Orders Sent.";
            } else {
                statusMsg.textContent = "Too far!";
            }
        }
    }
    
    dragSourceId = null;
}

function showUI(id) {
    const f = gameState.fortresses[id];
    uiDiv.style.display = 'block';
    uiActionArea.style.display = 'none'; 
    
    let titleText = f.is_capital ? `Capital (${id})` : `Fortress ${id}`;
    titleText += ` [Tier ${f.tier || 1}]`;
    uiTitle.textContent = titleText;

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