import * as RadixDialog from "@radix-ui/react-dialog";
import { useId, useRef, useState, type ReactNode } from "react";
import { Button } from "./button";
import { TextField } from "./field";

/** Why a confirmation reason isn't acceptable yet, or null when it is. */
export function reasonProblem(reason: string, minLength: number): string | null {
  const length = reason.trim().length;
  if (length === 0) return "Give a reason.";
  if (length < minLength) return `Write at least ${String(minLength)} characters.`;
  return null;
}

const SWIPE_TO_CLOSE = 80;

/**
 * Radix returns focus only to its own Dialog.Trigger. Our overlays are opened by ordinary
 * buttons, so remember whatever had focus when one opened and give focus back to it on close.
 */
function useReturnFocus() {
  const opener = useRef<HTMLElement | null>(null);
  return {
    onOpenAutoFocus: () => {
      opener.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
    },
    onCloseAutoFocus: (event: Event) => {
      event.preventDefault();
      opener.current?.focus();
    },
  };
}

const SHEET = [
  // eslint-disable-next-line glim/design-tokens -- design-exception: geometry, sheets stop at 90% of the screen (§9.11)
  "glim-sheet fixed inset-x-0 bottom-0 z-sheet flex max-h-[90dvh] flex-col rounded-t-lg",
  "bg-surface-raised px-4 pt-2 pb-6 text-ink shadow-sheet",
  "md:inset-x-auto md:bottom-auto md:top-1/2 md:left-1/2 md:w-full md:max-w-110",
  "md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-lg md:p-5 md:shadow-pop",
].join(" ");

/**
 * A secondary flow over the page (§9.11): a bottom sheet on phones, a centred dialog from 640px.
 * Focus is trapped while open and returns to the opener; Escape, the scrim and a swipe down on
 * the handle close it. Put the primary action, full width, in `footer`.
 */
export function Sheet({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
}) {
  const swipeFrom = useRef<number | null>(null);
  const returnFocus = useReturnFocus();
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="glim-scrim fixed inset-0 z-overlay" />
        <RadixDialog.Content className={SHEET} {...returnFocus}>
          <div
            aria-hidden="true"
            className="mx-auto mb-3 h-1 w-10 shrink-0 touch-none rounded-pill bg-line-strong md:hidden"
            onPointerDown={(event) => {
              swipeFrom.current = event.clientY;
            }}
            onPointerUp={(event) => {
              if (swipeFrom.current !== null && event.clientY - swipeFrom.current >= SWIPE_TO_CLOSE)
                onOpenChange(false);
              swipeFrom.current = null;
            }}
          />
          <RadixDialog.Title className="text-title">{title}</RadixDialog.Title>
          {description ? (
            <RadixDialog.Description className="mt-1 text-body-sm text-ink-muted">
              {description}
            </RadixDialog.Description>
          ) : (
            <RadixDialog.Description className="sr-only">{title}</RadixDialog.Description>
          )}
          <div className="mt-4 min-h-0 flex-1 overflow-y-auto">{children}</div>
          {footer ? <div className="mt-5 space-y-2">{footer}</div> : null}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

/**
 * Confirms a high-consequence action (§9.11, §10.5): says what will happen and to whom, with a
 * specific verb ("Finalize results", never "OK"). When the build spec requires a reason (overrides,
 * revoke, reopen), `reason` adds a required field checked before `onConfirm` runs.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  children,
  confirmLabel,
  tone = "primary",
  reason,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** The consequence: "Students will see their course result immediately." */
  children: ReactNode;
  confirmLabel: string;
  tone?: "primary" | "danger";
  reason?: { label: string; minLength?: number };
  onConfirm: (reason: string) => Promise<void> | void;
}) {
  const reasonId = useId();
  const returnFocus = useReturnFocus();
  const [text, setText] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const minLength = reason?.minLength ?? 5;

  async function confirm() {
    if (reason) {
      const found = reasonProblem(text, minLength);
      setProblem(found);
      if (found) {
        document.getElementById(reasonId)?.focus();
        return;
      }
    }
    setBusy(true);
    try {
      await onConfirm(text.trim());
    } finally {
      setBusy(false);
    }
  }

  return (
    <RadixDialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setText("");
          setProblem(null);
        }
        onOpenChange(next);
      }}
    >
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="glim-scrim fixed inset-0 z-overlay" />
        <RadixDialog.Content
          {...returnFocus}
          className={
            "glim-dialog fixed inset-x-4 top-1/2 z-sheet -translate-y-1/2 rounded-lg bg-surface-raised p-5 " +
            "text-ink shadow-pop md:inset-x-auto md:left-1/2 md:w-full md:max-w-110 md:-translate-x-1/2"
          }
        >
          <RadixDialog.Title className="text-heading">{title}</RadixDialog.Title>
          <RadixDialog.Description className="mt-2 text-body text-ink">
            {children}
          </RadixDialog.Description>
          {reason ? (
            <div className="mt-4">
              <TextField
                id={reasonId}
                label={reason.label}
                multiline
                rows={3}
                value={text}
                error={problem ?? undefined}
                onChange={(event) => {
                  setText(event.target.value);
                }}
                onBlur={() => {
                  if (text !== "") setProblem(reasonProblem(text, minLength));
                }}
              />
            </div>
          ) : null}
          <div className="mt-5 flex flex-col-reverse gap-2 md:flex-row md:justify-end">
            <RadixDialog.Close asChild>
              <Button variant="quiet">Cancel</Button>
            </RadixDialog.Close>
            <Button
              variant={tone}
              loading={busy}
              onClick={() => {
                void confirm();
              }}
            >
              {confirmLabel}
            </Button>
          </div>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
