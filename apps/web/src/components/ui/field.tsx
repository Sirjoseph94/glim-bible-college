import {
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { cn } from "../../design/cn";
import { Icon } from "../../design/icons";

interface FieldText {
  label: string;
  /** Helper text under the field, e.g. a word count; an error replaces it. */
  hint?: ReactNode | undefined;
  error?: string | undefined;
  optional?: boolean | undefined;
}

const CONTROL =
  "block w-full rounded-sm border border-line-strong bg-surface-raised px-3 text-body text-ink " +
  "transition-colors duration-120 hover:border-ink-muted " +
  "disabled:bg-surface-sunken disabled:text-ink-muted " +
  "read-only:border-transparent read-only:bg-surface-sunken " +
  "aria-invalid:border-2 aria-invalid:border-danger";

/** Label above, control, then the hint or the error (§9.5); wires up ids and ARIA. */
function FieldShell({
  id,
  label,
  hint,
  error,
  optional,
  children,
}: FieldText & {
  id: string;
  children: (aria: { "aria-describedby"?: string; "aria-invalid"?: true }) => ReactNode;
}) {
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const aria = error
    ? { "aria-describedby": errorId, "aria-invalid": true as const }
    : hint
      ? { "aria-describedby": hintId }
      : {};
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-label text-ink">
        {label}
        {optional ? <span className="font-normal text-ink-muted"> (optional)</span> : null}
      </label>
      {children(aria)}
      {error ? (
        <p id={errorId} className="flex items-start gap-1 text-body-sm text-danger">
          <span className="mt-0.5 shrink-0">
            <Icon name="alert" size={16} />
          </span>
          {error}
        </p>
      ) : hint ? (
        <p id={hintId} className="text-body-sm text-ink-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export type TextFieldProps = FieldText &
  (
    | ({ multiline?: false } & InputHTMLAttributes<HTMLInputElement>)
    | ({ multiline: true } & TextareaHTMLAttributes<HTMLTextAreaElement>)
  );

/**
 * A text input or text area with a visible label (§9.5): 48px tall, 16px text so phones don't
 * zoom. Validate on blur and submit, never per keystroke.
 */
export function TextField(props: TextFieldProps) {
  const generated = useId();
  const { label, hint, error, optional, id = generated, className, ...rest } = props;
  return (
    <FieldShell id={id} label={label} hint={hint} error={error} optional={optional}>
      {(aria) => {
        if (rest.multiline) {
          const { multiline: _, ...textarea } = rest;
          return (
            <textarea
              id={id}
              className={cn(CONTROL, "min-h-30 resize-y py-3", className)}
              {...aria}
              {...textarea}
            />
          );
        }
        const { multiline: _, ...input } = rest;
        return (
          <input id={id} className={cn(CONTROL, "h-control", className)} {...aria} {...input} />
        );
      }}
    </FieldShell>
  );
}

/** A native select styled like a text field (§9.5): no custom listbox on phones. */
export function Select({
  label,
  hint,
  error,
  optional,
  id: givenId,
  className,
  children,
  ...select
}: FieldText & SelectHTMLAttributes<HTMLSelectElement>) {
  const generated = useId();
  const id = givenId ?? generated;
  return (
    <FieldShell id={id} label={label} hint={hint} error={error} optional={optional}>
      {(aria) => (
        <div className="relative">
          <select
            id={id}
            className={cn(CONTROL, "h-control appearance-none pr-10", className)}
            {...aria}
            {...select}
          >
            {children}
          </select>
          <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-ink-muted">
            <span className="rotate-90">
              <Icon name="chevronRight" size={16} />
            </span>
          </span>
        </div>
      )}
    </FieldShell>
  );
}
