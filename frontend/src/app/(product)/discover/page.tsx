import type { Metadata } from "next";
import { Only } from "@/components/layout/AppShell";
import { Discover } from "@/components/screens/student";

export const metadata: Metadata = { title: "Discover" };

export default function Page() {
  return (
    <Only roles={["student"]}>
      <Discover />
    </Only>
  );
}
