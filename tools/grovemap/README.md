# Grovemap

Obsidian-style map of the Nibbin codebase: files are nodes, imports and doc links are edges.

Run from repo root:

    node tools/grovemap/grovemap.mjs

Then open `tools/grovemap/grovemap.html` (self-contained — data embedded, no server needed).

Green edges = code imports; gray = doc links/mentions. Node size = connectedness; color = top-level area. Search, drag, zoom, click a node to focus its neighborhood, toggle areas in the legend.

CI regenerates the map at every milestone gate so the picture never goes stale.
