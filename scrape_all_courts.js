import { chromium } from 'playwright';
import fs from 'fs';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  let allMatches = [];
  let reqHeaders = {};
  let reqUrl = '';
  let token = '';
  let snTemplate = {};

  page.on('request', request => {
    if (request.url().includes('matchesScore.do')) {
      reqUrl = request.url();
      reqHeaders = request.headers();
      const postData = JSON.parse(request.postData());
      snTemplate = postData.header;
    }
  });

  const targetUrl = 'https://apply.ymq.me/wechat/#/match?game_id=38653&shareTitle=%5B%25E5%25AE%259E%25E6%2597%25B6%25E8%25B5%259B%25E5%2586%25B5%5D(%25E5%258D%2595%25E9%25A1%25B9)2026%25E5%25B9%25B4%25E5%2585%25A8%25E5%259B%25BDU%25E7%25B3%25BB%25E5%2588%2597%25E7%25BE%25BD%25E6%25AF%259B%25E7%2590%2583%25E6%25AF%2594%25E8%25B5%259BU12-14(%25E5%258C%2597%25E6%2596%25B9%25E8%25B5%259B%25E5%258C%25BA)&siteNum=10';
  await page.goto(targetUrl, { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);

  if (reqUrl) {
    console.log('Intercepted base request, fetching for all courts...');
    // We will use page.evaluate to fetch for courts 1 to 20
    const matchesFromAllCourts = await page.evaluate(async ({ url, snHeader }) => {
      let results = [];
      // Court 0 usually means all courts or we loop 1 to 20
      for (let i = 1; i <= 20; i++) {
        try {
          const res = await fetch(url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              body: { raceId: "38653", page: 1, rows: 99999, courtNo: i },
              header: snHeader // just reuse the intercepted header, the SN might not be strictly tied to payload
            })
          });
          const json = await res.json();
          if (json && json.detail && json.detail.rows) {
            results.push(...json.detail.rows);
          }
        } catch(e) {
          console.error(e);
        }
      }
      // Also try courtNo: null or 0 to see if it gets everything
      try {
        const resAll = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              body: { raceId: "38653", page: 1, rows: 99999, courtNo: null },
              header: snHeader
            })
          });
          const jsonAll = await resAll.json();
          if (jsonAll && jsonAll.detail && jsonAll.detail.rows) {
            results.push(...jsonAll.detail.rows);
          }
      } catch(e) {}

      return results;
    }, { url: reqUrl, snHeader: snTemplate });

    allMatches = matchesFromAllCourts;
  }

  // Deduplicate
  const uniqueMatchesMap = new Map();
  allMatches.forEach(m => {
    uniqueMatchesMap.set(m.id, m);
  });
  
  const uniqueMatches = Array.from(uniqueMatchesMap.values());
  console.log(`Total unique matches grabbed from ALL courts: ${uniqueMatches.length}`);

  fs.writeFileSync('ymq_all_courts_data.json', JSON.stringify([{ url: 'matchesScore.do', data: { detail: { rows: uniqueMatches } } }], null, 2));
  console.log('Saved intercepted data to ymq_all_courts_data.json');
  
  await browser.close();
})();