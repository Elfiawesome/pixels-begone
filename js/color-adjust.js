// Saturation / contrast boost: a global HSL adjustment that pushes AI's muddy
// output toward pixel-art punchiness. Operates in HSL space.
//   - saturation: 100 = unchanged, 130 (default) = +30% saturation, 0 = gray.
//   - contrast:   100 = unchanged, 110 (default) = +10% contrast around 0.5 L.
// Both are applied multiplicatively around their neutral points so they are
// fully reversible at 100.

import { rgbToHsl, hslToRgb } from './hue-snap.js';

export function adjustColors(pixels, options) {
    const satMul = options.saturation / 100;
    const conMul = options.contrast / 100;
    if (satMul === 1 && conMul === 1) return;
    const total = pixels.length / 4;
    for (let i = 0; i < total; i++) {
        if (pixels[i * 4 + 3] < 128) continue;
        const r = pixels[i * 4] / 255, g = pixels[i * 4 + 1] / 255, b = pixels[i * 4 + 2] / 255;
        const hsl = rgbToHsl(r, g, b);
        let s = hsl.s * satMul;
        if (s > 1) s = 1; else if (s < 0) s = 0;
        let l = hsl.l;
        if (conMul !== 1) {
            // Contrast around 0.5: push values away from / toward 0.5.
            l = 0.5 + (l - 0.5) * conMul;
            if (l < 0) l = 0; else if (l > 1) l = 1;
        }
        const rgb = hslToRgb(hsl.h, s, l);
        pixels[i * 4] = Math.round(rgb[0] * 255);
        pixels[i * 4 + 1] = Math.round(rgb[1] * 255);
        pixels[i * 4 + 2] = Math.round(rgb[2] * 255);
    }
}
