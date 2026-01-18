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
let lineMap = {}; // Maps "u_v" key to THREE.Line object
let activeArrows = []; // Stores arrow meshes
let sectorIcons = {}; // Maps faceIndex to sprite

let globeMesh = null;    
let selectedSourceId = null;
let selectedTargetId = null;

const playerUsername = document.getElementById('username').textContent.trim();
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

// --- Visual Helpers ---

function createLabelTexture(units, tier, ownerColor) {
    const size = 256;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');

    // Unit Count (Big Bold White)
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 90px Arial";
    ctx.textAlign = "center";
    ctx.shadowColor = "rgba(0,0,0,0.8)";
    ctx.shadowBlur = 6;
    ctx.fillText(Math.floor(units).toString(), size/2, size/2);

    // Tier Circles (Below units)
    const radius = 15;
    const gap = 45;
    const startX = (size/2) - gap;
    const y = (size/2) + 50;

    ctx.lineWidth = 4;
    ctx.strokeStyle = "#000000"; 
    ctx.shadowBlur = 0;

    for (let i = 0; i < 3; i++) {
        const cx = startX + (i * gap);
        ctx.beginPath();
        ctx.arc(cx, y, radius, 0, 2 * Math.PI);
        ctx.stroke();
        
        // Tier 1 = Left, Tier 2 = Middle, Tier 3 = Right
        // Logic: if tier is 2, circles 0 and 1 are lit.
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
    
    // 1. Icon Sprite (Building)
    let iconName = "keep.png"; 
    if (gameState.fortress_types && gameState.fortress_types[data.type]) {
        iconName = gameState.fortress_types[data.type].icon || "keep.png";
    }
    
    const iconMap = new THREE.TextureLoader().load('/static/icons/' + iconName);
    const iconMat = new THREE.SpriteMaterial({ map: iconMap, color: 0xffffff });
    const iconSprite = new THREE.Sprite(iconMat);
    iconSprite.scale.set(0.35, 0.35, 1);
    iconSprite.position.y = -0.05;
    group.add(iconSprite);

    // 2. Info Label (Units + Tier)
    const labelTex = createLabelTexture(data.units, data.tier, 0xffffff);
    const labelMat = new THREE.SpriteMaterial({ map: labelTex });
    const labelSprite = new THREE.Sprite(labelMat);
    labelSprite.scale.set(0.6, 0.6, 1);
    labelSprite.position.y = 0.05; 
    group.add(labelSprite);

    return { group, iconSprite, labelSprite };
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

        const { group, iconSprite, labelSprite } = createFortressMesh(fortressData);
        group.position.set(v[0], v[1], v[2]);
        group.position.multiplyScalar(1.06); // Hover slightly above surface
        
        // Metadata for Raycaster
        group.userData = { id: index.toString(), type: 'fortress' };
        iconSprite.userData = { id: index.toString(), type: 'fortress' };
        
        scene.add(group);
        fortressMeshes[index.toString()] = { mesh: group, iconSprite, labelSprite };
    });

    // 3. Roads (Lines)
    const lineMat = new THREE.LineBasicMaterial({ color: COLORS.connection, linewidth: 2 });
    lineMap = {};
    
    data.roads.forEach(road => {
        const u = road[0];
        const v = road[1];
        const p1 = new THREE.Vector3(...data.vertices[u]);
        const p2 = new THREE.Vector3(...data.vertices[v]);
        
        // Push lines out slightly so they don't clip into the globe
        p1.multiplyScalar(1.01);
        p2.multiplyScalar(1.01);

        const geo = new THREE.BufferGeometry().setFromPoints([p1, p2]);
        const line = new THREE.Line(geo, lineMat.clone()); // Clone mat to allow individual coloring
        scene.add(line);
        
        // Store for quick access. Key is smaller_id + "_" + larger_id
        const key = u < v ? `${u}_${v}` : `${v}_${u}`;
        lineMap[key] = line;
    });
    
    updateVisuals(data.fortresses);
    updateSectorVisuals();
}

function updateSectorVisuals() {
    // Check game state for sector owners and place dominance icons
    if (!gameState.sector_owners) return;

    // Load texture once
    const dominanceTex = new THREE.TextureLoader().load('/static/icons/star_shield.png'); // You might need to add a generic icon or reuse one

    for (let faceIdx = 0; faceIdx < gameState.faces.length; faceIdx++) {
        const owner = gameState.sector_owners[faceIdx.toString()];
        
        // Existing icon?
        if (sectorIcons[faceIdx]) {
            if (!owner) {
                // Remove if no longer owned
                scene.remove(sectorIcons[faceIdx]);
                delete sectorIcons[faceIdx];
            } else {
                // Update Color just in case
                // sectorIcons[faceIdx].material.color.setHex(...);
            }
        } else if (owner) {
            // Create new icon
            const mat = new THREE.SpriteMaterial({ 
                map: dominanceTex, 
                color: 0xffff00 // Gold for dominance
            });
            const sprite = new THREE.Sprite(mat);
            
            // Calculate Center
            const face = gameState.faces[faceIdx];
            const v1 = new THREE.Vector3(...gameState.vertices[face[0]]);
            const v2 = new THREE.Vector3(...gameState.vertices[face[1]]);
            const v3 = new THREE.Vector3(...gameState.vertices[face[2]]);
            
            const center = new THREE.Vector3().addVectors(v1, v2).add(v3).divideScalar(3);
            center.multiplyScalar(1.04); // Slightly above face
            
            sprite.position.copy(center);
            sprite.scale.set(0.2, 0.2, 1);
            scene.add(sprite);
            sectorIcons[faceIdx] = sprite;
        }
    }
}

