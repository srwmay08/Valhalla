// --- Constants and Globals ---
const TILE_COLORS = {
    "Deep Sea": "#000055", "Sea": "#4169E1", "Plain": "#7CFC00", 
    "Mountain": "#8B8989", "Hill": "#BDB76B", "Swamp": "#2F4F4F",
    "Forest": "#228B22", "Waste": "#996515", "Farm": "#F5DEB3", 
    "Default": "#333333"
};
const PLAYER_COLORS = ["#ff0000", "#0000ff", "#00ffff", "#ffff00"];

let canvas, ctx, tooltipEl, debugPanel;
let pickingCanvas, pickingCtx; // For off-screen picking
let gameState = {}, stateVersion = 0;
let lastHoveredFaceIndex = -1;

// --- View/Control State ---
let rotationX = 0.5, rotationY = 0;
let zoom = 3.5;
let isDragging = false;
let lastMousePos = { x: 0, y: 0 };
let clickStartPos = { x: 0, y: 0 };
let needsRedraw = true; // Optimization flag
let renderedTriangleCount = 0; // For debug counting

// --- Initialization ---
function init() {
    canvas = document.querySelector('#bg');
    ctx = canvas.getContext('2d');
    tooltipEl = document.getElementById("tooltip");
    debugPanel = document.getElementById("debug-content");

    pickingCanvas = document.createElement('canvas');
    pickingCtx = pickingCanvas.getContext('2d');

    resizeCanvas();
    setupEventListeners();
    
    // Start the animation loop and the state fetching loop
    animate();
    fetchGameState();
}

function setupEventListeners() {
    window.addEventListener('resize', () => { resizeCanvas(); needsRedraw = true; });
    canvas.addEventListener('mousedown', onMouseDown);
    canvas.addEventListener('mousemove', onMouseMove);
    canvas.addEventListener('mouseup', onMouseUp);
    canvas.addEventListener('mouseleave', () => { isDragging = false; });
    canvas.addEventListener('wheel', onWheel);
}

function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    pickingCanvas.width = canvas.width;
    pickingCanvas.height = canvas.height;
    needsRedraw = true;
}

