import { Link } from "react-router";
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
        {/* WORK Section */}
        <nav className={styles.section}>
          <div className={styles.sectionLabel}>Work</div>
          <ul className={styles.navList}>
            <li>
              <Link
                to="/dashboard"
                className={`${styles.navItem} ${currentPath === "/dashboard" ? styles.navItemActive : ""}`}
              >
                <DashboardIcon />
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
                      <MembersIcon />
                      Members
                    </Link>
                  </li>
                  <li>
                    <Link
                      to="/org/clio"
                      className={`${styles.navItem} ${currentPath === "/org/clio" ? styles.navItemActive : ""}`}
                    >
                      <ClioIcon />
                      Clio Connection
                    </Link>
                  </li>
                </>
              )}
              <li>
                <Link
                  to="/org/settings"
                  className={`${styles.navItem} ${currentPath === "/org/settings" ? styles.navItemActive : ""}`}
                >
                  <OrgSettingsIcon />
                  Org Settings
                </Link>
              </li>
              <li>
                <Link
                  to="/account/settings"
                  className={`${styles.navItem} ${currentPath === "/account/settings" ? styles.navItemActive : ""}`}
                >
                  <UserSettingsIcon />
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

function DashboardIcon() {
  return (
    <svg className={styles.navIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  );
}

function MembersIcon() {
  return (
    <svg className={styles.navIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="9" cy="7" r="4" />
      <path d="M3 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      <path d="M21 21v-2a4 4 0 0 0-3-3.87" />
    </svg>
  );
}

function ClioIcon() {
  return (
    <svg className={styles.navIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
    </svg>
  );
}

function OrgSettingsIcon() {
  return (
    <svg className={styles.navIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

function UserSettingsIcon() {
  return (
    <svg className={styles.navIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="12" cy="8" r="5" />
      <path d="M20 21a8 8 0 1 0-16 0" />
    </svg>
  );
}
