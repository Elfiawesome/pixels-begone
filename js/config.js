// Single source of truth for default control values, URL serialization keys, and
// control<->option bindings. Change DEFAULTS here to re-tune the app's starting
// state without touching HTML or main.js.

export const DEFAULTS = {
    // Segmentation
    segments: 100,
    colorsPerSegment: 2,
    spatialWeight: 0.8,
    // Despeckle
    denoise: false,
    denoiseSize: 3,
    denoiseSimilarity: 6,
    denoiseMinContrast: 8,
    // Lines
    lines: true,
    lineWidth: 2,
    lineTolerance: 1,
    // Palette merge
    paletteMerge: true,
    paletteTolerance: 1,
    // Jaggies
    jaggies: false,
    // Hue jitter reduction
    hueSnap: false,
    hueSnapTolerance: 8,
    // Pillow-shading removal
    pillow: false,
    pillowStrength: 50,
    // Saturation / contrast boost
    colorAdjust: false,
    saturation: 130,
    contrast: 110,
    // Final color-count cap
    colorCap: false,
    colorCapTarget: 16,
    // Palette snap
    paletteSnap: false,
    paletteSnapPalette: 'pico8',
    paletteSnapCustom: '',
    // Ordered dithering
    dither: false,
    ditherMatrix: 4,
    // Palette display sort (shared by both palette strips)
    paletteSort: 'hue'
};

// Short keys for URL hash serialization. keep in sync with DEFAULTS keys.
export const URL_KEYS = {
    segments: 'seg',
    colorsPerSegment: 'cps',
    spatialWeight: 'comp',
    denoise: 'dn',
    denoiseSize: 'dns',
    denoiseSimilarity: 'dsim',
    denoiseMinContrast: 'dmc',
    lines: 'ln',
    lineWidth: 'lw',
    lineTolerance: 'lt',
    paletteMerge: 'pm',
    paletteTolerance: 'ptol',
    jaggies: 'jag',
    hueSnap: 'hs',
    hueSnapTolerance: 'hst',
    pillow: 'pl',
    pillowStrength: 'pls',
    colorAdjust: 'sc',
    saturation: 'sat',
    contrast: 'con',
    colorCap: 'cc',
    colorCapTarget: 'ccn',
    paletteSnap: 'ps',
    paletteSnapPalette: 'psp',
    paletteSnapCustom: 'psc',
    dither: 'dt',
    ditherMatrix: 'dtm',
    paletteSort: 'sort'
};

// Inverse of URL_KEYS for parsing.
export const KEY_FROM_URL = Object.fromEntries(
    Object.entries(URL_KEYS).map(([opt, key]) => [key, opt])
);

// Control bindings: how each option maps to a DOM element.
//   kind: 'range'  -> slider + synced number input (numId)
//          'check' -> checkbox toggle
//          'select'-> <select> dropdown
//          'text'  -> text input
export const CONTROLS = [
    { key: 'segments',           kind: 'range',  id: 'segmentsSlider',      numId: 'segmentsValue'      },
    { key: 'colorsPerSegment',   kind: 'range',  id: 'colorsPerSlider',     numId: 'colorsPerValue'     },
    { key: 'spatialWeight',      kind: 'range',  id: 'compactnessSlider',   numId: 'compactnessValue'   },
    { key: 'denoise',            kind: 'check',  id: 'denoiseCheckbox'                                  },
    { key: 'denoiseSize',        kind: 'range',  id: 'denoiseSizeSlider',   numId: 'denoiseSizeValue'   },
    { key: 'denoiseSimilarity',  kind: 'range',  id: 'denoiseSimSlider',    numId: 'denoiseSimValue'    },
    { key: 'denoiseMinContrast', kind: 'range',  id: 'denoiseMcSlider',     numId: 'denoiseMcValue'     },
    { key: 'lines',              kind: 'check',  id: 'linesCheckbox'                                    },
    { key: 'lineWidth',          kind: 'range',  id: 'lineWidthSlider',     numId: 'lineWidthValue'     },
    { key: 'lineTolerance',      kind: 'range',  id: 'lineTolSlider',       numId: 'lineTolValue'       },
    { key: 'paletteMerge',       kind: 'check',  id: 'paletteMergeCheckbox'                             },
    { key: 'paletteTolerance',   kind: 'range',  id: 'paletteTolSlider',    numId: 'paletteTolValue'    },
    { key: 'jaggies',            kind: 'check',  id: 'jaggiesCheckbox'                                  },
    { key: 'hueSnap',            kind: 'check',  id: 'hueSnapCheckbox'                                  },
    { key: 'hueSnapTolerance',   kind: 'range',  id: 'hueSnapTolSlider',    numId: 'hueSnapTolValue'    },
    { key: 'pillow',             kind: 'check',  id: 'pillowCheckbox'                                   },
    { key: 'pillowStrength',     kind: 'range',  id: 'pillowStrSlider',     numId: 'pillowStrValue'     },
    { key: 'colorAdjust',        kind: 'check',  id: 'colorAdjustCheckbox'                              },
    { key: 'saturation',         kind: 'range',  id: 'satSlider',           numId: 'satValue'           },
    { key: 'contrast',           kind: 'range',  id: 'conSlider',           numId: 'conValue'           },
    { key: 'colorCap',           kind: 'check',  id: 'colorCapCheckbox'                                 },
    { key: 'colorCapTarget',     kind: 'range',  id: 'colorCapTargetSlider',numId: 'colorCapTargetValue'},
    { key: 'paletteSnap',        kind: 'check',  id: 'paletteSnapCheckbox'                              },
    { key: 'paletteSnapPalette', kind: 'select', id: 'paletteSnapPaletteSelect'                         },
    { key: 'paletteSnapCustom',  kind: 'text',   id: 'paletteSnapCustomInput'                           },
    { key: 'dither',             kind: 'check',  id: 'ditherCheckbox'                                   },
    { key: 'ditherMatrix',       kind: 'select', id: 'ditherMatrixSelect'                               },
    { key: 'paletteSort',        kind: 'select', id: 'paletteSortSelect'                                }
];
