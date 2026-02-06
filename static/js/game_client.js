export class GameClient {
    constructor(callbacks) {
        this.socket = io();
        this.callbacks = callbacks;
        this.isLocked = true;
        
        this.username = document.getElementById('username-store').innerText; 
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
            fetch('/api/gamestate')
                .then(r => {
                    if (!r.ok) {
                        throw new Error("API Error: " + r.statusText);
                    }
                    return r.json();
                })
                .then(data => {
                    this.gameState = data;
                    
                    // Critical: Initialize the world visuals immediately when data arrives
                    if (this.callbacks.onInit) {
                        this.callbacks.onInit(data);
                    }
                    
                    // Then handle the start sequence/countdown
                    if (this.callbacks.onStartSequence) {
                        this.callbacks.onStartSequence(() => {
                            console.log("Game Unlocked");
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
        if (!options) {
            return ["Keep"];
        }
        return options[terrainType] || options["Default"] || ["Keep"];
    }

    specializeFortress(id, typeName) {
        if (this.isLocked) {
            return;
        }
        this.socket.emit('specialize_fortress', { id: id, type: typeName });
    }

    sendMove(sourceId, targetId) {
        if (this.isLocked) {
            return;
        }
        this.socket.emit('submit_move', { source: sourceId, target: targetId });
    }
    
    restartGame() {
        this.socket.emit('restart_game');
    }
}