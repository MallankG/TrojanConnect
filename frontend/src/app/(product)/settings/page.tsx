import type { Metadata } from "next";
import { Only } from "@/components/layout/AppShell";
import { Settings } from "@/components/screens/common";

export const metadata: Metadata = { title: "Settings" };

export default function Page() {
  return (
    <Only roles={["club_rep", "venue_reviewer", "student", "gov_rep"]}>
      <Settings />
    </Only>
  );
}
