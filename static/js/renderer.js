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
        
        this.packetMesh = null;
        this.dummy = new THREE.Object3D();
        this.vertices = [];

        this.init();
    }

    init() {
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.container.appendChild(this.renderer.domElement);
        
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
        this.scene.add(ambientLight);
        
        const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
        dirLight.position.set(10, 10, 10);
        this.scene.add(dirLight);

        this.camera.position.z = 2.5;
        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;

        const geometry = new THREE.SphereGeometry(0.008, 6, 6);
        const material = new THREE.MeshLambertMaterial({ vertexColors: false });
        this.packetMesh = new THREE.InstancedMesh(geometry, material, 4000);
        this.packetMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.scene.add(this.packetMesh);

        window.addEventListener('resize', () => this.onWindowResize(), false);
    }

    onWindowResize() {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
    }

    initWorld(vertices, faces, faceColors) {
        this.vertices = vertices;

        if (this.sphereMesh) {
            this.scene.remove(this.sphereMesh);
        }

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
        vertices.forEach((v, idx) => {
            const group = new THREE.Group();
            
            const baseGeom = new THREE.CylinderGeometry(0.035, 0.045, 0.02, 6);
            const baseMat = new THREE.MeshLambertMaterial({ color: 0x888888 });
            const base = new THREE.Mesh(baseGeom, baseMat);
            group.add(base);

            const roofGeom = new THREE.ConeGeometry(0.05, 0.02, 6);
            const roofMat = new THREE.MeshLambertMaterial({ color: 0x444444 });
            const roof = new THREE.Mesh(roofGeom, roofMat);
            roof.position.y = 0.02;
            group.add(roof);

            group.position.set(v[0], v[1], v[2]);
            
            const normal = new THREE.Vector3(v[0], v[1], v[2]).normalize();
            group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal);
            
            group.userData = { type: 'fortress', id: idx };
            this.scene.add(group);
            this.fortressMeshes[idx] = group;
        });
    }

    updateFaceColors(faceColors) {
        if (!this.sphereMesh) {
            return;
        }
        
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
            const group = this.fortressMeshes[fort.id];
            if (!group) {
                return;
            }

            let color = 0x888888; 
            if (fort.owner) {
                if (fort.owner === currentUsername) {
                    color = 0xff0000;
                } else if (fort.owner === 'Gorgon') {
                    color = 0x00ff00;
                } else if (fort.owner === 'Midas') {
                    color = 0xffff00;
                } else {
                    color = 0x0000ff;
                }
            }
            
            group.children[1].material.color.setHex(color);

            const scale = 1 + (fort.tier - 1) * 0.4;
            group.scale.set(scale, scale, scale);
            
            this.updatePathVisuals(fort, color);
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

        if (!fort.paths || fort.paths.length === 0) {
            return;
        }

        const startPos = this.fortressMeshes[fort.id].position;
        fort.paths.forEach(targetId => {
            const targetMesh = this.fortressMeshes[targetId];
            if (!targetMesh) {
                return;
            }

            const points = [];
            points.push(startPos);
            points.push(targetMesh.position);

            const geometry = new THREE.BufferGeometry().setFromPoints(points);
            const material = new THREE.LineBasicMaterial({ 
                color: teamColor || 0xffaa00, 
                linewidth: 3,
                transparent: true,
                opacity: 0.6
            });
            const line = new THREE.Line(geometry, material);
            
            const key = `${keyPrefix}${targetId}`;
            this.scene.add(line);
            this.pathLines[key] = line;
        });
    }

    updatePackets(edgeData) {
        if (!this.packetMesh || !this.vertices.length) {
            return;
        }

        let instanceIdx = 0;
        const limit = 4000;

        Object.values(edgeData).forEach(edge => {
            if (!edge.packets || edge.packets.length === 0) {
                return;
            }

            const uCoords = this.vertices[edge.u];
            const vCoords = this.vertices[edge.v];
            const startVec = new THREE.Vector3(uCoords[0], uCoords[1], uCoords[2]);
            const endVec = new THREE.Vector3(vCoords[0], vCoords[1], vCoords[2]);

            edge.packets.forEach(packet => {
                if (instanceIdx >= limit) {
                    return;
                }

                const troopCount = Math.min(5, Math.ceil(packet.amount / 5)); 
                
                for (let i = 0; i < troopCount; i++) {
                    if (instanceIdx >= limit) {
                        break;
                    }

                    const offset = (i * 0.02) * packet.direction;
                    const displayPos = Math.max(0, Math.min(1, packet.pos - offset));
                    
                    const currentPos = new THREE.Vector3().lerpVectors(startVec, endVec, displayPos);
                    
                    this.dummy.position.copy(currentPos);
                    
                    const s = packet.is_special ? 1.5 : 1.0;
                    this.dummy.scale.set(s, s, s);
                    
                    this.dummy.updateMatrix();
                    this.packetMesh.setMatrixAt(instanceIdx, this.dummy.matrix);
                    
                    let pColor = new THREE.Color(0xffffff);
                    if (packet.owner === 'Gorgon') {
                        pColor.setHex(0x00ff00);
                    } else {
                        pColor.setHex(0xff0000);
                    }

                    this.packetMesh.setColorAt(instanceIdx, pColor);
                    
                    instanceIdx++;
                }
            });
        });

        const zeroMatrix = new THREE.Matrix4().set(0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0);
        for (let i = instanceIdx; i < limit; i++) {
            this.packetMesh.setMatrixAt(i, zeroMatrix);
        }

        this.packetMesh.instanceMatrix.needsUpdate = true;
        if (this.packetMesh.instanceColor) {
            this.packetMesh.instanceColor.needsUpdate = true;
        }
    }

    focusCamera(pos) {
        const target = new THREE.Vector3(pos[0], pos[1], pos[2]);
        this.camera.position.copy(target.clone().multiplyScalar(2.0)); 
        this.camera.lookAt(0, 0, 0);
        if (this.controls) {
            this.controls.target.set(0, 0, 0);
            this.controls.update();
        }
    }

    render() {
        if (this.controls) {
            this.controls.update();
        }
        this.renderer.render(this.scene, this.camera);
    }
}