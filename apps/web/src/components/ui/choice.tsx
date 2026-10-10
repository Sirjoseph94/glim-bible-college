import * as RadixSwitch from "@radix-ui/react-switch";
import { useId, type InputHTMLAttributes, type ReactNode } from "react";
import { cn } from "../../design/cn";

type ChoiceProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & { label: ReactNode };

/** An 18px native control in a row at least 44px tall; the whole row is the target (§9.5). */
function Choice({
  type,
  label,
  className,
  ...input
}: ChoiceProps & { type: "checkbox" | "radio" }) {
  return (
    <label className={cn("flex min-h-tap cursor-pointer items-center gap-3 text-body", className)}>
      <input type={type} className="size-4.5 shrink-0 accent-brand" {...input} />
      <span className="min-w-0">{label}</span>
    </label>
  );
}

export function Checkbox(props: ChoiceProps) {
  return <Choice type="checkbox" {...props} />;
}

export function Radio(props: ChoiceProps) {
  return <Choice type="radio" {...props} />;
}

/**
 * On/off for settings that take effect at once, like Data saver or the theme (§9.5): a 44 × 24
 * track, brand when on, label on the left.
 */
export function Switch({
  label,
  hint,
  checked,
  onCheckedChange,
  disabled,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  return (
    <div className="flex min-h-tap items-center justify-between gap-4">
      <div className="min-w-0">
        <label htmlFor={id} className="block text-label text-ink">
          {label}
        </label>
        {hint ? (
          <p id={hintId} className="text-body-sm text-ink-muted">
            {hint}
          </p>
        ) : null}
      </div>
      <RadixSwitch.Root
        id={id}
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
        aria-describedby={hint ? hintId : undefined}
        className={cn(
          "flex h-5 w-tap shrink-0 items-center rounded-pill p-0.5 transition-colors duration-120",
          "bg-line-strong data-[state=checked]:bg-brand disabled:opacity-55",
        )}
      >
        <RadixSwitch.Thumb className="block size-4.5 rounded-pill bg-surface-raised data-[state=checked]:ml-auto" />
      </RadixSwitch.Root>
    </div>
  );
}
