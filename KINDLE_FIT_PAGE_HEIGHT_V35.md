# Kindle Voyage Fit Page height fix - v35

The Kindle manga reader no longer forces the page frame to the remaining device viewport height.

Changes:
- The viewport height is still used as a maximum Fit Page constraint.
- After preserving the manga page aspect ratio, `pageFrame` is set to the fitted image height (`targetH`).
- While a new image is loading, the frame stays `auto` instead of reserving the whole screen height.
- Old Kindle WebKit viewport detection now chooses the smallest sane viewport/screen height measurement.
- Fit Width and Zoom are unchanged.

This targets the Kindle-only symptom where a manga page is shorter than the empty reader frame below it.
