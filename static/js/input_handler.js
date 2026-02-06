import * as THREE from 'https://cdn.skypack.dev/three@0.136.0';

export class InputHandler {
    constructor(renderer, gameClient, uiManager) {
        this.renderer = renderer; // Need access to camera and scene
        this.client = gameClient;
        this.ui = uiManager;
        
        this.raycaster = new THREE.Raycaster();
        this.mouse = new THREE.Vector2();
        
        this.selectedSourceId = null;
        this.hoveredObject = null;
        this.hoveredType = null; // 'fortress' or 'face'
        
        this.initListeners();
    }

    initListeners() {
        window.addEventListener('click', (e) => this.onClick(e), false);
        window.addEventListener('mousemove', (e) => this.onMouseMove(e), false);
    }

    onMouseMove(event) {
        // Calculate mouse position in normalized device coordinates
        this.mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
        this.mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

        this.raycaster.setFromCamera(this.mouse, this.renderer.camera);

        // Get intersections (recursive: true to check children of Fortress groups)
        const intersects = this.raycaster.intersectObjects(this.renderer.scene.children, true);

        let currentHover = null;
        let currentType = null;

        if (intersects.length > 0) {
            const hit = intersects[0];
            
            // Check for Fortress Hover (check parent since fortresses are Groups)
            const fortGroup = hit.object.parent;
            if (fortGroup && fortGroup.userData && fortGroup.userData.type === 'fortress') {
                currentHover = fortGroup.userData.id;
                currentType = 'fortress';
            } 
            // Check for World/Face Hover
            else if (hit.object.userData && hit.object.userData.type === 'world') {
                // Each face in BufferGeometry is 3 vertices. 
                // In our sphereMesh, each logical face consists of 1 triangle.
                currentHover = hit.faceIndex;
                currentType = 'face';
            }
        }

        // Apply visual highlighting if the hover changed
        if (this.hoveredObject !== currentHover || this.hoveredType !== currentType) {
            this.renderer.clearHoverHighlight();
            this.hoveredObject = currentHover;
            this.hoveredType = currentType;

            if (this.hoveredType === 'fortress') {
                this.renderer.highlightFortressHover(this.hoveredObject);
            } else if (this.hoveredType === 'face') {
                this.renderer.highlightFaceHover(this.hoveredObject);
            }
        }
    }

    onClick(event) {
        this.raycaster.setFromCamera(this.mouse, this.renderer.camera);
        const intersects = this.raycaster.intersectObjects(this.renderer.scene.children, true);

        if (intersects.length > 0) {
            const hit = intersects[0];
            
            // 1. Check for Fortress Click
            const fortGroup = hit.object.parent;
            if (fortGroup && fortGroup.userData && fortGroup.userData.type === 'fortress') {
                this.handleFortressClick(fortGroup.userData.id);
                return;
            }

            // 2. Check for World/Face Click
            if (hit.object.userData && hit.object.userData.type === 'world') {
                this.handleFaceClick(hit.faceIndex);
                return;
            }
        } else {
            this.deselect();
        }
    }

    handleFaceClick(faceIdx) {
        // Note: faceIdx is the Three.js face index. 
        // In renderer.js, faces are built linearly.
        this.ui.showFaceInfo(faceIdx);
        this.renderer.setFaceSelection(faceIdx);
        // Clear fortress selection when clicking land
        if (this.selectedSourceId !== null) {
            this.ui.highlightSelection(this.selectedSourceId, false);
            this.selectedSourceId = null;
        }
    }

    handleFortressClick(id) {
        const fort = this.client.getFortress(id);
        if (!fort) return;

        // UI Update
        this.ui.showFortressInfo(fort);
        this.renderer.setFaceSelection(null); // Clear face selection highlight

        // Logic: Source Selection vs Target Selection
        if (this.selectedSourceId === null) {
            // Select Source if owned by player
            if (fort.owner === this.client.username) {
                this.selectedSourceId = id;
                this.ui.highlightSelection(id, true);
                console.log(`Selected Source: ${id}`);
            }
        } else {
            // We already have a source, this click is the Target
            if (this.selectedSourceId == id) {
                // Clicked same fort -> Deselect
                this.deselect();
            } else {
                // Submit Move
                this.client.sendMove(this.selectedSourceId, id);
            }
        }
    }

    deselect() {
        if (this.selectedSourceId !== null) {
            this.ui.highlightSelection(this.selectedSourceId, false);
            this.selectedSourceId = null;
        }
        this.renderer.setFaceSelection(null);
        this.ui.hideFortressInfo();
    }
}