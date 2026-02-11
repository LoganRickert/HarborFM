import { useState, useEffect, useRef } from 'react';
import { Outlet, Link, NavLink, useNavigate, useLocation } from 'react-router-dom';
import { Menu, X, User, ChevronDown } from 'lucide-react';
import { useAuthStore } from '../store/auth';
import { logout } from '../api/auth';
import { useQueryClient } from '@tanstack/react-query';
import styles from './Layout.module.css';

const ADMIN_PATHS = ['/users', '/settings'] as const;
function isAdminPath(pathname: string): boolean {
  return ADMIN_PATHS.some((p) => pathname === p || pathname.startsWith(p + '/'));
}

export function Layout() {
  const { user, setUser } = useAuthStore();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [adminSubmenuOpen, setAdminSubmenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  async function handleLogout() {
    await logout();
    setUser(null);
    queryClient.clear();
    navigate('/login');
    setMenuOpen(false);
  }

  // Close menu when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    }

    if (menuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [menuOpen]);

  // Close mobile menu when route changes
  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  return (
    <div className={styles.layout}>
      <header className={styles.header}>
        <div className={styles.headerContainer}>
          <div className={styles.headerLeft}>
            <Link to="/" className={styles.logo} onClick={() => setMenuOpen(false)}>
              <img src="/favicon.svg" alt="" className={styles.logoIcon} />
              HarborFM
            </Link>
            <nav className={styles.navBar}>
              <NavLink to="/" end className={({ isActive }) => isActive ? styles.navLinkActive : styles.navLink}>
                Home
              </NavLink>
              <NavLink to="/library" className={({ isActive }) => isActive ? styles.navLinkActive : styles.navLink}>
                Library
              </NavLink>
              <NavLink to="/messages" className={({ isActive }) => isActive ? styles.navLinkActive : styles.navLink}>
                Messages
              </NavLink>
              {user?.role === 'admin' && (
                <div className={styles.adminDropdownWrap}>
                  <span
                    className={isAdminPath(location.pathname) ? styles.navLinkActive : styles.navLink}
                    aria-haspopup="true"
                    aria-label="Admin menu"
                  >
                    Admin
                    <ChevronDown size={16} strokeWidth={2} className={styles.adminChevron} aria-hidden />
                  </span>
                  <div className={styles.adminDropdown} role="menu">
                    <NavLink to="/users" className={({ isActive }) => isActive ? styles.adminDropdownLinkActive : styles.adminDropdownLink} role="menuitem">
                      Users
                    </NavLink>
                    <NavLink to="/settings" className={({ isActive }) => isActive ? styles.adminDropdownLinkActive : styles.adminDropdownLink} role="menuitem">
                      Settings
                    </NavLink>
                  </div>
                </div>
              )}
            </nav>
          </div>
          <div className={styles.nav}>
            <NavLink to="/profile" className={({ isActive }) => isActive ? styles.profileLinkActive : styles.profileLink} title="Profile">
              <User size={18} strokeWidth={2} aria-hidden />
              Profile
            </NavLink>
            <button type="button" className={styles.logout} onClick={handleLogout} aria-label="Log out">
              Log out
            </button>
            <button
              type="button"
              className={styles.menuToggle}
              onClick={() => setMenuOpen(!menuOpen)}
              aria-label="Toggle menu"
            >
              {menuOpen ? <X size={24} strokeWidth={2} /> : <Menu size={24} strokeWidth={2} />}
            </button>
          </div>
        </div>
      </header>

      {/* Mobile menu overlay */}
      {menuOpen && <div className={styles.menuOverlay} onClick={() => setMenuOpen(false)} />}

      {/* Mobile slide-out menu — inert when closed so it's skipped in tab order */}
      <div
        ref={menuRef}
        className={`${styles.mobileMenu} ${menuOpen ? styles.mobileMenuOpen : ''}`}
        inert={!menuOpen ? true : undefined}
      >
        <div className={styles.mobileMenuHeader}>
          <NavLink
            to="/profile"
            className={({ isActive }) => `${isActive ? styles.mobileNavLinkActive : styles.mobileNavLink} ${styles.mobileMenuProfile}`}
            onClick={() => setMenuOpen(false)}
          >
            <User size={20} strokeWidth={2} aria-hidden />
            Profile
          </NavLink>
          <button
            type="button"
            className={styles.mobileMenuClose}
            onClick={() => setMenuOpen(false)}
            aria-label="Close menu"
          >
            <X size={24} strokeWidth={2} />
          </button>
        </div>
        <nav className={styles.mobileNav}>
          <NavLink
            to="/"
            end
            className={({ isActive }) => isActive ? styles.mobileNavLinkActive : styles.mobileNavLink}
            onClick={() => setMenuOpen(false)}
          >
            Home
          </NavLink>
          <NavLink
            to="/library"
            className={({ isActive }) => isActive ? styles.mobileNavLinkActive : styles.mobileNavLink}
            onClick={() => setMenuOpen(false)}
          >
            Library
          </NavLink>
          <NavLink
            to="/messages"
            className={({ isActive }) => isActive ? styles.mobileNavLinkActive : styles.mobileNavLink}
            onClick={() => setMenuOpen(false)}
          >
            Messages
          </NavLink>
          {user?.role === 'admin' && (
            <div className={styles.mobileAdminSection}>
              <button
                type="button"
                className={styles.mobileAdminTrigger}
                onClick={() => setAdminSubmenuOpen((o) => !o)}
                aria-expanded={adminSubmenuOpen}
              >
                Admin
                <ChevronDown size={18} strokeWidth={2} className={adminSubmenuOpen ? styles.adminChevronOpen : ''} aria-hidden />
              </button>
              {adminSubmenuOpen && (
                <div className={styles.mobileAdminSubmenu}>
                  <NavLink to="/users" className={({ isActive }) => isActive ? styles.mobileNavLinkActive : styles.mobileNavLink} onClick={() => setMenuOpen(false)}>
                    Users
                  </NavLink>
                  <NavLink to="/settings" className={({ isActive }) => isActive ? styles.mobileNavLinkActive : styles.mobileNavLink} onClick={() => setMenuOpen(false)}>
                    Settings
                  </NavLink>
                </div>
              )}
            </div>
          )}
          <button type="button" className={styles.mobileLogout} onClick={handleLogout} aria-label="Log out">
            Log out
          </button>
        </nav>
      </div>

      <main className={styles.main}>
        <Outlet />
      </main>
    </div>
  );
}
