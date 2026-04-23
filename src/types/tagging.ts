// Database table types
export type TechniqueTag = {
  id: string;
  sport: 'badminton' | 'tennis';
  tag_name: string;
  tag_category: string;
  description: string | null;
  created_at: string;
};

export type MatchEvent = {
  id: string;
  match_id: string;
  user_id: string;
  tag_id: string;
  event_time: string;
  video_timestamp: number | null;
  notes: string | null;
  is_verified: boolean;
  created_by: string;
  created_at: string;
  updated_at: string;
};

export type UserReputation = {
  user_id: string;
  total_tags: number;
  verified_tags: number;
  accuracy_score: number;
  reputation_level: 'beginner' | 'intermediate' | 'advanced' | 'expert';
  total_points: number;
  badges: string[];
  created_at: string;
  updated_at: string;
};

// UI state types
export type TaggingMode = 'realtime' | 'replay';

export type TagEntry = {
  id: string;
  tagId: string;
  tagName: string;
  tagCategory: string;
  eventTime: string;
  videoTimestamp: number | null;
  notes: string;
  isVerified: boolean;
};

export type Badge = {
  id: string;
  name: string;
  description: string;
  icon: string;
  earnedAt: string | null;
};
