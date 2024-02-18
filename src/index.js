import express from 'express';
import localtunnel from 'localtunnel';
import {readFileSync} from "fs";
import config from './lib/config.js';
import cache from './lib/cache.js';
import path from 'path';
import * as debrid from './lib/debrid.js';
import * as jackettio from "./lib/jackettio.js";
import {cleanTorrentFolder, createTorrentFolder} from './lib/torrentInfos.js';

const addon = JSON.parse(readFileSync(`./package.json`));
const app = express();

const respond = (res, data) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Headers', '*')
  res.setHeader('Content-Type', 'application/json')
  res.send(data)
}

app.set('trust proxy', 'loopback');
app.use(express.static(path.join(import.meta.dirname, 'static')));

app.use((req, res, next) => {
  console.log(req.path);
  next();
});

app.get('/', (req, res) => {
  res.redirect('/configure')
  res.end();
});

app.get('/configure', async(req, res) => {
  let template = readFileSync(`./src/template/configure.html`).toString();
  const templateConfig = {
    debrids: await debrid.list(),
    addon: {
      version: addon.version,
      name: addon.name
    },
    defaultUserConfig: config.defaultUserConfig,
    qualities: config.qualities,
    sorts: config.sorts
  };
  return res.send(template.replace('/** import-config */', `const config = ${JSON.stringify(templateConfig, null, 2)}`));
});

// https://github.com/Stremio/stremio-addon-sdk/blob/master/docs/advanced.md#using-user-data-in-addons
app.get("/:userConfig/manifest.json", async(req, res) => {
  const userConfig = JSON.parse(atob(req.params.userConfig));
  const debridInstance = debrid.instance(userConfig);
  const manifest = {
    id: config.addonId,
    version: addon.version,
    name: `${addon.name} ${debridInstance.shortName}`,
    description: addon.description,
    icon: "https://avatars.githubusercontent.com/u/15383019?s=48&v=4",
    resources: ["stream"],
    types: ["movie", "series"],
    idPrefixes: ["tt"],
    catalogs: [],
    behaviorHints: {configurable: true}
  };
  respond(res, manifest);
});

app.get("/:userConfig/stream/:type/:id.json", async(req, res) => {

  try {

    const streams = await jackettio.getStreams(
      Object.assign(JSON.parse(atob(req.params.userConfig)), {ip: req.ip}),
      req.params.type, 
      req.params.id,
      `${req.hostname == 'localhost' ? 'http' : 'https'}://${req.hostname}`
    );

    return respond(res, {streams});

  }catch(err){

    console.log(err);
    return respond(res, {streams: []});

  }

});

app.get('/:userConfig/download/:type/:id/:torrentId', async(req, res) => {

  try {

    const url = await jackettio.getDownload(
      JSON.parse(atob(req.params.userConfig)),
      req.params.type, 
      req.params.id, 
      req.params.torrentId
    );
    
    res.redirect(url);
    res.end();

  }catch(err){

    console.log(err);

    switch(err.message){
      case debrid.ERROR.NOT_READY:
        res.redirect(`/videos/not_ready.mp4`);
        res.end();
        break;
      case debrid.ERROR.EXPIRED_API_KEY:
        res.redirect(`/videos/expired_api_key.mp4`);
        res.end();
        break;
      case debrid.ERROR.NOT_PREMIUM:
        res.redirect(`/videos/not_premium.mp4`);
        res.end();
        break;
      default:
        res.redirect(`/videos/error.mp4`);
        res.end();
    }

  }

});

app.use((req, res) => {
  if (req.xhr) {
    res.status(404).send({ error: 'Page not found!' })
  } else {
    res.status(404).send('Page not found!');
  }
});

app.use((err, req, res, next) => {
  console.error(err.stack)
  if (req.xhr) {
    res.status(500).send({ error: 'Something broke!' })
  } else {
    res.status(500).send('Something broke!');
  }
})

const server = app.listen(config.port, async () => {

  console.log('───────────────────────────────────────');
  console.log(`Started addon ${addon.name} v${addon.version}`);
  console.log(`Server listen at: http://localhost:${config.port}`);
  console.log('───────────────────────────────────────');

  let tunnel;
  if(config.localtunnel){
    let subdomain = await cache.get('localtunnel:subdomain');
    tunnel = await localtunnel({port: config.port, subdomain});
    await cache.set('localtunnel:subdomain', tunnel.clientId, {ttl: 86400*365});
    console.log(`Your addon is available on the following address: ${tunnel.url}/configure`);
    tunnel.on('close', () => console.log("tunnels are closed"));
  }

  createTorrentFolder();
  let cleanTorrentFolderInterval = setInterval(cleanTorrentFolder, 3600e3);

  function closeGracefully(signal) {
    console.log(`Received signal to terminate: ${signal}`);
    if(tunnel)tunnel.close();
    clearInterval(cleanTorrentFolderInterval);
    server.close(() => {
      console.log('Server closed');
      process.kill(process.pid, signal);
    });
  }
  process.once('SIGINT', closeGracefully);
  process.once('SIGTERM', closeGracefully);

});