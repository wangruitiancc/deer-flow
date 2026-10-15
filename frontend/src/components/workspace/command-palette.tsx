"use client";

import { useRouter } from "next/navigation";
import { lazy, Suspense, useCallback, useMemo, useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useI18n } from "@/core/i18n/hooks";
import { useGlobalShortcuts } from "@/hooks/use-global-shortcuts";

import { useSettingsDialog } from "./settings";

const CommandPaletteDialogs = lazy(() =>
  import("./command-palette-dialogs").then((module) => ({
    default: module.CommandPaletteDialogs,
  })),
);

export function CommandPalette() {
  const { t } = useI18n();
  const router = useRouter();
  const { openSettings } = useSettingsDialog();
  const [open, setOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  const handleOpenLegalMatters = useCallback(() => {
    router.push("/workspace/law");
    setOpen(false);
  }, [router]);

  const handleOpenSettings = useCallback(() => {
    setOpen(false);
    openSettings("appearance");
  }, [openSettings]);

  const handleShowShortcuts = useCallback(() => {
    setOpen(false);
    setShortcutsOpen(true);
  }, []);

  const shortcuts = useMemo(
    () => [
      { key: "k", meta: true, action: () => setOpen((o) => !o) },
      { key: "n", meta: true, shift: true, action: handleOpenLegalMatters },
      { key: ",", meta: true, action: handleOpenSettings },
      { key: "/", meta: true, action: handleShowShortcuts },
    ],
    [handleOpenLegalMatters, handleOpenSettings, handleShowShortcuts],
  );

  useGlobalShortcuts(shortcuts);

  if (!open && !shortcutsOpen) return null;
  return (
    <Suspense
      fallback={
        <Dialog
          open
          onOpenChange={(next) => {
            if (!next) {
              setOpen(false);
              setShortcutsOpen(false);
            }
          }}
        >
          <DialogContent className="law-workbench" aria-describedby={undefined}>
            <DialogHeader>
              <DialogTitle>{t.common.loading}</DialogTitle>
            </DialogHeader>
          </DialogContent>
        </Dialog>
      }
    >
      <CommandPaletteDialogs
        open={open}
        shortcutsOpen={shortcutsOpen}
        setOpen={setOpen}
        setShortcutsOpen={setShortcutsOpen}
        handleOpenLegalMatters={handleOpenLegalMatters}
        handleOpenSettings={handleOpenSettings}
        handleShowShortcuts={handleShowShortcuts}
      />
    </Suspense>
  );
}
