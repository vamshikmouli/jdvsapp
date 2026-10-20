module.exports = function (api) {
  api.cache(true);
  return {
    presets: [
      ['babel-preset-expo', { jsxImportSource: 'nativewind' }],
      'nativewind/babel',
    ],
    // Note: babel-preset-expo auto-adds react-native-reanimated/plugin when the
    // package is installed, so we don't list it manually (avoids double-apply).
  };
};
