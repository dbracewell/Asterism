import Providers from "@/app/providers";
import { Toaster } from "@/components/ui/sonner";
import { ThemeProvider } from "@/features/theme/components/theme-context";
import { getTheme } from "@/features/theme/server/theme-loader";
import { cn } from "@/lib/utils";
import type { Metadata } from "next";
import { JetBrains_Mono, Schibsted_Grotesk } from "next/font/google";
import "./globals.css";

const schibstedGrotesk = Schibsted_Grotesk({
  subsets: ["latin"],
  variable: "--font-ui",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-code",
});

export const metadata: Metadata = {
  title: "Asterism",
  description: "Where will your curiosity lead you today?",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const { themeStyles, currentTheme, fontSize, allThemes, mode } =
    await getTheme();

  return (
    <html
      style={{ ...themeStyles, fontSize }}
      lang="en"
      className={cn(
        "no-scrollbar",
        "h-full",
        "antialiased",
        schibstedGrotesk.variable,
        jetbrainsMono.variable,
        "font-sans",
      )}
      suppressHydrationWarning
    >
      <body
        className={cn("flex h-screen w-full max-w-screen flex-col", mode)}
        suppressHydrationWarning
      >
        <ThemeProvider
          themes={allThemes}
          currentThemeType={mode}
          currentTheme={currentTheme.filename}
          fontSize={fontSize}
        >
          <Providers>
            {children}
            <Toaster richColors closeButton position="top-right" />
          </Providers>
        </ThemeProvider>
      </body>
    </html>
  );
}
