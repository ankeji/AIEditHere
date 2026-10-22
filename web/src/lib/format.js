export function fromNow(timestamp) {
  if (!timestamp) return ''
  const diff = Date.now() - timestamp
  if (diff < 60 * 1000) return '刚刚'
  if (diff < 60 * 60 * 1000) return `${Math.floor(diff / 60000)} 分钟前`
  if (diff < 24 * 60 * 60 * 1000) return `${Math.floor(diff / 3600000)} 小时前`
  const date = new Date(timestamp)
  return `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, '0')}:${String(
    date.getMinutes(),
  ).padStart(2, '0')}`
}

export function duration(start, end) {
  if (!start) return ''
  const total = Math.max(0, ((end || Date.now()) - start) / 1000)
  if (total < 1) return '<1s'
  if (total < 60) return `${Math.round(total)}s`
  const minutes = Math.floor(total / 60)
  const seconds = Math.round(total % 60)
  return `${minutes}m ${seconds}s`
}

/** 给路径加左右方向标记，保证在 rtl 省略样式下仍按从左往右显示 */
export function ltr(text) {
  return `\u200E${text ?? ''}\u200E`
}
