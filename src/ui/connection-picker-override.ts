import * as React from 'react'
import { useStore } from '@/store'
import { useMemo, useState, useCallback } from 'react'
import { getProfileFolder, mergeFolderNames, groupProfilesByFolder, includeEmptyFolders } from '../folders/model'
import { ConnectionsPicker } from '@/components/connections-picker/ConnectionsPicker'

/**
 * PICKER OVERRIDE — folder-grouped connection picker.
 *
 * Replaces the native ConnectionsPicker with a folder-grouped list that
 * forwards selection to the native store (`setActiveProfile`). This is a
 * full replacement (mode: 'replace') — the native picker's 4 layout
 * variants, search/filter, model grid and settings persistence are not
 * replicated here. The grouping logic mirrors the drawer tab.
 */
export function ConnectionPickerWithFolders(
  props: Record<string, unknown>,
): React.ReactElement {
  const { open, onClose } = props as { open: boolean; onClose: () => void }
  const profiles = useStore((s) => s.profiles as Array<{ id: string; name: string; provider?: string; metadata?: Record<string, unknown> | null }>)
  const activeProfileId = useStore((s) => s.activeProfileId)
  const setActiveProfile = useStore((s) => s.setActiveProfile)

  const folderNames = useMemo(
    () => mergeFolderNames([], profiles.map((p) => ({ id: p.id, name: p.name, metadata: p.metadata }))),
    [profiles],
  )
  const groups = useMemo(
    () => includeEmptyFolders(
      groupProfilesByFolder(profiles.map((p) => ({ id: p.id, name: p.name, metadata: p.metadata }))),
      folderNames,
      profiles.map((p) => ({ id: p.id, name: p.name, metadata: p.metadata })),
    ),
    [profiles, folderNames],
  )

  const [collapsed, setCollapsed] = useState(new Set<string>())

  const handleSelect = useCallback((profileId: string) => {
    setActiveProfile(profileId)
    if (onClose) onClose()
  }, [setActiveProfile, onClose])

  if (!open) return null

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
      onClick={(e) => { if (e.target === e.currentTarget && onClose) onClose() }}
    >
      <div
        style={{
          background: 'var(--lumiverse-bg)',
          color: 'var(--lumiverse-text)',
          border: '1px solid var(--lumiverse-border)',
          borderRadius: 12,
          padding: 16,
          width: 420,
          maxHeight: '80vh',
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 style={{ margin: '0 0 8px 0', fontSize: 14, fontWeight: 600 }}>
          Select Connection
        </h3>
        {groups.map((group) => {
          const key = group.folder || '__uncategorized'
          const isCollapsed = collapsed.has(key)
          return (
            <div key={key} style={{ marginBottom: 4 }}>
              <button
                type="button"
                onClick={() => {
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
                  padding: '6px 8px',
                  background: 'var(--lumiverse-fill-subtle)',
                  border: '1px solid var(--lumiverse-border)',
                  borderRadius: 6,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <span style={{ fontSize: 10, transition: 'transform 0.15s ease', transform: isCollapsed ? 'rotate(0deg)' : 'rotate(90deg)' }}>›</span>
                <span style={{ fontWeight: 600, fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.4px', color: 'var(--lumiverse-text-muted)' }}>
                  {group.folder || 'Uncategorized'}
                </span>
                <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--lumiverse-text-dim)', background: 'var(--lumiverse-fill)', borderRadius: 999, padding: '0 6px' }}>
                  {group.profiles.length}
                </span>
              </button>
              {!isCollapsed && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2, paddingLeft: 8, marginTop: 4 }}>
                  {group.profiles.map((profile: any) => (
                    <button
                      key={profile.id}
                      type="button"
                      onClick={() => handleSelect(profile.id)}
                      style={{
                        background: activeProfileId === profile.id ? 'var(--lumiverse-fill-subtle)' : 'transparent',
                        border: '1px solid var(--lumiverse-border)',
                        borderRadius: 6,
                        padding: '6px 8px',
                        cursor: 'pointer',
                        textAlign: 'left',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                      }}
                    >
                      <div style={{ fontWeight: 500, fontSize: 13 }}>{profile.name}</div>
                      <div style={{ fontSize: 11, color: 'var(--lumiverse-text-muted)' }}>{profile.provider ?? 'Unknown'}</div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}