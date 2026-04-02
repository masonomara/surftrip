import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const BASE_URL = "https://www.surftrip.fun";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export const metadata: Metadata = {
  metadataBase: new URL(BASE_URL),
  title: {
    default: "Surftrip — AI Surf Trip Planner",
    template: "%s | Surftrip",
  },
  description:
    "Plan your perfect surf trip with AI. Get personalized recommendations for surf spots, conditions, and travel logistics.",
  alternates: {
    canonical: "/",
  },
  openGraph: {
    type: "website",
    locale: "en_US",
    url: BASE_URL,
    siteName: "Surftrip",
    title: "Surftrip — AI Surf Trip Planner",
    description:
      "Plan your perfect surf trip with AI. Get personalized recommendations for surf spots, conditions, and travel logistics.",
  },
  twitter: {
    card: "summary_large_image",
    title: "Surftrip — AI Surf Trip Planner",
    description:
      "Plan your perfect surf trip with AI. Get personalized recommendations for surf spots, conditions, and travel logistics.",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
    },
  },
};

// ── Structured Data ────────────────────────────────────────────────────────

const webAppSchema = {
  "@context": "https://schema.org",
  "@type": "WebApplication",
  name: "Surftrip",
  url: BASE_URL,
  description:
    "Plan your perfect surf trip with AI. Get personalized recommendations for surf spots, conditions, and travel logistics.",
  applicationCategory: "TravelApplication",
  operatingSystem: "Web",
  offers: {
    "@type": "Offer",
    price: "0",
    priceCurrency: "USD",
  },
};

// ── Types ──────────────────────────────────────────────────────────────────

type Props = {
  children: React.ReactNode;
};

// ── Component ──────────────────────────────────────────────────────────────

export default function RootLayout({ children }: Props) {
  return (
    <html lang="en" className={`${inter.variable}`}>
      <head>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(webAppSchema) }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
