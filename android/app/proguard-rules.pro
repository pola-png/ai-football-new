# Optimization & Obfuscation settings
-repackageclasses ''
-allowaccessmodification

# Strip deprecated Android 15 Window color calls in release R8 pass
-assumenosideeffects class android.view.Window {
    public void setStatusBarColor(int);
    public void setNavigationBarColor(int);
    public void setNavigationBarDividerColor(int);
}

# Flutter Activity & Engine
-keep class io.flutter.embedding.android.FlutterActivity {
    public <init>(...);
    public void onCreate(android.os.Bundle);
}
-keep class io.flutter.app.FlutterApplication { *; }

# Google Play Billing Library
-keep class com.android.billingclient.api.** { *; }
-dontwarn com.android.billingclient.**
-keep class com.android.vending.billing.** { *; }

# In-App Review & Update
-keep class com.google.android.play.core.review.** { *; }
-keep class com.google.android.play.core.appupdate.** { *; }
-dontwarn com.google.android.play.core.**

# Firebase App Check & Play Integrity
-keep class com.google.firebase.appcheck.** { *; }
-dontwarn com.google.firebase.appcheck.**
-keep class com.google.android.play.core.integrity.** { *; }
-dontwarn com.google.android.play.core.integrity.**
-keep class com.google.android.gms.tasks.** { *; }

# Flutter Local Notifications & Serialization
-keepattributes InnerClasses
-keepattributes Signature
-keepattributes *Annotation*
-dontwarn sun.misc.**
-keepclassmembers,allowobfuscation class * {
  @com.google.gson.annotations.SerializedName <fields>;
}
-keep class com.dexterous.flutterlocalnotifications.** { *; }