import type { Metadata } from "next";
import { ToastProvider } from "@/components/ui/kit";
import { SignIn } from "@/components/screens/extras";

export const metadata: Metadata = { title: "Sign in" };

export default function Page() {
  return (
    <ToastProvider>
      <SignIn />
    </ToastProvider>
  );
}
