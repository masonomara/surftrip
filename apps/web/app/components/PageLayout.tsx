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
  title: string;
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
          <h1 className="text-title-2">{title}</h1>
          {subtitle && <p className="text-body text-secondary" style={{ marginTop: "0.5rem" }}>{subtitle}</p>}
        </div>
        <div className={styles.headerActions}>
          {actions}
          {context && (
            <button
              type="button"
              className={styles.menuButton}
              onClick={context.onMenuOpen}
              aria-label="Open menu"
            >
              <Menu size={24} />
            </button>
          )}
        </div>
      </header>
      {children}
    </div>
  );
}
