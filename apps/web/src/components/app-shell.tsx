/**
 * Every screen shares this frame: the 48 px top bar, the screen canvas
 * and the assistant dock (resizable and collapsible from 768 px; a bottom drawer below that).
 */
import { AiChat02Icon } from "@hugeicons/core-free-icons";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { usePanelRef } from "react-resizable-panels";
import { Outlet } from "react-router";
import { CommandMenu, CommandMenuProvider } from "@/components/command-menu";
import { EmptyState } from "@/components/empty-state";
import { TopBar } from "@/components/top-bar";
import { Drawer, DrawerContent, DrawerDescription, DrawerTitle } from "@/components/ui/drawer";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { getLayout, setLayout, useLayout } from "@/lib/layout";
import { useMediaQuery } from "@/lib/motion";

/** Stands in until the assistant screen mounts its dock here. */
export function AssistantDockPlaceholder() {
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-9 shrink-0 items-center border-b border-line px-3">
        <h2 className="text-xs font-medium text-text-2 font-label">Assistant</h2>
      </div>
      <EmptyState
        icon={AiChat02Icon}
        title="Ask about the fleet"
        description="Where to bunker, which route and speed, what a voyage emits, how long a port's queue is. Every number in an answer opens to the fact behind it."
      />
    </div>
  );
}

/** The id of the assistant's question box: the skip link and the `/` key both land here. */
export const ASK_BOX_ID = "ask-the-assistant";

/** Focus the question box, waiting a few frames for it to mount (a drawer opening). */
function focusAskBox(tries = 20) {
  const box = document.getElementById(ASK_BOX_ID);
  if (box) box.focus();
  else if (tries > 0) requestAnimationFrame(() => focusAskBox(tries - 1));
}

function typingInField(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName);
}

export function AppShell({ dock }: { dock?: ReactNode }) {
  const wide = useMediaQuery("(min-width: 768px)", true);
  const dockPanel = usePanelRef();
  const layout = useLayout();
  // Focus mode puts the dock away without forgetting whether it was open.
  const showDock = layout.dock && !layout.focus;
  const [drawerOpen, setDrawerOpen] = useState(false);
  const dockContent = dock ?? <AssistantDockPlaceholder />;

  useEffect(() => {
    const panel = dockPanel.current;
    if (!wide || !panel) return;
    if (showDock && panel.isCollapsed()) panel.expand();
    else if (!showDock && !panel.isCollapsed()) panel.collapse();
  }, [wide, showDock, dockPanel]);

  const toggleDock = useCallback(() => {
    if (!wide) {
      setDrawerOpen((o) => !o);
      return;
    }
    setLayout({ dock: !showDock, focus: false });
  }, [wide, showDock]);

  const openDock = useCallback(() => {
    if (!wide) setDrawerOpen(true);
    else setLayout({ dock: true, focus: false });
    focusAskBox();
  }, [wide]);

  // `/` jumps to the question box unless the operator is already typing somewhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return;
      if (typingInField(e.target)) return;
      e.preventDefault();
      openDock();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openDock]);

  return (
    <CommandMenuProvider>
      <a
        href={`#${ASK_BOX_ID}`}
        onClick={(e) => {
          e.preventDefault();
          openDock();
        }}
        className="sr-only focus-visible:not-sr-only focus-visible:fixed focus-visible:top-2 focus-visible:left-2 focus-visible:z-[100] focus-visible:border focus-visible:border-line-strong focus-visible:bg-ink-900 focus-visible:px-3 focus-visible:py-1.5 focus-visible:text-xs focus-visible:text-text-1"
      >
        Skip to the assistant
      </a>
      <div className="grid h-dvh grid-cols-[minmax(0,1fr)] grid-rows-[auto_1fr] overflow-hidden bg-ink-950 text-text-1">
        <TopBar dockOpen={wide ? showDock : drawerOpen} onToggleDock={toggleDock} />
        <div className="flex min-h-0">
          {wide ? (
            <ResizablePanelGroup orientation="horizontal" className="min-w-0 flex-1">
              <ResizablePanel id="canvas" minSize="40%">
                <main id="screen" className="relative h-full min-w-0 overflow-auto">
                  <Outlet />
                </main>
              </ResizablePanel>
              <ResizableHandle />
              <ResizablePanel
                id="assistant"
                panelRef={dockPanel}
                defaultSize={360}
                minSize={280}
                maxSize="50%"
                collapsible
                collapsedSize={0}
                // Dragged shut or open by hand: remembered (focus mode's own collapse is not).
                onResize={(size) => {
                  if (!getLayout().focus) setLayout({ dock: size.inPixels > 0 });
                }}
              >
                <aside
                  aria-label="Assistant"
                  className="relative h-full min-w-0 overflow-hidden bg-ink-900"
                >
                  {dockContent}
                </aside>
              </ResizablePanel>
            </ResizablePanelGroup>
          ) : (
            <main id="screen" className="relative h-full min-w-0 flex-1 overflow-auto">
              <Outlet />
            </main>
          )}
        </div>
      </div>
      {wide ? null : (
        <Drawer open={drawerOpen} onOpenChange={setDrawerOpen}>
          <DrawerContent className="h-[80vh]">
            <DrawerTitle className="sr-only">Assistant</DrawerTitle>
            <DrawerDescription className="sr-only">Ask about the fleet.</DrawerDescription>
            {dockContent}
          </DrawerContent>
        </Drawer>
      )}
      <CommandMenu />
    </CommandMenuProvider>
  );
}
