import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:google_mobile_ads/google_mobile_ads.dart';

import 'ad_config.dart';

class FeedNativeAd extends StatefulWidget {
  const FeedNativeAd({super.key});

  @override
  State<FeedNativeAd> createState() => _FeedNativeAdState();
}

class _FeedNativeAdState extends State<FeedNativeAd> {
  NativeAd? _nativeAd;
  bool _isAdLoaded = false;

  bool get _supportsAds =>
      !kIsWeb && defaultTargetPlatform == TargetPlatform.android;

  @override
  void initState() {
    super.initState();
    _loadNativeAd();
  }

  @override
  void dispose() {
    _nativeAd?.dispose();
    super.dispose();
  }

  void _loadNativeAd() {
    if (!_supportsAds) {
      return;
    }

    _nativeAd = NativeAd(
      adUnitId: kReleaseMode ? kNativeAdUnitId : kTestNativeAdUnitId,
      factoryId: 'listTile',
      request: const AdRequest(),
      listener: NativeAdListener(
        onAdLoaded: (ad) {
          setState(() {
            _isAdLoaded = true;
          });
        },
        onAdFailedToLoad: (ad, error) {
          debugPrint('NativeAd failed to load: $error');
          ad.dispose();
        },
      ),
    );

    _nativeAd!.load();
  }

  @override
  Widget build(BuildContext context) {
    if (!_supportsAds || !_isAdLoaded || _nativeAd == null) {
      return const SizedBox.shrink();
    }

    final isDark = Theme.of(context).brightness == Brightness.dark;

    return Container(
      width: double.infinity,
      height: 280,
      margin: const EdgeInsets.symmetric(vertical: 8),
      decoration: BoxDecoration(
        color: isDark ? const Color(0xFF121B2E) : Colors.white,
        borderRadius: BorderRadius.circular(24),
        border: Border.all(
          color: isDark
              ? const Color(0xFF1F2E4A).withValues(alpha: 0.8)
              : const Color(0xFFE2E8F0),
          width: 1.0,
        ),
      ),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(24),
        child: AdWidget(ad: _nativeAd!),
      ),
    );
  }
}
