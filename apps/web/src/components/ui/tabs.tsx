import * as RadixTabs from "@radix-ui/react-tabs";
import type { ReactNode } from "react";

export interface TabItem {
  value: string;
  label: string;
  /** Only for things that need action (to-do work, unmatched people). */
  count?: number;
}

/**
 * Section tabs (§9.7): scroll sideways on phones, arrow keys move between them. Controlled, so
 * the page keeps the selected tab in the URL (`?tab=recordings`) and back/refresh keep it.
 */
export function Tabs({
  label,
  tabs,
  value,
  onValueChange,
  children,
}: {
  /** Names the tab list for screen readers, e.g. "Course sections". */
  label: string;
  tabs: TabItem[];
  value: string;
  onValueChange: (value: string) => void;
  /** Renders the selected tab's panel. */
  children: (value: string) => ReactNode;
}) {
  return (
    <RadixTabs.Root value={value} onValueChange={onValueChange}>
      <RadixTabs.List
        aria-label={label}
        className="flex overflow-x-auto border-b border-line px-4 [scrollbar-width:none]"
      >
        {tabs.map((tab) => (
          <RadixTabs.Trigger
            key={tab.value}
            value={tab.value}
            className="-mb-px flex min-h-tap shrink-0 items-center gap-2 border-b-3 border-transparent px-3 text-label whitespace-nowrap text-ink-muted data-[state=active]:border-brand data-[state=active]:text-brand"
          >
            {tab.label}
            {tab.count ? (
              <span className="rounded-pill bg-surface-sunken px-2 text-caption text-ink-muted">
                {tab.count}
              </span>
            ) : null}
          </RadixTabs.Trigger>
        ))}
      </RadixTabs.List>
      <RadixTabs.Content value={value} className="pt-4">
        {children(value)}
      </RadixTabs.Content>
    </RadixTabs.Root>
  );
}
