"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { Dialog } from "radix-ui";
import { Check, X } from "lucide-react";
import { sound } from "@/lib/sound/engine";
import type { Tone } from "@/lib/booking/state-machine";

// ---- Buttons ---------------------------------------------------------------

type Variant = "primary" | "secondary" | "ghost";

export function buttonClass(variant: Variant = "secondary", size: "md" | "lg" = "md") {
  const base =
    "inline-flex shrink-0 items-center justify-center gap-2 rounded-full font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-45";
  const sizes = size === "lg" ? "h-12 px-6 text-base" : "h-10 px-4 text-sm";
  const variants: Record<Variant, string> = {
    primary: "bg-cardinal text-paper hover:bg-cardinal-20",
    secondary: "border border-line bg-paper text-ink hover:border-gray-70",
    ghost: "text-ink hover:bg-wash",
  };
  return `${base} ${sizes} ${variants[variant]}`;
}

export function Button({
  variant = "secondary",
  size = "md",
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "md" | "lg" }) {
  return <button type="button" {...props} className={`${buttonClass(variant, size)} ${className}`} />;
}

// ---- Status ----------------------------------------------------------------

const MARKER: Record<Tone, string> = {
  neutral: "bg-gray-70",
  progress: "bg-gray-70 animate-pulse",
  review: "bg-mark-blue",
  attention: "bg-mark-orange",
  good: "bg-mark-olive",
  bad: "bg-mark-red",
};

