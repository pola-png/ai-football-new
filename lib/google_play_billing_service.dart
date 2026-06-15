import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:in_app_purchase/in_app_purchase.dart';
import 'package:shared_preferences/shared_preferences.dart';

enum SubscriptionPlanId { basic, standard, premium }

extension SubscriptionPlanIdX on SubscriptionPlanId {
  String get productId => switch (this) {
    SubscriptionPlanId.basic => 'basic_monthly',
    SubscriptionPlanId.standard => 'standard_monthly',
    SubscriptionPlanId.premium => 'premium_monthly',
  };

  String get title => switch (this) {
    SubscriptionPlanId.basic => 'Basic',
    SubscriptionPlanId.standard => 'Standard',
    SubscriptionPlanId.premium => 'Premium',
  };

  String get fallbackPrice => switch (this) {
    SubscriptionPlanId.basic => r'$2.99',
    SubscriptionPlanId.standard => r'$9.99',
    SubscriptionPlanId.premium => r'$50.00',
  };

  String get subtitle => switch (this) {
    SubscriptionPlanId.basic => 'For casual followers',
    SubscriptionPlanId.standard => 'For regular users',
    SubscriptionPlanId.premium => 'For full access and priority',
  };
}

class GooglePlayBillingService extends ChangeNotifier {
  GooglePlayBillingService._();

  static final GooglePlayBillingService instance = GooglePlayBillingService._();

  static const String _ownedProductsKey = 'owned_subscription_products';

  final InAppPurchase _inAppPurchase = InAppPurchase.instance;
  final Set<String> _ownedProductIds = <String>{};
  final Set<String> _availableProductIds = <String>{
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
  bool get hasAdFreeAccess => _ownedProductIds.isNotEmpty;

  SubscriptionPlanId? get activePlan {
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
      throw StateError('Product details have not finished loading.');
    }

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
    if (response.error != null) {
      throw StateError(response.error!.message);
    }

    _productsById
      ..clear()
      ..addEntries(
        response.productDetails.map((product) => MapEntry(product.id, product)),
      );
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
    if (didAdd) {
      _preferences?.setStringList(
        _ownedProductsKey,
        _ownedProductIds.toList()..sort(),
      );
    }
  }

  void _restoreLocalPurchases() {
    final saved =
        _preferences?.getStringList(_ownedProductsKey) ?? const <String>[];
    _ownedProductIds
      ..clear()
      ..addAll(saved.where(_availableProductIds.contains));
  }
}
