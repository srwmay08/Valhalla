export class UIManager {
    constructor(gameClient) {
        this.infoPanel = document.getElementById('game-ui');
        this.client = gameClient;
        this.initMonitor();
    }

    initMonitor() {
        // Create small overlay for ID monitoring
        this.monitor = document.createElement('div');
        this.monitor.style = "position:absolute; bottom:10px; right:10px; background:rgba(0,0,0,0.7); color:white; padding:5px; font-family:monospace; pointer-events:none; font-size:12px;";
        document.body.appendChild(this.monitor);
    }

    updateHoverMonitor(type, id) {
        this.monitor.innerHTML = `TYPE: ${type}<br>ID: ${id}`;
    }

    showFaceInfo(faceIdx) {
        if (!this.infoPanel) return;
        this.infoPanel.style.display = 'block';
        document.getElementById('ui-land').innerText = "Province Area";
        document.getElementById('ui-type').innerText = "Land Face";
        document.getElementById('ui-owner').innerText = this.client.gameState.sector_owners?.[faceIdx] || "Wilderness";
        document.getElementById('ui-units').innerText = "---";
        document.getElementById('ui-tier').innerText = "---";
        document.getElementById('ui-special').innerText = "Sector ID: " + faceIdx;
        
        document.getElementById('action-area').style.display = 'none';
        if (document.getElementById('spec-container')) document.getElementById('spec-container').innerHTML = '';
    }

    showPathInfo(source, target) {
        if (!this.infoPanel) return;
        this.infoPanel.style.display = 'block';
        document.getElementById('ui-land').innerText = "Supply Line";
        document.getElementById('ui-type').innerText = "Active Road";
        document.getElementById('ui-owner').innerText = `From Node ${source} to ${target}`;
        document.getElementById('ui-units').innerText = "Flowing";
        document.getElementById('ui-tier').innerText = "N/A";
        document.getElementById('ui-special').innerText = "Pathing Active";
        
        document.getElementById('action-area').style.display = 'none';
        if (document.getElementById('spec-container')) document.getElementById('spec-container').innerHTML = '';
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
        
        const actionArea = document.getElementById('action-area');
        if (actionArea) actionArea.style.display = 'block';

        let specContainer = document.getElementById('spec-container');
        if (!specContainer) {
            specContainer = document.createElement('div');
            specContainer.id = 'spec-container';
            specContainer.style.marginTop = '10px';
            specContainer.className = 'stat-row';
            document.getElementById('slider-container').parentNode.insertBefore(specContainer, document.getElementById('slider-container'));
        }

        if (fort.owner === this.client.username) {
            let html = `<label class="stat-label">Build:</label> <select id="spec-select" style="background:#333;color:#fff;border:1px solid #555;">`;
            this.client.getValidStructures(fort.land_type || 'Default').forEach(opt => {
                html += `<option value="${opt}" ${opt === fort.type ? 'selected' : ''}>${opt}</option>`;
            });
            html += `</select>`;
            specContainer.innerHTML = html;
            document.getElementById('spec-select').onchange = (e) => this.client.specializeFortress(fort.id, e.target.value);
        } else {
            specContainer.innerHTML = '';
        }
    }

    hideInfo() {
        if (this.infoPanel) this.infoPanel.style.display = 'none';
    }

    highlightSelection(id, isActive) {
        const btn = document.getElementById('btn-action');
        if (btn) {
            btn.innerText = isActive ? "SELECT TARGET" : "SELECT SOURCE";
            btn.style.background = isActive ? "#28a745" : "#007bff";
        }
    }
}