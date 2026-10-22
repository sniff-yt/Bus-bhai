#!/bin/bash
# Builds Bus Bhai Hyderabad APK without Gradle.
# Needs: default-jdk, aapt, zipalign, apksigner (apt); ~/sdk/android-34/android.jar; ~/sdk/r8.jar
set -e
: "${KS_PASS:?Set KS_PASS to your keystore password}"
cd "$(dirname "$0")"
SDK=$HOME/sdk; AJ=$SDK/android-34/android.jar
VC=${VC:-1}; VN=${VN:-1.0.0}
OUT=BusBhaiHyderabad-v$VN.apk
rm -rf build && mkdir -p build/gen build/obj build/dex
aapt package -f -m -J build/gen -M AndroidManifest.xml -S res -A assets -I $AJ \
  --min-sdk-version 24 --target-sdk-version 34 --version-code $VC --version-name $VN \
  -F build/unsigned.apk
javac -nowarn -source 8 -target 8 -bootclasspath $AJ -encoding UTF-8 -d build/obj $(find src build/gen -name '*.java') 2>&1 | grep -v "warning:" || true
ls build/obj/com/jashank/hydbus/MainActivity.class >/dev/null
java -cp $SDK/r8.jar com.android.tools.r8.D8 --release --min-api 24 --lib $AJ --output build/dex $(find build/obj -name '*.class')
(cd build/dex && zip -q -u ../unsigned.apk classes.dex)
zipalign -f -p 4 build/unsigned.apk build/aligned.apk
[ -f release.jks ] || keytool -genkeypair -keystore release.jks -alias hydbus -keyalg RSA -keysize 2048 -validity 10000 \
  -storepass $KS_PASS -keypass $KS_PASS -dname "CN=Jashankreddy Reddy, O=Bus Bhai, L=Hyderabad, C=IN"
apksigner sign --ks release.jks --ks-key-alias hydbus --ks-pass pass:$KS_PASS --key-pass pass:$KS_PASS \
  --min-sdk-version 24 --out $OUT build/aligned.apk
apksigner verify --verbose $OUT | head -5 && ls -la $OUT
