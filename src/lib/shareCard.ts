/**
 * 分享卡片生成工具
 * 使用 Canvas API 生成高质量分享图片
 */

export type ShareCardTemplate = 'default' | 'sports' | 'minimal' | 'celebration';

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
  template?: ShareCardTemplate;
}

export interface PlayerShareData {
  type: 'player';
  playerName: string;
  totalMatches: number;
  wins: number;
  winRate: number;
  qrCodeUrl: string;
  template?: ShareCardTemplate;
}

export interface StatsShareData {
  type: 'stats';
  tournamentName: string;
  topPlayers: Array<{ name: string; wins: number; winRate: number }>;
  totalMatches: number;
  qrCodeUrl: string;
  template?: ShareCardTemplate;
}

export type ShareCardData = MatchShareData | PlayerShareData | StatsShareData;

const CARD_WIDTH = 1200;
const CARD_HEIGHT = 630;
const DPR = 2;

function createDefaultGradientBackground(ctx: CanvasRenderingContext2D): void {
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

function drawBrandWatermark(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  template?: ShareCardTemplate
): void {
  ctx.save();
  drawRoundedRect(ctx, x, y, width, height, 40);
  ctx.clip();
  ctx.translate(x + width / 2, y + height / 2);
  ctx.rotate(-Math.PI / 7);
  
  if (template === 'minimal') {
    ctx.fillStyle = 'rgba(230, 57, 0, 0.05)';
  } else if (template === 'celebration') {
    ctx.fillStyle = 'rgba(255, 215, 0, 0.15)';
  } else {
    ctx.fillStyle = 'rgba(230, 57, 0, 0.11)';
  }
  
  ctx.font = 'bold 46px "PingFang SC", sans-serif';
  ctx.textAlign = 'center';

  for (let row = -2; row <= 2; row += 1) {
    for (let col = -3; col <= 3; col += 1) {
      ctx.fillText('七笑果 MatchLife', col * 260, row * 120);
    }
  }

  ctx.restore();
}

function applyTemplateBackground(ctx: CanvasRenderingContext2D, template: ShareCardTemplate = 'default') {
  switch (template) {
    case 'sports':
      {
        const gradient = ctx.createLinearGradient(0, 0, CARD_WIDTH, CARD_HEIGHT);
      gradient.addColorStop(0, '#1E3A8A'); // Blue
      gradient.addColorStop(1, '#0F172A'); // Dark Blue
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);
      break;
      }
    case 'minimal':
      {
        const gradient = ctx.createLinearGradient(0, 0, CARD_WIDTH, CARD_HEIGHT);
      gradient.addColorStop(0, '#F8FAFC'); // Very Light Gray
      gradient.addColorStop(1, '#E2E8F0'); // Light Gray
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);
      break;
      }
    case 'celebration':
      {
        const gradient = ctx.createLinearGradient(0, 0, CARD_WIDTH, CARD_HEIGHT);
      gradient.addColorStop(0, '#FFD700'); // Gold
      gradient.addColorStop(1, '#FF8C00'); // Orange
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);
      break;
      }
    case 'default':
    default:
      createDefaultGradientBackground(ctx);
      break;
  }
}

function drawMultilineText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number
): number {
  const words = text.split('');
  let line = '';
  let currentY = y;

  for (let n = 0; n < words.length; n++) {
    const testLine = line + words[n];
    const metrics = ctx.measureText(testLine);
    const testWidth = metrics.width;

    if (testWidth > maxWidth && n > 0) {
      ctx.fillText(line, x, currentY);
      line = words[n];
      currentY += lineHeight;
    } else {
      line = testLine;
    }
  }
  ctx.fillText(line, x, currentY);
  return currentY;
}

function adjustFontSizeToFit(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxFontSize: number,
  minFontSize: number,
  fontFamily: string
): number {
  let fontSize = maxFontSize;
  ctx.font = `bold ${fontSize}px "${fontFamily}", sans-serif`;
  while (ctx.measureText(text).width > maxWidth && fontSize > minFontSize) {
    fontSize -= 2;
    ctx.font = `bold ${fontSize}px "${fontFamily}", sans-serif`;
  }
  return fontSize;
}

