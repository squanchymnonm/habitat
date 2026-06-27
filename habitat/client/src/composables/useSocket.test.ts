import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref } from 'vue'

// Mock useAuth before importing useSocket so the singleton uses our stub
const mockAuthed = ref<boolean | null>(null)
vi.mock('./useAuth', () => ({
  useAuth: () => ({ authed: mockAuthed }),
}))

// Import after the mock is set up
import { onSocketClose } from './useSocket'

describe('onSocketClose', () => {
  beforeEach(() => {
    // Reset authed to a known state before each test
    mockAuthed.value = true
  })

  it('code 1008 (unauthorized) → returns false (no reconnect) and sets authed=false', () => {
    const shouldReconnect = onSocketClose(1008)
    expect(shouldReconnect).toBe(false)
    expect(mockAuthed.value).toBe(false)
  })

  it('code 1006 (abnormal close) → returns true (reconnect) and leaves authed unchanged', () => {
    mockAuthed.value = true
    const shouldReconnect = onSocketClose(1006)
    expect(shouldReconnect).toBe(true)
    expect(mockAuthed.value).toBe(true)
  })

  it('code 1001 (going away) → returns true (reconnect) and leaves authed unchanged', () => {
    mockAuthed.value = true
    const shouldReconnect = onSocketClose(1001)
    expect(shouldReconnect).toBe(true)
    expect(mockAuthed.value).toBe(true)
  })
})
