// Consolidate lines / outlines: makes thin line structures use one consistent
// color instead of varying shades. Fixes issue #2.
//
// Approach:
//   1. Build connected components using Lab distance <= `unifyTolerance`
//      (4-neighborhood). This groups a line whose shading varies pixel-to-pixel
//      into a single component (exact-color components would shatter it into
//      size-1 pieces and miss it). Distinct, far-apart colors stay separate.
//   2. Detect thin ("line") components via morphological erosion. A component
//      is a line if iteratively eroding it (ceil(maxWidth/2) times) eliminates
//      it. This catches 1-3px outlines without touching filled regions.
//   3. For each line component pick a representative color = the most common
//      exact color among its pixels (so we reuse an existing color).
//   4. Cluster line components by representative color (Lab, union-find,
//      transitive) so disconnected pieces of the same outline also unify.
//   5. Repaint each multi-component cluster with the representative of its
//      largest component, and repaint each single-component line with its own
//      representative (this is what kills the per-pixel shading variation).
//
// Lines are PRESERVED (only their shading is unified), unlike the old outline
// pass which erased them.

import { rgbToLab, labDist2Px, labDist2Arr } from './color.js';

export function consolidateLines(pixels, width, height, options) {
    const maxWidth = options.maxWidth;
    const unifyTolerance = options.unifyTolerance;
    const tol2 = unifyTolerance * unifyTolerance;
    const total = width * height;

    // Precompute Lab + opacity for every pixel.
    const lab = new Float32Array(total * 3);
    const opaque = new Uint8Array(total);
    for (let i = 0; i < total; i++) {
        if (pixels[i * 4 + 3] >= 128) {
            opaque[i] = 1;
            const v = rgbToLab(pixels[i * 4], pixels[i * 4 + 1], pixels[i * 4 + 2]);
            lab[i * 3] = v.L;
            lab[i * 3 + 1] = v.a;
            lab[i * 3 + 2] = v.b;
        }
    }

    // 1. Similarity-based connected components (4-neighborhood).
    const labels = new Int32Array(total).fill(-1);
    const compMembers = [];
    const queue = new Int32Array(total);
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
                if (opaque[np] && labels[np] === -1 && labDist2Px(lab, p, np) <= tol2) {
                    labels[np] = nextLabel; queue[tail++] = np; members.push(np);
                }
            }
            if (px < width - 1) {
                const np = p + 1;
                if (opaque[np] && labels[np] === -1 && labDist2Px(lab, p, np) <= tol2) {
                    labels[np] = nextLabel; queue[tail++] = np; members.push(np);
                }
            }
            if (py > 0) {
                const np = p - width;
                if (opaque[np] && labels[np] === -1 && labDist2Px(lab, p, np) <= tol2) {
                    labels[np] = nextLabel; queue[tail++] = np; members.push(np);
                }
            }
            if (py < height - 1) {
                const np = p + width;
                if (opaque[np] && labels[np] === -1 && labDist2Px(lab, p, np) <= tol2) {
                    labels[np] = nextLabel; queue[tail++] = np; members.push(np);
                }
            }
        }
        compMembers.push(members);
        nextLabel++;
    }

    // 2. Detect thin (line) components and collect representatives.
    const erosionPasses = Math.max(1, Math.ceil(maxWidth / 2));
    const lineComps = [];
    for (let li = 0; li < compMembers.length; li++) {
        const members = compMembers[li];
        if (members.length < 2) continue; // single pixel: leave to despeckle
        if (!isLineComponent(members, width, height, erosionPasses)) continue;
        const rep = modeColor(pixels, members);
        const rlab = rgbToLab(rep[0], rep[1], rep[2]);
        lineComps.push({
            compIndex: li,
            rep,
            lab: [rlab.L, rlab.a, rlab.b],
            count: members.length
        });
    }
    if (lineComps.length === 0) return;

    // 3. Cluster line components by representative color (Lab, union-find).
    const n = lineComps.length;
    const parent = new Int32Array(n);
    for (let i = 0; i < n; i++) parent[i] = i;
    const find = x => {
        while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; }
        return x;
    };
    const union = (a, b) => { a = find(a); b = find(b); if (a !== b) parent[b] = a; };
    for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
            if (labDist2Arr(lineComps[i].lab, lineComps[j].lab) <= tol2) union(i, j);
        }
    }
    const groups = new Map();
    for (let i = 0; i < n; i++) {
        const root = find(i);
        let arr = groups.get(root);
        if (!arr) { arr = []; groups.set(root, arr); }
        arr.push(i);
    }

    // 4. Repaint. Multi-component clusters use the largest component's rep;
    //    single-component lines still get unified to their own rep (this is
    //    what removes the per-pixel shading variation within one line).
    for (const idxs of groups.values()) {
        let bestIdx = idxs[0], bestCount = -1;
        for (const i of idxs) {
            if (lineComps[i].count > bestCount) { bestCount = lineComps[i].count; bestIdx = i; }
        }
        const ur = lineComps[bestIdx].rep[0];
        const ug = lineComps[bestIdx].rep[1];
        const ub = lineComps[bestIdx].rep[2];
        for (const i of idxs) {
            const members = compMembers[lineComps[i].compIndex];
            for (const p of members) {
                pixels[p * 4] = ur;
                pixels[p * 4 + 1] = ug;
                pixels[p * 4 + 2] = ub;
            }
        }
    }
}

// Most common exact color among a set of pixels (ties: first reached).
function modeColor(pixels, members) {
    const counts = new Map();
    let bestKey = -1, bestCount = -1, best = [0, 0, 0];
    for (const p of members) {
        const r = pixels[p * 4], g = pixels[p * 4 + 1], b = pixels[p * 4 + 2];
        const key = (r << 16) | (g << 8) | b;
        const c = (counts.get(key) || 0) + 1;
        counts.set(key, c);
        if (c > bestCount) { bestCount = c; bestKey = key; best = [r, g, b]; }
    }
    return best;
}

// A component is a "line" if iteratively eroding it (4-connectivity) eliminates
// it within `passes` rounds. Erosion keeps only pixels whose 4 neighbors are all
// present in the current set.
function isLineComponent(members, width, height, passes) {
    let current = new Set(members);
    for (let pass = 0; pass < passes; pass++) {
        if (current.size === 0) return true;
        const next = new Set();
        for (const p of current) {
            const px = p % width;
            const py = (p / width) | 0;
            const left = px > 0 ? p - 1 : -1;
            const right = px < width - 1 ? p + 1 : -1;
            const up = py > 0 ? p - width : -1;
            const down = py < height - 1 ? p + width : -1;
            if (left !== -1 && current.has(left) &&
                right !== -1 && current.has(right) &&
                up !== -1 && current.has(up) &&
                down !== -1 && current.has(down)) {
                next.add(p);
            }
        }
        current = next;
    }
    return current.size === 0;
}
