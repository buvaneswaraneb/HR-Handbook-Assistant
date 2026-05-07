-- Migration: Google Calendar Integration
-- Purpose: Store Google Calendar OAuth tokens and cached events for users

-- Table to store Google Calendar credentials per user
CREATE TABLE IF NOT EXISTS google_calendar_credentials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  refresh_token TEXT NOT NULL,
  access_token TEXT NOT NULL,
  token_expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  
  CONSTRAINT fk_user_id FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  UNIQUE(user_id)
);

-- Table to cache Google Calendar events
CREATE TABLE IF NOT EXISTS google_calendar_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  google_event_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  start_time TIMESTAMP NOT NULL,
  end_time TIMESTAMP NOT NULL,
  event_url TEXT,
  synced_at TIMESTAMP DEFAULT NOW(),
  
  CONSTRAINT fk_user_id FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  UNIQUE(user_id, google_event_id)
);

-- Index for efficient queries
CREATE INDEX IF NOT EXISTS idx_calendar_events_user_time 
  ON google_calendar_events(user_id, start_time DESC);

CREATE INDEX IF NOT EXISTS idx_calendar_creds_user 
  ON google_calendar_credentials(user_id);
