// Final color-count cap: an "emergency brake" that reduces the total number of
// colors in the image to <= `target`, independent of segmentation. Uses median-
// cut quantization (fast, deterministic, no k-means cost) followed by a
// popularity-weighted merge so the most-used colors are preserved.
//
// This is intentionally a global pass run late in the pipeline so it acts on the
// already-cleaned palette.

import { rgbToLab, labDist2Arr } from './color.js';

export function capColors(pixels, options) {
    const target = Math.max(1, options.target | 0);
    const total = pixels.length / 4;

    // Collect unique colors with counts.
    const colorMap = new Map();
    for (let i = 0; i < total; i++) {
        if (pixels[i * 4 + 3] < 128) continue;
        const r = pixels[i * 4], g = pixels[i * 4 + 1], b = pixels[i * 4 + 2];
        const key = (r << 16) | (g << 8) | b;
        let e = colorMap.get(key);
        if (!e) {
            const lab = rgbToLab(r, g, b);
            e = { r, g, b, lab: [lab.L, lab.a, lab.b], count: 0, key };
            colorMap.set(key, e);
        }
        e.count++;
    }
    if (colorMap.size <= target) return;

    let entries = Array.from(colorMap.values());
    const finalColors = medianCut(entries, target);

    // Build nearest-color remap in Lab space.
    const remap = new Map();
    for (const e of entries) {
        let best = finalColors[0], bestD = Infinity;
        for (const c of finalColors) {
            const d = labDist2Arr(e.lab, c.lab);
            if (d < bestD) { bestD = d; best = c; }
        }
        remap.set(e.key, best);
    }
    for (let i = 0; i < total; i++) {
        if (pixels[i * 4 + 3] < 128) continue;
        const r = pixels[i * 4], g = pixels[i * 4 + 1], b = pixels[i * 4 + 2];
        const rep = remap.get((r << 16) | (g << 8) | b);
        if (rep) {
            pixels[i * 4] = rep.r;
            pixels[i * 4 + 1] = rep.g;
            pixels[i * 4 + 2] = rep.b;
        }
    }
}

// Median cut: recursively split the color set along its longest Lab axis at the
// median (weighted by pixel count) until we have `target` buckets. Each bucket
// becomes one output color = its count-weighted average.
function medianCut(entries, target) {
    let buckets = [entries];
    while (buckets.length < target) {
        // Pick the bucket with the largest Lab extent that can still be split.
        let bestIdx = -1, bestSpan = -1;
        for (let i = 0; i < buckets.length; i++) {
            const b = buckets[i];
            if (b.length < 2) continue;
            const span = bucketSpan(b);
            if (span > bestSpan) { bestSpan = span; bestIdx = i; }
        }
        if (bestIdx === -1) break; // nothing left to split
        const bucket = buckets[bestIdx];
        const [left, right] = splitBucket(bucket);
        buckets.splice(bestIdx, 1, left, right);
    }
    return buckets.map(averageBucket);
}

function bucketSpan(bucket) {
    let minL = Infinity, maxL = -Infinity, minA = Infinity, maxA = -Infinity, minB = Infinity, maxB = -Infinity;
    for (const e of bucket) {
        if (e.lab[0] < minL) minL = e.lab[0]; if (e.lab[0] > maxL) maxL = e.lab[0];
        if (e.lab[1] < minA) minA = e.lab[1]; if (e.lab[1] > maxA) maxA = e.lab[1];
        if (e.lab[2] < minB) minB = e.lab[2]; if (e.lab[2] > maxB) maxB = e.lab[2];
    }
    return Math.max(maxL - minL, maxA - minA, maxB - minB);
}

function splitBucket(bucket) {
    // Find the longest axis.
    let minL = Infinity, maxL = -Infinity, minA = Infinity, maxA = -Infinity, minB = Infinity, maxB = -Infinity;
    for (const e of bucket) {
        if (e.lab[0] < minL) minL = e.lab[0]; if (e.lab[0] > maxL) maxL = e.lab[0];
        if (e.lab[1] < minA) minA = e.lab[1]; if (e.lab[1] > maxA) maxA = e.lab[1];
        if (e.lab[2] < minB) minB = e.lab[2]; if (e.lab[2] > maxB) maxB = e.lab[2];
    }
    const spanL = maxL - minL, spanA = maxA - minA, spanB = maxB - minB;
    const axis = spanL >= spanA && spanL >= spanB ? 0 : (spanA >= spanB ? 1 : 2);
    const sorted = bucket.slice().sort((a, b) => a.lab[axis] - b.lab[axis]);
    // Count-weighted median split.
    let total = 0;
    for (const e of sorted) total += e.count;
    let acc = 0, splitAt = sorted.length;
    for (let i = 0; i < sorted.length; i++) {
        acc += sorted[i].count;
        if (acc * 2 >= total) { splitAt = i + 1; break; }
    }
    if (splitAt < 1) splitAt = 1;
    if (splitAt > sorted.length - 1) splitAt = sorted.length - 1;
    return [sorted.slice(0, splitAt), sorted.slice(splitAt)];
}

function averageBucket(bucket) {
    let tot = 0, r = 0, g = 0, b = 0, L = 0, a = 0, bb = 0;
    for (const e of bucket) {
        tot += e.count;
        r += e.r * e.count; g += e.g * e.count; b += e.b * e.count;
        L += e.lab[0] * e.count; a += e.lab[1] * e.count; bb += e.lab[2] * e.count;
    }
    return {
        r: Math.round(r / tot), g: Math.round(g / tot), b: Math.round(b / tot),
        lab: [L / tot, a / tot, bb / tot]
    };
}
