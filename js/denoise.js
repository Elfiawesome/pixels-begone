// Despeckle: removes small isolated noise pixels / blobs that are surrounded by
// a single dominant (aggregated) color. Fixes issue #1.
//
// Approach:
//   1. Build connected components on a 4-neighborhood where two adjacent pixels
//      belong to the same component if their Lab distance <= `similarity`.
//      This groups the "aggregated" surrounding shades into one component even
//      when they are not exactly identical (which the old exact-match despeckle
//      could not do).
//   2. Any component with size <= `maxNoiseSize` is a *candidate* noise blob.
//   3. Two guards decide whether to actually replace it (these prevent the
//      over-aggression that destroyed gradients at low params):
//        a) Min contrast: the candidate's color must differ from the chosen
//           replacement by at least `minContrast` in Lab space. Gradient pixels
//           (Lab dist ~1-3 from neighbors) are left untouched; true outliers
//           (e.g. a red dot in a gray field, dist > 8) are removed.
//        b) Dominance: the winning neighbor must cover >= 50% of the candidate's
//           border. Enforces "obviously surrounded by a single color". If the
//           border is split between many different colors it is not isolated
//           noise, so it is preserved.
//   4. The replacement color is read from a real pixel of the winning neighbor
//      component, so no new colors are introduced.
//   5. Repeat up to 3 passes until stable. Borders are handled by only walking
//      in-bounds neighbors.

import { rgbToLab, labDist2Px } from './color.js';

export function denoise(pixels, width, height, options) {
    const maxNoiseSize = options.maxNoiseSize;
    const similarity = options.similarity;
    const minContrast = options.minContrast;
    const sim2 = similarity * similarity;
    const minContrast2 = minContrast * minContrast;
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
        const compSeed = []; // representative pixel index per component
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
            compSeed.push(seed);
            nextLabel++;
        }

        // Find noise components and replace them with the dominant neighbor.
        let changed = false;
        for (let li = 0; li < compMembers.length; li++) {
            const members = compMembers[li];
            if (members.length > maxNoiseSize) continue;

            const borderCount = new Map(); // adjLabel -> shared border length
            const adjPixel = new Map();    // adjLabel -> example neighbor pixel
            let totalBorder = 0;
            for (const p of members) {
                const px = p % width;
                const py = (p / width) | 0;
                if (px > 0) { totalBorder += inspectNeighbor(p - 1, li, labels, opaque, borderCount, adjPixel); }
                if (px < width - 1) { totalBorder += inspectNeighbor(p + 1, li, labels, opaque, borderCount, adjPixel); }
                if (py > 0) { totalBorder += inspectNeighbor(p - width, li, labels, opaque, borderCount, adjPixel); }
                if (py < height - 1) { totalBorder += inspectNeighbor(p + width, li, labels, opaque, borderCount, adjPixel); }
            }
            if (borderCount.size === 0 || totalBorder === 0) continue;

            // Pick the adjacent component with the longest shared border.
            // Tie-break: Lab distance from the noise seed to that neighbor pixel.
            let bestLabel = -1, bestCount = -1, bestDist = Infinity;
            const seedPixel = compSeed[li];
            for (const [nl, cnt] of borderCount) {
                const d = labDist2Px(lab, seedPixel, adjPixel.get(nl));
                if (cnt > bestCount || (cnt === bestCount && d < bestDist)) {
                    bestCount = cnt; bestLabel = nl; bestDist = d;
                }
            }
            if (bestLabel === -1) continue;

            // Guard a: dominance - winner must STRICTLY own more than 50% of the
            // border (enforces "obviously surrounded by a single color"). A pixel
            // sitting at a junction between two or more large regions is preserved.
            if (bestCount * 2 <= totalBorder) continue;

            // Guard b: min contrast - candidate must be a real outlier vs. the
            // replacement. Prevents flattening of gentle gradients.
            const target = adjPixel.get(bestLabel);
            if (labDist2Px(lab, seedPixel, target) < minContrast2) continue;

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

// Returns 1 if the neighbor was a valid border pixel (recorded), 0 otherwise.
function inspectNeighbor(np, ownLabel, labels, opaque, borderCount, adjPixel) {
    if (!opaque[np]) return 0;
    const nl = labels[np];
    if (nl === ownLabel) return 0;
    borderCount.set(nl, (borderCount.get(nl) || 0) + 1);
    if (!adjPixel.has(nl)) adjPixel.set(nl, np);
    return 1;
}
