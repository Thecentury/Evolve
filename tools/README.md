# tools

## genCapSources.js

Regenerates `src/capSources.js`, the resource → cap-source map used by the
"why can't I build this?" explainer (`src/capGraph.js`).

```bash
node tools/genCapSources.js
```

`midLoop()` in `src/main.js` computes every resource cap imperatively, so the
mapping "building X raises the cap of resource Y" exists only as control flow.
This script recovers it by walking the cap block and matching each
`caps[...] +=` to its enclosing `if (global.<sector>[...])` guard.

**Re-run it after merging upstream.** It prints how many assignment sites it
found and lists anything it could not attribute — those should only ever be
race traits, shrine bonuses and the crate/container accounting. If the counts
move a lot, or a new unattributed line appears that names a building, the
mapping has drifted and wants a look. If the script cannot find the cap block
at all it exits non-zero rather than writing a bad map.
