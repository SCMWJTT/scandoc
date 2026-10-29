// ScanDoc settings you can tune by hand.
// Edit, commit, push. No build step.
window.CONFIG = {
  build: 1,

  // Images
  maxSide: 4096,       // stored original is shrunk to this long side (px). Strips EXIF/GPS too.
  workSide: 1600,      // long side of the working image used in the editor (px)
  previewSide: 1000,   // long side of the page preview in the editor (px)
  thumbSide: 320,      // long side of the page thumbnails (px)
  cacheImages: 4,      // working images kept in memory

  // Pages. w/h in inches (portrait). The page flips to landscape for wide scans.
  pageSizes: {
    letter: { name: 'Letter (8.5 x 11 in)', w: 8.5,  h: 11 },
    legal:  { name: 'Legal (8.5 x 14 in)',  w: 8.5,  h: 14 },
    a4:     { name: 'A4 (210 x 297 mm)',    w: 8.27, h: 11.69 },
    orig:   { name: 'Original aspect' }
  },
  origLongInches: 11,  // long side of an "Original aspect" page
  landscapeAbove: 1.2, // scan wider than this (width/height) goes on a landscape page

  // Export
  dpiChoices: [100, 150, 200, 300],
  targets: [           // compress-to-size choices; kb 0 = no limit
    { label: 'Best quality', kb: 0 },
    { label: '200 KB', kb: 200 },
    { label: '500 KB', kb: 500 },
    { label: '1 MB',   kb: 1024 },
    { label: '2 MB',   kb: 2048 }
  ],
  targetScales: [1, 0.85, 0.7, 0.58, 0.48, 0.4, 0.33, 0.27],  // sizes tried, biggest first
  targetMinQ: 0.35,    // lowest JPEG quality tried
  targetMaxQ: 0.92,    // highest JPEG quality tried
  pdfOverhead: 700,    // bytes allowed per page for PDF structure

  // Cleanup
  paperBias: 0.95,     // paper-white: lower = whiter paper, more clipping
  presetOrder: ['original', 'auto', 'bw', 'gray', 'boost'],
  presetNames: { original: 'Original', auto: 'Auto', bw: 'Black & white', gray: 'Gray', boost: 'Color boost' },
  cleanBase: {         // every slider and switch, at neutral
    paperWhite: false, gray: false, bw: false, level: 165,
    exposure: 0, brightness: 0, contrast: 0, sharpness: 0, saturation: 100
  },
  presets: {
    original: {},
    auto:  { paperWhite: true, contrast: 15, sharpness: 35 },
    bw:    { paperWhite: true, bw: true, level: 165, sharpness: 30 },
    gray:  { paperWhite: true, gray: true, contrast: 20, sharpness: 30 },
    boost: { saturation: 135, contrast: 20, sharpness: 30 }
  },

  // First-run defaults (changeable in Settings)
  defaults: {
    theme: 'slate',
    pageSize: 'letter',
    fit: 'fit',          // fit | fill | stretch
    margin: 0.25,        // inches (Fit and Original aspect only)
    dpi: 150,
    quality: 0.8,        // JPEG quality when "Best quality" is chosen
    preset: 'auto',      // cleanup applied to new pages
    target: 0            // last compress-to-size choice (kb)
  }
};
