import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:in_app_purchase/in_app_purchase.dart';
import 'package:shared_preferences/shared_preferences.dart';

enum SubscriptionPlanId { weeklyAdFree, basic, standard, premium }

extension SubscriptionPlanIdX on SubscriptionPlanId {
  String get productId => switch (this) {
    SubscriptionPlanId.weeklyAdFree => 'ad_free_7_days',
    SubscriptionPlanId.basic => 'basic_monthly',
    SubscriptionPlanId.standard => 'standard_monthly',
    SubscriptionPlanId.premium => 'premium_monthly',
  };

  String get title => switch (this) {
    SubscriptionPlanId.weeklyAdFree => 'Ad Free 7 Days',
    SubscriptionPlanId.basic => 'Basic',
    SubscriptionPlanId.standard => 'Standard',
    SubscriptionPlanId.premium => 'Premium',
  };

  String get fallbackPrice => switch (this) {
    SubscriptionPlanId.weeklyAdFree => r'$1.20',
    SubscriptionPlanId.basic => r'$2.99',
    SubscriptionPlanId.standard => r'$9.99',
    SubscriptionPlanId.premium => r'$50.00',
  };

  String get subtitle => switch (this) {
    SubscriptionPlanId.weeklyAdFree => 'Ad free for 7 days',
    SubscriptionPlanId.basic => 'For casual followers',
    SubscriptionPlanId.standard => 'For regular users',
    SubscriptionPlanId.premium => 'For full access and priority',
  };
}

class GooglePlayBillingService extends ChangeNotifier {
  GooglePlayBillingService._();

  static final GooglePlayBillingService instance = GooglePlayBillingService._();

  static const String _ownedProductsKey = 'owned_subscription_products';
  static const String _weeklyAdFreeExpiresAtKey = 'weekly_ad_free_expires_at';

  final InAppPurchase _inAppPurchase = InAppPurchase.instance;
  final Set<String> _ownedProductIds = <String>{};
  final Set<String> _availableProductIds = <String>{
    SubscriptionPlanId.weeklyAdFree.productId,
    SubscriptionPlanId.basic.productId,
    SubscriptionPlanId.standard.productId,
    SubscriptionPlanId.premium.productId,
  };

  StreamSubscription<List<PurchaseDetails>>? _purchaseSubscription;
  SharedPreferences? _preferences;
  bool _initialized = false;
  bool _available = false;
  bool _loading = true;
  String? _errorMessage;
  final Map<String, ProductDetails> _productsById = <String, ProductDetails>{};

  bool get isAvailable => _available;
  bool get isLoading => _loading;
  String? get errorMessage => _errorMessage;
  // Only non-weeklyAdFree plans suppress rewarded ads (banner ads always show).
  bool get hasAdFreeAccess {
    _refreshWeeklyAdFreeState();
    return _ownedProductIds.any(
      (id) => id != SubscriptionPlanId.weeklyAdFree.productId,
    );
  }

  // weeklyAdFree plan only removes the rewarded-ad gate, not banner ads.
  bool get hasRewardedAdFreeAccess {
    _refreshWeeklyAdFreeState();
    return _ownedProductIds.isNotEmpty;
  }

  SubscriptionPlanId? get activePlan {
    _refreshWeeklyAdFreeState();
    if (_ownedProductIds.contains(SubscriptionPlanId.weeklyAdFree.productId)) {
      return SubscriptionPlanId.weeklyAdFree;
    }
    if (_ownedProductIds.contains(SubscriptionPlanId.premium.productId)) {
      return SubscriptionPlanId.premium;
    }
    if (_ownedProductIds.contains(SubscriptionPlanId.standard.productId)) {
      return SubscriptionPlanId.standard;
    }
    if (_ownedProductIds.contains(SubscriptionPlanId.basic.productId)) {
      return SubscriptionPlanId.basic;
    }
    return null;
  }

  List<SubscriptionPlanId> get plans => SubscriptionPlanId.values;

  ProductDetails? productFor(SubscriptionPlanId plan) {
    return _productsById[plan.productId];
  }

  bool isOwned(SubscriptionPlanId plan) {
    _refreshWeeklyAdFreeState();
    if (plan == SubscriptionPlanId.weeklyAdFree) {
      return _ownedProductIds.contains(plan.productId);
    }
    return _ownedProductIds.contains(plan.productId);
  }

  Future<void> initialize() async {
    if (_initialized) {
      return;
    }
    _initialized = true;

    _preferences = await SharedPreferences.getInstance();
    _restoreLocalPurchases();

    try {
      _available = await _inAppPurchase.isAvailable();
      if (_available) {
        _purchaseSubscription = _inAppPurchase.purchaseStream.listen(
          _handlePurchaseUpdates,
          onError: (Object error, StackTrace stackTrace) {
            debugPrint('Purchase stream error: $error');
          },
        );
        await _loadProducts();
        await _inAppPurchase.restorePurchases();
      }
    } catch (error) {
      _errorMessage = error.toString();
      debugPrint('Billing init failed: $error');
    } finally {
      _loading = false;
      notifyListeners();
    }
  }

