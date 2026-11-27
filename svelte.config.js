import adapter from '@sveltejs/adapter-vercel';

/** @type {import('@sveltejs/kit').Config} */
const config = {
  kit: {
    // Explicit runtime keeps the build portable across Node 18/20/22 CI images.
    adapter: adapter({ runtime: 'nodejs20.x' })
  }
};

export default config;
