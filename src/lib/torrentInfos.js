import crypto from 'crypto';
import path from 'path';
import { writeFile, readFile, mkdir, readdir, unlink, stat } from 'node:fs/promises';
import parseTorrent from 'parse-torrent';
import {toMagnetURI} from 'parse-torrent';
import cache from './cache.js';
import config from './config.js';

const TORRENT_FOLDER = `${config.dataFolder}/torrents`;
const CACHE_FILE_DAYS = 7;

export async function createTorrentFolder(){
  return mkdir(TORRENT_FOLDER).catch(() => false);
}

export async function cleanTorrentFolder(){
  const files = await readdir(TORRENT_FOLDER);
  const expireTime = new Date().getTime() - 86400*CACHE_FILE_DAYS*1000;
  for (const file of files) {
    if(!file.endsWith('.torrent'))continue;
    const filePath = path.join(TORRENT_FOLDER, file);
    const stats = await stat(filePath);
    if(stats.ctimeMs < expireTime){
      await unlink(filePath);
    }
  }
}

export async function get({link, id, magnetUrl, infoHash, name, size, type}){

  try {
    return await getById(id);
  }catch(err){}

  let parseInfos = null;
  let torrentLocation = '';

  if(magnetUrl && infoHash && name && size > 0 && type){

    parseInfos = {
      infoHash, 
      name, 
      length: size, 
      private: (type == 'private')
    };

  }else{

    if(link.startsWith('http')){

      try {

        torrentLocation = `${TORRENT_FOLDER}/${id}.torrent`;
        const buffer = await downloadTorrentFile({link, id, torrentLocation});
        parseInfos = await parseTorrent(new Uint8Array(buffer));

        if(!parseInfos.private){
          magnetUrl = toMagnetURI(parseInfos);
        }

      }catch(err){

        torrentLocation = '';
        if(err.redirection && err.redirection.startsWith('magnet')){
          link = err.redirection;
        }else{
          throw err;
        }

      }

    }

    if(link.startsWith('magnet')){

      parseInfos = await parseTorrent(link);
      magnetUrl = link;

    }

  }

  if(!parseInfos){
    throw new Error(`Invalid link ${link}`);
  }

  const torrentInfos = {
    id,
    link,
    magnetUrl: magnetUrl || '',
    torrentLocation,
    infoHash: (parseInfos.infoHash || '').toLowerCase(),
    name: parseInfos.name || '',
    private: parseInfos.private || false,
    size: parseInfos.length || -1,
    files: (parseInfos.files || []).map(file => {
      return {
        name: file.name,
        size: file.length
      }
    })
  };

  await setById(id, torrentInfos);

  return torrentInfos;

};

export async function getById(id){

  const cacheKey = `torrentInfos:${id}`;
  const infos = await cache.get(cacheKey);

  if(!infos){
    throw new Error(`Torrent infos cache seem expired for id ${id}`);
  }

  return infos;

}

async function setById(id, infos){

  const cacheKey = `torrentInfos:${id}`;
  await cache.set(cacheKey, infos, {ttl: 86400*CACHE_FILE_DAYS});

  return infos;

}

export async function getTorrentFile(infos){

  if(infos.torrentLocation){
    try {
      return await readFile(infos.torrentLocation);
    }catch(err){}
  }

  return downloadTorrentFile(infos);

}

async function downloadTorrentFile({link, id, torrentLocation}){

  const res = await fetch(link, {redirect: 'manual'});

  if(res.headers.has('location')){
    throw Object.assign(new Error(`Redirection detected ...`), {redirection: res.headers.get('location')});
  }

  if(!(res.headers.get('content-type') || '').includes('application/x-bittorrent')){
    throw new Error(`Invalid content-type: ${res.headers.get('content-type')}`);
  }

  if(res.status != 200){
    throw new Error(`Invalid status: ${res.status}`);
  }

  const buffer = await res.arrayBuffer();
  writeFile(torrentLocation, new Uint8Array(buffer));
  return buffer;

}