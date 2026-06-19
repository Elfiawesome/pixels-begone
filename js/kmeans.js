// Generic k-means with k-means++ initialization.
// Moved verbatim from the original index.html; exported for reuse.

export function kmeans(data, k, maxIter = 20) {
    const n = data.length;
    if (n === 0) return { centroids: [], labels: [] };
    const dim = data[0].length;
    const effectiveK = Math.min(k, n);
    const centroids = [];
    centroids.push(data[Math.floor(Math.random() * n)].slice());
    for (let c = 1; c < effectiveK; c++) {
        const dists = new Array(n).fill(Infinity);
        for (let i = 0; i < n; i++) {
            for (let j = 0; j < centroids.length; j++) {
                let d = 0;
                for (let dIdx = 0; dIdx < dim; dIdx++) d += (data[i][dIdx] - centroids[j][dIdx]) ** 2;
                if (d < dists[i]) dists[i] = d;
            }
        }
        const sum = dists.reduce((a, b) => a + b, 0);
        let r = Math.random() * sum;
        let picked = false;
        for (let i = 0; i < n; i++) {
            r -= dists[i];
            if (r <= 0) { centroids.push(data[i].slice()); picked = true; break; }
        }
        if (!picked) centroids.push(data[Math.floor(Math.random() * n)].slice());
    }
    let labels = new Array(n);
    for (let iter = 0; iter < maxIter; iter++) {
        for (let i = 0; i < n; i++) {
            let minDist = Infinity, best = 0;
            for (let j = 0; j < centroids.length; j++) {
                let d = 0;
                for (let dIdx = 0; dIdx < dim; dIdx++) d += (data[i][dIdx] - centroids[j][dIdx]) ** 2;
                if (d < minDist) { minDist = d; best = j; }
            }
            labels[i] = best;
        }
        const sums = new Array(centroids.length).fill(0).map(() => new Array(dim).fill(0));
        const counts = new Array(centroids.length).fill(0);
        for (let i = 0; i < n; i++) {
            const lbl = labels[i];
            counts[lbl]++;
            for (let d = 0; d < dim; d++) sums[lbl][d] += data[i][d];
        }
        let changed = false;
        for (let j = 0; j < centroids.length; j++) {
            if (counts[j] === 0) continue;
            for (let d = 0; d < dim; d++) {
                const newVal = sums[j][d] / counts[j];
                if (Math.abs(newVal - centroids[j][d]) > 0.001) changed = true;
                centroids[j][d] = newVal;
            }
        }
        if (!changed) break;
    }
    return { centroids, labels };
}
