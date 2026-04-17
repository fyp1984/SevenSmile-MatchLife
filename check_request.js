import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  page.on('request', request => {
    if (request.url().includes('matchesScore.do')) {
      console.log('URL:', request.url());
      console.log('Method:', request.method());
      console.log('Post Data:', request.postData());
    }
  });

  const targetUrl = 'https://apply.ymq.me/wechat/#/match?game_id=38653&shareTitle=%5B%25E5%25AE%259E%25E6%2597%25B6%25E8%25B5%259B%25E5%2586%25B5%5D(%25E5%258D%2595%25E9%25A1%25B9)2026%25E5%25B9%25B4%25E5%2585%25A8%25E5%259B%25BDU%25E7%25B3%25BB%25E5%2588%2597%25E7%25BE%25BD%25E6%25AF%259B%25E7%2590%2583%25E6%25AF%2594%25E8%25B5%259BU12-14(%25E5%258C%2597%25E6%2596%25B9%25E8%25B5%259B%25E5%258C%25BA)&siteNum=10';
  await page.goto(targetUrl, { waitUntil: 'networkidle' });
  await page.waitForTimeout(5000);
  await browser.close();
})();