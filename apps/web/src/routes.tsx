/**
 * The console's routes. Each screen task swaps its placeholder for the real page:
 * `/` map (Task 10), `/inbox` (Task 11), `/approvals` (Task 12), `/evaluation` (Task 13).
 * Deep links: `/inbox?document=<id>` opens one email (fact chips with a document source link here).
 */
import {
  Analytics01Icon,
  CheckListIcon,
  InboxIcon,
  Search01Icon,
} from "@hugeicons/core-free-icons";
import type { IconSvgElement } from "@hugeicons/react";
import { createBrowserRouter, Link, type RouteObject } from "react-router";
import { AppShell } from "@/components/app-shell";
import { EmptyState } from "@/components/empty-state";
import { KitPage } from "@/features/dev/kit-page";
import { MapPage } from "@/features/map/map-page";

function ScreenPlaceholder({
  title,
  icon,
  description,
}: {
  title: string;
  icon: IconSvgElement;
  description: string;
}) {
  return (
    <div className="p-3">
      <EmptyState icon={icon} title={title} description={description} />
    </div>
  );
}

function NotFound() {
  return (
    <div className="p-3">
      <EmptyState
        icon={Search01Icon}
        title="No screen at this address"
        description="Use the rail on the left, or press ⌘K to go to a screen, vessel or port."
        action={
          <Link to="/" className="text-xs text-beacon underline underline-offset-3">
            Go to the map
          </Link>
        }
      />
    </div>
  );
}

export const routes: RouteObject[] = [
  {
    element: <AppShell />,
    children: [
      {
        index: true,
        element: <MapPage />,
      },
      {
        path: "inbox",
        element: (
          <ScreenPlaceholder
            title="Inbox"
            icon={InboxIcon}
            description="Supplier quote emails beside the structured quote read from each."
          />
        ),
      },
      {
        path: "approvals",
        element: (
          <ScreenPlaceholder
            title="Approvals"
            icon={CheckListIcon}
            description="Purchase orders and voyage instructions waiting for a decision."
          />
        ),
      },
      {
        path: "evaluation",
        element: (
          <ScreenPlaceholder
            title="Evaluation"
            icon={Analytics01Icon}
            description="Measured accuracy of extraction and answers, from published live runs."
          />
        ),
      },
      { path: "dev/kit", element: <KitPage /> },
      { path: "*", element: <NotFound /> },
    ],
  },
];

export const createRouter = () => createBrowserRouter(routes);
