import type { Metadata } from "next";
import { ToastProvider } from "@/components/ui/kit";
import { RolePicker } from "@/components/screens/common";

export const metadata: Metadata = { title: "Choose a role" };

export default function Demo() {
  return (
    <ToastProvider>
      <RolePicker />
    </ToastProvider>
  );
}
