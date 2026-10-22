const subscribers = new Set()

export const bus = {
  subscribe(fn) {
    subscribers.add(fn)
    return () => subscribers.delete(fn)
  },
  emit(type, data) {
    for (const fn of subscribers) {
      try {
        fn({ type, data })
      } catch (err) {
        console.warn('[bus] 事件发送失败:', err?.message)
      }
    }
  },
}
