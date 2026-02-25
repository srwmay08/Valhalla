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
        let hoverId = "None", hoverType = "Background";
        this.renderer.clearHoverHighlight();
        if (intersects.length > 0) {
            const fortHit = intersects.find(h => h.object.parent && h.object.parent.userData?.type === 'fortress');
            const pathHit = intersects.find(h => h.object.userData?.type === 'path');
            const worldHit = intersects.find(h => h.object.userData?.type === 'world');
            if (fortHit) {
                hoverId = fortHit.object.parent.userData.id; hoverType = "Fortress";
                this.renderer.highlightFortressHover(hoverId);
            } else if (pathHit) {
                hoverId = pathHit.object.userData.pathId; hoverType = "Road";
                this.renderer.highlightPathHover(hoverId, 0xffffff);
            } else if (worldHit) {
                hoverId = worldHit.faceIndex; hoverType = "Face";
                this.renderer.highlightFaceHover(hoverId);
            }
        }
        if (this.selectedSourceId !== null) this.renderer.highlightConnectedPaths(this.selectedSourceId, 0xffffff);
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
            if (fortHit) this.handleFortressClick(fortHit.object.parent.userData.id);
            else if (pathHit) this.handlePathClick(pathHit.object.userData);
            else if (worldHit) this.handleFaceClick(worldHit.faceIndex);
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
                this.renderer.highlightConnectedPaths(id, 0xffffff);
            }
        } else {
            if (this.selectedSourceId === id) this.deselect();
            else this.ui.showFortressInfo(fort);
        }
    }

    handlePathClick(pathData) {
        const { sourceId, targetId } = pathData;
        if (this.selectedSourceId !== null && (sourceId == this.selectedSourceId || targetId == this.selectedSourceId)) {
            const finalTarget = (sourceId == this.selectedSourceId) ? targetId : sourceId;
            this.client.sendMove(this.selectedSourceId, finalTarget);
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
        if (this.selectedSourceId !== null) { this.ui.highlightSelection(this.selectedSourceId, false); this.selectedSourceId = null; }
        this.renderer.clearSelectionHighlights(); this.renderer.clearHoverHighlight(); this.ui.hideInfo();
    }
}