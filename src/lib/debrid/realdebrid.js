import {createHash} from 'crypto';
import {ERROR} from './const.js';
import {wait} from '../util.js';

export default class RealDebrid {

  static id = 'realdebrid';
  static name = 'Real-Debrid';
  static shortName = 'RD';
  static configFields = [
    {
      type: 'text', 
      name: 'debridApiKey', 
      label: `Real-Debrid API Key`, 
      required: true, 
      href: {value: 'https://real-debrid.com/apitoken', label:'Get API Key Here'}
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
    const res = await this.#request('GET', `/torrents/instantAvailability/${hashList.join('/')}`);
    return torrents.filter(torrent => (res[torrent.infos.infoHash]?.rd || []).length);
  }

  async getProgressTorrents(torrents){
    const res = await this.#request('GET', '/torrents');
    return res.value.reduce((progress, torrent) => {
      progress[torrent.torrent.hash] = {
        percent: torrent.progress || 0,
        speed: torrent.speed || 0
      }
      return progress;
    }, {});
  }

  async getFilesFromMagnet(magnet){
    const body = new FormData();
    body.append('magnet', magnet);
    const res = await this.#request('POST', `/torrents/addMagnet`, {body});
    return this.#getFilesFromTorrent(res.id);
  }

  async getFilesFromBuffer(buffer){
    const body = buffer;
    const res = await this.#request('PUT', `/torrents/addTorrent`, {body});
    return this.#getFilesFromTorrent(res.id);
  }

  async getDownload(file){

    const [torrentId, fileId] = file.id.split(':');
    let body = new FormData();
    body.append('files', fileId);

    await this.#request('POST', `/torrents/selectFiles/${torrentId}`, {body});
    const torrent = await this.#request('GET', `/torrents/info/${torrentId}`);

    const link = torrent.links[0] || false;

    if(torrent.status != 'downloaded' || !link){
      throw new Error(ERROR.NOT_READY);
    }

    body = new FormData();
    body.append('link', link);
    const res = await this.#request('POST', '/unrestrict/link', {body});
    return res.download;

  }

  async getUserHash(){
    return createHash('md5').update(this.#apiKey).digest('hex');
  }

  async #getFilesFromTorrent(id){

    let torrent = await this.#request('GET', `/torrents/info/${id}`);

    return torrent.files.map((file, index) => {
      return {
        name: file.path.split('/').pop(),
        size: file.bytes,
        id: `${torrent.id}:${file.id}`,
        url: '',
        ready: null
      };
    });

  }

  async #request(method, path, opts){

    opts = opts || {};
    opts = Object.assign(opts, {
      method,
      headers: Object.assign(opts.headers || {}, {
        'accept': 'application/json',
        'authorization': `Bearer ${this.#apiKey}`
      }),
      query: opts.query || {}
    });

    if(method == 'POST' || method == 'PUT'){
      opts.body = opts.body || new FormData();
      if(this.#ip && opts.body instanceof FormData)opts.body.append('ip', this.#ip);
    }

    const url = `https://api.real-debrid.com/rest/1.0${path}?${new URLSearchParams(opts.query).toString()}`;
    const res = await fetch(url, opts);
    let data;

    try {
      data = await res.json();
    }catch(err){
      data = res.status >= 400 ? {error_code: -2, error: `Empty response ${res.status}`} : {};
    }

    if(data.error_code){
      switch(data.error_code){
        case 8:
          throw new Error(ERROR.EXPIRED_API_KEY);
        case 20:
          throw new Error(ERROR.NOT_PREMIUM);
        default:
          throw new Error(`Invalid RD api result: ${JSON.stringify(data)}`);
      }
    }

    return data;

  }

}