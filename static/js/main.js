// static/js/main.js

// --- Configuration ---
const COLORS = {
    background: 0x050510,
    globeBase: 0x151525,     
    globeEmissive: 0x000000,
    neutral: 0x888888,
    highlight: 0xffff00,      // Selection Ring
    connection: 0x333344,     // Default Line
    connectionValid: 0x00ff00,// Green for valid move
    connectionActive: 0xff4400, // Red/Orange for attack/flow
    pathFlow: 0xffaa00
};

// --- Global State ---
let scene, camera, renderer, controls;
let gameState = null;

// Storage
let fortressMeshes = {}; 
let lineMap = {}; 
let activeArrows = []; 
let sectorIcons = {}; 

let globeMesh = null;    

// Interaction State
let selectedSourceId = null;
let selectedTargetId = null;

// Dragging State
let isDragging = false;
let dragSourceId = null;
let dragArrowGroup = null; // Container for Shaft + Head

const playerUsername = document.getElementById('username') ? document.getElementById('username').textContent.trim() : "Player";
const socket = io();

// UI Elements
const uiDiv = document.getElementById('game-ui');
const uiTitle = document.getElementById('ui-title');
const uiLand = document.getElementById('ui-land');
const uiType = document.getElementById('ui-type');
const uiOwner = document.getElementById('ui-owner');
const uiUnits = document.getElementById('ui-units');
const uiTier = document.getElementById('ui-tier');
const uiSpecial = document.getElementById('ui-special');
const uiActionArea = document.getElementById('action-area');
const btnAction = document.getElementById('btn-action');
const statusMsg = document.getElementById('status-msg');

// --- Initialization ---

function init() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(COLORS.background);
    
    camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.z = 4.0;

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    document.getElementById('canvas-container').appendChild(renderer.domElement);

    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.minDistance = 2.5;
    controls.maxDistance = 12;

    scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.7);
    dirLight.position.set(10, 10, 10);
    scene.add(dirLight);

    const btnRestart = document.getElementById('btn-restart');
    if (btnRestart) {
        btnRestart.onclick = () => {
            if(confirm("Are you sure you want to restart the game world?")) {
                socket.emit('restart_game');
            }
        };
    }

    // --- Initialize Drag Arrow Visuals ---
    dragArrowGroup = new THREE.Group();
    
    // 1. Shaft (Cylinder)
    // Default cylinder is height 1, centered at 0. We will scale/position it manually.
    const shaftGeo = new THREE.CylinderGeometry(0.02, 0.02, 1, 8);
    shaftGeo.rotateX(-Math.PI / 2); // Point along Z axis
    // Translate geometry so Z=0 is the start, Z=1 is the end (simplifies scaling)
    shaftGeo.translate(0, 0, 0.5); 
    const shaftMat = new THREE.MeshBasicMaterial({ color: 0x00ff00 });
    const shaftMesh = new THREE.Mesh(shaftGeo, shaftMat);
    shaftMesh.name = "shaft";
    dragArrowGroup.add(shaftMesh);

    // 2. Head (Cone)
    const headGeo = new THREE.ConeGeometry(0.06, 0.15, 8);
    headGeo.rotateX(Math.PI / 2); // Point along Z axis
    const headMat = new THREE.MeshBasicMaterial({ color: 0x00ff00 });
    const headMesh = new THREE.Mesh(headGeo, headMat);
    headMesh.name = "head";
    dragArrowGroup.add(headMesh);

    dragArrowGroup.visible = false;
    scene.add(dragArrowGroup);

    fetch('/api/gamestate')
        .then(res => res.json())
        .then(data => {
            gameState = data;
            buildWorld(data);
            startAnimation();
        });

    window.addEventListener('resize', onWindowResize);
    
    // Interaction Listeners
    window.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
}

// --- Visual Helpers ---

