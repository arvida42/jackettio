import config from './config.js';
import Cinemeta from './meta/cinemeta.js';
import Tmdb from './meta/tmdb.js';

const client = config.tmdbAccessToken ? new Tmdb() : new Cinemeta();

export async function getMovieById(id){
  return client.getMovieById(id);
}

export async function getEpisodeById(id, season, episode){
  return client.getEpisodeById(id, season, episode);
}