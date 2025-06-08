import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const SUBDIVISIONS = 5; // Increased from 4 to match the server
const BIOMES = {"Plain": new THREE.Color(0x7CFC00), "Mountain": new THREE.Color(0x8B8989), "Hill": new THREE.Color(0xBDB76B),"Cavern": new THREE.Color(0x483D8B), "Water": new THREE.Color(0x4169E1), "Forest": new THREE.Color(0x228B22),"Swamp": new THREE.Color(0x2F4F4F), "Coast": new THREE.Color(0xEED5B7), "Ocean": new THREE.Color(0x00008B)};
const PLAYER_COLORS = [new THREE.Color(0xff0000), new THREE.Color(0x0000ff), new THREE.Color(0x00ffff), new THREE.Color(0xffff00)];

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({ canvas: document.querySelector('#bg'), antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
camera.position.setZ(2.5);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05;

let sphere, gameState = {}, tooltipEl;
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
let mouseDownPos = new THREE.Vector2();
let isDragging = false;
let stateVersion = 0;

function init() {
    tooltipEl = document.getElementById("tooltip");
    const geometry = new THREE.IcosahedronGeometry(1, SUBDIVISIONS);
    const numVertices = geometry.attributes.position.count;
    const initialColors = [];
    const initialColor = new THREE.Color(0x444444);
    for (let i = 0; i < numVertices; i++) {
        initialColors.push(initialColor.r, initialColor.g, initialColor.b);
    }
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(initialColors, 3));
    const material = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide });
    sphere = new THREE.Mesh(geometry, material);
    scene.add(sphere);

    renderer.domElement.addEventListener('mousedown', onMouseDown);
    renderer.domElement.addEventListener('mousemove', onMouseMove);
    renderer.domElement.addEventListener('mouseup', onMouseUp);
    window.addEventListener('resize', () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    });

    fetchGameState();
    animate();
}

async function fetchGameState() {
    try {
        const response = await fetch(`/api/gamestate?version=${stateVersion}`);
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        const newState = await response.json();
        if (newState.version !== stateVersion) {
            gameState = newState;
            stateVersion = gameState.version;
            updateVisuals(gameState);
            updateHud(gameState);
        }
    } catch (e) {
        console.error("Fetch error, will retry in 5s:", e);
        await new Promise(resolve => setTimeout(resolve, 5000));
    }
    fetchGameState();
}

function updateVisuals(state) {
    if (!sphere || !state.faces || !state.num_faces) return;
    const faceOwners = {};
    const playerNames = Object.keys(state.players);
    playerNames.forEach((name, i) => {
        state.players[name].owned_faces.forEach(tileIndex => {
            faceOwners[tileIndex % state.num_faces] = i;
        });
    });
    const colors = [];
    const numTriangles = sphere.geometry.attributes.position.count / 3;
    for (let i = 0; i < numTriangles; i++) {
        let color;
        if (faceOwners[i] !== undefined) {
            color = PLAYER_COLORS[faceOwners[i]] || new THREE.Color(0xffffff);
        } else {
            color = BIOMES[state.faces[i]] || new THREE.Color(0x333333);
        }
        colors.push(color.r, color.g, color.b, color.r, color.g, color.b, color.r, color.g, color.b);
    }
    sphere.geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    sphere.geometry.attributes.color.needsUpdate = true;
}

