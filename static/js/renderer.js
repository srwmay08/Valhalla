import * as THREE from 'https://cdn.skypack.dev/three@0.136.0';
import { OrbitControls } from 'https://cdn.skypack.dev/three@0.136.0/examples/jsm/controls/OrbitControls.js';

export class GameRenderer {
    constructor(containerId) {
        this.container = document.getElementById(containerId);
        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        
        this.controls = null;
        this.sphereMesh = null;
        this.fortressMeshes = {};
        this.pathLines = {}; // Store lines for attack paths
        
        this.init();
    }

    init() {
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.container.appendChild(this.renderer.domElement);
        
        // Lighting
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
        this.scene.add(ambientLight);
        const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
        dirLight.position.set(10, 10, 10);
        this.scene.add(dirLight);

        // Camera
        this.camera.position.z = 2.5;
        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;

        // Resize Listener
        window.addEventListener('resize', () => this.onWindowResize(), false);
    }

    onWindowResize() {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
    }

    initWorld(vertices, faces, faceColors) {
        // Clear old mesh if exists
        if (this.sphereMesh) this.scene.remove(this.sphereMesh);

        const geometry = new THREE.BufferGeometry();
        const positions = [];
        const colors = [];

        // Build geometry from faces
        // Note: We duplicate vertices per face to allow flat shading/coloring per face
        faces.forEach((face, faceIdx) => {
            const vA = vertices[face[0]];
            const vB = vertices[face[1]];
            const vC = vertices[face[2]];

            positions.push(...vA, ...vB, ...vC);

            const colorHex = faceColors[faceIdx];
            const color = new THREE.Color(colorHex);
            colors.push(color.r, color.g, color.b);
            colors.push(color.r, color.g, color.b);
            colors.push(color.r, color.g, color.b);
        });

        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
        geometry.computeVertexNormals();

        const material = new THREE.MeshLambertMaterial({ 
            vertexColors: true,
            flatShading: true 
        });

        this.sphereMesh = new THREE.Mesh(geometry, material);
        this.sphereMesh.userData = { type: 'world' }; // ID for Raycaster
        this.scene.add(this.sphereMesh);

        this.initFortressVisuals(vertices);
    }

    initFortressVisuals(vertices) {
        // Simple spheres for fortresses at vertices
        const geom = new THREE.SphereGeometry(0.04, 16, 16);
        
        vertices.forEach((v, idx) => {
            const mat = new THREE.MeshBasicMaterial({ color: 0x888888 }); // Neutral gray
            const mesh = new THREE.Mesh(geom, mat);
            mesh.position.set(v[0], v[1], v[2]);
            mesh.userData = { type: 'fortress', id: idx };
            
            this.scene.add(mesh);
            this.fortressMeshes[idx] = mesh;
        });
    }

    updateFaceColors(faceColors) {
        if (!this.sphereMesh) return;
        
        const colors = this.sphereMesh.geometry.attributes.color.array;
        
        faceColors.forEach((colorHex, i) => {
            const color = new THREE.Color(colorHex);
            // Each face has 3 vertices * 3 rgb values = 9 values
            const baseIndex = i * 9;
            
            // Vertex 1
            colors[baseIndex] = color.r;
            colors[baseIndex+1] = color.g;
            colors[baseIndex+2] = color.b;
            // Vertex 2
            colors[baseIndex+3] = color.r;
            colors[baseIndex+4] = color.g;
            colors[baseIndex+5] = color.b;
            // Vertex 3
            colors[baseIndex+6] = color.r;
            colors[baseIndex+7] = color.g;
            colors[baseIndex+8] = color.b;
        });
        
        this.sphereMesh.geometry.attributes.color.needsUpdate = true;
    }

    updateFortresses(fortressData, currentUsername) {
        Object.values(fortressData).forEach(fort => {
            const mesh = this.fortressMeshes[fort.id];
            if (!mesh) return;

            // Update Color based on Owner
            let color = 0x888888; // Neutral
            if (fort.owner) {
                // Determine color logic (could be passed from backend or mapped here)
                // For now, simple logic:
                if (fort.owner === currentUsername) color = 0x00ff00; // Green for you
                else if (fort.owner === 'Gorgon') color = 0xff0000; // Red for AI
                else color = 0x0000ff; // Blue for others
            }
            mesh.material.color.setHex(color);

            // Scale based on Tier (Visual feedback)
            const scale = 1 + (fort.tier - 1) * 0.3;
            mesh.scale.set(scale, scale, scale);
            
            // Draw Attack Paths (Lines)
            this.updatePathVisuals(fort);
        });
    }

    updatePathVisuals(fort) {
        // Clear old paths for this fortress if they exist
        // (Simplified: In a real engine you'd update geometry rather than recreate)
        const keyPrefix = `path_${fort.id}_`;
        
        // Remove existing lines for this source
        for (const key in this.pathLines) {
            if (key.startsWith(keyPrefix)) {
                this.scene.remove(this.pathLines[key]);
                delete this.pathLines[key];
            }
        }

        if (!fort.paths || fort.paths.length === 0) return;

        const startMesh = this.fortressMeshes[fort.id];
        fort.paths.forEach(targetId => {
            const targetMesh = this.fortressMeshes[targetId];
            if (!startMesh || !targetMesh) return;

            const points = [];
            points.push(startMesh.position);
            points.push(targetMesh.position);

            const geometry = new THREE.BufferGeometry().setFromPoints(points);
            const material = new THREE.LineBasicMaterial({ color: 0xffaa00, linewidth: 2 });
            const line = new THREE.Line(geometry, material);
            
            const key = `${keyPrefix}${targetId}`;
            this.scene.add(line);
            this.pathLines[key] = line;
        });
    }

    focusCamera(pos) {
        // pos is [x, y, z] array
        // Smoothly tween camera (optional, or just set for now)
        const target = new THREE.Vector3(pos[0], pos[1], pos[2]);
        this.camera.position.copy(target.multiplyScalar(2.0)); // Zoom out a bit
        this.camera.lookAt(0, 0, 0);
    }

    render() {
        if (this.controls) this.controls.update();
        this.renderer.render(this.scene, this.camera);
    }
}