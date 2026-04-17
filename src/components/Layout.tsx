import React from 'react';
import { Outlet, Link } from 'react-router-dom';
import logoImg from '../assets/logo.svg';

function isLocalhost() {
  if (typeof window === 'undefined') return true;
  const host = window.location.hostname;
  return host === 'localhost' || host === '127.0.0.1';
}

export default function Layout() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-orange-50 to-white text-brand-brown font-sans relative overflow-hidden">
      <div className="absolute top-10 left-10 w-32 h-32 bg-white/40 rounded-full blur-3xl pointer-events-none"></div>
      <div className="absolute top-20 right-20 w-48 h-48 bg-orange-100/30 rounded-full blur-3xl pointer-events-none"></div>

      <div className="absolute top-40 left-0 w-full h-px border-t border-dashed border-yellow-400/50 pointer-events-none transform -rotate-2"></div>
      <div className="absolute top-60 left-0 w-full h-px border-t border-dashed border-yellow-400/30 pointer-events-none transform rotate-3"></div>

      <header className="relative z-10 sticky top-0 bg-white/70 backdrop-blur-md border-b border-orange-100 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <Link to="/" className="flex flex-col sm:flex-row sm:items-center items-start gap-1 sm:gap-2 group">
            <div className="w-24 h-8 flex items-center justify-center transition-all overflow-hidden">
              <img src={logoImg} alt="SevenSmile Logo" className="w-full h-full object-contain" />
            </div>
            <span className="text-xl font-extrabold bg-gradient-to-br from-orange-500 to-orange-600 bg-clip-text text-transparent tracking-wide">
              MatchLife
            </span>
          </Link>
          <nav className="flex items-center gap-6">
            <Link to="/" className="text-brand-brown font-medium hover:text-orange-500 transition-colors">
              首页检索
            </Link>
            <Link to="/stats" className="text-brand-brown font-medium hover:text-orange-500 transition-colors">
              赛事看板
            </Link>
            <Link
              to={isLocalhost() ? '/sync' : '/gate?next=/sync'}
              className="text-sm px-3 py-1.5 rounded-full bg-orange-100 text-orange-700 font-medium hover:bg-orange-200 transition-colors"
            >
              数据状态
            </Link>
          </nav>
        </div>
      </header>

      <main className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Outlet />
      </main>

      <footer className="relative z-10 py-8 text-center text-brand-gray text-sm mt-auto">
        <div className="flex items-center justify-center gap-2 mb-2">
          <span className="font-bold text-orange-500">七笑果</span>
          <span>·</span>
          <span>文体有料</span>
        </div>
        <p>© {new Date().getFullYear()} SevenSmile MatchLife. All rights reserved.</p>
      </footer>
    </div>
  );
}
