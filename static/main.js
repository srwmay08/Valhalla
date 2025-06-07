import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// --- Configuration ---
const SUBDIVISIONS = 4; // Increase for a smoother sphere (4 is a good balance)
const BIOMES = {
    "Plain": new THREE.Color(0x7CFC00),    // (124, 252, 0)
    "Mountain": new THREE.Color(0x8B8989), // (139, 137, 137)
    "Hill": new THREE.Color(0xBDB76B),     // (189, 183, 107)
    "Cavern": new THREE.Color(0x483D8B),   // (72, 61, 139)
    "Water": new THREE.Color(0x4169E1),    // (65, 105, 225)
    "Forest": new THREE.Color(0x228B22),   // (34, 139, 34)
    "Swamp": new THREE.Color(0x2F4F4F),    // (47, 79, 79)
    "Coast": new THREE.Color(0xEED5B7),    // (238, 213, 183)
    "Ocean": new THREE.Color(0x00008B)     // (0, 0, 139)
};

// --- OpenDominion Economic Data ---
const BUILDINGS = {
    "Plain": [
        { name: "Alchemy", details: "Produces 45 Platinum/hr." },
        { name: "Farm", details: "Produces 80 Food/hr." },
        { name: "Smithy", details: "Reduces military training cost." },
        { name: "Masonry", details: "Increases Castle Improvement effectiveness." }
    ],
    "Forest": [
        { name: "Lumberyard", details: "Produces 50 Lumber/hr." },
        { name: "Forest Haven", details: "Offers protection against theft and spies." }
    ],
    "Mountain": [
        { name: "Ore Mine", details: "Produces 60 Ore/hr." },
        { name: "Gryphon Nest", details: "Increases Offensive Power." }
    ],
    "Cavern": [
        { name: "Diamond Mine", details: "Produces 15 Gems/hr." },
        { name: "School", details: "Produces Research Points." }
    ],
    "Hill": [
        { name: "Factory", details: "Reduces building/rezoning cost." },
        { name: "Guard Tower", details: "Increases Defensive Power." },
        { name: "Shrine", details: "Increases hero experience gain." },
        { name: "Barracks", details: "Houses 36 military units." }
    ],
    "Swamp": [
        { name: "Tower", details: "Produces 25 Mana/hr." },
        { name: "Temple", details: "Boosts population growth." },
        { name: "Wizard Guild", details: "Reduces magic costs and enhances wizards." }
    ],
    "Water": [
        { name: "Dock", details: "Produces 35 Food/hr and Boats." }
    ],
    "Coast": [{ name: "Coast", details: "Coastal area, suitable for Docks." }],
    "Ocean": [{ name: "Ocean", details: "Deep water, not buildable." }]
};


// --- Scene Setup ---
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({
    canvas: document.querySelector('#bg'),
    antialias: true
});

renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
camera.position.setZ(2);

// --- Controls (Implements drag-to-rotate, zoom, and release-to-spin) ---
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true; // Essential for the "release-to-spin" effect
controls.dampingFactor = 0.05;
controls.minDistance = 1.05; // Zoom in limit to see a face "flat"
controls.maxDistance = 10;  // Zoom out limit to see the whole world
controls.rotateSpeed = 0.5;

// --- Sphere Creation Logic (Ported from Python) ---
function createBiomeSphere(subdivisions) {
    // Start with a base Icosahedron and subdivide it for more detail
    let geometry = new THREE.IcosahedronGeometry(1, subdivisions);
    
    const faces = [];
    // The geometry is non-indexed, so each set of 3 vertices is one face
    for (let i = 0; i < geometry.attributes.position.count; i += 3) {
        faces.push([i, i + 1, i + 2]);
    }

    const faceNeighbors = findNeighbors(faces);
    const { faceBiomes, faceBuildings } = assignBiomesAndBuildings(faces, faceNeighbors);
    
    // Create a color attribute for the geometry
    const colors = [];
    for (let i = 0; i < faces.length; i++) {
        const biomeName = faceBiomes[i];
        const color = BIOMES[biomeName] || new THREE.Color(0xffffff);
        // Apply the same color to all 3 vertices of the face
        colors.push(color.r, color.g, color.b);
        colors.push(color.r, color.g, color.b);
        colors.push(color.r, color.g, color.b);
    }

    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

    // Use a material that respects vertex colors
    const material = new THREE.MeshBasicMaterial({ vertexColors: true });
    const sphere = new THREE.Mesh(geometry, material);

    // Store custom data on the sphere object
    sphere.userData.faceBiomes = faceBiomes;
    sphere.userData.faceBuildings = faceBuildings;
    
    return sphere;
}

