import crypto from 'crypto';
import {Parser} from "xml2js";
import config from './config.js';
import cache from './cache.js';
import {numberPad} from './util.js';

export async function searchMovieTorrents({name, year}){

  let items = await cache.get(`jackettItems:movie:${name}:${year}`);

  if(!items){
    const res = await jackettApi(
      '/api/v2.0/indexers/all/results/torznab/api',
      {t: 'movie',q: name, year: year}
    );
    items = normalizeItems(res?.rss?.channel?.item || []);
    cache.set(`jackettItems:movie:${name}:${year}`, items, {ttl: items.length > 0 ? 3600*36 : 60});
  }

  return items;

}

export async function searchSeasonTorrents({name, year, season}){

  let items = await cache.get(`jackettItems:season:${name}:${year}:${season}`);

  if(!items){
    const res = await jackettApi(
      '/api/v2.0/indexers/all/results/torznab/api',
      {t: 'tvsearch',q: `${name} S${numberPad(season)}`}
    );
    items = normalizeItems(res?.rss?.channel?.item || []);
    cache.set(`jackettItems:season:${name}:${year}:${season}`, items, {ttl: items.length > 0 ? 3600*36 : 60});
  }

  return items;

}

export async function searchEpisodeTorrents({name, year, season, episode}){

  let items = await cache.get(`jackettItems:episode:${name}:${year}:${season}:${episode}`);

  if(!items){
    const res = await jackettApi(
      '/api/v2.0/indexers/all/results/torznab/api',
      {t: 'tvsearch',q: `${name} S${numberPad(season)}E${numberPad(episode)}`}
    );
    items = normalizeItems(res?.rss?.channel?.item || []);
    cache.set(`jackettItems:episode:${name}:${year}:${season}:${episode}`, items, {ttl: items.length > 0 ? 3600*36 : 60});
  }

  return items;

}

export async function getIndexers(){

  const res = await jackettApi(
    '/api/v2.0/indexers/all/results/torznab/api',
    {t: 'indexers', configured: 'true'}
  );

  const indexers = res?.indexers?.indexer || [];

  return indexers.title ? [indexers] : indexers;

}

async function jackettApi(path, query){

  const params = new URLSearchParams(query || {});
  params.set('apikey', config.jackettApiKey);

  const url = `${config.jackettUrl}${path}?${params.toString()}`;

  let data;
  const res = await fetch(url);
  if(res.headers.get('content-type').includes('application/json')){
    data = await res.json();
  }else{
    const text = await res.text();
    const parser = new Parser({explicitArray: false, ignoreAttrs: false});
    data = await parser.parseStringPromise(text);
  }

  if(data.error){
    throw new Error(`jackettApi: ${url.replace(/apikey=[a-z0-9\-]+/, 'apikey=****')} : ${data.error?.$?.description || data.error}`);
  }

  return data;

}

function normalizeItems(items){
  if(items.guid)items = [items];
  return items.map(item => {
    const attr = item['torznab:attr'].reduce((obj, item) => {
      obj[item.$.name] = item.$.value;
      return obj;
    }, {});
    const quality = item.title.match(/(2160|1080|720|480|360)p/);
    return {
      name: item.title,
      guid: item.guid,
      id: crypto.createHash('sha1').update(item.guid).digest('hex'),
      size: parseInt(item.size),
      link: item.link,
      seeders: parseInt(attr.seeders || 0),
      peers: parseInt(attr.peers || 0),
      type: item.type,
      quality: quality ? parseInt(quality[1]) : 0
    };
  });
}

