import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:google_mobile_ads/google_mobile_ads.dart';

import 'ad_config.dart';

class AdGateService {
  AdGateService._();

  static final AdGateService instance = AdGateService._();

  RewardedAd? _rewardedAd;
  bool _loadingRewardedAd = false;
  
  InterstitialAd? _interstitialAd;
  bool _loadingInterstitialAd = false;
  int _interstitialRetryCount = 0;

  RewardedInterstitialAd? _rewardedInterstitialAd;
  bool _loadingRewardedInterstitial = false;
  int _rewardedInterstitialRetryCount = 0;

  AppOpenAd? _appOpenAd;
  bool _loadingAppOpenAd = false;
  bool _isShowingAppOpenAd = false;
  DateTime? _appOpenAdLoadTime;

  bool _initialized = false;

  bool get _supportsAds =>
      !kIsWeb && defaultTargetPlatform == TargetPlatform.android;

  Future<void> initialize() async {
    if (_initialized || !_supportsAds) {
      return;
    }

    _initialized = true;
    await MobileAds.instance.initialize();
    if (kDebugMode) {
      await MobileAds.instance.updateRequestConfiguration(
        RequestConfiguration(testDeviceIds: [kTestDeviceId]),
      );
    }
    _loadRewardedAd();
    _loadInterstitialAd();
    _loadAppOpenAd();
    _loadRewardedInterstitialAd();
  }

  int _retryCount = 0;

  void _loadRewardedAd() {
    if (!_supportsAds || _loadingRewardedAd || _rewardedAd != null) {
      return;
    }

    _loadingRewardedAd = true;
    RewardedAd.load(
      adUnitId: kDebugMode ? kTestRewardedAdUnitId : kRewardedAdUnitId,
      request: const AdRequest(),
      rewardedAdLoadCallback: RewardedAdLoadCallback(
        onAdLoaded: (ad) {
          _rewardedAd = ad;
          _loadingRewardedAd = false;
          _retryCount = 0;
        },
        onAdFailedToLoad: (error) {
          _loadingRewardedAd = false;
          _retryCount++;
          final retryDelay = Duration(seconds: (2 * _retryCount).clamp(2, 60));
          Future.delayed(retryDelay, () {
            _loadRewardedAd();
          });
        },
      ),
    );
  }

