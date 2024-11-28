import {createHash} from 'crypto';
import {ERROR} from './const.js';
import {wait} from '../util.js';
import {basename} from 'path';

export default class Premiumize {

  static id = 'premiumize';
  static name = 'Premiumize';
  static shortName = 'PM';
  static cacheCheckAvailable = true;
  static configFields = [
    {
      type: 'text', 
      name: 'debridApiKey', 
      label: `Premiumize API Key`, 
      required: true, 
      href: {value: 'https://www.premiumize.me/account', label:'Get API Key Here'}
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
    const query = {items: hashList};
    const res = await this.#request('GET', '/cache/check', {query});
    return torrents.filter((torrent, index) => res.response[index]);
  }

  async getProgressTorrents(torrents){
    const torrentHashByName = torrents.reduce((acc, torrent) => {
      acc[torrent.infos.name] = torrent.infos.infoHash;
      return acc;
    }, {});
    const res = await this.#request('GET', '/transfer/list');
    return res.transfers.reduce((progress, transfer) => {
      const hash = torrentHashByName[transfer.name] || false;
      if(hash){
        progress[hash] = {
          percent: this.#isTransferReady(transfer) ? 100 : transfer.progress,
          speed: 0
        }
      }
      return progress;
    }, {});
  }

  async getFilesFromHash(infoHash){
    return this.getFilesFromMagnet(infoHash, infoHash);
  }

  async getFilesFromMagnet(url, infoHash){
    const body = new FormData();
    body.append('src', url);
    const res = await this.#request('POST', `/transfer/create`, {body});
    return this.#getFilesFromTransferId(res.id, url);
  }

  async getFilesFromBuffer(buffer, infoHash){
    const body = new FormData();
    body.append('file', new Blob([buffer]), 'file.torrent');
    const res = await this.#request('POST', `/transfer/create`, {body});
    return this.#getFilesFromTransferId(res.id);
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

  #isTransferReady(transfer){
    return ['finished', 'seeding'].includes(transfer.status);
  }

  async #getFilesFromTransferId(transferId){

    const transfers = (await this.#request('GET', '/transfer/list')).transfers;
    const transfer = transfers.find(transfer => transfer.id == transferId);

    if(!transfer){
      throw new Error(`Transfer ${transferId} not found`);
    }

    if(!this.#isTransferReady(transfer)){
      throw new Error(ERROR.NOT_READY);
    }

    const folder = (await this.#request('GET', '/folder/list', {query: {id: transfer.folder_id}}));

    return folder.content.map((file, index) => {
      return {
        name: file.name,
        size: file.size,
        id: `${transferId}:${index}`,
        url: file.link,
        ready: true
      };
    });

  }

  async #request(method, path, opts){

    opts = opts || {};
    opts = Object.assign(opts, {
      method,
      headers: Object.assign(opts.headers || {}, {
        'user-agent': 'Stremio',
        'accept': 'application/json'
      }),
      query: Object.assign({download_ip: this.#ip, apikey: this.#apiKey}, opts.query || {})
    });

    const queryParts = [];
    for(const [key, value] of Object.entries(opts.query)){
      if(Array.isArray(value)){
        value.forEach(v => queryParts.push(`${key}[]=${encodeURIComponent(v)}`));
      }else{
        queryParts.push(`${key}=${encodeURIComponent(value)}`);
      }
    }

    const url = `https://www.premiumize.me/api${path}?${queryParts.join('&')}`;
    const res = await fetch(url, opts);
    const data = await res.json();

    if(data.status != 'success'){
      switch(data.message || ''){
        case 'Not logged in.':
          throw new Error(ERROR.EXPIRED_API_KEY);
        case 'Account not premium.':
          throw new Error(ERROR.NOT_PREMIUM);
        default:
          throw new Error(`Invalid PM api result ${path} : ${JSON.stringify(data)}`);
      }
    }

    return data;

  }

}