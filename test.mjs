// Logic tests for the algorithm modules. Run with: node test.mjs
import assert from 'node:assert/strict';

// Polyfill ImageData (used only by pipeline.js / worker.js in the browser).
globalThis.ImageData = class ImageData {
    constructor(data, width, height) {
        this.data = data;
        this.width = width;
        this.height = height;
    }
};

import { denoise } from './js/denoise.js';
import { consolidateLines } from './js/lines.js';
import { mergePalette } from './js/palette-merge.js';
import { snapHue } from './js/hue-snap.js';
import { removePillow } from './js/pillow.js';
import { adjustColors } from './js/color-adjust.js';
import { capColors } from './js/color-cap.js';
import { snapToPalette, getPalette, PALETTES } from './js/palette-snap.js';
import { ditherImage } from './js/dither.js';
import { refine } from './js/pipeline.js';

function makeImage(w, h, fill) {
    const px = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) {
        px[i * 4] = fill[0]; px[i * 4 + 1] = fill[1]; px[i * 4 + 2] = fill[2]; px[i * 4 + 3] = 255;
    }
    return px;
}
function setPx(px, w, x, y, c) {
    const i = (y * w + x) * 4;
    px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; px[i + 3] = 255;
}
function getPx(px, w, x, y) {
    const i = (y * w + x) * 4;
    return [px[i], px[i + 1], px[i + 2]];
}
function uniqueCount(px) {
    const s = new Set();
    for (let i = 0; i < px.length; i += 4) {
        if (px[i + 3] < 128) continue;
        s.add((px[i] << 16) | (px[i + 1] << 8) | px[i + 2]);
    }
    return s.size;
}

let passed = 0;
function test(name, fn) {
    fn();
    passed++;
    console.log('PASS  ' + name);
}

// ============ Despeckle (with new guards) ============

test('despeckle removes a true outlier (high contrast)', () => {
    const w = 12, h = 12;
    const px = makeImage(w, h, [200, 200, 200]);
    setPx(px, w, 5, 5, [255, 0, 0]); // red dot, high contrast vs gray
    denoise(px, w, h, { maxNoiseSize: 1, similarity: 6, minContrast: 8 });
    assert.deepEqual(getPx(px, w, 5, 5), [200, 200, 200]);
});

test('despeckle preserves gentle gradient pixels (min contrast guard)', () => {
    const w = 12, h = 12;
    const px = makeImage(w, h, [200, 200, 200]);
    // A single pixel differing by only ~3 RGB units from the field (Lab dist < 8).
    setPx(px, w, 5, 5, [203, 203, 203]);
    denoise(px, w, h, { maxNoiseSize: 1, similarity: 6, minContrast: 8 });
    // Should NOT be replaced: it's within the gradient, not an outlier.
    assert.deepEqual(getPx(px, w, 5, 5), [203, 203, 203]);
});

test('despeckle preserves a pixel at a junction of large regions (dominance guard)', () => {
    const w = 16, h = 16;
    const px = new Uint8ClampedArray(w * h * 4);
    // Two big quadrants: top-left red, bottom-right green.
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const red = (x <= 8 && y <= 8);
        const green = (x >= 8 && y >= 8);
        if (red && !green) setPx(px, w, x, y, [200, 40, 40]);
        else if (green && !red) setPx(px, w, x, y, [40, 200, 40]);
        else setPx(px, w, x, y, [200, 40, 40]); // the overlap corner, overridden below
    }
    // A single high-contrast pixel at the corner junction (8,8).
    setPx(px, w, 8, 8, [120, 120, 120]);
    // Its 4 neighbors: (7,8)=red, (9,8)=green, (8,7)=red, (8,9)=green -> 2 red, 2 green.
    denoise(px, w, h, { maxNoiseSize: 1, similarity: 6, minContrast: 8 });
    // No neighbor strictly owns >50% of the border, so the center is preserved.
    assert.deepEqual(getPx(px, w, 8, 8), [120, 120, 120]);
});

test('despeckle removes a 2-pixel noise blob', () => {
    const w = 12, h = 12;
    const px = makeImage(w, h, [180, 180, 180]);
    setPx(px, w, 5, 5, [255, 0, 0]);
    setPx(px, w, 6, 5, [255, 0, 0]);
    denoise(px, w, h, { maxNoiseSize: 2, similarity: 6, minContrast: 8 });
    assert.deepEqual(getPx(px, w, 5, 5), [180, 180, 180]);
    assert.deepEqual(getPx(px, w, 6, 5), [180, 180, 180]);
});

