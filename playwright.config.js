"use strict";

module.exports = {
  testDir: "./test",
  timeout: 30000,
  retries: 0,
  use: {
    browserName: "chromium",
    headless: true,
    launchOptions: {
      args: [
        "--use-gl=angle",
        "--use-angle=swiftshader",
        "--enable-unsafe-swiftshader",
      ],
    },
  },
};
