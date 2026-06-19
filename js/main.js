// UI wiring: file/drag/paste input, control -> options mapping, worker host,
// progress + stats display, download. No algorithm logic lives here.

import { countUniqueColors } from './color.js';

const PHASE_LABELS = {
    'segment': 'Segmenting',
    'quantize': 'Quantizing',
    'palette-merge': 'Merging palette',
    'denoise': 'Despeckling',
    'lines': 'Consolidating lines',
    'jaggies': 'Cleaning edges'
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
    reductionPercent: $('reductionPercent')
};

// Sync every slider with its value label.
const sliderPairs = [
    ['segmentsSlider', 'segmentsValue'],
    ['colorsPerSlider', 'colorsPerValue'],
    ['compactnessSlider', 'compactnessValue'],
    ['denoiseSizeSlider', 'denoiseSizeValue'],
    ['denoiseSimSlider', 'denoiseSimValue'],
    ['lineWidthSlider', 'lineWidthValue'],
    ['lineTolSlider', 'lineTolValue'],
    ['paletteTolSlider', 'paletteTolValue']
];
for (const [sId, vId] of sliderPairs) {
    const s = $(sId), v = $(vId);
    const sync = () => { v.textContent = s.value; };
    s.addEventListener('input', sync);
    sync();
}

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
    } else if (msg.type === 'error') {
        els.statusText.textContent = 'Error: ' + msg.message;
        els.progressFill.style.width = '0%';
        els.processBtn.disabled = false;
    }
};

function buildOptions() {
    return {
        segments: parseInt($('segmentsSlider').value, 10),
        colorsPerSegment: parseInt($('colorsPerSlider').value, 10),
        spatialWeight: parseFloat($('compactnessSlider').value),
        denoise: $('denoiseCheckbox').checked,
        denoiseSize: parseInt($('denoiseSizeSlider').value, 10),
        denoiseSimilarity: parseInt($('denoiseSimSlider').value, 10),
        lines: $('linesCheckbox').checked,
        lineWidth: parseInt($('lineWidthSlider').value, 10),
        lineTolerance: parseInt($('lineTolSlider').value, 10),
        paletteMerge: $('paletteMergeCheckbox').checked,
        paletteTolerance: parseInt($('paletteTolSlider').value, 10),
        jaggies: $('jaggiesCheckbox').checked
    };
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
    // Send a fresh copy of the original pixels (transferred) so the original is
    // preserved on the main thread for re-processing with different options.
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