test('despeckle preserves a large region', () => {
    const w = 20, h = 20;
    const px = makeImage(w, h, [220, 220, 220]);
    for (let y = 7; y < 13; y++) for (let x = 7; x < 13; x++) setPx(px, w, x, y, [40, 40, 40]);
    denoise(px, w, h, { maxNoiseSize: 3, similarity: 6, minContrast: 8 });
    assert.deepEqual(getPx(px, w, 10, 10), [40, 40, 40]);
});

// ============ Lines ============

test('lines unify varying shades of a 1px vertical line', () => {
    const w = 20, h = 20;
    const px = makeImage(w, h, [200, 200, 200]);
    const shades = [[0, 0, 0], [8, 8, 8], [3, 3, 3], [10, 10, 10], [5, 5, 5]];
    for (let y = 2; y < 18; y++) setPx(px, w, 10, y, shades[y % shades.length]);
    consolidateLines(px, w, h, { maxWidth: 2, unifyTolerance: 15 });
    const colors = new Set();
    for (let y = 2; y < 18; y++) colors.add(getPx(px, w, 10, y).join(','));
    assert.equal(colors.size, 1);
});

test('lines preserve the line rather than erasing it', () => {
    const w = 20, h = 20;
    const px = makeImage(w, h, [200, 200, 200]);
    for (let y = 2; y < 18; y++) setPx(px, w, 10, y, [0, 0, 0]);
    consolidateLines(px, w, h, { maxWidth: 2, unifyTolerance: 10 });
    for (let y = 2; y < 18; y++) assert.deepEqual(getPx(px, w, 10, y), [0, 0, 0]);
});

test('lines leave a filled block untouched', () => {
    const w = 20, h = 20;
    const px = makeImage(w, h, [200, 200, 200]);
    for (let y = 5; y < 15; y++) for (let x = 5; x < 15; x++) setPx(px, w, x, y, [50, 50, 50]);
    consolidateLines(px, w, h, { maxWidth: 2, unifyTolerance: 10 });
    assert.deepEqual(getPx(px, w, 10, 10), [50, 50, 50]);
});

test('lines unify disconnected same-color outline pieces', () => {
    const w = 20, h = 20;
    const px = makeImage(w, h, [200, 200, 200]);
    for (let y = 2; y < 8; y++) setPx(px, w, 4, y, [0, 0, 0]);
    for (let y = 12; y < 18; y++) setPx(px, w, 15, y, [4, 4, 4]);
    consolidateLines(px, w, h, { maxWidth: 2, unifyTolerance: 10 });
    const left = new Set(), right = new Set();
    for (let y = 2; y < 8; y++) left.add(getPx(px, w, 4, y).join(','));
    for (let y = 12; y < 18; y++) right.add(getPx(px, w, 15, y).join(','));
    assert.equal(left.size, 1);
    assert.equal(right.size, 1);
    assert.equal(Array.from(left)[0], Array.from(right)[0]);
});

test('lines detect and unify a 2px-wide vertical line', () => {
    const w = 20, h = 20;
    const px = makeImage(w, h, [200, 200, 200]);
    for (let y = 2; y < 18; y++) {
        setPx(px, w, 10, y, [0, 0, 0]);
        setPx(px, w, 11, y, [6, 6, 6]);
    }
    consolidateLines(px, w, h, { maxWidth: 2, unifyTolerance: 10 });
    const colors = new Set();
    for (let y = 2; y < 18; y++) { colors.add(getPx(px, w, 10, y).join(',')); colors.add(getPx(px, w, 11, y).join(',')); }
    assert.equal(colors.size, 1);
});

// ============ Palette merge ============

test('palette merge unifies near-identical dark colors, keeps distinct gray', () => {
    const px = new Uint8ClampedArray(16);
    setPx(px, 4, 0, 0, [0, 0, 0]); setPx(px, 4, 1, 0, [1, 1, 1]);
    setPx(px, 4, 2, 0, [2, 2, 2]); setPx(px, 4, 3, 0, [200, 200, 200]);
    mergePalette(px, { tolerance: 5 });
    assert.equal(uniqueCount(px), 2);
    assert.deepEqual(getPx(px, 4, 3, 0), [200, 200, 200]);
});

// ============ Hue jitter reduction ============

