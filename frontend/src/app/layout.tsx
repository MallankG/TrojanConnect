import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, Libre_Caslon_Text } from "next/font/google";
import { SoundProvider } from "@/lib/sound/SoundProvider";
import "./globals.css";

// Display and UI. The width and weight axes are animated on the landing page.
const bricolage = Bricolage_Grotesque({
  variable: "--font-bricolage",
  subsets: ["latin"],
  axes: ["opsz", "wdth"],
  display: "swap",
});

// Reserved for people: quotes, a reviewer's written reason, a confirmed summary.
const caslon = Libre_Caslon_Text({
  variable: "--font-caslon",
  subsets: ["latin"],
  weight: ["400", "700"],
  style: ["normal", "italic"],
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "TrojanConnect",
    template: "%s · TrojanConnect",
  },
  description:
    "Campus agents that prepare and coordinate club event-space requests at USC, so people only step in to decide. A hackathon project, not affiliated with USC.",
};

export const viewport: Viewport = {
  themeColor: "#990000",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${bricolage.variable} ${caslon.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col bg-paper text-ink">
        <SoundProvider>{children}</SoundProvider>
      </body>
    </html>
  );
}
