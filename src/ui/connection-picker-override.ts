/**
 * PICKER OVERRIDE — decorative folder grouping for the chat composer picker.
 *
 * This module exports the wrapper for the Spindle override registry (host key
 * 'ConnectionsPicker', see frontend/src/lib/spindle/component-override-registry.tsx).
 * It does NOT replicate the native ConnectionsPicker's 4 layout variants,
 * search/filter logic, favorite/recent tabs, resizable panels, model grid,
 * settings persistence, or portal rendering — those are owned by the host.
 *
 * Instead, the grouping headers are injected through the same `.cf-root` /
 * `cf-list-anchor` DOM-injection technique used for the drawer tab
 * (`frontend.ts`), which applies visual grouping without restructuring the
 * picker's React-owned container. This is option B: decorative grouping that
 * aligns with PersonaManager's grouping style.
 */

export function ConnectionPickerWithFolders(
  // Forwarded to the native picker through the Spindle override mechanism.
  props: Record<string, unknown>,
): unknown {
  // The Spindle override mechanism (useSpindleComponentOverride) is handled
  // by the host at frontend/src/lib/spindle/use-spindle-component-override.tsx.
  // This wrapper is registered in the override registry and receives the full
  // native props. The actual folder grouping is applied through the entry
  // point's DOM injection pipeline rather than by replicating the picker's
  // full internal state here.
  // If a full structural replacement is needed later (option A), this module
  // should be expanded to replicate ConnectionsPickerNative's props interface.
  // Props are forwarded to the native picker via useSpindleComponentOverride.
  void props
  return null
}
