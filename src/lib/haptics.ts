// Native iOS haptics via Capacitor (UIImpactFeedbackGenerator /
// UINotificationFeedbackGenerator). On web, falls back to navigator.vibrate
// (Android = native, iOS Safari = mostly no-op).

import { Capacitor } from "@capacitor/core";
import { Haptics, ImpactStyle, NotificationType } from "@capacitor/haptics";

function isNative(): boolean {
  return typeof window !== "undefined" && Capacitor.isNativePlatform();
}

function webVibrate(pattern: number | number[]): boolean {
  if (typeof navigator === "undefined") return false;
  if (typeof navigator.vibrate !== "function") return false;
  try {
    return navigator.vibrate(pattern);
  } catch {
    return false;
  }
}

export function tapHaptic(): void {
  if (isNative()) {
    Haptics.impact({ style: ImpactStyle.Light }).catch(() => {});
    return;
  }
  webVibrate(28);
}

export function comboHaptic(): void {
  if (isNative()) {
    Haptics.notification({ type: NotificationType.Success }).catch(() => {});
    return;
  }
  webVibrate([30, 35, 45]);
}

export function wrongHaptic(): void {
  if (isNative()) {
    Haptics.notification({ type: NotificationType.Error }).catch(() => {});
    return;
  }
  webVibrate([40, 50, 40]);
}

export function isHapticsApiAvailable(): boolean {
  if (isNative()) return true;
  if (typeof navigator === "undefined") return false;
  return typeof navigator.vibrate === "function";
}

export function testHaptic(): boolean {
  if (isNative()) {
    Haptics.impact({ style: ImpactStyle.Medium }).catch(() => {});
    return true;
  }
  return webVibrate(60);
}
