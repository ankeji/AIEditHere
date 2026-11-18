;(function () {
  if (window.__AI_EDIT_HERE_PICKER__) return
  window.__AI_EDIT_HERE_PICKER__ = true

  var active = false
  var overlay = null
  var banner = null
  var styleEl = null
  var hovered = null
  var multi = false
  var multiCount = 0
  var pointerHandled = false
  var selectedItems = []

  function notify(type, payload) {
    try {
      window.parent.postMessage(
        Object.assign({ source: 'ai-edit-picker', type: type }, payload || {}),
        '*',
      )
    } catch (err) {
      /* 忽略 */
    }
  }

  function escapeCss(value) {
    if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(value)
    return String(value).replace(/[^a-zA-Z0-9_-]/g, '\\$&')
  }

  function cssSelector(el) {
    var parts = []
    var node = el
    while (node && node.nodeType === 1) {
      if (node === document.documentElement) break
      if (node.id) {
        parts.unshift('#' + escapeCss(node.id))
        break
      }
      var part = node.tagName.toLowerCase()
      var classes = []
      if (node.classList) {
        for (var i = 0; i < node.classList.length && classes.length < 2; i += 1) {
          classes.push(node.classList[i])
        }
      }
      if (classes.length) {
        part += classes
          .map(function (name) {
            return '.' + escapeCss(name)
          })
          .join('')
      }
      var parent = node.parentElement
      if (parent) {
        var siblings = []
        for (var j = 0; j < parent.children.length; j += 1) {
          if (parent.children[j].tagName === node.tagName) siblings.push(parent.children[j])
        }
        if (siblings.length > 1) part += ':nth-of-type(' + (siblings.indexOf(node) + 1) + ')'
      }
      parts.unshift(part)
      node = node.parentElement
    }
    return parts.join(' > ')
  }

  function computedStyles(el) {
    var result = {}
    try {
      var cs = window.getComputedStyle(el)
      var keys = [
        'display',
        'position',
        'color',
        'backgroundColor',
        'fontSize',
        'fontWeight',
        'fontFamily',
        'padding',
        'margin',
        'border',
        'borderRadius',
        'width',
        'height',
        'gap',
        'flexDirection',
        'justifyContent',
        'alignItems',
        'boxShadow',
      ]
      for (var i = 0; i < keys.length; i += 1) {
        var key = keys[i]
        var value = cs[key]
        if (value && value !== 'none' && value !== 'normal' && value !== 'auto') {
          result[key] = String(value).slice(0, 120)
        }
      }
    } catch (err) {
      /* 忽略 */
    }
    return result
  }

  function describe(target) {
    var el = target
    if (!el) return null
    if (el.nodeType !== 1) el = el.parentElement
    if (!el) return null

    var rect = el.getBoundingClientRect()
    var attrs = {}
    var attrNames = ['type', 'name', 'placeholder', 'role', 'aria-label', 'data-testid', 'href', 'src', 'alt']
    for (var i = 0; i < attrNames.length; i += 1) {
      var value = el.getAttribute(attrNames[i])
      if (value) attrs[attrNames[i]] = String(value).slice(0, 160)
    }

    var text = ''
    try {
      text = (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 240)
    } catch (err) {
      /* 忽略 */
    }

    var html = ''
    try {
      html = String(el.outerHTML || '').replace(/\s+/g, ' ').slice(0, 900)
    } catch (err) {
      /* 忽略 */
    }

    return {
      tag: el.tagName.toLowerCase(),
      id: el.id || '',
      className: typeof el.className === 'string' ? el.className : '',
      selector: cssSelector(el),
      text: text,
      html: html,
      rect: {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      },
      pageRect: {
        x: Math.round(rect.x + window.scrollX),
        y: Math.round(rect.y + window.scrollY),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      },
      attrs: attrs,
      styles: computedStyles(el),
    }
  }

  function highlightStyle() {
    return [
      'position:fixed',
      'pointer-events:none',
      'z-index:2147483646',
      'border:2px solid #2c9d6e',
      'background:rgba(44,157,110,0.08)',
      'border-radius:4px',
      'display:none',
    ].join(';')
  }

  function badgeStyle() {
    return [
      'position:fixed',
      'pointer-events:none',
      'z-index:2147483647',
      'background:#2c9d6e',
      'color:#fff',
      'font:700 11px/1 system-ui,-apple-system,Segoe UI,sans-serif',
      'padding:3px 6px',
      'border-radius:999px',
      'transform:translate(-50%,-50%)',
      'display:none',
    ].join(';')
  }

  function findSelected(key) {
    for (var i = 0; i < selectedItems.length; i += 1) {
      if (selectedItems[i].key === key) return selectedItems[i]
    }
    return null
  }

  function positionSelected() {
    for (var i = 0; i < selectedItems.length; i += 1) {
      var item = selectedItems[i]
      var rect = item.el.getBoundingClientRect()
      if (!rect.width && !rect.height) {
        item.outline.style.display = 'none'
        item.badge.style.display = 'none'
        continue
      }
      item.outline.style.display = 'block'
      item.outline.style.left = rect.left + 'px'
      item.outline.style.top = rect.top + 'px'
      item.outline.style.width = rect.width + 'px'
      item.outline.style.height = rect.height + 'px'
      item.badge.style.display = 'block'
      item.badge.style.left = rect.left + 'px'
      item.badge.style.top = rect.top + 'px'
      item.badge.textContent = String(i + 1)
    }
  }

  function addSelected(el, info) {
    var key = info.selector || info.tag + ':' + (info.id || '')
    var existing = findSelected(key)
    if (existing) {
      removeSelected(key)
      notify('ai-picker:removed', { key: key })
      updateBanner()
      return
    }
    var outline = document.createElement('div')
    outline.setAttribute('data-ai-edit-picker', 'selected')
    outline.style.cssText = highlightStyle()
    var badge = document.createElement('div')
    badge.setAttribute('data-ai-edit-picker', 'badge')
    badge.style.cssText = badgeStyle()
    banner.textContent = ''
    banner.style.pointerEvents = 'auto'
    banner.style.display = 'flex'
    banner.style.alignItems = 'center'
    banner.style.gap = '8px'
    banner.style.padding = '6px 8px 6px 14px'

    var bannerLabel = document.createElement('span')
    bannerLabel.setAttribute('data-ai-picker-label', '')
    banner.appendChild(bannerLabel)

    var bannerActions = document.createElement('span')
    bannerActions.setAttribute('data-ai-picker-actions', '')
    bannerActions.style.cssText = 'display:flex;align-items:center;gap:4px'

    var finishBtn = document.createElement('button')
    finishBtn.type = 'button'
    finishBtn.textContent = '完成'
    finishBtn.style.cssText =
      'border:0;border-radius:999px;background:#2c9d6e;color:#fff;font:600 11px/1.2 system-ui,sans-serif;padding:5px 9px;cursor:pointer'
    finishBtn.addEventListener('click', function (event) {
      event.preventDefault()
      event.stopPropagation()
      finishPicking()
    })

    var cancelBtn = document.createElement('button')
    cancelBtn.type = 'button'
    cancelBtn.textContent = '取消'
    cancelBtn.style.cssText =
      'border:1px solid rgba(255,255,255,.28);border-radius:999px;background:transparent;color:#fff;font:600 11px/1.2 system-ui,sans-serif;padding:4px 8px;cursor:pointer'
    cancelBtn.addEventListener('click', function (event) {
      event.preventDefault()
      event.stopPropagation()
      cancelPicking()
    })

    bannerActions.appendChild(finishBtn)
    bannerActions.appendChild(cancelBtn)
    banner.appendChild(bannerActions)
    updateBanner()

    var root = document.body || document.documentElement
    root.appendChild(outline)
    root.appendChild(badge)
    selectedItems.push({ el: el, key: key, outline: outline, badge: badge })
    multiCount = selectedItems.length
    positionSelected()
    updateBanner()
    notify('ai-picker:selected', { element: info, multi: true, index: multiCount, key: key })
  }

  function removeSelected(key) {
    var item = findSelected(key)
    if (!item) return
    if (item.outline && item.outline.parentNode) item.outline.parentNode.removeChild(item.outline)
    if (item.badge && item.badge.parentNode) item.badge.parentNode.removeChild(item.badge)
    selectedItems = selectedItems.filter(function (entry) {
      return entry !== item
    })
    multiCount = selectedItems.length
    positionSelected()
    updateBanner()
  }

  function clearSelected() {
    for (var i = 0; i < selectedItems.length; i += 1) {
      var item = selectedItems[i]
      if (item.outline && item.outline.parentNode) item.outline.parentNode.removeChild(item.outline)
      if (item.badge && item.badge.parentNode) item.badge.parentNode.removeChild(item.badge)
    }
    selectedItems = []
    multiCount = 0
  }

  function updateBanner() {
    if (!banner) return
    var label = banner.querySelector('[data-ai-picker-label]')
    if (!label) return
    label.textContent = multi
      ? selectedItems.length
        ? '已选 ' + selectedItems.length + ' 个元素 · 点击元素可取消'
        : '点击选择元素（可多选）'
      : '点击选择要修改的元素 · Esc 取消'
    var actions = banner.querySelector('[data-ai-picker-actions]')
    if (actions) actions.style.display = multi ? 'flex' : 'none'
  }

  function positionOverlay(target) {
    if (!overlay || !target) return
    var rect = target.getBoundingClientRect()
    if (!rect.width && !rect.height) {
      overlay.style.display = 'none'
      return
    }
    overlay.style.display = 'block'
    overlay.style.left = rect.left + 'px'
    overlay.style.top = rect.top + 'px'
    overlay.style.width = rect.width + 'px'
    overlay.style.height = rect.height + 'px'
  }

  function onMove(event) {
    if (!active) return
    var target = event.target
    if (!target || target === overlay || (banner && banner.contains(target))) return
    if (target.nodeType !== 1) target = target.parentElement
    if (!target) return
    hovered = target
    positionOverlay(target)
    positionSelected()
  }

  function onScroll() {
    if (!active) return
    if (hovered) positionOverlay(hovered)
    positionSelected()
  }

  function onDown(event) {
    if (!active) return
    if (event.target === overlay || (banner && banner.contains(event.target))) return
    event.preventDefault()
    event.stopPropagation()
    event.stopImmediatePropagation()
  }

  function selectTarget(target) {
    if (!active) return
    var info = null
    try {
      info = describe(target)
    } catch (err) {
      info = null
    }
    if (info && multi) {
      addSelected(target, info)
      return
    }
    stop()
    if (info) notify('ai-picker:selected', { element: info })
    else notify('ai-picker:error', { message: '无法读取该元素的信息' })
  }

  function onPointerUp(event) {
    if (!active) return
    if (event.target === overlay || (banner && banner.contains(event.target))) return
    event.preventDefault()
    event.stopPropagation()
    event.stopImmediatePropagation()
    pointerHandled = true
    selectTarget(event.target)
  }

  function onClick(event) {
    if (!active) return
    if (event.target === overlay || (banner && banner.contains(event.target))) return
    event.preventDefault()
    event.stopPropagation()
    event.stopImmediatePropagation()
    if (pointerHandled) {
      pointerHandled = false
      return
    }
    selectTarget(event.target)
  }

  function finishPicking() {
    var count = selectedItems.length
    stop()
    if (multi) notify('ai-picker:finished', { count: count })
    else notify('ai-picker:cancelled')
  }

  function cancelPicking() {
    stop()
    notify('ai-picker:cancelled', { clear: true })
  }

  function onKey(event) {
    if (event.key !== 'Escape') return
    event.preventDefault()
    if (multi) finishPicking()
    else {
      stop()
      notify('ai-picker:cancelled')
    }
  }

  function cleanup() {
    clearSelected()
    if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay)
    if (banner && banner.parentNode) banner.parentNode.removeChild(banner)
    if (styleEl && styleEl.parentNode) styleEl.parentNode.removeChild(styleEl)
    document.removeEventListener('mousemove', onMove, true)
    document.removeEventListener('pointerdown', onDown, true)
    document.removeEventListener('mousedown', onDown, true)
    document.removeEventListener('pointerup', onPointerUp, true)
    document.removeEventListener('mouseup', onDown, true)
    document.removeEventListener('dblclick', onDown, true)
    document.removeEventListener('contextmenu', onDown, true)
    document.removeEventListener('auxclick', onDown, true)
    document.removeEventListener('click', onClick, true)
    document.removeEventListener('keydown', onKey, true)
    document.removeEventListener('scroll', onScroll, true)
    window.removeEventListener('resize', onScroll, true)
    overlay = null
    banner = null
    styleEl = null
    hovered = null
    multi = false
    multiCount = 0
    pointerHandled = false
    document.documentElement.classList.remove('__ai-edit-picker-active')
    document.documentElement.style.cursor = ''
  }

  function stop() {
    if (!active) return
    active = false
    cleanup()
  }

  function start(options) {
    if (active) cleanup()
    active = true
    multi = Boolean(options && options.multi)
    multiCount = 0
    clearSelected()

    styleEl = document.createElement('style')
    styleEl.textContent =
      'html.__ai-edit-picker-active, html.__ai-edit-picker-active *{cursor:crosshair !important;}' +
      'html.__ai-edit-picker-active [data-ai-edit-picker="banner"] *{cursor:pointer !important;}'
    document.documentElement.classList.add('__ai-edit-picker-active')
    ;(document.head || document.documentElement).appendChild(styleEl)

    overlay = document.createElement('div')
    overlay.setAttribute('data-ai-edit-picker', 'overlay')
    overlay.style.cssText = [
      'position:fixed',
      'pointer-events:none',
      'z-index:2147483647',
      'border:2px solid #2c9d6e',
      'background:rgba(44,157,110,0.13)',
      'border-radius:4px',
      'box-shadow:0 0 0 9999px rgba(15,23,32,0.1)',
      'transition:left .04s ease,top .04s ease,width .04s ease,height .04s ease',
      'display:none',
    ].join(';')

    banner = document.createElement('div')
    banner.setAttribute('data-ai-edit-picker', 'banner')
    banner.textContent = multi
      ? '点击选择元素（可多选）· Esc 完成'
      : '点击选择要修改的元素 · Esc 取消'
    banner.style.cssText = [
      'position:fixed',
      'left:50%',
      'top:16px',
      'transform:translateX(-50%)',
      'z-index:2147483647',
      'pointer-events:none',
      'background:#121a23',
      'color:#fff',
      'font:600 12px/1.4 system-ui,-apple-system,Segoe UI,sans-serif',
      'padding:8px 14px',
      'border-radius:999px',
      'box-shadow:0 8px 24px rgba(15,23,32,0.35)',
      'white-space:nowrap',
    ].join(';')

    var root = document.body || document.documentElement
    root.appendChild(overlay)
    root.appendChild(banner)

    document.addEventListener('mousemove', onMove, true)
    document.addEventListener('pointerdown', onDown, true)
    document.addEventListener('mousedown', onDown, true)
    document.addEventListener('pointerup', onPointerUp, true)
    document.addEventListener('mouseup', onDown, true)
    document.addEventListener('dblclick', onDown, true)
    document.addEventListener('contextmenu', onDown, true)
    document.addEventListener('auxclick', onDown, true)
    document.addEventListener('click', onClick, true)
    document.addEventListener('keydown', onKey, true)
    document.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onScroll, true)

    notify('ai-picker:started')
  }

  window.addEventListener('message', function (event) {
    var data = event.data
    if (!data || data.source !== 'ai-edit-parent') return
    if (data.type === 'ai-picker:start') start(data)
    else if (data.type === 'ai-picker:stop') stop()
    else if (data.type === 'ai-picker:remove') {
      removeSelected(data.key)
    } else if (data.type === 'ai-picker:clear') {
      clearSelected()
      updateBanner()
    }
  })
})()
