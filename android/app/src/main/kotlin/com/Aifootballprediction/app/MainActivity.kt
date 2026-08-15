package com.Aifootballprediction.app

import android.os.Build
import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.widget.Button
import android.widget.ImageView
import android.widget.TextView
import androidx.core.view.WindowCompat
import com.google.android.gms.ads.nativead.MediaView
import com.google.android.gms.ads.nativead.NativeAd
import com.google.android.gms.ads.nativead.NativeAdView
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugins.googlemobileads.GoogleMobileAdsPlugin
import io.flutter.plugins.googlemobileads.GoogleMobileAdsPlugin.NativeAdFactory

class MainActivity : FlutterActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.VANILLA_ICE_CREAM) {
            WindowCompat.setDecorFitsSystemWindows(window, false)
        }
        super.onCreate(savedInstanceState)
    }

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)

        val factory = NativeAdFactory { nativeAd, _ ->
            val inflater = LayoutInflater.from(context)
            val adView = inflater.inflate(R.layout.native_ad_list_tile, null) as NativeAdView

            // Bind Headline
            val headlineView = adView.findViewById<TextView>(R.id.ad_headline)
            headlineView.text = nativeAd.headline
            adView.headlineView = headlineView

            // Bind Body
            val bodyView = adView.findViewById<TextView>(R.id.ad_body)
            bodyView.text = nativeAd.body
            adView.bodyView = bodyView

            // Bind Call to Action
            val callToActionView = adView.findViewById<Button>(R.id.ad_call_to_action)
            callToActionView.text = nativeAd.callToAction
            adView.callToActionView = callToActionView

            // Bind Icon
            val iconView = adView.findViewById<ImageView>(R.id.ad_app_icon)
            if (nativeAd.icon != null) {
                iconView.setImageDrawable(nativeAd.icon?.drawable)
                iconView.visibility = View.VISIBLE
            } else {
                iconView.visibility = View.GONE
            }
            adView.iconView = iconView

            // Bind Advertiser
            val advertiserView = adView.findViewById<TextView>(R.id.ad_advertiser)
            if (nativeAd.advertiser != null) {
                advertiserView.text = nativeAd.advertiser
                advertiserView.visibility = View.VISIBLE
            } else {
                advertiserView.visibility = View.GONE
            }
            adView.advertiserView = advertiserView

            // Bind MediaView
            val mediaView = adView.findViewById<MediaView>(R.id.ad_media)
            adView.mediaView = mediaView

            adView.setNativeAd(nativeAd)
            adView
        }

        GoogleMobileAdsPlugin.registerNativeAdFactory(flutterEngine, "listTile", factory)
    }

    override fun cleanUpFlutterEngine(flutterEngine: FlutterEngine) {
        super.cleanUpFlutterEngine(flutterEngine)
        GoogleMobileAdsPlugin.unregisterNativeAdFactory(flutterEngine, "listTile")
    }
}
