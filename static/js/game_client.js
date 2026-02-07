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
            fortress_types: {}
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
                    
                    // FIX: Always initialize the world immediately so it's visible
                    if (this.callbacks.onInit) {
                        console.log("[CLIENT] Initializing Renderer...");
                        this.callbacks.onInit(data);
                    }
                    
                    // Handle the UI lock/countdown separately
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
                this.callbacks.onColorUpdate(colors);
            }
        });
        
        this.socket.on('focus_camera', (data) => {
             if (this.callbacks.onFocus) {
                this.callbacks.onFocus(data.position);
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