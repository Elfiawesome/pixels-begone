// Despeckle: removes small isolated noise pixels / blobs that are surrounded by
// a single dominant (aggregated) color. Fixes issue #1.
//
// Approach:
//   1. Build connected components on a 4-neighborhood where two adjacent pixels
//      belong to the same component if their Lab distance <= `similarity`.
//      This groups the "aggregated" surrounding shades into one component even
//      when they are not exactly identical (which the old exact-match despeckle
//      could not do).
//   2. Any component with size <= `maxNoiseSize` is treated as noise.
//   3. Replace every noise pixel with the color of the adjacent component that
//      shares the longest border (tie-break: Lab-nearest). The replacement color
//      is read from a real pixel of that neighbor, so no new colors are
//      introduced.
//   4. Repeat up to 3 passes until stable. Borders are handled by only walking
//      in-bounds neighbors.

import { rgbToLab, labDist2Px } from './color.js';

export function denoise(pixels, width, height, options) {
    const maxNoiseSize = options.maxNoiseSize;
    const similarity = options.similarity;
    const sim2 = similarity * similarity;
    const total = width * height;
    const queue = new Int32Array(total);

    for (let pass = 0; pass < 3; pass++) {
        // Recompute lab + opacity each pass (pixels change between passes).
        const lab = new Float32Array(total * 3);
        const opaque = new Uint8Array(total);
        for (let i = 0; i < total; i++) {
            if (pixels[i * 4 + 3] >= 128) {
                opaque[i] = 1;
                const labVal = rgbToLab(pixels[i * 4], pixels[i * 4 + 1], pixels[i * 4 + 2]);
                lab[i * 3] = labVal.L;
                lab[i * 3 + 1] = labVal.a;
                lab[i * 3 + 2] = labVal.b;
            }
        }

        // Connected components (similarity threshold, 4-connectivity).
        const labels = new Int32Array(total).fill(-1);
        const compMembers = [];
        let nextLabel = 0;
        for (let seed = 0; seed < total; seed++) {
            if (!opaque[seed] || labels[seed] !== -1) continue;
            let head = 0, tail = 0;
            queue[tail++] = seed;
            labels[seed] = nextLabel;
            const members = [seed];
            while (head < tail) {
                const p = queue[head++];
                const px = p % width;
                const py = (p / width) | 0;
                if (px > 0) {
                    const np = p - 1;
                    if (opaque[np] && labels[np] === -1 && labDist2Px(lab, p, np) <= sim2) {
                        labels[np] = nextLabel; queue[tail++] = np; members.push(np);
                    }
                }
                if (px < width - 1) {
                    const np = p + 1;
                    if (opaque[np] && labels[np] === -1 && labDist2Px(lab, p, np) <= sim2) {
                        labels[np] = nextLabel; queue[tail++] = np; members.push(np);
                    }
                }
                if (py > 0) {
                    const np = p - width;
                    if (opaque[np] && labels[np] === -1 && labDist2Px(lab, p, np) <= sim2) {
                        labels[np] = nextLabel; queue[tail++] = np; members.push(np);
                    }
                }
                if (py < height - 1) {
                    const np = p + width;
                    if (opaque[np] && labels[np] === -1 && labDist2Px(lab, p, np) <= sim2) {
                        labels[np] = nextLabel; queue[tail++] = np; members.push(np);
                    }
                }
            }
            compMembers.push(members);
            nextLabel++;
        }

        // Find noise components and replace them with the dominant neighbor.
        let changed = false;
        for (let li = 0; li < compMembers.length; li++) {
            const members = compMembers[li];
            if (members.length > maxNoiseSize) continue;

            const borderCount = new Map(); // adjLabel -> shared border length
            const adjPixel = new Map();    // adjLabel -> example neighbor pixel
            for (const p of members) {
                const px = p % width;
                const py = (p / width) | 0;
                if (px > 0) inspectNeighbor(p - 1, li, labels, opaque, borderCount, adjPixel);
                if (px < width - 1) inspectNeighbor(p + 1, li, labels, opaque, borderCount, adjPixel);
                if (py > 0) inspectNeighbor(p - width, li, labels, opaque, borderCount, adjPixel);
                if (py < height - 1) inspectNeighbor(p + width, li, labels, opaque, borderCount, adjPixel);
            }
            if (borderCount.size === 0) continue;

            // Pick the adjacent component with the longest shared border.
            // Tie-break: Lab distance from the noise seed to that neighbor pixel.
            let bestLabel = -1, bestCount = -1, bestDist = Infinity;
            const seedPixel = members[0];
            for (const [nl, cnt] of borderCount) {
                const d = labDist2Px(lab, seedPixel, adjPixel.get(nl));
                if (cnt > bestCount || (cnt === bestCount && d < bestDist)) {
                    bestCount = cnt; bestLabel = nl; bestDist = d;
                }
            }
            if (bestLabel === -1) continue;

            const target = adjPixel.get(bestLabel);
            const tr = pixels[target * 4];
            const tg = pixels[target * 4 + 1];
            const tb = pixels[target * 4 + 2];
            for (const p of members) {
                pixels[p * 4] = tr;
                pixels[p * 4 + 1] = tg;
                pixels[p * 4 + 2] = tb;
            }
            changed = true;
        }

        if (!changed) break;
    }
}

function inspectNeighbor(np, ownLabel, labels, opaque, borderCount, adjPixel) {
    if (!opaque[np]) return;
    const nl = labels[np];
    if (nl === ownLabel) return;
    borderCount.set(nl, (borderCount.get(nl) || 0) + 1);
    if (!adjPixel.has(nl)) adjPixel.set(nl, np);
}
