import { useState } from 'react';
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

  return (
    <div className="w-full overflow-x-auto scrollbar-hide bg-white/80 backdrop-blur-sm border-b border-orange-50">
      {notice && (
        <div className="mx-auto max-w-5xl px-3 pt-3">
          <div className="rounded-2xl border border-orange-200 bg-orange-50 px-4 py-3 text-sm font-medium text-orange-700">
            {notice}
          </div>
        </div>
      )}
      <div className="flex items-center justify-start md:justify-center gap-1 md:gap-3 px-2 py-2 min-w-max">
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
              title={!sport.enabled ? buildUnavailableDataMessage(sport.key) : `${sport.label}数据视图`}
              className={`relative flex items-center gap-1.5 px-3 py-2 rounded-full text-sm font-bold transition-all duration-200 ${
                isActive
                  ? 'bg-gradient-to-r from-orange-500 to-red-500 text-white shadow-md'
                  : sport.enabled
                  ? 'bg-orange-50 text-brand-brown hover:bg-orange-100 hover:text-orange-600'
                  : 'bg-gray-50 text-gray-400 hover:bg-orange-50 hover:text-orange-500'
              }`}
            >
              <span className="text-base">{sport.emoji}</span>
              <span className="hidden sm:inline">{sport.label}</span>
              {!sport.enabled && (
                <span className="rounded-full bg-white/80 px-2 py-0.5 text-[10px] font-extrabold text-orange-500">
                  待接入
                </span>
              )}
              {isActive && (
                <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-white" />
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
