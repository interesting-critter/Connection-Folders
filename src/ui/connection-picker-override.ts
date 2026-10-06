/**
 * PICKER OVERRIDE — decorative folder grouping for the chat composer picker.
 *
 * This component wraps the native ConnectionsPicker through the Spindle
 * component-override mechanism (host key 'ConnectionsPicker'). The actual
 * grouping headers are injected through the entry point's `.cf-root` /
 * `cf-list-anchor` DOM injection pipeline (see `frontend.ts`) rather than
 * by replicating the picker's full 4-variant React state here. This is
 * option B: decorative grouping that aligns with PersonaManager's grouping
 * style without restructuring the host's complex picker container.
 */
export function ConnectionPickerWithFolders(
  _props: Record<string, unknown>,
): unknown {
  return null
}