function updatePathVisuals() {
    // 1. Reset all Lines to default
    Object.values(lineMap).forEach(line => {
        line.material.color.setHex(COLORS.connection);
        line.material.opacity = 0.3;
        line.material.transparent = true;
    });

    // 2. Clear old Arrows
    activeArrows.forEach(arrow => scene.remove(arrow));
    activeArrows = [];

    // 3. Highlight Valid Neighbors (Green Lines)
    if (selectedSourceId) {
        const neighbors = gameState.adj[selectedSourceId] || [];
        neighbors.forEach(nId => {
            const u = parseInt(selectedSourceId);
            const v = parseInt(nId);
            const key = u < v ? `${u}_${v}` : `${v}_${u}`;
            const line = lineMap[key];
            
            // If line exists and target is not disabled
            const targetFort = gameState.fortresses[nId];
            if (line && targetFort && !targetFort.disabled) {
                line.material.color.setHex(COLORS.connectionValid); // Green
                line.material.opacity = 0.8;
            }
        });
    }

    // 4. Draw Active Flow Arrows & Color Active Lines (Orange/Red)
    const coneGeo = new THREE.ConeGeometry(0.04, 0.15, 8);
    
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
                line.material.color.setHex(COLORS.connectionActive); // Orange
                line.material.opacity = 1.0;
            }

            // Draw Arrow (Actual Geometry)
            // Direction
            const dir = new THREE.Vector3().subVectors(p2, p1).normalize();
            // Position (Near source, pointing out)
            const dist = p1.distanceTo(p2);
            const arrowPos = p1.clone().add(dir.clone().multiplyScalar(dist * 0.3)); // 30% of the way
            
            const arrowMat = new THREE.MeshBasicMaterial({ color: COLORS.connectionActive });
            const arrowMesh = new THREE.Mesh(coneGeo, arrowMat);
            
            arrowMesh.position.copy(arrowPos);
            arrowMesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
            // Rotate 90 deg so cone points along line
            arrowMesh.rotateX(Math.PI / 2);

            scene.add(arrowMesh);
            activeArrows.push(arrowMesh);
        });
    }
}

function updateVisuals(fortresses) {
    // Update Fortresses
    for (const [id, data] of Object.entries(fortresses)) {
        if (data.disabled) continue;
        let obj = fortressMeshes[id];
        if (!obj) continue;

        // Update Label
        const currentUnits = Math.floor(data.units);
        if (obj.lastUnits !== currentUnits || obj.lastTier !== data.tier) {
            // Re-render texture
            const newTex = createLabelTexture(data.units, data.tier);
            obj.labelSprite.material.map = newTex;
            obj.labelSprite.material.needsUpdate = true;
            obj.lastUnits = currentUnits;
            obj.lastTier = data.tier;
        }

        // Tint Icon based on owner
        if (data.owner) {
            const raceInfo = gameState.races[data.race];
            obj.iconSprite.material.color.setHex(raceInfo ? raceInfo.color : 0xffffff);
        } else {
            obj.iconSprite.material.color.setHex(0xffffff);
        }
    }
    
    // Update Arrows and Lines
    updatePathVisuals();
    updateSectorVisuals();
}

