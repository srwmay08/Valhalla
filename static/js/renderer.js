import * as THREE from 'https://cdn.skypack.dev/three@0.136.0';
import { OrbitControls } from 'https://cdn.skypack.dev/three@0.136.0/examples/jsm/controls/OrbitControls.js';

export class GameRenderer {
    constructor(containerId) {
        console.log("[RENDER DEBUG] Initializing Renderer on container:", containerId);
        this.container = document.getElementById(containerId);
        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.controls = null;
        this.sphereMesh = null;
        this.fortressMeshes = {};
        this.pathLines = {}; 
        this.labels = []; 
        this.packetMesh = null;
        this.dummy = new THREE.Object3D();
        this.vertices = [];
        this.currentSelectedFace = null;
        this.currentHoveredFace = null;
        this.baseFaceColors = []; 
        this.init();
    }

    init() {
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(window.devicePixelRatio);
        this.container.appendChild(this.renderer.domElement);
        
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
        this.scene.add(ambientLight);
        
        const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
        dirLight.position.set(10, 10, 10);
        this.scene.add(dirLight);

        this.camera.position.set(0, 0, 2.5);
        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;

        const geometry = new THREE.SphereGeometry(0.008, 6, 6);
        const material = new THREE.MeshLambertMaterial({ vertexColors: false });
        this.packetMesh = new THREE.InstancedMesh(geometry, material, 4000);
        this.packetMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.scene.add(this.packetMesh);

        window.addEventListener('resize', () => this.onWindowResize(), false);
        this.animate();
    }

    animate() {
        requestAnimationFrame(() => this.animate());
        this.render();
    }

    onWindowResize() {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
    }

    initWorld(vertices, faces, faceColors) {
        console.log("[RENDER DEBUG] Building IcoSphere World with face count:", faces.length);
        this.vertices = vertices;
        this.baseFaceColors = [...faceColors]; 
        if (this.sphereMesh) this.scene.remove(this.sphereMesh);

        const geometry = new THREE.BufferGeometry();
        const positions = [];
        const colors = [];

        faces.forEach((face, faceIdx) => {
            const vA = vertices[face[0]];
            const vB = vertices[face[1]];
            const vC = vertices[face[2]];
            
            if (!vA || !vB || !vC) {
                console.error("[RENDER ERROR] Malformed Face detected at index:", faceIdx);
                return;
            }
            
            positions.push(...vA, ...vB, ...vC);
            const color = new THREE.Color(faceColors[faceIdx]);
            for(let i=0; i<3; i++) colors.push(color.r, color.g, color.b);
        });

        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
        geometry.computeVertexNormals();

        const material = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
        this.sphereMesh = new THREE.Mesh(geometry, material);
        this.sphereMesh.userData = { type: 'world' }; 
        this.scene.add(this.sphereMesh);

        console.log("[RENDER DEBUG] World Mesh added to scene. Starting fortress visuals...");
        this.initFortressVisuals(vertices);
    }

