import pLimit from 'p-limit';
import {parseWords, numberPad, sortBy, bytesToSize, wait} from './util.js';
import config from './config.js';
import cache from './cache.js';
import * as meta from './meta.js';
import * as jackett from './jackett.js';
import * as debrid from './debrid.js';
import * as torrentInfos from './torrentInfos.js';

const actionInProgress = {
  getTorrents: {},
  getDownload: {}
};

function parseStremioId(stremioId){
  const [id, season, episode] = stremioId.split(':');
  return {id, season: parseInt(season || 0), episode: parseInt(episode || 0)};
}

async function getMetaInfos(type, stremioId){
  const {id, season, episode} = parseStremioId(stremioId);
  if(type == 'movie'){
    return meta.getMovieById(id);
  }else if(type == 'series'){
    return meta.getEpisodeById(id, season, episode);
  }else{
    throw new Error(`Unsuported type ${type}`);
  }
}

function mergeDefaultUserConfig(userConfig){
  config.immulatableUserConfigKeys.forEach(key => delete userConfig[key]);
  return Object.assign({}, config.defaultUserConfig, userConfig);
}

function priotizeItems(allItems, priotizeItems, max){
  max = max || 0;
  if(typeof(priotizeItems) == 'function'){
    priotizeItems = allItems.filter(priotizeItems);
    if(max > 0)priotizeItems.splice(max);
  }
  if(priotizeItems && priotizeItems.length){
    allItems = allItems.filter(item => !priotizeItems.find(i => i == item));
    allItems.unshift(...priotizeItems);
  }
  return allItems;
}

