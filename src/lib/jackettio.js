import pLimit from 'p-limit';
import {parseWords, numberPad, sortBy, bytesToSize, wait} from './util.js';
import config from './config.js';
import * as meta from './meta.js';
import * as jackett from './jackett.js';
import * as debrid from './debrid.js';
import * as torrentInfos from './torrentInfos.js';

const searchInProgess = {};

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

    console.log(`${stremioId} : Searching torrents ...`);

    const sortSearch = [['seeders', true]];
    const filterSearch = (torrent) => {
      if(!qualities.includes(torrent.quality))return false;
      const torrentWords = parseWords(torrent.name.toLowerCase());
      if(excludeKeywords.find(torrentWords.find))return false;
      return true;
    };

    if(type == 'movie'){

      infos = await meta.getMovieById(id);
      torrents = await jackett.searchMovieTorrents(infos);

      console.log(`${stremioId} : ${torrents.length} torrents found`);

      torrents = torrents.filter(filterSearch).sort(sortBy(...sortSearch));

    }else if(type == 'series'){

      infos = await meta.getEpisodeById(id, season, episode);

      console.log(`${stremioId} : ${torrents.length} torrents found`);

      const [episodesTorrents, packsTorrents] = await Promise.all([
        jackett.searchEpisodeTorrents(infos).then(items => items.filter(filterSearch)),
        jackett.searchSeasonTorrents(infos).then(items => items.filter(torrent => filterSearch(torrent) && parseWords(torrent.name.toUpperCase()).includes(`S${numberPad(season)}`)))
      ]);

      torrents = [].concat(episodesTorrents, packsTorrents)
          .filter(filterSearch)
          .sort(sortBy(...sortSearch))
          .slice(0, maxTorrents);

      if(priotizePackTorrents > 0 && packsTorrents.length && !torrents.find(t => packsTorrents.includes(t))){
        const bestPackTorrents = packsTorrents.slice(0, Math.min(packsTorrents.length, priotizePackTorrents));
        torrents.splice(bestPackTorrents.length * -1, bestPackTorrents.length, ...bestPackTorrents);
      }

    }

    console.log(`${stremioId} : ${torrents.length} torrents found after first filter`);

    const limit = pLimit(5);
    torrents = await Promise.all(torrents.map(torrent => limit(async () => {
      try {
        torrent.infos = await torrentInfos.get(torrent);
        return torrent;
      }catch(err){
        console.log(`Failed getting torrent infos for ${torrent.id} ${torrent.link}`, err);
        return false;
      }
    })));
    torrents = torrents.filter((torrent, index) => torrent && torrents.findIndex(t => t.infos.infoHash == torrent.infos.infoHash) === index);
    torrents.splice(maxTorrents);

    console.log(`${stremioId} : ${torrents.length} torrents filtered`);

    if(torrents.length == 0){
      throw new Error(`No torrent infos for type ${type} and id ${id}`);
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

  }catch(err){

    throw err;

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
    let nextEpisodeIndex = metaInfos.episodes.findIndex(e => e.episode == episode && e.season == season) + 1;
    if(metaInfos.episodes[nextEpisodeIndex]){
      meta.getEpisodeById(id, metaInfos.episodes[nextEpisodeIndex].season, metaInfos.episodes[nextEpisodeIndex].episode)
        .then(nextMetaInfos => getTorrents(nextMetaInfos, userConfig, debridInstance))
        .catch(console.log);
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
  let files;

  console.log(`${stremioId} : get files ...`);

  if(infos.magnetUrl){
    files = await debridInstance.getFilesFromMagnet(infos.magnetUrl);
  }else{
    const buffer = torrentInfos.getTorrentFile(infos);
    files = await debridInstance.getFilesFromBuffer(buffer);
  }

  console.log(`${stremioId} : ${files.length} files found`);

  files = files.sort(sortBy('size', true));

  if(type == 'movie'){

    return await debridInstance.getDownload(files[0]);

  }else if(type == 'series'){

    let bestFile = files.find(file => file.name.includes(`S${numberPad(season)}E${numberPad(episode)}`))
      || files.find(file => file.name.includes(`${season}${numberPad(episode)}`))
      || files.find(file => file.name.includes(`${numberPad(episode)}`))
      || files[0];

    return await debridInstance.getDownload(bestFile);

  }

  throw new Error(`No download for type ${type} and ID ${torrentId}`);

}