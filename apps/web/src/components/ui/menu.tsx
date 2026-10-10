import * as RadixMenu from "@radix-ui/react-dropdown-menu";
import type { ReactElement } from "react";
import { cn } from "../../design/cn";
import { Icon, type IconName } from "../../design/icons";

export interface MenuItem {
  label: string;
  onSelect: () => void;
  icon?: IconName;
  /** A destructive item; it should open a ConfirmDialog rather than act at once. */
  danger?: boolean;
}

/**
 * A short list of actions behind a trigger (the profile menu, a row's "more"), §3.1. Arrow keys
 * move, Escape closes, focus returns to the trigger. The trigger must be a single focusable
 * element, usually an IconButton.
 */
export function Menu({ trigger, items }: { trigger: ReactElement; items: MenuItem[] }) {
  return (
    <RadixMenu.Root>
      <RadixMenu.Trigger asChild>{trigger}</RadixMenu.Trigger>
      <RadixMenu.Portal>
        <RadixMenu.Content
          align="end"
          sideOffset={4}
          className="z-sheet min-w-48 rounded-md border border-line bg-surface-raised p-1 text-ink shadow-pop"
        >
          {items.map((item) => (
            <RadixMenu.Item
              key={item.label}
              onSelect={item.onSelect}
              className={cn(
                "flex min-h-tap cursor-pointer items-center gap-3 rounded-sm px-3 text-body outline-none",
                "data-[highlighted]:bg-surface-sunken",
                item.danger && "text-danger",
              )}
            >
              {item.icon ? <Icon name={item.icon} /> : null}
              {item.label}
            </RadixMenu.Item>
          ))}
        </RadixMenu.Content>
      </RadixMenu.Portal>
    </RadixMenu.Root>
  );
}
