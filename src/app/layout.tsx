import type { Metadata, Viewport } from "next";
import { Fraunces, Manrope } from "next/font/google";
import Script from "next/script";
import "./globals.css";
import { AppShell } from "@/components/shell/AppShell";

const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-fraunces",
  weight: ["600", "700"],
});

const manrope = Manrope({
  subsets: ["latin"],
  variable: "--font-manrope",
});

export const metadata: Metadata = {
  title: "Del Tata — Empanadas Tucumanas",
  description:
    "Ventas, caja y stock del foodtruck Del Tata. Funciona sin conexión.",
  manifest: "/manifest.json",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "48x48" },
      { url: "/icon-192.png", type: "image/png", sizes: "192x192" },
      { url: "/icon-512.png", type: "image/png", sizes: "512x512" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180" }],
  },
  appleWebApp: {
    capable: true,
    title: "Del Tata",
    statusBarStyle: "default",
  },
};

export const viewport: Viewport = {
  themeColor: "#0b4723",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es-AR" className={`${fraunces.variable} ${manrope.variable}`}>
      <body>
        <AppShell>{children}</AppShell>
        <Script id="sw-register" strategy="afterInteractive">
          {`if ('serviceWorker' in navigator && location.hostname !== 'localhost') {
              navigator.serviceWorker.register('/sw.js').catch(() => {});
            }`}
        </Script>
      </body>
    </html>
  );
}
