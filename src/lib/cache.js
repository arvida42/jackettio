import sqlite3 from 'sqlite3';
import sqliteStore from 'cache-manager-sqlite';
import cacheManager from 'cache-manager';
import config from './config.js';
import {wait} from './util.js';

const db = new sqlite3.Database(`${config.dataFolder}/cache.db`);

const cache = await cacheManager.caching({
  store: sqliteStore,
  path: `${config.dataFolder}/cache.db`,
  options: { ttl: 86400 }
});

export default cache;

export async function clean(){
  // https://github.com/maxpert/node-cache-manager-sqlite/blob/36a1fe44a30b6af8d8c323c59e09fe81bde539d9/index.js#L146
  // The cache will grow until an expired key is requested
  // This hack should force node-cache-manager-sqlite to purge
  await cache.set('_clean', 'todo', {ttl: 1});
  await wait(3e3);
  await cache.get('_clean');
}

export async function vacuum(){
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      db.run('VACUUM', err => {
        if(err)return reject(err);
        resolve();
      })
    });
  });
}