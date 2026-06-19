// Pillow-shading removal (experimental, off by default).
//
// "Pillow shading" is the AI hallmark where a region is dark at the borders and
// brightens toward the center (a radially-symmetric glow). Real pixel art uses
// directional lighting instead. This pass detects pillow-shaded regions and
// re-shades them with a single directional gradient.
//
// Approach:
//   1. Build similarity-based connected components (Lab distance <= 25, fixed)
//      to find candidate shading regions. Large flat regions are skipped.
//   2. For each region, sample the mean luminance at the border vs. the center.
//      If border is notably DARKER than center (the pillow signature), it is a
//      candidate.
//   3. Compute a directional light vector from the region's luminance gradient
//      (the direction of brightest pixels). If the region is too radially
//      symmetric (no clear direction), force a top-left light.
//   4. Re-shade: keep the region's mean luminance and its luminance range, but
//      remap each pixel's lightness from "distance-from-center" to "projection
//      onto the light vector" scaled by `strength`. Strength 0 = no change,
//      100 = full directional override.
//   5. Preserve hue and saturation (operate in HSL L only).

import { rgbToLab, labDist2Px } from './color.js';
import { rgbToHsl, hslToRgb } from './hue-snap.js';

export function removePillow(pixels, width, height, options) {
    const strength = options.strength / 100;
    if (strength <= 0) return;
    const total = width * height;
    const tol2 = 25 * 25;

    const lab = new Float32Array(total * 3);
    const opaque = new Uint8Array(total);
    for (let i = 0; i < total; i++) {
        if (pixels[i * 4 + 3] >= 128) {
            opaque[i] = 1;
            const v = rgbToLab(pixels[i * 4], pixels[i * 4 + 1], pixels[i * 4 + 2]);
            lab[i * 3] = v.L; lab[i * 3 + 1] = v.a; lab[i * 3 + 2] = v.b;
        }
    }

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
            const px = p % width, py = (p / width) | 0;
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

    for (const members of compMembers) {
        if (members.length < 24) continue; // too small to assess shading

        // Bounding box + centroid + luminance stats.
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        let sumX = 0, sumY = 0, sumL = 0;
        const ls = new Float32Array(members.length);
        for (let i = 0; i < members.length; i++) {
            const p = members[i];
            const px = p % width, py = (p / width) | 0;
            if (px < minX) minX = px; if (px > maxX) maxX = px;
            if (py < minY) minY = py; if (py > maxY) maxY = py;
            sumX += px; sumY += py;
            const L = lab[p * 3];
            ls[i] = L;
            sumL += L;
        }
        const n = members.length;
        const meanL = sumL / n;
        const cx = sumX / n, cy = sumY / n;

        // Variance / range; skip near-flat regions.
        let minL = 255, maxL = 0;
        for (let i = 0; i < n; i++) { if (ls[i] < minL) minL = ls[i]; if (ls[i] > maxL) maxL = ls[i]; }
        const range = maxL - minL;
        if (range < 8) continue;

        // Pillow signature: border pixels darker than center pixels.
        const halfW = (maxX - minX) / 2, halfH = (maxY - minY) / 2;
        const rad = Math.max(halfW, halfH);
        let borderL = 0, borderN = 0, centerL = 0, centerN = 0;
        for (let i = 0; i < n; i++) {
            const p = members[i];
            const px = p % width, py = (p / width) | 0;
            const dx = px - cx, dy = py - cy;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist > rad * 0.7) { borderL += ls[i]; borderN++; }
            else if (dist < rad * 0.35) { centerL += ls[i]; centerN++; }
        }
        if (borderN === 0 || centerN === 0) continue;
        const borderMean = borderL / borderN;
        const centerMean = centerL / centerN;
        if (centerMean - borderMean < 5) continue; // not pillow-shaped

        // Directional light vector: direction toward brightest pixels.
        let vx = 0, vy = 0;
        for (let i = 0; i < n; i++) {
            const p = members[i];
            const px = p % width, py = (p / width) | 0;
            const w = ls[i] - meanL; // positive for bright pixels
            vx += (px - cx) * w;
            vy += (py - cy) * w;
        }
        const vmag = Math.sqrt(vx * vx + vy * vy);
        let lx, ly;
        if (vmag < 1) { lx = -0.707; ly = -0.707; } // fallback: top-left
        else { lx = vx / vmag; ly = vy / vmag; }

        // Re-shade: new L = meanL + (projection onto light vector) * (range/2),
        // blended with the original L by `strength`.
        const scale = (range / 2) / rad; // luminance per unit distance
        for (let i = 0; i < n; i++) {
            const p = members[i];
            const px = p % width, py = (p / width) | 0;
            const proj = (px - cx) * lx + (py - cy) * ly;
            const targetL = meanL + proj * scale;
            const newL = ls[i] * (1 - strength) + targetL * strength;
            const r = pixels[p * 4] / 255, g = pixels[p * 4 + 1] / 255, b = pixels[p * 4 + 2] / 255;
            const hsl = rgbToHsl(r, g, b);
            const clampedL = Math.max(0, Math.min(1, newL / 100));
            const rgb = hslToRgb(hsl.h, hsl.s, clampedL);
            pixels[p * 4] = Math.round(rgb[0] * 255);
            pixels[p * 4 + 1] = Math.round(rgb[1] * 255);
            pixels[p * 4 + 2] = Math.round(rgb[2] * 255);
        }
    }
}

