import { defineConfig, type Plugin } from 'vite';

/** Dev only: phones on ?debug POST frame stats here so they show up in the server log. */
const perfLog = (): Plugin => ({
  name: 'perf-log',
  apply: 'serve',
  configureServer(server) {
    server.middlewares.use('/__perf', (req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        console.log(`[perf] ${body}`);
        res.statusCode = 204;
        res.end();
      });
    });
  },
});

export default defineConfig({
  // Relative base so the build works under GitHub Pages' /coin-pusher/ path.
  base: './',
  plugins: [perfLog()],
  server: { host: true },
  build: { chunkSizeWarningLimit: 1200 },
});
