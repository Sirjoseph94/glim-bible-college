import type { InputHTMLAttributes, ReactNode } from "react";
import { Banner } from "./ui/banner";
import { Button } from "./ui/button";
import { TextField } from "./ui/field";

/** Thin wrapper over the design system's TextField (§9.5); new code uses TextField directly. */
export function Field(
  props: InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string | undefined },
) {
  return <TextField {...props} />;
}

/** A form's primary submit button; new code uses Button (§9.1) directly. */
export function SubmitButton({ busy, children }: { busy: boolean; children: ReactNode }) {
  return (
    <Button type="submit" variant="primary" block loading={busy}>
      {children}
    </Button>
  );
}

/** Thin wrapper over Banner (§9.4); new code uses Banner directly. */
export function Alert({ tone, children }: { tone: "error" | "success"; children: ReactNode }) {
  return <Banner tone={tone === "error" ? "danger" : "success"}>{children}</Banner>;
}

export function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mx-auto max-w-sm rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="mb-4 text-xl font-semibold">{title}</h2>
      {children}
    </section>
  );
}

/** A text field's value from a submitted form ("" when absent). */
export function formText(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}