  Future<bool> showRewardedAd() async {
    if (!_supportsAds) {
      return false;
    }

    if (_rewardedAd == null && !_loadingRewardedAd) {
      _loadRewardedAd();
    }

    if (_rewardedAd == null && _loadingRewardedAd) {
      int elapsedMs = 0;
      while (_rewardedAd == null && _loadingRewardedAd && elapsedMs < 5000) {
        await Future.delayed(const Duration(milliseconds: 200));
        elapsedMs += 200;
      }
    }

    final ad = _rewardedAd;
    if (ad == null) {
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

  void _loadInterstitialAd() {
    if (!_supportsAds || _loadingInterstitialAd || _interstitialAd != null) {
      return;
    }

    _loadingInterstitialAd = true;
    InterstitialAd.load(
      adUnitId: kDebugMode ? kTestInterstitialAdUnitId : kInterstitialAdUnitId,
      request: const AdRequest(),
      adLoadCallback: InterstitialAdLoadCallback(
        onAdLoaded: (ad) {
          _interstitialAd = ad;
          _loadingInterstitialAd = false;
          _interstitialRetryCount = 0;
        },
        onAdFailedToLoad: (error) {
          _loadingInterstitialAd = false;
          _interstitialRetryCount++;
          final retryDelay = Duration(seconds: (2 * _interstitialRetryCount).clamp(2, 60));
          Future.delayed(retryDelay, () {
            _loadInterstitialAd();
          });
        },
      ),
    );
  }

  Future<bool> showInterstitialAd() async {
    if (!_supportsAds) {
      return false;
    }

    if (_interstitialAd == null && !_loadingInterstitialAd) {
      _loadInterstitialAd();
    }

    if (_interstitialAd == null && _loadingInterstitialAd) {
      int elapsedMs = 0;
      while (_interstitialAd == null && _loadingInterstitialAd && elapsedMs < 5000) {
        await Future.delayed(const Duration(milliseconds: 200));
        elapsedMs += 200;
      }
    }

    final ad = _interstitialAd;
    if (ad == null) {
      return false;
    }

    _interstitialAd = null;
    final completer = Completer<bool>();
    var adShown = false;

    ad.fullScreenContentCallback = FullScreenContentCallback(
      onAdShowedFullScreenContent: (_) {
        adShown = true;
      },
      onAdDismissedFullScreenContent: (shownAd) {
        shownAd.dispose();
        _loadInterstitialAd();
        if (!completer.isCompleted) {
          completer.complete(adShown);
        }
      },
      onAdFailedToShowFullScreenContent: (shownAd, error) {
        shownAd.dispose();
        _loadInterstitialAd();
        if (!completer.isCompleted) {
          completer.complete(false);
        }
      },
    );

    ad.show();

    return completer.future.timeout(
      const Duration(seconds: 45),
      onTimeout: () {
        _loadInterstitialAd();
        return adShown;
      },
    );
  }

  void _loadAppOpenAd() {
    if (!_supportsAds || _loadingAppOpenAd || _appOpenAd != null) {
      return;
    }

    _loadingAppOpenAd = true;
    AppOpenAd.load(
      adUnitId: kDebugMode ? kTestAppOpenAdUnitId : kAppOpenAdUnitId,
      request: const AdRequest(),
      adLoadCallback: AppOpenAdLoadCallback(
        onAdLoaded: (ad) {
          _appOpenAd = ad;
          _loadingAppOpenAd = false;
          _appOpenAdLoadTime = DateTime.now();
        },
        onAdFailedToLoad: (error) {
          debugPrint('AppOpenAd failed to load: $error');
          _loadingAppOpenAd = false;
          // Retry loading after a short delay
          Future.delayed(const Duration(seconds: 10), () {
            _loadAppOpenAd();
          });
        },
      ),
    );
  }

  Future<void> showAppOpenAdIfAvailable() async {
    if (!_supportsAds || _isShowingAppOpenAd) {
      return;
    }

    final ad = _appOpenAd;
    if (ad == null) {
      _loadAppOpenAd();
      return;
    }

    // Ad open ad is expired after 4 hours as per Google policy.
    final loadTime = _appOpenAdLoadTime;
    if (loadTime != null && DateTime.now().difference(loadTime).inHours >= 4) {
      ad.dispose();
      _appOpenAd = null;
      _loadAppOpenAd();
      return;
    }

    _isShowingAppOpenAd = true;
    ad.fullScreenContentCallback = FullScreenContentCallback(
      onAdShowedFullScreenContent: (_) {},
      onAdDismissedFullScreenContent: (shownAd) {
        shownAd.dispose();
        _appOpenAd = null;
        _isShowingAppOpenAd = false;
        _loadAppOpenAd();
      },
      onAdFailedToShowFullScreenContent: (shownAd, error) {
        shownAd.dispose();
        _appOpenAd = null;
        _isShowingAppOpenAd = false;
        _loadAppOpenAd();
      },
    );

    await ad.show();
  }

  void _loadRewardedInterstitialAd() {
    if (!_supportsAds || _loadingRewardedInterstitial || _rewardedInterstitialAd != null) {
      return;
    }

    _loadingRewardedInterstitial = true;
    RewardedInterstitialAd.load(
      adUnitId: kDebugMode ? kTestRewardedInterstitialAdUnitId : kRewardedInterstitialAdUnitId,
      request: const AdRequest(),
      rewardedInterstitialAdLoadCallback: RewardedInterstitialAdLoadCallback(
        onAdLoaded: (ad) {
          _rewardedInterstitialAd = ad;
          _loadingRewardedInterstitial = false;
          _rewardedInterstitialRetryCount = 0;
        },
        onAdFailedToLoad: (error) {
          debugPrint('RewardedInterstitialAd failed to load: $error');
          _loadingRewardedInterstitial = false;
          _rewardedInterstitialRetryCount++;
          final retryDelay = Duration(seconds: (2 * _rewardedInterstitialRetryCount).clamp(2, 60));
          Future.delayed(retryDelay, () {
            _loadRewardedInterstitialAd();
          });
        },
      ),
    );
  }

  Future<bool> showRewardedInterstitialAd() async {
    if (!_supportsAds) {
      return false;
    }

    if (_rewardedInterstitialAd == null && !_loadingRewardedInterstitial) {
      _loadRewardedInterstitialAd();
    }

    if (_rewardedInterstitialAd == null && _loadingRewardedInterstitial) {
      int elapsedMs = 0;
      while (_rewardedInterstitialAd == null && _loadingRewardedInterstitial && elapsedMs < 5000) {
        await Future.delayed(const Duration(milliseconds: 200));
        elapsedMs += 200;
      }
    }

    final ad = _rewardedInterstitialAd;
    if (ad == null) {
      return false;
    }

    _rewardedInterstitialAd = null;
    final completer = Completer<bool>();
    var adShown = false;

    ad.fullScreenContentCallback = FullScreenContentCallback(
      onAdShowedFullScreenContent: (_) {
        adShown = true;
      },
      onAdDismissedFullScreenContent: (shownAd) {
        shownAd.dispose();
        _loadRewardedInterstitialAd();
        if (!completer.isCompleted) {
          completer.complete(adShown);
        }
      },
      onAdFailedToShowFullScreenContent: (shownAd, error) {
        shownAd.dispose();
        _loadRewardedInterstitialAd();
        if (!completer.isCompleted) {
          completer.complete(false);
        }
      },
    );

    ad.show(
      onUserEarnedReward: (_, reward) {
        // Log or process reward earned
      },
    );

    return completer.future.timeout(
      const Duration(seconds: 45),
      onTimeout: () {
        _loadRewardedInterstitialAd();
        return adShown;
      },
    );
  }
}
