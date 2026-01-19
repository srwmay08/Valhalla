export class UIManager {
    constructor() {
        this.infoPanel = document.getElementById('fortress-info'); // Assume this exists in HTML
        this.infoContent = document.getElementById('info-content'); 
    }

    showFortressInfo(fort) {
        if (!this.infoPanel) return;
        
        this.infoPanel.style.display = 'block';
        let html = `
            <strong>ID:</strong> ${fort.id}<br>
            <strong>Owner:</strong> ${fort.owner || 'Neutral'}<br>
            <strong>Units:</strong> ${Math.floor(fort.units)}<br>
            <strong>Type:</strong> ${fort.type}<br>
            <strong>Tier:</strong> ${fort.tier}
        `;
        
        if (fort.special_active) {
            html += `<br><span style="color:gold">★ Bonus Active</span>`;
        }
        
        this.infoContent.innerHTML = html;
    }

    hideFortressInfo() {
        if (this.infoPanel) this.infoPanel.style.display = 'none';
    }

    highlightSelection(id, isActive) {
        // In a complex UI, this might add a glowing ring or CSS class
        // For now, we can just log it or handle 3D highlighting via Renderer if we linked them
        console.log(`UI Highlight ${id}: ${isActive}`);
    }
}