// --- Game State, HUD, and Debug ---
async function fetchGameState() {
    // This function now runs in a continuous, stable loop.
    while (true) {
        try {
            const response = await fetch(`/api/gamestate?version=${stateVersion}`);
            if (response.status === 200) {
                const newState = await response.json();
                if (newState.version !== stateVersion) {
                    gameState = newState;
                    stateVersion = newState.version;
                    needsRedraw = true; // Flag that we have new data to draw
                }
            } else if (response.status !== 304) { // 304 is Not Modified, which is fine
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            // If the request was successful (200 or 304), we continue to the next iteration.
        } catch (e) {
            console.error("Fetch error, will retry in 5s:", e);
            // On error, wait 5 seconds before trying again.
            await new Promise(resolve => setTimeout(resolve, 5000));
        }
    }
}

function updateDebugInfo() {
    if (!debugPanel) return;
    if (!gameState.tiles) {
        debugPanel.innerHTML = "<p>Loading Game State...</p>";
        return;
    }

    const totalTerritories = gameState.tiles.length;
    const totalFaces = gameState.faces.length;
    const territoryMatch = totalTerritories === totalFaces;

    let html = `<p>Territory Match: ${territoryMatch 
        ? '<span style="color: #7CFC00;">OK</span>' 
        : '<span style="color: #ff4d4d;">MISMATCH</span>'}</p>`;
    html += `<p>Total Territories: ${totalTerritories}</p>`;
    html += `<p>Visible Triangles: ${renderedTriangleCount}</p>`;
    
    debugPanel.innerHTML = html;
}

function formatResource(name, value) { return `<span><span class="resource-name">${name}</span><span class="resource-value">${value}</span></span>`; }

function updateHud(state) {
    if (!state.state) return; // Don't update HUD if state is not loaded

    const hudResourceDisplay = document.getElementById('hud-resource-display');
    if (hudResourceDisplay) {
        const player1 = state.players ? state.players['Player 1'] : null;
        if (player1) {
            let html = '';
            const resourceOrder = ["Platinum", "Food", "Lumber", "Mana", "Ore", "Gems", "Research Points", "Draftees", "Peasants"];
            resourceOrder.forEach(resName => {
                if (player1.resources[resName] !== undefined) {
                    const resValue = player1.resources[resName];
                    const gainValue = player1.hourly_gains[resName] !== undefined ? player1.hourly_gains[resName] : '';
                    const gainClass = gainValue >= 0 ? 'positive-gain' : 'negative-gain';
                    html += `
                        <span class="resource-name">${resName}</span>
                        <span class="resource-value">${resValue}</span>
                        <span class="resource-gain ${gainClass}">${gainValue !== '' ? (gainValue > 0 ? '+' : '') + gainValue : ''}</span>
                    `;
                }
            });
            hudResourceDisplay.innerHTML = html;
        } else {
            hudResourceDisplay.innerHTML = '';
        }
    }
    const stateEl = document.getElementById('game-state-hud');
    if(stateEl) stateEl.textContent = `(${state.state})`;
    const eventLogEl = document.getElementById('event-log');
    if (eventLogEl && state.event_log) {
        const logHTML = state.event_log.map(msg => `<li>${msg}</li>`).join('');
        if (eventLogEl.innerHTML !== logHTML) eventLogEl.innerHTML = logHTML;
    }
    const promptEl = document.getElementById('info-prompt');
    if (promptEl) {
        if (state.state === 'SETUP') {
            promptEl.classList.remove('hidden'); promptEl.textContent = "Click an unclaimed territory to select a starting location.";
        } else if (state.state === 'COUNTDOWN' && state.countdown_end_time) {
            promptEl.classList.remove('hidden'); const remaining = Math.max(0, state.countdown_end_time - (Date.now() / 1000));
            promptEl.textContent = `Game starting in ${Math.ceil(remaining)} seconds... Click another tile to change.`;
        } else { promptEl.classList.add('hidden'); }
    }
    const tickCountdownEl = document.getElementById('next-tick-countdown');
    const tickLabelEl = document.getElementById('next-tick-label');
    if (tickCountdownEl && tickLabelEl) {
        if (state.state === 'RUNNING' && state.last_tick_time && state.tick_interval) {
            const nextTickTime = state.last_tick_time + state.tick_interval; const remaining = Math.max(0, nextTickTime - (Date.now() / 1000));
            const hours = Math.floor(remaining/3600); const minutes = Math.floor((remaining / 60) % 60).toString().padStart(2, '0'); const seconds = Math.floor(remaining % 60).toString().padStart(2, '0');
            tickCountdownEl.textContent = `${hours}:${minutes}:${seconds}`; tickLabelEl.style.display = 'block'; tickCountdownEl.style.display = 'block';
        } else { tickLabelEl.style.display = 'none'; tickCountdownEl.style.display = 'none'; }
    }
}

// --- Rendering Logic ---
function animate() {
    requestAnimationFrame(animate);

    // Always update informational panels
    updateHud(gameState);
    updateDebugInfo();

    // Only redraw the expensive 3D globe when it needs it
    if (needsRedraw && gameState.vertices) {
        drawSphere(ctx, false);
        needsRedraw = false;
    }
}

function projectVertex(v) {
    let cosY = Math.cos(rotationY), sinY = Math.sin(rotationY);
    let rY = [ v[0] * cosY + v[2] * sinY, v[1], -v[0] * sinY + v[2] * cosY ];
    let cosX = Math.cos(rotationX), sinX = Math.sin(rotationX);
    let rXY = [ rY[0], rY[1] * cosX - rY[2] * sinX, rY[1] * sinX + rY[2] * cosX ];
    const scale = (canvas.height / 2) * (zoom / 5);
    return { x: rXY[0] * scale, y: rXY[1] * scale, z: rXY[2] };
}

function drawSphere(context, isPicking) {
    const { vertices, faces, tiles, players, num_faces } = gameState;
    if (!vertices || !faces) return;
    
    context.clearRect(0, 0, context.canvas.width, context.canvas.height);
    context.save();
    context.translate(context.canvas.width / 2, context.canvas.height / 2);

    const projectedVertices = vertices.map(projectVertex);
    
    const facesToDraw = [];
    for (let i = 0; i < faces.length; i++) {
        const [i1, i2, i3] = faces[i];
        if(!projectedVertices[i1] || !projectedVertices[i2] || !projectedVertices[i3]) continue;
        const v1 = projectedVertices[i1], v2 = projectedVertices[i2], v3 = projectedVertices[i3];
        const normalZ = (v2.x - v1.x) * (v3.y - v1.y) - (v2.y - v1.y) * (v3.x - v1.x);
        
        if (normalZ < 0) {
            facesToDraw.push({ index: i, vertices: [v1, v2, v3], depth: (v1.z + v2.z + v3.z) / 3 });
        }
    }
    
    if (!isPicking) {
        renderedTriangleCount = facesToDraw.length;
    }
    
    facesToDraw.sort((a, b) => a.depth - b.depth);
    
    const faceOwners = {};
    if (!isPicking && players) {
        Object.entries(players).forEach(([name, pData], i) => {
            pData.owned_faces.forEach(tileIndex => faceOwners[tileIndex % num_faces] = i);
        });
    }
    
    facesToDraw.forEach(({ index, vertices }) => {
        const [v1, v2, v3] = vertices;
        context.beginPath();
        context.moveTo(v1.x, v1.y);
        context.lineTo(v2.x, v2.y);
        context.lineTo(v3.x, v3.y);
        context.closePath();
        
        if (isPicking) {
            const r = (index >> 16) & 0xFF, g = (index >> 8) & 0xFF, b = index & 0xFF;
            context.fillStyle = `rgb(${r},${g},${b})`;
            context.fill();
        } else {
            const ownerIndex = faceOwners[index];
            let color;
            if (ownerIndex !== undefined && ownerIndex < PLAYER_COLORS.length) {
                color = PLAYER_COLORS[ownerIndex];
            } else {
                color = (tiles && tiles[index]) ? (TILE_COLORS[tiles[index].type] || TILE_COLORS.Default) : TILE_COLORS.Default;
            }
            context.fillStyle = color;
            context.strokeStyle = '#000';
            context.lineWidth = 0.5;
            context.fill();
            context.stroke();
        }
    });
    
    context.restore();
}

// --- Interaction ---
function getFaceIndexFromCoordinates(x, y) {
    drawSphere(pickingCtx, true);
    const pixelData = pickingCtx.getImageData(x * window.devicePixelRatio, y * window.devicePixelRatio, 1, 1).data;
    if (pixelData[3] < 255) return -1;
    return (pixelData[0] << 16) | (pixelData[1] << 8) | pixelData[2];
}

function onMouseDown(e) {
    isDragging = false;
    clickStartPos = { x: e.clientX, y: e.clientY };
    lastMousePos = { x: e.clientX, y: e.clientY };
}

function onMouseMove(e) {
    const dx = e.clientX - clickStartPos.x;
    const dy = e.clientY - clickStartPos.y;
    if (Math.hypot(dx, dy) > 5) isDragging = true;
    
    if (isDragging) {
        tooltipEl.classList.add('hidden');
        const moveX = e.clientX - lastMousePos.x;
        const moveY = e.clientY - lastMousePos.y;
        rotationY += moveX * 0.005;
        rotationX += moveY * 0.005;
        lastMousePos = { x: e.clientX, y: e.clientY };
        needsRedraw = true;
    } else {
        const faceIndex = getFaceIndexFromCoordinates(e.clientX, e.clientY);
        if (faceIndex !== -1 && gameState.tiles && faceIndex < gameState.tiles.length) {
            if (faceIndex !== lastHoveredFaceIndex) {
                lastHoveredFaceIndex = faceIndex;
            }
            let ownerName = "Neutral";
            const ownerEntry = Object.entries(gameState.players || {}).find(([,p]) => p.owned_faces.some(f => f % gameState.num_faces === faceIndex));
            if(ownerEntry) ownerName = ownerEntry[0];
            const tileInfo = gameState.tiles[faceIndex];
            tooltipEl.textContent = `Territory: ${faceIndex} | Type: ${tileInfo.type} | Owner: ${ownerName}`;
            tooltipEl.style.left = `${e.clientX + 15}px`;
            tooltipEl.style.top = `${e.clientY}px`;
            tooltipEl.classList.remove('hidden');
        } else {
            tooltipEl.classList.add('hidden');
            lastHoveredFaceIndex = -1;
        }
    }
}

async function onMouseUp(e) {
    if (isDragging) {
        isDragging = false;
        return;
    }
    tooltipEl.classList.add('hidden');
    
    const faceIndex = getFaceIndexFromCoordinates(e.clientX, e.clientY);
    if (faceIndex === -1 || !gameState.state) return;

    if (gameState.state === 'SETUP' || gameState.state === 'COUNTDOWN') {
        const isOwnedByOther = Object.values(gameState.players).some(p => p.is_ai && p.owned_faces.some(f => f % gameState.num_faces === faceIndex));
        if (isOwnedByOther) { alert("This territory is already claimed by an AI."); return; }
        await fetch('/api/startgame', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ faceIndex }) });
    } else if (gameState.state === 'RUNNING') {
        const player1 = gameState.players['Player 1'];
        if (!player1) return;
        const playerOwnedFaces = new Set(player1.owned_faces.map(f => f % gameState.num_faces));
        const isOwnedByAnyone = Object.values(gameState.players).some(p => p.owned_faces.some(f => f % gameState.num_faces === faceIndex));
        const neighbors = gameState.neighbors ? gameState.neighbors[faceIndex] || [] : [];
        const isAdjacent = neighbors.some(n => playerOwnedFaces.has(n));
        
        if (!isOwnedByAnyone && isAdjacent) {
            // Using a custom modal instead of confirm()
            showModal(`Attack neutral territory ${faceIndex}?`, async () => {
                const response = await fetch('/api/attack', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ faceIndex }) });
                const attackResult = await response.json();
                showModal(attackResult.result === 'won' ? `You won the battle for tile ${faceIndex}!` : `Your attack on tile ${faceIndex} failed!`);
            });
        }
    }
}

