/**
 * Grow a textarea with its text, up to its CSS max-height.
 *
 * Sized in whole rows (the rows attribute) by comparing scrollHeight with
 * clientHeight, which are measured the same way, instead of copying
 * scrollHeight into style.height: that is rounded to whole pixels, and
 * under CSS zoom (Ctrl +/- in the chat) it can round below the real
 * height of a line, which showed a scrollbar in an empty box. The
 * scrollbar is only shown once the text is taller than max-height.
 * @param {HTMLTextAreaElement} el
 * @param {number} [maxRows] - safety limit on the loop
 */
export function fitTextarea(el, maxRows = 40) {
  if (!el) return
  el.style.height = ''
  el.style.overflowY = 'hidden'
  let rows = 1
  el.rows = rows
  while (el.scrollHeight > el.clientHeight && rows < maxRows) {
    const before = el.clientHeight
    rows += 1
    el.rows = rows
    // Stopped growing: max-height reached
    if (el.clientHeight <= before) break
  }
  el.style.overflowY = el.scrollHeight > el.clientHeight ? 'auto' : 'hidden'
}
