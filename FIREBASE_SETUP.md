# Firebase Analytics Setup Guide

## Why Firebase Analytics?
Firebase Analytics integrates seamlessly with AdMob to:
- Track user behavior and engagement
- Optimize ad placement and targeting
- Increase ad revenue through better audience insights
- Provide detailed analytics on user interactions

## Setup Steps:

### 1. Create Firebase Project
1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Click "Create a project"
3. Name it "Football Prediction App" 
4. Enable Google Analytics for this project
5. Choose or create Analytics account

### 2. Add Android App
1. Click "Add app" → Android
2. Package name: `com.footballprediction.app`
3. App nickname: "Football Prediction App"
4. Download `google-services.json`
5. Replace the demo file at: `android/app/google-services.json`

### 3. Update Firebase Options
1. In Firebase Console, go to Project Settings
2. Copy the configuration values
3. Replace demo values in `lib/firebase_options.dart`:
   - `apiKey`
   - `appId` 
   - `messagingSenderId`
   - `projectId`

### 4. Link AdMob to Analytics
1. In Firebase Console, go to "Integrations"
2. Find "AdMob" and click "Link"
3. Select your AdMob account
4. This enables:
   - Ad revenue tracking in Analytics
   - Audience insights for ad targeting
   - Better ad performance optimization

### 5. Enable Analytics Features
In Firebase Console → Analytics:
- Enable "Google Ads Personalization"
- Enable "Google Analytics Advertising Features"
- Set up conversion events for VIP purchases

## Analytics Events Being Tracked:

### Screen Views:
- `free_predictions` - Free predictions screen
- `community_chat` - Community chat screen
- `vip_predictions` - VIP predictions screens

### User Actions:
- `rewarded_ad_requested` - User clicks to watch rewarded ad
- `rewarded_ad_completed` - User completes rewarded ad
- `vip_purchase_initiated` - User starts VIP purchase
- `prediction_view` - User views a prediction
- `user_engagement` - General user interactions

### Revenue Events:
- `purchase` - VIP tier purchases with value and currency

## Benefits for AdMob:
1. **Better Targeting**: Analytics data helps AdMob show more relevant ads
2. **Higher eCPM**: Better targeting = higher ad prices
3. **User Segmentation**: Target different ad types to different user groups
4. **Revenue Optimization**: Track which users are most valuable
5. **A/B Testing**: Test different ad placements and formats

## Current Ad Placement:
- Banner ads after every prediction card
- Banner ads every 3 messages in chat
- Rewarded ads for unlocking free predictions
- Native ads mixed with banner ads

## Next Steps:
1. Complete Firebase setup with real credentials
2. Test analytics events in Firebase Console
3. Monitor ad performance improvements
4. Set up conversion tracking for purchases