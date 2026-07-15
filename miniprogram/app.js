const { PUBLIC_ORIGIN } = require("./config");

App({
  globalData: {
    publicBase: `${PUBLIC_ORIGIN}/`,
  },
});
