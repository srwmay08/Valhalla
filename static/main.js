import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// --- Configuration ---
const SUBDIVISIONS = 4;
const BIOMES = {
    "Plain": new THREE.Color(0x7CFC00), "Mountain": new THREE.Color(0x8B8989), "Hill": new THREE.Color(0xBDB76B),
    "Cavern": new THREE.Color(0x483D8B), "Water": new THREE.Color(0x4169E1), "Forest": new THREE.Color(0x228B22),
    "Swamp": new THREE.Color(0x2F4F4F), "Coast": new THREE.Color(0xEED5B7), "Ocean": new THREE.Color(0x00008B)
};
const PLAYER_COLORS = [new THREE.Color(0xff0000), new THREE.Color(0x0000ff), new THREE.Color(0x00ffff), new THREE.Color(0xffff00)];

// --- Scene Setup ---
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({ canvas: document.querySelector('#bg'), antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
camera.position.setZ(2.5);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05;

// --- Global State & Interactivity Variables ---
let sphere, gameState = {}, tooltipEl;
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
let mouseDownPos = new THREE.Vector2();
let isDragging = false;
let stateVersion = 0;

function init() {
    const geometry = new THREE.IcosahedronGeometry(1, SUBDIVISIONS);
    const numVertices = geometry.attributes.position.count;
    const initialColors = [];
    tooltipEl = document.getElementById("tooltip");
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
            updateStatusDisplay(gameState);
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
            const faceIndex = tileIndex % state.num_faces;
            faceOwners[faceIndex] = i;
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

function formatResource(name, value) {
    return `<span><span class="resource-name">${name}</span><span class="resource-value">${value}</span></span>`;
}

function updateStatusDisplay(state) {
    const stateEl = document.getElementById('game-state');
    const resourcesEl = document.getElementById('player-resources');
    const incomeEl = document.getElementById('player-income');
    const eventLogEl = document.getElementById('event-log');
    const promptEl = document.getElementById('info-prompt');

    if (stateEl) stateEl.textContent = state.state;
    const player1 = state.players['Player 1'];
    if (player1) {
        if (resourcesEl) resourcesEl.innerHTML = Object.entries(player1.resources).map(([name, value]) => formatResource(name, value)).join('');
        if (incomeEl) incomeEl.innerHTML = Object.entries(player1.hourly_gains).map(([name, value]) => formatResource(name, value >= 0 ? `+${value}`: value)).join('');
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
    if (isDragging || !gameState.state) return;
    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObject(sphere);

    if (intersects.length > 0) {
        const faceIndex = Math.floor(intersects[0].face.a / 3);
        if (gameState.state === 'SETUP' || gameState.state === 'COUNTDOWN') {
            const isOwnedByOther = Object.values(gameState.players).some(p => p.is_ai && p.owned_faces.some(f => f % gameState.num_faces === faceIndex));
            if (isOwnedByOther) { alert("This territory is already claimed by an AI."); return; }
            await fetch('/api/startgame', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ faceIndex: faceIndex }) });
        } else if (gameState.state === 'RUNNING') {
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
    if (gameState.state === 'COUNTDOWN') {
        updateStatusDisplay(gameState);
    }
    controls.update();
    renderer.render(scene, camera);
}

init();