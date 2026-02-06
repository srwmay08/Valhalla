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
        
        this.initListeners();
    }

    initListeners() {
        window.addEventListener('click', (e) => this.onClick(e), false);
        window.addEventListener('mousemove', (e) => this.onMouseMove(e), false);
    }

    onMouseMove(event) {
        this.updateMouseCoords(event);
        this.raycaster.setFromCamera(this.mouse, this.renderer.camera);

        const intersects = this.raycaster.intersectObjects(this.renderer.scene.children, true);
        
        let hoverId = "None";
        let hoverType = "Background";

        if (intersects.length > 0) {
            const hit = intersects[0];
            
            // Priority 1: Fortress
            const fortHit = intersects.find(h => h.object.parent && h.object.parent.userData?.type === 'fortress');
            if (fortHit) {
                hoverId = fortHit.object.parent.userData.id;
                hoverType = "Fortress";
            } 
            // Priority 2: Road
            else if (hit.object.userData?.type === 'path') {
                hoverId = hit.object.userData.pathId;
                hoverType = "Road";
            }
            // Priority 3: World Face
            else if (hit.object.userData?.type === 'world') {
                hoverId = hit.faceIndex;
                hoverType = "Face";
            }
        }

        this.ui.updateHoverMonitor(hoverType, hoverId);
    }

    onClick(event) {
        this.updateMouseCoords(event);
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

    updateMouseCoords(event) {
        this.mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
        this.mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
    }

    handleFaceClick(faceIdx) {
        this.ui.showFaceInfo(faceIdx);
        this.renderer.highlightFaceSelection(faceIdx);
    }

    handlePathClick(pathId) {
        const parts = pathId.split('_');
        const sourceId = parts[1];
        const targetId = parts[2];
        this.ui.showPathInfo(sourceId, targetId);
    }

    handleFortressClick(id) {
        const fort = this.client.getFortress(id);
        if (!fort) return;

        this.ui.showFortressInfo(fort);

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
        this.renderer.clearSelectionHighlights();
        this.ui.hideInfo();
    }
}