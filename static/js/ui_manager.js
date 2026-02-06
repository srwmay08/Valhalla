export class UIManager {
    constructor(gameClient) {
        this.infoPanel = document.getElementById('game-ui');
        this.client = gameClient;
    }

    setClient(client) {
        this.client = client;
    }

    startCountdown(callback) {
        const overlay = document.createElement('div');
        overlay.id = "start-countdown";
        overlay.style.position = "absolute";
        overlay.style.top = "20%";
        overlay.style.left = "50%";
        overlay.style.transform = "translateX(-50%)";
        overlay.style.fontSize = "120px";
        overlay.style.color = "#ff0000";
        overlay.style.fontFamily = "'Courier New', Courier, monospace";
        overlay.style.fontWeight = "bold";
        overlay.style.zIndex = "1000";
        overlay.style.textShadow = "2px 2px #000";
        document.body.appendChild(overlay);

        let count = 3;
        const timer = setInterval(() => {
            if (count > 0) overlay.innerText = count;
            else if (count === 0) {
                overlay.innerText = "GO!";
                overlay.style.color = "#00ff00";
            } else {
                clearInterval(timer);
                overlay.remove();
                if (callback) callback();
            }
            count--;
        }, 1000);
    }

    showFaceInfo(faceIdx) {
        if (!this.infoPanel) return;
        this.infoPanel.style.display = 'block';
        const terrain = this.client.gameState.face_terrain?.[faceIdx] || 'Wilderness';
        const owner = this.client.gameState.sector_owners?.[faceIdx] || 'Unclaimed';

        document.getElementById('ui-land').innerText = terrain;
        document.getElementById('ui-type').innerText = "Province Face";
        document.getElementById('ui-owner').innerText = owner;
        document.getElementById('ui-units').innerText = "---";
        document.getElementById('ui-tier').innerText = "---";
        document.getElementById('ui-special').innerText = "---";
        
        document.getElementById('action-area').style.display = 'none';
        const spec = document.getElementById('spec-container');
        if (spec) spec.innerHTML = '<i>Area Selection</i>';
    }

    showPathInfo(sourceId, targetId) {
        if (!this.infoPanel) return;
        this.infoPanel.style.display = 'block';
        
        document.getElementById('ui-land').innerText = "Trade Route";
        document.getElementById('ui-type').innerText = "Path";
        document.getElementById('ui-owner').innerText = `From Node ${sourceId} to ${targetId}`;
        document.getElementById('ui-units').innerText = "---";
        document.getElementById('ui-tier').innerText = "---";
        document.getElementById('ui-special').innerText = "---";

        document.getElementById('action-area').style.display = 'none';
        const spec = document.getElementById('spec-container');
        if (spec) spec.innerHTML = '<i>Active Supply Line</i>';
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