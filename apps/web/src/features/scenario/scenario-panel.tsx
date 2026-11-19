/**
 * The demo Scenario panel: change the pinned demo world live (a fleet vessel's stats, synthetic
 * hazards, weather in an area) and reset it. A non-modal vaul drawer on the right of the map
 * canvas, so the map stays clickable for placing things. Shown only where the API allows edits
 * (`DEMO_CONTROLS=on`, the clock pinned, the weather recorded). These are a presenter's own
 * edits: the assistant never makes them.
 */
import { Cancel01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerContent, DrawerDescription, DrawerTitle } from "@/components/ui/drawer";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { describeFailure } from "@/lib/api";
import type { PickRequest } from "./fields";
import { HazardForm, WeatherForm } from "./place-forms";
import {
  type ScenarioEdit,
  type ScenarioPreview,
  useScenario,
  useScenarioEdit,
} from "./scenario-data";
import { VesselForm } from "./vessel-form";

const DONE: Record<ScenarioEdit["kind"], string> = {
  vessel: "Vessel saved. Plan again to see its effect.",
  addHazard: "Hazard placed.",
  removeHazard: "Hazard removed.",
  addArea: "Weather area placed.",
  removeArea: "Weather area removed.",
  reset: "Back to the recorded demo.",
};

/**
 * vaul does not hand `modal={false}` to the Radix dialog under it, so the dialog still marks every
 * other part of the page `aria-hidden`; the map and the rest stay usable, so undo it.
 */
function unhideRestOfPage() {
  const unhide = () => {
    for (const el of document.querySelectorAll("[data-aria-hidden]")) {
      el.removeAttribute("aria-hidden");
      el.removeAttribute("data-aria-hidden");
    }
  };
  unhide();
  const frame = requestAnimationFrame(unhide);
  return () => cancelAnimationFrame(frame);
}

export function ScenarioLauncher({
  container,
  onPickRequest,
  onPreview,
  onEdited,
}: {
  /** The map canvas the drawer is scoped to. */
  container: HTMLElement | null;
  onPickRequest: PickRequest;
  onPreview: (preview: ScenarioPreview | null) => void;
  /** After an edit lands (the page marks an open plan as made before it). */
  onEdited?: (edit: ScenarioEdit) => void;
}) {
  const scenario = useScenario();
  const [open, setOpen] = useState(false);
  const edit = useScenarioEdit((e) => {
    toast(DONE[e.kind]);
    onEdited?.(e);
  });
  const run = (e: ScenarioEdit) =>
    edit.mutate(e, { onError: (err) => toast.error(describeFailure(err)) });
  useEffect(() => {
    if (!open) {
      onPreview(null);
      onPickRequest(null);
    }
  }, [open, onPreview, onPickRequest]);

  const view = scenario.data;
  if (!view?.enabled) return null;
  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="pointer-events-auto h-8 bg-ink-900 text-text-1"
        aria-pressed={open}
        onClick={() => setOpen((o) => !o)}
      >
        Scenario{view.edited ? <span className="text-caution">, edited</span> : null}
      </Button>
      {open ? (
        <Drawer
          open
          modal={false}
          dismissible={false}
          direction="right"
          container={container}
          onOpenChange={setOpen}
        >
          <ScenarioDrawer
            container={container}
            view={view}
            saving={edit.isPending}
            onRun={run}
            onClose={() => setOpen(false)}
            onPickRequest={onPickRequest}
            onPreview={onPreview}
          />
        </Drawer>
      ) : null}
    </>
  );
}

function ScenarioDrawer({
  container,
  view,
  saving,
  onRun,
  onClose,
  onPickRequest,
  onPreview,
}: {
  container: HTMLElement | null;
  view: NonNullable<ReturnType<typeof useScenario>["data"]>;
  saving: boolean;
  onRun: (edit: ScenarioEdit) => void;
  onClose: () => void;
  onPickRequest: PickRequest;
  onPreview: (preview: ScenarioPreview | null) => void;
}) {
  useEffect(unhideRestOfPage, []);
  const place = { saving, onPickRequest, onPreview };
  return (
    <DrawerContent
      container={container}
      overlay={false}
      aria-describedby="scenario-description"
      className="absolute! inset-y-0 right-0 h-full w-full max-w-sm! p-0 before:inset-0 before:rounded-none before:border-y-0 before:border-r-0"
    >
      <div className="flex h-9 shrink-0 items-center gap-3 border-b border-line px-3">
        <DrawerTitle className="text-sm font-medium font-title">Demo scenario</DrawerTitle>
        <Button
          variant="ghost"
          size="icon-sm"
          className="ml-auto"
          aria-label="Close the scenario panel"
          onClick={onClose}
        >
          <HugeiconsIcon icon={Cancel01Icon} size={14} />
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-3" data-vaul-no-drag>
        <DrawerDescription id="scenario-description" className="pb-3 text-xs text-text-2">
          Change the demo world. The console recalculates from it; the assistant's recorded replies
          cover the unedited demo only. To ask about an edited world, run{" "}
          <code className="text-text-1">LLM_MODE=live npm run demo:reset</code> (paid model calls).
        </DrawerDescription>
        <Tabs defaultValue="vessels" className="gap-3">
          <TabsList>
            <TabsTrigger value="vessels">Vessels</TabsTrigger>
            <TabsTrigger value="hazards">Hazards</TabsTrigger>
            <TabsTrigger value="weather">Weather</TabsTrigger>
          </TabsList>
          <TabsContent value="vessels">
            <VesselForm
              vessels={view.vessels}
              saving={saving}
              onSave={(id, patch) => onRun({ kind: "vessel", id, patch })}
            />
          </TabsContent>
          <TabsContent value="hazards">
            <HazardForm
              {...place}
              hazards={view.hazards}
              onAdd={(input) => onRun({ kind: "addHazard", input })}
              onRemove={(id) => onRun({ kind: "removeHazard", id })}
            />
          </TabsContent>
          <TabsContent value="weather">
            <WeatherForm
              {...place}
              areas={view.weatherAreas}
              onAdd={(input) => onRun({ kind: "addArea", input })}
              onRemove={(id) => onRun({ kind: "removeArea", id })}
            />
          </TabsContent>
        </Tabs>
      </div>
      <div className="flex shrink-0 items-center gap-2 border-t border-line p-3">
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="outline" size="sm" disabled={saving}>
              Reset the demo world
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Reset the demo world?</AlertDialogTitle>
              <AlertDialogDescription>
                Edits, chats, approvals and the inbox go back to the recorded demo.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Keep the edits</AlertDialogCancel>
              <AlertDialogAction onClick={() => onRun({ kind: "reset" })}>Reset</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </DrawerContent>
  );
}
