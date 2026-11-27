import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Nexo · Inbox conversacional",
  description: "Un solo inbox para todas tus conversaciones. Propio, privado y con IA supervisada.",
  icons: {
    icon: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='8' fill='%231877F2'/%3E%3Cpath d='M9 22V10h3.2l7.6 8.2V10H23v12h-3.2L12.2 13.8V22H9z' fill='white'/%3E%3C/svg%3E",
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es" className="dark">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&family=Manrope:wght@400;500;600;700;800&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
