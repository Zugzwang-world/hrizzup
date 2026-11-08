let marked = false;

/**
 * Says once, in the app's log, when its first screen has laid out its content: the end of a
 * cold start (blueprint section 14, the app's budget: first content within 2 seconds of a cold
 * start). The App journeys check reads this line from Android's log (journeys/startup.sh) and
 * times it from the moment Android starts the app's process. Nothing else reads it.
 */
export function markFirstContent() {
  if (marked) return;
  marked = true;
  // After the frame that shows the content, not just after layout.
  requestAnimationFrame(() => console.log('hrizzup:first-content'));
}
