import cache from '../cache.js';
import config from '../config.js';

export default class Tmdb {

  static id = 'tmdb';
  static name = 'The Movie Database';

  async getMovieById(id){
    
    const searchId = await this.#request('GET', `/3/find/${id}`, {query: {external_source: 'imdb_id'}}, {key: `searchId:${id}`, ttl: 3600*3});
    const meta = searchId.movie_results[0];

    return {
      name: meta.original_title || meta.title,
      year: parseInt(`${meta.release_date}`.split('-').shift()),
      imdb_id: id,
      type: 'movie',
      stremioId: id,
      id,
    };

  }

  async getEpisodeById(id, season, episode){

    const searchId = await this.#request('GET', `/3/find/${id}`, {query: {external_source: 'imdb_id'}}, {key: `searchId:${id}`, ttl: 3600*3});
    const meta = await this.#request('GET', `/3/tv/${searchId.tv_results[0].id}`, {query: {language: 'en-US'}}, {key: id, ttl: 3600*3});

    const episodes = [];
    meta.seasons.forEach(s => {
      for(let e = 1; e <= s.episode_count; e++){
        episodes.push({
          season: s.season_number,
          episode: e,
          stremioId: `${id}:${s.season_number}:${e}`
        });
      }
    });

    return {
      name: meta.name,
      year: parseInt(`${meta.first_air_date}`.split('-').shift()),
      imdb_id: id,
      type: 'series',
      stremioId: `${id}:${season}:${episode}`,
      id,
      season,
      episode,
      episodes
    };

  }

  async #request(method, path, opts, cacheOpts){

    if(!config.tmdbAccessToken){
      throw new Error(`config.tmdbAccessToken is not configured`);
    }

    cacheOpts = Object.assign({key: '', ttl: 0}, cacheOpts || {});
    opts = opts || {};
    opts = Object.assign(opts, {
      method,
      headers: Object.assign(opts.headers || {}, {
        'accept': 'application/json',
        'authorization': `Bearer ${config.tmdbAccessToken}`
      })
    });

    let data;

    if(cacheOpts.key){
      data = await cache.get(`tmdb:${cacheOpts.key}`);
      if(data)return data;
    }

    const url = `https://api.themoviedb.org${path}?${new URLSearchParams(opts.query).toString()}`;
    const res = await fetch(url, opts);
    data = await res.json();

    if(!res.ok){
      throw new Error(`Invalid TMDB api result: ${JSON.stringify(data)}`);
    }

    if(data && cacheOpts.key && cacheOpts.ttl > 0){
      await cache.set(`tmdb:${cacheOpts.key}`, data, {ttl: cacheOpts.ttl})
    }

    return data;

  }

}
