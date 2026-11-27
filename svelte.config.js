import adapterVercel from '@sveltejs/adapter-vercel';
import adapterStatic from '@sveltejs/adapter-static';

// The APK build targets Capacitor, which needs a real index.html entry point,
// so `BUILD_TARGET=apk` switches to the static SPA adapter and emits build-apk/.
const buildingApk = process.env.BUILD_TARGET === 'apk';

/** @type {import('@sveltejs/kit').Config} */
const config = {
  kit: {
    adapter: buildingApk
      ? adapterStatic({ pages: 'build-apk', assets: 'build-apk', fallback: 'index.html', precompress: false })
      : adapterVercel({ runtime: 'nodejs20.x' })
  }
};

export default config;
