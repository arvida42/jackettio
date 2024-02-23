import pLimit from 'p-limit';
import {parseWords, numberPad, sortBy, bytesToSize, wait} from './util.js';
import config from './config.js';
import cache from './cache.js';
import * as meta from './meta.js';
import * as jackett from './jackett.js';
import * as debrid from './debrid.js';
import * as torrentInfos from './torrentInfos.js';

const searchInProgess = {};
const getDownloadInProgress = {};

const parseStremioId = (stremioId) => {
  const [id, season, episode] = stremioId.split(':');
  return {id, season: parseInt(season || 0), episode: parseInt(episode || 0)};
};

export async function getTorrents(metaInfos, userConfig, debridInstance){

  while(searchInProgess[metaInfos.stremioId]){
    await wait(500);
  }
  searchInProgess[metaInfos.stremioId] = true;

  try {

    userConfig = Object.assign({}, config.defaultUserConfig, userConfig || {});
    const {qualities, excludeKeywords, maxTorrents, sortCached, sortUncached, priotizePackTorrents} = userConfig;
    const {id, season, episode, type, stremioId} = metaInfos;

    let torrents = [];
    let infos = {};
    let startDate = new Date();

    console.log(`${stremioId} : Searching torrents ...`);

    const sortSearch = [['seeders', true]];
    const filterSearch = (torrent) => {
      if(!qualities.includes(torrent.quality))return false;
      const torrentWords = parseWords(torrent.name.toLowerCase());
      if(excludeKeywords.find(word => torrentWords.includes(word)))return false;
      return true;
    };

    const indexers = (await jackett.getIndexers()).filter(indexer => indexer.searching[type].available);
    console.log(`${stremioId} : ${indexers.length} indexers available : ${indexers.map(indexer => indexer.title).join(', ')}`);

    if(type == 'movie'){

      infos = await meta.getMovieById(id);
      const promises = indexers.map(indexer => jackett.searchMovieTorrents({...infos, indexer: indexer.id}).catch(err => []));
      torrents = [].concat(...(await Promise.all(promises)));

      console.log(`${stremioId} : ${torrents.length} torrents found in ${(new Date() - startDate) / 1000}s`);

      torrents = torrents.filter(filterSearch).sort(sortBy(...sortSearch)).slice(0, maxTorrents);

    }else if(type == 'series'){

      infos = await meta.getEpisodeById(id, season, episode);

      const episodesPromises = indexers.map(indexer => jackett.searchEpisodeTorrents({...infos, indexer: indexer.id}).catch(err => []));
      const packsPromises = indexers.map(indexer => jackett.searchSeasonTorrents({...infos, indexer: indexer.id}).catch(err => []));

      const episodesTorrents = [].concat(...(await Promise.all(episodesPromises))).filter(filterSearch);
      const packsTorrents = [].concat(...(await Promise.all(packsPromises))).filter(torrent => filterSearch(torrent) && parseWords(torrent.name.toUpperCase()).includes(`S${numberPad(season)}`));

      torrents = [].concat(episodesTorrents, packsTorrents);

      console.log(`${stremioId} : ${torrents.length} torrents found in ${(new Date() - startDate) / 1000}s`);

      torrents = torrents.filter(filterSearch).sort(sortBy(...sortSearch)).slice(0, maxTorrents);

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
      .filter((torrent, index, items) => items.findIndex(t => t.infos.infoHash == torrent.infos.infoHash) === index);

    console.log(`${stremioId} : ${torrents.length} torrents infos found in ${(new Date() - startDate) / 1000}s`);

    if(torrents.length == 0){
      throw new Error(`No torrent infos for type ${type} and id ${stremioId}`);
    }

    if(debridInstance){

      const cachedTorrents = (await debridInstance.getCachedTorrents(torrents)).map(torrent => {
        torrent.isCached = true;
        return torrent;
      });
      const uncachedTorrents = torrents.filter(torrent => cachedTorrents.indexOf(torrent) === -1);

      console.log(`${stremioId} : ${cachedTorrents.length} cached torrents on ${debridInstance.shortName}`);

      torrents = [].concat(cachedTorrents.sort(sortBy(...sortCached)))
                   .concat(uncachedTorrents.sort(sortBy(...sortUncached)));

    }

    return torrents;

  }finally{

    delete searchInProgess[metaInfos.stremioId];

  }

}

export async function getStreams(userConfig, type, stremioId, publicUrl){

  const {id, season, episode} = parseStremioId(stremioId);
  const debridInstance = debrid.instance(userConfig);

  let metaInfos;

  if(type == 'movie'){
    metaInfos = await meta.getMovieById(id);
  }else if(type == 'series'){
    metaInfos = await meta.getEpisodeById(id, season, episode);
  }else{
    throw new Error(`Unsuported type ${type}`);
  }

  const torrents = await getTorrents(metaInfos, userConfig, debridInstance);

  // Cache next episode
  if(type == 'series'){
    const nextEpisodeIndex = metaInfos.episodes.findIndex(e => e.episode == episode && e.season == season) + 1;
    const nextEpisode = metaInfos.episodes[nextEpisodeIndex] || false;
    if(nextEpisode){
      meta.getEpisodeById(id, nextEpisode.season, nextEpisode.episode)
        .then(nextMetaInfos => getTorrents(nextMetaInfos, userConfig, debridInstance))
        .then(nextTorrents => {
          // Cache next episode on debrid when not cached
          if(userConfig.forceCacheNextEpisode && nextTorrents.length && !nextTorrents.find(torrent => torrent.isCached)){
            console.log(`${stremioId} : Force cache next episode (${nextEpisode.episode}) on debrid`);
            const bestTorrent = nextTorrents[0];
            if(bestTorrent.infos.magnetUrl){
              return debridInstance.getFilesFromMagnet(bestTorrent.infos.magnetUrl);
            }else{
              return torrentInfos.getTorrentFile(bestTorrent.infos).then(buffer => debridInstance.getFilesFromBuffer(buffer));
            }
          }
        })
        .catch(err => {
          if(err.message != debrid.ERROR.NOT_READY){
            console.log('cache next episode:', err);
          }
        });
    }
  }

  return torrents.map(torrent => {
    return {
      name: `[${debridInstance.shortName}${torrent.isCached ? '+' : ''}] jackettio`,
      title: `${torrent.name}\n${bytesToSize(torrent.size)} - ${torrent.seeders} seeders`,
      url: `${publicUrl}/${btoa(JSON.stringify(userConfig))}/download/${type}/${stremioId}/${torrent.id}`
    };
  });

}

export async function getDownload(userConfig, type, stremioId, torrentId){

  const debridInstance = debrid.instance(userConfig);
  const infos = await torrentInfos.getById(torrentId);
  const {id, season, episode} = parseStremioId(stremioId);
  const cacheKey = `download:${await debridInstance.getUserHash()}:${stremioId}:${torrentId}`;
  let files;
  let download;
  let waitMs = 0;

  while(getDownloadInProgress[cacheKey]){
    await wait(Math.min(300, waitMs+=50));
  }
  getDownloadInProgress[cacheKey] = true;

  try {

    download = await cache.get(cacheKey);
    if(download)return download;

    console.log(`${stremioId} : get files ...`);

    if(infos.magnetUrl){
      files = await debridInstance.getFilesFromMagnet(infos.magnetUrl);
    }else{
      const buffer = await torrentInfos.getTorrentFile(infos);
      files = await debridInstance.getFilesFromBuffer(buffer);
    }

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

    delete getDownloadInProgress[cacheKey];

  }

}