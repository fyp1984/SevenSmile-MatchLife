import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import Home from './pages/Home';
import Stats from './pages/Stats';
import SyncStatus from './pages/SyncStatus';
import AccessGate, { hasGateAccess } from './pages/AccessGate';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Home />} />
          <Route path="stats" element={<Stats />} />
          <Route path="gate" element={<AccessGate />} />
          <Route
            path="sync"
            element={
              hasGateAccess() ? (
                <SyncStatus />
              ) : (
                <AccessGate />
              )
            }
          />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;
