/**
 * The app's Babel settings: Expo's own preset, plus one rewrite that Hermes (the app's
 * JavaScript engine) needs for oRPC's client code. Hermes can't compile destructuring inside a
 * rest parameter (`async (...[input, options = {}]) => …`), so oRPC's files get their function
 * parameters rewritten into a form it reads. Only oRPC's files: the rewrite adds code.
 */
module.exports = (api) => {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    overrides: [
      {
        // A function, not a pattern: Metro also loads this file without a file name.
        test: (file) => typeof file === 'string' && /[\\/]node_modules[\\/]@orpc[\\/]/.test(file),
        plugins: ['@babel/plugin-transform-parameters'],
      },
    ],
  };
};
