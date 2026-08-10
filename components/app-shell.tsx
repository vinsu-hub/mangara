"use client";

import { useState } from "react";
import {
  MessageSquare,
  Folder,
  LayoutGrid,
  Users,
  Download,
  ChevronLeft,
  Undo2,
  Redo2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { signOut } from "@/app/actions";

const TOP_TABS = ["Prompting", "Editing", "Reviewing"] as const;
const MENU_ITEMS = ["File", "Edit", "View", "Timeline", "Tools", "Help"];
const RAIL_ITEMS = [
  { label: "Main Chat", icon: MessageSquare },
  { label: "Assets", icon: Folder },
  { label: "Story Board", icon: LayoutGrid },
  { label: "Character Ref", icon: Users },
  { label: "Outputs", icon: Download },
];

export function AppShell({
  projectName,
  userEmail,
}: {
  projectName: string;
  userEmail: string;
}) {
  const [activeTab, setActiveTab] = useState<(typeof TOP_TABS)[number]>("Prompting");
  const [activeRailItem, setActiveRailItem] = useState("Main Chat");
  const [railCollapsed, setRailCollapsed] = useState(false);

  const initials = userEmail.slice(0, 2).toUpperCase();

  return (
    <div className="flex h-svh flex-col bg-background text-foreground">
      {/* Top bar */}
      <header className="flex h-14 shrink-0 items-center gap-6 border-b border-border px-4">
        <div className="flex items-center gap-2 font-semibold tracking-tight">
          <div className="flex size-6 items-center justify-center rounded-md bg-primary text-primary-foreground text-xs font-bold">
            M
          </div>
          MANGARA
        </div>

        <nav className="flex items-center gap-4 text-sm text-muted-foreground">
          {MENU_ITEMS.map((item) => (
            <span key={item} className="cursor-default select-none hover:text-foreground">
              {item}
            </span>
          ))}
        </nav>

        <div className="flex flex-1 items-center justify-center">
          <div className="flex items-center gap-1 rounded-lg bg-muted p-1">
            {TOP_TABS.map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`rounded-md px-3 py-1 text-xs font-medium tracking-wide transition-colors ${
                  activeTab === tab
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {tab.toUpperCase()}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" className="size-7" disabled>
            <Undo2 className="size-4" />
          </Button>
          <Button variant="ghost" size="icon" className="size-7" disabled>
            <Redo2 className="size-4" />
          </Button>
          <Avatar className="size-7">
            <AvatarFallback className="text-xs">{initials}</AvatarFallback>
          </Avatar>
          <Button size="sm">Share</Button>
          <form action={signOut}>
            <Button variant="ghost" size="sm" type="submit">
              Sign out
            </Button>
          </form>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Left rail */}
        {!railCollapsed && (
          <aside className="flex w-56 shrink-0 flex-col border-r border-border p-3">
            <nav className="flex flex-col gap-1">
              {RAIL_ITEMS.map(({ label, icon: Icon }) => (
                <button
                  key={label}
                  onClick={() => setActiveRailItem(label)}
                  className={`flex items-center gap-2 rounded-md px-2 py-2 text-sm transition-colors ${
                    activeRailItem === label
                      ? "bg-primary/15 text-primary"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  }`}
                >
                  <Icon className="size-4" />
                  {label}
                </button>
              ))}
            </nav>

            <div className="mt-4 rounded-lg border border-border p-3">
              <p className="text-xs font-medium text-muted-foreground">CURRENT PROJECT</p>
              <p className="mt-1 text-sm font-medium">{projectName}</p>
            </div>

            <div className="mt-auto pt-3">
              <button
                onClick={() => setRailCollapsed(true)}
                className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
              >
                <ChevronLeft className="size-4" />
                Collapse
              </button>
            </div>
          </aside>
        )}

        {/* Canvas / center area */}
        <main className="flex flex-1 items-center justify-center bg-muted/20">
          <div className="text-center text-muted-foreground">
            <p className="text-sm font-medium">{activeTab} canvas</p>
            <p className="mt-1 text-xs">Editor, generation, and review tools arrive in later milestones.</p>
          </div>
        </main>
      </div>
    </div>
  );
}
