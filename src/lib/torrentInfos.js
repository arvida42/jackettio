import crypto from 'crypto';
import path from 'path';
import { writeFile, readFile, mkdir, readdir, unlink, stat } from 'node:fs/promises';
import parseTorrent from 'parse-torrent';
import {toMagnetURI} from 'parse-torrent';
import cache from './cache.js';
import config from './config.js';

const TORRENT_FOLDER = `${config.dataFolder}/torrents`;
const CACHE_FILE_DAYS = 14;

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

export async function get({link, id}){

  try {
    return await getById(id);
  }catch(err){}

  let infos = null;
  let magnetUrl = '';
  let torrentLocation = '';

  if(link.startsWith('http')){

    try {

      const buffer = await downloadTorrentFile({link, id});
      infos = await parseTorrent(new Uint8Array(buffer));

      if(!infos.private){
        magnetUrl = toMagnetURI(infos);
      }

    }catch(err){

      if(err.redirection && err.redirection.startsWith('magnet')){
        link = err.redirection;
      }else{
        throw err;
      }

    }

  }

  if(link.startsWith('magnet')){

    infos = await parseTorrent(link);
    magnetUrl = link;

  }

  if(!infos){
    throw new Error(`Invalid link ${link}`);
  }

  infos = {
    id,
    link,
    magnetUrl,
    torrentLocation,
    infoHash: infos.infoHash || '',
    name: infos.name || '',
    private: infos.private || false,
    size: infos.length || -1,
    files: (infos.files || []).map(file => {
      return {
        name: file.name,
        size: file.length
      }
    })
  };

  await setById(id, infos);

  return infos;

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

async function downloadTorrentFile({link, id}){

  const res = await fetch(link, {redirect: 'manual'});

  if(res.headers.has('location')){
    throw Object.assign(new Error(`Redirection detected ...`), {redirection: res.headers.get('location')});
  }

  if(!res.headers.get('content-type').includes('application/x-bittorrent')){
    throw new Error(`Invalid content-type: ${res.headers.get('content-type')}`);
  }

  if(res.status != 200){
    throw new Error(`Invalid status: ${res.status}`);
  }

  const buffer = await res.arrayBuffer();
  writeFile(`${TORRENT_FOLDER}/${id}.torrent`, new Uint8Array(buffer));
  return buffer;

}