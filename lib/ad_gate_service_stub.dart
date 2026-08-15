class AdGateService {
  AdGateService._();

  static final AdGateService instance = AdGateService._();

  Future<void> initialize() async {}

  Future<bool> showRewardedAd() async => false;

  Future<bool> showInterstitialAd() async => false;

  Future<void> showAppOpenAdIfAvailable() async {}

  Future<bool> showRewardedInterstitialAd() async => false;
}
