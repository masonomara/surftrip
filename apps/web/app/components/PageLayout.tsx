import { createContext, useContext } from "react";
import { Menu } from "lucide-react";
import styles from "~/styles/page-layout.module.css";

interface PageLayoutContextValue {
  onMenuOpen: () => void;
}

export const PageLayoutContext = createContext<PageLayoutContextValue | null>(
  null
);

interface PageLayoutProps {
  title?: string;
  subtitle?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}

export function PageLayout({
  title,
  subtitle,
  actions,
  children,
}: PageLayoutProps) {
  const context = useContext(PageLayoutContext);

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.headerContent}>
          <h1 className="text-title-1">{title}</h1>
          {subtitle && (
            <p
              className="text-body text-secondary"
              style={{ marginTop: "0.5em", color: "var(--text-secondary)" }}
            >
              {subtitle}
            </p>
          )}
          {actions && (
            <div className={styles.actionsMobileWrapper}>{actions}</div>
          )}
        </div>
        <div className={styles.headerActions}>
          {actions && (
            <div className={styles.actionsDesktopWrapper}>{actions}</div>
          )}
          {context && (
            <button
              type="button"
              className={`${styles.menuButton} btn-sm btn btn-secondary`}
              onClick={context.onMenuOpen}
              aria-label="Open menu"
            >
              <span>Menu</span> <Menu size={16} />
            </button>
          )}
        </div>
      </header>
      {children}
    </div>
  );
}
