export class GameClient {
    constructor(callbacks) {
        this.socket = io();
        this.callbacks = callbacks;
        this.isLocked = true;
        
        const usernameElement = document.getElementById('username-store');
        this.username = usernameElement ? usernameElement.innerText : 'Anonymous'; 
        
        this.gameState = {
            fortresses: {},
            vertices: [],
            faces: [],
            terrain_build_options: {}, 
            fortress_types: {},
            sector_owners: {}
        };

        this.initSocket();
    }

    initSocket() {
        this.socket.on('connect', () => {
            console.log("[CLIENT] Connected. Fetching GameState...");
            fetch('/api/gamestate')
                .then(r => {
                    if (!r.ok) throw new Error("API Error: " + r.statusText);
                    return r.json();
                })
                .then(data => {
                    this.gameState = data;
                    
                    if (this.callbacks.onInit) {
                        console.log("[CLIENT] Initializing Renderer...");
                        this.callbacks.onInit(data);
                    }
                    
                    if (this.callbacks.onStartSequence) {
                        this.callbacks.onStartSequence(() => {
                            console.log("[CLIENT] Game Unlocked");
                            this.isLocked = false;
                        });
                    } else {
                        this.isLocked = false;
                    }
                })
                .catch(err => console.error("Failed to load game state:", err));
        });

        this.socket.on('update_map', (fortresses) => {
            this.gameState.fortresses = fortresses;
            if (this.callbacks.onMapUpdate) {
                this.callbacks.onMapUpdate(fortresses);
            }
        });

        this.socket.on('update_face_colors', (colors) => {
            if (this.callbacks.onColorUpdate) {
                this.callbacks.onColorUpdate(colors, this.gameState.sector_owners, this.username);
            }
        });
        
        this.socket.on('focus_camera', (data) => {
             if (this.callbacks.onFocus) {
                this.callbacks.onFocus(data.position);
             }
        });

        this.socket.on('update_sector_ownership', (owners) => {
            this.gameState.sector_owners = owners;
            if (this.callbacks.onColorUpdate) {
                this.callbacks.onColorUpdate(this.gameState.face_colors, owners, this.username);
            }
        });
    }

    getFortress(id) {
        return this.gameState.fortresses[id];
    }
    
    getValidStructures(terrainType) {
        const options = this.gameState.terrain_build_options;
        if (!options) return ["Keep"];
        return options[terrainType] || options["Default"] || ["Keep"];
    }

    specializeFortress(id, typeName) {
        if (this.isLocked) return;
        this.socket.emit('specialize_fortress', { id: id, type: typeName });
    }

    sendMove(sourceId, targetId) {
        if (this.isLocked) return;
        this.socket.emit('submit_move', { source: sourceId, target: targetId });
    }
    
    restartGame() {
        this.socket.emit('restart_game');
    }
}