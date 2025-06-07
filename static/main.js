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
    const faceBiomes = assignBiomes(faces, faceNeighbors);
    
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

function assignBiomes(faces, faceNeighbors) {
    const faceBiomes = Array(faces.length);
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
    return finalBiomes;
}


// --- Add objects to scene ---
const sphere = createBiomeSphere(SUBDIVISIONS);
scene.add(sphere);

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
