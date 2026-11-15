import type { Metadata } from "next";
import { Only } from "@/components/layout/AppShell";
import { GovernmentHome } from "@/components/screens/government";

export const metadata: Metadata = { title: "Student government" };

export default function Page() {
  return (
    <Only roles={["student", "gov_rep"]}>
      <GovernmentHome />
    </Only>
  );
}