function updateHud(state) {
    const stateEl = document.getElementById('game-state-hud');
    const resourceDisplayEl = document.getElementById('hud-resource-display');
    const eventLogEl = document.getElementById('event-log');
    const promptEl = document.getElementById('info-prompt');
    const tickCountdownEl = document.getElementById('next-tick-countdown');
    const tickLabelEl = document.getElementById('next-tick-label');

    if (stateEl) stateEl.textContent = `(${state.state})`;

    const player1 = state.players['Player 1'];
    if (player1 && resourceDisplayEl) {
        const resourceOrder = ['Platinum', 'Food', 'Lumber', 'Mana', 'Ore', 'Gems', 'Research Points', 'Peasants', 'Draftees'];
        let newHtml = '';

        for (const resourceName of resourceOrder) {
            if (player1.resources[resourceName] !== undefined) {
                const currentAmount = player1.resources[resourceName];
                const gainAmount = player1.hourly_gains[resourceName] || 0;
                
                const gainSign = gainAmount > 0 ? '+' : ''; // No sign for 0 or negative
                const gainClass = gainAmount > 0 ? 'positive-gain' : (gainAmount < 0 ? 'negative-gain' : '');

                newHtml += `
                    <span>
                        <span class="resource-name">${resourceName}</span>
                        <span class="resource-value">${currentAmount}</span>
                        <span class="resource-gain ${gainClass}">${gainSign}${gainAmount}</span>
                    </span>
                `;
            }
        }
        resourceDisplayEl.innerHTML = newHtml;
    }

    if (promptEl) {
        if (state.state === 'SETUP') {
            promptEl.classList.remove('hidden');
            promptEl.textContent = "Click an unclaimed territory to select a starting location.";
        } else if (state.state === 'COUNTDOWN' && state.countdown_end_time) {
            promptEl.classList.remove('hidden');
            const remaining = Math.max(0, state.countdown_end_time - (Date.now() / 1000));
            promptEl.textContent = `Game starting in ${Math.ceil(remaining)} seconds... Click another tile to change.`;
        } else {
            promptEl.classList.add('hidden');
        }
    }

    if (eventLogEl && state.event_log) {
        const logHTML = state.event_log.map(msg => `<li>${msg}</li>`).join('');
        if (eventLogEl.innerHTML !== logHTML) eventLogEl.innerHTML = logHTML;
    }

    if (tickCountdownEl && tickLabelEl) {
        if (state.state === 'RUNNING' && state.last_tick_time && state.tick_interval) {
            const nextTickTime = state.last_tick_time + state.tick_interval;
            const remaining = Math.max(0, nextTickTime - (Date.now() / 1000));
            const minutes = Math.floor((remaining / 60) % 60).toString().padStart(2, '0');
            const seconds = Math.floor(remaining % 60).toString().padStart(2, '0');
            const hours = Math.floor(remaining / 3600);
            tickCountdownEl.textContent = `${hours}:${minutes}:${seconds}`;
            tickLabelEl.style.display = 'block';
            tickCountdownEl.style.display = 'block';
        } else {
            tickLabelEl.style.display = 'none';
            tickCountdownEl.style.display = 'none';
        }
    }
}

function onMouseDown(event) {
    isDragging = false;
    mouseDownPos.set(event.clientX, event.clientY);
}

function onMouseMove(event) {
    if (isDragging) {
        tooltipEl.classList.add('hidden');
        return;
    }
    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObject(sphere);

    if (intersects.length > 0) {
        const faceIndex = Math.floor(intersects[0].face.a / 3);
        let ownerName = "Neutral";
        const ownerEntry = Object.entries(gameState.players || {}).find(([, p]) => p.owned_faces.some(f => f % gameState.num_faces === faceIndex));
        if (ownerEntry) ownerName = ownerEntry[0];
        
        // Restore Biome information to the tooltip
        tooltipEl.textContent = `Territory: ${faceIndex} | Biome: ${gameState.faces ? gameState.faces[faceIndex] : "N/A"} | Owner: ${ownerName}`;
        tooltipEl.style.left = `${event.clientX + 15}px`;
        tooltipEl.style.top = `${event.clientY}px`;
        tooltipEl.classList.remove('hidden');
    } else {
        tooltipEl.classList.add('hidden');
    }
}

async function onMouseUp(event) {
    tooltipEl.classList.add('hidden');
    // Simplified logic: ignore clicks if it was a drag or if the game state hasn't loaded yet.
    if (isDragging || !gameState.state) return;

    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObject(sphere);

    if (intersects.length > 0) {
        const faceIndex = Math.floor(intersects[0].face.a / 3);
        // During SETUP or COUNTDOWN, a click always attempts to start/re-start the game.
        if (gameState.state === 'SETUP' || gameState.state === 'COUNTDOWN') {
            await fetch('/api/startgame', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ faceIndex: faceIndex }) });
        } 
        // During RUNNING, a click attempts an attack.
        else if (gameState.state === 'RUNNING') {
            const player1 = gameState.players['Player 1'];
            if (!player1) return;
            const playerOwnedFaces = new Set(player1.owned_faces.map(f => f % gameState.num_faces));
            const isOwnedByAnyone = Object.values(gameState.players).some(p => p.owned_faces.some(f => f % gameState.num_faces === faceIndex));
            const neighbors = gameState.neighbors[faceIndex] || [];
            const isAdjacent = neighbors.some(n => playerOwnedFaces.has(n));
            
            if (!isOwnedByAnyone && isAdjacent) {
                if (confirm(`Attack neutral territory ${faceIndex}?`)) {
                    const response = await fetch('/api/attack', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ faceIndex: faceIndex }) });
                    const attackResult = await response.json();
                    if (attackResult.result === 'won') { alert(`You won the battle for tile ${faceIndex}!`); }
                    else if (attackResult.result === 'lost') { alert(`Your attack on tile ${faceIndex} failed!`); }
                }
            }
        }
    }
}

function animate() {
    requestAnimationFrame(animate);
    if (gameState.state === 'COUNTDOWN' || gameState.state === 'RUNNING') {
        updateHud(gameState);
    }
    controls.update();
    renderer.render(scene, camera);
}

init();