function createLabelTexture(units, tier) {
    const size = 128; 
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');

    // Unit Count
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 50px Arial"; 
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.shadowColor = "rgba(0,0,0,1.0)";
    ctx.shadowBlur = 4;
    ctx.fillText(Math.floor(units).toString(), size/2, size/2 - 10);

    // Tier Circles
    const radius = 6;
    const gap = 18;
    const startX = (size/2) - gap;
    const y = (size/2) + 30;

    ctx.lineWidth = 2;
    ctx.strokeStyle = "#000000"; 
    ctx.shadowBlur = 0; 

    for (let i = 0; i < 3; i++) {
        const cx = startX + (i * gap);
        ctx.beginPath();
        ctx.arc(cx, y, radius, 0, 2 * Math.PI);
        ctx.stroke();
        
        if (i < tier) {
            ctx.fillStyle = "#ffffff";
            ctx.fill();
        } else {
            ctx.fillStyle = "rgba(0,0,0,0.5)"; 
            ctx.fill();
        }
    }

    const tex = new THREE.CanvasTexture(canvas);
    return tex;
}

function createFortressMesh(data) {
    const group = new THREE.Group();
    
    // Determine Color (Team Color Top-to-Bottom)
    let baseColor = COLORS.neutral;
    if (data.owner) {
        const raceInfo = gameState.races[data.race];
        if (raceInfo) baseColor = raceInfo.color;
    }
    
    // Single Material for entire structure
    const mat = new THREE.MeshPhongMaterial({ color: baseColor, flatShading: true });
    
    // --- REDUCED HEIGHTS ---
    // 1. Base Cylinder
    const baseGeo = new THREE.CylinderGeometry(0.05, 0.06, 0.06, 6); // Short base
    const baseMesh = new THREE.Mesh(baseGeo, mat);
    baseMesh.position.y = 0.03; // Centered vertically relative to size
    baseMesh.rotation.y = Math.random() * Math.PI;
    group.add(baseMesh);

    // 2. Roof Cone
    const roofGeo = new THREE.ConeGeometry(0.07, 0.06, 6); // Short roof
    const roofMesh = new THREE.Mesh(roofGeo, mat);
    roofMesh.position.y = 0.09; // Sit on top of 0.06 height base
    roofMesh.rotation.y = baseMesh.rotation.y; 
    group.add(roofMesh);

    // 3. Icon Sprite
    let iconName = "keep.png"; 
    if (gameState.fortress_types && gameState.fortress_types[data.type]) {
        iconName = gameState.fortress_types[data.type].icon || "keep.png";
    }
    const iconMap = new THREE.TextureLoader().load('/static/icons/' + iconName);
    const iconMat = new THREE.SpriteMaterial({ map: iconMap, color: 0xffffff });
    const iconSprite = new THREE.Sprite(iconMat);
    // Position: Lowered significantly
    iconSprite.scale.set(0.12, 0.12, 1); 
    iconSprite.position.y = 0.18; 
    group.add(iconSprite);

    // 4. Info Label
    const labelTex = createLabelTexture(data.units, data.tier);
    const labelMat = new THREE.SpriteMaterial({ map: labelTex });
    const labelSprite = new THREE.Sprite(labelMat);
    labelSprite.scale.set(0.15, 0.15, 1);
    labelSprite.position.y = 0.18; 
    labelSprite.position.z = 0.02; 
    group.add(labelSprite);

    return { group, baseMesh, roofMesh, iconSprite, labelSprite };
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
        vertexColors: true, shininess: 10, flatShading: true, 
        side: THREE.DoubleSide
    });
    globeMesh = new THREE.Mesh(globeGeo, globeMat);
    scene.add(globeMesh);

    // 2. Fortresses
    data.vertices.forEach((v, index) => {
        const fortressData = data.fortresses[index.toString()];
        if (!fortressData || fortressData.disabled) return;

        const { group, baseMesh, roofMesh, iconSprite, labelSprite } = createFortressMesh(fortressData);
        group.position.set(v[0], v[1], v[2]);
        
        const up = new THREE.Vector3(v[0], v[1], v[2]).normalize();
        group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), up);

        // Metadata for Raycaster
        group.userData = { id: index.toString(), type: 'fortress' };
        group.children.forEach(c => c.userData = { id: index.toString(), type: 'fortress' });
        
        scene.add(group);
        fortressMeshes[index.toString()] = { mesh: group, baseMesh, roofMesh, iconSprite, labelSprite };
    });

    // 3. Roads (Lines)
    const lineMat = new THREE.LineBasicMaterial({ color: COLORS.connection, linewidth: 1 });
    lineMap = {};
    
    data.roads.forEach(road => {
        const u = road[0];
        const v = road[1];
        const p1 = new THREE.Vector3(...data.vertices[u]);
        const p2 = new THREE.Vector3(...data.vertices[v]);
        
        p1.multiplyScalar(1.02);
        p2.multiplyScalar(1.02);

        const geo = new THREE.BufferGeometry().setFromPoints([p1, p2]);
        const line = new THREE.Line(geo, lineMat.clone());
        scene.add(line);
        
        const key = u < v ? `${u}_${v}` : `${v}_${u}`;
        lineMap[key] = line;
    });
    
    updateVisuals(data.fortresses);
    updateSectorVisuals();
}

