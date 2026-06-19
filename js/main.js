// UI wiring: file/drag/paste input, control <-> options mapping (driven by
// config.js), URL hash persistence, worker host, progress + stats display,
// palette panels (hover highlight + click-to-copy), download.
//
// No algorithm logic lives here. Defaults come from DEFAULTS in config.js so the
// starting state can be re-tuned in one place.

import { DEFAULTS, URL_KEYS, KEY_FROM_URL, CONTROLS } from './config.js';
import { countUniqueColors } from './color.js';
import { PalettePanel } from './palette.js';
import { PALETTES } from './palette-snap.js';

const PHASE_LABELS = {
    'segment': 'Segmenting',
    'quantize': 'Quantizing',
    'palette-merge': 'Merging palette',
    'denoise': 'Despeckling',
    'lines': 'Consolidating lines',
    'jaggies': 'Cleaning edges',
    'hue-snap': 'Reducing hue jitter',
    'pillow': 'Removing pillow shading',
    'color-adjust': 'Adjusting colors',
    'color-cap': 'Capping colors',
    'palette-snap': 'Snapping to palette',
    'dither': 'Dithering'
};

const $ = id => document.getElementById(id);
const els = {
    placeholder: $('placeholder'),
    fileInput: $('fileInput'),
    originalCanvas: $('originalCanvas'),
    refinedCanvas: $('refinedCanvas'),
    leftContainer: $('leftContainer'),
    noResult: $('noResult'),
    processBtn: $('processBtn'),
    downloadBtn: $('downloadBtn'),
    statusText: $('statusText'),
    progressFill: $('progressFill'),
    originalStats: $('originalStats'),
    refinedStats: $('refinedStats'),
    origColorCount: $('origColorCount'),
    refColorCount: $('refColorCount'),
    reductionPercent: $('reductionPercent'),
    toast: $('toast'),
    paletteSortSelect: $('paletteSortSelect')
};

// ---- Control system: bind every control from CONTROLS, sync slider<->number,
//      and apply DEFAULTS on load. ----

const controlEls = {}; // key -> { slider?, number?, checkbox?, select?, text? }

for (const c of CONTROLS) {
    const entry = {};
    if (c.kind === 'range') {
        entry.slider = $(c.id);
        entry.number = $(c.numId);
    } else {
        entry.main = $(c.id);
    }
    controlEls[c.key] = entry;
}

function applyDefault(key) {
    const val = DEFAULTS[key];
    const entry = controlEls[key];
    if (!entry) return;
    if (entry.slider) {
        entry.slider.value = val;
        entry.number.value = val;
    } else if (entry.main) {
        if (entry.main.type === 'checkbox') entry.main.checked = val;
        else entry.main.value = val;
    }
}

function readControl(key) {
    const entry = controlEls[key];
    if (!entry) return DEFAULTS[key];
    if (entry.slider) {
        // Prefer the number input (allows exceeding slider range); fall back to
        // the slider if the number field is empty/invalid.
        const n = entry.number.value;
        if (n !== '' && !isNaN(Number(n))) return Number(n);
        return Number(entry.slider.value);
    }
    if (entry.main.type === 'checkbox') return entry.main.checked;
    if (entry.main.tagName === 'SELECT') {
        const v = entry.main.value;
        return typeof DEFAULTS[key] === 'number' ? Number(v) : v;
    }
    return entry.main.value;
}

// Wire slider <-> number sync for every range control, plus change listeners
// that update the URL hash (debounced).
let urlTimer = null;
function scheduleUrlUpdate() {
    clearTimeout(urlTimer);
    urlTimer = setTimeout(updateUrlHash, 300);
}

for (const c of CONTROLS) {
    if (c.kind === 'range') {
        const { slider, number } = controlEls[c.key];
        slider.addEventListener('input', () => {
            number.value = slider.value;
            scheduleUrlUpdate();
        });
        number.addEventListener('input', () => {
            // Let the slider pin to its end if the typed value is out of range;
            // the algorithm uses the typed value via readControl.
            slider.value = number.value;
            scheduleUrlUpdate();
        });
    } else {
        const m = controlEls[c.key].main;
        m.addEventListener('change', scheduleUrlUpdate);
        if (m.type === 'checkbox' || m.tagName === 'SELECT') {
            m.addEventListener('input', scheduleUrlUpdate);
        }
    }
}

