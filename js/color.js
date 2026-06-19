// Color space conversions and distance helpers (shared by all pipeline stages).

export function rgbToLab(r, g, b) {
    let rr = r / 255, gg = g / 255, bb = b / 255;
    rr = rr > 0.04045 ? Math.pow((rr + 0.055) / 1.055, 2.4) : rr / 12.92;
    gg = gg > 0.04045 ? Math.pow((gg + 0.055) / 1.055, 2.4) : gg / 12.92;
    bb = bb > 0.04045 ? Math.pow((bb + 0.055) / 1.055, 2.4) : bb / 12.92;
    const x = (rr * 0.4124 + gg * 0.3576 + bb * 0.1805) / 0.95047;
    const y = (rr * 0.2126 + gg * 0.7152 + bb * 0.0722) / 1.00000;
    const z = (rr * 0.0193 + gg * 0.1192 + bb * 0.9505) / 1.08883;
    const f = t => t > 0.008856 ? Math.cbrt(t) : (7.787 * t) + 16 / 116;
    const fx = f(x), fy = f(y), fz = f(z);
    const L = (116 * fy) - 16;
    const a = 500 * (fx - fy);
    const bVal = 200 * (fy - fz);
    return { L, a, b: bVal };
}

// Squared Lab distance between two pixels in a flat Float32Array lab buffer
// where each pixel occupies 3 consecutive entries (L, a, b).
export function labDist2Px(lab, i, j) {
    const i3 = i * 3, j3 = j * 3;
    const dL = lab[i3] - lab[j3];
    const da = lab[i3 + 1] - lab[j3 + 1];
    const db = lab[i3 + 2] - lab[j3 + 2];
    return dL * dL + da * da + db * db;
}

// Squared Lab distance between two [L, a, b] array triplets.
export function labDist2Arr(a, b) {
    const dL = a[0] - b[0];
    const da = a[1] - b[1];
    const db = a[2] - b[2];
    return dL * dL + da * da + db * db;
}

// Euclidean Lab distance between two [L, a, b] array triplets.
export function labDistArr(a, b) {
    return Math.sqrt(labDist2Arr(a, b));
}

// Count distinct opaque colors in an RGBA pixel buffer.
export function countUniqueColors(pixels) {
    const set = new Set();
    for (let i = 0; i < pixels.length; i += 4) {
        if (pixels[i + 3] < 128) continue;
        set.add((pixels[i] << 16) | (pixels[i + 1] << 8) | pixels[i + 2]);
    }
    return set.size;
}
