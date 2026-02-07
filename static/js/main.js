import { GameClient } from './game_client.js';
import { GameRenderer } from './renderer.js';
import { InputHandler } from './input_handler.js';
import { UIManager } from './ui_manager.js';

let renderer;
let client;
let input;
let ui;

function init() {
    renderer = new GameRenderer('game-container');
    ui = new UIManager();
    
    const callbacks = {
        onInit: (data) => {
            renderer.initWorld(data.vertices, data.faces, data.face_colors);
            renderer.updateFortresses(data.fortresses, client.username);
            
            // "North Pole Camera Lock" Logic 
            // The camera starts at the North Pole. We find the player's home position
            // and trigger a rotation to center it.
            if (data.home_pos) {
                renderer.focusCamera(data.home_pos);
            }
        },
        onMapUpdate: (forts) => {
            renderer.updateFortresses(forts, client.username);
            if (input.selectedId) {
                ui.showFortressInfo(forts[input.selectedId]);
            }
        },
        onColorUpdate: (colors) => {
            renderer.updateFaceColors(colors);
        },
        onFocus: (pos) => {
            renderer.focusCamera(pos);
        },
        onStartSequence: (unlockCallback) => {
            // Trigger the UI countdown which will eventually call unlockCallback
            ui.startCountdown(unlockCallback);
        }
    };

    client = new GameClient(callbacks);
    ui.setClient(client);
    input = new InputHandler(renderer, client, ui);

    animate();
}

function animate() {
    requestAnimationFrame(animate);
    renderer.render();
}

window.onload = init;