// Apply DEFAULTS, then override from the URL hash if present.
function applyAllDefaults() {
    for (const key of Object.keys(DEFAULTS)) applyDefault(key);
}
function applyFromUrl() {
    const params = parseHash();
    for (const [urlKey, raw] of Object.entries(params)) {
        const optKey = KEY_FROM_URL[urlKey];
        if (!optKey) continue;
        applyValue(optKey, raw);
    }
}
function applyValue(key, raw) {
    const def = DEFAULTS[key];
    const entry = controlEls[key];
    if (!entry) return;
    let val;
    if (typeof def === 'boolean') val = raw === '1' || raw === 'true';
    else if (typeof def === 'number') val = Number(raw);
    else val = raw;
    if (entry.slider) {
        entry.slider.value = val;
        entry.number.value = val;
    } else if (entry.main) {
        if (entry.main.type === 'checkbox') entry.main.checked = val;
        else entry.main.value = val;
    }
}

// ---- URL hash (de)serialization ----

function parseHash() {
    const h = location.hash.slice(1);
    if (!h) return {};
    const out = {};
    for (const pair of h.split('&')) {
        if (!pair) continue;
        const eq = pair.indexOf('=');
        if (eq < 0) { out[pair] = ''; continue; }
        out[pair.slice(0, eq)] = decodeURIComponent(pair.slice(eq + 1));
    }
    return out;
}

function updateUrlHash() {
    const parts = [];
    for (const key of Object.keys(DEFAULTS)) {
        const val = readControl(key);
        const urlKey = URL_KEYS[key];
        if (val === DEFAULTS[key]) continue; // omit defaults to keep URLs short
        let s;
        if (typeof val === 'boolean') s = val ? '1' : '0';
        else s = String(val);
        parts.push(urlKey + '=' + encodeURIComponent(s));
    }
    const newHash = parts.length ? '#' + parts.join('&') : '';
    if (location.hash !== newHash) {
        history.replaceState(null, '', newHash || location.pathname);
    }
}

// ---- Palette snap dropdown population ----
(function populatePaletteSnap() {
    const sel = $('paletteSnapPaletteSelect');
    if (!sel) return;
    sel.innerHTML = ''; // replace the static fallback option
    for (const [key, p] of Object.entries(PALETTES)) {
        const opt = document.createElement('option');
        opt.value = key;
        opt.textContent = key === 'custom' ? PALETTES.custom.name : p.name;
        sel.appendChild(opt);
    }
})();

// ---- Palette panels ----
let currentSort = DEFAULTS.paletteSort;
const origPalette = new PalettePanel({
    imageCanvas: els.originalCanvas,
    stripCanvas: $('origPaletteCanvas'),
    overlay: $('origOverlay'),
    toast: els.toast,
    countEl: $('origPaletteCount'),
    getSort: () => currentSort
});
const refPalette = new PalettePanel({
    imageCanvas: els.refinedCanvas,
    stripCanvas: $('refPaletteCanvas'),
    overlay: $('refOverlay'),
    toast: els.toast,
    countEl: $('refPaletteCount'),
    getSort: () => currentSort
});
els.paletteSortSelect.addEventListener('change', () => {
    currentSort = els.paletteSortSelect.value;
    origPalette.resort();
    refPalette.resort();
});

// ---- Worker ----
let originalImageData = null;
let originalUnique = 0;
let refinedImageDataURL = null;

