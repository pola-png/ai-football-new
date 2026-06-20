import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:google_mobile_ads/google_mobile_ads.dart';

import 'ad_config.dart';

class FeedBannerAd extends StatefulWidget {
  const FeedBannerAd({super.key, this.enabled = true});

  final bool enabled;

  @override
  State<FeedBannerAd> createState() => _FeedBannerAdState();
}

class _FeedBannerAdState extends State<FeedBannerAd> {
  BannerAd? _bannerAd;
  bool _loading = false;
  int? _requestedWidth;
  double _bannerHeight = 60;

  bool get _supportsAds =>
      widget.enabled &&
      !kIsWeb &&
      defaultTargetPlatform == TargetPlatform.android;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _maybeLoadBanner();
  }

  @override
  void dispose() {
    _bannerAd?.dispose();
    super.dispose();
  }

  Future<void> _maybeLoadBanner() async {
    if (!_supportsAds || _loading) {
      return;
    }

    final width = MediaQuery.sizeOf(context).width.floor();
    if (width <= 0 || _requestedWidth == width) {
      return;
    }

    _requestedWidth = width;
    _loading = true;

    final adSize =
        await AdSize.getCurrentOrientationAnchoredAdaptiveBannerAdSize(width);
    if (!mounted) {
      return;
    }

    if (adSize == null) {
      setState(() {
        _loading = false;
      });
      return;
    }

    late final BannerAd bannerAd;
    bannerAd = BannerAd(
      adUnitId: kDebugMode ? kTestBannerAdUnitId : kBannerAdUnitId,
      size: adSize,
      request: const AdRequest(),
      listener: BannerAdListener(
        onAdLoaded: (ad) {
          if (!mounted) {
            ad.dispose();
            return;
          }

          setState(() {
            _bannerAd = bannerAd;
            _bannerHeight = adSize.height.toDouble();
            _loading = false;
          });
        },
        onAdFailedToLoad: (ad, error) {
          ad.dispose();
          if (!mounted) {
            return;
          }

          setState(() {
            _loading = false;
            _bannerAd = null;
          });
        },
      ),
    );

    bannerAd.load();
  }

  @override
  Widget build(BuildContext context) {
    if (!_supportsAds) {
      return const SizedBox.shrink();
    }

    final ad = _bannerAd;
    return SizedBox(
      width: double.infinity,
      height: _bannerHeight,
      child: DecoratedBox(
        decoration: const BoxDecoration(color: Color(0xFF0B1626)),
        child: ad == null
            ? const SizedBox.shrink()
            : Align(
                alignment: Alignment.center,
                child: AdWidget(ad: ad),
              ),
      ),
    );
  }
}