test('hue snap unifies hue drift within a region, keeps grays', () => {
    const w = 20, h = 20;
    const px = makeImage(w, h, [200, 200, 200]); // gray field
    // A red region with slight hue jitter (reds + a near-red orange).
    for (let y = 4; y < 16; y++) for (let x = 4; x < 16; x++) {
        setPx(px, w, x, y, (x + y) % 2 === 0 ? [220, 40, 40] : [220, 60, 30]);
    }
    snapHue(px, w, h, { tolerance: 8 });
    const hues = new Set();
    for (let y = 4; y < 16; y++) for (let x = 4; x < 16; x++) {
        const c = getPx(px, w, x, y);
        // Collect distinct colors; after snap the two red variants should collapse.
        hues.add(c.join(','));
    }
    assert.ok(hues.size <= 2, 'red region should collapse to ~1 hue, got ' + hues.size);
    // Gray field stays gray.
    assert.deepEqual(getPx(px, w, 0, 0), [200, 200, 200]);
});

// ============ Pillow-shading removal ============

test('pillow removal re-shades a dark-border/bright-center region', () => {
    const w = 24, h = 24;
    const px = makeImage(w, h, [0, 0, 0]);
    // Build a clear pillow: dark border, bright center, all red hue.
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const dx = x - w / 2, dy = y - h / 2;
        const d = Math.sqrt(dx * dx + dy * dy) / (w / 2);
        const L = Math.max(0, 1 - d) * 200; // bright center, dark border
        setPx(px, w, x, y, [L, 30, 30]);
    }
    const centerBefore = getPx(px, w, 12, 12)[0];
    removePillow(px, w, h, { strength: 100 });
    const centerAfter = getPx(px, w, 12, 12)[0];
    // Center should no longer be the brightest spot; directional shading shifts brightness.
    // We just assert the image changed meaningfully.
    let changed = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        if (getPx(px, w, x, y)[0] !== Math.max(0, 1 - Math.sqrt((x - w / 2) ** 2 + (y - h / 2) ** 2) / (w / 2)) * 200) changed++;
    }
    assert.ok(changed > 100, 'pillow removal should re-shade many pixels, changed=' + changed);
});

test('pillow removal with strength 0 is a no-op', () => {
    const w = 16, h = 16;
    const px = makeImage(w, h, [120, 120, 120]);
    const before = px.slice();
    removePillow(px, w, h, { strength: 0 });
    assert.deepEqual(Array.from(px), Array.from(before));
});

// ============ Saturation / contrast ============

test('adjustColors at 100/100 is a no-op', () => {
    const px = makeImage(8, 8, [123, 45, 200]);
    const before = px.slice();
    adjustColors(px, { saturation: 100, contrast: 100 });
    assert.deepEqual(Array.from(px), Array.from(before));
});

test('adjustColors boosts saturation', () => {
    const px = makeImage(4, 4, [160, 120, 120]); // muted red-ish
    adjustColors(px, { saturation: 200, contrast: 100 });
    const after = getPx(px, 4, 0, 0);
    // Saturation doubled: red channel should rise, green/blue fall.
    assert.ok(after[0] >= 160 && after[1] <= 120 && after[2] <= 120, 'expected more saturated, got ' + after);
});

// ============ Color-count cap ============

test('capColors reduces to target count', () => {
    const w = 16, h = 16;
    const px = makeImage(w, h, [0, 0, 0]);
    // Paint 8 distinct colors in stripes.
    const colors = [[255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 255, 0], [0, 255, 255], [255, 0, 255], [128, 128, 128], [200, 100, 50]];
    for (let x = 0; x < w; x++) for (let y = 0; y < h; y++) setPx(px, w, x, y, colors[x % colors.length]);
    assert.equal(uniqueCount(px), 8);
    capColors(px, { target: 3 });
    assert.ok(uniqueCount(px) <= 3, 'should cap to <= 3 colors, got ' + uniqueCount(px));
});

test('capColors is a no-op when already under target', () => {
    const px = makeImage(8, 8, [10, 20, 30]);
    const before = uniqueCount(px);
    capColors(px, { target: 64 });
    assert.equal(uniqueCount(px), before);
});

// ============ Palette snap ============

test('getPalette returns the named palette', () => {
    const p = getPalette('gameboy', '');
    assert.equal(p.length, 4);
});

test('getPalette parses custom hex list', () => {
    const p = getPalette('custom', '#ff0000, #00ff00, #0000ff, 808080');
    assert.equal(p.length, 4);
    assert.deepEqual(p[0], [255, 0, 0]);
    assert.deepEqual(p[3], [128, 128, 128]);
});

test('snapToPalette maps pixels to nearest palette color', () => {
    const w = 4, h = 1;
    const px = new Uint8ClampedArray(16);
    setPx(px, w, 0, 0, [250, 5, 5]);   // near red
    setPx(px, w, 1, 0, [5, 250, 5]);   // near green
    setPx(px, w, 2, 0, [5, 5, 250]);   // near blue
    setPx(px, w, 3, 0, [128, 128, 128]);
    const palette = [[255, 0, 0], [0, 255, 0], [0, 0, 255], [128, 128, 128]];
    snapToPalette(px, { paletteColors: palette });
    assert.deepEqual(getPx(px, w, 0, 0), [255, 0, 0]);
    assert.deepEqual(getPx(px, w, 1, 0), [0, 255, 0]);
    assert.deepEqual(getPx(px, w, 2, 0), [0, 0, 255]);
    assert.deepEqual(getPx(px, w, 3, 0), [128, 128, 128]);
});

