import { GameRenderer } from './renderer.js';
import { GameClient } from './game_client.js';
import { InputHandler } from './input_handler.js';
import { UIManager } from './ui_manager.js';

document.addEventListener('DOMContentLoaded', () => {
    
    // 1. Setup UI
    const ui = new UIManager();

    // 2. Setup Renderer
    // CORRECTION: ID matches index.html "game-container"
    const renderer = new GameRenderer('game-container'); 

    // 3. Setup Game Client with callbacks to Renderer/UI
    const client = new GameClient({
        onInit: (data) => {
            renderer.initWorld(data.vertices, data.faces, data.face_colors);
            renderer.updateFortresses(data.fortresses, client.username);
        },
        onMapUpdate: (fortresses) => {
            renderer.updateFortresses(fortresses, client.username);
            
            // Update UI if selection exists
            const input = window.gameInput;
            if (input && input.selectedSourceId !== null) {
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

    // LINK UI TO CLIENT
    ui.setClient(client);

    // 4. Setup Input
    const input = new InputHandler(renderer, client, ui);
    window.gameInput = input;

    // 5. Restart Button Logic
    const restartBtn = document.getElementById('btn-restart');
    if (restartBtn) {
        restartBtn.addEventListener('click', () => {
            client.restartGame();
        });
    }

    // 6. Animation Loop
    function animate() {
        requestAnimationFrame(animate);
        renderer.render();
    }
    animate();
});