import { Outlet, Link, NavLink } from 'react-router-dom';
import { BookOpen } from 'lucide-react';
import logoImg from '../assets/logo.svg';
import { useVisitTracker } from '../hooks/useVisitTracker';
import SportTabBar from './SportTabBar';

export default function Layout() {
  useVisitTracker();

  const navClassName = ({ isActive }: { isActive: boolean }) =>
    `whitespace-nowrap rounded-full px-3 py-1.5 font-medium transition-colors ${
      isActive
        ? 'bg-orange-100 text-orange-700'
        : 'text-brand-brown hover:bg-orange-50 hover:text-orange-500'
    }`;

  return (
    <div className="min-h-screen bg-gradient-to-b from-orange-50 to-white text-brand-brown font-sans relative overflow-hidden">
      <div className="absolute top-10 left-10 w-32 h-32 bg-white/40 rounded-full blur-3xl pointer-events-none"></div>
      <div className="absolute top-20 right-20 w-48 h-48 bg-orange-100/30 rounded-full blur-3xl pointer-events-none"></div>

      <div className="absolute top-40 left-0 w-full h-px border-t border-dashed border-yellow-400/50 pointer-events-none transform -rotate-2"></div>
      <div className="absolute top-60 left-0 w-full h-px border-t border-dashed border-yellow-400/30 pointer-events-none transform rotate-3"></div>

      <header className="relative z-10 sticky top-0 border-b border-orange-100 bg-white/75 shadow-sm backdrop-blur-md">
        <div className="max-w-7xl mx-auto flex min-h-14 flex-col gap-2 px-4 py-3 sm:min-h-16 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
          <Link to="/" className="group flex flex-row items-center gap-2">
            <div className="h-7 w-20 overflow-hidden transition-all sm:h-8 sm:w-24">
              <img src={logoImg} alt="SevenSmile Logo" className="w-full h-full object-contain" />
            </div>
            <span className="text-lg font-extrabold bg-gradient-to-br from-orange-500 to-orange-600 bg-clip-text text-transparent tracking-wide sm:text-xl">
              MatchLife
            </span>
          </Link>
          <nav className="flex w-full items-center gap-2 overflow-x-auto pb-1 text-xs sm:w-auto sm:gap-4 sm:overflow-visible sm:pb-0 sm:text-base">
            <NavLink to="/" end className={navClassName}>
              首页检索
            </NavLink>
            <NavLink to="/stats" className={navClassName}>
              赛事看板
            </NavLink>
            <NavLink to="/leaderboard" className={navClassName}>
              排行榜
            </NavLink>
            <NavLink to="/data-sources" className={navClassName}>
              数据源
            </NavLink>
            <NavLink
              to="/sync"
              className={({ isActive }) =>
                `whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-medium transition-colors sm:text-sm ${
                  isActive
                    ? 'bg-orange-100 text-orange-700'
                    : 'text-brand-brown hover:bg-orange-50 hover:text-orange-500'
                }`
              }
            >
              数据状态
            </NavLink>
            <NavLink to="/guide" className={navClassName} title="查看系统使用文档">
              <span className="inline-flex items-center gap-1.5">
                <BookOpen className="h-4 w-4" />
                使用文档
              </span>
            </NavLink>
          </nav>
        </div>
      </header>

      <SportTabBar />

      <main className="relative z-10 max-w-7xl mx-auto px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
        <Outlet />
      </main>

      <footer className="relative z-10 mt-auto py-8 text-center text-xs text-brand-gray sm:text-sm">
        <div className="flex items-center justify-center gap-2 mb-2">
          <span className="font-bold text-orange-500">七笑果</span>
          <span>·</span>
          <span>文体有料</span>
        </div>
        <p className="mb-2">数据来源：已接入的公开赛事平台与官方公开页面，后续将持续扩展更多赛事与球类数据源。</p>
        <p className="max-w-3xl mx-auto text-xs leading-6 text-brand-gray/90">
          合规说明：本平台仅做赛事数据采集、整理与展示，不对源平台数据的实时性、完整性与准确性作任何承诺；涉及赛果、赛程、比分与排名，请以官方发布信息为准。
        </p>
        <p className="mt-3">© {new Date().getFullYear()} SevenSmile MatchLife. All rights reserved.</p>
      </footer>
    </div>
  );
}