function getTemplateColors(template: ShareCardTemplate = 'default') {
  switch (template) {
    case 'sports':
      return { bg: 'rgba(255, 255, 255, 0.95)', textMain: '#0F172A', textSub: '#64748B', accent: '#3B82F6' };
    case 'minimal':
      return { bg: '#FFFFFF', textMain: '#1E293B', textSub: '#94A3B8', accent: '#F97316' };
    case 'celebration':
      return { bg: 'rgba(255, 255, 255, 0.98)', textMain: '#78350F', textSub: '#B45309', accent: '#D97706' };
    case 'default':
    default:
      return { bg: 'rgba(255, 255, 255, 0.95)', textMain: '#4A2311', textSub: '#8C6B5D', accent: '#FF9800' };
  }
}

function drawMatchCard(
  ctx: CanvasRenderingContext2D,
  data: MatchShareData
): void {
  const template = data.template || 'default';
  applyTemplateBackground(ctx, template);
  const colors = getTemplateColors(template);

  ctx.save();
  drawRoundedRect(ctx, 60, 60, CARD_WIDTH - 120, CARD_HEIGHT - 120, 40);
  ctx.fillStyle = colors.bg;
  ctx.fill();
  ctx.restore();
  drawBrandWatermark(ctx, 60, 60, CARD_WIDTH - 120, CARD_HEIGHT - 120, template);

  ctx.fillStyle = colors.textMain;
  adjustFontSizeToFit(ctx, data.tournamentName, CARD_WIDTH - 240, 48, 28, 'PingFang SC');
  ctx.textAlign = 'center';
  ctx.fillText(data.tournamentName, CARD_WIDTH / 2, 160);

  if (data.eventKey) {
    ctx.fillStyle = colors.accent;
    ctx.font = 'bold 28px "PingFang SC", sans-serif';
    ctx.fillText(data.eventKey, CARD_WIDTH / 2, 210);
  }

  const namesY = CARD_HEIGHT / 2 - 10;
  const scoreY = CARD_HEIGHT / 2 + 115;

  ctx.fillStyle = data.winnerSide === 'A' ? colors.accent : colors.textSub;
  const playerAFontSize = adjustFontSizeToFit(ctx, data.playerA, 320, 40, 24, 'PingFang SC');
  ctx.font = `bold ${playerAFontSize}px "PingFang SC", sans-serif`;
  ctx.textAlign = 'right';
  drawMultilineText(ctx, data.playerA, CARD_WIDTH / 2 - 120, namesY, 320, Math.max(42, playerAFontSize + 8));

  ctx.fillStyle = colors.textSub;
  ctx.font = 'bold 34px "PingFang SC", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('VS', CARD_WIDTH / 2, namesY + 10);

  ctx.fillStyle = data.winnerSide === 'B' ? colors.accent : colors.textSub;
  const playerBFontSize = adjustFontSizeToFit(ctx, data.playerB, 320, 40, 24, 'PingFang SC');
  ctx.font = `bold ${playerBFontSize}px "PingFang SC", sans-serif`;
  ctx.textAlign = 'left';
  drawMultilineText(ctx, data.playerB, CARD_WIDTH / 2 + 120, namesY, 320, Math.max(42, playerBFontSize + 8));

  ctx.fillStyle = colors.textMain;
  ctx.font = 'bold 64px "PingFang SC", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(data.score, CARD_WIDTH / 2, scoreY);

  ctx.fillStyle = colors.textSub;
  ctx.font = '28px "PingFang SC", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(data.date, CARD_WIDTH / 2, CARD_HEIGHT - 120);

  ctx.fillStyle = colors.textMain;
  ctx.font = 'bold 24px "PingFang SC", sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('七笑果 MatchLife', 80, CARD_HEIGHT - 60);
}

