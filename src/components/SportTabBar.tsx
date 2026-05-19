import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { buildUnavailableDataMessage } from '../lib/dataSourceHints';

type Sport = 'badminton' | 'tennis' | 'basketball' | 'football' | 'tabletennis';

interface SportTab {
  key: Sport;
  label: string;
  emoji: string;
  enabled: boolean;
}

const SPORTS: SportTab[] = [
  { key: 'badminton', label: '羽毛球', emoji: '🏸', enabled: true },
  { key: 'tennis', label: '网球', emoji: '🎾', enabled: true },
  { key: 'basketball', label: '篮球', emoji: '🏀', enabled: false },
  { key: 'football', label: '足球', emoji: '⚽', enabled: false },
  { key: 'tabletennis', label: '乒乓球', emoji: '🏓', enabled: false },
];

function useSportTab() {
  const [searchParams, setSearchParams] = useSearchParams();
  const sportParam = searchParams.get('sport') as Sport | null;
  const activeSport = SPORTS.find((s) => s.key === sportParam && s.enabled)?.key ?? 'badminton';

  const setActiveSport = (sport: Sport) => {
    if (!SPORTS.find((s) => s.key === sport && s.enabled)) return;
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('sport', sport);
      return next;
    });
  };

  return { activeSport, setActiveSport };
}

export default function SportTabBar() {
  const { activeSport, setActiveSport } = useSportTab();
  const [notice, setNotice] = useState<string>('');
  const baseTabClass =
    'relative inline-flex h-10 items-center gap-1.5 rounded-full border px-4 py-2 text-xs font-bold transition-all duration-200 sm:text-sm';

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(''), 3000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  return (
    <div className="w-full overflow-x-auto scrollbar-hide bg-white/80 backdrop-blur-sm border-b border-orange-50">
      {notice && (
        <div className="mx-auto max-w-5xl px-3 pt-3">
          <div className="rounded-2xl border border-orange-200 bg-orange-50 px-4 py-3 text-sm font-medium text-orange-700">
            {notice}
          </div>
        </div>
      )}
      <div className="flex min-w-max items-center justify-start gap-2 px-2 py-2 md:justify-center md:gap-3">
        {SPORTS.map((sport) => {
          const isActive = activeSport === sport.key;
          return (
            <button
              key={sport.key}
              type="button"
              onClick={() => {
                if (!sport.enabled) {
                  setNotice(buildUnavailableDataMessage(sport.key));
                  return;
                }
                setNotice('');
                setActiveSport(sport.key);
              }}
              aria-disabled={!sport.enabled}
              title={!sport.enabled ? buildUnavailableDataMessage(sport.key) : `${sport.label}内容`}
              className={`${baseTabClass} ${
                isActive
                  ? 'border-transparent bg-gradient-to-r from-orange-500 to-red-500 text-white shadow-md shadow-orange-200/80'
                  : sport.enabled
                  ? 'border-orange-100 bg-white/90 text-brand-brown shadow-sm shadow-orange-100/40 hover:-translate-y-0.5 hover:border-orange-200 hover:bg-orange-50 hover:text-orange-500 hover:shadow-md hover:shadow-orange-100/70'
                  : 'border-gray-100 bg-gray-50 text-gray-400 hover:border-orange-100 hover:bg-orange-50 hover:text-orange-500'
              }`}
            >
              {isActive && (
                <span className="pointer-events-none absolute inset-x-4 top-1 h-4 rounded-full bg-white/20 blur-md" />
              )}
              <span className="relative text-base">{sport.emoji}</span>
              <span className="relative hidden sm:inline">{sport.label}</span>
              {isActive && (
                <span className="absolute -bottom-1 left-1/2 h-1.5 w-10 -translate-x-1/2 rounded-full bg-white/75 shadow-sm" />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export { useSportTab, SPORTS };
export type { Sport };
