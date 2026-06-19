# Pixels Begone

Pixels Begone is a small browser-based tool for cleaning up AI-generated pixel
art.

AI pixel art tends to look "off": it uses far too many colors, scatters tiny
noise pixels everywhere, shades outlines inconsistently, and drifts in hue
across surfaces that should be flat. Pixels Begone takes an image and reduces
that AI-ness so the result reads more like hand-made pixel art.

Drop or paste an image, tweak the controls, and export the result. You can:

- Simplify the color count while keeping the shapes intact.
- Remove stray noise pixels and unify messy outlines.
- Merge near-duplicate colors and snap the final image to classic retro
  palettes (PICO-8, Game Boy, NES, and more).
- Inspect the exact color palette of both the original and the result, hover a
  color to see where it appears in the image, and click to copy its hex code.

## Running it

Open it through a tiny local server (not by double-clicking the file). From the
project folder run:

    python -m http.server 8000

Then visit http://localhost:8000 in your browser.
