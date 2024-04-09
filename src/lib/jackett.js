import crypto from 'crypto';
import {Parser} from "xml2js";
import config from './config.js';
import cache from './cache.js';
import {numberPad, parseWords} from './util.js';

export const CATEGORY = {
  MOVIE: 2000,
  SERIES: 5000
};

export async function searchMovieTorrents({indexer, name, year}){

  indexer = indexer || 'all';
  const cacheKey = `jackettItems:2:movie:${indexer}:${name}:${year}`;
  let items = await cache.get(cacheKey);

  if(!items){
    const res = await jackettApi(
      `/api/v2.0/indexers/${indexer}/results/torznab/api`,
      {t: 'movie',q: name, year: year}
    );
    items = res?.rss?.channel?.item || [];
    cache.set(cacheKey, items, {ttl: items.length > 0 ? 3600*36 : 60});
  }

  return normalizeItems(items);

}

export async function searchSerieTorrents({indexer, name, year}){

  indexer = indexer || 'all';
  const cacheKey = `jackettItems:2:serie:${indexer}:${name}:${year}`;
  let items = await cache.get(cacheKey);

  if(!items){
    const res = await jackettApi(
      `/api/v2.0/indexers/${indexer}/results/torznab/api`,
      {t: 'tvsearch',q: `${name}`}
    );
    items = res?.rss?.channel?.item || [];
    cache.set(cacheKey, items, {ttl: items.length > 0 ? 3600*36 : 60});
  }

  return normalizeItems(items);

}

export async function searchSeasonTorrents({indexer, name, year, season}){

  indexer = indexer || 'all';
  const cacheKey = `jackettItems:2:season:${indexer}:${name}:${year}:${season}`;
  let items = await cache.get(cacheKey);

  if(!items){
    const res = await jackettApi(
      `/api/v2.0/indexers/${indexer}/results/torznab/api`,
      {t: 'tvsearch',q: `${name} S${numberPad(season)}`}
    );
    items = res?.rss?.channel?.item || [];
    cache.set(cacheKey, items, {ttl: items.length > 0 ? 3600*36 : 60});
  }

  return normalizeItems(items);

}

export async function searchEpisodeTorrents({indexer, name, year, season, episode}){

  indexer = indexer || 'all';
  const cacheKey = `jackettItems:2:episode:${indexer}:${name}:${year}:${season}:${episode}`;
  let items = await cache.get(cacheKey);

  if(!items){
    const res = await jackettApi(
      `/api/v2.0/indexers/${indexer}/results/torznab/api`,
      {t: 'tvsearch',q: `${name} S${numberPad(season)}E${numberPad(episode)}`}
    );
    items = res?.rss?.channel?.item || [];
    cache.set(cacheKey, items, {ttl: items.length > 0 ? 3600*36 : 60});
  }

  return normalizeItems(items);

}

export async function getIndexers(){

  const res = await jackettApi(
    '/api/v2.0/indexers/all/results/torznab/api',
    {t: 'indexers', configured: 'true'}
  );

  return normalizeIndexers(res?.indexers?.indexer || []);

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
  return forceArray(items).map(item => {
    item = mergeDollarKeys(item);
    const attr = item['torznab:attr'].reduce((obj, item) => {
      obj[item.name] = item.value;
      return obj;
    }, {});
    const quality = item.title.match(/(2160|1080|720|480|360)p/);
    const title = parseWords(item.title).join(' ');
    return {
      name: item.title,
      guid: item.guid,
      indexerId: item.jackettindexer.id,
      id: crypto.createHash('sha1').update(item.guid).digest('hex'),
      size: parseInt(item.size),
      link: item.link,
      seeders: parseInt(attr.seeders || 0),
      peers: parseInt(attr.peers || 0),
      infoHash: attr.infohash || '',
      magneturl: attr.magneturl || '', 
      type: item.type,
      quality: quality ? parseInt(quality[1]) : 0,
      languages: config.languages.filter(lang => title.match(lang.pattern))
    };
  });
}

function normalizeIndexers(items){
  return forceArray(items).map(item => {
    item = mergeDollarKeys(item);
    const searching = item.caps.searching;
    return {
      id: item.id,
      configured: item.configured == 'true',
      title: item.title,
      language: item.language,
      type: item.type,
      categories: forceArray(item.caps.categories.category).map(category => parseInt(category.id)),
      searching: {
        movie: {
          available: searching['movie-search'].available == 'yes', 
          supportedParams: searching['movie-search'].supportedParams.split(',')
        },
        series: {
          available: searching['tv-search'].available == 'yes', 
          supportedParams: searching['tv-search'].supportedParams.split(',')
        }
      }
    };
  });
}

function mergeDollarKeys(item){
  if(item.$){
    item = {...item.$, ...item};
    delete item.$;
  }
  for(let key in item){
    if(typeof(item[key]) === 'object'){
      item[key] = mergeDollarKeys(item[key]);
    }
  }
  return item;
}

function forceArray(value){
  return Array.isArray(value) ? value : [value];
}
