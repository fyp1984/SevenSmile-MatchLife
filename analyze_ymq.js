import fs from 'fs';

const data = JSON.parse(fs.readFileSync('ymq_scraped_data.json', 'utf-8'));

for (const resp of data) {
  if (resp.url.includes('matchesScore.do')) {
    const rows = resp.data.detail.rows;
    console.log(`Total matches: ${rows.length}`);
    if (rows.length > 0) {
      console.log('Sample Match:', JSON.stringify(rows[0], null, 2));
    }
  }
}