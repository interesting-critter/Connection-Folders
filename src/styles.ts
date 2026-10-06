/**
 * FOLDER_STYLES — collapsible folder UI for the Connections drawer tab.
 *
 * PORTED, NOT INVENTED. Every value below was copied byte-for-byte from
 * Lumiverse core so that Connection Folders is visually indistinguishable
 * from the folder UI already shipped in the Character Browser, Persona and
 * Regex tabs:
 *
 *   frontend/src/components/panels/PersonaManager.module.css  (primary)
 *     .folderGroup, .folderHeaderRow, .folderHeader, .folderChevron,
 *     .folderChevronOpen, .folderName, .folderCount, .folderActionBtn,
 *     .folderDeleteBtn, .folderRenameRow, .folderRenameInput
 *
 *   frontend/src/components/panels/RegexPanel.module.css        (secondary)
 *     .folderActionBtn hover-reveal + `any-hover: none` fallback
 *
 *   frontend/src/components/shared/FolderDropdown.module.css    (mobile input)
 *     `@media (pointer: coarse)` no-zoom font-size rule
 *
 * ── Why these selectors are NOT all `.cf-root`-prefixed ───────────────────
 *
 * Folder headers are injected as DIRECT CHILDREN of Lumiverse's own `.list`
 * container and interleaved with native React rows via the CSS `order`
 * property. They are therefore NOT inside any extension-owned root: there is
 * no `.cf-root` ancestor above them. A `.cf-root`-prefixed header rule would
 * match nothing, so every rule that can match a header is anchored on the
 * header row's OWN class, `.cf-folder-header-row` (a self class for the row's
 * box, a descendant class for its children):
 *
 *     .cf-folder-header-row { … }                        the row's own box
 *     .cf-folder-header-row .cf-folder-name { … }        its descendants
 *
 * `.cf-root` is still the right prefix for content the extension genuinely
 * MOUNTS itself — the `ctx.dom.inject` slot wrappers, the assign modal body and
 * the create/rename/delete modal bodies (see `ui/assign.ts`, `ui/crud.ts`) —
 * because those really do sit inside a `.cf-root` element this extension
 * created. `dom/controller.ts` stamps the host list with the marker class
 * `cf-list-anchor`; that class carries NO declarations and must never be given
 * any. In particular there is deliberately no `.cf-root { … }` layout rule
 * here: `.cf-root` used to be stamped onto the host's `.list`, and a bare
 * `.cf-root` rule therefore overrode Lumiverse's own `.list`
 * (`ConnectionManager.module.css` lines 125-129, `gap: 2px`) with `gap: 12px`
 * for as long as the extension was enabled.
 *
 * The only other intentional deviations from the source are:
 *   1. Class names are renamed to a global `cf-` prefixed, kebab-case scheme
 *      (CSS-module hashes cannot be referenced from injected markup).
 *   2. `.cf-folder-header` additionally resets button appearance
 *      (`font`, `color`, `display`, `align-items`, `width: 100%`) so the same
 *      class works on a `<button>` and on a `<div role="button" tabindex="0">`,
 *      plus a `:focus-visible` ring for keyboard users.
 *
 * RE-SYNC: after an upstream theme change, diff the files named above and port
 * any changed value. All colours are `var(--lumiverse-*)` tokens (see
 * frontend/src/theme/variables.css) — never hardcode a literal colour.
 */