function updateSectorVisuals() {
    if (!gameState.sector_owners) return;
    const dominanceTex = new THREE.TextureLoader().load('/static/icons/star_shield.png'); 

    for (let faceIdx = 0; faceIdx < gameState.faces.length; faceIdx++) {
        const owner = gameState.sector_owners[faceIdx.toString()];
        
        if (sectorIcons[faceIdx]) {
            if (!owner) {
                scene.remove(sectorIcons[faceIdx]);
                delete sectorIcons[faceIdx];
            }
        } else if (owner) {
            const mat = new THREE.SpriteMaterial({ map: dominanceTex, color: 0xffff00 });
            const sprite = new THREE.Sprite(mat);
            
            const face = gameState.faces[faceIdx];
            const v1 = new THREE.Vector3(...gameState.vertices[face[0]]);
            const v2 = new THREE.Vector3(...gameState.vertices[face[1]]);
            const v3 = new THREE.Vector3(...gameState.vertices[face[2]]);
            
            const center = new THREE.Vector3().addVectors(v1, v2).add(v3).divideScalar(3);
            center.multiplyScalar(1.03); 
            
            sprite.position.copy(center);
            sprite.scale.set(0.1, 0.1, 1); 
            scene.add(sprite);
            sectorIcons[faceIdx] = sprite;
        }
    }
}

function updatePathVisuals() {
    Object.values(lineMap).forEach(line => {
        line.material.color.setHex(COLORS.connection);
        line.material.opacity = 0.3;
        line.material.transparent = true;
    });

    activeArrows.forEach(arrow => scene.remove(arrow));
    activeArrows = [];

    // Highlight Valid Neighbors of Selected
    if (selectedSourceId) {
        const neighbors = gameState.adj[selectedSourceId] || [];
        neighbors.forEach(nId => {
            const u = parseInt(selectedSourceId);
            const v = parseInt(nId);
            const key = u < v ? `${u}_${v}` : `${v}_${u}`;
            const line = lineMap[key];
            const targetFort = gameState.fortresses[nId];
            
            if (line && targetFort && !targetFort.disabled) {
                line.material.color.setHex(COLORS.connectionValid);
                line.material.opacity = 0.8;
            }
        });
    }

    const coneGeo = new THREE.ConeGeometry(0.02, 0.08, 8); 
    
    for (const [id, fort] of Object.entries(gameState.fortresses)) {
        if (!fort.paths || fort.paths.length === 0) continue;
        if (fort.disabled) continue;

        const p1 = fortressMeshes[id].mesh.position;

        fort.paths.forEach(targetId => {
            if (!gameState.fortresses[targetId]) return;
            const p2 = fortressMeshes[targetId].mesh.position;
            
            // Highlight Line
            const u = parseInt(id);
            const v = parseInt(targetId);
            const key = u < v ? `${u}_${v}` : `${v}_${u}`;
            const line = lineMap[key];
            if (line) {
                line.material.color.setHex(COLORS.connectionActive);
                line.material.opacity = 1.0;
            }

            // Draw Arrow
            const dir = new THREE.Vector3().subVectors(p2, p1).normalize();
            const dist = p1.distanceTo(p2);
            const arrowPos = p1.clone().add(dir.clone().multiplyScalar(dist * 0.35));
            
            const arrowMat = new THREE.MeshBasicMaterial({ color: COLORS.connectionActive });
            const arrowMesh = new THREE.Mesh(coneGeo, arrowMat);
            
            arrowMesh.position.copy(arrowPos);
            arrowMesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
            
            scene.add(arrowMesh);
            activeArrows.push(arrowMesh);
        });
    }
}

