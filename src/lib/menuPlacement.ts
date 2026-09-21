/**
 * Where a right-click menu goes, given the pointer and how big the menu turned out to be.
 *
 * The pointer's own point is the preference — a menu that opens somewhere else than where the click
 * was reads as the wrong menu. It is only given up when the menu would not fit: a menu whose lower
 * half is off the bottom of the window cannot be read and its last items cannot be clicked at all,
 * and the taller the menu the more of it is lost, so a menu that grows with every feature it gains
 * eventually loses its most recent one.
 *
 * So the menu FLIPS rather than being shoved. Below the pointer when the whole of it fits there,
 * above it when it does not and there is room above, and otherwise as high as it can go, which keeps
 * the top of it — its heading, and the part a reader starts from — on screen. The same rule sideways.
 *
 * The size is measured rather than assumed, because it is not a constant: the same menu is four
 * items tall in one state and a question with two answers in another, and the words in it decide its
 * height rather than any figure the caller could be expected to know.
 */
export interface MenuPoint { x: number; y: number }
export interface MenuSize { width: number; height: number }

export const placeMenu = (input: { point: MenuPoint; size: MenuSize; viewport: MenuSize; margin?: number }): MenuPoint => {
  const margin = input.margin ?? 8
  const { point, size, viewport } = input
  const fitsBelow = point.y + size.height + margin <= viewport.height
  const fitsAbove = point.y - size.height >= margin
  const y = fitsBelow
    ? point.y
    : fitsAbove ? point.y - size.height : Math.max(margin, viewport.height - size.height - margin)
  const x = point.x + size.width + margin <= viewport.width
    ? point.x
    : Math.max(margin, point.x - size.width)
  return { x, y }
}
