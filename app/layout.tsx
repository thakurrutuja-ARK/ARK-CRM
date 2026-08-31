import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ARK Resource Space",
  description: "Internal client & document management for ARK People Solutions",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col bg-slate-50">{children}</body>
    </html>
  );
}
