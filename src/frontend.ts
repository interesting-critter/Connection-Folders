/**
 * ENTRY POINT — wires the Connection Folders extension into Lumiverse's
 * Connections drawer tab.
 *
 * This is the ONLY module that knows about the Spindle runtime. Everything it
 * touches is injected into it:
 *
 *   - persistence comes from `ctx.settings` (the host namespaces bare keys to
 *     `spindle:<identifier>:<key>`, so we never compose the prefix ourselves);
 *   - the profile list comes from the FREE `connections.profiles` state
 *     selector (credentials stripped, `metadata` intact), re-ordered through
 *     the same `connectionsOrder` pass the native `ConnectionManager` applies,
 *     because row ↔ profile mapping is positional;
 *   - every dialog is a host modal (`ctx.ui.showModal` / `ctx.ui.showConfirm`).
 *
 * No Spindle permissions are requested: the only WRITE is `ConnectionFolderApi`
 * over the session-authenticated REST API, which the extension reaches with
 * plain `fetch` rather than a permissioned bridge.
 *
 * HARD RULE for the DOM layer: the folder headers are appended to the HOST's
 * list container, which is NOT inside our stamped extension root. Anything that
 * decorates the host's own DOM must therefore degrade quietly — a failed probe
 * shows a banner, it never throws into the host or reorders rows it does not
 * understand.
 */

import type { SpindleFrontendContext } from 'lumiverse-spindle-types'

import { FolderController } from './dom/controller'
import { FOLDER_ATTR, type FolderHeaderOptions } from './dom/headers'
import { locateList, locateRows, locateTabRoot } from './dom/locate'
import { UNCATEGORIZED_KEY, getProfileFolder, mergeFolderNames, setProfileFolderMetadata, type FolderGroup } from './folders/model'
import { ConnectionFolderApi, resolveOrder, migrateProfilesFolder, clearProfilesFolder } from './folders/profile'
import { FolderNameStore, type FolderNameStorage } from './folders/store'
import { BADGE_STYLES, FOLDER_STYLES } from './styles'
import { ACTION_STYLES, createNewFolderButton } from './ui/actions'
import { ASSIGN_STYLES, openFolderAssignModal } from './ui/assign'
import { CRUD_STYLES, confirmDeleteFolder, promptCreateFolder, promptRenameFolder } from './ui/crud'
import { RowAffixManager } from './ui/row-affix'
import type { ConnectionProfile, ScopedDom } from './types'

/** Drawer tab we attach to. Matches the host's own built-in tab id. */
const CONNECTIONS_TAB_ID = 'connections'

/** Settings keys. BARE — the host prepends `spindle:<identifier>:` itself. */
const FOLDER_NAMES_KEY = 'connectionFolders'
const COLLAPSED_FOLDERS_KEY = 'collapsedFolders'

/** Label for the bucket that means "this profile has no folder". */
const UNCATEGORIZED_LABEL = 'Uncategorized'

/**
 * Entry-point-only layout shim.
 *
 * Our stylesheets are `.cf-root`-prefixed for containment, and `inject()`
 * stamps the wrapper it returns with the extension id — but NOT with `.cf-root`.
 * We add `.cf-root` to that wrapper ourselves so injected chrome picks up the
 * shared rules, and `display: contents` keeps the wrapper out of the host's
 * flex layout (the "New folder" slot sits inside Lumiverse's own
 * `.createActions` row, which must keep its own alignment).
 */
const ENTRY_STYLES = `
.cf-root.cf-inline-slot {
  display: contents;
}
`

/** All sheets this extension owns, concatenated for a single injection. */
const ALL_STYLES = [FOLDER_STYLES, BADGE_STYLES, ACTION_STYLES, ASSIGN_STYLES, CRUD_STYLES, ENTRY_STYLES].join('\n')

/** Every log line the extension emits is prefixed so it is greppable. */
const LOG_PREFIX = '[connection-folders]'

/**
 * Run `work`, falling back to a known-safe value.
 *
 * Nothing here may reject into the host: an extension-owned async failure
 * becomes a `console.warn` plus a degraded (never broken) UI, because the host
 * has no way to recover from a promise it never awaited.
 */
async function settle<T>(label: string, work: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await work()
  } catch (cause) {
    console.warn(`${LOG_PREFIX} ${label} failed`, cause)
    return fallback
  }
}

/** Accept only the array-of-strings shape the store and settings row produce. */
function toStringArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return raw.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0)
}

