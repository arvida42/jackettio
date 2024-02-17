export default {
  port: parseInt(process.env.PORT || 4000),
  jackettUrl: process.env.JACKETT_URL || 'http://localhost:9117',
  jackettApiKey: process.env.JACKETT_API_KEY || '',
  tmdbApiKey: process.env.TMDB_API_KEY || '',
  // scrapeInterval: Math.max(3600, parseInt(process.env.SCRAPE_INTERVAL || 3600*12)),
  // scrapeEnabled: (process.env.SCRAPE_ENABLED || '') === 'true',
  dataFolder: process.env.DATA_FOLDER || '/tmp',
  localtunnel: (process.env.LOCALTUNNEL || '') === 'true',
  addonId: process.env.ADDON_ID || 'community.stremio.jackettio',
  defaultUserConfig: {
    qualities: [0, 720, 1080],
    excludeKeywords: [],
    maxTorrents: 8,
    priotizePackTorrents: 2,
    sortCached: [['quality', true], ['size', true]],
    sortUncached: [['seeders', true]]
  },
  qualities: [
    {value: 0, label: 'Unknown'},
    {value: 360, label: '360p'},
    {value: 480, label: '480p'},
    {value: 720, label: '720p'},
    {value: 1080, label: '1080p'},
    {value: 2160, label: '4K'}
  ],
  sorts: [
    {value: [['quality', true], ['seeders', true]], label: 'By quality then seeders'},
    {value: [['quality', true], ['size', true]], label: 'By quality then size'},
    {value: [['seeders', true]], label: 'By seeders'},
    {value: [['quality', true]], label: 'By quality'},
    {value: [['size', true]], label: 'By size'}
  ]
}