  Future<void> purchase(SubscriptionPlanId plan) async {
    if (!_available) {
      throw StateError('Google Play billing is not available on this device.');
    }

    final product = _productsById[plan.productId];
    if (product == null) {
      throw StateError(
        'Product "${plan.productId}" not found. Make sure it is published and active in Google Play Console.',
      );
    }

    // All plans are subscriptions — use buyNonConsumable which the
    // in_app_purchase plugin maps to launchBillingFlow for subscriptions on Android.
    final purchaseParam = PurchaseParam(productDetails: product);
    await _inAppPurchase.buyNonConsumable(purchaseParam: purchaseParam);
  }

  Future<void> restorePurchases() async {
    if (!_available) {
      return;
    }
    await _inAppPurchase.restorePurchases();
  }

  Future<void> disposeService() async {
    await _purchaseSubscription?.cancel();
    _purchaseSubscription = null;
  }

  Future<void> _loadProducts() async {
    final response = await _inAppPurchase.queryProductDetails(
      _availableProductIds,
    );

    // Log not-found products to help diagnose mismatched IDs
    if (response.notFoundIDs.isNotEmpty) {
      debugPrint(
        'Play Store products NOT found: ${response.notFoundIDs.join(', ')}. '
        'Check that the product IDs are Active in Play Console and the app '
        'is published to at least the Internal Testing track.',
      );
      _errorMessage =
          'Some products were not found in the Play Store: '
          '${response.notFoundIDs.join(', ')}. '
          'Make sure each product ID is Active in Play Console.';
    }

    if (response.error != null) {
      throw StateError(response.error!.message);
    }

    _productsById
      ..clear()
      ..addEntries(
        response.productDetails.map((product) => MapEntry(product.id, product)),
      );

    debugPrint('Play Store products loaded: ${_productsById.keys.join(', ')}');
  }

  void _handlePurchaseUpdates(List<PurchaseDetails> purchaseDetailsList) {
    for (final purchaseDetails in purchaseDetailsList) {
      if (purchaseDetails.status == PurchaseStatus.pending) {
        _loading = true;
        notifyListeners();
        continue;
      }

      if (purchaseDetails.status == PurchaseStatus.purchased ||
          purchaseDetails.status == PurchaseStatus.restored) {
        _markOwned(purchaseDetails.productID);
        if (purchaseDetails.pendingCompletePurchase) {
          _inAppPurchase.completePurchase(purchaseDetails);
        }
        continue;
      }

      if (purchaseDetails.status == PurchaseStatus.error) {
        _errorMessage = purchaseDetails.error?.message ?? 'Purchase failed.';
        debugPrint('Purchase error: $_errorMessage');
        if (purchaseDetails.pendingCompletePurchase) {
          _inAppPurchase.completePurchase(purchaseDetails);
        }
      }

      if (purchaseDetails.status == PurchaseStatus.canceled) {
        debugPrint('Purchase cancelled by user: ${purchaseDetails.productID}');
      }
    }

    _loading = false;
    notifyListeners();
  }

  void _markOwned(String productId) {
    if (!_availableProductIds.contains(productId)) {
      return;
    }

    final didAdd = _ownedProductIds.add(productId);
    if (productId == SubscriptionPlanId.weeklyAdFree.productId && didAdd) {
      _preferences?.setString(
        _weeklyAdFreeExpiresAtKey,
        DateTime.now()
            .add(const Duration(days: 7))
            .toUtc()
            .toIso8601String(),
      );
    }
    if (didAdd) {
      _persistOwnedProducts();
    }
  }

  void _restoreLocalPurchases() {
    final saved =
        _preferences?.getStringList(_ownedProductsKey) ?? const <String>[];
    _ownedProductIds
      ..clear()
      ..addAll(saved.where(_availableProductIds.contains));
    _refreshWeeklyAdFreeState();
  }

  void _persistOwnedProducts() {
    _preferences?.setStringList(
      _ownedProductsKey,
      _ownedProductIds.toList()..sort(),
    );
  }

  void _refreshWeeklyAdFreeState() {
    if (!_ownedProductIds.contains(SubscriptionPlanId.weeklyAdFree.productId)) {
      return;
    }

    final expiryText = _preferences?.getString(_weeklyAdFreeExpiresAtKey);
    final expiry = expiryText == null ? null : DateTime.tryParse(expiryText);
    final now = DateTime.now().toUtc();

    if (expiry == null || !expiry.isAfter(now)) {
      _ownedProductIds.remove(SubscriptionPlanId.weeklyAdFree.productId);
      _preferences?.remove(_weeklyAdFreeExpiresAtKey);
      _persistOwnedProducts();
    }
  }
}
