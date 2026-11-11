// electron-builder afterPack hook: gives the macOS app an "ad-hoc" signature.
// Apple Silicon refuses to run (or says "damaged") an app with no signature at all; an ad-hoc one is free and fixes that.
// (Not the same as Apple notarization: people still right-click > Open the first time.)
'use strict';
const { execFileSync } = require('child_process');
const path = require('path');
exports.default = async function (context) {
  if (context.electronPlatformName !== 'darwin') return;
  const app = path.join(context.appOutDir, context.packager.appInfo.productFilename + '.app');
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', '--timestamp=none', app], { stdio: 'inherit' });
  execFileSync('codesign', ['--verify', '--deep', '--strict', app], { stdio: 'inherit' });
  console.log('ad-hoc signed', app);
};
