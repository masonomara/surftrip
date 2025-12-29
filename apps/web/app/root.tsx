import type { LinksFunction } from "react-router";
import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  isRouteErrorResponse,
  useRouteError,
} from "react-router";
import globalStyles from "./styles/global.css?url";
import styles from "./styles/auth.module.css";

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
    href: "https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&display=swap",
  },
  // Global styles
  { rel: "stylesheet", href: globalStyles },
];

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

/**
 * Error boundary for uncaught errors.
 */
export function ErrorBoundary() {
  const error = useRouteError();

  let title = "Something went wrong";
  let message = "An unexpected error occurred. Please try again.";

  if (isRouteErrorResponse(error)) {
    title = `${error.status} ${error.statusText}`;
    message = error.data?.message || "The page could not be loaded.";
  }

  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{title}</title>
        <Links />
      </head>
      <body>
        <main className={styles.page}>
          <div className={styles.container}>
            <h1 className="text-large-title" style={{ textAlign: "center" }}>
              {title}
            </h1>
            <p className={styles.subtitle}>{message}</p>
            <a href="/dashboard" className="btn btn-primary btn-lg btn-lg-fit">
              Return Home
            </a>
          </div>
        </main>
        <Scripts />
      </body>
    </html>
  );
}
