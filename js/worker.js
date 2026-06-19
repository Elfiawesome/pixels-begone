// ES module worker. Receives a pixel buffer + options, runs the pipeline, and
// posts back progress and the final result. The output buffer is transferred
// (not copied) back to the main thread for efficiency.

import { refine } from './pipeline.js';

self.onmessage = (e) => {
    const { data, width, height, options } = e.data;
    try {
        const imageData = new ImageData(data, width, height);
        const { resultImageData, stats } = refine(imageData, options, (p) => {
            self.postMessage({ type: 'progress', progress: p });
        });
        const out = resultImageData.data;
        self.postMessage({
            type: 'done',
            data: out,
            width: resultImageData.width,
            height: resultImageData.height,
            stats
        }, [out.buffer]);
    } catch (err) {
        self.postMessage({ type: 'error', message: String((err && err.stack) || err) });
    }
};
