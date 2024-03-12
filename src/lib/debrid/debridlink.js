import {createHash} from 'crypto';
import {ERROR} from './const.js';
import {wait} from '../util.js';

export default class DebridLink {

  static id = 'debridlink';
  static name = 'Debrid-Link';
  static shortName = 'DL';
  static configFields = [
    {
      type: 'text', 
      name: 'debridApiKey', 
      label: `Debrid-Link API Key`, 
      required: true, 
      href: {value: 'https://debrid-link.com/webapp/apikey', label:'Get API Key Here'}
    }
  ];

  #apiKey;
  #ip;

  constructor(userConfig) {
    Object.assign(this, this.constructor);
    this.#apiKey = userConfig.debridApiKey;
    this.#ip = userConfig.ip || '';
  }

  async getTorrentsCached(torrents){
    const hashList = torrents.map(torrent => torrent.infos.infoHash).filter(Boolean);
    const query = {url: hashList.join(',')};
    const res = await this.#request('GET', '/seedbox/cached', {query});
    return torrents.filter(torrent => res.value[torrent.infos.infoHash]);
  }

  async getProgressTorrents(torrents){
    const res = await this.#request('GET', '/seedbox/list');
    return res.value.reduce((progress, torrent) => {
      progress[torrent.hashString] = {
        percent: torrent.downloadPercent || 0,
        speed: torrent.downloadSpeed || 0
      }
      return progress;
    }, {});
  }

  async getFilesFromHash(infoHash){
    return this.getFilesFromMagnet(infoHash, infoHash);
  }

  async getFilesFromMagnet(url, infoHash){
    const body = {url, async: true};
    const res = await this.#request('POST', `/seedbox/add`, {body});
    return this.#getFilesFromTorrent(res.value);
  }

  async getFilesFromBuffer(buffer, infoHash){
    const body = new FormData();
    body.append('file', new Blob([buffer]), 'file.torrent');
    const res = await this.#request('POST', `/seedbox/add`, {body});
    return this.#getFilesFromTorrent(res.value);
  }

  async getDownload(file){

    if(!file.ready){
      throw new Error(ERROR.NOT_READY);
    }

    return file.url;

  }

  async getUserHash(){
    return createHash('md5').update(this.#apiKey).digest('hex');
  }

  async #getFilesFromTorrent(torrent){

    if(!torrent.files.length){
      throw new Error(ERROR.NOT_READY);
    }

    return torrent.files.map((file, index) => {
      return {
        name: file.name,
        size: file.size,
        id: `${torrent.id}:${index}`,
        url: file.downloadUrl,
        ready: file.downloadPercent === 100
      };
    });

  }

  async #request(method, path, opts){

    opts = opts || {};
    opts = Object.assign(opts, {
      method,
      headers: Object.assign(opts.headers || {}, {
        'user-agent': 'Stremio',
        'accept': 'application/json',
        'authorization': `Bearer ${this.#apiKey}`
      }),
      query: Object.assign({ip: this.#ip}, opts.query || {})
    });

    if(method == 'POST'){
      if(opts.body instanceof FormData){
        opts.body.append('ip', this.#ip);
      }else{
        opts.body = JSON.stringify(Object.assign({ip: this.#ip}, opts.body || {}));
        opts.headers['content-type'] = 'application/json';
      }
    }

    const url = `https://debrid-link.com/api/v2${path}?${new URLSearchParams(opts.query).toString()}`;
    const res = await fetch(url, opts);
    const data = await res.json();

    if(!data.success){
      console.log(data);
      switch(data.error || ''){
        case 'badToken':
          throw new Error(ERROR.EXPIRED_API_KEY);
        case 'maxLink':
        case 'maxLinkHost':
        case 'maxData':
        case 'maxDataHost':
        case 'maxTorrent':
        case 'torrentTooBig':
        case 'freeServerOverload':
          throw new Error(ERROR.NOT_PREMIUM);
        default:
          throw new Error(`Invalid DL api result: ${JSON.stringify(data)}`);
      }
    }

    return data;

  }

}