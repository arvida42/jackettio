
export async function getMovieById(id){
  const res = await fetch(`https://v3-cinemeta.strem.io/meta/movie/${id}.json`);
  const {meta} = await res.json();
  if(!meta){
    throw new Error(`Meta not found for movie ${id}`);
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
  const res = await fetch(`https://v3-cinemeta.strem.io/meta/series/${id}.json`);
  const {meta} = await res.json();
  if(!meta){
    throw new Error(`Meta not found for episode ${id}`);
  }
  return {
    name: meta.name,
    year: parseInt(`${meta.releaseInfo}`.split('-').shift()),
    imdb_id: meta.imdb_id,
    type: 'series',
    stremioId: `${id}-${season}-${episode}`,
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