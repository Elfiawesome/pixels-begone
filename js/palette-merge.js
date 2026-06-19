// Global palette merge.
// After per-segment quantization the image may still contain many near-identical
// shades (an AI-art hallmark). This stage agglomeratively merges colors whose
// Lab distance is within `tolerance` into a single count-weighted average color,
// independent of which segment they came from.
//
// Uses a 3D grid in Lab space so each pass is near-linear in the number of
// unique colors, keeping it fast even when segments * colorsPerSegment is large.

import { rgbToLab, labDist2Arr } from './color.js';

export function mergePalette(pixels, options) {
    const tolerance = options.tolerance;
    if (tolerance <= 0) return;

    const total = pixels.length / 4;

    // 1. Collect unique colors with pixel counts.
    const colorMap = new Map(); // key -> { r, g, b, lab:[L,a,b], count }
    for (let i = 0; i < total; i++) {
        if (pixels[i * 4 + 3] < 128) continue;
        const r = pixels[i * 4], g = pixels[i * 4 + 1], b = pixels[i * 4 + 2];
        const key = (r << 16) | (g << 8) | b;
        let entry = colorMap.get(key);
        if (!entry) {
            const lab = rgbToLab(r, g, b);
            entry = { r, g, b, lab: [lab.L, lab.a, lab.b], count: 0, key };
            colorMap.set(key, entry);
        }
        entry.count++;
    }
    if (colorMap.size <= 1) return;

    let clusters = Array.from(colorMap.values()).map(c => ({
        lab: c.lab,
        r: c.r, g: c.g, b: c.b,
        count: c.count,
        members: [c]
    }));

    const tol2 = tolerance * tolerance;
    const cellKey = (L, a, b) => Math.round(L / tolerance) + ',' + Math.round(a / tolerance) + ',' + Math.round(b / tolerance);

    // 2. Greedy multi-pass merge via a Lab-space grid + union-find.
    let safety = 0;
    let changed = true;
    while (changed && safety++ < 256) {
        changed = false;

        const grid = new Map();
        for (let i = 0; i < clusters.length; i++) {
            const cl = clusters[i];
            const k = cellKey(cl.lab[0], cl.lab[1], cl.lab[2]);
            let bucket = grid.get(k);
            if (!bucket) { bucket = []; grid.set(k, bucket); }
            bucket.push(i);
        }

        const parent = new Int32Array(clusters.length);
        for (let i = 0; i < clusters.length; i++) parent[i] = i;
        const find = x => {
            while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; }
            return x;
        };
        const union = (a, b) => { a = find(a); b = find(b); if (a !== b) parent[b] = a; };

        for (let i = 0; i < clusters.length; i++) {
            const cl = clusters[i];
            const cx = Math.round(cl.lab[0] / tolerance);
            const cy = Math.round(cl.lab[1] / tolerance);
            const cz = Math.round(cl.lab[2] / tolerance);
            for (let dx = -1; dx <= 1; dx++) {
                for (let dy = -1; dy <= 1; dy++) {
                    for (let dz = -1; dz <= 1; dz++) {
                        const bucket = grid.get((cx + dx) + ',' + (cy + dy) + ',' + (cz + dz));
                        if (!bucket) continue;
                        for (const j of bucket) {
                            if (j <= i) continue;
                            if (labDist2Arr(clusters[i].lab, clusters[j].lab) <= tol2) {
                                union(i, j);
                                changed = true;
                            }
                        }
                    }
                }
            }
        }

        if (!changed) break;

        // 3. Group clusters by union root and rebuild merged clusters.
        const groups = new Map();
        for (let i = 0; i < clusters.length; i++) {
            const root = find(i);
            let arr = groups.get(root);
            if (!arr) { arr = []; groups.set(root, arr); }
            arr.push(i);
        }

        const nextClusters = [];
        for (const members of groups.values()) {
            if (members.length === 1) {
                nextClusters.push(clusters[members[0]]);
                continue;
            }
            let tot = 0, r = 0, g = 0, bl = 0, L = 0, a = 0, b = 0;
            const allMembers = [];
            for (const m of members) {
                const c = clusters[m];
                tot += c.count;
                r += c.r * c.count; g += c.g * c.count; bl += c.b * c.count;
                L += c.lab[0] * c.count; a += c.lab[1] * c.count; b += c.lab[2] * c.count;
                for (const mm of c.members) allMembers.push(mm);
            }
            nextClusters.push({
                lab: [L / tot, a / tot, b / tot],
                r: Math.round(r / tot), g: Math.round(g / tot), b: Math.round(bl / tot),
                count: tot,
                members: allMembers
            });
        }
        clusters = nextClusters;
    }

    // 4. Build a remap from every original color key to its merged color.
    const remap = new Map();
    for (const cl of clusters) {
        for (const m of cl.members) {
            remap.set(m.key, { r: cl.r, g: cl.g, b: cl.b });
        }
    }

    // 5. Apply remap to the pixel buffer.
    for (let i = 0; i < total; i++) {
        if (pixels[i * 4 + 3] < 128) continue;
        const r = pixels[i * 4], g = pixels[i * 4 + 1], b = pixels[i * 4 + 2];
        const rep = remap.get((r << 16) | (g << 8) | b);
        if (rep && (rep.r !== r || rep.g !== g || rep.b !== b)) {
            pixels[i * 4] = rep.r;
            pixels[i * 4 + 1] = rep.g;
            pixels[i * 4 + 2] = rep.b;
        }
    }
}
