import sqliteStore from 'cache-manager-sqlite';
import cacheManager from 'cache-manager';
import config from './config.js';

const cache = await cacheManager.caching({
  store: sqliteStore,
  path: `${config.dataFolder}/cache.db`,
  options: { ttl: 86400 }
});

export default cache;