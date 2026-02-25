export class UIManager {
    constructor() {
        this.client = null;
        this.hoverMonitor = document.createElement('div');
        this.hoverMonitor.style.position = 'absolute';
        this.hoverMonitor.style.bottom = '20px';
        this.hoverMonitor.style.left = '20px';
        this.hoverMonitor.style.background = 'rgba(0,0,0,0.85)';
        this.hoverMonitor.style.color = '#fff';
        this.hoverMonitor.style.padding = '12px';
        this.hoverMonitor.style.border = '1px solid #ffcc00';
        this.hoverMonitor.style.fontFamily = 'monospace';
        this.hoverMonitor.style.pointerEvents = 'none';
        this.hoverMonitor.innerHTML = 'SYSTEM IDLE';
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

    updateHoverMonitor(type, id, data) {
        let content = `<b style="color:#ffcc00">${type.toUpperCase()} [ID:${id}]</b><br/>`;
        if (data.owner) content += `OWNER: ${data.owner}<br/>`;
        if (data.units !== undefined) content += `UNITS: ${data.units}<br/>`;
        if (data.terrain) content += `LAND: ${data.terrain}<br/>`;
        if (data.source !== undefined) content += `PATH: ${data.source} -> ${data.target}<br/>`;
        this.hoverMonitor.innerHTML = content;
    }

    showFortressInfo(fort) {
        this.infoPanel.style.display = 'block';
        this.uiLand.innerText = `FORTRESS VTX-${fort.id}`;
        this.uiType.innerText = fort.type;
        this.uiOwner.innerText = fort.owner || "NEUTRAL";
        this.uiUnits.innerText = Math.floor(fort.units);
        this.uiTier.innerText = fort.tier;

        if (fort.owner === this.client.username) {
            this.actionArea.style.display = 'block';
            this.updateSpecOptions(fort);
        } else {
            this.actionArea.style.display = 'none';
        }
    }

    showFaceInfo(faceIdx, terrain, owner) {
        this.infoPanel.style.display = 'block';
        this.uiLand.innerText = `SECTOR SEC-${faceIdx}`;
        this.uiType.innerText = `LAND: ${terrain}`;
        this.uiOwner.innerText = owner || "UNCLAIMED";
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
            btn.style.margin = '4px';
            btn.style.padding = '8px';
            btn.style.background = (fort.type === opt) ? '#555' : '#222';
            btn.style.color = '#fff';
            btn.style.border = (fort.type === opt) ? '1px solid gold' : '1px solid #444';
            btn.onclick = () => this.client.specializeFortress(fort.id, opt);
            this.specContainer.appendChild(btn);
        });
    }

    highlightSelection(id, isActive) {
        if (isActive) {
            this.btnAction.innerText = "SOURCE ACTIVE";
            this.btnAction.style.background = "#006600";
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
        overlay.style.top = '0'; overlay.style.left = '0';
        overlay.style.width = '100vw'; overlay.style.height = '100vh';
        overlay.style.background = 'rgba(0,0,0,0.9)';
        overlay.style.display = 'flex'; overlay.style.justifyContent = 'center'; overlay.style.alignItems = 'center';
        overlay.style.fontSize = '120px'; overlay.style.color = '#ffcc00'; overlay.style.zIndex = '1000';
        document.body.appendChild(overlay);

        let count = 3;
        overlay.innerText = count;
        const timer = setInterval(() => {
            count--;
            if (count > 0) {
                overlay.innerText = count;
            } else {
                overlay.innerText = "BEGIN";
                setTimeout(() => {
                    document.body.removeChild(overlay);
                    callback();
                }, 400);
                clearInterval(timer);
            }
        }, 1000);
    }
}