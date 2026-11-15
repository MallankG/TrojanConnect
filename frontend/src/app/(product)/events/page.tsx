import type { Metadata } from "next";
import { Only } from "@/components/layout/AppShell";
import { Events } from "@/components/screens/student";

export const metadata: Metadata = { title: "Events" };

export default function Page() {
  return (
    <Only roles={["student"]}>
      <Events />
    </Only>
  );
}
