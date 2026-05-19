import React, { useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

const PASSCODE = import.meta.env.VITE_ACCESS_PASSCODE || '7%K$QJ2pWtgw';
const SESSION_KEY = 'matchlife_gate_ok';

export function shouldBypassGate() {
  if (typeof window === 'undefined') return true;
  const host = window.location.hostname;
  return import.meta.env.DEV || host === 'localhost' || host === '127.0.0.1';
}

export function hasGateAccess() {
  if (typeof window === 'undefined') return true;
  if (shouldBypassGate()) return true;
  return sessionStorage.getItem(SESSION_KEY) === '1';
}

export function setGateAccessOk() {
  sessionStorage.setItem(SESSION_KEY, '1');
}

export default function AccessGate() {
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const nav = useNavigate();
  const loc = useLocation();

  const nextPath = useMemo(() => {
    const params = new URLSearchParams(loc.search);
    return params.get('next') || '/sync';
  }, [loc.search]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const input = code.trim();
    if (shouldBypassGate()) {
      setGateAccessOk();
      nav(nextPath);
      return;
    }
    if (input === PASSCODE) {
      setGateAccessOk();
      nav(nextPath);
      return;
    }
    setError('口令不正确');
  };

  return (
    <div className="max-w-lg mx-auto pt-10">
      <div className="bg-white/80 backdrop-blur-sm rounded-3xl p-8 shadow-sm border border-orange-50">
        <h1 className="text-2xl font-extrabold text-brand-brown mb-2">更新状态访问验证</h1>
        <p className="text-sm text-brand-gray mb-6">当前版本使用口令校验代替七笑果 SSO 登录。</p>

        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="block text-sm font-bold text-brand-brown mb-2">请输入口令</label>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="口令"
              className="w-full px-4 py-3 rounded-2xl border border-orange-100 bg-white focus:outline-none focus:ring-2 focus:ring-orange-200 text-brand-brown"
              type="password"
              autoFocus
            />
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-2xl text-sm font-medium">{error}</div>
          )}

          <button
            type="submit"
            className="w-full bg-gradient-to-r from-orange-500 to-red-500 text-white py-3 rounded-full font-bold shadow-md hover:shadow-lg hover:from-orange-400 hover:to-red-400 transition-all"
          >
            进入更新状态
          </button>
        </form>
      </div>
    </div>
  );
}
