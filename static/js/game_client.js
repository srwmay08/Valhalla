export class GameClient {
    constructor(callbacks) {
        console.log("[CLIENT DEBUG] Initializing Socket.IO...");
        this.socket = io();
        this.callbacks = callbacks;
        this.isLocked = true;
        
        // State management for race condition prevention
        this.isStateLoaded = false;
        this.eventQueue = [];
        
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
                    this.isStateLoaded = true;
                    
                    if (this.callbacks.onInit) {
                        console.log("[CLIENT DEBUG] Triggering Renderer Initialization...");
                        this.callbacks.onInit(data);
                    }
                    
                    // Flush any socket events that arrived while downloading the world state
                    if (this.eventQueue.length > 0) {
                        console.log(`[CLIENT DEBUG] Flushing ${this.eventQueue.length} queued events...`);
                        this.eventQueue.forEach(event => {
                            if (event.type === 'update_map') {
                                this.handleUpdateMap(event.payload);
                            } else if (event.type === 'update_face_colors') {
                                this.handleUpdateFaceColors(event.payload);
                            } else if (event.type === 'focus_camera') {
                                this.handleFocusCamera(event.payload);
                            }
                        });
                        this.eventQueue = [];
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
            if (!this.isStateLoaded) {
                this.eventQueue.push({ type: 'update_map', payload: fortresses });
                return;
            }
            this.handleUpdateMap(fortresses);
        });

        this.socket.on('update_face_colors', (payload) => {
            if (!this.isStateLoaded) {
                this.eventQueue.push({ type: 'update_face_colors', payload: payload });
                return;
            }
            this.handleUpdateFaceColors(payload);
        });
        
        this.socket.on('focus_camera', (data) => {
            if (!this.isStateLoaded) {
                this.eventQueue.push({ type: 'focus_camera', payload: data });
                return;
            }
            this.handleFocusCamera(data);
        });
    }

    handleUpdateMap(fortresses) {
        if (Math.random() < 0.1) console.log("[CLIENT DEBUG] update_map processed.");
        this.gameState.fortresses = fortresses;
        if (this.callbacks.onMapUpdate) {
            this.callbacks.onMapUpdate(fortresses);
        }
        document.dispatchEvent(new CustomEvent('uiRefreshRequired'));
    }

    handleUpdateFaceColors(payload) {
        console.log("[CLIENT DEBUG] update_face_colors processed.");
        let colors = payload;
        if (payload && payload.colors) {
            colors = payload.colors;
            this.gameState.sector_owners = payload.owners;
        }
        
        if (this.callbacks.onColorUpdate) {
            this.callbacks.onColorUpdate(colors, this.gameState.sector_owners, this.username);
        }
        document.dispatchEvent(new CustomEvent('uiRefreshRequired'));
    }

    handleFocusCamera(data) {
        console.log("[CLIENT DEBUG] focus_camera command processed for pos:", data.position);
        if (this.callbacks.onFocus) {
            this.callbacks.onFocus(data.position);
        }
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