function updateVisuals(fortresses) {
    for (const [id, data] of Object.entries(fortresses)) {
        if (data.disabled) continue;
        let obj = fortressMeshes[id];
        if (!obj) continue;

        // Texture Update
        const currentUnits = Math.floor(data.units);
        if (obj.lastUnits !== currentUnits || obj.lastTier !== data.tier) {
            const newTex = createLabelTexture(data.units, data.tier);
            obj.labelSprite.material.map = newTex;
            obj.labelSprite.material.needsUpdate = true;
            obj.lastUnits = currentUnits;
            obj.lastTier = data.tier;
        }

        // Color Update for 3D Mesh
        if (data.owner) {
            const raceInfo = gameState.races[data.race];
            const c = raceInfo ? raceInfo.color : COLORS.neutral;
            obj.baseMesh.material.color.setHex(c);
            obj.roofMesh.material.color.setHex(c);
        } else {
            obj.baseMesh.material.color.setHex(COLORS.neutral);
            obj.roofMesh.material.color.setHex(COLORS.neutral);
        }
    }
    updatePathVisuals();
    updateSectorVisuals();
}

socket.on('update_map', (fortresses) => {
    if (!gameState) return;
    gameState.fortresses = fortresses;
    updateVisuals(fortresses);
    
    if (selectedSourceId && !selectedTargetId) updateHUD(selectedSourceId);
    else if (selectedTargetId) updateHUD(selectedTargetId);
});

socket.on('update_face_colors', (faceColors) => {
    if (!globeMesh || !gameState) return;
    gameState.face_colors = faceColors;
    const colors = globeMesh.geometry.attributes.color.array;
    const colorHelper = new THREE.Color();
    for (let i = 0; i < faceColors.length; i++) {
        colorHelper.setHex(faceColors[i]);
        const startIdx = i * 9;
        for (let j = 0; j < 9; j += 3) {
            colors[startIdx + j] = colorHelper.r;
            colors[startIdx + j + 1] = colorHelper.g;
            colors[startIdx + j + 2] = colorHelper.b;
        }
    }
    globeMesh.geometry.attributes.color.needsUpdate = true;
    updateSectorVisuals();
});

const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

// --- Mouse Interaction Handlers ---

function onMouseDown(event) {
    if (event.target.closest('#game-ui') || event.target.closest('.navbar')) return;
    
    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
    
    raycaster.setFromCamera(mouse, camera);
    const allMeshes = [];
    Object.values(fortressMeshes).forEach(o => allMeshes.push(o.mesh));
    const intersects = raycaster.intersectObjects(allMeshes, true);

    if (intersects.length > 0) {
        let target = intersects[0].object;
        while (target.parent && !target.userData.id) target = target.parent;
        const targetId = target.userData.id;
        
        const fort = gameState.fortresses[targetId];
        
        // Start Dragging if we own it
        if (fort && fort.owner === playerUsername && !fort.disabled) {
            isDragging = true;
            dragSourceId = targetId;
            controls.enabled = false; // LOCK CAMERA
            
            handleNodeSelection(targetId);
            
            // Show Drag Arrow
            const raceInfo = gameState.races[fort.race];
            const c = raceInfo ? raceInfo.color : 0x00ff00;
            
            dragArrowGroup.children.forEach(cMesh => {
                cMesh.material.color.setHex(c); // User Color
            });
            
            // Initial Position
            const startPos = fortressMeshes[targetId].mesh.position;
            dragArrowGroup.position.copy(startPos);
            dragArrowGroup.lookAt(startPos.clone().multiplyScalar(1.1)); // Just point out initially
            dragArrowGroup.visible = true;
        }
    }
}

