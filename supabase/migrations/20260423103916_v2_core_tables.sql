-- MatchLife V2.0 Core Tables Migration
-- Created: 2026-04-23

-- 1. Create players table
CREATE TABLE IF NOT EXISTS players (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id),
    player_name VARCHAR(100) NOT NULL,
    avatar_url TEXT,
    gender VARCHAR(10) CHECK (gender IN ('male', 'female')),
    birth_date DATE,
    height_cm INTEGER,
    weight_kg DECIMAL(4,1),
    dominant_hand VARCHAR(10) CHECK (dominant_hand IN ('left', 'right', 'both')),
    primary_sport VARCHAR(50) NOT NULL,
    secondary_sports VARCHAR(255)[],
    affiliated_club VARCHAR(200),
    coach_name VARCHAR(100),
    registration_date TIMESTAMPTZ DEFAULT NOW(),
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'retired')),
    privacy_settings JSONB DEFAULT '{"basic": "public", "stats": "friends", "growth": "private"}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Create technique_tags table
CREATE TABLE IF NOT EXISTS technique_tags (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sport_type VARCHAR(50) NOT NULL,
    tag_name VARCHAR(100) NOT NULL,
    tag_category VARCHAR(50) NOT NULL,
    tag_description TEXT,
    parent_tag_id UUID REFERENCES technique_tags(id),
    icon_url TEXT,
    sort_order INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Create match_events table
CREATE TABLE IF NOT EXISTS match_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    match_id UUID REFERENCES matches(id) ON DELETE CASCADE,
    player_id UUID REFERENCES players(id),
    event_type VARCHAR(50) NOT NULL,
    sub_event_type VARCHAR(50),
    technique_id UUID REFERENCES technique_tags(id),
    score_state JSONB,
    event_time INTEGER NOT NULL,
    period_id VARCHAR(20),
    point_index INTEGER,
    description TEXT,
    video_timestamp FLOAT,
    video_clip_url TEXT,
    is_verified BOOLEAN DEFAULT FALSE,
    verifier_id UUID REFERENCES auth.users(id),
    created_by UUID REFERENCES auth.users(id) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Create user_reputation table
CREATE TABLE IF NOT EXISTS user_reputation (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) UNIQUE NOT NULL,
    reputation_score INTEGER DEFAULT 0,
    level VARCHAR(20) DEFAULT 'beginner' CHECK (level IN ('beginner', 'intermediate', 'advanced', 'expert')),
    total_tags INTEGER DEFAULT 0,
    verified_tags INTEGER DEFAULT 0,
    accuracy_rate DECIMAL(5,4) DEFAULT 0,
    badges JSONB DEFAULT '[]',
    last_active_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. Create indexes
CREATE INDEX IF NOT EXISTS idx_players_primary_sport ON players(primary_sport);
CREATE INDEX IF NOT EXISTS idx_players_status ON players(status) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_players_user_id ON players(user_id);
CREATE INDEX IF NOT EXISTS idx_players_name ON players(player_name);

CREATE INDEX IF NOT EXISTS idx_technique_tags_sport ON technique_tags(sport_type);
CREATE INDEX IF NOT EXISTS idx_technique_tags_category ON technique_tags(tag_category);
CREATE INDEX IF NOT EXISTS idx_technique_tags_active ON technique_tags(is_active) WHERE is_active = TRUE;

CREATE INDEX IF NOT EXISTS idx_match_events_match_id ON match_events(match_id);
CREATE INDEX IF NOT EXISTS idx_match_events_player_id ON match_events(player_id);
CREATE INDEX IF NOT EXISTS idx_match_events_event_type ON match_events(event_type);
CREATE INDEX IF NOT EXISTS idx_match_events_created_by ON match_events(created_by);
CREATE INDEX IF NOT EXISTS idx_match_events_match_time ON match_events(match_id, event_time);

CREATE INDEX IF NOT EXISTS idx_user_reputation_user_id ON user_reputation(user_id);
CREATE INDEX IF NOT EXISTS idx_user_reputation_level ON user_reputation(level);
CREATE INDEX IF NOT EXISTS idx_user_reputation_score ON user_reputation(reputation_score DESC);

-- 6. Enable RLS
ALTER TABLE players ENABLE ROW LEVEL SECURITY;
ALTER TABLE technique_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE match_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_reputation ENABLE ROW LEVEL SECURITY;

-- 7. Create RLS policies for players
CREATE POLICY "Players are viewable by everyone"
ON players FOR SELECT
USING (status = 'active');

CREATE POLICY "Users can create their own player profiles"
ON players FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own player profiles"
ON players FOR UPDATE
USING (auth.uid() = user_id);

-- 8. Create RLS policies for technique_tags
CREATE POLICY "Active tags are viewable by everyone"
ON technique_tags FOR SELECT
USING (is_active = TRUE);

-- 9. Create RLS policies for match_events
CREATE POLICY "Verified events are viewable by everyone"
ON match_events FOR SELECT
USING (is_verified = TRUE);

CREATE POLICY "Users can view their own events"
ON match_events FOR SELECT
USING (auth.uid() = created_by);

CREATE POLICY "Authenticated users can create events"
ON match_events FOR INSERT
WITH CHECK (auth.uid() = created_by);

CREATE POLICY "Users can update their own events"
ON match_events FOR UPDATE
USING (auth.uid() = created_by);

-- 10. Create RLS policies for user_reputation
CREATE POLICY "User reputation is viewable by everyone"
ON user_reputation FOR SELECT
USING (TRUE);

-- 11. Insert badminton technique tags
INSERT INTO technique_tags (sport_type, tag_name, tag_category, tag_description, sort_order) VALUES
('badminton', '高远球', '进攻技术', '将球击向对方后场高处', 1),
('badminton', '扣杀球', '进攻技术', '用力向下击球', 2),
('badminton', '吊球', '进攻技术', '将球轻击至对方前场', 3),
('badminton', '搓球', '网前技术', '在网前轻搓球过网', 4),
('badminton', '推球', '网前技术', '快速推击球过网', 5),
('badminton', '勾球', '网前技术', '勾击对角线球', 6),
('badminton', '挑球', '防守技术', '将球挑至对方后场', 7),
('badminton', '接杀球', '防守技术', '接对方扣杀球', 8)
ON CONFLICT DO NOTHING;
