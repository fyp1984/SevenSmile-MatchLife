import React from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import Layout from './components/Layout';
import Home from './pages/Home';
import Stats from './pages/Stats';
import SyncStatus from './pages/SyncStatus';
import AccessGate, { hasGateAccess } from './pages/AccessGate';

function RequireGate({ children }: { children: React.ReactNode }) {
  const loc = useLocation();
  if (hasGateAccess()) return <>{children}</>;
  const next = encodeURIComponent(`${loc.pathname}${loc.search}`);
  return <Navigate to={`/gate?next=${next}`} replace />;
}

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Home />} />
          <Route path="stats" element={<Stats />} />
          <Route path="gate" element={<AccessGate />} />
          <Route path="sync" element={<RequireGate><SyncStatus /></RequireGate>} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;
