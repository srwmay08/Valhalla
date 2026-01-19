import * as THREE from 'https://cdn.skypack.dev/three@0.136.0';

export class InputHandler {
    constructor(renderer, gameClient, uiManager) {
        this.renderer = renderer; // Need access to camera and scene
        this.client = gameClient;
        this.ui = uiManager;
        
        this.raycaster = new THREE.Raycaster();
        this.mouse = new THREE.Vector2();
        
        this.selectedSourceId = null;
        
        this.initListeners();
    }

    initListeners() {
        window.addEventListener('click', (e) => this.onClick(e), false);
    }

    onClick(event) {
        // Calculate mouse position in normalized device coordinates
        this.mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
        this.mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

        this.raycaster.setFromCamera(this.mouse, this.renderer.camera);

        // Get intersections
        const intersects = this.raycaster.intersectObjects(this.renderer.scene.children);

        if (intersects.length > 0) {
            // Find the first object that is a fortress
            const hit = intersects.find(obj => obj.object.userData.type === 'fortress');
            
            if (hit) {
                this.handleFortressClick(hit.object.userData.id);
            } else {
                // Clicked void or terrain -> Deselect
                this.deselect();
            }
        }
    }

    handleFortressClick(id) {
        const fort = this.client.getFortress(id);
        if (!fort) return;

        // UI Update
        this.ui.showFortressInfo(fort);

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
                // Optional: Keep selected to chain commands, or deselect
                // For now, let's keep it selected for rapid expansion
            }
        }
    }

    deselect() {
        if (this.selectedSourceId !== null) {
            this.ui.highlightSelection(this.selectedSourceId, false);
            this.selectedSourceId = null;
        }
        this.ui.hideFortressInfo();
    }
}