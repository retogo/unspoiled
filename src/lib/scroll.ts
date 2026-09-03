/**
 * A reveal can run past the foot of the window, where the reader would be watching words arrive
 * somewhere they cannot see. The page follows them down instead: every word that starts arriving
 * below `READING_ROOM_PX` of clear space asks for exactly the scroll that puts it back above that
 * line, so the page moves at the pace the words do and keeps a few lines of room underneath.
 */
const READING_ROOM_PX = 120;

/** How much of the foot of the window an element is sitting over. */
export function bottomOverlap(rect: { top: number; bottom: number }, viewport: number): number {
  if (rect.bottom < viewport - 1) return 0;
  return Math.max(0, viewport - rect.top);
}

/** How far the page must move for a word ending at `wordBottom` to sit clear of the foot. */
export function scrollToFollow(wordBottom: number, viewport: number, covered: number): number {
  const room = viewport - covered - READING_ROOM_PX;
  return wordBottom > room ? Math.ceil(wordBottom - room) : 0;
}
