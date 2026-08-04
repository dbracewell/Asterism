import Providers from "@/app/providers";
import { Toaster } from "@/components/ui/sonner";
import { ThemeProvider } from "@/features/theme/components/theme-context";
import { getTheme } from "@/features/theme/server/theme-loader";
import { cn } from "@/lib/utils";
import type { Metadata } from "next";
import { Geist, Geist_Mono, Inter, Montserrat } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans" });

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const novaSquare = Montserrat({
  subsets: ["latin"],
  variable: "--font-monsterrat",
  weight: ["400", "500", "600", "700"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Asterism",
  description: "Where will your curiousity lead you today?",
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
        geistSans.variable,
        geistMono.variable,
        "font-sans",
        inter.variable,
        novaSquare.variable,
      )}
      suppressHydrationWarning
    >
      <body
        className={cn("flex h-screen w-screen flex-col", mode)}
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
