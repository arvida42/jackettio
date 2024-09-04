import config from './config.js';
import Cinemeta from './meta/cinemeta.js';
import Tmdb from './meta/tmdb.js';

const client = config.tmdbAccessToken ? new Tmdb() : new Cinemeta();

export async function getMovieById(id, language){
  return client.getMovieById(id, language);
}

export async function getEpisodeById(id, season, episode, language){
  return client.getEpisodeById(id, season, episode, language);
}

export async function getLanguages(){
  return client.getLanguages();
}