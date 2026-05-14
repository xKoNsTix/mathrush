// Web Vibration API. Android = nativ, iOS Safari = erst ab 18.4
// partiell und nur wenn in den Bedienungshilfen Vibration aktiviert ist.
// Geräte ohne Support no-oppen still. Längere Pulse (≥25 ms) werden
// von iOS eher honoriert als 10-ms-Mikropulse.

function rawVibrate(pattern: number | number[]): boolean {
  if (typeof navigator === "undefined") return false;
  if (typeof navigator.vibrate !== "function") return false;
  try {
    return navigator.vibrate(pattern);
  } catch {
    return false;
  }
}

/** Kurzer Tipp beim Drücken einer Antwort — etwas länger (28 ms),
 *  damit iOS-Safari den Puls nicht als zu kurz aussortiert. */
export function tapHaptic(): void {
  rawVibrate(28);
}

/** Triple-Pulse für Combo-Milestones — markanter spürbar. */
export function comboHaptic(): void {
  rawVibrate([30, 35, 45]);
}

/** Diagnose: ist die API überhaupt im Browser verfügbar?
 *  (Sagt nichts darüber aus ob das Gerät dann auch wirklich vibriert —
 *  nur ob unser Code überhaupt etwas anstoßen kann.) */
export function isHapticsApiAvailable(): boolean {
  if (typeof navigator === "undefined") return false;
  return typeof navigator.vibrate === "function";
}

/** Test-Vibration für die UI — etwas länger (60 ms), damit man's klar
 *  spürt. Gibt zurück, ob navigator.vibrate erfolgreich war (heißt
 *  nicht zwingend dass Hardware vibriert hat). */
export function testHaptic(): boolean {
  return rawVibrate(60);
}