function findNeighbors(faces) {
    const neighbors = Array(faces.length).fill(null).map(() => new Set());
    const edgeToFaces = new Map();

    for (let i = 0; i < faces.length; i++) {
        const face = faces[i];
        for (let j = 0; j < 3; j++) {
            const p1Idx = face[j];
            const p2Idx = face[(j + 1) % 3];
            // Create a consistent key for each edge
            const edgeKey = `${Math.min(p1Idx, p2Idx)}-${Math.max(p1Idx, p2Idx)}`;

            if (!edgeToFaces.has(edgeKey)) {
                edgeToFaces.set(edgeKey, []);
            }
            edgeToFaces.get(edgeKey).push(i);
        }
    }

    // Two faces sharing an edge are neighbors
    for (const faceIndices of edgeToFaces.values()) {
        if (faceIndices.length === 2) {
            neighbors[faceIndices[0]].add(faceIndices[1]);
            neighbors[faceIndices[1]].add(faceIndices[0]);
        }
    }

    return neighbors.map(set => Array.from(set));
}

function assignBiomesAndBuildings(faces, faceNeighbors) {
    const faceBiomes = Array(faces.length);
    const faceBuildings = Array(faces.length);
    const nonCoastBiomes = Object.keys(BIOMES).filter(b => b !== "Coast" && b !== "Ocean");
    const oceanChance = 1.0 / (nonCoastBiomes.length + 1);

    // 1. First Pass: Assign Ocean or other non-Coast biomes
    for (let i = 0; i < faces.length; i++) {
        if (Math.random() < oceanChance) {
            faceBiomes[i] = "Ocean";
        } else {
            faceBiomes[i] = nonCoastBiomes[Math.floor(Math.random() * nonCoastBiomes.length)];
        }
    }

    // 2. Second Pass: Change tiles bordering Oceans to Coast
    const finalBiomes = [...faceBiomes];
    for (let i = 0; i < faces.length; i++) {
        if (faceBiomes[i] !== "Ocean") {
            let isCoast = false;
            for (const neighborIdx of faceNeighbors[i]) {
                if (faceBiomes[neighborIdx] === "Ocean") {
                    isCoast = true;
                    break;
                }
            }
            if (isCoast) {
                finalBiomes[i] = "Coast";
            }
        }
    }
    
    // 3. Third Pass: Assign a building based on the final biome
    for (let i = 0; i < faces.length; i++) {
        const biome = finalBiomes[i];
        const possibleBuildings = BUILDINGS[biome] || [];
        if (possibleBuildings.length > 0) {
            faceBuildings[i] = possibleBuildings[Math.floor(Math.random() * possibleBuildings.length)];
        } else {
            faceBuildings[i] = { name: "Barren Land", details: "No buildings available for this biome." };
        }
    }

    return { faceBiomes: finalBiomes, faceBuildings };
}


// --- Add objects to scene ---
const sphere = createBiomeSphere(SUBDIVISIONS);
scene.add(sphere);

// --- Interactivity ---
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
const infoBox = document.getElementById('info-box');

function updateInfoBox(faceIndex) {
    if (faceIndex !== null && sphere.userData.faceBiomes && sphere.userData.faceBuildings) {
        const biome = sphere.userData.faceBiomes[faceIndex];
        const building = sphere.userData.faceBuildings[faceIndex];

        infoBox.classList.remove('hidden');
        document.getElementById('info-biome').textContent = biome;
        document.getElementById('info-building').textContent = `Building: ${building.name}`;
        document.getElementById('info-details').textContent = building.details;
    } else {
        infoBox.classList.add('hidden');
    }
}

function onMouseClick(event) {
    // We don't want to select a face when dragging to rotate
    if (controls.state !== -1) return;

    // Calculate mouse position in normalized device coordinates
    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = - (event.clientY / window.innerHeight) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);

    const intersects = raycaster.intersectObject(sphere);

    if (intersects.length > 0) {
        const faceIndex = intersects[0].faceIndex;
        updateInfoBox(faceIndex);
    } else {
        updateInfoBox(null);
    }
}

// Listen for mouse up instead of click to avoid firing after a drag
window.addEventListener('mouseup', onMouseClick);


// --- Animation Loop ---
function animate() {
    // This creates a smooth animation loop
    requestAnimationFrame(animate);

    // This is required for the damping (release-to-spin) to work
    controls.update();

    renderer.render(scene, camera);
}

// --- Handle window resizing for responsiveness ---
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

// Start the animation
animate();