function onWheel(e) {
    e.preventDefault();
    zoom -= e.deltaY * 0.005;
    zoom = Math.max(1, Math.min(10, zoom));
    needsRedraw = true;
}

// --- Utility: Custom Modal for Alerts/Confirms ---
function showModal(message, onConfirm) {
    // Remove existing modal if any
    const existingModal = document.getElementById('custom-modal');
    if (existingModal) existingModal.remove();

    const modal = document.createElement('div');
    modal.id = 'custom-modal';
    modal.style.position = 'fixed';
    modal.style.left = '50%';
    modal.style.top = '50%';
    modal.style.transform = 'translate(-50%, -50%)';
    modal.style.padding = '20px';
    modal.style.background = 'rgba(0, 0, 0, 0.9)';
    modal.style.border = '1px solid #ffd700';
    modal.style.borderRadius = '8px';
    modal.style.color = '#fff';
    modal.style.zIndex = '1000';
    modal.style.textAlign = 'center';

    const messageP = document.createElement('p');
    messageP.textContent = message;
    messageP.style.marginBottom = '20px';
    modal.appendChild(messageP);

    if (onConfirm) { // This is a confirmation dialog
        const confirmBtn = document.createElement('button');
        confirmBtn.textContent = 'Confirm';
        confirmBtn.onclick = () => { onConfirm(); modal.remove(); };
        modal.appendChild(confirmBtn);

        const cancelBtn = document.createElement('button');
        cancelBtn.textContent = 'Cancel';
        cancelBtn.style.marginLeft = '10px';
        cancelBtn.onclick = () => modal.remove();
        modal.appendChild(cancelBtn);
    } else { // This is just an alert
        const okBtn = document.createElement('button');
        okBtn.textContent = 'OK';
        okBtn.onclick = () => modal.remove();
        modal.appendChild(okBtn);
    }
    document.body.appendChild(modal);
}

init();