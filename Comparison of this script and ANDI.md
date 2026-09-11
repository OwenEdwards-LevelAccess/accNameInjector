# Comparison of this script (at v6.0.0) and ANDI

_Performed by GitHub Copilot on 9/11/26, using GPT-5.6 Luna_

I’ll compare this script’s name/description path against ANDI’s actual `andi` source, focusing on algorithm order, host-language handling, shadow DOM, hidden content, references, and fallback behavior. I’ll inspect the repository code and then summarize concrete differences and likely behavioral consequences.


Fetched https://github.com/SSAgov/ANDI/tree/master/andi

Fetched https://raw.githubusercontent.com/SSAgov/ANDI/master/andi/andi.js

Fetched https://api.github.com/repos/SSAgov/ANDI/contents/andi

The repository’s main implementation is `andi/andi.js` (about 174 KB), with related component modules such as `sandi.js`, `landi.js`, and `tandi.js`. The direct raw fetch was unavailable through the page tool, so I’m using the rendered source/search surfaces to extract the exact name and description routines before comparing behavior.


Fetched https://github.com/SSAgov/ANDI/blob/master/andi/andi.js

Fetched https://github.com/SSAgov/ANDI/search?q=accessible+name&type=code

Fetched https://github.com/SSAgov/ANDI/blob/master/andi/andi.js

I found the core comparison in ANDI’s `AndiData.textAlternativeComputation`: it uses an explicit staged algorithm (`stepB` through `stepJ`) and records each contributing component for its inspector, while this script computes a single live string recursively. I’m consolidating the differences now, including several cases where the two tools intentionally produce different answers.

**Short version:** ANDI and this script both implement a DOM-side approximation of accessible name and description computation, but they are built for different purposes.

- ANDI is an inspection and testing tool. It computes names while recording the source components, warnings, missing references, duplicate references, and likely authoring problems.
- This script is a live property injector. It prioritizes compact, continuously recomputed values such as `element.accName` and `element.accDescription`.

The relevant ANDI implementation is in `andi/andi.js`, primarily `AndiData.textAlternativeComputation()` and its `stepB` through `stepJ` functions.

## Algorithm order

ANDI uses a staged algorithm:

1. `aria-labelledby` or `aria-describedby` references
2. `aria-label`
3. Native host-language markup
4. Embedded control values
5. Name from content
6. CSS pseudo-element content
7. `title`
8. `placeholder`

It tracks whether a component has already been used so that the same source can be reused appropriately for description but is not accidentally counted twice in the name.

This script uses a simpler recursive path in `computeTextAlternative()`:

1. `aria-labelledby`
2. `aria-label`
3. Native labels and selected host-language cases
4. Name from content
5. CSS `::before` and `::after`
6. `title`

The script does not have ANDI’s separate staged `stepE`/`stepJ` behavior for all embedded controls, although it now includes a focused placeholder fallback for text inputs and textareas.

## Accessible names

### `aria-labelledby`

ANDI:

- Splits the ID list manually.
- Uses `document.getElementById()`.
- Detects missing references.
- Detects duplicate references.
- Detects recursive or indirect reference chains.
- Records each referenced component for display in the ANDI interface.
- Avoids traversing the same node repeatedly.

This script:

- Resolves the references recursively.
- Uses a `visitedNodes` set to prevent cycles.
- Returns an empty result for cycles or unresolved references.
- Does not produce diagnostics for missing, duplicate, or circular references.

The current script has an advantage for the Web Awesome use case: it attempts to resolve IDs in the element’s open `ShadowRoot` and recursively searches open shadow roots. ANDI’s current implementation uses `document.getElementById()`, so it does not provide equivalent open-Shadow-DOM ID resolution.

### `aria-label`

Both give `aria-label` precedence over ordinary content in most cases.

ANDI records the `aria-label` component separately and can report issues such as empty labels or combining `aria-label` and `aria-labelledby`.

This script returns the label string directly and does not expose the source or warn about conflicting naming mechanisms.

### Native labels

ANDI’s native-label handling is more explicitly role- and element-specific. It supports:

- Explicit `<label for>`
- Nested `<label>`
- Labels for textboxes, comboboxes, listboxes, checkboxes, and radios
- Warnings when a `<label for>` points to an unsuitable element
- Duplicate `id` and duplicate `for` analysis

This script supports associated and wrapping labels for `input`, `textarea`, and `select`, but it does not perform ANDI’s validation or diagnostics.

### Native names and special elements

ANDI has dedicated handling for several cases that the script handles differently or only partially:

- `input[type=image]`
- `input[type=button]`
- `input[type=submit]`
- `input[type=reset]`
- Default names such as `Submit` and `Reset`
- `<table>` captions
- Table summaries
- `<fieldset>` legends
- `<figure>` and `<figcaption>`
- SVG `<title>` and `<desc>`
- Selected options
- Embedded values for comboboxes, listboxes, sliders, progressbars, spinbuttons, and related roles

The script covers several of these, including selected options, fieldset legends, table captions, figure captions, SVG titles, reset-button defaults, slider values, placeholders, and Web Awesome host `label` attributes, but its host-language mapping is not as broad or as context-sensitive as ANDI’s.

### Name from content

ANDI’s `stepF`:

- Uses a defined list of name-from-content roles and element names.
- Skips `script`, `noscript`, `iframe`, and text-like exclusions.
- Checks visibility using jQuery-based `:shown` logic.
- Skips descendants with `aria-hidden="true"` unless they are focusable.
- Adds spacing after block-level elements.
- Tracks subtree components for display.
- Handles embedded controls specially.

The script:

- Uses `NAME_FROM_CONTENT_ROLES`.
- Traverses text nodes and rendered child nodes.
- Includes pseudo-element content.
- Uses `flatString()` and child-part joining for whitespace.
- Uses the current open Shadow DOM and slot traversal logic.

