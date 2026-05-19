import type { Sport } from '../components/SportTabBar';

const SPORT_LABELS: Record<Sport, string> = {
  badminton: '羽毛球',
  tennis: '网球',
  basketball: '篮球',
  football: '足球',
  tabletennis: '乒乓球',
};

export const DATA_SOURCE_CONTACT_HINT =
  '当前还没有可展示的比赛内容，如需补充赛事可联系运营人员更新。';

export function getSportLabel(sport: Sport) {
  return SPORT_LABELS[sport];
}

export function buildUnavailableDataMessage(sport?: Sport | string) {
  if (!sport) return DATA_SOURCE_CONTACT_HINT;
  const label = SPORT_LABELS[sport as Sport] ?? String(sport);
  return `${label}内容即将开放，可先查看已经上线的项目。`;
}
