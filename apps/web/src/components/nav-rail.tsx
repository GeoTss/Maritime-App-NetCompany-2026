import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import { NavLink } from "react-router";
import { DEV_SCREENS, SCREENS } from "@/components/command-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

function RailLink({ path, label, icon }: { path: string; label: string; icon: IconSvgElement }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <NavLink
          to={path}
          end={path === "/"}
          aria-label={label}
          className={({ isActive }) =>
            cn(
              "relative flex size-9 items-center justify-center rounded-md text-text-3 outline-none",
              "transition-colors duration-150 hover:bg-ink-850 hover:text-text-1",
              "focus-visible:ring-2 focus-visible:ring-beacon/50",
              isActive &&
                "bg-ink-800 text-text-1 before:absolute before:inset-y-1.5 before:-left-1 before:w-px before:bg-beacon",
            )
          }
        >
          <HugeiconsIcon icon={icon} strokeWidth={1.75} className="size-[18px]" />
        </NavLink>
      </TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}

/** The 44 px rail: the four screens, and the design kit at the foot. */
export function NavRail() {
  return (
    <nav
      aria-label="Screens"
      className="flex w-11 shrink-0 flex-col items-center justify-between border-r border-line bg-ink-900 py-1.5"
    >
      <div className="flex flex-col items-center gap-1">
        {SCREENS.map((s) => (
          <RailLink key={s.path} {...s} />
        ))}
      </div>
      <div className="flex flex-col items-center gap-1">
        {DEV_SCREENS.map((s) => (
          <RailLink key={s.path} {...s} />
        ))}
      </div>
    </nav>
  );
}
