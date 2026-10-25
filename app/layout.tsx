import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Magnum Opus · The Game of Life",
  description: "Čarovná dedinka pre tvoj osobný rast a spoločné projekty.",
  icons: {
    icon: "/assets/wizard.svg",
    shortcut: "/assets/wizard.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="sk">
      <body className="antialiased">{children}</body>
    </html>
  );
}
