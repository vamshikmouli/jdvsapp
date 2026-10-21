const { withGradleProperties } = require('@expo/config-plugins');

/**
 * Build only the arm64-v8a ABI. The default universal APK bundles native code for
 * 4 architectures (arm64-v8a, armeabi-v7a, x86, x86_64), which is ~4x the native
 * size. arm64-v8a covers essentially every Android phone from the last several
 * years, so restricting to it roughly halves the sideload APK size.
 *
 * (For Play Store delivery this isn't needed — the store splits per-device — but
 * for direct-install APKs it's the biggest single size win.)
 */
module.exports = function withArm64Only(config) {
  return withGradleProperties(config, (cfg) => {
    cfg.modResults = cfg.modResults.filter(
      (item) => !(item.type === 'property' && item.key === 'reactNativeArchitectures'),
    );
    cfg.modResults.push({
      type: 'property',
      key: 'reactNativeArchitectures',
      value: 'arm64-v8a',
    });
    return cfg;
  });
};
