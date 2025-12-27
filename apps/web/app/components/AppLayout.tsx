import { Link } from "react-router";
import { LayoutDashboard, Users, Plug, FileText, Settings, CircleUser } from "lucide-react";
import type { OrgMembership } from "~/lib/types";
import { signOut } from "~/lib/auth-client";
import styles from "~/styles/app-layout.module.css";

interface AppLayoutProps {
  children: React.ReactNode;
  user: { id: string; email: string; name: string };
  org: OrgMembership | null;
  currentPath: string;
}

function handleLogout() {
  signOut().then(() => {
    window.location.href = "/login";
  });
}

export function AppLayout({ children, user, org, currentPath }: AppLayoutProps) {
  const isAdmin = org?.role === "admin";

  return (
    <div className={styles.layout}>
      <aside className={styles.sidebar}>
        <div className={styles.logo}>
          <img src="/docket-logo.svg" alt="Docket" />
        </div>

        {/* WORK Section */}
        <nav className={styles.section}>
          <div className={styles.sectionLabel}>Work</div>
          <ul className={styles.navList}>
            <li>
              <Link
                to="/dashboard"
                className={`${styles.navItem} ${currentPath === "/dashboard" ? styles.navItemActive : ""}`}
              >
                <LayoutDashboard className={styles.navIcon} />
                Dashboard
              </Link>
            </li>
          </ul>
        </nav>

        {/* MANAGE Section */}
        {org && (
          <nav className={styles.section}>
            <div className={styles.sectionLabel}>Manage</div>
            <ul className={styles.navList}>
              {isAdmin && (
                <>
                  <li>
                    <Link
                      to="/org/members"
                      className={`${styles.navItem} ${currentPath === "/org/members" ? styles.navItemActive : ""}`}
                    >
                      <Users className={styles.navIcon} />
                      Members
                    </Link>
                  </li>
                  <li>
                    <Link
                      to="/org/clio"
                      className={`${styles.navItem} ${currentPath === "/org/clio" ? styles.navItemActive : ""}`}
                    >
                      <Plug className={styles.navIcon} />
                      Clio Connection
                    </Link>
                  </li>
                  <li>
                    <Link
                      to="/org/documents"
                      className={`${styles.navItem} ${currentPath === "/org/documents" ? styles.navItemActive : ""}`}
                    >
                      <FileText className={styles.navIcon} />
                      Documents
                    </Link>
                  </li>
                </>
              )}
              <li>
                <Link
                  to="/org/settings"
                  className={`${styles.navItem} ${currentPath === "/org/settings" ? styles.navItemActive : ""}`}
                >
                  <Settings className={styles.navIcon} />
                  Org Settings
                </Link>
              </li>
              <li>
                <Link
                  to="/account/settings"
                  className={`${styles.navItem} ${currentPath === "/account/settings" ? styles.navItemActive : ""}`}
                >
                  <CircleUser className={styles.navIcon} />
                  User Settings
                </Link>
              </li>
            </ul>
          </nav>
        )}
      </aside>

      <main className={styles.content}>
        <div className={styles.contentInner}>{children}</div>
      </main>
    </div>
  );
}
