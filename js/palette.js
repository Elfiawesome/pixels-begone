// Palette panel: renders a vertical swatch strip beside a canvas, with hover
// highlighting (dims non-matching pixels on an overlay) and click-to-copy hex.
//
// The strip is drawn to its own canvas so "no cap" scales (AI art can have tens
// of thousands of colors). Mouse Y is hit-tested against the swatch layout.
//
// Each PalettePanel binds to:
//   - imageCanvas: the <canvas> showing the image
//   - stripCanvas: the <canvas> rendering the swatches
//   - overlay: an absolutely-positioned <canvas> stacked over the image
//   - toast: a shared toast element for copy feedback

export class PalettePanel {
    constructor({ imageCanvas, stripCanvas, overlay, toast, countEl, getSort }) {
        this.imageCanvas = imageCanvas;
        this.stripCanvas = stripCanvas;
        this.overlay = overlay;
        this.toast = toast;
        this.countEl = countEl;
        this.getSort = getSort;
        this.colors = [];     // [{r,g,b,key,count,hex}] sorted
        this.layout = [];     // [{y0, y1, color}] for hit-testing
        this.imageData = null;
        this.swatchH = 14;
        this._active = false;
        this._bind();
    }

    setImage(imageData) {
        this.imageData = imageData;
        this.colors = computeColors(imageData);
        this._sort();
        this._renderStrip();
        if (this.countEl) this.countEl.textContent = this.colors.length;
        this._clearOverlay();
    }

    resort() {
        if (!this.imageData) return;
        this._sort();
        this._renderStrip();
    }

    _sort() {
        const mode = this.getSort();
        if (mode === 'freq') {
            this.colors.sort((a, b) => b.count - a.count);
        } else if (mode === 'bright') {
            this.colors.sort((a, b) => luminance(a) - luminance(b));
        } else if (mode === 'hue') {
            this.colors.sort((a, b) => hue(a) - hue(b));
        }
    }

    _renderStrip() {
        const ctx = this.stripCanvas.getContext('2d');
        const n = this.colors.length;
        // Cap the strip canvas height so extremely large palettes don't blow up
        // memory; the panel scrolls. 4096 swatches * 14px is plenty to scroll.
        const maxRows = Math.min(n, 4096);
        const w = 36;
        const h = maxRows * this.swatchH;
        this.stripCanvas.width = w;
        this.stripCanvas.height = Math.max(1, h);
        this.layout = [];
        for (let i = 0; i < maxRows; i++) {
            const c = this.colors[i];
            ctx.fillStyle = c.hex;
            ctx.fillRect(0, i * this.swatchH, w, this.swatchH);
            this.layout.push({ y0: i * this.swatchH, y1: (i + 1) * this.swatchH, color: c });
        }
    }

    _bind() {
        this.stripCanvas.addEventListener('mousemove', (e) => {
            const rect = this.stripCanvas.getBoundingClientRect();
            const y = (e.clientY - rect.top) * (this.stripCanvas.height / rect.height);
            const hit = this.layout.find(l => y >= l.y0 && y < l.y1);
            if (hit) this._highlight(hit.color);
        });
        this.stripCanvas.addEventListener('mouseleave', () => this._clearOverlay());
        this.stripCanvas.addEventListener('click', (e) => {
            const rect = this.stripCanvas.getBoundingClientRect();
            const y = (e.clientY - rect.top) * (this.stripCanvas.height / rect.height);
            const hit = this.layout.find(l => y >= l.y0 && y < l.y1);
            if (hit) this._copy(hit.color);
        });
    }

    _highlight(color) {
        if (!this.imageData) return;
        // Size the overlay to match the image canvas's displayed pixels.
        const w = this.imageData.width;
        const h = this.imageData.height;
        if (this.overlay.width !== w) this.overlay.width = w;
        if (this.overlay.height !== h) this.overlay.height = h;
        const ctx = this.overlay.getContext('2d');
        const src = this.imageData.data;
        const out = ctx.createImageData(w, h);
        const od = out.data;
        const key = color.key;
        for (let i = 0; i < w * h; i++) {
            const a = src[i * 4 + 3];
            if (a < 128) {
                od[i * 4 + 3] = 0;
                continue;
            }
            const pk = (src[i * 4] << 16) | (src[i * 4 + 1] << 8) | src[i * 4 + 2];
            if (pk === key) {
                // Keep the matching pixel at full brightness.
                od[i * 4] = src[i * 4];
                od[i * 4 + 1] = src[i * 4 + 1];
                od[i * 4 + 2] = src[i * 4 + 2];
                od[i * 4 + 3] = 255;
            } else {
                // Dim non-matching pixels to ~20% brightness, neutral gray.
                const lum = (src[i * 4] * 0.299 + src[i * 4 + 1] * 0.587 + src[i * 4 + 2] * 0.114) * 0.2;
                od[i * 4] = lum;
                od[i * 4 + 1] = lum;
                od[i * 4 + 2] = lum;
                od[i * 4 + 3] = 255;
            }
        }
        ctx.putImageData(out, 0, 0);
        this.overlay.classList.add('visible');
    }

    _clearOverlay() {
        const ctx = this.overlay.getContext('2d');
        ctx.clearRect(0, 0, this.overlay.width, this.overlay.height);
        this.overlay.classList.remove('visible');
    }

    _copy(color) {
        const hex = color.hex;
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(hex).then(() => this._toast('Copied ' + hex), () => this._toast(hex));
        } else {
            this._toast(hex);
        }
    }

    _toast(msg) {
        if (!this.toast) return;
        this.toast.textContent = msg;
        this.toast.classList.add('visible');
        clearTimeout(this._toastTimer);
        this._toastTimer = setTimeout(() => this.toast.classList.remove('visible'), 1100);
    }
}

// Count distinct opaque colors and their frequencies.
function computeColors(imageData) {
    const data = imageData.data;
    const map = new Map();
    for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] < 128) continue;
        const r = data[i], g = data[i + 1], b = data[i + 2];
        const key = (r << 16) | (g << 8) | b;
        let e = map.get(key);
        if (!e) {
            e = { r, g, b, key, count: 0, hex: toHex(r, g, b) };
            map.set(key, e);
        }
        e.count++;
    }
    return Array.from(map.values());
}

function toHex(r, g, b) {
    const h = v => v.toString(16).padStart(2, '0');
    return '#' + h(r) + h(g) + h(b);
}

function luminance(c) {
    return 0.299 * c.r + 0.587 * c.g + 0.114 * c.b;
}

function hue(c) {
    const r = c.r / 255, g = c.g / 255, b = c.b / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    if (max === min) return 0;
    const d = max - min;
    let h;
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    return h * 60;
}
