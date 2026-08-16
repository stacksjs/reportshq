/*
 * Arranging the grid.
 *
 * Plain JavaScript, inlined into the page. A package that needs a build step to
 * make its own UI work is a package that fails differently in every application
 * it is installed into, and this is two hundred lines.
 *
 * Every rule below was learned from the hosted builder, several of them the
 * expensive way, and they are written here rather than rediscovered:
 *
 * - **Adding a block is wired outside the grid guard.** An empty report renders
 *   no grid at all, and while this listener lived inside the arranging script
 *   every button in the palette did nothing, silently, on exactly the report
 *   somebody had just created.
 * - **`setPointerCapture` is guarded.** It throws for any pointer the browser
 *   does not consider active, and it runs before the move listeners are
 *   attached, so an exception means the block simply never moves and nothing
 *   says why.
 * - **Selection is suppressed during a drag.** A pointer dragged across a grid
 *   full of text selects it, which leaves a blue smear and makes a working drag
 *   look broken.
 * - **The server's layout wins.** The client packs optimistically so the drag
 *   feels immediate; the response carries the canonical positions and they are
 *   applied over the top.
 */
(() => {
  const root = document.querySelector('.rhq-builder')
  if (!root) return

  const choices = JSON.parse(document.getElementById('rhq-choices').textContent)
  const base = window.location.pathname.replace(/\/edit\/?$/, '')
  const state = document.getElementById('rhq-state')
  const drafted = document.getElementById('rhq-drafted')

  function say(text) {
    if (state) state.textContent = text
  }

  function post(path, body, method) {
    return fetch(base + path, {
      method: method || 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'X-CSRF-TOKEN': (document.querySelector('meta[name=csrf-token]') || {}).content || '',
        'X-Requested-With': 'XMLHttpRequest',
      },
      credentials: 'same-origin',
      body: body === null ? null : JSON.stringify(body),
    })
  }

  /* ---- Adding, which must work with no grid on the page ------------------ */

  Array.prototype.forEach.call(document.querySelectorAll('.rhq-add'), (button) => {
    button.addEventListener('click', () => {
      say('Adding')

      post('/blocks', { kind: button.dataset.kind }).then((response) => {
        // A reload rather than an optimistic insert: the new block has to be
        // rendered by the engine anyway, and the server already knows how.
        if (response.ok) window.location.reload()
        else say('Could not add that')
      }).catch(() => { say('Could not add that') })
    })
  })

  const publish = document.getElementById('rhq-publish')
  if (publish) {
    publish.addEventListener('click', () => {
      say('Publishing')

      post('/publish', {}).then((response) => {
        say(response.ok ? 'Published' : 'Could not publish')
        if (response.ok && drafted) drafted.hidden = true
      }).catch(() => { say('Could not publish') })
    })
  }

  /* ---- Arranging --------------------------------------------------------- */

  const grid = document.getElementById('rhq-grid')
  if (!grid) return

  const COLUMNS = 12
  const ROW = 56
  const GAP = 12

  // Below the breakpoint there is no twelve column grid to drag against: the
  // blocks stack. Selecting still works so the panel is reachable; only the
  // dragging is off.
  const arrangeable = window.matchMedia('(min-width: 1024px)').matches
  let selected = null
  let pending = null

  function tiles() {
    return Array.prototype.slice.call(grid.querySelectorAll('.rhq-tile'))
  }

  function place(tile, x, y, w, h) {
    tile.dataset.x = String(x)
    tile.dataset.y = String(y)
    tile.dataset.w = String(w)
    tile.dataset.h = String(h)
    tile.style.setProperty('--x', String(x + 1))
    tile.style.setProperty('--w', String(w))
    tile.style.setProperty('--h', String(h))
    tile.setAttribute('aria-label', (tile.getAttribute('aria-label') || '')
      .replace(/column \d+, row \d+/, 'column ' + x + ', row ' + y))
  }

  function layout() {
    return tiles().map((tile) => {
      return {
        id: Number(tile.dataset.id),
        x: Number(tile.dataset.x),
        y: Number(tile.dataset.y),
        w: Number(tile.dataset.w),
        h: Number(tile.dataset.h),
      }
    })
  }

  function cellWidth() {
    return (grid.clientWidth - GAP * (COLUMNS - 1)) / COLUMNS
  }

  /* The same packing the server does, for the preview only. */
  function pack(movedId) {
    const blocks = layout()

    blocks.sort((a, b) => {
      if (a.id === movedId) return -1
      if (b.id === movedId) return 1
      return a.y - b.y || a.x - b.x
    })

    const placed = []

    blocks.forEach((block) => {
      function hits(y) {
        return placed.some((other) => {
          return !(block.x + block.w <= other.x || other.x + other.w <= block.x
            || y + block.h <= other.y || other.y + other.h <= y)
        })
      }

      while (block.y > 0 && !hits(block.y - 1)) block.y--
      while (hits(block.y)) block.y++

      placed.push(block)
    })

    placed.forEach((block) => {
      const tile = grid.querySelector('.rhq-tile[data-id="' + block.id + '"]')
      if (tile) place(tile, block.x, block.y, block.w, block.h)
    })
  }

  function save(movedId) {
    say('Saving')
    clearTimeout(pending)

    // Debounced: a drag ends in one commit, and dropping three blocks quickly
    // should not be three round trips racing each other.
    pending = setTimeout(() => {
      post('/layout', { layout: layout(), moved: movedId })
        .then((response) => { return response.ok ? response.json() : null })
        .then((payload) => {
          if (!payload) { say('Could not save'); return }

          // The server's answer over the top of ours. If the two packed
          // differently, this is where it is resolved rather than stored.
          payload.layout.forEach((block) => {
            const tile = grid.querySelector('.rhq-tile[data-id="' + block.id + '"]')
            if (tile) place(tile, block.x, block.y, block.w, block.h)
          })

          say('Saved')
          if (drafted) drafted.hidden = false
        })
        .catch(() => { say('Could not save') })
    }, 220)
  }

  function select(tile) {
    tiles().forEach((other) => { other.classList.toggle('is-selected', other === tile) })
    selected = tile
    openPanel(tile)
  }

  grid.addEventListener('focusin', (event) => {
    const tile = event.target.closest ? event.target.closest('.rhq-tile') : null
    if (tile) select(tile)
  })

  grid.addEventListener('pointerdown', (event) => {
    const tile = event.target.closest ? event.target.closest('.rhq-tile') : null
    if (!tile) return

    select(tile)
    if (!arrangeable) return

    const resizing = event.target.classList && event.target.classList.contains('rhq-resize')
    const startX = event.clientX
    const startY = event.clientY
    const originX = Number(tile.dataset.x)
    const originY = Number(tile.dataset.y)
    const originW = Number(tile.dataset.w)
    const originH = Number(tile.dataset.h)
    const unit = cellWidth()
    const id = Number(tile.dataset.id)

    // Best effort. Capture keeps a fast drag that outruns the tile from
    // dropping the gesture, and it throws for any pointer the browser does not
    // consider active. An exception here happens before the listeners below are
    // attached, so the block would simply not move and nothing would say why.
    try { tile.setPointerCapture(event.pointerId) } catch (error) { /* not fatal */ }

    tile.classList.add('is-dragging')
    grid.classList.add('is-arranging')

    function move(moveEvent) {
      const dx = Math.round((moveEvent.clientX - startX) / (unit + GAP))
      const dy = Math.round((moveEvent.clientY - startY) / (ROW + GAP))

      if (resizing) {
        place(tile, originX, originY, Math.max(1, Math.min(COLUMNS - originX, originW + dx)), Math.max(1, originH + dy))
      } else {
        place(tile, Math.max(0, Math.min(COLUMNS - originW, originX + dx)), Math.max(0, originY + dy), originW, originH)
      }

      // Push the others out of the way as it moves rather than at the drop.
      // Seeing where a block will land while still holding it is the whole
      // difference between arranging a grid and guessing at one.
      pack(id)
    }

    function end() {
      try { tile.releasePointerCapture(event.pointerId) } catch (error) { /* not fatal */ }

      tile.classList.remove('is-dragging')
      grid.classList.remove('is-arranging')
      tile.removeEventListener('pointermove', move)
      tile.removeEventListener('pointerup', end)
      tile.removeEventListener('pointercancel', end)

      // Nothing moved, so nothing is written. Otherwise every click on a block
      // costs a request and marks the report as having unpublished changes for
      // the crime of being looked at.
      if (Number(tile.dataset.x) !== originX || Number(tile.dataset.y) !== originY
        || Number(tile.dataset.w) !== originW || Number(tile.dataset.h) !== originH) {
        save(id)
      }
    }

    tile.addEventListener('pointermove', move)
    tile.addEventListener('pointerup', end)
    tile.addEventListener('pointercancel', end)
  })

  // Keyboard equivalents, because a grid that can only be arranged by dragging
  // cannot be arranged at all by somebody who does not use a mouse.
  document.addEventListener('keydown', (event) => {
    if (!selected) return

    const tag = event.target && event.target.tagName
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return

    const x = Number(selected.dataset.x)
    const y = Number(selected.dataset.y)
    const w = Number(selected.dataset.w)
    const h = Number(selected.dataset.h)
    const id = Number(selected.dataset.id)
    const handled = true

    if (event.key === 'ArrowLeft') place(selected, Math.max(0, x - 1), y, w, h)
    else if (event.key === 'ArrowRight') place(selected, Math.min(COLUMNS - w, x + 1), y, w, h)
    else if (event.key === 'ArrowUp') place(selected, x, Math.max(0, y - 1), w, h)
    else if (event.key === 'ArrowDown') place(selected, x, y + 1, w, h)
    else if (event.key === 'Delete' || event.key === 'Backspace') { remove(id); return }
    else handled = false

    if (handled) {
      event.preventDefault()
      pack(id)
      save(id)
    }
  })

  /* ---- The settings panel ------------------------------------------------ */

  const panel = document.getElementById('rhq-panel')
  const title = document.getElementById('rhq-title')
  const body = document.getElementById('rhq-body')
  const bodyField = document.getElementById('rhq-body-field')
  const measure = document.getElementById('rhq-measure')
  const dimension = document.getElementById('rhq-dimension')
  const time = document.getElementById('rhq-time')
  const grain = document.getElementById('rhq-grain')
  const query = document.querySelector('.rhq-query')

  function option(select, value, label) {
    const element = document.createElement('option')
    element.value = value
    element.textContent = label
    select.appendChild(element)
  }

  // Filled from the registry, so the panel cannot offer a field a query would
  // then be refused for using.
  choices.models.forEach((model) => {
    model.measures.forEach((entry) => {
      option(measure, model.key + '::' + entry.key, model.label + ': ' + entry.label)
    })
  })

  option(dimension, '', 'Nothing')
  option(time, '', 'Nothing')

  choices.dimensions.forEach((entry) => {
    option(dimension, entry.model + '::' + entry.key, entry.label)
    if (entry.type === 'date') option(time, entry.model + '::' + entry.key, entry.label)
  })

  choices.grains.forEach((value) => {
    option(grain, value, value.charAt(0).toUpperCase() + value.slice(1))
  })

  function openPanel(tile) {
    if (!panel) return

    panel.hidden = false

    const isNote = tile.dataset.kind === 'note'
    if (query) query.hidden = isNote
    if (bodyField) bodyField.hidden = !isNote

    const stored = tile.dataset.query ? JSON.parse(tile.dataset.query) : {}
    const heading = tile.querySelector('.rhq-title')

    title.value = heading ? heading.textContent.trim() : ''
    if (body) body.value = (tile.querySelector('.rhq-note p') || {}).textContent || ''

    measure.value = stored.model && stored.measure ? stored.model + '::' + stored.measure : measure.options[0] ? measure.options[0].value : ''
    dimension.value = stored.dimension ? stored.dimension.model + '::' + stored.dimension.key : ''
    time.value = stored.time ? stored.time.model + '::' + stored.time.key : ''
    grain.value = stored.grain || 'day'
  }

  function split(value) {
    if (!value) return null
    const parts = value.split('::')
    return { model: parts[0], key: parts[1] }
  }

  function saveBlock() {
    if (!selected) return

    const measured = split(measure.value)

    say('Saving')

    post('/blocks/' + selected.dataset.id, {
      title: title.value,
      body: body ? body.value : null,
      query: selected.dataset.kind === 'note' ? null : {
        model: measured ? measured.model : null,
        measure: measured ? measured.key : null,
        dimension: split(dimension.value),
        time: split(time.value),
        grain: time.value ? grain.value : null,
      },
    }).then((response) => {
      // A reload rather than a patch: the block has to be recomputed and
      // redrawn by the engine, and the server already knows how.
      if (response.ok) window.location.reload()
      else say('Could not save')
    }).catch(() => { say('Could not save') })
  }

  ;[title, body, measure, dimension, time, grain].forEach((field) => {
    if (!field) return
    field.addEventListener('change', saveBlock)
  })

  function remove(id) {
    say('Removing')

    post('/blocks/' + id, null, 'DELETE').then((response) => {
      if (response.ok) window.location.reload()
      else say('Could not remove that')
    }).catch(() => { say('Could not remove that') })
  }

  const removeButton = document.getElementById('rhq-remove')
  if (removeButton) {
    removeButton.addEventListener('click', () => {
      if (selected) remove(Number(selected.dataset.id))
    })
  }

  const close = document.getElementById('rhq-close')
  if (close) {
    close.addEventListener('click', () => {
      panel.hidden = true
      tiles().forEach((tile) => { tile.classList.remove('is-selected') })
      selected = null
    })
  }
})()