function drawPlayerCard(
  ctx: CanvasRenderingContext2D,
  data: PlayerShareData
): void {
  const template = data.template || 'default';
  applyTemplateBackground(ctx, template);
  const colors = getTemplateColors(template);

  ctx.save();
  drawRoundedRect(ctx, 60, 60, CARD_WIDTH - 120, CARD_HEIGHT - 120, 40);
  ctx.fillStyle = colors.bg;
  ctx.fill();
  ctx.restore();
  drawBrandWatermark(ctx, 60, 60, CARD_WIDTH - 120, CARD_HEIGHT - 120, template);

  ctx.fillStyle = colors.textMain;
  adjustFontSizeToFit(ctx, data.playerName, CARD_WIDTH - 240, 56, 32, 'PingFang SC');
  ctx.textAlign = 'center';
  ctx.fillText(data.playerName, CARD_WIDTH / 2, 160);

  ctx.fillStyle = colors.textSub;
  ctx.font = '32px "PingFang SC", sans-serif';
  ctx.fillText('生涯数据', CARD_WIDTH / 2, 220);

  const statsY = 320;
  const statsGap = 180;

  ctx.fillStyle = colors.accent;
  ctx.font = 'bold 72px "PingFang SC", sans-serif';
  ctx.fillText(String(data.totalMatches), CARD_WIDTH / 2 - statsGap, statsY);
  ctx.fillStyle = colors.textSub;
  ctx.font = '28px "PingFang SC", sans-serif';
  ctx.fillText('总场次', CARD_WIDTH / 2 - statsGap, statsY + 60);

  ctx.fillStyle = colors.accent;
  ctx.font = 'bold 72px "PingFang SC", sans-serif';
  ctx.fillText(String(data.wins), CARD_WIDTH / 2, statsY);
  ctx.fillStyle = colors.textSub;
  ctx.font = '28px "PingFang SC", sans-serif';
  ctx.fillText('胜场', CARD_WIDTH / 2, statsY + 60);

  ctx.fillStyle = colors.accent;
  ctx.font = 'bold 72px "PingFang SC", sans-serif';
  ctx.fillText(`${data.winRate.toFixed(1)}%`, CARD_WIDTH / 2 + statsGap, statsY);
  ctx.fillStyle = colors.textSub;
  ctx.font = '28px "PingFang SC", sans-serif';
  ctx.fillText('胜率', CARD_WIDTH / 2 + statsGap, statsY + 60);

  ctx.fillStyle = colors.textMain;
  ctx.font = 'bold 24px "PingFang SC", sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('七笑果 MatchLife', 80, CARD_HEIGHT - 60);
}

function drawStatsCard(
  ctx: CanvasRenderingContext2D,
  data: StatsShareData
): void {
  const template = data.template || 'default';
  applyTemplateBackground(ctx, template);
  const colors = getTemplateColors(template);

  ctx.save();
  drawRoundedRect(ctx, 60, 60, CARD_WIDTH - 120, CARD_HEIGHT - 120, 40);
  ctx.fillStyle = colors.bg;
  ctx.fill();
  ctx.restore();
  drawBrandWatermark(ctx, 60, 60, CARD_WIDTH - 120, CARD_HEIGHT - 120, template);

  ctx.fillStyle = colors.textMain;
  adjustFontSizeToFit(ctx, data.tournamentName, CARD_WIDTH - 240, 42, 28, 'PingFang SC');
  ctx.textAlign = 'center';
  ctx.fillText(data.tournamentName, CARD_WIDTH / 2, 140);

  ctx.fillStyle = colors.textSub;
  ctx.font = '28px "PingFang SC", sans-serif';
  ctx.fillText(`总场次：${data.totalMatches}`, CARD_WIDTH / 2, 190);

  ctx.fillStyle = colors.textMain;
  ctx.font = 'bold 32px "PingFang SC", sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('排行榜 TOP 3', 100, 260);

  const startY = 320;
  const lineHeight = 70;

  data.topPlayers.slice(0, 3).forEach((player, idx) => {
    const y = startY + idx * lineHeight;
    
    ctx.fillStyle = colors.accent;
    ctx.font = 'bold 36px "PingFang SC", sans-serif';
    ctx.fillText(`${idx + 1}`, 100, y);

    ctx.fillStyle = colors.textMain;
    ctx.font = 'bold 32px "PingFang SC", sans-serif';
    ctx.fillText(player.name, 180, y);

    ctx.fillStyle = colors.textSub;
    ctx.font = '28px "PingFang SC", sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(`${player.wins}胜 | ${player.winRate.toFixed(1)}%`, CARD_WIDTH - 100, y);
    ctx.textAlign = 'left';
  });

  ctx.fillStyle = colors.textMain;
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
