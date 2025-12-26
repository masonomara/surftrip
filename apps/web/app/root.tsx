import type { LinksFunction } from "react-router";
import { Links, Meta, Outlet, Scripts, ScrollRestoration } from "react-router";
import globalStyles from "./styles/global.css?url";

/**
 * Links to load for every page.
 */
export const links: LinksFunction = () => [
  // Google Fonts
  { rel: "preconnect", href: "https://fonts.googleapis.com" },
  {
    rel: "preconnect",
    href: "https://fonts.gstatic.com",
    crossOrigin: "anonymous",
  },
  {
    rel: "stylesheet",
    href: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap",
  },
  // Global styles
  { rel: "stylesheet", href: globalStyles },
];

/**
 * Styles for the header logo container.
 */
const headerStyles: React.CSSProperties = {
  position: "absolute",
  height: 72,
  display: "flex",
  alignItems: "space-between",
  padding: "18px 24px 34px 24px",
};

/**
 * Root layout component that wraps all pages.
 */
export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body>
        {/* Page content */}
        {children}

        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

/**
 * Root route component.
 */
export default function Root() {
  return <Outlet />;
}
