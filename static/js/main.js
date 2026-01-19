import { GameRenderer } from './renderer.js';
import { GameClient } from './game_client.js';
import { InputHandler } from './input_handler.js';
import { UIManager } from './ui_manager.js';

document.addEventListener('DOMContentLoaded', () => {
    
    // 1. Setup UI
    const ui = new UIManager();

    // 2. Setup Renderer
    const renderer = new GameRenderer('game-container');

    // 3. Setup Game Client with callbacks to Renderer/UI
    const client = new GameClient({
        onInit: (data) => {
            renderer.initWorld(data.vertices, data.faces, data.face_colors);
            renderer.updateFortresses(data.fortresses, client.username);
        },
        onMapUpdate: (fortresses) => {
            renderer.updateFortresses(fortresses, client.username);
            
            // Also update UI if a fortress is currently selected
            // (A more advanced event system would be better here, but this works)
            const input = window.gameInput; // Hacky access to input instance
            if (input && input.selectedSourceId) {
                const fort = fortresses[input.selectedSourceId];
                ui.showFortressInfo(fort);
            }
        },
        onColorUpdate: (colors) => {
            renderer.updateFaceColors(colors);
        },
        onFocus: (pos) => {
            renderer.focusCamera(pos);
        }
    });

    // 4. Setup Input
    // We attach it to window so we can access it inside callbacks if needed (see above)
    const input = new InputHandler(renderer, client, ui);
    window.gameInput = input;

    // 5. Restart Button Logic
    document.getElementById('restart-btn').addEventListener('click', () => {
        client.restartGame();
    });

    // 6. Animation Loop
    function animate() {
        requestAnimationFrame(animate);
        renderer.render();
    }
    animate();
});