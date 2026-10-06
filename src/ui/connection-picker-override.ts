import { useMemo, useCallback, useEffect, useState } from 'react'
import { useStore } from '@/store'
import { getProfileFolder, mergeFolderNames, groupProfilesByFolder, includeEmptyFolders } from '../folders/model'
import { ConnectionsPicker } from '@/components/connections-picker/ConnectionsPicker'
import { FOLDER_STYLES, BADGE_STYLES } from '../styles'

/**
 * PICKER OVERRIDE — working folder grouping for the chat composer picker.
 *
 * This component replaces the native ConnectionsPicker through the Spindle
 * component-override mechanism (host key 'ConnectionsPicker'). It groups
 * the host's profile list by folder using the same grouping logic as the
 * drawer tab, renders collapsible folder headers, and forwards the profile
 * selection to the native store mechanism (`setActiveProfile`).
 */
export function ConnectionPickerWithFolders(
  props: Record<string, unknown>,
): JSX.Element {
  const profiles = useStore((s) => s.profiles as Array<{ id: string; name: string; provider?: string; metadata?: Record<string, unknown> | null; is_default?: boolean }>)
  const activeProfileId = useStore((s) => s.activeProfileId)
  const setActiveProfile = useStore((s) => s.setActiveProfile)

  const folderNames = useMemo(() => mergeFolderNames([], profiles.map((p) => ({ id: p.id, name: p.name, metadata: p.metadata }))), [profiles])
  const groups = useMemo(() => includeEmptyFolders(
    groupProfilesByFolder(profiles.map((p) => ({ id: p.id, name: p.name, metadata: p.metadata }))),
    folderNames,
    profiles.map((p) => ({ id: p.id, name: p.name, metadata: p.metadata }))
  ), [profiles, folderNames])

  const [collapsed, setCollapsed] = useState(new Set<string>())

  const handleSelect = useCallback((profileId: string) => {
    setActiveProfile(profileId)
  }, [setActiveProfile])

  // Apply grouping styles globally for this override session.
  useEffect(() => {
    const remove = (window as any).ctx?.dom?.addStyle?.(FOLDER_STYLES + BADGE_STYLES, { scope: 'global' })
    return () => { if (remove) remove(); }
  }, [])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {groups.map((group) => {
        const isCollapsed = collapsed.has(group.folder || '__uncategorized')
        return (
          <div key={group.folder || 'uncategorized'} style={{ marginBottom: 4 }}>
            <button
              type="button"
              onClick={() => {
                const key = group.folder || '__uncategorized'
                setCollapsed((prev) => {
                  const next = new Set(prev)
                  if (next.has(key)) next.delete(key)
                  else next.add(key)
                  return next
                })
              }}
              style={{
                width: '100%',
                textAlign: 'left',
                padding: '4px 6px',
                background: 'transparent',
                border: 'none',
                color: 'var(--lumiverse-text-muted)',
                fontSize: 11,
                fontWeight: 600,
                textTransform: 'uppercase',
                letterSpacing: '0.4px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                borderRadius: 6,
              }}
            >
              <span style={{ fontSize: 10, transition: 'transform 0.15s ease', transform: isCollapsed ? 'rotate(0deg)' : 'rotate(90deg)' }}>›</span>
              <span>{group.folder || 'Uncategorized'}</span>
              <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--lumiverse-text-dim)', background: 'var(--lumiverse-fill-subtle)', borderRadius: 999, padding: '0 5px' }}>{group.profiles.length}</span>
            </button>
            {!isCollapsed && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2, paddingLeft: 8 }}>
                {group.profiles.map((profile: any) => (
                  <button
                    key={profile.id}
                    type="button"
                    onClick={() => handleSelect(profile.id)}
                    style={{
                      background: activeProfileId === profile.id ? 'var(--lumiverse-fill-subtle)' : 'transparent',
                      border: 'none',
                      padding: '6px 8px',
                      borderRadius: 6,
                      textAlign: 'left',
                      cursor: 'pointer',
                    }}
                  >
                    <div style={{ fontWeight: 500 }}>{profile.name}</div>
                    <div style={{ fontSize: 11, color: 'var(--lumiverse-text-muted)' }}>{profile.provider ?? 'Unknown'}</div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