/** Status as words, with a coloured marker. The colour is never the only signal. */
export function StatusPill({
  label,
  tone,
  className = "",
}: {
  label: string;
  tone: Tone;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-line bg-paper px-2.5 py-0.5 text-xs font-medium text-ink ${className}`}
    >
      <span aria-hidden className={`size-1.5 rounded-full ${MARKER[tone]}`} />
      {label}
    </span>
  );
}

/** Marks anything that comes from seeded demo inventory rather than a live system. */
export function SimulatedTag({ label = "Simulated" }: { label?: string }) {
  return (
    <span className="inline-flex items-center whitespace-nowrap rounded-full border border-gold bg-gold-25 px-2 py-0.5 text-[11px] font-medium text-ink">
      {label}
    </span>
  );
}

// ---- Tabs with counts ------------------------------------------------------

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
  label,
}: {
  tabs: { id: T; label: string; count?: number }[];
  value: T;
  onChange: (id: T) => void;
  label: string;
}) {
  return (
    <div role="tablist" aria-label={label} className="flex gap-1 overflow-x-auto border-b border-line">
      {tabs.map((tab) => {
        const active = tab.id === value;
        return (
          <button
            key={tab.id}
            role="tab"
            type="button"
            aria-selected={active}
            onClick={() => {
              onChange(tab.id);
              sound.play("tick", { volume: 0.4 });
            }}
            className={`-mb-px flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2.5 text-[15px] transition-colors ${
              active ? "border-ink font-semibold text-ink" : "border-transparent text-gray-70 hover:text-ink"
            }`}
          >
            {tab.label}
            {tab.count !== undefined && <span className="tabular text-gray-70">{tab.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

// ---- Grouped rows (Luma-style form/summary block) ---------------------------

export function Rows({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <dl className={`divide-y divide-line overflow-hidden rounded-2xl bg-wash text-[15px] ${className}`}>
      {children}
    </dl>
  );
}

export function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[6.5rem_1fr] gap-x-3 px-4 py-2.5">
      <dt className="text-gray-70">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

// ---- Empty, loading, error -------------------------------------------------

export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-dashed border-gray-30 px-6 py-12 text-center">
      <p className="text-lg font-semibold">{title}</p>
      <p className="mx-auto mt-1 max-w-sm text-[15px] text-gray-70">{body}</p>
      {action && <div className="mt-5 flex justify-center">{action}</div>}
    </div>
  );
}

export function ListSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div aria-busy="true" aria-label="Loading" className="space-y-4">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex gap-4">
          <div className="skeleton size-16 shrink-0" />
          <div className="flex-1 space-y-2 py-1">
            <div className="skeleton h-4 w-1/3" />
            <div className="skeleton h-5 w-2/3" />
            <div className="skeleton h-4 w-1/2" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function ErrorNote({ children }: { children: React.ReactNode }) {
  return (
    <p role="alert" className="flex items-start gap-2 rounded-xl border border-line bg-paper px-3.5 py-2.5 text-sm">
      <span aria-hidden className="mt-1.5 size-2 shrink-0 rounded-full bg-mark-red" />
      <span>{children}</span>
    </p>
  );
}

// ---- Page furniture --------------------------------------------------------

export function PageHeader({
  title,
  lead,
  action,
}: {
  title: string;
  lead?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div className="min-w-0">
        <h1 className="text-[clamp(1.75rem,3.4vw,2.5rem)] font-semibold leading-[1.05] tracking-[-0.025em]">
          {title}
        </h1>
        {lead && <p className="mt-2 max-w-xl text-[15px] text-gray-70">{lead}</p>}
      </div>
      {action}
    </div>
  );
}

export function Avatar({ name, className = "size-9 text-xs" }: { name: string; className?: string }) {
  const initials = name
    .split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  return (
    <span
      aria-hidden
      className={`grid shrink-0 place-items-center rounded-full bg-ink font-semibold text-gold ${className}`}
    >
      {initials}
    </span>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-sm font-medium">{label}</span>
      {hint && <span className="ml-2 text-sm text-gray-70">{hint}</span>}
      <div className="mt-1.5">{children}</div>
    </label>
  );
}

export const inputClass =
  "w-full rounded-xl border border-line bg-paper px-3.5 py-2.5 text-[15px] placeholder:text-gray-70 focus:border-ink focus:outline-none";

// ---- Sheet: side panel on desktop, bottom sheet on phones -------------------

export function Sheet({
  open,
  onOpenChange,
  title,
  description,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-ink/40" />
        <Dialog.Content className="sheet-in fixed inset-x-0 bottom-0 z-50 flex max-h-[88dvh] flex-col rounded-t-3xl bg-paper shadow-2xl focus:outline-none md:inset-y-3 md:left-auto md:right-3 md:max-h-none md:w-[440px] md:rounded-3xl">
          <div className="flex items-start justify-between gap-4 px-5 pb-3 pt-5">
            <div className="min-w-0">
              <Dialog.Title className="text-xl font-semibold leading-tight">{title}</Dialog.Title>
              {description && (
                <Dialog.Description className="mt-1 text-sm text-gray-70">{description}</Dialog.Description>
              )}
            </div>
            <Dialog.Close className="grid size-9 shrink-0 place-items-center rounded-full hover:bg-wash" aria-label="Close">
              <X className="size-5" />
            </Dialog.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-6">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

// ---- Toast -----------------------------------------------------------------

type ToastState = { id: number; text: string; tone: "good" | "bad" } | null;
const ToastContext = createContext<(text: string, tone?: "good" | "bad") => void>(() => {});

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toast, setToast] = useState<ToastState>(null);
  const timer = useRef<number | undefined>(undefined);

  const show = useCallback((text: string, tone: "good" | "bad" = "good") => {
    window.clearTimeout(timer.current);
    setToast({ id: Date.now(), text, tone });
    timer.current = window.setTimeout(() => setToast(null), 3600);
  }, []);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 top-4 z-[60] flex justify-center px-4">
        {toast && (
          <p
            key={toast.id}
            className="msg-in flex items-center gap-2 rounded-full bg-ink px-4 py-2.5 text-sm font-medium text-paper shadow-lg"
          >
            {toast.tone === "good" ? (
              <Check aria-hidden className="size-4 text-gold" strokeWidth={3} />
            ) : (
              <span aria-hidden className="size-2 rounded-full bg-mark-red" />
            )}
            {toast.text}
          </p>
        )}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
