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
    SubscriptionPlanId.weeklyAdFree => 'Basic (7 Days)',
    SubscriptionPlanId.basic => 'Basic',
    SubscriptionPlanId.standard => 'Standard',
    SubscriptionPlanId.premium => 'Premium',
  };

  String get fallbackPrice => switch (this) {
    SubscriptionPlanId.weeklyAdFree => r'$1.99',
    SubscriptionPlanId.basic => r'$4.99',
    SubscriptionPlanId.standard => r'$19.99',
    SubscriptionPlanId.premium => r'$50.00',
  };

  String get subtitle => switch (this) {
    SubscriptionPlanId.weeklyAdFree => '7 days access to predictions',
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

  void clearError() {
    _errorMessage = null;
    notifyListeners();
  }
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

  List<SubscriptionPlanId> get plans {
    return SubscriptionPlanId.values.toList();
  }

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
      await _connectToBilling();
      if (_available) {
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

  Future<void> retryConnection() async {
    _loading = true;
    _errorMessage = null;
    notifyListeners();

    try {
      await _connectToBilling();
      if (_available) {
        await _inAppPurchase.restorePurchases();
      }
    } catch (error) {
      _errorMessage = error.toString();
      debugPrint('Billing retry failed: $error');
    } finally {
      _loading = false;
      notifyListeners();
    }
  }

  Future<void> purchase(SubscriptionPlanId plan) async {
    if (!_available || !_productsById.containsKey(plan.productId)) {
      await retryConnection();
    }

    if (!_available) {
      if (kDebugMode) {
        _markOwned(plan.productId);
        notifyListeners();
        return;
      }
      throw StateError('Google Play billing is not available on this device. Please check your internet connection or Google Play Services.');
    }

    final product = _productsById[plan.productId];
    if (product == null) {
      if (kDebugMode) {
        _markOwned(plan.productId);
        notifyListeners();
        return;
      }
      throw StateError(
        'Product "${plan.productId}" not found in Google Play Store. Please verify base plan is active.',
      );
    }

    // All plans are subscriptions — use buyNonConsumable which the
    // in_app_purchase plugin maps to launchBillingFlow for subscriptions on Android.
    final purchaseParam = PurchaseParam(productDetails: product);
    await _inAppPurchase.buyNonConsumable(purchaseParam: purchaseParam);
  }

  Future<void> restorePurchases() async {
    if (!_available) {
      await _connectToBilling();
    }
    if (_available) {
      await _inAppPurchase.restorePurchases();
    }
  }

  Future<void> disposeService() async {
    await _purchaseSubscription?.cancel();
    _purchaseSubscription = null;
  }

  Future<void> _loadProducts() async {
    try {
      final response = await _inAppPurchase.queryProductDetails(
        _availableProductIds,
      );

      // Log not-found products to help diagnose mismatched IDs
      if (response.notFoundIDs.isNotEmpty) {
        debugPrint(
          'Play Store products NOT found: ${response.notFoundIDs.join(', ')}. '
          'Check that the product IDs are Active in Play Console with active base plans.',
        );
      }

      if (response.error != null) {
        debugPrint('Billing queryProductDetails error: ${response.error!.message}');
        _errorMessage = response.error!.message;
      }

      if (response.productDetails.isNotEmpty) {
        _productsById
          ..clear()
          ..addEntries(
            response.productDetails.map((product) => MapEntry(product.id, product)),
          );
        debugPrint('Play Store products loaded: ${_productsById.keys.join(', ')}');
      }
    } catch (error) {
      debugPrint('Error loading product details: $error');
      _errorMessage = error.toString();
    }
  }

  Future<void> _connectToBilling() async {
    try {
      _errorMessage = null;
      _available = await _inAppPurchase.isAvailable();
      
      // If not immediately available, retry up to 2 times with a short pause
      if (!_available) {
        for (int i = 0; i < 2; i++) {
          await Future<void>.delayed(const Duration(milliseconds: 1500));
          _available = await _inAppPurchase.isAvailable();
          if (_available) break;
        }
      }

      if (!_available) {
        _errorMessage = 'Google Play Billing is not available on this device.';
        return;
      }

      _purchaseSubscription ??= _inAppPurchase.purchaseStream.listen(
        _handlePurchaseUpdates,
        onError: (Object error, StackTrace stackTrace) {
          debugPrint('Purchase stream error: $error');
        },
      );

      await _loadProducts();
    } catch (error) {
      _errorMessage = error.toString();
      debugPrint('Billing connection failed: $error');
    } finally {
      notifyListeners();
    }
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
