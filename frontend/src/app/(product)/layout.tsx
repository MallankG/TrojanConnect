import { AppShell } from "@/components/layout/AppShell";

// Every page here is gated on the signed-in demo role, which is only known in the browser, so there is no
// static shell to validate for instant navigation (see Next's "authentication with cache components" guide).
export const instant = false;

export default function ProductLayout({ children }: LayoutProps<"/">) {
  return <AppShell>{children}</AppShell>;
}
