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
        this.pathLines = {}; 
        
        // Phase 4: Packet Visualization
        this.packetMesh = null;
        this.dummy = new THREE.Object3D(); // Helper for matrix calculation
        this.vertices = []; // Store vertices for lerping

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

        // Initialize InstancedMesh for Packets (Pool size 2000)
        const geometry = new THREE.SphereGeometry(0.012, 8, 8);
        const material = new THREE.MeshBasicMaterial({ color: 0xffffff });
        this.packetMesh = new THREE.InstancedMesh(geometry, material, 2000);
        this.packetMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.scene.add(this.packetMesh);

        // Resize Listener
        window.addEventListener('resize', () => this.onWindowResize(), false);
    }

    onWindowResize() {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
    }

    initWorld(vertices, faces, faceColors) {
        // Store vertices for packet interpolation
        this.vertices = vertices;

        if (this.sphereMesh) this.scene.remove(this.sphereMesh);

        const geometry = new THREE.BufferGeometry();
        const positions = [];
        const colors = [];

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
        this.sphereMesh.userData = { type: 'world' }; 
        this.scene.add(this.sphereMesh);

        this.initFortressVisuals(vertices);
    }

    initFortressVisuals(vertices) {
        const geom = new THREE.SphereGeometry(0.04, 16, 16);
        
        vertices.forEach((v, idx) => {
            const mat = new THREE.MeshBasicMaterial({ color: 0x888888 }); 
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
            const baseIndex = i * 9;
            
            colors[baseIndex] = color.r;
            colors[baseIndex+1] = color.g;
            colors[baseIndex+2] = color.b;
            colors[baseIndex+3] = color.r;
            colors[baseIndex+4] = color.g;
            colors[baseIndex+5] = color.b;
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

            let color = 0x888888; 
            if (fort.owner) {
                if (fort.owner === currentUsername) color = 0x00ff00; 
                else if (fort.owner === 'Gorgon') color = 0xff0000; 
                else color = 0x0000ff; 
            }
            mesh.material.color.setHex(color);

            const scale = 1 + (fort.tier - 1) * 0.3;
            mesh.scale.set(scale, scale, scale);
            
            this.updatePathVisuals(fort);
        });
    }

    updatePathVisuals(fort) {
        const keyPrefix = `path_${fort.id}_`;
        
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

    updatePackets(edgeData) {
        // Phase 4: Render moving unit packets using InstancedMesh
        if (!this.packetMesh || !this.vertices.length) return;

        let instanceIdx = 0;
        const limit = 2000;

        Object.values(edgeData).forEach(edge => {
            if (!edge.packets || edge.packets.length === 0) return;

            // Get start/end coordinates from vertex array
            const uCoords = this.vertices[edge.u];
            const vCoords = this.vertices[edge.v];
            
            const startVec = new THREE.Vector3(uCoords[0], uCoords[1], uCoords[2]);
            const endVec = new THREE.Vector3(vCoords[0], vCoords[1], vCoords[2]);

            edge.packets.forEach(packet => {
                if (instanceIdx >= limit) return;

                // Lerp Position based on packet.pos (0.0 to 1.0)
                // packet.pos is absolute relative to edge direction? 
                // The edge stores U and V. Packet direction 1 means U->V, -1 means V->U.
                // However, world_engine updates packet.pos relative to U->V vector (0.0=U, 1.0=V).
                // So simple lerp works.
                
                const currentPos = new THREE.Vector3().lerpVectors(startVec, endVec, packet.pos);
                
                this.dummy.position.copy(currentPos);
                
                // Visual scale based on amount
                const s = Math.min(3.0, 1.0 + (packet.amount / 50.0)); 
                this.dummy.scale.set(s, s, s);
                
                this.dummy.updateMatrix();
                this.packetMesh.setMatrixAt(instanceIdx, this.dummy.matrix);
                
                instanceIdx++;
            });
        });

        // Hide unused instances by zeroing scale
        const zeroMatrix = new THREE.Matrix4().set(0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0);
        for (let i = instanceIdx; i < limit; i++) {
            this.packetMesh.setMatrixAt(i, zeroMatrix);
        }

        this.packetMesh.instanceMatrix.needsUpdate = true;
    }

    focusCamera(pos) {
        const target = new THREE.Vector3(pos[0], pos[1], pos[2]);
        this.camera.position.copy(target.multiplyScalar(2.0)); 
        this.camera.lookAt(0, 0, 0);
    }

    render() {
        if (this.controls) this.controls.update();
        this.renderer.render(this.scene, this.camera);
    }
}