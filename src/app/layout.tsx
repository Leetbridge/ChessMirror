import type { ReactNode } from "react";
import Link from "next/link";
import "./globals.css";

export const metadata = {
  title: "chessmirror",
  description: "Open-source AI chess coach",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <a className="skip" href="#main">
          Skip to content
        </a>
        <header className="site-header">
          <Link href="/" className="brand">
            chessmirror
          </Link>
        </header>
        <main id="main">{children}</main>
      </body>
    </html>
  );
}
