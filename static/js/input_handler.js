import * as THREE from 'https://cdn.skypack.dev/three@0.136.0';

export class InputHandler {
    constructor(renderer, gameClient, uiManager) {
        this.renderer = renderer;
        this.client = gameClient;
        this.ui = uiManager;
        
        this.raycaster = new THREE.Raycaster();
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

        this.renderer.clearHoverHighlight();

        if (intersects.length > 0) {
            const fortHit = intersects.find(h => h.object.parent && h.object.parent.userData?.type === 'fortress');
            const pathHit = intersects.find(h => h.object.userData?.type === 'path');
            const worldHit = intersects.find(h => h.object.userData?.type === 'world');

            if (fortHit) {
                hoverId = fortHit.object.parent.userData.id;
                hoverType = "Fortress";
                this.renderer.highlightFortressHover(hoverId);
            } else if (pathHit) {
                hoverId = pathHit.object.userData.pathId;
                hoverType = "Road";
                this.renderer.highlightPathHover(hoverId);
            } else if (worldHit) {
                hoverId = worldHit.faceIndex;
                hoverType = "Face";
                this.renderer.highlightFaceHover(hoverId);
            }
        }

        if (this.selectedSourceId !== null) {
            this.renderer.highlightConnectedPaths(this.selectedSourceId);
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
                this.handlePathClick(pathHit.object.userData);
            } else if (worldHit) {
                this.handleFaceClick(worldHit.faceIndex);
            }
        } else {
            this.deselect();
        }
    }

    handleFortressClick(id) {
        const fort = this.client.getFortress(id);
        if (!fort) return;

        if (this.selectedSourceId === null) {
            if (fort.owner === this.client.username) {
                this.selectedSourceId = id;
                this.ui.showFortressInfo(fort);
                this.ui.highlightSelection(id, true);
                this.renderer.highlightConnectedPaths(id);
            }
        } else {
            if (this.selectedSourceId === id) {
                this.deselect();
            } else {
                // Check if target is a neighbor to allow clicking fortress to attack
                const neighbors = this.client.gameState.adj[this.selectedSourceId] || [];
                if (neighbors.includes(parseInt(id))) {
                    this.client.sendMove(this.selectedSourceId, id);
                }
                this.ui.showFortressInfo(fort);
            }
        }
    }

    handlePathClick(pathData) {
        const { sourceId, targetId } = pathData;

        // Toggle path: If selected source matches either side of road
        if (this.selectedSourceId !== null) {
            if (sourceId == this.selectedSourceId) {
                this.client.sendMove(this.selectedSourceId, targetId);
            } else if (targetId == this.selectedSourceId) {
                this.client.sendMove(this.selectedSourceId, sourceId);
            }
        } else {
            this.ui.showPathInfo(sourceId, targetId);
        }
    }

    handleFaceClick(faceIdx) {
        this.ui.showFaceInfo(faceIdx);
        this.renderer.highlightFaceSelection(faceIdx);
    }

    updateMouseCoords(event) {
        this.mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
        this.mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
    }

    deselect() {
        if (this.selectedSourceId !== null) {
            this.ui.highlightSelection(this.selectedSourceId, false);
            this.selectedSourceId = null;
        }
        this.renderer.clearSelectionHighlights();
        this.renderer.clearHoverHighlight();
        this.ui.hideInfo();
    }
}