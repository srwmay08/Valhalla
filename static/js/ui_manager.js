export class UIManager {
    constructor(gameClient) {
        this.infoPanel = document.getElementById('game-ui');
        this.client = gameClient;
        this.initMonitor();
    }

    setClient(client) {
        this.client = client;
    }

    initMonitor() {
        this.monitor = document.createElement('div');
        this.monitor.id = "hover-monitor";
        this.monitor.style = "position:absolute; bottom:20px; right:20px; background:rgba(0,0,0,0.8); color:#00ff00; padding:10px; font-family:monospace; pointer-events:none; font-size:14px; border:1px solid #00ff00; border-radius:4px; z-index:1000;";
        document.body.appendChild(this.monitor);
    }

    startCountdown(unlockCallback) {
        let count = 3;
        const overlay = document.createElement('div');
        overlay.style = "position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.5); display:flex; justify-content:center; align-items:center; z-index:2000; color:#00ff00; font-family:monospace; font-size:120px; text-shadow: 0 0 20px #00ff00;";
        document.body.appendChild(overlay);

        const timer = setInterval(() => {
            if (count > 0) {
                overlay.innerText = count;
                count--;
            } else if (count === 0) {
                overlay.innerText = "DOMINATE";
                count--;
            } else {
                clearInterval(timer);
                document.body.removeChild(overlay);
                unlockCallback(); 
            }
        }, 1000);
    }

    updateHoverMonitor(type, id) {
        this.monitor.innerHTML = `[TARGETING SYSTEM]<br>TYPE: ${type}<br>IDENT: ${id}`;
    }

    showFaceInfo(faceIdx) {
        if (!this.infoPanel) return;
        this.infoPanel.style.display = 'block';
        const owner = this.client.gameState.sector_owners?.[faceIdx] || "Unclaimed";

        document.getElementById('ui-land').innerText = "Province Face";
        document.getElementById('ui-type').innerText = "Land Geometry";
        document.getElementById('ui-owner').innerText = owner;
        document.getElementById('ui-units').innerText = "N/A";
        document.getElementById('ui-tier').innerText = "N/A";
        document.getElementById('ui-special').innerText = "Face Index: " + faceIdx;
        
        document.getElementById('action-area').style.display = 'none';
    }

    showPathInfo(source, target) {
        if (!this.infoPanel) return;
        this.infoPanel.style.display = 'block';
        
        document.getElementById('ui-land').innerText = "Active Supply Road";
        document.getElementById('ui-type').innerText = "Trade Route";
        document.getElementById('ui-owner').innerText = `Origin: ${source} → Dest: ${target}`;
        document.getElementById('ui-units').innerText = "Continuous Flow";
        document.getElementById('ui-tier').innerText = "Standard";
        document.getElementById('ui-special').innerText = "Pathing ID: " + source + "_" + target;

        document.getElementById('action-area').style.display = 'none';
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
            const slider = document.getElementById('slider-container');
            if (slider && slider.parentNode) {
                slider.parentNode.insertBefore(specContainer, slider);
            }
        }

        if (fort.owner === this.client.username) {
            let html = `<label class="stat-label">Build:</label> <select id="spec-select" style="background:#333;color:#fff;">`;
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