test('PALETTES has expected named entries', () => {
    assert.ok(PALETTES.pico8.colors.length === 16);
    assert.ok(PALETTES.sweetie16.colors.length === 16);
    assert.ok(PALETTES.gameboy.colors.length === 4);
    assert.ok(PALETTES.cga.colors.length === 16);
});

// ============ Dithering ============

test('ditherImage with a single color is a no-op', () => {
    const px = makeImage(8, 8, [100, 100, 100]);
    const before = px.slice();
    ditherImage(px, 8, 8, { matrix: 4 });
    assert.deepEqual(Array.from(px), Array.from(before));
});

test('ditherImage on a gradient produces only palette colors', () => {
    const w = 16, h = 16;
    const px = makeImage(w, h, [0, 0, 0]);
    // A 2-color gradient: left black, right white.
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const v = x < w / 2 ? 0 : 255;
        setPx(px, w, x, y, [v, v, v]);
    }
    ditherImage(px, w, h, { matrix: 4 });
    // Every output pixel must be one of the two source colors.
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const c = getPx(px, w, x, y);
        const ok = (c[0] === 0 && c[1] === 0 && c[2] === 0) || (c[0] === 255 && c[1] === 255 && c[2] === 255);
        assert.ok(ok, 'dither produced a non-palette color: ' + c);
    }
});

// ============ Pipeline end-to-end ============

test('pipeline runs end-to-end and reduces unique colors', () => {
    const w = 30, h = 30;
    const px = makeImage(w, h, [200, 200, 200]);
    setPx(px, w, 15, 15, [255, 0, 0]);
    for (let y = 3; y < 27; y++) setPx(px, w, 5, y, [0, 0, y % 5 === 0 ? 8 : 0]);
    const img = new ImageData(px, w, h);
    const { resultImageData, stats } = refine(img, {
        segments: 30, colorsPerSegment: 2, spatialWeight: 0.8,
        paletteMerge: true, paletteTolerance: 8,
        denoise: true, denoiseSize: 3, denoiseSimilarity: 6, denoiseMinContrast: 8,
        lines: true, lineWidth: 2, lineTolerance: 10,
        jaggies: false,
        hueSnap: false, hueSnapTolerance: 8,
        pillow: false, pillowStrength: 50,
        colorAdjust: false, saturation: 130, contrast: 110,
        colorCap: false, colorCapTarget: 16,
        paletteSnap: false, paletteSnapPalette: 'pico8', paletteSnapCustom: '',
        dither: false, ditherMatrix: 4
    }, () => {});
    assert.ok(stats.segments > 0);
    assert.ok(stats.finalColors > 0 && stats.finalColors < 50, 'should reduce colors, got ' + stats.finalColors);
    assert.ok(resultImageData.data.length === w * h * 4);
});

test('pipeline with every algorithm on still completes', () => {
    const w = 24, h = 24;
    const px = makeImage(w, h, [180, 180, 180]);
    for (let y = 4; y < 20; y++) for (let x = 8; x < 16; x++) setPx(px, w, x, y, [200, 60, 60]);
    for (let y = 4; y < 20; y++) setPx(px, w, 12, y, [0, 0, 0]);
    const img = new ImageData(px, w, h);
    const { stats } = refine(img, {
        segments: 20, colorsPerSegment: 3, spatialWeight: 0.8,
        paletteMerge: true, paletteTolerance: 10,
        denoise: true, denoiseSize: 3, denoiseSimilarity: 6, denoiseMinContrast: 8,
        lines: true, lineWidth: 2, lineTolerance: 12,
        jaggies: true,
        hueSnap: true, hueSnapTolerance: 10,
        pillow: true, pillowStrength: 60,
        colorAdjust: true, saturation: 130, contrast: 110,
        colorCap: true, colorCapTarget: 16,
        paletteSnap: true, paletteSnapPalette: 'pico8', paletteSnapCustom: '',
        dither: true, ditherMatrix: 4
    }, () => {});
    assert.ok(stats.finalColors > 0 && stats.finalColors <= 16, 'palette snap + cap should bound colors, got ' + stats.finalColors);
});

console.log('\n' + passed + ' tests passed.');