socket.on('update_map', (fortresses) => {
    if (!gameState) return;
    gameState.fortresses = fortresses;
    updateVisuals(fortresses);
    
    // If UI is open, refresh values
    if (selectedSourceId && !selectedTargetId) {
        updateHUD(selectedSourceId);
    } else if (selectedTargetId) {
        updateHUD(selectedTargetId);
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
    updateSectorVisuals(); // Refresh icons
});

const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

function onMouseMove(event) {
    // Calculate Mouse Position
    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

    // Raycast for Hover Effects
    if (gameState) {
        raycaster.setFromCamera(mouse, camera);
        const allSprites = [];
        Object.values(fortressMeshes).forEach(o => allSprites.push(o.iconSprite));
        
        const intersects = raycaster.intersectObjects(allSprites, true);
        
        if (intersects.length > 0) {
            const targetId = intersects[0].object.userData.id;
            updateHUD(targetId); // Update HUD on Hover
            document.body.style.cursor = 'pointer';
        } else {
            document.body.style.cursor = 'default';
            // If nothing hovered, revert HUD to selected selection or hide if none
            if (selectedTargetId) {
                updateHUD(selectedTargetId);
            } else if (selectedSourceId) {
                updateHUD(selectedSourceId);
            } else {
                // If nothing selected and nothing hovered, maybe hide?
                // Keeping it visible might be annoying, let's leave last known or hide
                // uiDiv.style.display = 'none'; // Optional: Auto-hide
            }
        }
    }
}

function onMouseClick(event) {
    if (event.target.closest('#game-ui') || event.target.closest('.navbar')) return;

    raycaster.setFromCamera(mouse, camera);
    const allSprites = [];
    Object.values(fortressMeshes).forEach(o => allSprites.push(o.iconSprite));
    const intersects = raycaster.intersectObjects(allSprites, true);

    if (intersects.length > 0) {
        let target = intersects[0].object;
        const targetId = target.userData.id;
        handleNodeSelection(targetId);
    } else {
        // Deselect
        selectedSourceId = null;
        selectedTargetId = null;
        uiDiv.style.display = 'none';
        updatePathVisuals(); // Clears green lines
        statusMsg.textContent = "";
    }
}

function handleNodeSelection(id) {
    const fortress = gameState.fortresses[id];
    
    // Logic: 
    // 1. If nothing selected -> Select Source (if own) or Just View (if enemy)
    // 2. If Source selected -> Click another -> is it neighbor? Target. Is it self? Deselect. Is it other own? Change Source.

    if (selectedSourceId === null) {
        if (fortress.owner === playerUsername) {
            selectedSourceId = id;
            statusMsg.textContent = "Orders: Select a connected destination.";
        } else {
            // Just viewing enemy
            statusMsg.textContent = "Observing Enemy Position.";
        }
        updateHUD(id);
    } 
    else {
        // Source already active
        if (id === selectedSourceId) {
            // Clicked self -> Deselect
            selectedSourceId = null;
            selectedTargetId = null;
            statusMsg.textContent = "Selection Cleared.";
            uiDiv.style.display = 'none';
        } else if (fortress.owner === playerUsername && !selectedTargetId) {
            // Changed mind, picked different source
            selectedSourceId = id;
            statusMsg.textContent = "New Source Selected.";
            updateHUD(id);
        } else {
            // Clicked potential target
            const neighbors = gameState.adj[selectedSourceId] || [];
            if (neighbors.includes(parseInt(id))) {
                selectedTargetId = id;
                statusMsg.textContent = "Target Locked. Engage?";
                updateHUD(id);
            } else {
                statusMsg.textContent = "Target out of range!";
            }
        }
    }
    updatePathVisuals(); // Updates highlighting
}

function updateHUD(id) {
    const f = gameState.fortresses[id];
    if (!f) return;

    uiDiv.style.display = 'block';
    
    // Populate Data
    uiTitle.textContent = f.is_capital ? `Capital (${id})` : `Fortress ${id}`;
    
    // Structure Type
    // Map internal type key to Display Name if needed, currently using keys like "Keep", "Farm"
    uiType.textContent = f.type; 

    // Land Type (Approximation: Get dominant terrain of surrounding faces)
    // For now, we will look at the face terrain of the first face attached to this vertex
    // Ideally calculate the most common terrain type
    uiLand.textContent = "Surface"; // Default
    // Simple look up logic if we had vertex->face map handy. 
    // Since we don't have vertex->face map in JS easily without recalculating, 
    // we can approximate or skip. 
    // Let's rely on the fact that faces have colors. 
    // (Future: Pass terrain string in fortress data from python)

    uiOwner.textContent = f.owner || "Neutral";
    uiOwner.style.color = f.owner ? '#fff' : '#aaa';
    
    uiUnits.textContent = Math.floor(f.units);
    uiTier.textContent = f.tier;
    
    if (f.owner && gameState.races[f.race]) {
        uiSpecial.textContent = f.special_active ? "Active" : "Locked";
        uiSpecial.style.color = f.special_active ? "#0f0" : "#aaa";
    } else {
        uiSpecial.textContent = "None";
    }

    // Interaction Buttons (Only if Source + Target selected)
    if (selectedSourceId && selectedTargetId && id === selectedTargetId) {
        uiActionArea.style.display = 'block';
        
        const sourceFort = gameState.fortresses[selectedSourceId];
        const isLinked = sourceFort.paths && sourceFort.paths.includes(selectedTargetId);
        
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
            // Don't close UI, let update reflect change
        };
    } else {
        uiActionArea.style.display = 'none';
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
        
        // Pulse effects or rotation can go here
        
        controls.update();
        renderer.render(scene, camera);
    }
    animate();
}

init();