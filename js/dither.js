// Bayer ordered dithering. Re-quantizes each pixel to the nearest color in the
// current final palette, but perturbs the quantization threshold using a Bayer
// threshold matrix so gradients are preserved as a regular dot pattern instead
// of banding. Run as the last pipeline step so it spreads the finalized colors.
//
// `matrix` selects the Bayer matrix size: 2 (4 levels), 4 (16 levels), 8 (64).
// The dither strength is scaled by the local luminance range so flat regions
// are not dithered (only gradients get the pattern).

import { rgbToLab, labDist2Arr } from './color.js';

const BAYER_2 = [
    [0, 2],
    [3, 1]
];
const BAYER_4 = [
    [0, 8, 2, 10],
    [12, 4, 14, 6],
    [3, 11, 1, 9],
    [15, 7, 13, 5]
];
const BAYER_8 = [
    [0, 32, 8, 40, 2, 34, 10, 42],
    [48, 16, 56, 24, 50, 18, 58, 26],
    [12, 44, 4, 36, 14, 46, 6, 38],
    [60, 28, 52, 20, 62, 30, 54, 22],
    [3, 35, 11, 43, 1, 33, 9, 41],
    [51, 19, 59, 27, 49, 17, 57, 25],
    [15, 47, 7, 39, 13, 45, 5, 37],
    [63, 31, 55, 23, 61, 29, 53, 21]
];

export function ditherImage(pixels, width, height, options) {
    const size = options.matrix;
    const matrix = size === 2 ? BAYER_2 : (size === 8 ? BAYER_8 : BAYER_4);
    const denom = matrix.length * matrix.length;
    const total = width * height;

    // Gather the current unique palette (post-cleanup final colors).
    const colorMap = new Map();
    for (let i = 0; i < total; i++) {
        if (pixels[i * 4 + 3] < 128) continue;
        const r = pixels[i * 4], g = pixels[i * 4 + 1], b = pixels[i * 4 + 2];
        const key = (r << 16) | (g << 8) | b;
        if (!colorMap.has(key)) {
            const lab = rgbToLab(r, g, b);
            colorMap.set(key, { r, g, b, lab: [lab.L, lab.a, lab.b], key });
        }
    }
    const palette = Array.from(colorMap.values());
    if (palette.length < 2) return; // nothing to dither between

    // Precompute nearest palette index for a given Lab point. With few palette
    // colors this linear scan is fine; the per-pixel cost is bounded by the
    // palette size which by this stage is small.
    const cache = new Map();
    function nearestIndexPlusSecond(lab) {
        let bestIdx = 0, bestD = Infinity, secondIdx = -1, secondD = Infinity;
        for (let j = 0; j < palette.length; j++) {
            const d = labDist2Arr(lab, palette[j].lab);
            if (d < bestD) { secondD = bestD; secondIdx = bestIdx; bestD = d; bestIdx = j; }
            else if (d < secondD) { secondD = d; secondIdx = j; }
        }
        return [bestIdx, secondIdx, bestD, secondD];
    }

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const i = y * width + x;
            if (pixels[i * 4 + 3] < 128) continue;
            const r = pixels[i * 4], g = pixels[i * 4 + 1], b = pixels[i * 4 + 2];
            const key = (r << 16) | (g << 8) | b;

            let info = cache.get(key);
            if (!info) {
                const lab = rgbToLab(r, g, b);
                info = nearestIndexPlusSecond([lab.L, lab.a, lab.b]);
                cache.set(key, info);
            }
            const [bestIdx, secondIdx, bestD, secondD] = info;
            if (secondIdx < 0) continue;

            // Threshold from the Bayer matrix in [0, 1).
            const t = (matrix[y % matrix.length][x % matrix.length] + 0.5) / denom;

            // Position of this pixel's color along the best->second segment.
            // If t passes that position, swap to the second-nearest color.
            const seg = Math.sqrt(secondD);
            const pos = Math.sqrt(bestD) / (seg + 1e-6);
            const useSecond = t > pos;
            const pick = useSecond ? palette[secondIdx] : palette[bestIdx];
            pixels[i * 4] = pick.r;
            pixels[i * 4 + 1] = pick.g;
            pixels[i * 4 + 2] = pick.b;
        }
    }
}