async function getTorrents(userConfig, metaInfos, debridInstance){

  while(actionInProgress.getTorrents[metaInfos.stremioId]){
    await wait(500);
  }
  actionInProgress.getTorrents[metaInfos.stremioId] = true;

  try {

    const {qualities, excludeKeywords, maxTorrents, sortCached, sortUncached, priotizePackTorrents, priotizeLanguages} = userConfig;
    const {id, season, episode, type, stremioId} = metaInfos;

    let torrents = [];
    let startDate = new Date();

    console.log(`${stremioId} : Searching torrents ...`);

    const sortSearch = [['seeders', true]];
    const filterSearch = (torrent) => {
      if(!qualities.includes(torrent.quality))return false;
      const torrentWords = parseWords(torrent.name.toLowerCase());
      if(excludeKeywords.find(word => torrentWords.includes(word)))return false;
      return true;
    };
    const filterLanguage = (torrent) => {
      if(priotizeLanguages.length == 0)return true;
      return torrent.languages.find(lang => ['multi'].concat(priotizeLanguages).includes(lang.value));
    }

    let indexers = (await jackett.getIndexers());
    let availableIndexers = indexers.filter(indexer => indexer.searching[type].available);
    let userIndexers = availableIndexers.filter(indexer => (userConfig.indexers.includes(indexer.id) || userConfig.indexers.includes('all')));

    if(userIndexers.length){
      indexers = userIndexers;
    }else if(availableIndexers.length){
      console.log(`${stremioId} : User defined indexers "${userConfig.indexers.join(', ')}" not available, fallback to all "${type}" indexers`);
      indexers = availableIndexers;
    }else if(indexers.length){
      console.log(`${stremioId} : User defined indexers "${userConfig.indexers.join(', ')}" or "${type}" indexers not available, fallback to all indexers`);
    }else{
      throw new Error(`${stremioId} : No indexer configured in jackett`);
    }

    console.log(`${stremioId} : ${indexers.length} indexers selected : ${indexers.map(indexer => indexer.title).join(', ')}`);

    if(type == 'movie'){

      const promises = indexers.map(indexer => jackett.searchMovieTorrents({...metaInfos, indexer: indexer.id}).catch(err => []));
      torrents = [].concat(...(await Promise.all(promises)));

      console.log(`${stremioId} : ${torrents.length} torrents found in ${(new Date() - startDate) / 1000}s`);

      torrents = torrents.filter(filterSearch).sort(sortBy(...sortSearch));
      torrents = priotizeItems(torrents, filterLanguage, Math.max(1, Math.round(maxTorrents * 0.33)));
      torrents = torrents.slice(0, maxTorrents + 2);

    }else if(type == 'series'){

      const episodesPromises = indexers.map(indexer => jackett.searchEpisodeTorrents({...metaInfos, indexer: indexer.id}).catch(err => []));
      const packsPromises = indexers.map(indexer => jackett.searchSeasonTorrents({...metaInfos, indexer: indexer.id}).catch(err => []));

      const episodesTorrents = [].concat(...(await Promise.all(episodesPromises))).filter(filterSearch);
      const packsTorrents = [].concat(...(await Promise.all(packsPromises))).filter(torrent => filterSearch(torrent) && parseWords(torrent.name.toUpperCase()).includes(`S${numberPad(season)}`));

      torrents = [].concat(episodesTorrents, packsTorrents);

      console.log(`${stremioId} : ${torrents.length} torrents found in ${(new Date() - startDate) / 1000}s`);

      torrents = torrents.filter(filterSearch).sort(sortBy(...sortSearch));
      torrents = priotizeItems(torrents, filterLanguage, Math.max(1, Math.round(maxTorrents * 0.33)));
      torrents = torrents.slice(0, maxTorrents + 2);

      if(priotizePackTorrents > 0 && packsTorrents.length && !torrents.find(t => packsTorrents.includes(t))){
        const bestPackTorrents = packsTorrents.slice(0, Math.min(packsTorrents.length, priotizePackTorrents));
        torrents.splice(bestPackTorrents.length * -1, bestPackTorrents.length, ...bestPackTorrents);
      }

    }

    console.log(`${stremioId} : ${torrents.length} torrents filtered, get torrents infos ...`);
    startDate = new Date();

    const limit = pLimit(5);
    torrents = await Promise.all(torrents.map(torrent => limit(async () => {

      const startInfosDate = new Date();
      try {

        torrent.infos = await Promise.race([
          torrentInfos.get(torrent),
          wait(33e3).then(() => Promise.reject(new Error(`Torrent infos timeout`)))
        ]);
        return torrent;

      }catch(err){

        console.log(`${stremioId} Failed getting torrent infos for ${torrent.id} from indexer ${torrent.indexerId}`);
        console.log(`${stremioId} ${torrent.link.replace(/apikey=[a-z0-9\-]+/, 'apikey=****')}`, err);
        return false;

      }finally{

        const duration = new Date() - startInfosDate;
        if(duration > 10e3)console.log(`${stremioId} : Slow (${duration / 1000}s) indexer detected (${torrent.indexerId}) when getting torrent infos`);

      }
    })));
    torrents = torrents.filter(torrent => torrent && torrent.infos)
      .filter((torrent, index, items) => items.findIndex(t => t.infos.infoHash == torrent.infos.infoHash) === index)
      .slice(0, maxTorrents);

    console.log(`${stremioId} : ${torrents.length} torrents infos found in ${(new Date() - startDate) / 1000}s`);

    if(torrents.length == 0){
      throw new Error(`No torrent infos for type ${type} and id ${stremioId}`);
    }

    if(debridInstance){

      try {

        const cachedTorrents = (await debridInstance.getTorrentsCached(torrents)).map(torrent => {
          torrent.isCached = true;
          return torrent;
        });
        const uncachedTorrents = torrents.filter(torrent => cachedTorrents.indexOf(torrent) === -1);

        console.log(`${stremioId} : ${cachedTorrents.length} cached torrents on ${debridInstance.shortName}`);

        torrents = [].concat(priotizeItems(cachedTorrents.sort(sortBy(...sortCached)), filterLanguage))
                     .concat(priotizeItems(uncachedTorrents.sort(sortBy(...sortUncached)), filterLanguage));
      
        const progress = await debridInstance.getProgressTorrents(torrents);
        torrents.forEach(torrent => torrent.progress = progress[torrent.infos.infoHash] || null);

      }catch(err){

        console.log(`${stremioId} : ${debridInstance.shortName} : ${err.message || err}`);

      }

    }

    return torrents;

  }finally{

    delete actionInProgress.getTorrents[metaInfos.stremioId];

  }

}

async function prepareNextEpisode(userConfig, metaInfos, debridInstance){

  try {

    const {stremioId} = metaInfos;
    const nextEpisodeIndex = metaInfos.episodes.findIndex(e => e.episode == metaInfos.episode && e.season == metaInfos.season) + 1;
    const nextEpisode = metaInfos.episodes[nextEpisodeIndex] || false;

    if(nextEpisode){

      metaInfos = await meta.getEpisodeById(metaInfos.id, nextEpisode.season, nextEpisode.episode);
      const torrents = await getTorrents(userConfig, metaInfos, debridInstance);

      // Cache next episode on debrid when not cached
      if(userConfig.forceCacheNextEpisode && torrents.length && !torrents.find(torrent => torrent.isCached)){
        console.log(`${stremioId} : Force cache next episode (${metaInfos.episode}) on debrid`);
        const bestTorrent = torrents[0];
        await getDebridFiles(userConfig, bestTorrent.infos, debridInstance);
      }

    }

  }catch(err){

    if(err.message != debrid.ERROR.NOT_READY){
      console.log('cache next episode:', err);
    }

  }

}

