import React, { lazy, Suspense } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import WechatProtectedLayout from './components/WechatProtectedLayout';
import Home from './pages/Home';
import AccessGate, { hasGateAccess } from './pages/AccessGate';

const Stats = lazy(() => import('./pages/Stats'));
const Leaderboard = lazy(() => import('./pages/Leaderboard'));
const SyncStatus = lazy(() => import('./pages/SyncStatus'));
const DataSources = lazy(() => import('./pages/DataSources'));
const WechatGate = lazy(() => import('./pages/WechatGate'));
const WechatComplete = lazy(() => import('./pages/WechatComplete'));
const Follow = lazy(() => import('./pages/Follow'));
const PlayerCareer = lazy(() => import('./pages/PlayerCareer').then(m => ({ default: m.PlayerCareer })));
const MatchDetail = lazy(() => import('./pages/MatchDetail').then(m => ({ default: m.MatchDetail })));
const MatchTagging = lazy(() => import('./pages/MatchTagging'));

function GateProtectedRoute({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  if (hasGateAccess()) return <>{children}</>;
  return <Navigate to={`/gate?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
}

function LoadingFallback() {
  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="w-12 h-12 border-4 border-brand-200 border-t-brand-600 rounded-full animate-spin"></div>
    </div>
  );
}

function App() {
  return (
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <Suspense fallback={<LoadingFallback />}>
        <Routes>
          <Route path="/" element={<WechatProtectedLayout />}>
            <Route index element={<Home />} />
            <Route path="stats" element={<Stats />} />
            <Route path="leaderboard" element={<Leaderboard />} />
            <Route path="player/:name" element={<PlayerCareer />} />
            <Route path="matches/:id" element={<MatchDetail />} />
            <Route path="matches/:matchId/tagging" element={<MatchTagging />} />
            <Route path="sources" element={<GateProtectedRoute><DataSources /></GateProtectedRoute>} />
            <Route path="gate" element={<AccessGate />} />
            <Route path="gate/wechat" element={<WechatGate />} />
            <Route path="wechat/complete" element={<WechatComplete />} />
            <Route path="follow" element={<Follow />} />
            <Route path="sync" element={<GateProtectedRoute><SyncStatus /></GateProtectedRoute>} />
          </Route>
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}

export default App;
