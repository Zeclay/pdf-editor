import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PDF Editor",
  description: "Client-side PDF editor — annotate, sign, merge, split",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
