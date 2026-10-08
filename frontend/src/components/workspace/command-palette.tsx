"use client";

import { KeyboardIcon, ScaleIcon, SettingsIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useI18n } from "@/core/i18n/hooks";
import { useGlobalShortcuts } from "@/hooks/use-global-shortcuts";

import { useSettingsDialog } from "./settings";

export function CommandPalette() {
  const { t } = useI18n();
  const router = useRouter();
  const { openSettings } = useSettingsDialog();
  const [open, setOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [isMac, setIsMac] = useState(false);

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

  useEffect(() => {
    setIsMac(navigator.userAgent.includes("Mac"));
  }, []);
  const metaKey = isMac ? "⌘" : "Ctrl+";
  const shiftKey = isMac ? "⇧" : "Shift+";

  return (
    <>
      <CommandDialog open={open} onOpenChange={setOpen}>
        <CommandInput placeholder={t.shortcuts.searchActions} />
        <CommandList>
          <CommandEmpty>{t.shortcuts.noResults}</CommandEmpty>
          <CommandGroup heading={t.shortcuts.actions}>
            <CommandItem onSelect={handleOpenLegalMatters}>
              <ScaleIcon className="mr-2 h-4 w-4" />
              {t.sidebar.lawMatters}
              <CommandShortcut>
                {metaKey}
                {shiftKey}N
              </CommandShortcut>
            </CommandItem>
            <CommandItem onSelect={handleOpenSettings}>
              <SettingsIcon className="mr-2 h-4 w-4" />
              {t.common.settings}
              <CommandShortcut>{metaKey},</CommandShortcut>
            </CommandItem>
            <CommandItem onSelect={handleShowShortcuts}>
              <KeyboardIcon className="mr-2 h-4 w-4" />
              {t.shortcuts.keyboardShortcuts}
              <CommandShortcut>{metaKey}/</CommandShortcut>
            </CommandItem>
          </CommandGroup>
        </CommandList>
      </CommandDialog>

      <Dialog open={shortcutsOpen} onOpenChange={setShortcutsOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t.shortcuts.keyboardShortcuts}</DialogTitle>
            <DialogDescription>
              {t.shortcuts.keyboardShortcutsDescription}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            {[
              { keys: `${metaKey}K`, label: t.shortcuts.openCommandPalette },
              { keys: `${metaKey}${shiftKey}N`, label: t.sidebar.lawMatters },
              { keys: `${metaKey}B`, label: t.shortcuts.toggleSidebar },
              { keys: `${metaKey},`, label: t.common.settings },
              {
                keys: `${metaKey}/`,
                label: t.shortcuts.keyboardShortcuts,
              },
            ].map(({ keys, label }) => (
              <div key={keys} className="flex items-center justify-between">
                <span className="text-muted-foreground">{label}</span>
                <kbd className="bg-muted text-muted-foreground rounded px-2 py-0.5 font-mono text-xs">
                  {keys}
                </kbd>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