function onMouseMove(event) {
    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

    // Handle Dragging Beam Visual
    if (isDragging && dragSourceId) {
        raycaster.setFromCamera(mouse, camera);
        
        // 1. Raycast against Globe to get mouse surface position
        const intersectsGlobe = raycaster.intersectObject(globeMesh);
        
        // 2. Raycast against Towers to see if we hover a valid target
        const allMeshes = [];
        Object.values(fortressMeshes).forEach(o => allMeshes.push(o.mesh));
        const intersectsForts = raycaster.intersectObjects(allMeshes, true);
        
        let endPoint = null;
        let validSnap = false;

        if (intersectsForts.length > 0) {
            let target = intersectsForts[0].object;
            while (target.parent && !target.userData.id) target = target.parent;
            const targetId = target.userData.id;
            
            const neighbors = gameState.adj[dragSourceId] || [];
            
            // If hovering a neighbor (not self)
            if (neighbors.includes(parseInt(targetId)) && targetId !== dragSourceId) {
                // SNAP TO TARGET
                endPoint = fortressMeshes[targetId].mesh.position.clone();
                validSnap = true;
            }
        }

        // If no snap target, use globe surface
        if (!endPoint && intersectsGlobe.length > 0) {
            endPoint = intersectsGlobe[0].point.clone().multiplyScalar(1.05); // Float slightly above surface
        }

        if (endPoint) {
            const startPoint = fortressMeshes[dragSourceId].mesh.position;
            const dist = startPoint.distanceTo(endPoint);
            
            // Position Arrow Group at Start Point
            dragArrowGroup.position.copy(startPoint);
            
            // Look At End Point
            dragArrowGroup.lookAt(endPoint);
            
            // Shaft Scaling: The shaft is defined from Z=0 to Z=1.
            // We want it to stretch from Start to (End - HeadLength).
            const headLength = 0.15;
            const shaftLen = Math.max(0.01, dist - headLength);
            
            const shaft = dragArrowGroup.getObjectByName('shaft');
            if (shaft) {
                shaft.scale.set(1, 1, shaftLen); // Scale Z to length
            }
            
            const head = dragArrowGroup.getObjectByName('head');
            if (head) {
                // Move head to end of shaft
                head.position.set(0, 0, shaftLen);
            }

            // Visual Feedback for Validity
            const color = validSnap ? 0x00ff00 : (COLORS.highlight); // Green if valid, Yellow if dragging
            dragArrowGroup.children.forEach(m => m.material.color.setHex(color));
        }
    } else {
        // Standard Hover Logic
        if (gameState) {
            raycaster.setFromCamera(mouse, camera);
            const allMeshes = [];
            Object.values(fortressMeshes).forEach(o => allMeshes.push(o.mesh));
            const intersects = raycaster.intersectObjects(allMeshes, true);
            
            if (intersects.length > 0) {
                let target = intersects[0].object;
                while (target.parent && !target.userData.id) target = target.parent;
                const targetId = target.userData.id;
                if (targetId) {
                    updateHUD(targetId);
                    document.body.style.cursor = 'pointer';
                }
            } else {
                document.body.style.cursor = 'default';
            }
        }
    }
}

function onMouseUp(event) {
    if (isDragging) {
        raycaster.setFromCamera(mouse, camera);
        const allMeshes = [];
        Object.values(fortressMeshes).forEach(o => allMeshes.push(o.mesh));
        const intersects = raycaster.intersectObjects(allMeshes, true);
        
        if (intersects.length > 0) {
            let target = intersects[0].object;
            while (target.parent && !target.userData.id) target = target.parent;
            const targetId = target.userData.id;
            
            const neighbors = gameState.adj[dragSourceId] || [];
            
            if (targetId !== dragSourceId && neighbors.includes(parseInt(targetId))) {
                // Valid Drop -> Send Move
                selectedTargetId = targetId;
                socket.emit('submit_move', {
                    source: dragSourceId,
                    target: targetId
                });
                if(statusMsg) statusMsg.textContent = "Orders Sent.";
                handleNodeSelection(targetId);
            }
        }
        
        // Reset
        isDragging = false;
        dragSourceId = null;
        dragArrowGroup.visible = false;
        controls.enabled = true; // UNLOCK CAMERA
        updatePathVisuals();
    }
}