export const FOLDER_STYLES: string = `
/* ── Folder header row ──────────────────────────────── */
/* SELF class: the row's own box. Headers are direct children of Lumiverse's
   own \`.list\`, so there is no \`.cf-root\` above them — anchoring on the row's
   own class is what makes the whole header subtree styleable at all. */
.cf-folder-header-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

/* Ported from PersonaManager .folderHeader. Works on <button> (appearance is
   reset below) and on <div role="button" tabindex="0">. */
.cf-folder-header-row .cf-folder-header {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 1;
  min-width: 0;
  width: 100%;
  padding: 4px 4px;
  background: none;
  border: none;
  cursor: pointer;
  text-align: left;
  border-radius: 6px;
  transition: background 0.15s ease;
  /* button / role=button parity */
  font: inherit;
  color: inherit;
  appearance: none;
  -webkit-appearance: none;
}

.cf-folder-header-row .cf-folder-header:hover {
  background: var(--lumiverse-fill-subtle, rgba(255, 255, 255, 0.04));
}

/* Keyboard-only focus ring — not present in the source modules, which never
   styled a focus state. */
.cf-folder-header-row .cf-folder-header:focus-visible {
  outline: 2px solid var(--lumiverse-primary);
  outline-offset: -2px;
  background: var(--lumiverse-fill-subtle, rgba(255, 255, 255, 0.04));
}

/* ── Chevron ────────────────────────────────────────── */
.cf-folder-header-row .cf-folder-chevron {
  color: var(--lumiverse-text-dim);
  flex-shrink: 0;
  transition: transform 0.15s ease;
}

.cf-folder-header-row .cf-folder-chevron-open {
  transform: rotate(90deg);
}

/* ── Label ──────────────────────────────────────────── */
.cf-folder-header-row .cf-folder-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: calc(11px * var(--lumiverse-font-scale, 1));
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.4px;
  color: var(--lumiverse-text-muted);
}

/* ── Count pill ─────────────────────────────────────── */
.cf-folder-header-row .cf-folder-count {
  font-size: calc(10px * var(--lumiverse-font-scale, 1));
  color: var(--lumiverse-text-dim);
  background: var(--lumiverse-fill-subtle);
  border-radius: 999px;
  padding: 0 5px;
  line-height: 1.6;
}

/* ── Action buttons ─────────────────────────────────── */
/* SELF class, no ancestor requirement, and deliberately NO \`opacity\` here.
   \`.cf-folder-action\` is worn by two different buttons in two different
   parents:

     • the header's rename/delete pair — children of \`.cf-folder-header-row\`
     • the per-row "assign folder" button that \`ui/row-affix.ts\` injects into
       the HOST's native \`.itemActions\`, which is inside
       \`[data-component="ConnectionItem"]\` and has NO \`.cf-folder-header-row\`
       ancestor

   The hover-reveal below is therefore scoped to the header row, and the row
   button's own always-visible override lives in \`ui/actions.ts\`. Keeping the
   shared box rule ancestor-free is what lets both buttons share it without
   either of them depending on stylesheet load order. */
.cf-folder-action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--lumiverse-text-dim);
  cursor: pointer;
  transition: opacity var(--lumiverse-transition-fast), color var(--lumiverse-transition-fast), background var(--lumiverse-transition-fast);
}

.cf-folder-action:hover:not(:disabled) {
  background: var(--lumiverse-fill-subtle, rgba(255, 255, 255, 0.04));
  color: var(--lumiverse-text);
}

.cf-folder-action:disabled {
  opacity: 0.5;
  cursor: default;
}

.cf-folder-delete:hover:not(:disabled) {
  color: var(--lumiverse-danger, #ff5c7a);
}

/* ── Header actions only: hover-reveal (from RegexPanel) ── */
/* (0,2,0) and gated on a \`.cf-folder-header-row\` ancestor, which the per-row
   assign button never has — so this rule cannot hide that button, whatever
   order the stylesheets are injected in. */
.cf-folder-header-row .cf-folder-action {
  opacity: 0;
}

.cf-folder-header-row:hover .cf-folder-action {
  opacity: 1;
}

.cf-folder-header-row:focus-within .cf-folder-action {
  opacity: 1;
}

/* Touch-only devices have no hover, so reveal the folder actions permanently
   (see RegexPanel .folderActionBtn for why \`any-hover\`). */
@media (any-hover: none) {
  .cf-folder-header-row .cf-folder-action {
    opacity: 1;
  }
}

/* ── Inline rename input (create/rename dialog) ─────── */
/* \`.cf-root\`-prefixed: this input really does live inside the \`.cf-root\`
   modal body that \`ui/crud.ts\` mounts. */
.cf-root .cf-folder-rename-input {
  flex: 1;
  min-width: 0;
  height: 28px;
  border: 1px solid var(--lumiverse-border, rgba(255, 255, 255, 0.08));
  border-radius: 8px;
  background: var(--lumiverse-bg-elevated, rgba(255, 255, 255, 0.04));
  color: var(--lumiverse-text);
  padding: 0 10px;
  font-size: calc(12px * var(--lumiverse-font-scale, 1));
}

.cf-root .cf-folder-rename-input:focus {
  outline: none;
  border-color: var(--lumiverse-accent, #7c5cff);
}

/* Keep the dialog's rename field at iOS's no-zoom size. Ported from
   FolderDropdown.module.css. */
@media (pointer: coarse) {
  .cf-root .cf-folder-rename-input {
    font-size: 16px;
  }
}
`;

/**
 * BADGE_STYLES — small status chrome for Connection Folders.
 *
 * PORTED, NOT INVENTED. Sizing, radii and colour-mix percentages are taken
 * from the Lumiverse core files named below; all colours are
 * `var(--lumiverse-*)` tokens (frontend/src/theme/variables.css).
 *
 *   .cf-unsupported-banner
 *                        <- SingleTabSetting .warningPill (warning colour-mix
 *                           idiom), App.module.css .*Banner (bottom rule +
 *                           tinted background) and Panel.module.css message
 *                           typography
 *
 * RE-SYNC: after an upstream theme change, diff
 * frontend/src/components/settings/SingleTabSetting.module.css,
 * frontend/src/App.module.css and frontend/src/theme/variables.css.
 */
export const BADGE_STYLES: string = `
/* ── Self-disable banner ────────────────────────────── */
.cf-root .cf-unsupported-banner {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 7px 10px;
  border-radius: 6px;
  border-bottom: 1px solid color-mix(in srgb, var(--lumiverse-warning, #f59e0b) 45%, transparent);
  background: color-mix(in srgb, var(--lumiverse-warning, #f59e0b) 16%, transparent);
  color: var(--lumiverse-warning, #f59e0b);
  font-size: calc(11px * var(--lumiverse-font-scale, 1));
  line-height: 1.5;
}

.cf-root .cf-unsupported-banner-title {
  font-weight: 700;
  margin: 0;
  font-size: calc(11px * var(--lumiverse-font-scale, 1));
}

.cf-root .cf-unsupported-banner-body {
  margin: 0;
  color: var(--lumiverse-text-muted);
  font-size: calc(11px * var(--lumiverse-font-scale, 1));
}
`;
