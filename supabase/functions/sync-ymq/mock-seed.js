import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../../../.env.local'), override: true });
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase URL or Key in .env');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function seedMatches() {
  console.log('Seeding mock ymq matches data...');
  
  const fetchedMatches = [
    {
      id: `YMQ-${Date.now()}-1`,
      category: 'U10',
      tournament: '2026年全国U系列羽毛球比赛(北方赛区)',
      start_time: new Date().toISOString(),
      team_a: ['李小明'],
      team_b: ['王大山'],
      score: '21-18',
      winner: 'A'
    },
    {
      id: `YMQ-${Date.now()}-2`,
      category: 'U12',
      tournament: '2026年全国U系列羽毛球比赛(北方赛区)',
      start_time: new Date(Date.now() - 3600000).toISOString(),
      team_a: ['张三', '李四'],
      team_b: ['赵五', '钱六'],
      score: '2-1',
      winner: 'B'
    },
    {
      id: `YMQ-${Date.now()}-3`,
      category: 'U11',
      tournament: '北京市青少年羽毛球锦标赛',
      start_time: new Date(Date.now() - 86400000).toISOString(),
      team_a: ['林林'],
      team_b: ['陈晨'],
      score: '21-15',
      winner: 'A'
    }
  ];

  let upsertedCount = 0;

  for (const match of fetchedMatches) {
    const { error } = await supabase.from('matches').upsert({
      source: 'ymq',
      ymq_match_id: match.id,
      category: match.category,
      tournament_name: match.tournament,
      start_time: match.start_time,
      players_a: match.team_a,
      players_b: match.team_b,
      score_text: match.score,
      winner_side: match.winner,
      source_updated_at: new Date().toISOString()
    }, {
      onConflict: 'ymq_match_id'
    });

    if (error) {
      console.error('Error upserting match:', match.id, error);
    } else {
      upsertedCount++;
    }
  }

  console.log(`Upserted ${upsertedCount} matches.`);

  await supabase.from('sync_runs').insert({
    source: 'ymq',
    status: 'SUCCESS',
    pulled_count: fetchedMatches.length,
    upserted_count: upsertedCount
  });
  
  console.log('Sync log recorded.');
}

seedMatches().catch(console.error);
