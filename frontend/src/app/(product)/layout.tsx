import { AppShell } from "@/components/layout/AppShell";

export default function ProductLayout({ children }: LayoutProps<"/">) {
  return <AppShell>{children}</AppShell>;
}
