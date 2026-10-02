import type { Metadata } from "next";
import "maplibre-gl/dist/maplibre-gl.css";
import "./globals.css";
import { ServiceWorkerCleanup } from "@/components/ServiceWorkerCleanup";

export const metadata: Metadata = {
  title: "CivicPulse AI",
  description: "A live view of civic infrastructure issues",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <ServiceWorkerCleanup />
        {children}
      </body>
    </html>
  );
}
