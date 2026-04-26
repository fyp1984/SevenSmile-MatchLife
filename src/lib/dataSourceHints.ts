import type { Sport } from '../components/SportTabBar';

const SPORT_LABELS: Record<Sport, string> = {
  badminton: '羽毛球',
  tennis: '网球',
  basketball: '篮球',
  football: '足球',
  tabletennis: '乒乓球',
};

export const DATA_SOURCE_CONTACT_HINT =
  '当前未接入数据源，可公众号后台联系平台方接入数据后，即可呈现比赛数据。';

export function getSportLabel(sport: Sport) {
  return SPORT_LABELS[sport];
}

export function buildUnavailableDataMessage(sport?: Sport | string) {
  if (!sport) return DATA_SOURCE_CONTACT_HINT;
  const label = SPORT_LABELS[sport as Sport] ?? String(sport);
  return `当前${label}暂未接入数据源，可公众号后台联系平台方接入数据后，即可呈现比赛数据。`;
}
