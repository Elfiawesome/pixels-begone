// Hue jitter reduction: kills AI's subtle hue drift across a surface by snapping
// every pixel's hue to the dominant hue of its color region.
//
// Approach:
//   1. Build similarity-based connected components (Lab distance <= tolerance,
//      4-neighborhood) so a "surface" with gentle hue drift forms one component.
//   2. For each component, find the dominant hue (weighted by pixel count) in
//      HSL space, plus the region's average saturation and lightness.
//   3. Re-color every pixel in the region with that dominant hue while keeping
//      its own L and S. Pixels that already match the dominant hue are unchanged.
//
// This preserves shading (L) and saturation (S) but removes the rainbow-y micro
// hue shifts AI pixel art tends to have within one material.

import { rgbToLab, labDist2Px } from './color.js';

export function snapHue(pixels, width, height, options) {
    const tolerance = options.tolerance;
    const tol2 = tolerance * tolerance;
    const total = width * height;

    const lab = new Float32Array(total * 3);
    const opaque = new Uint8Array(total);
    for (let i = 0; i < total; i++) {
        if (pixels[i * 4 + 3] >= 128) {
            opaque[i] = 1;
            const v = rgbToLab(pixels[i * 4], pixels[i * 4 + 1], pixels[i * 4 + 2]);
            lab[i * 3] = v.L; lab[i * 3 + 1] = v.a; lab[i * 3 + 2] = v.b;
        }
    }

    // Connected components by Lab similarity.
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

    // Per-component dominant hue.
    for (const members of compMembers) {
        if (members.length < 2) continue;

        // Accumulate hue as a vector (sin, cos) weighted by count, so the mean
        // hue is correct across the 0/360 wraparound. Only count pixels that
        // actually have saturation (gray pixels contribute nothing).
        let sx = 0, sy = 0, weight = 0;
        for (const p of members) {
            const r = pixels[p * 4] / 255, g = pixels[p * 4 + 1] / 255, b = pixels[p * 4 + 2] / 255;
            const hsl = rgbToHsl(r, g, b);
            if (hsl.s <= 0.02) continue;
            const rad = hsl.h * Math.PI / 180;
            sx += Math.cos(rad);
            sy += Math.sin(rad);
            weight++;
        }
        if (weight === 0) continue; // fully gray region: nothing to snap
        const domHue = (Math.atan2(sy, sx) * 180 / Math.PI + 360) % 360;

        for (const p of members) {
            const r = pixels[p * 4] / 255, g = pixels[p * 4 + 1] / 255, b = pixels[p * 4 + 2] / 255;
            const hsl = rgbToHsl(r, g, b);
            if (hsl.s <= 0.02) continue; // leave grays alone
            // Skip pixels already very close to the dominant hue.
            let delta = Math.abs(hsl.h - domHue);
            if (delta > 180) delta = 360 - delta;
            if (delta <= 1.5) continue;
            const rgb = hslToRgb(domHue, hsl.s, hsl.l);
            pixels[p * 4] = Math.round(rgb[0] * 255);
            pixels[p * 4 + 1] = Math.round(rgb[1] * 255);
            pixels[p * 4 + 2] = Math.round(rgb[2] * 255);
        }
    }
}

export function rgbToHsl(r, g, b) {
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const l = (max + min) / 2;
    let h = 0, s = 0;
    if (max !== min) {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        switch (max) {
            case r: h = (g - b) / d + (g < b ? 6 : 0); break;
            case g: h = (b - r) / d + 2; break;
            default: h = (r - g) / d + 4;
        }
        h *= 60;
    }
    return { h, s, l };
}

export function hslToRgb(h, s, l) {
    h /= 360;
    let r, g, b;
    if (s === 0) {
        r = g = b = l;
    } else {
        const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
        const p = 2 * l - q;
        r = hueToChannel(p, q, h + 1 / 3);
        g = hueToChannel(p, q, h);
        b = hueToChannel(p, q, h - 1 / 3);
    }
    return [r, g, b];
}

function hueToChannel(p, q, t) {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
}
