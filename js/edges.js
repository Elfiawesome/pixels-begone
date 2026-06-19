// Optional edge jaggie cleanup. Off by default because it can soften crisp
// pixel-art corners.
//
// Conservative strategy: scan every 2x2 block. If exactly three pixels share a
// color and one differs (a staircase corner), flip the lone pixel to the
// majority color ONLY when it is a protrusion tip (it has at most one same-color
// 4-neighbor). This smooths the worst staircase edges without erasing
// legitimate 1px detail or introducing new colors.

export function cleanJaggies(pixels, width, height) {
    const total = width * height;
    const out = new Uint8ClampedArray(pixels);

    for (let y = 0; y < height - 1; y++) {
        for (let x = 0; x < width - 1; x++) {
            const tl = y * width + x;
            const tr = tl + 1;
            const bl = tl + width;
            const br = bl + 1;
            if (pixels[tl * 4 + 3] < 128 || pixels[tr * 4 + 3] < 128 ||
                pixels[bl * 4 + 3] < 128 || pixels[br * 4 + 3] < 128) continue;

            const positions = [tl, tr, bl, br];
            const colors = positions.map(idx => (pixels[idx * 4] << 16) | (pixels[idx * 4 + 1] << 8) | pixels[idx * 4 + 2]);

            const counts = new Map();
            for (const c of colors) counts.set(c, (counts.get(c) || 0) + 1);
            if (counts.size !== 2) continue;

            let majority = -1, minority = -1;
            for (const [c, cnt] of counts) {
                if (cnt === 3) majority = c;
                else if (cnt === 1) minority = c;
            }
            if (majority === -1 || minority === -1) continue;

            let minorityIdx = -1, majorityIdx = -1;
            for (let i = 0; i < 4; i++) {
                if (colors[i] === minority) minorityIdx = positions[i];
                else majorityIdx = positions[i];
            }

            // Only flip if the minority pixel is a protrusion tip (<=1 same-color neighbor).
            const mpx = minorityIdx % width;
            const mpy = (minorityIdx / width) | 0;
            let same = 0;
            if (mpx > 0 && sameColor(pixels, minorityIdx, minorityIdx - 1)) same++;
            if (mpx < width - 1 && sameColor(pixels, minorityIdx, minorityIdx + 1)) same++;
            if (mpy > 0 && sameColor(pixels, minorityIdx, minorityIdx - width)) same++;
            if (mpy < height - 1 && sameColor(pixels, minorityIdx, minorityIdx + width)) same++;
            if (same > 1) continue;

            out[minorityIdx * 4] = pixels[majorityIdx * 4];
            out[minorityIdx * 4 + 1] = pixels[majorityIdx * 4 + 1];
            out[minorityIdx * 4 + 2] = pixels[majorityIdx * 4 + 2];
        }
    }

    for (let i = 0; i < pixels.length; i++) pixels[i] = out[i];
}

function sameColor(pixels, a, b) {
    return pixels[a * 4] === pixels[b * 4] &&
        pixels[a * 4 + 1] === pixels[b * 4 + 1] &&
        pixels[a * 4 + 2] === pixels[b * 4 + 2];
}
