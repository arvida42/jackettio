import { writeFile, readFile } from 'node:fs/promises';
import path from 'path';
import config from './config.js';

let ICON_LOCATION = path.join(import.meta.dirname, '../static/img/icon.png');

export async function download(){
  const res = await fetch(config.addonIcon, {method: 'GET'});
  if(!res.ok){
    throw new Error('Network response was not ok');
  }
  let extension = null;
  if(res.headers.has('content-type')){
    const matches = res.headers.get('content-type').match(/image\/([a-z0-9]+)/i);
    if(matches && matches.length > 1)extension = matches[1];
  }
  if(!extension && res.headers.has('content-disposition')){
    const matches = res.headers.get('content-disposition').match(/filename\*?=['"]?(?:UTF-\d['"]*)?([^;\r\n"']*)['"]?;?/i);
    if(matches && matches.length > 1)extension = matches[1].split('.').pop();
  }
  if(!extension){
    throw new Error(`No valid image found: ${res.headers.get('content-type')} / ${res.headers.get('content-disposition')}`);
  }
  const location = `${config.dataFolder}/icon.${extension}`;
  const buffer = await res.arrayBuffer();
  await writeFile(location, new Uint8Array(buffer));
  console.log(`Icon downloaded: ${location}`);
  ICON_LOCATION = location;
  return location;
}

export async function getLocation(){
  return ICON_LOCATION;
}