/**
 * Collapse-state identity for a grouping key.
 *
 * `folders/model.ts` buckets unfiled profiles under the EMPTY STRING, but
 * `UNCATEGORIZED_KEY` is the reserved, storable identity for that bucket: an
 * empty string in the persisted settings row would be indistinguishable from a
 * missing value, and the name is already reserved against user folders by
 * `ui/crud.ts`. Only the collapse set uses this — the header's `folder` MUST
 * stay the raw `group.folder` or the controller cannot match its header.
 */
function collapseKey(folder: string): string {
  return folder || UNCATEGORIZED_KEY
}

export async function setup(ctx: SpindleFrontendContext): Promise<() => void> {
  const scopedDom = ctx.dom as ScopedDom
  const disposables: Array<() => void> = []

  let disposed = false
  /** Self-disable banner wrapper; null while the extension is supported. */
  let banner: Element | null = null

  /* ── 1. Styles ────────────────────────────────────────────────────────── */

  /**
   * GLOBAL scope, deliberately — do NOT "fix" this to `{ scope: 'root' }`.
   *
   * Root scoping rewrites our rules to `[data-spindle-ext-id] .cf-root …`,
   * which only matches DOM the host has stamped as extension-owned. Our folder
   * headers are appended directly to Lumiverse's own connection list
   * container, so they sit OUTSIDE any stamped root: scoped styles would apply
   * to nothing at all — headers, chevrons, counts, action buttons and the
   * self-disable banner would all render as unstyled default buttons.
   * Containment is instead guaranteed by the `.cf-root` prefix that every
   * selector in every sheet already carries.
   */
  const removeStyle = scopedDom.addStyle(ALL_STYLES, { scope: 'global' })

  /* ── 2. Folder-name persistence ────────────────────────────────────────── */

  const settings = ctx.settings
  // Used only against a host that predates `ctx.settings` (optional in the
  // published typings), so the extension degrades instead of crashing.
  const memorySettings = new Map<string, unknown>()

  const storage: FolderNameStorage = {
    async get(key) {
      if (!settings) return memorySettings.get(key)
      try {
        return await settings.get(key)
      } catch {
        // A missing settings row surfaces as `undefined` upstream; nothing else
        // must be allowed to break the drawer.
        return undefined
      }
    },
    async set(key, value) {
      if (!settings) {
        memorySettings.set(key, value)
        return
      }
      await settings.set(key, value)
    },
  }

  const store = new FolderNameStore(storage, FOLDER_NAMES_KEY)
  await settle('loading folder names', () => store.load(), [] as string[])

  disposables.push(store.subscribe(() => {
    if (disposed) return
    refreshFolderNames()
  }))

  /* ── 3. Collapsed-state persistence ────────────────────────────────────── */

  /**
   * Explicit collapse toggles ONLY.
   *
   * Default is EVERYTHING EXPANDED: Lumiverse's own PersonaManager
   * auto-collapses named folders on first load, but a connections list is
   * short, and hiding the user's connections behind a closed header by default
   * reads as data loss. Nothing auto-derived is ever written here — only what
   * the user actually clicked.
   */
  const explicitCollapsed = new Set<string>()
  if (settings) {
    const stored = await settle(
      'loading collapsed folders',
      () => settings.get(COLLAPSED_FOLDERS_KEY),
      undefined,
    )
    for (const folder of toStringArray(stored)) explicitCollapsed.add(folder)
  }

  function persistCollapsed(): void {
    if (!settings || disposed) return
    const snapshot = Array.from(explicitCollapsed)
    // Fire-and-forget: a failed write costs only the collapse state, and an
    // unhandled rejection would be reported to the user as a host bug.
    void settings.set(COLLAPSED_FOLDERS_KEY, snapshot).catch((cause: unknown) => {
      console.warn(`${LOG_PREFIX} could not persist collapsed folders`, cause)
    })
  }

  /* ── 4. Controller wiring ─────────────────────────────────────────────── */

  const api = new ConnectionFolderApi()
  /** Profiles in host render order; index-aligned with the DOM rows. */
  let orderedProfiles: ConnectionProfile[] = []
  let mounted = false
  let affix: RowAffixManager | null = null

  const controller = new FolderController({
    profiles: [],
    folderNames: mergeFolderNames(store.getNames(), []),
    onRenameFolder: (folder) => {
      void handleRename(folder)
    },
    onDeleteFolder: (folder) => {
      void handleDelete(folder)
    },
    render: renderHeaders,
  })

  // Restore explicit toggles before the first mount: `toggleCollapsed` only
  // reconciles against a live host, so this is a cheap, DOM-free seed.
  for (const folder of explicitCollapsed) {
    if (!controller.isCollapsed(folder)) controller.toggleCollapsed(folder)
  }

  /** Presentation only — labels and which actions exist are decided here. */
  function renderHeaders(
    groups: FolderGroup<ConnectionProfile>[],
    _collapsed: Set<string>,
  ): FolderHeaderOptions[] {
    return groups.map((group) => {
      const key = collapseKey(group.folder)
      const uncategorized = group.folder === ''
      return {
        // MUST equal `group.folder`: the controller keys its headers by it and
        // a mismatch silently drops the header instead of updating it.
        folder: group.folder,
        label: uncategorized ? UNCATEGORIZED_LABEL : group.folder,
        count: group.profiles.length,
        collapsed: controller.isCollapsed(key),
        onToggle: () => toggleCollapsed(key),
        // The synthetic bucket is not a real folder: there is nothing to
        // rename, and deleting it would read as "clear every assignment".
        ...(uncategorized
          ? {}
          : {
              onRename: () => {
                void handleRename(group.folder)
              },
              onDelete: () => {
                void handleDelete(group.folder)
              },
            }),
      }
    })
  }

  function toggleCollapsed(key: string): void {
    controller.toggleCollapsed(key)
    // Read the resulting state back out of the controller instead of assuming
    // a direction, so the persisted set can never drift from the screen.
    if (controller.isCollapsed(key)) explicitCollapsed.add(key)
    else explicitCollapsed.delete(key)
    persistCollapsed()
    scheduleSync()
  }

  /* ── 5. Folder name CRUD ──────────────────────────────────────────────── */

  async function handleRename(folder: string): Promise<void> {
    const renamed = await settle(
      `renaming "${folder}"`,
      () =>
        promptRenameFolder(ctx, {
          folder,
          folders: store.getNames(),
          onRename: async (oldName, newName) => {
            const nextNames = await store.rename(oldName, newName)
            const targets = orderedProfiles.filter((p) => getProfileFolder(p) === oldName)
            await Promise.all(
              targets.map(async (p) => {
                await api.setFolder(p, newName)
                p.metadata = setProfileFolderMetadata(p.metadata, newName)
              }),
            )
            if (explicitCollapsed.has(oldName)) {
              explicitCollapsed.delete(oldName)
              explicitCollapsed.add(newName)
              persistCollapsed()
            }
            if (controller.isCollapsed(oldName)) {
              controller.toggleCollapsed(oldName)
              if (!controller.isCollapsed(newName)) {
                controller.toggleCollapsed(newName)
              }
            }
            return nextNames
          },
        }),
      null,
    )
    if (disposed || renamed === null) return
    refreshFolderNames()
  }

  async function handleDelete(folder: string): Promise<void> {
    const targets = orderedProfiles.filter((profile) => getProfileFolder(profile) === folder)
    const count = targets.length
    await settle(
      `deleting "${folder}"`,
      () =>
        confirmDeleteFolder(ctx, {
          folder,
          count,
          onDelete: async (name) => {
            const nextNames = await store.remove(name)
            await Promise.all(
              targets.map(async (p) => {
                await api.clearFolder(p)
                p.metadata = setProfileFolderMetadata(p.metadata, '')
              }),
            )
            if (explicitCollapsed.has(name)) {
              explicitCollapsed.delete(name)
              persistCollapsed()
            }
            if (controller.isCollapsed(name)) {
              controller.toggleCollapsed(name)
            }
            return nextNames
          },
        }),
      false,
    )
    if (disposed) return
    refreshFolderNames()
  }

  async function handleCreateFolder(): Promise<void> {
    const created = await settle(
      'creating a folder',
      () =>
        promptCreateFolder(ctx, {
          folders: store.getNames(),
          onCreate: (name) => store.create(name),
        }),
      null,
    )
    if (disposed || created === null) return
    refreshFolderNames()
  }

  /** Push the merged name list into the controller. */
  function refreshFolderNames(): void {
    controller.setFolderNames(mergeFolderNames(store.getNames(), orderedProfiles))
    scheduleSync()
  }

  /* ── 6. Per-row assignment ────────────────────────────────────────────── */

  function openAssign(profile: ConnectionProfile): void {
    void settle(`assigning a folder to "${profile.name}"`, async () => {
      await openFolderAssignModal(ctx, {
        profile,
        folders: store.getNames(),
        onCreateFolder: (name) => store.create(name),
        onAssign: async (folder) => {
          try {
            await api.setFolder(profile, folder)
            profile.metadata = setProfileFolderMetadata(profile.metadata, folder)
            refreshFolderNames()
          } catch (cause) {
            // Re-thrown so the modal can surface it inline (its own error
            // channel), but logged first — an unlogged rejection would be
            // invisible in the field.
            console.warn(`${LOG_PREFIX} folder assignment failed for "${profile.name}"`, cause)
            throw cause
          }
        },
      })
    }, undefined)
  }

  /* ── 7. "New folder" button ───────────────────────────────────────────── */

  let newFolderSlot: Element | null = null

  /**
   * Lumiverse's own create-actions row (`.createActions`), located STRUCTURALLY:
   * it is a flex row of siblings, and the actions div is the first sibling
   * before the list that holds a button. Nothing here references a hashed
   * CSS-module class.
   */
  function locateCreateActions(list: HTMLElement): HTMLElement | null {
    const manager = list.parentElement
    if (!manager) return null
    for (const child of Array.from(manager.children)) {
      if (child === list) break
      const el = child as HTMLElement
      if (el.querySelector('button')) return el
    }
    return null
  }

  /**
   * Inject the button beside "New Connection". Pure nice-to-have: every failure
   * path returns quietly and folder grouping carries on without it.
   */
  function injectNewFolderButton(list: HTMLElement): void {
    if (newFolderSlot?.isConnected) return

    const actions = locateCreateActions(list)
    let slot: Element | null = null
    if (actions) {
      slot = scopedDom.inject(actions, '')
    } else {
      // Fall back to the top of our own list, where the first header lands.
      const firstHeader = list.querySelector(`[${FOLDER_ATTR}]`)
      if (!firstHeader) return
      slot = scopedDom.inject(firstHeader, '', 'beforebegin')
    }
    if (!slot) return

    slot.classList.add('cf-root', 'cf-inline-slot')
    slot.appendChild(
      createNewFolderButton({
        label: 'New folder',
        onCreate: () => {
          void handleCreateFolder()
        },
      }),
    )
    newFolderSlot = slot
  }

  /* ── 8. Profiles ──────────────────────────────────────────────────────── */

  let profilesToken = 0

  /** Guarded, so a teardown during an in-flight read cannot resurrect DOM. */
  function isLive(token: number): boolean {
    return !disposed && token === profilesToken
  }

  async function applyProfiles(raw: unknown): Promise<void> {
    const profiles = Array.isArray(raw) ? (raw as ConnectionProfile[]) : []
    const token = (profilesToken += 1)

    const order = await settle('reading the connections order', () => api.readOrder(), {})
    if (!isLive(token)) return

    // `resolveOrder` is a faithful port of the host's own pass, so our
    // index-based row ↔ profile mapping matches what was rendered.
    orderedProfiles = resolveOrder(order, profiles)
    controller.setProfiles(orderedProfiles)
    controller.setFolderNames(mergeFolderNames(store.getNames(), orderedProfiles))
    ensureMounted()
    scheduleSync()
  }

  const state = ctx.state
  if (state) {
    disposables.push(
      state.subscribe<ConnectionProfile[]>('connections.profiles', (profiles) => {
        void applyProfiles(profiles)
      }),
    )
    void settle(
      'the initial profile read',
      async () => applyProfiles(state.get('connections.profiles')),
      undefined,
    )
  }

  /* ── 9. Lifecycle ─────────────────────────────────────────────────────── */

  let syncScheduled = false

  /**
   * Attach the per-row buttons. Runs after a successful mount: both the list
   * element and the resolved profile order have to exist first.
   */
  function ensureAffix(list: HTMLElement): void {
    if (affix) {
      affix.sync()
      return
    }
    affix = new RowAffixManager({
      list,
      rows: () => locateRows(list),
      profileForIndex: (index: number) => orderedProfiles[index],
      currentFolder: (profile: ConnectionProfile) => getProfileFolder(profile),
      onAssign: (profile: ConnectionProfile) => openAssign(profile),
      labelFor: (profile: ConnectionProfile, folder: string) =>
        `Move "${profile.name}" to a folder (current: ${folder || UNCATEGORIZED_LABEL})`,
    })
    affix.sync()
  }

  /**
   * Coalesce affix syncs onto the same frame cadence the controller reconciles
   * on, so the two never fight over one pass of the DOM.
   */
  function scheduleSync(): void {
    if (syncScheduled || disposed || !affix) return
    syncScheduled = true
    const run = (): void => {
      syncScheduled = false
      if (disposed || !affix) return
      affix.sync()
    }
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run)
    else void Promise.resolve().then(run)
  }

  function showUnsupportedBanner(reason: string): void {
    if (banner) {
      const body = banner.querySelector('.cf-unsupported-banner-body')
      if (body) body.textContent = `${reason} Connections are still listed normally.`
      return
    }
    const tabRoot = locateTabRoot()
    if (!tabRoot) return

    const wrapper = scopedDom.inject(tabRoot, '', 'afterbegin')
    wrapper.classList.add('cf-root')

    const note = document.createElement('div')
    note.className = 'cf-unsupported-banner'
    note.setAttribute('role', 'status')

    const title = document.createElement('p')
    title.className = 'cf-unsupported-banner-title'
    title.textContent = 'Connection folders are unavailable'

    const body = document.createElement('p')
    body.className = 'cf-unsupported-banner-body'
    // Built with textContent — the reason is never interpolated into markup.
    body.textContent = `${reason} Connections are still listed normally.`

    note.append(title, body)
    wrapper.appendChild(note)
    banner = wrapper
  }

  function clearBanner(): void {
    if (!banner) return
    ctx.dom.uninject(banner)
    banner = null
  }

  /**
   * Mount on demand.
   *
   * A missing tab root is NOT a failure: Lumiverse renders a drawer tab only
   * while it is open, so we simply retry on the next tab change. A tab that is
   * present but structurally unusable is the real self-disable case — that is
   * the only path that shows the banner, and it never touches the host list.
   */
  function ensureMounted(): boolean {
    if (disposed) return false
    if (mounted) {
      if (!locateTabRoot()) {
        mounted = false
        affix?.dispose()
        affix = null
        controller.dispose()
        newFolderSlot = null
        return false
      }
      scheduleSync()
      return true
    }
    if (!locateTabRoot()) return false

    if (!controller.mount()) {
      showUnsupportedBanner(controller.unsupportedReason ?? 'Unsupported connection list layout')
      return false
    }

    mounted = true
    clearBanner()
    const list = locateList()
    if (list) {
      ensureAffix(list)
      injectNewFolderButton(list)
    }
    return true
  }

  let mountRetryFrame: number | null = null

  function cancelMountRetry(): void {
    if (mountRetryFrame !== null) {
      if (typeof cancelAnimationFrame === 'function' && mountRetryFrame !== 1) {
        cancelAnimationFrame(mountRetryFrame)
      }
      mountRetryFrame = null
    }
  }

  /**
   * onDrawerChange fires synchronously during state transitions, before React
   * attaches the tab root into the document. Retry across upcoming animation
   * frames until the tab is attached.
   */
  function scheduleMountRetry(attemptsRemaining = 15): void {
    cancelMountRetry()
    if (disposed || mounted || attemptsRemaining <= 0) return

    const check = (): void => {
      mountRetryFrame = null
      if (disposed || mounted) return
      if (ensureMounted()) return
      if (attemptsRemaining > 1) {
        scheduleMountRetry(attemptsRemaining - 1)
      }
    }

    if (typeof requestAnimationFrame === 'function') {
      mountRetryFrame = requestAnimationFrame(check)
    } else {
      mountRetryFrame = 1
      void Promise.resolve().then(check)
    }
  }

  disposables.push(
    ctx.ui.events.onDrawerChange((drawer) => {
      if (drawer.tabId === CONNECTIONS_TAB_ID && drawer.open !== false) {
        if (!ensureMounted()) {
          scheduleMountRetry()
        }
      } else {
        cancelMountRetry()
        if (mounted && !locateTabRoot()) {
          mounted = false
          affix?.dispose()
          affix = null
          controller.dispose()
          newFolderSlot = null
        }
      }
    }),
  )

  // The tab may already be mounted — the extension can load with the drawer
  // open, and the state selector's first emission can land before we get here.
  if (!ensureMounted()) {
    scheduleMountRetry()
  }

  /* ── 10. Teardown ─────────────────────────────────────────────────────── */

  return () => {
    if (disposed) return
    disposed = true
    cancelMountRetry()

    for (const dispose of disposables.splice(0)) {
      try {
        dispose()
      } catch (cause) {
        console.warn(`${LOG_PREFIX} a subscription failed to unsubscribe`, cause)
      }
    }

    affix?.dispose()
    affix = null
    controller.dispose()
    mounted = false

    // `ctx.dom.cleanup()` retires every injection (headers were NOT injected —
    // the controller owns those — plus the banner and the button slot).
    newFolderSlot = null
    banner = null
    removeStyle()
    ctx.dom.cleanup()
  }
}