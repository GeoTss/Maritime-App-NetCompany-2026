/**
 * The ⌘K menu (cmdk through shadcn `command`). The shell owns the screens group; each screen
 * registers its own groups while mounted (vessels and ports on the map, ships by name or MMSI,
 * "deliver next email" in the inbox) with `useRegisterCommands`.
 */
import {
  Analytics01Icon,
  CheckListIcon,
  InboxIcon,
  MapsIcon,
  PaintBoardIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useNavigate } from "react-router";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";

export interface CommandItemDef {
  id: string;
  label: string;
  /** Extra words cmdk matches on (an MMSI, a UN/LOCODE). */
  keywords?: string[];
  /** A short identifier shown on the right, e.g. the MMSI. */
  hint?: string;
  icon?: IconSvgElement;
  /** Listed only once the query has this many characters (AIS ships: a long list is noise). */
  minQuery?: number;
  onSelect: () => void;
}

export interface CommandGroupDef {
  id: string;
  heading: string;
  items: CommandItemDef[];
}

interface CommandMenuState {
  open: boolean;
  setOpen: (open: boolean) => void;
  groups: CommandGroupDef[];
  register: (group: CommandGroupDef) => () => void;
}

const CommandMenuContext = createContext<CommandMenuState | null>(null);

export function CommandMenuProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [registered, setRegistered] = useState<ReadonlyMap<string, CommandGroupDef>>(new Map());

  const register = useCallback((group: CommandGroupDef) => {
    setRegistered((current) => new Map(current).set(group.id, group));
    return () =>
      setRegistered((current) => {
        const next = new Map(current);
        next.delete(group.id);
        return next;
      });
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey) && !e.altKey) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const value = useMemo(
    () => ({ open, setOpen, groups: [...registered.values()], register }),
    [open, registered, register],
  );
  return <CommandMenuContext.Provider value={value}>{children}</CommandMenuContext.Provider>;
}

export function useCommandMenu() {
  const ctx = useContext(CommandMenuContext);
  if (!ctx) throw new Error("useCommandMenu needs a CommandMenuProvider (the app shell has one)");
  return ctx;
}

/** Adds a group to the menu while the calling component is mounted. Memoize the group. */
export function useRegisterCommands(group: CommandGroupDef | null) {
  const { register } = useCommandMenu();
  useEffect(() => (group ? register(group) : undefined), [group, register]);
}

export const SCREENS: { path: string; label: string; icon: IconSvgElement; keywords: string[] }[] =
  [
    { path: "/", label: "Map", icon: MapsIcon, keywords: ["traffic", "ais", "weather", "route"] },
    { path: "/inbox", label: "Inbox", icon: InboxIcon, keywords: ["email", "quotes", "review"] },
    {
      path: "/approvals",
      label: "Approvals",
      icon: CheckListIcon,
      keywords: ["orders", "approve"],
    },
    {
      path: "/evaluation",
      label: "Evaluation",
      icon: Analytics01Icon,
      keywords: ["accuracy", "scorecard"],
    },
  ];

export const DEV_SCREENS = [
  {
    path: "/dev/kit",
    label: "Design kit",
    icon: PaintBoardIcon,
    keywords: ["tokens", "components"],
  },
];

export function CommandMenu() {
  const { open, setOpen, groups } = useCommandMenu();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);
  const run = (fn: () => void) => {
    setOpen(false);
    fn();
  };

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <Command>
        <CommandInput
          value={query}
          onValueChange={setQuery}
          placeholder="Go to a screen, vessel, port or ship (name or MMSI)"
        />
        <CommandList>
          <CommandEmpty>Nothing matches. Try a vessel name, an MMSI or a port code.</CommandEmpty>
          <CommandGroup heading="Screens">
            {SCREENS.map((s) => (
              <CommandItem
                key={s.path}
                value={`screen ${s.label}`}
                keywords={s.keywords}
                onSelect={() => run(() => navigate(s.path))}
              >
                <HugeiconsIcon icon={s.icon} strokeWidth={1.75} />
                {s.label}
              </CommandItem>
            ))}
          </CommandGroup>
          <CommandSeparator />
          <CommandGroup heading="Developer">
            {DEV_SCREENS.map((s) => (
              <CommandItem
                key={s.path}
                value={`developer ${s.label}`}
                keywords={s.keywords}
                onSelect={() => run(() => navigate(s.path))}
              >
                <HugeiconsIcon icon={s.icon} strokeWidth={1.75} />
                {s.label}
              </CommandItem>
            ))}
          </CommandGroup>
          {groups.map((group) => (
            <div key={group.id}>
              <CommandSeparator />
              <CommandGroup heading={group.heading}>
                {group.items
                  .filter((item) => query.trim().length >= (item.minQuery ?? 0))
                  .map((item) => (
                    <CommandItem
                      key={item.id}
                      value={`${group.id} ${item.id} ${item.label}`}
                      keywords={item.keywords}
                      onSelect={() => run(item.onSelect)}
                    >
                      {item.icon ? <HugeiconsIcon icon={item.icon} strokeWidth={1.75} /> : null}
                      <span className="min-w-0 truncate">{item.label}</span>
                      {item.hint ? <CommandShortcut>{item.hint}</CommandShortcut> : null}
                    </CommandItem>
                  ))}
              </CommandGroup>
            </div>
          ))}
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
