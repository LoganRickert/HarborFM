import { useState, useEffect, useRef } from 'react';
import { Outlet, Link, NavLink, useNavigate, useLocation } from 'react-router-dom';
import { Menu, X } from 'lucide-react';
import { useAuthStore } from '../store/auth';
import { logout } from '../api/auth';
import { useQueryClient } from '@tanstack/react-query';
import styles from './Layout.module.css';

export function Layout() {
  const { user, setUser } = useAuthStore();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
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

  // Close menu when route changes
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
              {user?.role === 'admin' && (
                <>
                  <NavLink to="/users" className={({ isActive }) => isActive ? styles.navLinkActive : styles.navLink}>
                    Users
                  </NavLink>
                  <NavLink to="/settings" className={({ isActive }) => isActive ? styles.navLinkActive : styles.navLink}>
                    Settings
                  </NavLink>
                </>
              )}
            </nav>
          </div>
          <div className={styles.nav}>
            <span className={styles.user}>{user?.email}</span>
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
          <span className={styles.mobileUser}>{user?.email}</span>
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
          {user?.role === 'admin' && (
            <>
              <NavLink
                to="/users"
                className={({ isActive }) => isActive ? styles.mobileNavLinkActive : styles.mobileNavLink}
                onClick={() => setMenuOpen(false)}
              >
                Users
              </NavLink>
              <NavLink
                to="/settings"
                className={({ isActive }) => isActive ? styles.mobileNavLinkActive : styles.mobileNavLink}
                onClick={() => setMenuOpen(false)}
              >
                Settings
              </NavLink>
            </>
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
