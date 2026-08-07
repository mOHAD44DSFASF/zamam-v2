import { useEffect } from 'react'

/** Closes any dialog/dropdown on Escape — shared so every overlay in the app behaves the same way. */
export function useEscapeToClose(onClose: () => void) {
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])
}
