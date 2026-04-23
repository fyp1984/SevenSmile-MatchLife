import { useSearchParams } from 'react-router-dom';

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

  return (
    <div className="w-full overflow-x-auto scrollbar-hide bg-white/80 backdrop-blur-sm border-b border-orange-50">
      <div className="flex items-center justify-start md:justify-center gap-1 md:gap-3 px-2 py-2 min-w-max">
        {SPORTS.map((sport) => {
          const isActive = activeSport === sport.key;
          return (
            <button
              key={sport.key}
              type="button"
              onClick={() => setActiveSport(sport.key)}
              disabled={!sport.enabled}
              className={`relative flex items-center gap-1.5 px-3 py-2 rounded-full text-sm font-bold transition-all duration-200 ${
                isActive
                  ? 'bg-gradient-to-r from-orange-500 to-red-500 text-white shadow-md'
                  : sport.enabled
                  ? 'bg-orange-50 text-brand-brown hover:bg-orange-100 hover:text-orange-600'
                  : 'bg-gray-50 text-gray-300 cursor-not-allowed'
              }`}
            >
              <span className="text-base">{sport.emoji}</span>
              <span className="hidden sm:inline">{sport.label}</span>
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