    initFortressVisuals(vertices) {
        Object.values(this.fortressMeshes).forEach(m => this.scene.remove(m));
        this.fortressMeshes = {};
        this.labels.forEach(l => l.element.remove());
        this.labels = [];

        vertices.forEach((v, idx) => {
            const group = new THREE.Group();
            const base = new THREE.Mesh(
                new THREE.CylinderGeometry(0.035, 0.045, 0.02, 6), 
                new THREE.MeshLambertMaterial({ color: 0x888888 })
            );
            const roof = new THREE.Mesh(
                new THREE.ConeGeometry(0.05, 0.02, 6), 
                new THREE.MeshLambertMaterial({ color: 0x444444 })
            );
            roof.position.y = 0.02;
            group.add(base);
            group.add(roof);
            group.position.set(v[0], v[1], v[2]);
            group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(v[0], v[1], v[2]).normalize());
            group.userData = { type: 'fortress', id: idx };
            this.scene.add(group);
            this.fortressMeshes[idx] = group;

            const label = document.createElement('div');
            label.className = 'fortress-label';
            label.style.position = 'absolute';
            label.style.pointerEvents = 'none';
            label.innerHTML = `<div class="unit-count">0</div><div class="tier-dots"><span></span><span></span><span></span></div>`;
            this.container.appendChild(label);
            this.labels[idx] = { element: label, pos: new THREE.Vector3(v[0], v[1], v[2]).multiplyScalar(1.1) };
        });
        console.log("[RENDER DEBUG] Fortress meshes initialized:", Object.keys(this.fortressMeshes).length);
    }

    highlightFortressHover(id) {
        if (this.fortressMeshes[id]) {
            this.fortressMeshes[id].children[1].material.emissive.setHex(0x444400);
        }
    }

    highlightPathHover(pathId, color = 0xffffff) {
        const line = this.pathLines[pathId];
        if (line) {
            line.material.opacity = 1.0;
            line.material.emissive.setHex(color);
        }
    }

    highlightConnectedPaths(sourceId, color = 0xffffff) {
        const prefix = `path_${sourceId}_`;
        Object.keys(this.pathLines).forEach(key => {
            if (key.startsWith(prefix)) {
                this.pathLines[key].material.opacity = 1.0;
                this.pathLines[key].material.emissive.setHex(color);
            }
        });
    }

    highlightFaceHover(faceIdx) {
        this.currentHoveredFace = faceIdx;
    }

    highlightFaceSelection(faceIdx) {
        this.currentSelectedFace = faceIdx;
    }

    clearHoverHighlight() {
        Object.values(this.fortressMeshes).forEach(g => g.children[1].material.emissive.setHex(0));
        Object.values(this.pathLines).forEach(l => {
            l.material.opacity = 0.6;
            l.material.emissive.setHex(0);
        });
        this.currentHoveredFace = null;
    }

    clearSelectionHighlights() {
        this.currentSelectedFace = null;
    }

    updateFaceColors(faceColors) {
        if (!this.sphereMesh) return;
        this.baseFaceColors = [...faceColors]; 
        
        const colors = this.sphereMesh.geometry.attributes.color.array;
        faceColors.forEach((colorHex, i) => {
            let color = new THREE.Color(colorHex);
            
            if (i === this.currentSelectedFace) {
                color.offsetHSL(0, 0, 0.3);
            } else if (i === this.currentHoveredFace) {
                color.offsetHSL(0, 0, 0.15);
            }
            
            const base = i * 9;
            for(let j=0; j<3; j++) {
                colors[base + j*3] = color.r;
                colors[base + j*3 + 1] = color.g;
                colors[base + j*3 + 2] = color.b;
            }
        });
        this.sphereMesh.geometry.attributes.color.needsUpdate = true;
    }

    updateFortresses(fortressData, currentUsername) {
        Object.values(fortressData).forEach(fort => {
            const group = this.fortressMeshes[fort.id];
            if (!group) return;

            let color = 0x888888; 
            if (fort.owner) {
                if (fort.owner === currentUsername) color = 0xff0000;
                else if (fort.owner === 'Gorgon') color = 0x00ff00;
                else color = 0x0000ff;
            }
            
            group.children[1].material.color.setHex(color);
            const scale = 1 + (fort.tier - 1) * 0.4;
            group.scale.set(scale, scale, scale);
            
            this.updatePathVisuals(fort, color);

            const label = this.labels[fort.id];
            if (label) {
                label.element.querySelector('.unit-count').innerText = Math.floor(fort.units);
                const dots = label.element.querySelectorAll('.tier-dots span');
                dots.forEach((dot, i) => {
                    dot.style.background = (i < fort.tier) ? '#ffffff' : '#444444';
                });
            }
        });
    }

    updatePathVisuals(fort, teamColor) {
        const keyPrefix = `path_${fort.id}_`;
        for (const key in this.pathLines) {
            if (key.startsWith(keyPrefix)) {
                this.scene.remove(this.pathLines[key]);
                delete this.pathLines[key];
            }
        }
        if (!fort.paths) return;

        const startPos = this.fortressMeshes[fort.id].position;
        fort.paths.forEach(targetId => {
            const targetMesh = this.fortressMeshes[targetId];
            if (!targetMesh) return;

            const endPos = targetMesh.position;
            const distance = startPos.distanceTo(endPos);
            const thickness = 0.008; 
            
            const geometry = new THREE.CylinderGeometry(thickness, thickness, distance, 6);
            const material = new THREE.MeshLambertMaterial({ 
                color: teamColor, 
                transparent: true, 
                opacity: 0.6,
                emissive: new THREE.Color(0x000000)
            });

            const lineMesh = new THREE.Mesh(geometry, material);
            const midpoint = new THREE.Vector3().addVectors(startPos, endPos).multiplyScalar(0.5);
            lineMesh.position.copy(midpoint);
            lineMesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3().subVectors(endPos, startPos).normalize());

            const key = `path_${fort.id}_${targetId}`;
            lineMesh.userData = { type: 'path', pathId: key, sourceId: fort.id, targetId: targetId };
            
            this.scene.add(lineMesh);
            this.pathLines[key] = lineMesh;
        });
    }

    updatePackets(edgeData) {
        if (!this.packetMesh || !this.vertices.length) return;
        let instanceIdx = 0;
        Object.values(edgeData).forEach(edge => {
            if (!edge.packets) return;
            const start = new THREE.Vector3(...this.vertices[edge.u]);
            const end = new THREE.Vector3(...this.vertices[edge.v]);
            edge.packets.forEach(packet => {
                if (instanceIdx >= 4000) return;
                const count = Math.min(5, Math.ceil(packet.amount / 5)); 
                for (let i = 0; i < count; i++) {
                    if (instanceIdx >= 4000) break;
                    const pos = Math.max(0, Math.min(1, packet.pos - (i * 0.02) * packet.direction));
                    this.dummy.position.lerpVectors(start, end, pos);
                    this.dummy.scale.setScalar(packet.is_special ? 1.5 : 1.0);
                    this.dummy.updateMatrix();
                    this.packetMesh.setMatrixAt(instanceIdx, this.dummy.matrix);
                    const pColor = (packet.owner === 'Gorgon') ? 0x00ff00 : 0xff0000;
                    this.packetMesh.setColorAt(instanceIdx, new THREE.Color(pColor));
                    instanceIdx++;
                }
            });
        });
        const zero = new THREE.Matrix4().set(0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0);
        for (let i = instanceIdx; i < 4000; i++) this.packetMesh.setMatrixAt(i, zero);
        this.packetMesh.instanceMatrix.needsUpdate = true;
        if (this.packetMesh.instanceColor) this.packetMesh.instanceColor.needsUpdate = true;
    }

    focusCamera(pos) {
        if (!pos) return;
        console.log("[RENDER DEBUG] Focusing camera on coordinates:", pos);
        const target = new THREE.Vector3(...pos);
        this.camera.position.copy(target.clone().multiplyScalar(2.0)); 
        this.camera.lookAt(0, 0, 0);
        this.controls?.update();
    }

    render() {
        this.controls?.update();
        this.labels.forEach(label => {
            const vector = label.pos.clone().project(this.camera);
            const x = (vector.x * 0.5 + 0.5) * window.innerWidth;
            const y = (vector.y * -0.5 + 0.5) * window.innerHeight;
            label.element.style.transform = `translate(-50%, -50%) translate(${x}px,${y}px)`;
            const dot = label.pos.clone().normalize().dot(this.camera.position.clone().normalize());
            label.element.style.opacity = dot > 0 ? 1 : 0;
        });
        this.renderer.render(this.scene, this.camera);
    }
}