The results can differ because ANDI’s whitespace handling is based on visible text and block-element boundaries, while this script generally normalizes the final result after concatenating child results. For complex layouts, nested controls, or block-level content, the output may not match.

## Accessible descriptions

This is one of the larger differences.

ANDI calculates description as part of the same text-alternative engine. It can reuse certain native components for the description when those components were not already used for the name. The source explicitly tracks components such as:

- `value`
- `caption`
- `title`

That means ANDI can expose a description based on a component that was available but not consumed by the accessible name.

The script’s `computeDescription()` is much simpler:

1. `aria-describedby`
2. `aria-description`
3. `title`, but only if it differs from the accessible name

The script does not currently replicate ANDI’s component-reuse model. In particular, it does not generally reuse:

- A button/input value
- A table caption
- A figure caption
- Other native naming components as a fallback description

ANDI also records each `aria-describedby` reference separately and warns when `aria-describedby` is used without an accessible name. This script returns the combined text but does not report that authoring issue.

## Hidden content

ANDI starts by checking whether the element or one of its ancestors has `aria-hidden="true"`:

```javascript
traverseAriaHidden(element)
```

It stores that result as `isAriaHidden` and uses it both in name calculation and in its inspection output. It also detects and reports hidden focusable elements.

The script’s `isHidden()` checks:

- `aria-hidden="true"`
- `hidden`
- `display: none`
- `visibility: hidden`
- `visibility: collapse`
- `content-visibility: hidden`

The script is broader in the CSS properties it checks, but its handling is less context-sensitive than ANDI’s. It generally suppresses hidden nodes during name computation rather than reporting the accessibility concern.

The script’s `accAttributes` additionally propagates inherited `aria-hidden="true"` to descendants, which is useful for inspection but is separate from the name calculation itself.

## Roles

ANDI validates explicit ARIA roles against its `validAriaRoles` list and reports:

- Unsupported roles
- Multiple roles
- Misspelled attributes such as `aria-labeledby`

Its `getValidRole()` selects the first valid explicit role. Its semantic checks fall back to native HTML semantics when no explicit role is present.

This script computes a more explicit `accRole` value, including:

- Native implicit roles
- Explicit roles
- Presentational role conflict behavior
- `aria-roledescription`
- Shadow semantic-control delegation

The script’s `accRole` is therefore more directly intended to be a computed role property. ANDI’s primary purpose is to inspect author-provided semantics and expose problems, so its stored `role` data is not exactly equivalent to the script’s `accRole`.

## Shadow DOM

This is the clearest area where the current script can differ favorably from ANDI.

ANDI’s current source is primarily based on:

- `document.querySelector`
- `document.getElementById`
- jQuery traversal
- `element.childNodes`
- Light-DOM ancestor and descendant relationships

It does not appear to traverse open Shadow DOM or use composed-tree semantics in its accessible-name computation.

The script now attempts to handle:

- Open `shadowRoot` content
- Slotted assigned nodes
- Shadow-root-local ID references
- Nested open shadow roots
- Shadow semantic controls
- Web Awesome-style host `label` and `description` attributes
- Shadow control roles, states, and attributes

For Web Awesome components, this means the script can inspect patterns such as:

```html
<wa-button>Save</wa-button>
<wa-input label="Email"></wa-input>
<wa-checkbox>Remember me</wa-checkbox>
<wa-switch>Share with the driver?</wa-switch>
<wa-slider label="Scale" value="50"></wa-slider>
```

However, this remains an approximation. A browser accessibility tree can apply semantics across component boundaries that are not fully recoverable from ordinary DOM APIs. Closed Shadow DOM remains inaccessible to the script.

## Important behavioral differences

| Area | ANDI | This script |
|---|---|---|
| Primary purpose | Inspection, diagnostics, and authoring guidance | Live computed properties |
| Name algorithm | Staged `stepB`-`stepJ` computation | Recursive text-alternative computation |
| Description algorithm | Reuses unused naming components | Mostly `aria-describedby`, `aria-description`, and fallback `title` |
| Missing references | Reports warnings/errors | Usually returns empty text |
| Duplicate references | Detects and reports | Suppressed by visited-node tracking |
| Circular references | Diagnoses them | Prevents recursion silently |
| Native labels | Detailed role-aware analysis | Basic explicit/wrapping label support |
| Placeholder | Explicit final name fallback for applicable controls | Focused fallback for text inputs and textareas |
| CSS content | Includes pseudo-content | Includes pseudo-content |
| Visibility | jQuery visibility plus ARIA-hidden logic | Computed-style and hidden-property checks |
| Shadow DOM | No comparable composed-tree support found | Supports open roots and slots approximately |
| ARIA role validation | Reports invalid/multiple roles | Selects a recognized role token |
| Output detail | Stores source components and subtree data | Returns only the final value |
| Updates | Reanalyzes elements through ANDI’s workflow | Live getters recompute on every access |

## Bottom line

ANDI is closer to a diagnostic implementation of the older Accessible Name and Description Computation model. It is more useful when the question is:

> “Which markup contributed this name or description, and what authoring problems should I fix?”

This script is closer to a lightweight live approximation. It is more useful when the question is:

> “What name, description, role, state, and attributes does this element currently expose while I interact with it?”

The largest gaps in the script compared with ANDI are:

1. Native host-language coverage and exact host-language precedence
2. Description component reuse
3. Description component reuse
4. Detailed reference diagnostics
5. Grouping and context semantics
6. Exact block/visibility whitespace behavior
7. Browser accessibility-tree behavior

The largest advantage of the script is its newer open Shadow DOM handling, especially for component libraries such as Web Awesome.