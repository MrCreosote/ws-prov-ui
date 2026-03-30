# TODO

## Features

- **Identical objects — persistent links**: Hovering a node already highlights all
  duplicate instances (same UPA) with a purple outline and dashed purple lines between
  them. A follow-on feature would be a toggle to keep those links visible without
  requiring hover. This is feasible without forcing a graph relayout: duplicate edges can
  be added/removed at any time without calling `layout().run()`, so node positions stay
  fixed.
  - Also think about if there's a better wsy to handle duplicate nodes. Collapsing the tree to
    a DAG gets super ugly

- **Redraw stability**: When a node is expanded and the graph redraws, it's really easy
  to lose your place in the graph. See if the redraw can be made more stable so the zoom
  level doesn't change and the expanded node stays in the same place. Maybe temporarily
  highlight the expanded node and its children

- **Copied links** Show copied links in the graph. Probably needs some thought re layout

- **Version selection**: Currently always loads the latest version of a selected
  object. Add a version picker (using `get_object_history`) so users can browse
  provenance for any historical version.

- **Copy UPA / link to object**: Button on nodes to copy the UPA or open the
  object in the KBase Narrative Interface.

- **Graph export**: Save the current graph as PNG or SVG.

- **Multiple environments**: Add a dropdown to switch between kbase.us,
  appdev.kbase.us, and ci.kbase.us. Currently hardcoded to production.

- **Filter objects by type**: Add a type filter to the object picker. The
  challenge is that `list_objects` supports a `type` parameter but
  `get_names_by_prefix` does not, so the two code paths (prefill vs. prefix
  search) can't be filtered consistently without backend support. Options to
  explore: client-side post-filter on prefix results (drops matches silently),
  or abandoning prefix search in favour of `list_objects` with both `type` and
  `startafter` for pagination, or add type filter to prefix filter workspace side
  (may require new indexes)

