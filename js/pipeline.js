// Pipeline orchestrator. Reproduces the original segment-then-quantize
// behavior (parity at defaults with the old despeckle/outline off), then runs
// the new opt-in post-processing stages in a fixed order:
//
//   1. Build Lab + spatial features
//   2. k-means -> K superpixel segments
//   3. Per-segment k-means on RGB -> quantize each segment to <= colorsPerSegment
//   4. Palette merge      (optional)
//   5. Despeckle          (optional)
//   6. Consolidate lines  (optional)
//   7. Jaggie cleanup     (optional)
//
// `onProgress({ phase, pct })` is called between stages so the worker can report
// status to the UI.

import { rgbToLab, countUniqueColors } from './color.js';
import { kmeans } from './kmeans.js';
import { mergePalette } from './palette-merge.js';
import { denoise } from './denoise.js';
import { consolidateLines } from './lines.js';
import { cleanJaggies } from './edges.js';

export function refine(imageData, options, onProgress) {
    const width = imageData.width;
    const height = imageData.height;
    const src = imageData.data;
    const total = width * height;
    const report = (phase, pct) => { if (onProgress) onProgress({ phase, pct }); };

    report('segment', 0);

    // 1. Build feature vectors (Lab + normalized spatial coordinates).
    const features = [];
    const pixelIndices = [];
    for (let i = 0; i < total; i++) {
        if (src[i * 4 + 3] < 128) continue;
        const r = src[i * 4], g = src[i * 4 + 1], b = src[i * 4 + 2];
        const lab = rgbToLab(r, g, b);
        const xNorm = (i % width) / Math.max(1, width - 1);
        const yNorm = Math.floor(i / width) / Math.max(1, height - 1);
        features.push([lab.L, lab.a, lab.b, xNorm, yNorm]);
        pixelIndices.push(i);
    }
    if (features.length === 0) {
        return { resultImageData: imageData, stats: { segments: 0, finalColors: 0 } };
    }

    const spatialWeight = options.spatialWeight;
    const weighted = features.map(f => [
        f[0], f[1], f[2],
        f[3] * spatialWeight * 100,
        f[4] * spatialWeight * 100
    ]);
    const K = Math.min(options.segments, features.length);

    report('segment', 0.3);
    const segResult = kmeans(weighted, K, 15);
    const segLabels = segResult.labels;
    report('segment', 0.7);

    // 2. Group pixels by segment.
    const segments = new Map();
    for (let i = 0; i < features.length; i++) {
        const lbl = segLabels[i];
        let arr = segments.get(lbl);
        if (!arr) { arr = []; segments.set(lbl, arr); }
        const idx = pixelIndices[i];
        arr.push({ r: src[idx * 4], g: src[idx * 4 + 1], b: src[idx * 4 + 2], pixelIndex: idx });
    }

    // 3. Per-segment quantization.
    const out = new Uint8ClampedArray(src.length);
    for (let i = 0; i < total; i++) out[i * 4 + 3] = src[i * 4 + 3];

    const colorsPerSegment = options.colorsPerSegment;
    let segProcessed = 0;
    for (const segPixels of segments.values()) {
        const colorVecs = segPixels.map(p => [p.r, p.g, p.b]);
        const uniqueCount = new Set(colorVecs.map(c => c[0] + ',' + c[1] + ',' + c[2])).size;
        const kLocal = Math.min(colorsPerSegment, uniqueCount);
        let localCentroids, localLabels;
        if (kLocal <= 1) {
            localCentroids = [colorVecs[0]];
            localLabels = new Array(colorVecs.length).fill(0);
        } else {
            const r = kmeans(colorVecs, kLocal, 10);
            localCentroids = r.centroids;
            localLabels = r.labels;
        }
        for (let i = 0; i < segPixels.length; i++) {
            const cent = localCentroids[localLabels[i]];
            const idx = segPixels[i].pixelIndex;
            out[idx * 4] = Math.round(clamp(cent[0]));
            out[idx * 4 + 1] = Math.round(clamp(cent[1]));
            out[idx * 4 + 2] = Math.round(clamp(cent[2]));
        }
        segProcessed++;
        if (segProcessed % 10 === 0) report('quantize', segProcessed / segments.size);
    }
    report('quantize', 1);

    // 4. Palette merge.
    if (options.paletteMerge) {
        report('palette-merge', 0);
        mergePalette(out, { tolerance: options.paletteTolerance });
        report('palette-merge', 1);
    }

    // 5. Despeckle.
    if (options.denoise) {
        report('denoise', 0);
        denoise(out, width, height, {
            maxNoiseSize: options.denoiseSize,
            similarity: options.denoiseSimilarity
        });
        report('denoise', 1);
    }

    // 6. Consolidate lines.
    if (options.lines) {
        report('lines', 0);
        consolidateLines(out, width, height, {
            maxWidth: options.lineWidth,
            unifyTolerance: options.lineTolerance
        });
        report('lines', 1);
    }

    // 7. Jaggie cleanup.
    if (options.jaggies) {
        report('jaggies', 0);
        cleanJaggies(out, width, height);
        report('jaggies', 1);
    }

    const resultImageData = new ImageData(out, width, height);
    return {
        resultImageData,
        stats: { segments: segments.size, finalColors: countUniqueColors(out) }
    };
}

function clamp(v) { return Math.min(255, Math.max(0, v)); }
