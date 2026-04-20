import React from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import WechatProtectedLayout from './components/WechatProtectedLayout';
import Home from './pages/Home';
import Stats from './pages/Stats';
import SyncStatus from './pages/SyncStatus';
import DataSources from './pages/DataSources';
import AccessGate, { hasGateAccess } from './pages/AccessGate';
import WechatGate from './pages/WechatGate';
import WechatComplete from './pages/WechatComplete';
import Follow from './pages/Follow';

function GateProtectedRoute({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  if (hasGateAccess()) return <>{children}</>;
  return <Navigate to={`/gate?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
}

function App() {
  return (
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <Routes>
        <Route path="/" element={<WechatProtectedLayout />}>
          <Route index element={<Home />} />
          <Route path="stats" element={<Stats />} />
          <Route path="sources" element={<GateProtectedRoute><DataSources /></GateProtectedRoute>} />
          <Route path="gate" element={<AccessGate />} />
          <Route path="gate/wechat" element={<WechatGate />} />
          <Route path="wechat/complete" element={<WechatComplete />} />
          <Route path="follow" element={<Follow />} />
          <Route path="sync" element={<GateProtectedRoute><SyncStatus /></GateProtectedRoute>} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;
