import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const SUBDIVISIONS = 4; // Should match server's IcosahedronSphere
const BIOMES = {
    "Plain": new THREE.Color(0x7CFC00), "Mountain": new THREE.Color(0x8B8989), "Hill": new THREE.Color(0xBDB76B),
    "Cavern": new THREE.Color(0x483D8B), "Water": new THREE.Color(0x4169E1), "Forest": new THREE.Color(0x228B22),
    "Swamp": new THREE.Color(0x2F4F4F), "Coast": new THREE.Color(0xEED5B7), "Ocean": new THREE.Color(0x00008B)
};
const PLAYER_COLORS = [ new THREE.Color(0xff0000), new THREE.Color(0x0000ff), new THREE.Color(0x00ffff), new THREE.Color(0xffff00) ];

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({ canvas: document.querySelector('#bg'), antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
camera.position.setZ(2);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05;

let sphere, gameState = {};
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

function init() {
    const geometry = new THREE.IcosahedronGeometry(1, SUBDIVISIONS);
    const material = new THREE.MeshBasicMaterial({ vertexColors: true });
    sphere = new THREE.Mesh(geometry, material);
    scene.add(sphere);
    
    window.addEventListener('mouseup', onMouseClick);
    window.addEventListener('resize', () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    });
    
    fetchGameState();
    setInterval(fetchGameState, 2500); // Poll server every 2.5 seconds
    animate();
}

async function fetchGameState() {
    try {
        const response = await fetch('/api/gamestate');
        gameState = await response.json();
        updateVisuals(gameState);
        updateStatusDisplay(gameState);
    } catch (e) {
        console.error("Failed to fetch game state:", e);
        document.getElementById('game-state').textContent = "Connection Lost";
    }
}

function updateVisuals(state) {
    if (!sphere || !state.faces) return;

    const faceOwners = {};
    Object.values(state.players).forEach((p, i) => {
        p.owned_faces.forEach(faceIdx => { faceOwners[faceIdx] = i; });
    });

    const colors = [];
    for (let i = 0; i < state.faces.length; i++) {
        let color;
        if (faceOwners[i] !== undefined) {
            color = PLAYER_COLORS[faceOwners[i]];
        } else {
            color = BIOMES[state.faces[i]] || new THREE.Color(0xffffff);
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

    stateEl.textContent = state.state;
    const player1 = state.players['Player 1'];
    if (player1) {
        resourcesEl.textContent = JSON.stringify(player1.resources, null, 2);
    }
    if (state.state === 'SETUP') {
        infoBoxEl.classList.remove('hidden');
        promptEl.textContent = "Click an unclaimed territory to select a starting location.";
    } else {
        infoBoxEl.classList.add('hidden');
    }
}

async function onMouseClick(event) {
    if (controls.state !== -1 || gameState.state !== 'SETUP') return;

    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObject(sphere);

    if (intersects.length > 0) {
        const faceIndex = intersects[0].faceIndex;
        const isOwned = Object.values(gameState.players).some(p => p.owned_faces.includes(faceIndex));
        if (isOwned) {
            alert("This territory is already claimed.");
            return;
        }
        if (confirm(`Do you want to start in territory ${faceIndex}? (Y/N)`)) {
            await fetch('/api/startgame', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ faceIndex: faceIndex })
            });
            fetchGameState(); // Fetch state immediately to reflect the change
        }
    }
}

function animate() {
    requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
}

init();