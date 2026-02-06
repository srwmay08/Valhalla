import * as THREE from 'https://cdn.skypack.dev/three@0.136.0';

export class InputHandler {
    constructor(renderer, gameClient, uiManager) {
        this.renderer = renderer;
        this.client = gameClient;
        this.ui = uiManager;
        
        this.raycaster = new THREE.Raycaster();
        // Set threshold to make clicking thin lines easier
        this.raycaster.params.Line.threshold = 0.02; 
        this.mouse = new THREE.Vector2();
        
        this.selectedSourceId = null;
        this.hoveredObject = null;
        this.hoveredType = null;
        
        this.initListeners();
    }

    initListeners() {
        window.addEventListener('click', (e) => this.onClick(e), false);
        window.addEventListener('mousemove', (e) => this.onMouseMove(e), false);
    }

    onMouseMove(event) {
        this.mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
        this.mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

        this.raycaster.setFromCamera(this.mouse, this.renderer.camera);
        const intersects = this.raycaster.intersectObjects(this.renderer.scene.children, true);

        let currentHover = null;
        let currentType = null;

        if (intersects.length > 0) {
            // Find specific object types in the intersection list
            const fortHit = intersects.find(h => h.object.parent && h.object.parent.userData?.type === 'fortress');
            const pathHit = intersects.find(h => h.object.userData?.type === 'path');
            const worldHit = intersects.find(h => h.object.userData?.type === 'world');

            if (fortHit) {
                currentHover = fortHit.object.parent.userData.id;
                currentType = 'fortress';
            } else if (pathHit) {
                currentHover = pathHit.object.userData.pathId;
                currentType = 'path';
            } else if (worldHit) {
                currentHover = worldHit.faceIndex;
                currentType = 'face';
            }
        }

        if (this.hoveredObject !== currentHover || this.hoveredType !== currentType) {
            this.renderer.clearHoverHighlight();
            this.hoveredObject = currentHover;
            this.hoveredType = currentType;

            if (this.hoveredType === 'fortress') {
                this.renderer.highlightFortressHover(this.hoveredObject);
            } else if (this.hoveredType === 'path') {
                this.renderer.highlightPathHover(this.hoveredObject);
            } else if (this.hoveredType === 'face') {
                this.renderer.highlightFaceHover(this.hoveredObject);
            }
        }
    }

    onClick(event) {
        this.raycaster.setFromCamera(this.mouse, this.renderer.camera);
        const intersects = this.raycaster.intersectObjects(this.renderer.scene.children, true);

        if (intersects.length > 0) {
            const fortHit = intersects.find(h => h.object.parent && h.object.parent.userData?.type === 'fortress');
            const pathHit = intersects.find(h => h.object.userData?.type === 'path');
            const worldHit = intersects.find(h => h.object.userData?.type === 'world');

            if (fortHit) {
                this.handleFortressClick(fortHit.object.parent.userData.id);
            } else if (pathHit) {
                this.handlePathClick(pathHit.object.userData.pathId);
            } else if (worldHit) {
                this.handleFaceClick(worldHit.faceIndex);
            }
        } else {
            this.deselect();
        }
    }

    handleFaceClick(faceIdx) {
        this.ui.showFaceInfo(faceIdx);
        this.renderer.setFaceSelection(faceIdx);
        if (this.selectedSourceId !== null) {
            this.ui.highlightSelection(this.selectedSourceId, false);
            this.selectedSourceId = null;
        }
    }

    handlePathClick(pathId) {
        const parts = pathId.split('_');
        const sourceId = parseInt(parts[1]);
        const targetId = parseInt(parts[2]);
        this.ui.showPathInfo(sourceId, targetId);
    }

    handleFortressClick(id) {
        const fort = this.client.getFortress(id);
        if (!fort) return;

        this.ui.showFortressInfo(fort);
        this.renderer.setFaceSelection(null);

        if (this.selectedSourceId === null) {
            if (fort.owner === this.client.username) {
                this.selectedSourceId = id;
                this.ui.highlightSelection(id, true);
            }
        } else {
            if (this.selectedSourceId == id) {
                this.deselect();
            } else {
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
        this.ui.hideInfo();
    }
}