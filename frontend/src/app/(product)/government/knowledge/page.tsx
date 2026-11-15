import type { Metadata } from "next";
import { Only } from "@/components/layout/AppShell";
import { Knowledge } from "@/components/screens/government";

export const metadata: Metadata = { title: "Approved sources" };

export default function Page() {
  return (
    <Only roles={["gov_rep"]}>
      <Knowledge />
    </Only>
  );
}