// ... Rest of the file (HandleNodeSelection, updateHUD, animate) remains effectively same ...
function handleNodeSelection(id) {
    const fortress = gameState.fortresses[id];
    
    if (selectedSourceId === null) {
        if (fortress.owner === playerUsername) {
            selectedSourceId = id;
            if(statusMsg) statusMsg.textContent = "Drag to connected fortress to attack/move.";
        } else {
            if(statusMsg) statusMsg.textContent = "Observing Enemy Position.";
        }
        updateHUD(id);
    } 
    else {
        if (id === selectedSourceId) {
            if (!isDragging) {
                selectedSourceId = null;
                selectedTargetId = null;
                if(statusMsg) statusMsg.textContent = "Selection Cleared.";
                if(uiDiv) uiDiv.style.display = 'none';
            }
        } else if (fortress.owner === playerUsername && !selectedTargetId) {
            selectedSourceId = id;
            if(statusMsg) statusMsg.textContent = "New Source Selected.";
            updateHUD(id);
        } else {
            const neighbors = gameState.adj[selectedSourceId] || [];
            if (neighbors.includes(parseInt(id))) {
                selectedTargetId = id;
                updateHUD(id);
            }
        }
    }
    updatePathVisuals();
}

function updateHUD(id) {
    const f = gameState.fortresses[id];
    if (!f || !uiDiv) return;

    uiDiv.style.display = 'block';
    
    if(uiTitle) uiTitle.textContent = f.is_capital ? `Capital (${id})` : `Fortress ${id}`;
    if(uiType) uiType.textContent = f.type || "Unknown"; 
    if(uiLand) uiLand.textContent = "Surface"; 
    
    if(uiOwner) {
        uiOwner.textContent = f.owner || "Neutral";
        uiOwner.style.color = f.owner ? '#fff' : '#aaa';
    }
    
    if(uiUnits) uiUnits.textContent = Math.floor(f.units);
    if(uiTier) uiTier.textContent = f.tier;
    
    if(uiSpecial) {
        if (f.owner && gameState.races[f.race]) {
            uiSpecial.textContent = f.special_active ? "Active" : "Locked";
            uiSpecial.style.color = f.special_active ? "#0f0" : "#aaa";
        } else {
            uiSpecial.textContent = "None";
        }
    }

    if (selectedSourceId && selectedTargetId && id === selectedTargetId) {
        if(uiActionArea) uiActionArea.style.display = 'block';
        
        const sourceFort = gameState.fortresses[selectedSourceId];
        const isLinked = sourceFort.paths && sourceFort.paths.includes(selectedTargetId);
        
        if (btnAction) {
            btnAction.disabled = false;
            if (isLinked) {
                btnAction.textContent = "HALT ADVANCE";
                btnAction.style.backgroundColor = "#ff9900";
            } else {
                const currentPaths = sourceFort.paths ? sourceFort.paths.length : 0;
                const maxPaths = sourceFort.tier || 1;
                
                if (currentPaths >= maxPaths) {
                    btnAction.textContent = `MAX PATHS (${currentPaths}/${maxPaths})`;
                    btnAction.disabled = true;
                    btnAction.style.backgroundColor = "#555";
                } else {
                    btnAction.textContent = "ESTABLISH SUPPLY LINE";
                    btnAction.style.backgroundColor = "#00cc00";
                }
            }
            btnAction.onclick = () => {
                socket.emit('submit_move', {
                    source: selectedSourceId,
                    target: selectedTargetId
                });
            };
        }
    } else {
        if(uiActionArea) uiActionArea.style.display = 'none';
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
        controls.update();
        renderer.render(scene, camera);
    }
    animate();
}

init();