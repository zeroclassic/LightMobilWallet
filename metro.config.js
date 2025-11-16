const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

const defaultConfig = getDefaultConfig(__dirname);

const config = {
  resolver: {
    extraNodeModules: {
		buffer: require.resolve("buffer"),
		process: require.resolve("process/browser"),
		util: require.resolve("util"),
		crypto: require.resolve("crypto-browserify"),
		stream: require.resolve("stream-browserify"),
		events: require.resolve("events"),
		"readable-stream": require.resolve("readable-stream"),
    },
  },
};

module.exports = mergeConfig(defaultConfig, config);