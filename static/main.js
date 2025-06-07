import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// --- Configuration ---
const SUBDIVISIONS = 4; // Should match server's IcosahedronSphere
const BIOMES = {
    "Plain": new THREE.Color(0x7CFC00), "Mountain": new THREE.Color(0x8B8989), "Hill": new THREE.Color(0xBDB76B),
    "Cavern": new THREE.Color(0x483D8B), "Water": new THREE.Color(0x4169E1), "Forest": new THREE.Color(0x228B22),
    "Swamp": new THREE.Color(0x2F4F4F), "Coast": new THREE.Color(0xEED5B7), "Ocean": new THREE.Color(0x00008B)
};
const PLAYER_COLORS = [ new THREE.Color(0xff0000), new THREE.Color(0x0000ff), new THREE.Color(0x00ffff), new THREE.Color(0xffff00) ];

// --- Scene Setup ---
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({ canvas: document.querySelector('#bg'), antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
camera.position.setZ(2.5);

// --- Controls ---
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05;

// --- Global State & Interactivity Variables ---
let sphere, gameState = {};
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
let mouseDownPos = new THREE.Vector2();
let isDragging = false;
let stateVersion = 0; // For long polling

// --- Core Functions ---
function init() {
    const geometry = new THREE.IcosahedronGeometry(1, SUBDIVISIONS);
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
    
    fetchGameState(); // Start the long polling loop
    animate();
}

async function fetchGameState() {
    try {
        const response = await fetch(`/api/gamestate?version=${stateVersion}`);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
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
    
    // Immediately make the next request for the next update
    fetchGameState();
}

function updateVisuals(state) {
    if (!sphere || !state.faces) return;

    const faceOwners = {};
    const playerNames = Object.keys(state.players);
    playerNames.forEach((name, i) => {
        const p = state.players[name];
        p.owned_faces.forEach(faceIdx => {
            faceOwners[faceIdx] = playerNames.indexOf(name);
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

function updateStatusDisplay(state) {
    const stateEl = document.getElementById('game-state');
    const resourcesEl = document.getElementById('player-resources');
    const promptEl = document.getElementById('info-prompt');
    const infoBoxEl = document.getElementById('info-box');

    if (stateEl) stateEl.textContent = state.state;
    
    const player1 = state.players['Player 1'];
    if (resourcesEl && player1) {
        resourcesEl.textContent = JSON.stringify(player1.resources, null, 2);
    }
    
    if (infoBoxEl && promptEl) {
        if (state.state === 'SETUP') {
            infoBoxEl.classList.remove('hidden');
            promptEl.textContent = "Click an unclaimed territory to select a starting location.";
        } else {
            infoBoxEl.classList.add('hidden');
        }
    }
}

function onMouseDown(event) {
    isDragging = false;
    mouseDownPos.set(event.clientX, event.clientY);
}

function onMouseMove(event) {
    if (mouseDownPos.distanceTo(new THREE.Vector2(event.clientX, event.clientY)) > 5) {
        isDragging = true;
    }
}

async function onMouseUp(event) {
    if (isDragging || gameState.state !== 'SETUP') return;

    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObject(sphere);

    if (intersects.length > 0) {
        const faceIndex = Math.floor(intersects[0].face.a / 3);
        
        const isOwned = Object.values(gameState.players).some(p => p.owned_faces.includes(faceIndex));
        if (isOwned) {
            alert("This territory is already claimed.");
            return;
        }

        if (confirm(`Do you want to start in territory ${faceIndex}?`)) {
            await fetch('/api/startgame', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ faceIndex: faceIndex })
            });
        }
    }
}

function animate() {
    requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
}

// --- Start Application ---
init();