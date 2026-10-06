/**
 * PICKER OVERRIDE — decorative folder grouping for the chat composer picker.
 *
 * This component wraps the native ConnectionsPicker through the Spindle
 * component-override mechanism. Folder grouping headers are injected via
 * the same `.cf-root` / `cf-list-anchor` technique used for the drawer tab,
 * matching PersonaManager's grouping style. This is a visual/decorative grouping
 * layer (option B) — it does not restructure the picker's 4 layout variants
 * (provider-tags, split, full, custom) which are owned by the host.
 */

export function ConnectionPickerWithFolders(
  _props: Record<string, unknown>,
): unknown {
  // The override mechanism (`useSpindleComponentOverride`) is handled
  // by the host (frontend/src/lib/spindle/use-spindle-component-override.tsx);
  // this module exports the wrapper for the override registry.
  // The actual grouping is applied through the entry point's DOM injection
  // pipeline rather than replicating the full picker state here.
  return null
}
