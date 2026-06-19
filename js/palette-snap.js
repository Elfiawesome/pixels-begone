// Palette snap: snaps every pixel to the nearest color in a fixed palette.
// Named palettes are curated authentic retro palettes; "custom" takes a
// user-pasted list of hex codes. Run late in the pipeline so it acts on the
// already-cleaned image.

import { rgbToLab, labDist2Arr } from './color.js';

// Curated named palettes. Each entry is a flat array of [r, g, b] triples.
export const PALETTES = {
    'pico8': {
        name: 'PICO-8 (16)',
        colors: hexList([
            '000000', '1D2B53', '7E2553', '008751', 'AB5236', '5F574F', 'C2C3C7', 'FFF1E8',
            'FF004D', 'FFA300', 'FFEC27', '00E436', '29ADFF', '83769C', 'FFCCAA', 'FF77A8'
        ])
    },
    'sweetie16': {
        name: 'Sweetie 16 (16)',
        colors: hexList([
            '1a1c2c', '5d275d', 'b13e53', 'ef7d57', 'ffcd75', 'a7f070', '38b764', '257179',
            '29366f', '3b5dc9', '41a6f6', '73eff7', 'f4f4f4', '94b0c2', '566c86', '333c57'
        ])
    },
    'gameboy': {
        name: 'Game Boy DMG (4)',
        colors: hexList(['0f380f', '306230', '8bac0f', '9bbc0f'])
    },
    'cga': {
        name: 'CGA (16)',
        colors: hexList([
            '000000', '0000AA', '00AA00', '00AAAA', 'AA0000', 'AA00AA', 'AA5500', 'AAAAAA',
            '555555', '5555FF', '55FF55', '55FFFF', 'FF5555', 'FF55FF', 'FFFF55', 'FFFFFF'
        ])
    },
    'nes': {
        name: 'NES (16)',
        colors: hexList([
            '000000', 'FCFCFC', 'B8B8B8', '7C7C7C', '0000FC', '0078F8', '3CBCFC', 'A4E4FC',
            'F8B8F8', 'F878F8', '6844FC', '9878F8', 'F85898', 'F87858', 'FCA044', 'F8D878'
        ])
    },
    'mono4': {
        name: 'Mono 4',
        colors: hexList(['000000', '555555', 'AAAAAA', 'FFFFFF'])
    },
    'custom': {
        name: 'Custom',
        colors: [] // populated from the custom text input
    }
};

export function getPalette(name, customHexText) {
    if (name === 'custom') {
        return hexList(parseCustomHex(customHexText));
    }
    const p = PALETTES[name];
    return p ? p.colors : PALETTES.pico8.colors;
}

export function snapToPalette(pixels, options) {
    const colors = options.paletteColors;
    if (!colors || colors.length === 0) return;
    const total = pixels.length / 4;

    // Precompute Lab for palette colors.
    const palLab = colors.map(c => {
        const v = rgbToLab(c[0], c[1], c[2]);
        return [v.L, v.a, v.b];
    });

    // Cache: source color key -> snapped [r,g,b] (most images have few colors
    // by the time this runs, so this is near-linear).
    const cache = new Map();
    for (let i = 0; i < total; i++) {
        if (pixels[i * 4 + 3] < 128) continue;
        const r = pixels[i * 4], g = pixels[i * 4 + 1], b = pixels[i * 4 + 2];
        const key = (r << 16) | (g << 8) | b;
        let snap = cache.get(key);
        if (!snap) {
            const lab = rgbToLab(r, g, b);
            const srcLab = [lab.L, lab.a, lab.b];
            let best = palLab[0], bestD = Infinity, bestIdx = 0;
            for (let j = 0; j < palLab.length; j++) {
                const d = labDist2Arr(srcLab, palLab[j]);
                if (d < bestD) { bestD = d; best = palLab[j]; bestIdx = j; }
            }
            snap = colors[bestIdx];
            cache.set(key, snap);
        }
        pixels[i * 4] = snap[0];
        pixels[i * 4 + 1] = snap[1];
        pixels[i * 4 + 2] = snap[2];
    }
}

function hexList(hexes) {
    return hexes.map(h => {
        const v = h.replace('#', '');
        return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)];
    });
}

// Parse a blob of text into a list of 6-digit hex codes (with or without #),
// tolerant of commas, spaces, newlines, and stray punctuation.
function parseCustomHex(text) {
    if (!text) return [];
    const matches = text.match(/#?[0-9a-fA-F]{6}/g);
    return matches || [];
}
