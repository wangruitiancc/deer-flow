import { useSyncExternalStore } from "react";

const QUERY = "(max-width: 1023px)";
function subscribe(callback: () => void) {
  const media = window.matchMedia(QUERY);
  media.addEventListener("change", callback);
  return () => media.removeEventListener("change", callback);
}
const snapshot = () => window.matchMedia(QUERY).matches;
const serverSnapshot = () => false;

// A tablet cannot fit the project sidebar, conversation and readable artifacts together.
export function useRightPanelOverlay() {
  return useSyncExternalStore(subscribe, snapshot, serverSnapshot);
}
