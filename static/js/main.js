import { GameClient } from './game_client.js';
import { GameRenderer } from './renderer.js';
import { InputHandler } from './input_handler.js';
import { UIManager } from './ui_manager.js';

document.addEventListener('DOMContentLoaded', () => {
    console.log("[MAIN] DOM Loaded. Initializing Engine...");

    const ui = new UIManager();
    
    const renderer = new GameRenderer('game-container');

    const client = new GameClient({
        onInit: (data) => renderer.initWorld(data.vertices, data.faces, data.face_colors),
        onMapUpdate: (forts) => renderer.updateFortresses(forts, client.username),
        onColorUpdate: (colors) => renderer.updateFaceColors(colors),
        onFocus: (pos) => renderer.focusCamera(pos),
        onStartSequence: (callback) => ui.startCountdown(callback)
    });

    ui.setClient(client);
    const input = new InputHandler(renderer, client, ui);

    console.log("[MAIN] Systems Online.");
});