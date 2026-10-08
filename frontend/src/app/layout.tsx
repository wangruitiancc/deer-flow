import "@/styles/globals.css";

import { type Metadata } from "next";

import { ThemeProvider } from "@/components/theme-provider";
import { DEFAULT_LOCALE } from "@/core/i18n/locale";

export const metadata: Metadata = {
  title: "Matrix-Law",
  description: "Multi-tenant legal matter, evidence, and agent workspace.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang={DEFAULT_LOCALE}
      suppressContentEditableWarning
      suppressHydrationWarning
    >
      <body>
        <ThemeProvider attribute="class" enableSystem disableTransitionOnChange>
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
