export class UIManager {
    constructor() {
        this.client = null;
        this.hoverMonitor = document.createElement('div');
        this.hoverMonitor.style.position = 'absolute';
        this.hoverMonitor.style.bottom = '20px';
        this.hoverMonitor.style.left = '20px';
        this.hoverMonitor.style.background = 'rgba(0,0,0,0.8)';
        this.hoverMonitor.style.color = '#fff';
        this.hoverMonitor.style.padding = '10px';
        this.hoverMonitor.style.border = '1px solid #444';
        this.hoverMonitor.innerHTML = 'Hover: None';
        document.body.appendChild(this.hoverMonitor);

        this.infoPanel = document.getElementById('game-ui');
        this.uiLand = document.getElementById('ui-land');
        this.uiType = document.getElementById('ui-type');
        this.uiOwner = document.getElementById('ui-owner');
        this.uiUnits = document.getElementById('ui-units');
        this.uiTier = document.getElementById('ui-tier');
        this.actionArea = document.getElementById('action-area');
        this.specContainer = document.getElementById('spec-container');
        this.btnAction = document.getElementById('btn-action');
    }

    setClient(client) {
        this.client = client;
    }

    updateHoverMonitor(type, id) {
        this.hoverMonitor.innerHTML = `Type: ${type} | ID: ${id}`;
    }

    showFortressInfo(fort) {
        this.infoPanel.style.display = 'block';
        this.uiLand.innerText = `Fortress #${fort.id}`;
        this.uiType.innerText = fort.type;
        this.uiOwner.innerText = fort.owner || "Neutral";
        this.uiUnits.innerText = Math.floor(fort.units);
        this.uiTier.innerText = fort.tier;

        if (fort.owner === this.client.username) {
            this.actionArea.style.display = 'block';
            this.updateSpecOptions(fort);
        } else {
            this.actionArea.style.display = 'none';
        }
    }

    showFaceInfo(faceIdx) {
        this.infoPanel.style.display = 'block';
        this.uiLand.innerText = `Sector #${faceIdx}`;
        this.uiType.innerText = "Terrain";
        this.uiOwner.innerText = "Neutral";
        this.uiUnits.innerText = "N/A";
        this.uiTier.innerText = "N/A";
        this.actionArea.style.display = 'none';
    }

    showPathInfo(u, v) {
        this.infoPanel.style.display = 'block';
        this.uiLand.innerText = `Road ${u} ↔ ${v}`;
        this.uiType.innerText = "Path";
        this.uiOwner.innerText = "Contested";
        this.uiUnits.innerText = "N/A";
        this.uiTier.innerText = "N/A";
        this.actionArea.style.display = 'none';
    }

    updateSpecOptions(fort) {
        this.specContainer.innerHTML = '';
        const options = this.client.getValidStructures(fort.land_type);
        options.forEach(opt => {
            const btn = document.createElement('button');
            btn.innerText = opt;
            btn.style.margin = '2px';
            btn.onclick = () => this.client.specializeFortress(fort.id, opt);
            if (fort.type === opt) btn.style.border = '2px solid gold';
            this.specContainer.appendChild(btn);
        });
    }

    highlightSelection(id, isActive) {
        if (isActive) {
            this.btnAction.innerText = "SOURCE SELECTED";
            this.btnAction.style.background = "#28a745";
        } else {
            this.btnAction.innerText = "SELECT SOURCE";
            this.btnAction.style.background = "#007bff";
        }
    }

    hideInfo() {
        this.infoPanel.style.display = 'none';
    }

    startCountdown(callback) {
        const overlay = document.createElement('div');
        overlay.style.position = 'fixed';
        overlay.style.top = '0';
        overlay.style.left = '0';
        overlay.style.width = '100vw';
        overlay.style.height = '100vh';
        overlay.style.background = 'rgba(0,0,0,0.9)';
        overlay.style.display = 'flex';
        overlay.style.justifyContent = 'center';
        overlay.style.alignItems = 'center';
        overlay.style.fontSize = '100px';
        overlay.style.color = '#fff';
        overlay.style.zIndex = '1000';
        document.body.appendChild(overlay);

        let count = 3;
        overlay.innerText = count;
        const timer = setInterval(() => {
            count--;
            if (count > 0) {
                overlay.innerText = count;
            } else {
                overlay.innerText = "BATTLE!";
                setTimeout(() => {
                    document.body.removeChild(overlay);
                    callback();
                }, 500);
                clearInterval(timer);
            }
        }, 1000);
    }
}