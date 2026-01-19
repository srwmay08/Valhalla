export class GameClient {
    constructor(callbacks) {
        // callbacks: { onInit, onMapUpdate, onColorUpdate, onFocus }
        this.socket = io();
        this.callbacks = callbacks;
        
        this.username = document.getElementById('username').innerText; 
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
            console.log("Connected via Socket.IO");
            // Request initial state
            fetch('/api/gamestate')
                .then(r => {
                    if (!r.ok) throw new Error("API Error: " + r.statusText);
                    return r.json();
                })
                .then(data => {
                    this.gameState = data;
                    if (this.callbacks.onInit) this.callbacks.onInit(data);
                })
                .catch(err => console.error("Failed to load game state:", err));
        });

        this.socket.on('update_map', (fortresses) => {
            this.gameState.fortresses = fortresses;
            if (this.callbacks.onMapUpdate) this.callbacks.onMapUpdate(fortresses);
        });

        this.socket.on('update_face_colors', (colors) => {
            if (this.callbacks.onColorUpdate) this.callbacks.onColorUpdate(colors);
        });
        
        this.socket.on('focus_camera', (data) => {
             if (this.callbacks.onFocus) this.callbacks.onFocus(data.position);
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
        this.socket.emit('specialize_fortress', { id: id, type: typeName });
    }

    sendMove(sourceId, targetId) {
        this.socket.emit('submit_move', { source: sourceId, target: targetId });
    }
    
    restartGame() {
        this.socket.emit('restart_game');
    }
}