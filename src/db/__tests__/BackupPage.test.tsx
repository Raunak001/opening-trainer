import 'fake-indexeddb/auto'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import Dexie from 'dexie'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { exportBackup, parseBackup, serializeBackup } from '../backup'
import { BackupPage } from '../BackupPage'
import { TrainerDB } from '../db'
import { getSettings, updateSettings } from '../settings'

const WAIT = { timeout: 4000 }
const names: string[] = []
const openDb = () => {
  const name = `backup-page-${names.length}`
  names.push(name)
  return new TrainerDB(name)
}
afterEach(async () => {
  for (const n of names.splice(0)) await Dexie.delete(n)
})

async function backupWith(newCards: number) {
  const db = openDb()
  await updateSettings(db, { daily: { reviews: newCards } })
  await db.explorerCache.put({ key: 'k', positionKey: 'p', params: '', response: {}, fetchedAt: 1 })
  return serializeBackup(await exportBackup(db, new Date(2026, 10, 8, 9, 30)))
}

function pick(text: string, name = 'backup.json') {
  fireEvent.change(screen.getByTestId('backup-file'), {
    target: { files: [new File([text], name, { type: 'application/json' })] },
  })
}

describe('BackupPage', () => {
  it('exports everything to a dated JSON file', async () => {
    const db = openDb()
    await updateSettings(db, { daily: { reviews: 3 } })
    const saveFile = vi.fn()
    render(<BackupPage db={db} saveFile={saveFile} />)

    fireEvent.click(screen.getByRole('button', { name: 'Export backup' }))
    expect(await screen.findByText('Backup saved.', {}, WAIT)).toBeInTheDocument()
    const [name, text] = saveFile.mock.calls[0]
    expect(name).toMatch(/^opening-trainer-backup-\d{4}-\d{2}-\d{2}\.json$/)
    expect(parseBackup(text, 6).tables.settings).toMatchObject([{ daily: { reviews: 3 } }])
  })

  it('shows what a file contains and restores only after confirmation', async () => {
    const db = openDb()
    await updateSettings(db, { daily: { reviews: 1 } })
    const saveFile = vi.fn()
    render(<BackupPage db={db} saveFile={saveFile} />)

    pick(await backupWith(42), 'my-backup.json')
    const dialog = within(await screen.findByRole('alertdialog', { name: 'Confirm restore' }, WAIT))
    expect(dialog.getByText('my-backup.json')).toBeInTheDocument()
    expect(dialog.getByRole('row', { name: /Cached explorer answers 1/ })).toBeInTheDocument()
    expect(dialog.getByRole('row', { name: /Cards 0/ })).toBeInTheDocument()
    expect(dialog.getByText(/Everything currently in the app is deleted/)).toBeInTheDocument()
    // Nothing has changed yet.
    expect((await getSettings(db)).daily.reviews).toBe(1)

    fireEvent.click(dialog.getByRole('button', { name: 'Save current data first' }))
    await waitFor(() => expect(saveFile).toHaveBeenCalledOnce())
    expect(parseBackup(saveFile.mock.calls[0][1], 6).tables.settings).toMatchObject([
      { daily: { reviews: 1 } },
    ])
    expect(await dialog.findByRole('button', { name: 'Current data saved' })).toBeDisabled()

    fireEvent.click(dialog.getByRole('button', { name: 'Replace my data' }))
    expect(
      await screen.findByText('Restored 0 repertoires, 0 cards and 0 reviews.', {}, WAIT),
    ).toBeInTheDocument()
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect((await getSettings(db)).daily.reviews).toBe(42)
    expect(await db.explorerCache.count()).toBe(1)
  })

  it('cancel leaves the data alone', async () => {
    const db = openDb()
    await updateSettings(db, { daily: { reviews: 1 } })
    render(<BackupPage db={db} saveFile={vi.fn()} />)

    pick(await backupWith(42))
    const dialog = within(await screen.findByRole('alertdialog', {}, WAIT))
    fireEvent.click(dialog.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect((await getSettings(db)).daily.reviews).toBe(1)
  })

  it('explains why a file cannot be used', async () => {
    render(<BackupPage db={openDb()} saveFile={vi.fn()} />)
    pick('{"hello": "world"}', 'notes.json')
    expect(await screen.findByRole('alert', {}, WAIT)).toHaveTextContent(
      'Could not read notes.json: This is not an Opening Trainer backup.',
    )
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })
})
