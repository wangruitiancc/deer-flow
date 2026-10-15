"use client";

import { useTheme } from "next-themes";
import { useEffect } from "react";

import {
  APPEARANCE_EVENT,
  APPEARANCE_KEY,
  parseAppearance,
  solarAppearance,
} from "@/core/settings/solar-theme";

/** One scheduler per authenticated workspace. No location access or legal data. */
export function WorkspaceAppearance() {
  const { setTheme } = useTheme();
  useEffect(() => {
    const apply = () => {
      try {
        const preference = parseAppearance(
          localStorage.getItem(APPEARANCE_KEY),
        );
        if (!preference) return;
        setTheme(
          preference.mode === "solar"
            ? solarAppearance(new Date(), preference.city)
            : preference.mode,
        );
      } catch {
        /* Continue using next-themes when storage is unavailable. */
      }
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === APPEARANCE_KEY || event.key === null) apply();
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") apply();
    };
    apply();
    const timer = window.setInterval(onVisible, 60_000);
    window.addEventListener(APPEARANCE_EVENT, apply);
    window.addEventListener("storage", onStorage);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener(APPEARANCE_EVENT, apply);
      window.removeEventListener("storage", onStorage);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [setTheme]);
  return null;
}
