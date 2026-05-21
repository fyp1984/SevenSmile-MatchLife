import { useState } from 'react';
import { Outlet, Link, NavLink } from 'react-router-dom';
import { BarChart3, BookOpen, Database, House, RefreshCw, Trophy } from 'lucide-react';
import logoImg from '../assets/logo.svg';
import { useVisitTracker } from '../hooks/useVisitTracker';
import SportTabBar from './SportTabBar';
import FollowQrModal from './FollowQrModal';

export default function Layout() {
  useVisitTracker();
  const [followModalOpen, setFollowModalOpen] = useState(false);

  const navClassName = ({ isActive }: { isActive: boolean }) =>
    `inline-flex h-10 items-center gap-1.5 whitespace-nowrap rounded-full border px-4 py-2 text-xs font-bold transition-all duration-200 sm:text-sm ${
      isActive
        ? 'border-transparent bg-gradient-to-r from-orange-500 to-red-500 text-white shadow-md shadow-orange-200/80'
        : 'border-orange-100 bg-white/90 text-brand-brown shadow-sm shadow-orange-100/40 hover:-translate-y-0.5 hover:border-orange-200 hover:bg-orange-50 hover:text-orange-500 hover:shadow-md hover:shadow-orange-100/70'
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
          </Link>
          <nav className="flex w-full items-center gap-2 overflow-x-auto pb-1 sm:w-auto sm:gap-3 sm:overflow-visible sm:pb-0">
            <NavLink to="/" end className={navClassName}>
              <House className="h-4 w-4" />
              首页检索
            </NavLink>
            <NavLink to="/stats" className={navClassName}>
              <BarChart3 className="h-4 w-4" />
              赛事看板
            </NavLink>
            <NavLink to="/leaderboard" className={navClassName}>
              <Trophy className="h-4 w-4" />
              排行榜
            </NavLink>
            <NavLink to="/sync" className={navClassName}>
              <RefreshCw className="h-4 w-4" />
              更新状态
            </NavLink>
            <NavLink to="/data-sources" className={navClassName} title="管理数据源与选手档案">
              <Database className="h-4 w-4" />
              数据源
            </NavLink>
            <NavLink to="/guide" className={navClassName} title="查看系统使用文档">
              <BookOpen className="h-4 w-4" />
              使用文档
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
          <button
            type="button"
            onClick={() => setFollowModalOpen(true)}
            className="font-bold text-brand-brown underline decoration-orange-200 underline-offset-4 transition-colors hover:text-orange-500"
          >
            文体中心
          </button>
        </div>
        <p className="mb-2">提供赛事结果、排行与进展查看，方便快速掌握最新比赛信息。</p>
        <p className="max-w-3xl mx-auto text-xs leading-6 text-brand-gray/90">赛程、比分与名次请以官方发布信息为准。</p>
        <p className="mt-3">© {new Date().getFullYear()} 七笑果-赛事生涯</p>
      </footer>

      <FollowQrModal open={followModalOpen} onClose={() => setFollowModalOpen(false)} />
    </div>
  );
}
