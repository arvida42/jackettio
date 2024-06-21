import pLimit from 'p-limit';
import {parseWords, numberPad, sortBy, bytesToSize, wait, promiseTimeout} from './util.js';
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

function searchEpisodeFile(files, season, episode){
  return files.find(file => file.name.includes(`S${numberPad(season)}E${numberPad(episode)}`))
    || files.find(file => file.name.includes(`${season}${numberPad(episode)}`))
    || files.find(file => file.name.includes(`${numberPad(episode)}`))
    || false;
}

async function getTorrents(userConfig, metaInfos, debridInstance){

  while(actionInProgress.getTorrents[metaInfos.stremioId]){
    await wait(500);
  }
  actionInProgress.getTorrents[metaInfos.stremioId] = true;

  try {

    const {qualities, excludeKeywords, maxTorrents, sortCached, sortUncached, priotizePackTorrents, priotizeLanguages, indexerTimeoutSec} = userConfig;
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

      const promises = indexers.map(indexer => promiseTimeout(jackett.searchMovieTorrents({...metaInfos, indexer: indexer.id}), indexerTimeoutSec*1000).catch(err => []));
      torrents = [].concat(...(await Promise.all(promises)));

      console.log(`${stremioId} : ${torrents.length} torrents found in ${(new Date() - startDate) / 1000}s`);

      torrents = torrents.filter(filterSearch).sort(sortBy(...sortSearch));
      torrents = priotizeItems(torrents, filterLanguage, Math.max(1, Math.round(maxTorrents * 0.33)));
      torrents = torrents.slice(0, maxTorrents + 2);

    }else if(type == 'series'){

      const episodesPromises = indexers.map(indexer => promiseTimeout(jackett.searchEpisodeTorrents({...metaInfos, indexer: indexer.id}), indexerTimeoutSec*1000).catch(err => []));
      // const packsPromises = indexers.map(indexer => promiseTimeout(jackett.searchSeasonTorrents({...metaInfos, indexer: indexer.id}), indexerTimeoutSec*1000).catch(err => []));
      const packsPromises = indexers.map(indexer => promiseTimeout(jackett.searchSerieTorrents({...metaInfos, indexer: indexer.id}), indexerTimeoutSec*1000).catch(err => []));

      const episodesTorrents = [].concat(...(await Promise.all(episodesPromises))).filter(filterSearch);
      // const packsTorrents = [].concat(...(await Promise.all(packsPromises))).filter(torrent => filterSearch(torrent) && parseWords(torrent.name.toUpperCase()).includes(`S${numberPad(season)}`));
      const packsTorrents = [].concat(...(await Promise.all(packsPromises))).filter(torrent => {
        if(!filterSearch(torrent))return false;
        const words = parseWords(torrent.name.toLowerCase());
        const wordsStr = words.join(' ');
        if(
          // Season x
          wordsStr.includes(`season ${season}`)
          // SXX
          || words.includes(`s${numberPad(season)}`)
        ){
          return true;
        }
        // From SXX to SXX
        const range = wordsStr.match(/s([\d]{2,}) s([\d]{2,})/);
        if(range && season >= parseInt(range[1]) && season <= parseInt(range[2])){
          return true;
        }
        // Complete without season number (serie pack)
        if(words.includes('complete') && !wordsStr.match(/ (s[\d]{2,}|season [\d]) /)){
          return true;
        }
        return false;
      });

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
      try {
        torrent.infos = await promiseTimeout(torrentInfos.get(torrent), Math.min(30, indexerTimeoutSec)*1000);
        return torrent;
      }catch(err){
        console.log(`${stremioId} Failed getting torrent infos for ${torrent.id} from indexer ${torrent.indexerId}`);
        console.log(`${stremioId} ${torrent.link.replace(/apikey=[a-z0-9\-]+/, 'apikey=****')}`, err);
        return false;
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

        const isValidCachedFiles = type == 'series' ? files => !!searchEpisodeFile(files, season, episode) : files => true;
        const cachedTorrents = (await debridInstance.getTorrentsCached(torrents, isValidCachedFiles)).map(torrent => {
          torrent.isCached = true;
          return torrent;
        });
        const uncachedTorrents = torrents.filter(torrent => cachedTorrents.indexOf(torrent) === -1);

        if(config.replacePasskey && !(userConfig.passkey && userConfig.passkey.match(new RegExp(config.replacePasskeyPattern)))){
          uncachedTorrents.forEach(torrent => {
            if(torrent.infos.private){
              torrent.disabled = true;
              torrent.infoText = 'Uncached torrent require a passkey configuration';
            }
          });
        }

        console.log(`${stremioId} : ${cachedTorrents.length} cached torrents on ${debridInstance.shortName}`);

        torrents = [].concat(priotizeItems(cachedTorrents.sort(sortBy(...sortCached)), filterLanguage))
                     .concat(priotizeItems(uncachedTorrents.sort(sortBy(...sortUncached)), filterLanguage));
      
        const progress = await debridInstance.getProgressTorrents(torrents);
        torrents.forEach(torrent => torrent.progress = progress[torrent.infos.infoHash] || null);

      }catch(err){

        console.log(`${stremioId} : ${debridInstance.shortName} : ${err.message || err}`);

        if(err.message == debrid.ERROR.EXPIRED_API_KEY){
          torrents.forEach(torrent => {
            torrent.disabled = true;
            torrent.infoText = 'Unable to verify cache (+): Expired Debrid API Key.';
          });
        }

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
        const bestTorrent = torrents.find(torrent => !torrent.disabled);
        if(bestTorrent)await getDebridFiles(userConfig, bestTorrent.infos, debridInstance);
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

      if(infos.private && !userConfig.passkey){
        return debridInstance.getFilesFromHash(infos.infoHash);
      }

      if(!userConfig.passkey.match(new RegExp(config.replacePasskeyPattern))){
        throw new Error(`Invalid user passkey, pattern not match: ${config.replacePasskeyPattern}`);
      }

      const from = buffer.toString('binary');
      let to = from.replace(new RegExp(config.replacePasskey, 'g'), userConfig.passkey);
      const diffLength = from.length - to.length;
      const announceLength = from.match(/:announce([\d]+):/);
      if(diffLength && announceLength && announceLength[1]){
        to = to.replace(announceLength[0], `:announce${parseInt(announceLength[1]) - diffLength}:`);
      }
      buffer = Buffer.from(to, 'binary');

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
    const file = type == 'series' && torrent.infos.files.length ? searchEpisodeFile(torrent.infos.files.sort(sortBy('size', true)), season, episode) : {};
    const quality = torrent.quality > 0 ? config.qualities.find(q => q.value == torrent.quality).label : '';
    const rows = [torrent.name];
    if(type == 'series' && file.name)rows.push(file.name);
    if(torrent.infoText)rows.push(`ℹ️ ${torrent.infoText}`);
    rows.push([`💾${bytesToSize(file.size || torrent.size)}`, `👥${torrent.seeders}`, `⚙️${torrent.indexerId}`, ...(torrent.languages || []).map(language => language.emoji)].join(' '));
    if(torrent.progress && !torrent.isCached){
      rows.push(`⬇️ ${torrent.progress.percent}% ${bytesToSize(torrent.progress.speed)}/s`);
    }
    return {
      name: `[${debridInstance.shortName}${torrent.isCached ? '+' : ''}] ${config.addonName} ${quality}`,
      title: rows.join("\n"),
      url: torrent.disabled ? '#' : `${publicUrl}/${btoa(JSON.stringify(userConfig))}/download/${type}/${stremioId}/${torrent.id}`
    };
  });

}

export async function getDownload(userConfig, type, stremioId, torrentId){

  userConfig = mergeDefaultUserConfig(userConfig);
  const debridInstance = debrid.instance(userConfig);
  const infos = await torrentInfos.getById(torrentId);
  const {id, season, episode} = parseStremioId(stremioId);
  const cacheKey = `download:2:${await debridInstance.getUserHash()}:${stremioId}:${torrentId}`;
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

    console.log(`${stremioId} : ${debridInstance.shortName} : ${infos.infoHash} : get files ...`);
    files = await getDebridFiles(userConfig, infos, debridInstance);
    console.log(`${stremioId} : ${debridInstance.shortName} : ${infos.infoHash} : ${files.length} files found`);

    files = files.sort(sortBy('size', true));

    if(type == 'movie'){

      download = await debridInstance.getDownload(files[0]);

    }else if(type == 'series'){

      let bestFile = searchEpisodeFile(files, season, episode) || files[0];
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