/**
 * 分享卡片生成工具
 * 使用 Canvas API 生成高质量分享图片
 */

export interface MatchShareData {
  type: 'match';
  tournamentName: string;
  playerA: string;
  playerB: string;
  score: string;
  date: string;
  eventKey?: string;
  winnerSide: 'A' | 'B' | 'UNKNOWN';
  qrCodeUrl: string;
}

export interface PlayerShareData {
  type: 'player';
  playerName: string;
  totalMatches: number;
  wins: number;
  winRate: number;
  qrCodeUrl: string;
}

export interface StatsShareData {
  type: 'stats';
  tournamentName: string;
  topPlayers: Array<{ name: string; wins: number; winRate: number }>;
  totalMatches: number;
  qrCodeUrl: string;
}

export type ShareCardData = MatchShareData | PlayerShareData | StatsShareData;

const CARD_WIDTH = 1200;
const CARD_HEIGHT = 630;
const DPR = 2;

/**
 * 创建渐变背景
 */
function createGradientBackground(ctx: CanvasRenderingContext2D): void {
  const gradient = ctx.createLinearGradient(0, 0, CARD_WIDTH, CARD_HEIGHT);
  gradient.addColorStop(0, '#FF9800');
  gradient.addColorStop(1, '#E63900');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);
}

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
): void {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

function drawMatchCard(
  ctx: CanvasRenderingContext2D,
  data: MatchShareData
): void {
  createGradientBackground(ctx);

  ctx.save();
  drawRoundedRect(ctx, 60, 60, CARD_WIDTH - 120, CARD_HEIGHT - 120, 40);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
  ctx.fill();
  ctx.restore();

  ctx.fillStyle = '#4A2311';
  ctx.font = 'bold 48px "PingFang SC", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(data.tournamentName, CARD_WIDTH / 2, 160);

  if (data.eventKey) {
    ctx.fillStyle = '#FF9800';
    ctx.font = 'bold 28px "PingFang SC", sans-serif';
    ctx.fillText(data.eventKey, CARD_WIDTH / 2, 210);
  }

  const centerY = CARD_HEIGHT / 2 + 20;
  ctx.fillStyle = data.winnerSide === 'A' ? '#FF9800' : '#8C6B5D';
  ctx.font = 'bold 42px "PingFang SC", sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText(data.playerA, CARD_WIDTH / 2 - 120, centerY);

  ctx.fillStyle = '#4A2311';
  ctx.font = 'bold 64px "PingFang SC", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(data.score, CARD_WIDTH / 2, centerY);

  ctx.fillStyle = data.winnerSide === 'B' ? '#FF9800' : '#8C6B5D';
  ctx.font = 'bold 42px "PingFang SC", sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(data.playerB, CARD_WIDTH / 2 + 120, centerY);

  ctx.fillStyle = '#8C6B5D';
  ctx.font = '28px "PingFang SC", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(data.date, CARD_WIDTH / 2, CARD_HEIGHT - 120);

  ctx.fillStyle = '#4A2311';
  ctx.font = 'bold 24px "PingFang SC", sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('七笑果 MatchLife', 80, CARD_HEIGHT - 60);
}

function drawPlayerCard(
  ctx: CanvasRenderingContext2D,
  data: PlayerShareData
): void {
  createGradientBackground(ctx);

  ctx.save();
  drawRoundedRect(ctx, 60, 60, CARD_WIDTH - 120, CARD_HEIGHT - 120, 40);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
  ctx.fill();
  ctx.restore();

  ctx.fillStyle = '#4A2311';
  ctx.font = 'bold 56px "PingFang SC", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(data.playerName, CARD_WIDTH / 2, 160);

  ctx.fillStyle = '#8C6B5D';
  ctx.font = '32px "PingFang SC", sans-serif';
  ctx.fillText('生涯数据', CARD_WIDTH / 2, 220);

  const statsY = 320;
  const statsGap = 180;

  ctx.fillStyle = '#FF9800';
  ctx.font = 'bold 72px "PingFang SC", sans-serif';
  ctx.fillText(String(data.totalMatches), CARD_WIDTH / 2 - statsGap, statsY);
  ctx.fillStyle = '#8C6B5D';
  ctx.font = '28px "PingFang SC", sans-serif';
  ctx.fillText('总场次', CARD_WIDTH / 2 - statsGap, statsY + 60);

  ctx.fillStyle = '#FF9800';
  ctx.font = 'bold 72px "PingFang SC", sans-serif';
  ctx.fillText(String(data.wins), CARD_WIDTH / 2, statsY);
  ctx.fillStyle = '#8C6B5D';
  ctx.font = '28px "PingFang SC", sans-serif';
  ctx.fillText('胜场', CARD_WIDTH / 2, statsY + 60);

  ctx.fillStyle = '#FF9800';
  ctx.font = 'bold 72px "PingFang SC", sans-serif';
  ctx.fillText(`${data.winRate.toFixed(1)}%`, CARD_WIDTH / 2 + statsGap, statsY);
  ctx.fillStyle = '#8C6B5D';
  ctx.font = '28px "PingFang SC", sans-serif';
  ctx.fillText('胜率', CARD_WIDTH / 2 + statsGap, statsY + 60);

  ctx.fillStyle = '#4A2311';
  ctx.font = 'bold 24px "PingFang SC", sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('七笑果 MatchLife', 80, CARD_HEIGHT - 60);
}

function drawStatsCard(
  ctx: CanvasRenderingContext2D,
  data: StatsShareData
): void {
  createGradientBackground(ctx);

  ctx.save();
  drawRoundedRect(ctx, 60, 60, CARD_WIDTH - 120, CARD_HEIGHT - 120, 40);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
  ctx.fill();
  ctx.restore();

  ctx.fillStyle = '#4A2311';
  ctx.font = 'bold 42px "PingFang SC", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(data.tournamentName, CARD_WIDTH / 2, 140);

  ctx.fillStyle = '#8C6B5D';
  ctx.font = '28px "PingFang SC", sans-serif';
  ctx.fillText(`总场次：${data.totalMatches}`, CARD_WIDTH / 2, 190);

  ctx.fillStyle = '#4A2311';
  ctx.font = 'bold 32px "PingFang SC", sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('排行榜 TOP 3', 100, 260);

  const startY = 320;
  const lineHeight = 70;

  data.topPlayers.slice(0, 3).forEach((player, idx) => {
    const y = startY + idx * lineHeight;
    
    ctx.fillStyle = '#FF9800';
    ctx.font = 'bold 36px "PingFang SC", sans-serif';
    ctx.fillText(`${idx + 1}`, 100, y);

    ctx.fillStyle = '#4A2311';
    ctx.font = 'bold 32px "PingFang SC", sans-serif';
    ctx.fillText(player.name, 180, y);

    ctx.fillStyle = '#8C6B5D';
    ctx.font = '28px "PingFang SC", sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(`${player.wins}胜 | ${player.winRate.toFixed(1)}%`, CARD_WIDTH - 100, y);
    ctx.textAlign = 'left';
  });

  ctx.fillStyle = '#4A2311';
  ctx.font = 'bold 24px "PingFang SC", sans-serif';
  ctx.fillText('七笑果 MatchLife', 80, CARD_HEIGHT - 60);
}

export async function generateShareCard(data: ShareCardData): Promise<string> {
  const canvas = document.createElement('canvas');
  canvas.width = CARD_WIDTH * DPR;
  canvas.height = CARD_HEIGHT * DPR;
  canvas.style.width = `${CARD_WIDTH}px`;
  canvas.style.height = `${CARD_HEIGHT}px`;

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('无法创建 Canvas 上下文');
  }

  ctx.scale(DPR, DPR);

  switch (data.type) {
    case 'match':
      drawMatchCard(ctx, data);
      break;
    case 'player':
      drawPlayerCard(ctx, data);
      break;
    case 'stats':
      drawStatsCard(ctx, data);
      break;
  }

  return canvas.toDataURL('image/png', 1.0);
}

export function downloadImage(dataUrl: string, filename: string): void {
  const link = document.createElement('a');
  link.download = filename;
  link.href = dataUrl;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
