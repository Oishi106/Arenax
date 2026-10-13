import { useEffect, useState, useRef } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { getMe, logoutUser } from "../api";

function Navbar() {
  const [user, setUser] = useState(null);
  const [loadingAuth, setLoadingAuth] = useState(true);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const dropdownRef = useRef(null);

  const location = useLocation();
  const navigate = useNavigate();

  const isActive = (path) => location.pathname === path;

  // Check authentication using GET /api/auth/me
  const fetchAuthStatus = async () => {
    try {
      const data = await getMe();
      if (data && data.user) {
        setUser(data.user);
      } else {
        setUser(null);
      }
    } catch (error) {
      setUser(null);
    } finally {
      setLoadingAuth(false);
    }
  };

  useEffect(() => {
    fetchAuthStatus();

    // Listen for custom auth change events across components
    const handleAuthChange = () => {
      fetchAuthStatus();
    };

    window.addEventListener("auth-change", handleAuthChange);

    return () => {
      window.removeEventListener("auth-change", handleAuthChange);
    };
  }, []);

  // Close dropdown & mobile menu on location change
  useEffect(() => {
    setDropdownOpen(false);
    setMobileMenuOpen(false);
  }, [location]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setDropdownOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  const handleLogout = async () => {
    setDropdownOpen(false);
    setMobileMenuOpen(false);
    try {
      await logoutUser();
    } catch (error) {
      console.error("Logout error:", error);
    } finally {
      setUser(null);
      window.dispatchEvent(new Event("auth-change"));
      navigate("/login");
    }
  };

  const navLinks = [
    { label: "Home", path: "/" },
    { label: "About Us", path: "/about" },
    { label: "Tournaments", path: "/tournaments" },
    ...(user && user.role === "organizer" ? [{ label: "My Tournaments", path: "/my-tournaments" }] : []),
    { label: "Teams", path: "/teams" },
    { label: "Free Agents", path: "/free-agents" },
  ];

  return (
    <nav className="sticky top-0 z-50 border-b border-zinc-800/80 bg-zinc-950/85 backdrop-blur-xl transition-all duration-300">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-3.5">
        
        {/* Brand Logo */}
        <Link
          to="/"
          className="group flex items-center gap-2 text-2xl font-black tracking-wider uppercase text-white transition duration-200"
        >
          <span className="font-display">ARENA</span>
          <span className="font-display text-red-500 group-hover:scale-110 transition duration-200 inline-block drop-shadow-[0_0_12px_rgba(239,68,68,0.5)]">
            X
          </span>
          <span className="hidden sm:inline-block rounded-md border border-red-500/30 bg-red-500/10 px-2 py-0.5 text-[10px] font-bold tracking-widest text-red-400 uppercase ml-1">
            ESPORTS
          </span>
        </Link>

        {/* Desktop Navigation Links */}
        <div className="hidden items-center gap-1 md:flex bg-zinc-900/60 rounded-full border border-zinc-800/80 px-4 py-1.5 backdrop-blur-md">
          {navLinks.map((link) => {
            const active = isActive(link.path);
            return (
              <Link
                key={link.path}
                to={link.path}
                className={`relative px-4 py-1.5 text-xs font-semibold tracking-wide transition duration-200 rounded-full ${
                  active
                    ? "text-white bg-red-500/15 border border-red-500/30 shadow-[0_0_12px_rgba(239,68,68,0.2)]"
                    : "text-zinc-400 hover:text-white hover:bg-zinc-800/50"
                }`}
              >
                {link.label}
              </Link>
            );
          })}
        </div>

        {/* Right Action Section (Auth / Profile) */}
        <div className="flex items-center gap-3 relative" ref={dropdownRef}>
          {loadingAuth ? (
            /* Loading Skeleton */
            <div className="h-9 w-24 animate-pulse rounded-xl bg-zinc-900 border border-zinc-800" />
          ) : user ? (
            /* Authenticated User Menu */
            <div className="relative">
              <button
                onClick={() => setDropdownOpen(!dropdownOpen)}
                className="flex items-center gap-2.5 rounded-xl border border-zinc-800 bg-zinc-900/80 px-3.5 py-1.5 text-xs font-semibold text-white transition duration-200 hover:border-zinc-700 hover:bg-zinc-800 shadow-md"
              >
                <div className="flex h-6 w-6 items-center justify-center rounded-full bg-gradient-to-tr from-red-600 to-red-500 text-[11px] font-black text-white shadow-sm">
                  {user.username ? user.username.charAt(0).toUpperCase() : "U"}
                </div>
                <span className="max-w-[100px] truncate">{user.username}</span>
                <svg
                  className={`w-4 h-4 text-zinc-400 transition-transform duration-200 ${
                    dropdownOpen ? "rotate-180 text-red-500" : ""
                  }`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {/* Profile Dropdown Menu */}
              {dropdownOpen && (
                <div className="absolute right-0 mt-2 w-52 rounded-2xl border border-zinc-800 bg-zinc-950/95 p-2 shadow-2xl backdrop-blur-2xl z-50 animate-in fade-in slide-in-from-top-2 duration-200">
                  <div className="px-3.5 py-2.5 border-b border-zinc-800/80 mb-1">
                    <p className="text-xs font-bold text-white truncate">{user.username}</p>
                    <p className="text-[11px] text-zinc-500 truncate">{user.email}</p>
                    <span className="mt-1 inline-block rounded bg-red-500/10 border border-red-500/20 px-2 py-0.5 text-[9px] font-bold text-red-400 uppercase">
                      {user.role || "Player"}
                    </span>
                  </div>

                  {user.role === "organizer" && (
                    <button
                      onClick={() => {
                        setDropdownOpen(false);
                        navigate("/my-tournaments");
                      }}
                      className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-xs font-semibold text-red-400 bg-red-500/10 border border-red-500/20 transition hover:bg-red-500/20 text-left mb-1"
                    >
                      <svg className="w-4 h-4 text-red-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                      </svg>
                      My Tournaments
                    </button>
                  )}

                  <button
                    onClick={() => {
                      setDropdownOpen(false);
                      navigate("/profile");
                    }}
                    className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-xs font-semibold text-zinc-300 transition hover:bg-red-500/10 hover:text-red-400 text-left"
                  >
                    <svg className="w-4 h-4 text-zinc-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                    </svg>
                    Visit Profile
                  </button>

                  <button
                    onClick={handleLogout}
                    className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-xs font-semibold text-red-400 transition hover:bg-red-500/10 hover:text-red-300 text-left"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                    </svg>
                    Logout
                  </button>
                </div>
              )}
            </div>
          ) : (
            /* Unauthenticated Login & Signup */
            <div className="flex items-center gap-2">
              <Link
                to="/login"
                className="rounded-xl border border-zinc-700 bg-zinc-900/60 px-4 py-1.5 text-xs font-semibold text-zinc-200 transition hover:border-zinc-500 hover:bg-zinc-800 hover:text-white"
              >
                Login
              </Link>
              <Link
                to="/signup"
                className="rounded-xl bg-red-500 px-4 py-1.5 text-xs font-bold uppercase tracking-wider text-white transition hover:bg-red-600 shadow-lg shadow-red-500/20"
              >
                Sign Up
              </Link>
            </div>
          )}

          {/* Mobile Navigation Toggle (Hamburger) */}
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="rounded-xl border border-zinc-800 bg-zinc-900 p-2 text-zinc-400 hover:text-white md:hidden"
            aria-label="Toggle Navigation Menu"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              {mobileMenuOpen ? (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16M4 18h16" />
              )}
            </svg>
          </button>
        </div>
      </div>

      {/* Mobile Drawer Overlay */}
      {mobileMenuOpen && (
        <div className="border-t border-zinc-800/80 bg-zinc-950/95 px-6 py-4 md:hidden space-y-2 backdrop-blur-2xl">
          {navLinks.map((link) => {
            const active = isActive(link.path);
            return (
              <Link
                key={link.path}
                to={link.path}
                onClick={() => setMobileMenuOpen(false)}
                className={`block rounded-xl px-4 py-2 text-sm font-semibold transition ${
                  active
                    ? "bg-red-500/15 border border-red-500/30 text-white"
                    : "text-zinc-400 hover:bg-zinc-900 hover:text-white"
                }`}
              >
                {link.label}
              </Link>
            );
          })}
        </div>
      )}
    </nav>
  );
}

export default Navbar;