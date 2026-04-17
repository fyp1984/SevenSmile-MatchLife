import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env file from the root directory
dotenv.config({ path: path.resolve(__dirname, '../../../.env.local'), override: true });
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase URL or Key in .env');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function processYmqData() {
  console.log('Processing ymq data from JSON...');
  const dataPath = path.resolve(__dirname, '../../../ymq_all_courts_data.json');
  if (!fs.existsSync(dataPath)) {
    console.error('No scraped data found. Run node scrape_ymq.js first.');
    return;
  }
  
  const responses = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
  let matchesData = [];
  
  // Find the right response
  for (const resp of responses) {
    if (resp.url.includes('matchesScore.do') && resp.data?.detail?.rows) {
      matchesData = resp.data.detail.rows;
      break;
    }
  }
  
  if (matchesData.length === 0) {
    console.error('Could not find matches data in the scraped JSON.');
    return;
  }
  
  console.log(`Found ${matchesData.length} matches from the API.`);
  
  let upsertedCount = 0;

  for (const row of matchesData) {
    // Determine winner based on gameScores or battleScore
    let winner = 'UNKNOWN';
    if (row.scoreStatusNo === 2) { // 比赛结束
       if (row.battleScoreOne > row.battleScoreTwo) winner = 'A';
       else if (row.battleScoreTwo > row.battleScoreOne) winner = 'B';
    }

    // Format score text (e.g. "21-18, 13-21, 21-13")
    let scoreText = '';
    if (row.gameScores && row.gameScores.length > 0) {
      scoreText = row.gameScores.map(g => `${g.scoreOne}-${g.scoreTwo}`).join(', ');
    } else {
      scoreText = `${row.battleScoreOne || 0}-${row.battleScoreTwo || 0}`;
    }

    // Extract players
    const playersA = row.playerOnes?.map(p => p.name) || [];
    const playersB = row.playerTwos?.map(p => p.name) || [];

    // Map fields
    const matchRecord = {
      source: 'ymq',
      ymq_match_id: `YMQ-${row.id}`,
      category: row.groupName || 'U未知',
      tournament_name: '2026年全国U系列羽毛球比赛(北方赛区)', // Hardcode for this event based on URL intent, can be dynamic
      start_time: row.raceTimestamp ? new Date(row.raceTimestamp).toISOString() : new Date().toISOString(),
      location: row.courtName || '未知场地',
      city: '辽宁青岛', // Hardcode or extract if available
      players_a: playersA,
      players_b: playersB,
      score_text: scoreText,
      winner_side: winner,
      source_updated_at: row.scoreEndTime ? new Date(row.scoreEndTime).toISOString() : new Date().toISOString()
    };

    const { error } = await supabase.from('matches').upsert(matchRecord, {
      onConflict: 'ymq_match_id'
    });

    if (error) {
      console.error('Error upserting match:', matchRecord.ymq_match_id, error);
    } else {
      upsertedCount++;
    }
  }

  console.log(`Upserted ${upsertedCount} matches.`);

  await supabase.from('sync_runs').insert({
    source: 'ymq',
    status: 'SUCCESS',
    pulled_count: matchesData.length,
    upserted_count: upsertedCount
  });
  
  console.log('Sync log recorded.');
}

processYmqData().catch(console.error);
