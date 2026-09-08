import type { Metadata, Viewport } from "next";
import "./globals.css";
import Nav from "@/components/Nav";
import { env } from "@/lib/env";

const title = "PixelEmpire — Own a piece of the internet";
const description =
  "A shared map of one million pixels. Claim a plot, build your empire, and hold your corner of the internet in public.";

export const metadata: Metadata = {
  metadataBase: new URL(env.appUrl),
  title: { default: title, template: "%s · PixelEmpire" },
  description,
  applicationName: "PixelEmpire",
  openGraph: {
    type: "website",
    siteName: "PixelEmpire",
    title,
    description,
    url: env.appUrl,
  },
  twitter: { card: "summary_large_image", title, description },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: "#07080f",
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
  // The map handles its own zoom; letting the browser zoom too fights the canvas.
  maximumScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh bg-deepspace">
        <Nav />
        {children}
      </body>
    </html>
  );
}
