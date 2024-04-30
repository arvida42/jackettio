import cache from '../cache.js';

export default class Cinemeta {

  static id = 'cinemeta';
  static name = 'Cinemeta';

  async getMovieById(id){
    
    const data = await this.#request('GET', `/meta/movie/${id}.json`, {}, {key: id, ttl: 3600*3});
    const meta = data.meta;

    return {
      name: meta.name,
      year: parseInt(meta.releaseInfo),
      imdb_id: meta.imdb_id,
      type: 'movie',
      stremioId: id,
      id,
    };

  }

  async getEpisodeById(id, season, episode){

    const data = await this.#request('GET', `/meta/series/${id}.json`, {}, {key: id, ttl: 3600*3});
    const meta = data.meta;

    return {
      name: meta.name,
      year: parseInt(`${meta.releaseInfo}`.split('-').shift()),
      imdb_id: meta.imdb_id,
      type: 'series',
      stremioId: `${id}:${season}:${episode}`,
      id,
      season,
      episode,
      episodes: meta.videos.map(video => {
        return {
          season: video.season,
          episode: video.number,
          stremioId: video.id
        }
      })
    };

  }

  async #request(method, path, opts, cacheOpts){

    cacheOpts = Object.assign({key: '', ttl: 0}, cacheOpts || {});
    opts = opts || {};
    opts = Object.assign(opts, {
      method,
      headers: Object.assign(opts.headers || {}, {
        'accept': 'application/json'
      })
    });

    let data;

    if(cacheOpts.key){
      data = await cache.get(`cinemeta:${cacheOpts.key}`);
      if(data)return data;
    }

    const url = `https://v3-cinemeta.strem.io${path}?${new URLSearchParams(opts.query).toString()}`;
    const res = await fetch(url, opts);
    data = await res.json();

    if(!res.ok){
      throw new Error(`Invalid Cinemeta api result: ${JSON.stringify(data)}`);
    }

    if(data && cacheOpts.key && cacheOpts.ttl > 0){
      await cache.set(`cinemeta:${cacheOpts.key}`, data, {ttl: cacheOpts.ttl})
    }

    return data;

  }

}