const worker = new Worker('./js/worker.js', { type: 'module' });
worker.onmessage = (e) => {
    const msg = e.data;
    if (msg.type === 'progress') {
        const label = PHASE_LABELS[msg.progress.phase] || msg.progress.phase;
        const pct = Math.round((msg.progress.pct || 0) * 100);
        els.statusText.textContent = label + '... ' + pct + '%';
        els.progressFill.style.width = pct + '%';
    } else if (msg.type === 'done') {
        const { data, width, height, stats } = msg;
        const imgData = new ImageData(data, width, height);
        els.refinedCanvas.width = width;
        els.refinedCanvas.height = height;
        const ctx = els.refinedCanvas.getContext('2d');
        ctx.putImageData(imgData, 0, 0);
        els.refinedCanvas.classList.remove('hidden');
        els.noResult.classList.add('hidden');

        els.refColorCount.textContent = stats.finalColors;
        const reduction = originalUnique > 0
            ? ((1 - stats.finalColors / originalUnique) * 100).toFixed(1)
            : '0.0';
        els.reductionPercent.textContent = reduction + '%';
        els.refinedStats.hidden = false;

        refinedImageDataURL = els.refinedCanvas.toDataURL('image/png');
        els.downloadBtn.disabled = false;
        els.statusText.textContent = 'Done - ' + stats.segments + ' segments, ' + stats.finalColors + ' colors';
        els.progressFill.style.width = '100%';
        els.processBtn.disabled = false;

        // Update the refined palette panel with the result.
        refPalette.setImage(imgData);
    } else if (msg.type === 'error') {
        els.statusText.textContent = 'Error: ' + msg.message;
        els.progressFill.style.width = '0%';
        els.processBtn.disabled = false;
    }
};

function buildOptions() {
    const o = {};
    for (const key of Object.keys(DEFAULTS)) o[key] = readControl(key);
    return o;
}

function loadImage(file) {
    if (!file || !file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = ev => {
        const img = new Image();
        img.onload = () => {
            const maxDim = 400;
            let w = img.width, h = img.height;
            if (Math.max(w, h) > maxDim) {
                const ratio = maxDim / Math.max(w, h);
                w = Math.round(w * ratio);
                h = Math.round(h * ratio);
            }
            els.originalCanvas.width = w;
            els.originalCanvas.height = h;
            const ctx = els.originalCanvas.getContext('2d');
            ctx.clearRect(0, 0, w, h);
            ctx.drawImage(img, 0, 0, w, h);
            originalImageData = ctx.getImageData(0, 0, w, h);

            els.placeholder.classList.add('hidden');
            els.originalCanvas.classList.remove('hidden');
            els.processBtn.disabled = false;
            els.statusText.textContent = '';
            els.progressFill.style.width = '0%';
            els.refinedCanvas.classList.add('hidden');
            els.noResult.classList.remove('hidden');
            els.downloadBtn.disabled = true;
            els.refinedStats.hidden = true;

            originalUnique = countUniqueColors(originalImageData.data);
            els.origColorCount.textContent = originalUnique;
            els.originalStats.hidden = false;

            // Populate the original palette panel.
            origPalette.setImage(originalImageData);
        };
        img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
}

els.placeholder.addEventListener('click', () => els.fileInput.click());
els.fileInput.addEventListener('change', e => {
    if (e.target.files[0]) loadImage(e.target.files[0]);
});

els.leftContainer.addEventListener('dragover', e => {
    e.preventDefault();
    els.leftContainer.classList.add('drag');
});
els.leftContainer.addEventListener('dragleave', () => {
    els.leftContainer.classList.remove('drag');
});
els.leftContainer.addEventListener('drop', e => {
    e.preventDefault();
    els.leftContainer.classList.remove('drag');
    const file = e.dataTransfer.files[0];
    if (file) loadImage(file);
});

document.addEventListener('paste', e => {
    const items = e.clipboardData && e.clipboardData.items;
    if (!items) return;
    for (const item of items) {
        if (item.type.startsWith('image/')) {
            e.preventDefault();
            loadImage(item.getAsFile());
            return;
        }
    }
});

els.processBtn.addEventListener('click', () => {
    if (!originalImageData) return;
    els.processBtn.disabled = true;
    els.downloadBtn.disabled = true;
    els.statusText.textContent = 'Starting...';
    els.progressFill.style.width = '0%';
    const copy = new Uint8ClampedArray(originalImageData.data);
    worker.postMessage({
        data: copy,
        width: originalImageData.width,
        height: originalImageData.height,
        options: buildOptions()
    }, [copy.buffer]);
});

els.downloadBtn.addEventListener('click', () => {
    if (!refinedImageDataURL) return;
    const link = document.createElement('a');
    link.download = 'refined-pixelart.png';
    link.href = refinedImageDataURL;
    link.click();
});

// ---- Init: apply defaults, then URL overrides ----
applyAllDefaults();
applyFromUrl();
// The sort select may have been overridden by the URL; sync currentSort.
currentSort = readControl('paletteSort');
updateUrlHash();
