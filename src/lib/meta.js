import cache from './cache.js';

export async function getMovieById(id){

  let meta = await cache.get(`meta:movie:${id}`);

  if(!meta){

    const res = await fetch(`https://v3-cinemeta.strem.io/meta/movie/${id}.json`);
    const json = await res.json();
    meta = json.meta;

    if(!meta){
      throw new Error(`Meta not found for movie ${id}`);
    }

    await cache.set(`meta:movie:${id}`, meta, {ttl: 3600});

  }

  return {
    name: meta.name,
    year: parseInt(meta.releaseInfo),
    imdb_id: meta.imdb_id,
    type: 'movie',
    stremioId: id,
    id,
  };

}

export async function getEpisodeById(id, season, episode){

  let meta = await cache.get(`meta:series:${id}`);

  if(!meta){

    const res = await fetch(`https://v3-cinemeta.strem.io/meta/series/${id}.json`);
    const json = await res.json();
    meta = json.meta;

    if(!meta){
      throw new Error(`Meta not found for episode ${id}`);
    }

    await cache.set(`meta:series:${id}`, meta, {ttl: 3600});

  }

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