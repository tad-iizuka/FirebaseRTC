import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useSavedRoomsStore } from '@/stores/savedRooms'

describe('savedRooms store', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
  })

  it('keeps history scoped per uid', () => {
    const store = useSavedRoomsStore()

    store.load('user-a')
    store.upsert('room-1', 'Aさんのルーム', 'ABC123')
    expect(store.rooms).toHaveLength(1)

    store.load('user-b')
    expect(store.rooms).toHaveLength(0)

    store.load('user-a')
    expect(store.rooms[0]?.roomId).toBe('room-1')
  })

  it('moves a re-used room to the front instead of duplicating it', () => {
    const store = useSavedRoomsStore()
    store.load('user-a')
    store.upsert('room-1', 'Room 1', null)
    store.upsert('room-2', 'Room 2', null)
    store.upsert('room-1', 'Room 1 (更新)', 'XYZ999')

    expect(store.rooms).toHaveLength(2)
    expect(store.rooms[0]?.roomId).toBe('room-1')
    expect(store.rooms[0]?.name).toBe('Room 1 (更新)')
  })

  it('removes a room from history', () => {
    const store = useSavedRoomsStore()
    store.load('user-a')
    store.upsert('room-1', 'Room 1', null)
    store.remove('room-1')
    expect(store.rooms).toHaveLength(0)
  })

  it('stores schedule when provided, and null when omitted', () => {
    const store = useSavedRoomsStore()
    store.load('user-a')
    store.upsert('room-1', 'Room 1', null, { start: 1000, end: 2000 })
    store.upsert('room-2', 'Room 2', null)

    expect(store.rooms.find((r) => r.roomId === 'room-1')?.schedule).toEqual({ start: 1000, end: 2000 })
    expect(store.rooms.find((r) => r.roomId === 'room-2')?.schedule).toBeNull()
  })

  it('keeps name null when the room has no name, instead of a placeholder label', () => {
    const store = useSavedRoomsStore()
    store.load('user-a')
    store.upsert('room-1', null, 'ABC123')

    expect(store.rooms[0]?.name).toBeNull()
  })
})
