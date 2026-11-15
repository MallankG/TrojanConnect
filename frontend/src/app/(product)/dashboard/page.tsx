import type { Metadata } from "next";
import { Only } from "@/components/layout/AppShell";
import { Dashboard } from "@/components/screens/common";

export const metadata: Metadata = { title: "Home" };

export default function Page() {
  return (
    <Only roles={["club_rep", "venue_reviewer", "student", "gov_rep"]}>
      <Dashboard />
    </Only>
  );
}
