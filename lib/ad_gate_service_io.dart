import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:google_mobile_ads/google_mobile_ads.dart';

import 'ad_config.dart';

class AdGateService {
  AdGateService._();

  static final AdGateService instance = AdGateService._();

  RewardedAd? _rewardedAd;
  bool _loadingRewardedAd = false;
  bool _initialized = false;

  bool get _supportsAds =>
      !kIsWeb && defaultTargetPlatform == TargetPlatform.android;

  Future<void> initialize() async {
    if (_initialized || !_supportsAds) {
      return;
    }

    _initialized = true;
    await MobileAds.instance.initialize();
    _loadRewardedAd();
  }

  void _loadRewardedAd() {
    if (!_supportsAds || _loadingRewardedAd || _rewardedAd != null) {
      return;
    }

    _loadingRewardedAd = true;
    RewardedAd.load(
      adUnitId: kRewardedAdUnitId,
      request: const AdRequest(),
      rewardedAdLoadCallback: RewardedAdLoadCallback(
        onAdLoaded: (ad) {
          _rewardedAd = ad;
          _loadingRewardedAd = false;
        },
        onAdFailedToLoad: (error) {
          _loadingRewardedAd = false;
        },
      ),
    );
  }

  Future<bool> showRewardedAd() async {
    if (!_supportsAds) {
      return false;
    }

    final ad = _rewardedAd;
    if (ad == null) {
      _loadRewardedAd();
      return false;
    }

    _rewardedAd = null;
    final completer = Completer<bool>();
    var rewardEarned = false;
    var adShown = false;

    ad.fullScreenContentCallback = FullScreenContentCallback(
      onAdShowedFullScreenContent: (_) {
        adShown = true;
      },
      onAdDismissedFullScreenContent: (shownAd) {
        shownAd.dispose();
        _loadRewardedAd();
        if (!completer.isCompleted) {
          completer.complete(rewardEarned || adShown);
        }
      },
      onAdFailedToShowFullScreenContent: (shownAd, error) {
        shownAd.dispose();
        _loadRewardedAd();
        if (!completer.isCompleted) {
          completer.complete(false);
        }
      },
    );

    ad.show(
      onUserEarnedReward: (_, reward) {
        rewardEarned = true;
        if (!completer.isCompleted) {
          completer.complete(true);
        }
      },
    );

    return completer.future.timeout(
      const Duration(seconds: 45),
      onTimeout: () {
        _loadRewardedAd();
        return rewardEarned || adShown;
      },
    );
  }
}
