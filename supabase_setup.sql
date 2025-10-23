-- =============================================
-- FOOTBALL PREDICTION APP - SUPABASE SETUP
-- =============================================

-- 1. PROFILES TABLE
CREATE TABLE public.profiles (
  id uuid REFERENCES auth.users ON DELETE CASCADE PRIMARY KEY,
  username text UNIQUE NOT NULL,
  role text DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  vip_tier integer DEFAULT 0,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 2. PREDICTIONS TABLE
CREATE TABLE public.predictions (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  home_team text NOT NULL,
  away_team text NOT NULL,
  match_start_time timestamp with time zone NOT NULL,
  match_url text,
  prediction_type text NOT NULL,
  odds text NOT NULL,
  confidence text NOT NULL,
  is_free boolean DEFAULT false,
  tier text CHECK (tier IN ('basic', 'standard', 'premium', 'ultra_vip')),
  result text CHECK (result IN ('Win', 'Lost')),
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 3. COMMUNITY MESSAGES TABLE
CREATE TABLE public.community_messages (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users ON DELETE CASCADE NOT NULL,
  username text NOT NULL,
  content text NOT NULL,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 4. PREDICTION COMMENTS TABLE
CREATE TABLE public.prediction_comments (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  prediction_id uuid REFERENCES public.predictions ON DELETE CASCADE NOT NULL,
  user_id uuid REFERENCES auth.users ON DELETE CASCADE NOT NULL,
  username text NOT NULL,
  text text NOT NULL,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- =============================================
-- ROW LEVEL SECURITY POLICIES
-- =============================================

-- Enable RLS on all tables
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.predictions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prediction_comments ENABLE ROW LEVEL SECURITY;

-- PROFILES POLICIES
CREATE POLICY "Public profiles are viewable by everyone" ON public.profiles
  FOR SELECT USING (true);

CREATE POLICY "Users can insert their own profile" ON public.profiles
  FOR INSERT WITH CHECK (auth.uid() = id);

CREATE POLICY "Users can update own profile" ON public.profiles
  FOR UPDATE USING (auth.uid() = id);

CREATE POLICY "Admins can update any profile" ON public.profiles
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.profiles 
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- PREDICTIONS POLICIES
CREATE POLICY "Anyone can view predictions" ON public.predictions
  FOR SELECT USING (true);

CREATE POLICY "Only admins can insert predictions" ON public.predictions
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles 
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

CREATE POLICY "Only admins can update predictions" ON public.predictions
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.profiles 
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- COMMUNITY MESSAGES POLICIES
CREATE POLICY "Anyone can view community messages" ON public.community_messages
  FOR SELECT USING (true);

CREATE POLICY "Authenticated users can insert messages" ON public.community_messages
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Admins can delete any message" ON public.community_messages
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM public.profiles 
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- PREDICTION COMMENTS POLICIES
CREATE POLICY "Anyone can view prediction comments" ON public.prediction_comments
  FOR SELECT USING (true);

CREATE POLICY "Authenticated users can insert comments" ON public.prediction_comments
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- =============================================
-- FUNCTIONS AND TRIGGERS
-- =============================================

-- Function to handle new user registration
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.profiles (id, username, role, vip_tier)
  VALUES (
    new.id,
    COALESCE(new.raw_user_meta_data->>'username', 'User'),
    'user',
    0
  );
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger to create profile on user signup
ROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

-- Function to updatDe updated_at timestamp
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = timezone('utc'::text, now());
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for profiles updated_at
CREATE TRIGGER handle_updated_at BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE PROCEDURE public.handle_updated_at();

-- =============================================
-- INDEXES FOR PERFORMANCE
-- =============================================

CREATE INDEX idx_profiles_role ON public.profiles(role);
CREATE INDEX idx_predictions_is_free ON public.predictions(is_free);
CREATE INDEX idx_predictions_tier ON public.predictions(tier);
CREATE INDEX idx_predictions_match_start_time ON public.predictions(match_start_time);
CREATE INDEX idx_community_messages_created_at ON public.community_messages(created_at);
CREATE INDEX idx_prediction_comments_prediction_id ON public.prediction_comments(prediction_id);

-- =============================================
-- SAMPLE ADMIN USER (OPTIONAL)
-- =============================================

-- After creating your first user account, run this to make them admin:
-- UPDATE public.profiles SET role = 'admin' WHERE username = 'your_username';