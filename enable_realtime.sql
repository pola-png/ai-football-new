-- Enable real-time for all tables
ALTER PUBLICATION supabase_realtime ADD TABLE public.predictions;
ALTER PUBLICATION supabase_realtime ADD TABLE public.community_messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.prediction_comments;
ALTER PUBLICATION supabase_realtime ADD TABLE public.profiles;