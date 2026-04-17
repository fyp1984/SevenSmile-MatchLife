import { chromium } from 'playwright';
import fs from 'fs';

(async () => {
  console.log('Launching browser...');
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  const responses = [];

  page.on('response', async (response) => {
    // Capture all JSON responses to see where the data comes from
    try {
      const type = response.headers()['content-type'];
      if (type && type.includes('json')) {
        const json = await response.json();
        console.log('Intercepted JSON API:', response.url());
        responses.push({ url: response.url(), data: json });
      }
    } catch (e) {
      // Ignored
    }
  });

  const targetUrl = 'https://apply.ymq.me/wechat/#/match?game_id=38653&shareTitle=%5B%25E5%25AE%259E%25E6%2597%25B6%25E8%25B5%259B%25E5%2586%25B5%5D(%25E5%258D%2595%25E9%25A1%25B9)2026%25E5%25B9%25B4%25E5%2585%25A8%25E5%259B%25BDU%25E7%25B3%25BB%25E5%2588%2597%25E7%25BE%25BD%25E6%25AF%259B%25E7%2590%2583%25E6%25AF%2594%25E8%25B5%259BU12-14(%25E5%258C%2597%25E6%2596%25B9%25E8%25B5%259B%25E5%258C%25BA)&siteNum=10';
  
  console.log('Navigating to ymq...');
  await page.goto(targetUrl, { waitUntil: 'networkidle' });
  
  // Wait for 10 seconds to ensure all data is loaded
  await page.waitForTimeout(10000);

  fs.writeFileSync('ymq_scraped_data.json', JSON.stringify(responses, null, 2));
  console.log('Saved intercepted data to ymq_scraped_data.json');
  
  await browser.close();
})();