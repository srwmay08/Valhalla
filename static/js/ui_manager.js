export class UIManager {
    constructor(gameClient) {
        this.infoPanel = document.getElementById('game-ui'); // Using the HUD defined in index.html
        this.client = gameClient;
    }

    setClient(client) {
        this.client = client;
    }

    showFortressInfo(fort) {
        if (!this.infoPanel) return;
        
        this.infoPanel.style.display = 'block';
        
        document.getElementById('ui-land').innerText = fort.land_type || 'Unknown';
        document.getElementById('ui-type').innerText = fort.type;
        document.getElementById('ui-owner').innerText = fort.owner || 'Neutral';
        document.getElementById('ui-units').innerText = Math.floor(fort.units);
        document.getElementById('ui-tier').innerText = fort.tier;
        document.getElementById('ui-special').innerText = fort.special_active ? "Active" : "Inactive";
        
        // Dynamic Action Area
        const actionArea = document.getElementById('action-area');
        if (actionArea) actionArea.style.display = 'block';

        // Check if we need to add the specialization dropdown
        let specContainer = document.getElementById('spec-container');
        if (!specContainer) {
            specContainer = document.createElement('div');
            specContainer.id = 'spec-container';
            specContainer.style.marginTop = '10px';
            specContainer.className = 'stat-row';
            // Insert before action area or inside
            const slider = document.getElementById('slider-container');
            slider.parentNode.insertBefore(specContainer, slider);
        }

        if (fort.owner === this.client.username) {
            // Build Dropdown for specialization
            let html = `<label class="stat-label">Build:</label> <select id="spec-select" style="background:#333;color:#fff;border:1px solid #555;">`;
            
            // Get valid options from client (which got them from API)
            const terrain = fort.land_type || 'Default';
            const options = this.client.getValidStructures(terrain);
            
            options.forEach(opt => {
                const selected = (opt === fort.type) ? 'selected' : '';
                html += `<option value="${opt}" ${selected}>${opt}</option>`;
            });
            html += `</select>`;
            specContainer.innerHTML = html;

            // Add Event Listener
            const select = document.getElementById('spec-select');
            select.onchange = (e) => {
                this.client.specializeFortress(fort.id, e.target.value);
            };

        } else {
            specContainer.innerHTML = '';
        }
    }

    hideFortressInfo() {
        // We might not want to hide it completely, just clear data, but based on prev code:
        // this.infoPanel.style.display = 'none'; 
        // Actually, let's keep it visible but maybe clear selection if strictly needed.
        // For now, doing nothing allows the last selected to remain visible, which is common.
    }

    highlightSelection(id, isActive) {
        // Updates UI border or similar if needed
        const btn = document.getElementById('btn-action');
        if (btn) {
            btn.innerText = isActive ? "SELECT TARGET" : "SELECT SOURCE";
            btn.style.background = isActive ? "#28a745" : "#007bff";
        }
    }
}