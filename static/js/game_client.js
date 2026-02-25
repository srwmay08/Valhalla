export class GameClient {
    constructor(callbacks) {
        console.log("[CLIENT DEBUG] Initializing Socket.IO...");
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
            console.log("[CLIENT DEBUG] Socket Connected! SID:", this.socket.id);
            console.log("[CLIENT DEBUG] Fetching GameState from API...");
            
            fetch('/api/gamestate')
                .then(r => {
                    if (!r.ok) {
                        console.error("[CLIENT ERROR] API Response Not OK:", r.status);
                        throw new Error("API Error: " + r.statusText);
                    }
                    return r.json();
                })
                .then(data => {
                    console.log("[CLIENT DEBUG] GameState Data Received. Fortress Count:", Object.keys(data.fortresses).length);
                    this.gameState = data;
                    
                    if (this.callbacks.onInit) {
                        console.log("[CLIENT DEBUG] Triggering Renderer Initialization...");
                        this.callbacks.onInit(data);
                    }
                    
                    if (this.callbacks.onStartSequence) {
                        this.callbacks.onStartSequence(() => {
                            console.log("[CLIENT DEBUG] Game Sequence Complete. UI Unlocked.");
                            this.isLocked = false;
                        });
                    } else {
                        this.isLocked = false;
                    }
                })
                .catch(err => {
                    console.error("[CLIENT ERROR] Fatal Error loading game state:", err);
                });
        });

        this.socket.on('connect_error', (err) => {
            console.error("[CLIENT ERROR] Socket Connection Failed:", err.message);
        });

        this.socket.on('update_map', (fortresses) => {
            // Log every 10th update to avoid flooding but confirm activity
            if (Math.random() < 0.1) console.log("[CLIENT DEBUG] update_map received.");
            this.gameState.fortresses = fortresses;
            if (this.callbacks.onMapUpdate) {
                this.callbacks.onMapUpdate(fortresses);
            }
        });

        this.socket.on('update_face_colors', (colors) => {
            console.log("[CLIENT DEBUG] update_face_colors received.");
            if (this.callbacks.onColorUpdate) {
                this.callbacks.onColorUpdate(colors, this.gameState.sector_owners, this.username);
            }
        });
        
        this.socket.on('focus_camera', (data) => {
             console.log("[CLIENT DEBUG] focus_camera command received for pos:", data.position);
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
        console.log("[CLIENT DEBUG] Requesting Full Game Restart.");
        this.socket.emit('restart_game');
    }
}