async function getDebridFiles(userConfig, infos, debridInstance){

  if(infos.magnetUrl){

    return debridInstance.getFilesFromMagnet(infos.magnetUrl, infos.infoHash);

  }else{

    let buffer = await torrentInfos.getTorrentFile(infos);

    if(config.replacePasskey){
      if(!userConfig.passkey.match(new RegExp(config.replacePasskeyPattern))){
        throw new Error(`Invalid user passkey, pattern not match: ${config.replacePasskeyPattern}`);
      }
      buffer = Buffer.from(buffer.toString('binary').replace(new RegExp(config.replacePasskey, 'g'), userConfig.passkey), 'binary');
    }

    return debridInstance.getFilesFromBuffer(buffer, infos.infoHash);

  }

}

export async function getStreams(userConfig, type, stremioId, publicUrl){

  userConfig = mergeDefaultUserConfig(userConfig);
  const {id, season, episode} = parseStremioId(stremioId);
  const debridInstance = debrid.instance(userConfig);

  let metaInfos = await getMetaInfos(type, stremioId);

  const torrents = await getTorrents(userConfig, metaInfos, debridInstance);

  // Prepare next expisode torrents list
  if(type == 'series'){
    prepareNextEpisode({...userConfig, forceCacheNextEpisode: false}, metaInfos, debridInstance);
  }

  return torrents.map(torrent => {
    let infos = [];
    infos.push(bytesToSize(torrent.size), `${torrent.seeders} seeders`);
    if(torrent.languages && torrent.languages.length){
      infos.push((torrent.languages || []).map(language => language.emoji).join(' ') +' ');
    }
    if(torrent.progress && !torrent.isCached){
      infos.push(`${torrent.progress.percent}%`, `${bytesToSize(torrent.progress.speed)}/s`);
    }
    return {
      name: `[${debridInstance.shortName}${torrent.isCached ? '+' : ''}] jackettio`,
      title: `${torrent.name}\n${infos.join(' - ')}`,
      url: `${publicUrl}/${btoa(JSON.stringify(userConfig))}/download/${type}/${stremioId}/${torrent.id}`
    };
  });

}

export async function getDownload(userConfig, type, stremioId, torrentId){

  userConfig = mergeDefaultUserConfig(userConfig);
  const debridInstance = debrid.instance(userConfig);
  const infos = await torrentInfos.getById(torrentId);
  const {id, season, episode} = parseStremioId(stremioId);
  const cacheKey = `download:${await debridInstance.getUserHash()}:${stremioId}:${torrentId}`;
  let files;
  let download;
  let waitMs = 0;

  while(actionInProgress.getDownload[cacheKey]){
    await wait(Math.min(300, waitMs+=50));
  }
  actionInProgress.getDownload[cacheKey] = true;

  try {

    // Prepare next expisode debrid cache
    if(type == 'series' && userConfig.forceCacheNextEpisode){
      getMetaInfos(type, stremioId).then(metaInfos => prepareNextEpisode(userConfig, metaInfos, debridInstance));
    }

    download = await cache.get(cacheKey);
    if(download)return download;

    console.log(`${stremioId} : get files ...`);
    files = await getDebridFiles(userConfig, infos, debridInstance);
    console.log(`${stremioId} : ${files.length} files found`);

    files = files.sort(sortBy('size', true));

    if(type == 'movie'){

      download = await debridInstance.getDownload(files[0]);

    }else if(type == 'series'){

      let bestFile = files.find(file => file.name.includes(`S${numberPad(season)}E${numberPad(episode)}`))
        || files.find(file => file.name.includes(`${season}${numberPad(episode)}`))
        || files.find(file => file.name.includes(`${numberPad(episode)}`))
        || files[0];

      download = await debridInstance.getDownload(bestFile);

    }

    if(download){
      await cache.set(cacheKey, download, {ttl: 3600});
      return download;
    }

    throw new Error(`No download for type ${type} and ID ${torrentId}`);

  }finally{

    delete actionInProgress.getDownload[cacheKey];

  }

}