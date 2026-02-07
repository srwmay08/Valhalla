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

        if (intersects.length > 0) {
            const fortHit = intersects.find(h => h.object.parent && h.object.parent.userData?.type === 'fortress');
            const pathHit = intersects.find(h => h.object.userData?.type === 'path');
            const worldHit = intersects.find(h => h.object.userData?.type === 'world');

            this.renderer.clearHoverHighlight();

            // Re-apply static selection highlights if a source is active
            if (this.selectedSourceId !== null) {
                this.renderer.highlightConnectedPaths(this.selectedSourceId, 0xffffff);
            }

            if (fortHit) {
                hoverId = fortHit.object.parent.userData.id;
                hoverType = "Fortress";
                this.renderer.highlightFortressHover(hoverId);
                
                if (this.selectedSourceId !== null && this.selectedSourceId !== hoverId) {
                    this.checkAndHighlightValidPath(this.selectedSourceId, hoverId);
                }
            } else if (pathHit) {
                hoverId = pathHit.object.userData.pathId;
                hoverType = "Road";
                const { sourceId, targetId } = pathHit.object.userData;
                
                if (this.selectedSourceId !== null && sourceId == this.selectedSourceId) {
                    this.checkAndHighlightValidPath(sourceId, targetId);
                } else {
                    this.renderer.highlightPathHover(hoverId, 0xffffff);
                }
            } else if (worldHit) {
                hoverId = worldHit.faceIndex;
                hoverType = "Face";
                this.renderer.highlightFaceHover(hoverId);
            }
        } else {
            this.renderer.clearHoverHighlight();
            if (this.selectedSourceId !== null) {
                this.renderer.highlightConnectedPaths(this.selectedSourceId, 0xffffff);
            }
        }

        this.ui.updateHoverMonitor(hoverType, hoverId);
    }

    checkAndHighlightValidPath(sourceId, targetId) {
        const sourceFort = this.client.getFortress(sourceId);
        const targetFort = this.client.getFortress(targetId);
        
        if (!sourceFort || !targetFort) return;

        // Condition: Tier sufficient and path exists
        // (Assuming tier 1 can attack/support tier 1-2, etc. adjust based on your balance)
        const canReach = sourceFort.paths && sourceFort.paths.includes(parseInt(targetId));
        const tierRequirement = targetFort.tier <= sourceFort.tier + 1; 

        if (canReach && tierRequirement) {
            const teamColor = this.getTeamColorHex(sourceFort.owner);
            this.renderer.highlightPathHover(`path_${sourceId}_${targetId}`, teamColor);
        }
    }

    getTeamColorHex(owner) {
        if (owner === this.client.username) return 0xff0000;
        if (owner.includes('Gorgon') || owner.includes('Green')) return 0x00ff00;
        if (owner.includes('Yellow')) return 0xffff00;
        return 0x0000ff;
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
        this.renderer.clearSelectionHighlights();

        if (this.selectedSourceId === null) {
            if (fort.owner === this.client.username) {
                this.selectedSourceId = id;
                this.ui.highlightSelection(id, true);
                this.renderer.highlightConnectedPaths(id, 0xffffff);
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
        this.renderer.clearHoverHighlight();
        this.ui.hideInfo();
    }
}