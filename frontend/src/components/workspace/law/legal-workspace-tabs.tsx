"use client";

import {
  BookOpenIcon,
  BrainIcon,
  CalendarDaysIcon,
  ChevronDownIcon,
  FilePenLineIcon,
  FolderIcon,
  Maximize2Icon,
  MicIcon,
  Minimize2Icon,
  NetworkIcon,
  PlusIcon,
  ScanTextIcon,
  XIcon,
} from "lucide-react";
import { useId, useRef } from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  WORKSPACE_FUNCTIONS,
  type WorkspaceFunction,
  type WorkspaceTabState,
} from "@/core/law/workspace-tabs";
import { cn } from "@/lib/utils";

const ICONS = {
  documents: ScanTextIcon,
  speech: MicIcon,
  graph: NetworkIcon,
  drafting: FilePenLineIcon,
  overview: FolderIcon,
  deadlines: CalendarDaysIcon,
  authorities: BookOpenIcon,
  memory: BrainIcon,
};

export function LegalWorkspaceTabs({
  idPrefix,
  state,
  onOpen,
  onClose,
  onHide,
  expanded,
  onExpandedChange,
  recording = false,
  dirtyFunctions = [],
}: {
  idPrefix?: string;
  state: WorkspaceTabState;
  onOpen: (id: WorkspaceFunction) => void;
  onClose: (id: WorkspaceFunction) => void;
  onHide: () => void;
  expanded: boolean;
  onExpandedChange?: (value: boolean) => void;
  recording?: boolean;
  dirtyFunctions?: WorkspaceFunction[];
}) {
  const generatedId = useId();
  const id = idPrefix ?? generatedId;
  const buttons = useRef(new Map<WorkspaceFunction, HTMLButtonElement>());
  const addButton = useRef<HTMLButtonElement>(null);
  const close = (tabId: WorkspaceFunction) => {
    const index = state.opened.indexOf(tabId);
    const remaining = state.opened.filter((item) => item !== tabId);
    const next =
      state.active === tabId
        ? remaining[Math.min(index, remaining.length - 1)]
        : state.active;
    onClose(tabId);
    if (next) buttons.current.get(next)?.focus();
    else addButton.current?.focus();
  };
  return (
    <header className="law-workspace-tabs">
      <div
        role="tablist"
        aria-label="工作区功能"
        className="law-workspace-tablist"
      >
        {state.opened.map((tabId) => {
          const tab = WORKSPACE_FUNCTIONS.find((item) => item.id === tabId)!;
          const Icon = ICONS[tabId];
          const dirty = dirtyFunctions.includes(tabId);
          return (
            <div
              className={cn(
                "law-workspace-tab",
                state.active === tabId && "is-active",
              )}
              key={tabId}
            >
              <button
                ref={(element) => {
                  if (element) buttons.current.set(tabId, element);
                  else buttons.current.delete(tabId);
                }}
                id={`${id}-tab-${tabId}`}
                role="tab"
                aria-controls={`${id}-panel-${tabId}`}
                aria-selected={state.active === tabId}
                aria-label={`${tab.title}${dirty ? "，有未保存修改" : ""}${tabId === "speech" && recording ? "，正在录音" : ""}`}
                tabIndex={state.active === tabId ? 0 : -1}
                onClick={() => onOpen(tabId)}
                onKeyDown={(event) => {
                  const index = state.opened.indexOf(tabId);
                  let next: WorkspaceFunction | undefined;
                  if (event.key === "Home") next = state.opened[0];
                  if (event.key === "End") next = state.opened.at(-1);
                  if (event.key === "ArrowRight")
                    next = state.opened[(index + 1) % state.opened.length];
                  if (event.key === "ArrowLeft")
                    next =
                      state.opened[
                        (index + state.opened.length - 1) % state.opened.length
                      ];
                  if (next) {
                    event.preventDefault();
                    onOpen(next);
                    buttons.current.get(next)?.focus();
                  }
                  if (event.key === "Delete") {
                    event.preventDefault();
                    close(tabId);
                  }
                }}
              >
                <Icon
                  className={
                    tabId === "speech" && recording ? "is-recording" : undefined
                  }
                />
                <span>{tab.title}</span>
              </button>
              <button
                type="button"
                className={cn("law-workspace-tab-close", dirty && "has-draft")}
                aria-label={`关闭${tab.title}页签`}
                title="关闭视图，保留当前工作"
                onClick={() => close(tabId)}
              >
                <XIcon />
                <span aria-hidden="true" />
              </button>
            </div>
          );
        })}
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            ref={addButton}
            className="law-workspace-icon"
            aria-label="打开功能"
            id={`${id}-add`}
          >
            <PlusIcon />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="law-workbench w-64">
          <DropdownMenuLabel>打开工作区功能</DropdownMenuLabel>
          {WORKSPACE_FUNCTIONS.map((tab) => {
            const Icon = ICONS[tab.id];
            return (
              <DropdownMenuItem key={tab.id} onSelect={() => onOpen(tab.id)}>
                <Icon />
                <span className="min-w-0">
                  <span className="block text-xs">{tab.title}</span>
                  <span className="text-muted-foreground block text-[11px]">
                    {tab.description}
                  </span>
                </span>
                {state.opened.includes(tab.id) && (
                  <span className="text-muted-foreground ml-auto text-[10px]">
                    已打开
                  </span>
                )}
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="law-workspace-icon" aria-label="所有已打开页签">
            <ChevronDownIcon />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="law-workbench w-52">
          <DropdownMenuLabel>已打开</DropdownMenuLabel>
          {state.opened.map((tabId) => (
            <DropdownMenuItem key={tabId} onSelect={() => onOpen(tabId)}>
              {WORKSPACE_FUNCTIONS.find((item) => item.id === tabId)!.title}
            </DropdownMenuItem>
          ))}
          {!state.opened.length && (
            <DropdownMenuItem disabled>暂无打开的功能</DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={onHide}>收起整个功能区</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {onExpandedChange && (
        <button
          className="law-workspace-icon"
          aria-label={expanded ? "退出展开工作区" : "展开工作区"}
          onClick={() => onExpandedChange(!expanded)}
        >
          {expanded ? <Minimize2Icon /> : <Maximize2Icon />}
        </button>
      )}
      <button
        className="law-workspace-icon"
        aria-label="关闭工作区"
        onClick={onHide}
      >
        <XIcon />
      </button>
    </header>
  );
}
